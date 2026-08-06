"""SafeFit-R physics layer: every supplied column turned into a decision variable.

Problem 1 hands over 14 battery columns and 8 request columns. A dispatch rule
that reads only SoC, SoH, T, R_int and ΔV leaves chemistry, pack nominals,
cycle count, age, reported energy, station status, vehicle type, range, load and
wait budget on the floor. This module derives, from those columns alone:

* pack energy actually deliverable into a mission (SoH- and imbalance-corrected)
* telemetry trust — reported energy against two independent physical ceilings
* aging consistency — SoH against the pack's own cycle and calendar history
* power capability — resistive sag and Joule heating under the mission's current
* mission demand — range, load and vehicle class turned into energy and current

The one thing it never does is relax a mandatory constraint. The brief's
min-SoC rule stays exactly as written; everything here can only add a reason a
pack is unfit, never remove one.

The headline result it exposes: min_SoC is stated as a percentage of a *nominal*
pack, so a degraded pack can satisfy it and still be unable to finish the trip.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as cfg


# --------------------------------------------------------------------------
# Pack-side physics
# --------------------------------------------------------------------------


def _chem_props(chemistry: pd.Series | None, n: int) -> pd.DataFrame:
    """Per-row chemistry constants, defaulting to LFP for unknown strings."""
    if chemistry is None:
        names = pd.Series([cfg.DEFAULT_CHEMISTRY] * n)
    else:
        names = chemistry.astype(str).str.strip().str.upper()
    default = cfg.CHEMISTRY[cfg.DEFAULT_CHEMISTRY]
    rows = [cfg.CHEMISTRY.get(name, default) for name in names]
    return pd.DataFrame(rows, index=range(n))


def derive_pack_physics(batteries: pd.DataFrame) -> pd.DataFrame:
    """Attach derived physical quantities to every pack row.

    Columns added are prefixed ``phys_`` so they never collide with the supplied
    schema and are trivially separable in an export.
    """
    out = batteries.reset_index(drop=True).copy()
    n = len(out)
    chem = _chem_props(out["chemistry"] if "chemistry" in out.columns else None, n)

    v_nom = _numeric(out, "V_nom", cfg.PACK_NOMINAL_V)
    ah = _numeric(out, "Ah_rated", cfg.PACK_CAPACITY_AH)
    soc = out["SoC"].astype(float) / 100.0
    soh = out["SoH"].astype(float) / 100.0
    r_ohm = out["R_int_mOhm"].astype(float) / 1000.0
    dv_mv = out["dV_cell_mV"].astype(float)

    # --- pack topology, inferred from the supplied nominal voltage -----------
    out["phys_series_cells"] = np.maximum(
        1, np.round(v_nom / chem["cell_nominal_V"]).astype(int)
    )
    cell_window_mV = (chem["cell_max_V"] - chem["cell_min_V"]) * 1000.0

    # --- energy ledger -------------------------------------------------------
    e_nom = v_nom * ah / 1000.0  # kWh at 100% SoC, 100% SoH
    out["phys_E_nominal_kWh"] = e_nom
    # Ceiling ignoring health: what SoC alone could justify.
    out["phys_E_ceiling_kWh"] = e_nom * soc
    # What the pack actually holds once capacity fade is applied.
    out["phys_E_usable_kWh"] = e_nom * soc * soh

    # Cell imbalance costs real capacity: the weakest cell reaches its cutoff
    # first and ends the discharge for the whole series string.
    imbalance_derate = np.clip(dv_mv / cell_window_mV, 0.0, 0.5)
    out["phys_imbalance_derate"] = imbalance_derate
    out["phys_E_deliverable_kWh"] = out["phys_E_usable_kWh"] * (1.0 - imbalance_derate)

    # --- telemetry trust -----------------------------------------------------
    if "E_avail_kWh" in out.columns:
        reported = out["E_avail_kWh"].astype(float)
        expected = out["phys_E_usable_kWh"].replace(0.0, np.nan)
        out["phys_energy_residual"] = (reported - expected) / expected
        # Two independent failures: drifted vs physically impossible.
        out["phys_energy_drift"] = out["phys_energy_residual"].abs() > cfg.ENERGY_TRUST_TOL
        out["phys_energy_impossible"] = reported > (
            out["phys_E_ceiling_kWh"] * cfg.ENERGY_CEILING_TOL
        )
    else:
        out["phys_energy_residual"] = np.nan
        out["phys_energy_drift"] = False
        out["phys_energy_impossible"] = False

    # --- thermal -------------------------------------------------------------
    t_now = out["T"].astype(float)
    t_24h = out["T_24h_max"].astype(float)
    out["phys_thermal_margin_C"] = chem["T_max_C"] - t_now
    out["phys_thermal_headroom_24h_C"] = chem["T_max_C"] - t_24h
    # A pack cannot currently be hotter than its own recorded 24 h maximum.
    out["phys_thermal_history_fault"] = t_now > t_24h
    # Recent excursion the pack has already survived but that erodes margin.
    out["phys_thermal_excursion_C"] = (t_24h - chem["T_derate_from_C"]).clip(lower=0.0)

    # --- aging consistency ---------------------------------------------------
    out = _attach_aging(out)

    # --- power capability at rest -------------------------------------------
    out["phys_R_ohm"] = r_ohm
    # Resistance normalised per cell makes packs of different topology comparable.
    out["phys_R_per_cell_mOhm"] = out["R_int_mOhm"].astype(float) / out["phys_series_cells"]

    # --- station declaration -------------------------------------------------
    if "station_status" in out.columns:
        status = out["station_status"].astype(str).str.strip().str.upper()
        out["phys_station_blocked"] = status.isin(cfg.STATION_STATUS_BLOCKING)
    else:
        out["phys_station_blocked"] = False

    return out


def _numeric(df: pd.DataFrame, col: str, default: float) -> pd.Series:
    """Column as float, falling back to a constant when absent or null."""
    if col not in df.columns:
        return pd.Series([default] * len(df), index=df.index, dtype=float)
    return pd.to_numeric(df[col], errors="coerce").fillna(default).astype(float)


def _attach_aging(out: pd.DataFrame) -> pd.DataFrame:
    """Regress SoH on the pack's own usage history and flag the outliers.

    Cycle count and calendar age are the two supplied wear proxies. Across the
    fleet they explain most of the SoH spread, so a pack whose reported SoH sits
    far off that surface is claiming a health its history does not support —
    a telemetry-trust signal, not a safety verdict.
    """
    n = len(out)
    has_cycles = "cycle_count" in out.columns
    has_age = "age_years" in out.columns

    if not (has_cycles or has_age) or n < 10:
        out["phys_SoH_expected"] = np.nan
        out["phys_SoH_residual"] = np.nan
        out["phys_aging_inconsistent"] = False
        out["phys_fade_per_1k_cycles"] = np.nan
        out["phys_rul_cycles"] = np.nan
        return out

    soh = out["SoH"].astype(float).to_numpy()
    cycles = (
        pd.to_numeric(out["cycle_count"], errors="coerce").fillna(0.0).to_numpy()
        if has_cycles
        else np.zeros(n)
    )
    age = (
        pd.to_numeric(out["age_years"], errors="coerce").fillna(0.0).to_numpy()
        if has_age
        else np.zeros(n)
    )

    design = np.column_stack([cycles, age, np.ones(n)])
    coef, *_ = np.linalg.lstsq(design, soh, rcond=None)
    expected = design @ coef
    residual = soh - expected

    # Robust sigma: MAD is insensitive to the very outliers being screened for.
    mad = float(np.median(np.abs(residual - np.median(residual))))
    sigma = mad * 1.4826 if mad > 1e-9 else float(np.std(residual))
    sigma = sigma if sigma > 1e-9 else 1.0

    out["phys_SoH_expected"] = expected
    out["phys_SoH_residual"] = residual
    out["phys_aging_inconsistent"] = np.abs(residual) > cfg.AGING_RESIDUAL_SIGMA * sigma

    # Observed fade rate drives remaining-useful-life, which prices the cost of
    # spending a pack on a mission that did not need it.
    fade_per_cycle = -float(coef[0])
    out["phys_fade_per_1k_cycles"] = fade_per_cycle * 1000.0
    if fade_per_cycle > 1e-9:
        out["phys_rul_cycles"] = np.maximum(
            0.0, (soh - cfg.SOH_EOL_PERCENT) / fade_per_cycle
        )
    else:
        out["phys_rul_cycles"] = np.nan
    return out


# --------------------------------------------------------------------------
# Mission-side physics
# --------------------------------------------------------------------------


def derive_mission_physics(
    vehicles: pd.DataFrame,
    e_nominal_kWh: float = cfg.PACK_NOMINAL_V * cfg.PACK_CAPACITY_AH / 1000.0,
    v_nominal: float = cfg.PACK_NOMINAL_V,
) -> pd.DataFrame:
    """Turn each request's range, load, type and wait budget into demand.

    The energy requirement is read straight out of the brief's own min-SoC
    figure: min_SoC is a percentage of a *nominal* pack, so the mission needs
    ``E_nom · min_SoC/100`` kWh. Nothing is invented — the dataset states the
    requirement, this just converts the units.

    Current draw does require declared assumptions (average speed by vehicle
    class, peak factor by payload class); they are named in config and used only
    for the power-margin check, never for the mandatory feasibility test.
    """
    out = vehicles.reset_index(drop=True).copy()

    min_soc = out["min_SoC"].astype(float)
    out["mis_E_required_kWh"] = e_nominal_kWh * min_soc / 100.0
    out["mis_E_with_reserve_kWh"] = out["mis_E_required_kWh"] * (
        1.0 + cfg.ENERGY_RESERVE_FRACTION
    )

    # --- kinematics ----------------------------------------------------------
    if "vehicle_type" in out.columns:
        speed = (
            out["vehicle_type"]
            .astype(str)
            .str.strip()
            .map(cfg.VEHICLE_SPEED_KMH)
            .fillna(cfg.DEFAULT_SPEED_KMH)
        )
    else:
        speed = pd.Series([cfg.DEFAULT_SPEED_KMH] * len(out))
    out["mis_speed_kmh"] = speed

    if "range_km" in out.columns:
        km = pd.to_numeric(out["range_km"], errors="coerce").fillna(0.0)
    else:
        km = pd.Series([0.0] * len(out))
    out["mis_range_km"] = km
    out["mis_duration_h"] = np.where(speed > 0, km / speed, 0.0)

    # Specific consumption implied by this request alone — the dataset's own
    # link between the range it asks for and the charge it demands.
    out["mis_Wh_per_km"] = np.where(
        km > 0, out["mis_E_required_kWh"] * 1000.0 / km, np.nan
    )

    # --- current draw --------------------------------------------------------
    if "load_category" in out.columns:
        peak_factor = (
            out["load_category"]
            .astype(str)
            .str.strip()
            .map(cfg.LOAD_PEAK_FACTOR)
            .fillna(cfg.DEFAULT_PEAK_FACTOR)
        )
    else:
        peak_factor = pd.Series([cfg.DEFAULT_PEAK_FACTOR] * len(out))
    out["mis_peak_factor"] = peak_factor

    duration = out["mis_duration_h"].replace(0.0, np.nan)
    p_avg_kW = out["mis_E_required_kWh"] / duration
    out["mis_P_avg_kW"] = p_avg_kW.fillna(0.0)
    out["mis_I_avg_A"] = (p_avg_kW * 1000.0 / v_nominal).fillna(0.0)
    out["mis_I_peak_A"] = out["mis_I_avg_A"] * peak_factor

    # --- service ------------------------------------------------------------
    if "W_max_min" in out.columns:
        out["mis_wait_budget_min"] = pd.to_numeric(
            out["W_max_min"], errors="coerce"
        ).fillna(np.inf)
    else:
        out["mis_wait_budget_min"] = np.inf

    out["mis_severity"] = _mission_severity(out)
    return out


def _mission_severity(out: pd.DataFrame) -> pd.Series:
    """0–1 index blending energy demand, payload, priority and wait budget.

    Drives which packs a mission is *allowed* to draw from: the point of the
    best-fit rule is that a light campus run should not consume a pack that a
    93 km heavy delivery will need later.

    The wait budget belongs here because it decides whether a request can be
    held back at all. A two-minute budget must be met from the shelf as it
    stands; a nineteen-minute one can wait for a pack to come off charge, which
    makes it the cheaper request to defer when supply tightens.
    """
    e = out["mis_E_required_kWh"]
    e_norm = (e - e.min()) / max(float(e.max() - e.min()), 1e-9)
    load_rank = (
        out["load_category"].astype(str).str.strip().map({"Light": 0.0, "Medium": 0.5, "Heavy": 1.0})
        if "load_category" in out.columns
        else pd.Series([0.5] * len(out))
    ).fillna(0.5)
    prio_rank = (
        out["priority"]
        .astype(str)
        .map({"Critical": 1.0, "High": 0.75, "Medium": 0.4, "Low": 0.0})
        .fillna(0.4)
    )
    budget = out["mis_wait_budget_min"].replace(np.inf, np.nan)
    if budget.notna().any():
        span = max(float(budget.max() - budget.min()), 1e-9)
        urgency = ((budget.max() - budget) / span).fillna(0.5)
    else:
        urgency = pd.Series([0.5] * len(out))

    return (
        0.40 * e_norm + 0.25 * load_rank + 0.20 * prio_rank + 0.15 * urgency
    ).clip(0.0, 1.0)


# --------------------------------------------------------------------------
# Pack × mission compatibility
# --------------------------------------------------------------------------


def compatibility_matrix(
    packs: pd.DataFrame, missions: pd.DataFrame
) -> dict[str, np.ndarray]:
    """Every pack against every mission, as separable physical tests.

    Returns one boolean/float array per test so the dashboard can say exactly
    which physics rejected an edge, rather than showing a single opaque bit.

    Rows are missions, columns are packs.
    """
    m, n = len(missions), len(packs)

    soc = packs["SoC"].to_numpy(float)[None, :]
    e_deliv = packs["phys_E_deliverable_kWh"].to_numpy(float)[None, :]
    r_ohm = packs["phys_R_ohm"].to_numpy(float)[None, :]
    t_now = packs["T"].to_numpy(float)[None, :]
    thermal_margin = packs["phys_thermal_margin_C"].to_numpy(float)[None, :]

    min_soc = missions["min_SoC"].to_numpy(float)[:, None]
    e_need = missions["mis_E_with_reserve_kWh"].to_numpy(float)[:, None]
    i_peak = missions["mis_I_peak_A"].to_numpy(float)[:, None]
    i_avg = missions["mis_I_avg_A"].to_numpy(float)[:, None]
    duration_s = missions["mis_duration_h"].to_numpy(float)[:, None] * 3600.0

    # 1. Mandatory constraint, exactly as the brief states it.
    soc_ok = soc >= min_soc

    # 2. Energy feasibility — the test min-SoC cannot make, because min-SoC is a
    #    fraction of a nominal pack and this pack's tank has shrunk.
    energy_ok = e_deliv >= e_need
    energy_margin = e_deliv - e_need

    # 3. Voltage sag under peak load must not collapse the bus.
    v_sag = i_peak * r_ohm
    v_floor = cfg.PACK_NOMINAL_V * (1.0 - cfg.SAG_FLOOR_FRACTION)
    sag_ok = v_sag <= v_floor

    # 4. Joule heating over the mission must not push the pack past its limit.
    joule_rise = (
        (i_avg**2) * r_ohm * duration_s * cfg.JOULE_RETENTION
    ) / cfg.PACK_THERMAL_CAPACITY_J_PER_K
    thermal_ok = joule_rise <= thermal_margin

    feasible = soc_ok & energy_ok & sag_ok & thermal_ok

    return {
        "soc_ok": soc_ok,
        "energy_ok": energy_ok,
        "energy_margin_kWh": energy_margin,
        "sag_ok": sag_ok,
        "v_sag_V": np.broadcast_to(v_sag, (m, n)).copy(),
        "thermal_ok": thermal_ok,
        "joule_rise_C": np.broadcast_to(joule_rise, (m, n)).copy(),
        "projected_T_C": np.broadcast_to(t_now + joule_rise, (m, n)).copy(),
        "feasible": feasible,
    }


def rejection_reason(compat: dict[str, np.ndarray], i: int, j: int) -> str:
    """First physical test that rejects mission i / pack j, in severity order."""
    if not compat["soc_ok"][i, j]:
        return "below_min_SoC"
    if not compat["energy_ok"][i, j]:
        return "insufficient_deliverable_energy"
    if not compat["sag_ok"][i, j]:
        return "voltage_sag_under_peak_load"
    if not compat["thermal_ok"][i, j]:
        return "joule_rise_exceeds_thermal_margin"
    return ""
