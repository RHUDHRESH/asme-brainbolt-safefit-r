"""Mandatory comparison metrics vs HSF baseline."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from . import config as cfg


def evaluate_policy(assignments: pd.DataFrame) -> dict[str, Any]:
    total = len(assignments)
    served = assignments[assignments["served"]]
    n_served = int(served.shape[0])
    n_unserved = total - n_served

    crit_high = assignments[assignments["priority"].isin(["Critical", "High"])]
    crit_high_served = crit_high[crit_high["served"]]
    crit_high_rate = (
        100.0 * len(crit_high_served) / len(crit_high) if len(crit_high) else 100.0
    )

    unsafe = 0
    if n_served:
        unsafe = int((served["status"] == cfg.STATUS_QUARANTINE).sum())

    avg_soh = float(served["SoH"].mean()) if n_served else float("nan")
    avg_bss = float(served["BSS"].mean()) if n_served and served["BSS"].notna().any() else float("nan")

    thermal, voltage = _incident_counts(served)

    return {
        "total_vehicles": total,
        "successfully_served": n_served,
        "service_rate_pct": 100.0 * n_served / total if total else 0.0,
        "unserved": n_unserved,
        "high_critical_served_pct": crit_high_rate,
        "unsafe_allocations": unsafe,
        "avg_soh_allocated": avg_soh,
        "avg_bss_allocated": avg_bss,
        "thermal_stress_incidents": thermal,
        "voltage_collapse_incidents": voltage,
        "critical_avg_soh": _critical_avg(served, "SoH"),
        "critical_avg_ir": _critical_avg(served, "R_int_mOhm"),
    }


def compare_policies(proposed: pd.DataFrame, hsf: pd.DataFrame) -> dict[str, Any]:
    return {
        "Proposed": evaluate_policy(proposed),
        "HSF": evaluate_policy(hsf),
    }


def classification_summary(batteries: pd.DataFrame) -> dict[str, Any]:
    counts = batteries["status"].value_counts().to_dict()
    total = len(batteries)
    return {
        "total": total,
        "counts": counts,
        "pct": {k: 100.0 * v / total for k, v in counts.items()},
        "quarantine_reasons": (
            batteries.loc[batteries["status"] == cfg.STATUS_QUARANTINE, "quarantine_reason"]
            .value_counts()
            .to_dict()
        ),
    }


def write_metrics(comparison: dict[str, Any], class_summary: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"classification": class_summary, "comparison": comparison}
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def format_metrics_table(comparison: dict[str, Any]) -> str:
    prop = comparison["Proposed"]
    hsf = comparison["HSF"]
    rows = [
        (
            "Successfully Served Vehicles",
            f"{prop['successfully_served']} / {prop['total_vehicles']} ({prop['service_rate_pct']:.1f}%)",
            f"{hsf['successfully_served']} / {hsf['total_vehicles']} ({hsf['service_rate_pct']:.1f}%)",
        ),
        ("Unserved Vehicles", str(prop["unserved"]), str(hsf["unserved"])),
        (
            "High & Critical Priority Served",
            f"{prop['high_critical_served_pct']:.1f}%",
            f"{hsf['high_critical_served_pct']:.1f}%",
        ),
        (
            "Unsafe Battery Allocations",
            f"{prop['unsafe_allocations']} (STRICT)",
            str(hsf["unsafe_allocations"]),
        ),
        (
            "Average SoH of Allocated Packs",
            f"{prop['avg_soh_allocated']:.1f}%",
            f"{hsf['avg_soh_allocated']:.1f}%",
        ),
        (
            "Average Suitability Score (BSS)",
            f"{prop['avg_bss_allocated']:.1f} / 100",
            f"{hsf['avg_bss_allocated']:.1f} / 100",
        ),
    ]

    lines = [
        "| Metric | Proposed Method | Baseline (HSF) |",
        "| :--- | :---: | :---: |",
    ]
    for metric, p, h in rows:
        lines.append(f"| **{metric}** | **{p}** | {h} |")
    return "\n".join(lines)


def _critical_avg(served: pd.DataFrame, col: str) -> float:
    crit = served[served["priority"] == "Critical"]
    if crit.empty or crit[col].isna().all():
        return float("nan")
    return float(crit[col].mean())


def _incident_counts(served: pd.DataFrame) -> tuple[int, int]:
    if served.empty:
        return 0, 0
    thermal = 0
    voltage = 0
    for _, row in served.iterrows():
        priority = str(row["priority"])
        peak_i = cfg.PEAK_CURRENT_A.get(priority, 25.0)
        r_int = float(row["R_int_mOhm"])
        if r_int >= cfg.THERMAL_STRESS_IR_MOHM and peak_i >= 30:
            thermal += 1
        if (
            r_int >= cfg.VOLTAGE_COLLAPSE_IR_MOHM
            and peak_i >= cfg.VOLTAGE_COLLAPSE_MIN_CURRENT_A
        ):
            voltage += 1
    return thermal, voltage
