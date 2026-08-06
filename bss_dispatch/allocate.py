"""Stage 4–5: HSF baseline and priority-weighted Hungarian matching."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

from . import config as cfg


def run_hsf_dispatch(batteries: pd.DataFrame, vehicles: pd.DataFrame) -> pd.DataFrame:
    """
    Highest-SoC-First sequential allocation.
    No health gate — quarantined packs may be assigned (baseline failure mode).
    """
    packs = batteries.sort_values("SoC", ascending=False).copy()
    used: set[str] = set()
    rows: list[dict] = []

    veh_order = vehicles.sort_values(
        ["arrival_order"] if "arrival_order" in vehicles.columns else ["vehicle_id"]
    )

    for _, veh in veh_order.iterrows():
        assigned = None
        for _, bat in packs.iterrows():
            bid = bat["battery_id"]
            if bid in used:
                continue
            if float(bat["SoC"]) >= float(veh["min_SoC"]):
                assigned = bat
                used.add(bid)
                break

        if assigned is None:
            rows.append(_unserved_row(veh, policy="HSF"))
        else:
            rows.append(_assignment_row(veh, assigned, policy="HSF"))

    return pd.DataFrame(rows)


def run_proposed_global_optimization_dispatch(
    batteries: pd.DataFrame,
    vehicles: pd.DataFrame,
) -> pd.DataFrame:
    """
    Weighted maximum bipartite matching via Hungarian algorithm.

    U_ij = P_i · BSS_j − γ · W_i − α · (I_payload² · R_int)
    Cost C = max(U_feasible) − U for min-cost assignment.
    Hard constraints: no quarantine, SoC ≥ min_SoC, 1:1;
    Degraded packs blocked from Critical/High vehicles.
    """
    candidates = batteries[batteries["status"] != cfg.STATUS_QUARANTINE].copy()
    candidates = candidates.dropna(subset=["BSS"]).reset_index(drop=True)
    vehicles = vehicles.reset_index(drop=True)

    m, n = len(vehicles), len(candidates)
    if m == 0 or n == 0:
        return pd.DataFrame(
            [_unserved_row(v, policy="Proposed") for _, v in vehicles.iterrows()]
        )

    utility = np.full((m, n), cfg.INFEASIBLE_UTILITY, dtype=float)

    for i, veh in vehicles.iterrows():
        priority = str(veh["priority"])
        p_weight = float(veh.get("priority_weight", cfg.PRIORITY_WEIGHTS.get(priority, 1.0)))
        peak_i = cfg.PEAK_CURRENT_A.get(priority, 25.0)
        min_soc = float(veh["min_SoC"])
        wait = float(veh["wait_min"]) if "wait_min" in veh and pd.notna(veh["wait_min"]) else 0.0

        for j, bat in candidates.iterrows():
            if float(bat["SoC"]) < min_soc:
                continue
            status = str(bat["status"])
            if (
                status == cfg.STATUS_DEGRADED
                and priority in cfg.HIGH_DEMAND_PRIORITIES
            ):
                continue

            bss = float(bat["BSS"])
            r_ohm = float(bat["R_int_mOhm"]) / 1000.0
            joule_penalty = cfg.JOULE_ALPHA * (peak_i**2) * r_ohm
            utility[i, j] = (
                p_weight * bss - cfg.WAIT_PENALTY_GAMMA * wait - joule_penalty
            )

    feasible = utility > cfg.INFEASIBLE_UTILITY / 2
    if feasible.any():
        u_max = float(utility[feasible].max())
        cost = u_max - utility
    else:
        cost = -utility

    # Keep infeasible edges expensive after transform
    cost = np.where(feasible, cost, 1.0e9)

    row_ind, col_ind = linear_sum_assignment(cost)

    assigned_vehicle_idx: set[int] = set()
    rows: list[dict] = []

    for i, j in zip(row_ind, col_ind):
        if not feasible[i, j]:
            continue
        veh = vehicles.iloc[i]
        bat = candidates.iloc[j]
        rows.append(_assignment_row(veh, bat, policy="Proposed"))
        assigned_vehicle_idx.add(i)

    for i, veh in vehicles.iterrows():
        if i not in assigned_vehicle_idx:
            rows.append(_unserved_row(veh, policy="Proposed"))

    return pd.DataFrame(rows)


# Vehicle-side descriptive columns echoed onto every assignment row so the
# dashboard can render the request without re-reading the source CSV.
_VEHICLE_PASSTHROUGH = (
    "vehicle_type",
    "load_category",
    "range_km",
    "arrival_time",
    "arrival_order",
    "wait_min",
    "W_max_min",
    "priority_weight",
)

# Battery-side columns echoed onto served rows (sub-scores + usage telemetry).
_BATTERY_PASSTHROUGH = (
    "T_24h_max",
    "S_SoH",
    "S_IR",
    "S_Imb",
    "S_T",
    "cycle_count",
    "age_years",
    "E_avail_kWh",
    "station_status",
)


def _optional(series: pd.Series, keys: tuple[str, ...]) -> dict:
    """Copy present, non-null columns; absent ones become None."""
    out: dict = {}
    for key in keys:
        if key in series and pd.notna(series[key]):
            out[key] = series[key]
        else:
            out[key] = None
    return out


def _assignment_row(veh: pd.Series, bat: pd.Series, policy: str) -> dict:
    row = {
        "policy": policy,
        "vehicle_id": veh["vehicle_id"],
        "priority": veh["priority"],
        "min_SoC": float(veh["min_SoC"]),
        "served": True,
        "battery_id": bat["battery_id"],
        "SoC": float(bat["SoC"]),
        "SoH": float(bat["SoH"]),
        "T": float(bat["T"]),
        "R_int_mOhm": float(bat["R_int_mOhm"]),
        "dV_cell_mV": float(bat["dV_cell_mV"]),
        "status": bat.get("status", ""),
        "quarantine_reason": (
            ""
            if pd.isna(bat.get("quarantine_reason", ""))
            else str(bat.get("quarantine_reason", "") or "")
        )
        or None,
        "BSS": float(bat["BSS"]) if pd.notna(bat.get("BSS", np.nan)) else np.nan,
        "T_score": float(bat["T_score"])
        if "T_score" in bat and pd.notna(bat.get("T_score", np.nan))
        else np.nan,
    }
    row.update(_optional(veh, _VEHICLE_PASSTHROUGH))
    row.update(_optional(bat, _BATTERY_PASSTHROUGH))
    return row


def _unserved_row(veh: pd.Series, policy: str) -> dict:
    row = {
        "policy": policy,
        "vehicle_id": veh["vehicle_id"],
        "priority": veh["priority"],
        "min_SoC": float(veh["min_SoC"]),
        "served": False,
        "battery_id": None,
        "SoC": np.nan,
        "SoH": np.nan,
        "T": np.nan,
        "R_int_mOhm": np.nan,
        "dV_cell_mV": np.nan,
        "status": None,
        "quarantine_reason": None,
        "BSS": np.nan,
        "T_score": np.nan,
    }
    row.update(_optional(veh, _VEHICLE_PASSTHROUGH))
    row.update({key: None for key in _BATTERY_PASSTHROUGH})
    return row
