"""Charging-rate <-> degradation trade-off  [Wu 2018, IEEE T-VT].

The v1 solver treats pack health as an exogenous reading. In real operation the
station *causes* health loss every time it charges, and how much it causes is a
decision variable: the C-rate. This module prices that decision.

Fade has two additive parts:

    cycle    dQ_cyc = k_cyc . f_C(c) . f_T(T) . EFC
    calendar dQ_cal = k_cal . f_T(T) . dt

with a super-linear C-rate stress factor and an Arrhenius temperature factor:

    f_C(c) = (c / c_ref) ** beta      beta = 1.6  -> 2C ages ~5.3x faster than 0.5C
    f_T(T) = exp( (Ea/R) . (1/T_ref - 1/T) )      -> 45 degC ages ~2.5x faster than 25 degC

Fade is then monetised against the pack's replacement cost, which is what makes
it commensurable with the energy bill and lets a single objective trade one
against the other.
"""

from __future__ import annotations

import math
from numbers import Real

import numpy as np
import pandas as pd

from .. import config as cfg
from . import config_rt as rt

_KELVIN = 273.15
_T_FLOOR_K = 233.15


# --------------------------------------------------------- stress factors --
# Both factors are evaluated once per (pack, C-rate) inside the scheduler's
# inner loop, so the scalar path avoids numpy dispatch overhead entirely.
def c_rate_stress(c_rate: float | np.ndarray) -> float | np.ndarray:
    """f_C(c) = (c/c_ref)^beta. Zero at rest, super-linear in the rate."""
    if isinstance(c_rate, Real):
        c = float(c_rate)
        return 0.0 if c <= 0.0 else (c / rt.C_RATE_REF) ** rt.BETA_C_RATE
    c = np.asarray(c_rate, dtype=float)
    return np.where(c <= 0.0, 0.0, (np.maximum(c, 0.0) / rt.C_RATE_REF) ** rt.BETA_C_RATE)


def arrhenius(temp_c: float | np.ndarray) -> float | np.ndarray:
    """f_T(T), normalised to 1.0 at the 25 degC reference."""
    if isinstance(temp_c, Real):
        t_k = max(float(temp_c) + _KELVIN, _T_FLOOR_K)
        return math.exp(rt.EA_OVER_R_K * (1.0 / rt.T_REF_K - 1.0 / t_k))
    t_k = np.asarray(temp_c, dtype=float) + _KELVIN
    t_k = np.maximum(t_k, _T_FLOOR_K)  # guard against nonsense readings
    return np.exp(rt.EA_OVER_R_K * (1.0 / rt.T_REF_K - 1.0 / t_k))


# ------------------------------------------------------- rate feasibility --
def effective_c_rate(
    c_requested: float,
    soc_pct: float,
    status: str,
) -> float:
    """Clamp a requested C-rate to what the cell will actually accept.

    Two physical limits, both of which the scheduler must respect or its power
    forecast will be wrong: the CC-CV knee above `CV_TAPER_SOC_PCT`, and a hard
    fast-charge ban on Degraded packs.
    """
    c = max(0.0, float(c_requested))
    if status == cfg.STATUS_DEGRADED:
        c = min(c, rt.C_RATE_MAX_DEGRADED)
    if soc_pct >= rt.CV_TAPER_SOC_PCT:
        c = min(c, rt.CV_TAPER_C_RATE)
    return c


# ------------------------------------------------------------- energetics --
def soc_gain_pct(c_rate: float, hours: float, soh_pct: float) -> float:
    """SoC rise over `hours` at `c_rate`.

    C-rate is referenced to *rated* capacity, SoC to *present* capacity, so an
    aged pack gains SoC faster per amp-hour delivered.
    """
    soh = max(float(soh_pct), 1.0)
    return 100.0 * c_rate * hours * (100.0 / soh)


def charge_power_kw(c_rate: float, r_int_mohm: float) -> tuple[float, float, float]:
    """(stored kW, ohmic-loss kW, grid-draw kW) at a given C-rate.

    Loss inside the cell is I^2.R at the pack's own resistance -- the same
    quantity the v1 utility penalises at discharge, now paid at charge too.
    """
    current_a = c_rate * cfg.PACK_CAPACITY_AH
    p_stored = current_a * cfg.PACK_NOMINAL_V / 1000.0
    p_joule = (current_a**2) * (r_int_mohm / 1000.0) / 1000.0
    p_grid = (p_stored + p_joule) / rt.ETA_CHARGER
    return p_stored, p_joule, p_grid


# ------------------------------------------------------------------ fade ---
def cycle_fade_pct(c_rate: float, temp_c: float, hours: float, soh_pct: float) -> float:
    """%SoH lost to cycling over one charging step."""
    if c_rate <= 0.0 or hours <= 0.0:
        return 0.0
    soh = max(float(soh_pct), 1.0)
    efc = c_rate * hours * (100.0 / soh)  # equivalent full cycles moved
    return float(rt.K_CYC_PCT_PER_EFC * c_rate_stress(c_rate) * arrhenius(temp_c) * efc)


def calendar_fade_pct(temp_c: float, hours: float) -> float:
    """%SoH lost to calendar ageing over `hours`, temperature-accelerated."""
    return float(rt.K_CAL_PCT_PER_HOUR * arrhenius(temp_c) * hours)


def discharge_fade_pct(
    delta_soc_pct: float,
    c_rate_discharge: float,
    temp_c: float,
    soh_pct: float,
) -> float:
    """%SoH lost on the road, from the depth actually drawn during a trip."""
    if delta_soc_pct <= 0.0:
        return 0.0
    efc = (delta_soc_pct / 100.0)
    stress = c_rate_stress(max(c_rate_discharge, 1e-6))
    return float(rt.K_CYC_PCT_PER_EFC * stress * arrhenius(temp_c) * efc)


def fade_to_inr(fade_pct: float) -> float:
    """Monetise %SoH against replacement cost, pro-rated over the EoL budget."""
    return float(fade_pct / rt.EOL_FADE_PCT * rt.PACK_REPLACEMENT_INR)


def r_growth_mohm(fade_pct: float, slope_mohm_per_pct: float | None = None) -> float:
    """Ohmic growth that accompanies capacity fade."""
    slope = rt.R_GROWTH_MOHM_PER_PCT_SOH if slope_mohm_per_pct is None else slope_mohm_per_pct
    return float(fade_pct * slope)


def fit_r_soh_slope(batteries: pd.DataFrame) -> float:
    """Fit dR_int/dSoH from the supplied fleet, so ohmic growth is data-driven.

    The competition fleet shows r = -0.91 between SoH and R_int; using its own
    slope keeps the simulated pack trajectories consistent with the population
    they were drawn from. Returns a positive mOhm-per-lost-%SoH figure.
    """
    if not {"SoH", "R_int_mOhm"}.issubset(batteries.columns) or len(batteries) < 3:
        return rt.R_GROWTH_MOHM_PER_PCT_SOH
    soh = batteries["SoH"].to_numpy(float)
    r_int = batteries["R_int_mOhm"].to_numpy(float)
    mask = np.isfinite(soh) & np.isfinite(r_int)
    if mask.sum() < 3 or np.ptp(soh[mask]) < 1e-6:
        return rt.R_GROWTH_MOHM_PER_PCT_SOH
    slope = float(np.polyfit(soh[mask], r_int[mask], 1)[0])
    # slope is negative (R falls as SoH rises); losing SoH therefore raises R
    return float(abs(slope)) if np.isfinite(slope) else rt.R_GROWTH_MOHM_PER_PCT_SOH


# --------------------------------------------------------- step evaluation --
def evaluate_charge_step(
    c_requested: float,
    soc_pct: float,
    soh_pct: float,
    temp_c: float,
    r_int_mohm: float,
    status: str,
    price_inr_per_kwh: float,
    hours: float = rt.SLOT_HOURS,
) -> dict:
    """Full cost/benefit of charging one pack for one slot at one C-rate.

    This is the atom the MILP is built from: every term the objective needs,
    computed once, with the physical clamps already applied.
    """
    c_eff = effective_c_rate(c_requested, soc_pct, status)
    if c_eff <= 0.0:
        cal = calendar_fade_pct(temp_c, hours)
        return {
            "c_requested": float(c_requested),
            "c_effective": 0.0,
            "soc_gain_pct": 0.0,
            "p_grid_kw": 0.0,
            "p_joule_kw": 0.0,
            "energy_kwh": 0.0,
            "energy_cost_inr": 0.0,
            "fade_pct": cal,
            "degradation_inr": fade_to_inr(cal),
            "total_cost_inr": fade_to_inr(cal),
        }

    headroom = max(0.0, rt.SOC_TARGET_PCT - soc_pct)
    gain = min(soc_gain_pct(c_eff, hours, soh_pct), headroom)
    # If the pack tops out mid-slot, only bill for the fraction actually used.
    full_gain = soc_gain_pct(c_eff, hours, soh_pct)
    duty = 1.0 if full_gain <= 1e-9 else min(1.0, gain / full_gain)

    _, p_joule, p_grid = charge_power_kw(c_eff, r_int_mohm)
    energy_kwh = p_grid * hours * duty
    energy_cost = energy_kwh * price_inr_per_kwh
    fade = cycle_fade_pct(c_eff, temp_c, hours * duty, soh_pct) + calendar_fade_pct(
        temp_c, hours
    )
    deg_cost = fade_to_inr(fade)

    return {
        "c_requested": float(c_requested),
        "c_effective": float(c_eff),
        "soc_gain_pct": float(gain),
        "p_grid_kw": float(p_grid * duty),
        "p_joule_kw": float(p_joule * duty),
        "energy_kwh": float(energy_kwh),
        "energy_cost_inr": float(energy_cost),
        "fade_pct": float(fade),
        "degradation_inr": float(deg_cost),
        "total_cost_inr": float(energy_cost + deg_cost),
    }
