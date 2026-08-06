"""Stage 5 onsite adaptation hooks (grid / TOU / queue defection)."""

from __future__ import annotations

from typing import Any

import pandas as pd

from . import config as cfg


def boost_priority_near_defection(
    vehicles: pd.DataFrame,
    factor: float | None = None,
    ratio_threshold: float | None = None,
) -> pd.DataFrame:
    """
    Twist C: as wait_min → W_max_min, multiply priority weight by factor (default 1.5).

    Adds/updates column `priority_weight` used by the Hungarian utility matrix.
    """
    factor = cfg.TWIST_DEFECTION_FACTOR if factor is None else factor
    ratio_threshold = (
        cfg.TWIST_DEFECTION_RATIO if ratio_threshold is None else ratio_threshold
    )
    out = vehicles.copy()
    weights = []
    for _, row in out.iterrows():
        base = float(cfg.PRIORITY_WEIGHTS.get(str(row["priority"]), 1.0))
        wait = float(row["wait_min"]) if "wait_min" in row and pd.notna(row["wait_min"]) else 0.0
        w_max = (
            float(row["W_max_min"])
            if "W_max_min" in row and pd.notna(row["W_max_min"])
            else 0.0
        )
        if w_max > 0 and (wait / w_max) >= ratio_threshold:
            base *= factor
        weights.append(base)
    out["priority_weight"] = weights
    return out


def apply_grid_limit(
    charge_schedule: pd.DataFrame,
    p_max: float,
) -> pd.DataFrame:
    """
    Twist A: enforce Σ P_charge,k ≤ P_grid,max by deferring lowest-priority / degraded packs.

    Expects columns: battery_id, status, priority_hint (optional), P_charge_kW.
    """
    out = charge_schedule.copy()
    if "P_charge_kW" not in out.columns:
        raise ValueError("charge_schedule requires P_charge_kW")

    # Defer degraded packs first; within tier, keep lower power first
    status_rank = out["status"].map(
        {cfg.STATUS_SAFE: 0, cfg.STATUS_DEGRADED: 1}
    ).fillna(2)
    out = out.assign(_status_rank=status_rank).sort_values(
        by=["_status_rank", "P_charge_kW"],
        ascending=[True, True],
    )

    running = 0.0
    allowed: list[bool] = []
    deferred: list[bool] = []
    for _, row in out.iterrows():
        p = float(row["P_charge_kW"])
        if running + p <= p_max:
            running += p
            allowed.append(True)
            deferred.append(False)
        else:
            allowed.append(False)
            deferred.append(True)
    out["charge_allowed"] = allowed
    out["charge_deferred"] = deferred
    out["P_used_kW"] = running
    return out.drop(columns=["_status_rank"])


def apply_tou_cost(
    schedule: pd.DataFrame,
    tariff: dict[str, float] | pd.Series,
    time_col: str = "hour",
) -> pd.DataFrame:
    """
    Twist B: attach time-of-use energy cost to a charging schedule.

    tariff maps hour (0–23) or period label → $/kWh.
    """
    out = schedule.copy()
    if time_col not in out.columns:
        raise ValueError(f"schedule requires '{time_col}'")
    if "P_charge_kW" not in out.columns:
        raise ValueError("schedule requires P_charge_kW")

    rates = []
    costs = []
    for _, row in out.iterrows():
        key = row[time_col]
        rate = float(tariff[key]) if key in tariff else float(tariff.get(str(key), 0.0))
        rates.append(rate)
        # assume 1 hour slot for cost estimate
        costs.append(rate * float(row["P_charge_kW"]))
    out["tou_rate"] = rates
    out["tou_cost"] = costs
    return out


def describe_twist_hooks() -> dict[str, Any]:
    return {
        "grid": {
            "enabled": cfg.TWIST_GRID_ENABLED,
            "fn": "apply_grid_limit",
        },
        "tou": {
            "enabled": cfg.TWIST_TOU_ENABLED,
            "fn": "apply_tou_cost",
        },
        "defection": {
            "enabled": cfg.TWIST_DEFECTION_ENABLED,
            "fn": "boost_priority_near_defection",
            "factor": cfg.TWIST_DEFECTION_FACTOR,
            "ratio": cfg.TWIST_DEFECTION_RATIO,
        },
    }
