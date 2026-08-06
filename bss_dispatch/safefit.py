"""SafeFit-R: safety gate, geometric suitability score, lexicographic best-fit.

Three stages sit on top of :mod:`physics`:

1. :func:`apply_safety_gate` — a three-tier verdict where safety is a *gate*,
   not a score term. Station declaration and physical impossibility outrank
   every health reading; degradation only narrows which missions a pack may
   take.
2. :func:`compute_geometric_bss` — the mandatory 0–100 score over four health
   dimensions, aggregated geometrically so one excellent dimension cannot
   conceal a severe weakness in another.
3. :func:`allocate_safefit` — a single-pass MILP whose objective encodes a
   lexicographic hierarchy: zero unsafe allocations, then Critical/High
   service, then total service, then best fit.

Best fit means the *weakest safe pack that completes the mission*. Maximum-score
matching asks which assignment scores highest; a fleet operator asks which
assignment consumes the least capability. Those are different problems, and the
second one is the real one.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import milp, Bounds, LinearConstraint

from . import config as cfg


# --------------------------------------------------------------------------
# Stage 1–2: safety gate
# --------------------------------------------------------------------------


def apply_safety_gate(packs: pd.DataFrame) -> pd.DataFrame:
    """Three-tier classification with a per-pack evidence trail.

    Expects :func:`physics.derive_pack_physics` to have run. Adds
    ``sf_status``, ``sf_reasons`` (semicolon-joined) and ``sf_trusted``.
    """
    out = packs.reset_index(drop=True).copy()
    statuses: list[str] = []
    reason_lists: list[str] = []
    trusted: list[bool] = []

    for _, row in out.iterrows():
        hard = _hard_violations(row)
        soft = _soft_violations(row)
        trust_flags = _trust_violations(row)

        if hard:
            statuses.append(cfg.STATUS_QUARANTINE)
            reason_lists.append(";".join(hard))
        elif soft:
            statuses.append(cfg.STATUS_DEGRADED)
            reason_lists.append(";".join(soft))
        else:
            statuses.append(cfg.STATUS_SAFE)
            reason_lists.append("")
        trusted.append(not trust_flags)

    out["sf_status"] = statuses
    out["sf_reasons"] = reason_lists
    out["sf_trusted"] = trusted
    return out


def _hard_violations(row: pd.Series) -> list[str]:
    """Non-negotiable reasons a pack must never be dispatched."""
    reasons: list[str] = []

    # The station's own declaration is evidence, and it outranks any reading.
    if bool(row.get("phys_station_blocked", False)):
        reasons.append("station_status_quarantine")
    # Reported energy above what SoC alone permits is not drift, it is impossible.
    if bool(row.get("phys_energy_impossible", False)):
        reasons.append("energy_exceeds_physical_ceiling")
    # A pack cannot be hotter now than its own recorded 24 h maximum.
    if bool(row.get("phys_thermal_history_fault", False)):
        reasons.append("temperature_exceeds_24h_maximum")

    if float(row["T"]) >= cfg.SAFEFIT_T_QUARANTINE:
        reasons.append("overtemperature")
    if float(row["SoH"]) < cfg.SAFEFIT_SOH_QUARANTINE:
        reasons.append("state_of_health_below_floor")
    if float(row["dV_cell_mV"]) >= cfg.SAFEFIT_DV_QUARANTINE:
        reasons.append("cell_imbalance_critical")
    if float(row["R_int_mOhm"]) >= cfg.SAFEFIT_R_QUARANTINE:
        reasons.append("internal_resistance_critical")
    return reasons


def _soft_violations(row: pd.Series) -> list[str]:
    """Reasons a pack is usable but only for lower-severity missions."""
    reasons: list[str] = []
    if float(row["SoH"]) < cfg.SAFEFIT_SOH_DEGRADED:
        reasons.append("capacity_fade")
    if float(row["T"]) >= cfg.SAFEFIT_T_DEGRADED:
        reasons.append("elevated_temperature")
    if float(row["dV_cell_mV"]) >= cfg.SAFEFIT_DV_DEGRADED:
        reasons.append("cell_imbalance_elevated")
    if float(row["R_int_mOhm"]) >= cfg.SAFEFIT_R_DEGRADED:
        reasons.append("internal_resistance_elevated")
    if float(row.get("phys_thermal_excursion_C", 0.0) or 0.0) > 0.0:
        reasons.append("recent_thermal_excursion")
    return reasons


def _trust_violations(row: pd.Series) -> list[str]:
    """Telemetry that disagrees with itself — suspect, but not unsafe."""
    reasons: list[str] = []
    if bool(row.get("phys_energy_drift", False)):
        reasons.append("reported_energy_drift")
    if bool(row.get("phys_aging_inconsistent", False)):
        reasons.append("soh_inconsistent_with_usage_history")
    return reasons


# --------------------------------------------------------------------------
# Stage 3: geometric suitability score
# --------------------------------------------------------------------------


def compute_geometric_bss(packs: pd.DataFrame) -> pd.DataFrame:
    """Mandatory 0–100 score across four health dimensions.

    BSS = 100 · (s_capacity · s_power · s_balance · s_thermal)^(1/4)

    The geometric mean is the whole point: an arithmetic blend lets a 98% SoH
    pack with a collapsing cell spread outrank a merely good pack, which is the
    opposite of what a dispatcher wants. A geometric mean drags the score toward
    the worst dimension, so a single severe weakness cannot be averaged away.
    """
    out = packs.reset_index(drop=True).copy()

    # Capacity: fade plus the capacity actually lost to imbalance.
    s_cap = np.clip(
        (out["SoH"].astype(float) - cfg.SOH_EOL_PERCENT)
        / (100.0 - cfg.SOH_EOL_PERCENT),
        0.0,
        1.0,
    ) * (1.0 - out["phys_imbalance_derate"].astype(float))

    # Power: resistance normalised per cell, so topology does not distort it.
    r_cell = out["phys_R_per_cell_mOhm"].astype(float)
    s_pow = np.clip(1.0 - (r_cell - 2.0) / 8.0, 0.0, 1.0)

    # Balance: spread against the quarantine limit.
    s_bal = np.clip(
        1.0 - out["dV_cell_mV"].astype(float) / cfg.SAFEFIT_DV_QUARANTINE, 0.0, 1.0
    )

    # Thermal: margin now, penalised by any recent excursion.
    margin = out["phys_thermal_margin_C"].astype(float)
    s_therm = np.clip(margin / 30.0, 0.0, 1.0) * np.clip(
        1.0 - out["phys_thermal_excursion_C"].astype(float) / 15.0, 0.0, 1.0
    )

    floor = 1e-6
    product = (
        np.maximum(s_cap, floor)
        * np.maximum(s_pow, floor)
        * np.maximum(s_bal, floor)
        * np.maximum(s_therm, floor)
    )
    out["sf_s_capacity"] = s_cap
    out["sf_s_power"] = s_pow
    out["sf_s_balance"] = s_bal
    out["sf_s_thermal"] = s_therm
    out["sf_BSS"] = 100.0 * product**0.25
    return out


# --------------------------------------------------------------------------
# Stage 4: lexicographic best-fit allocation
# --------------------------------------------------------------------------


def allocate_safefit(
    packs: pd.DataFrame,
    missions: pd.DataFrame,
    compat: dict[str, np.ndarray],
) -> pd.DataFrame:
    """Assign packs to requests under a lexicographic objective.

    The hierarchy, highest first:

    1. **Safety** — enforced structurally. Quarantined packs never enter the
       edge set, so no objective weight can trade a violation away.
    2. **Critical/High service** — dominates everything below it.
    3. **Total service.**
    4. **Best fit** — minimise energy oversupply, health oversupply, stress
       exposure, telemetry risk and premium-inventory consumption.

    Tiers are separated by powers of ``LEX_STEP`` large enough that no
    accumulation of lower-tier cost can outweigh one higher-tier unit. Solved as
    one MILP rather than a sequence, so the result is a single optimum with a
    single certificate.
    """
    eligible = packs["sf_status"] != cfg.STATUS_QUARANTINE
    pack_idx = np.flatnonzero(eligible.to_numpy())
    m, n = len(missions), len(pack_idx)

    if m == 0 or n == 0:
        return pd.DataFrame(
            [_unserved(missions.iloc[i], "no_eligible_pack") for i in range(m)]
        )

    feasible = compat["feasible"][:, pack_idx]
    edges = np.argwhere(feasible)
    if len(edges) == 0:
        return pd.DataFrame(
            [_unserved(missions.iloc[i], "no_feasible_pack") for i in range(m)]
        )

    fit_cost = _fit_cost(packs.iloc[pack_idx].reset_index(drop=True), missions, compat, pack_idx)

    # Service bonus by tier, each a full power of LEX_STEP above the next, so no
    # accumulation of lower-tier gain can buy off one higher-tier loss:
    #   Critical  >>  High  >>  everything else  >>  total fit cost.
    priority = missions["priority"].astype(str).to_numpy()
    service_bonus = np.where(
        priority == "Critical",
        cfg.LEX_STEP**3,
        np.where(np.isin(priority, list(cfg.HIGH_DEMAND_PRIORITIES)), cfg.LEX_STEP**2, cfg.LEX_STEP),
    )

    # minimise: Σ (fit_cost − service_bonus) · x
    obj = np.array(
        [fit_cost[i, j] - service_bonus[i] for i, j in edges], dtype=float
    )

    n_edges = len(edges)
    rows: list[np.ndarray] = []
    # Each mission receives at most one pack.
    for i in range(m):
        row = np.zeros(n_edges)
        row[edges[:, 0] == i] = 1.0
        rows.append(row)
    # Each pack serves at most one mission.
    for j in range(n):
        row = np.zeros(n_edges)
        row[edges[:, 1] == j] = 1.0
        rows.append(row)

    A = np.array(rows)
    constraint = LinearConstraint(A, lb=-np.inf, ub=1.0)
    result = milp(
        c=obj,
        constraints=[constraint],
        integrality=np.ones(n_edges),
        bounds=Bounds(0.0, 1.0),
    )
    if not result.success or result.x is None:
        raise RuntimeError(f"SafeFit-R allocation failed: {result.message}")

    chosen = np.flatnonzero(np.asarray(result.x) > 0.5)
    assigned_mission: dict[int, int] = {}
    for e in chosen:
        i, j = edges[e]
        assigned_mission[int(i)] = int(j)

    out_rows: list[dict] = []
    packs_eligible = packs.iloc[pack_idx].reset_index(drop=True)
    for i in range(m):
        mission = missions.iloc[i]
        if i not in assigned_mission:
            out_rows.append(_unserved(mission, _why_unserved(compat, pack_idx, i)))
            continue
        j = assigned_mission[i]
        out_rows.append(
            _served(mission, packs_eligible.iloc[j], compat, i, pack_idx[j], fit_cost[i, j])
        )
    return pd.DataFrame(out_rows)


def _fit_cost(
    packs: pd.DataFrame,
    missions: pd.DataFrame,
    compat: dict[str, np.ndarray],
    pack_idx: np.ndarray,
) -> np.ndarray:
    """Cost of spending pack j on mission i, once service is already secured.

    Every term answers a distinct operational question:

    * energy oversupply — is this pack fuller than the trip needs?
    * health oversupply — is this pack healthier than the trip needs?
    * stress exposure   — will this trip work this pack hard?
    * trust             — is this pack's telemetry self-consistent?
    * reserve           — does spending it now starve a harder mission later?
    """
    m, n = len(missions), len(packs)

    e_deliv = packs["phys_E_deliverable_kWh"].to_numpy(float)[None, :]
    e_need = missions["mis_E_with_reserve_kWh"].to_numpy(float)[:, None]
    bss = packs["sf_BSS"].to_numpy(float)[None, :]
    severity = missions["mis_severity"].to_numpy(float)[:, None]
    trusted = packs["sf_trusted"].to_numpy(bool)[None, :]

    # Energy handed over beyond the requirement, as a fraction of the need.
    energy_over = np.clip((e_deliv - e_need) / np.maximum(e_need, 1e-9), 0.0, None)

    # Capability handed to a mission that did not call for it. A severe mission
    # earns a healthy pack; a light one paying for the same pack is waste.
    health_over = (bss / 100.0) * (1.0 - severity)

    # How hard this trip works this pack, relative to what the pack can take.
    sag = compat["v_sag_V"][:, pack_idx]
    rise = compat["joule_rise_C"][:, pack_idx]
    margin = packs["phys_thermal_margin_C"].to_numpy(float)[None, :]
    stress = sag / (cfg.PACK_NOMINAL_V * (1.0 - cfg.SAG_FLOOR_FRACTION)) + rise / np.maximum(
        margin, 1e-6
    )

    trust_penalty = np.where(trusted, 0.0, 1.0) * np.ones((m, 1))

    # Premium inventory: packs that can serve the hardest missions are scarce,
    # so consuming one on an easy mission carries a forward cost. Scarcity is
    # measured against the demand actually present, not assumed.
    hardest = float(missions["mis_E_with_reserve_kWh"].max())
    can_serve_hardest = (packs["phys_E_deliverable_kWh"].to_numpy(float) >= hardest)
    reserve_penalty = can_serve_hardest[None, :] * (1.0 - severity)

    cost = (
        cfg.COST_W_ENERGY_OVERSUPPLY * energy_over
        + cfg.COST_W_HEALTH_OVERSUPPLY * health_over
        + cfg.COST_W_STRESS * stress
        + cfg.COST_W_TRUST * trust_penalty
        + cfg.COST_W_RESERVE * reserve_penalty
    )
    # Keep the tier separation valid: no single edge may approach LEX_STEP.
    return np.clip(cost, 0.0, cfg.LEX_STEP / (10.0 * max(m, 1)))


def _why_unserved(compat: dict[str, np.ndarray], pack_idx: np.ndarray, i: int) -> str:
    """Dominant physical reason a mission found no pack, for the certificate."""
    tests = ("soc_ok", "energy_ok", "sag_ok", "thermal_ok")
    counts = {t: int(compat[t][i, pack_idx].sum()) for t in tests}
    if counts["soc_ok"] == 0:
        return "no_pack_meets_min_SoC"
    if counts["energy_ok"] == 0:
        return "no_pack_holds_enough_deliverable_energy"
    if counts["sag_ok"] == 0:
        return "no_pack_survives_peak_load_sag"
    if counts["thermal_ok"] == 0:
        return "no_pack_has_thermal_margin"
    return "all_feasible_packs_taken_by_higher_priority"


def _served(
    mission: pd.Series,
    pack: pd.Series,
    compat: dict[str, np.ndarray],
    i: int,
    j_global: int,
    cost: float,
) -> dict:
    return {
        "policy": "SafeFit-R",
        "vehicle_id": mission["vehicle_id"],
        "priority": mission["priority"],
        "min_SoC": float(mission["min_SoC"]),
        "served": True,
        "battery_id": pack["battery_id"],
        "SoC": float(pack["SoC"]),
        "SoH": float(pack["SoH"]),
        "T": float(pack["T"]),
        "R_int_mOhm": float(pack["R_int_mOhm"]),
        "dV_cell_mV": float(pack["dV_cell_mV"]),
        "status": pack["sf_status"],
        "BSS": float(pack["sf_BSS"]),
        "trusted": bool(pack["sf_trusted"]),
        "E_deliverable_kWh": float(pack["phys_E_deliverable_kWh"]),
        "E_required_kWh": float(mission["mis_E_with_reserve_kWh"]),
        "energy_margin_kWh": float(compat["energy_margin_kWh"][i, j_global]),
        "v_sag_V": float(compat["v_sag_V"][i, j_global]),
        "joule_rise_C": float(compat["joule_rise_C"][i, j_global]),
        "projected_T_C": float(compat["projected_T_C"][i, j_global]),
        "fit_cost": float(cost),
        "unserved_reason": None,
    }


def _unserved(mission: pd.Series, reason: str) -> dict:
    return {
        "policy": "SafeFit-R",
        "vehicle_id": mission["vehicle_id"],
        "priority": mission["priority"],
        "min_SoC": float(mission["min_SoC"]),
        "served": False,
        "battery_id": None,
        "SoC": np.nan,
        "SoH": np.nan,
        "T": np.nan,
        "R_int_mOhm": np.nan,
        "dV_cell_mV": np.nan,
        "status": None,
        "BSS": np.nan,
        "trusted": None,
        "E_deliverable_kWh": np.nan,
        "E_required_kWh": float(mission["mis_E_with_reserve_kWh"]),
        "energy_margin_kWh": np.nan,
        "v_sag_V": np.nan,
        "joule_rise_C": np.nan,
        "projected_T_C": np.nan,
        "fit_cost": np.nan,
        "unserved_reason": reason,
    }
