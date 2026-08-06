"""Stage 2: Multi-physical safety gating & 3-tier classification."""

from __future__ import annotations

import pandas as pd

from . import config as cfg


def classify_battery_health(batteries: pd.DataFrame) -> pd.DataFrame:
    """Assign Safe / Degraded / Quarantine after Stage 1 integrity flags."""
    out = batteries.copy()
    statuses: list[str] = []
    reasons: list[str] = []

    for _, row in out.iterrows():
        status, reason = _classify_row(row)
        statuses.append(status)
        reasons.append(reason)

    out["status"] = statuses
    out["quarantine_reason"] = reasons
    return out


def _classify_row(row: pd.Series) -> tuple[str, str]:
    # Stage 1 hard quarantine takes precedence (owns thermal sensor fault)
    if bool(row.get("integrity_quarantine", False)):
        reason = str(row.get("integrity_reason", "") or "integrity")
        return cfg.STATUS_QUARANTINE, reason

    t = float(row["T"])
    soh = float(row["SoH"])
    r_int = float(row["R_int_mOhm"])
    dv = float(row["dV_cell_mV"])

    quarantine_checks = [
        (t > cfg.T_DEGRADED_MAX, "T_high"),
        (t < cfg.T_COLD_MIN, "T_cold"),
        (soh < cfg.SOH_DEGRADED_MIN, "SoH_low"),
        (r_int > cfg.R_INT_DEGRADED_MAX, "R_int_high"),
        (dv > cfg.DV_DEGRADED_MAX, "dV_high"),
    ]
    for triggered, reason in quarantine_checks:
        if triggered:
            return cfg.STATUS_QUARANTINE, reason

    is_safe = (
        cfg.T_SAFE_MIN <= t <= cfg.T_SAFE_MAX
        and soh >= cfg.SOH_SAFE_MIN
        and r_int < cfg.R_INT_SAFE_MAX
        and dv < cfg.DV_SAFE_MAX
    )
    if is_safe:
        return cfg.STATUS_SAFE, ""

    return cfg.STATUS_DEGRADED, ""
