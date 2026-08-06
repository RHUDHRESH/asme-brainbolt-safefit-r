"""Serialize full run results for the dashboard API."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pandas as pd

from . import config as cfg


def _clean(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


def _reason(row: pd.Series) -> str | None:
    raw = row.get("quarantine_reason")
    if pd.isna(raw):
        return None
    text = str(raw or "").strip()
    return text or None


def _text(value: Any) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    return text or None


def assignments_to_records(assignments: pd.DataFrame, limit: int | None = None) -> list[dict]:
    df = assignments.copy()
    if "served" in df.columns:
        df = df.sort_values(["served", "priority"], ascending=[False, True])
    if limit is not None:
        df = df.head(limit)

    rows: list[dict] = []
    for _, row in df.iterrows():
        rows.append(
            {
                "vehicle_id": str(row.get("vehicle_id", "")),
                "priority": str(row.get("priority", "")),
                "served": bool(row.get("served", False)),
                "battery_id": None if pd.isna(row.get("battery_id")) else str(row["battery_id"]),
                "status": None if pd.isna(row.get("status")) else str(row["status"]),
                "quarantine_reason": _reason(row),
                "SoC": _clean(row.get("SoC")),
                "SoH": _clean(row.get("SoH")),
                "T": _clean(row.get("T")),
                "T_24h_max": _clean(row.get("T_24h_max")),
                "BSS": _clean(row.get("BSS")),
                "T_score": _clean(row.get("T_score")),
                "R_int_mOhm": _clean(row.get("R_int_mOhm")),
                "dV_cell_mV": _clean(row.get("dV_cell_mV")),
                "min_SoC": _clean(row.get("min_SoC")),
                # MAUT sub-scores of the pack that was actually allocated
                "S_SoH": _clean(row.get("S_SoH")),
                "S_IR": _clean(row.get("S_IR")),
                "S_Imb": _clean(row.get("S_Imb")),
                "S_T": _clean(row.get("S_T")),
                # Request descriptors straight from the demand CSV
                "vehicle_type": _text(row.get("vehicle_type")),
                "load_category": _text(row.get("load_category")),
                "range_km": _clean(row.get("range_km")),
                "arrival_time": _text(row.get("arrival_time")),
                "arrival_order": _clean(row.get("arrival_order")),
                "wait_min": _clean(row.get("wait_min")),
                "W_max_min": _clean(row.get("W_max_min")),
                "priority_weight": _clean(row.get("priority_weight")),
                # Pack usage telemetry from the fleet CSV
                "cycle_count": _clean(row.get("cycle_count")),
                "age_years": _clean(row.get("age_years")),
                "E_avail_kWh": _clean(row.get("E_avail_kWh")),
            }
        )
    return rows


def fleet_to_records(
    batteries: pd.DataFrame,
    proposed: pd.DataFrame,
) -> list[dict]:
    """One roster row per battery, joined with Proposed assignment when matched."""
    assign_map: dict[str, dict[str, Any]] = {}
    if not proposed.empty and "battery_id" in proposed.columns:
        if "served" in proposed.columns:
            matched = proposed[proposed["served"] == True]  # noqa: E712
        else:
            matched = proposed[proposed["battery_id"].notna()]
        for _, row in matched.iterrows():
            bid = row.get("battery_id")
            if pd.isna(bid):
                continue
            assign_map[str(bid)] = {
                "assigned_vehicle_id": str(row.get("vehicle_id", "")),
                "priority": str(row.get("priority", "")),
            }

    rows: list[dict] = []
    for slot, (_, row) in enumerate(batteries.iterrows()):
        bid = str(row.get("battery_id", ""))
        match = assign_map.get(bid)
        rows.append(
            {
                "battery_id": bid,
                # Physical shelf order = row order in the fleet dataset
                "slot": slot,
                "status": str(row.get("status", "")),
                "SoC": _clean(row.get("SoC")),
                "SoH": _clean(row.get("SoH")),
                "T": _clean(row.get("T")),
                "T_24h_max": _clean(row.get("T_24h_max")),
                "R_int_mOhm": _clean(row.get("R_int_mOhm")),
                "dV_cell_mV": _clean(row.get("dV_cell_mV")),
                "quarantine_reason": _reason(row),
                "assigned_vehicle_id": None
                if match is None
                else match["assigned_vehicle_id"],
                "priority": None if match is None else match["priority"],
                # Scores from battery DF (all packs), not only assigned join
                "BSS": _clean(row.get("BSS")),
                "T_score": _clean(row.get("T_score")),
                "S_SoH": _clean(row.get("S_SoH")),
                "S_IR": _clean(row.get("S_IR")),
                "S_Imb": _clean(row.get("S_Imb")),
                "S_T": _clean(row.get("S_T")),
                # Usage / provenance straight from the fleet CSV
                "cycle_count": _clean(row.get("cycle_count")),
                "age_years": _clean(row.get("age_years")),
                "E_avail_kWh": _clean(row.get("E_avail_kWh")),
                "chemistry": _text(row.get("chemistry")),
                "V_nom": _clean(row.get("V_nom")),
                "Ah_rated": _clean(row.get("Ah_rated")),
                "station_status": _text(row.get("station_status")),
                "integrity_quarantine": bool(row.get("integrity_quarantine", False)),
                "recalibrate_flag": bool(row.get("recalibrate_flag", False)),
            }
        )
    return rows


def solver_config() -> dict[str, Any]:
    """Every threshold / weight the UI renders, read live off config.py."""
    return {
        "pack": {
            "series_cells": cfg.PACK_SERIES_CELLS,
            "capacity_ah": cfg.PACK_CAPACITY_AH,
            "nominal_v": cfg.PACK_NOMINAL_V,
        },
        "thresholds": {
            "T_safe_min": cfg.T_SAFE_MIN,
            "T_safe_max": cfg.T_SAFE_MAX,
            "T_degraded_max": cfg.T_DEGRADED_MAX,
            "T_cold_min": cfg.T_COLD_MIN,
            "SoH_safe_min": cfg.SOH_SAFE_MIN,
            "SoH_degraded_min": cfg.SOH_DEGRADED_MIN,
            "R_int_safe_max": cfg.R_INT_SAFE_MAX,
            "R_int_degraded_max": cfg.R_INT_DEGRADED_MAX,
            "dV_safe_max": cfg.DV_SAFE_MAX,
            "dV_degraded_max": cfg.DV_DEGRADED_MAX,
            "energy_residual_tol": cfg.ENERGY_RESIDUAL_TOL,
        },
        "maut": {
            "weights": {
                "SoH": cfg.W_SOH,
                "IR": cfg.W_IR,
                "Imb": cfg.W_IMB,
                "T": cfg.W_TEMP,
            },
            "anchors": {
                "T_ref": cfg.MAUT_T_REF,
                "T_span": cfg.MAUT_T_SPAN,
                "IR_offset": cfg.MAUT_IR_OFFSET,
                "IR_span": cfg.MAUT_IR_SPAN,
                "dV_offset": cfg.MAUT_DV_OFFSET,
                "dV_span": cfg.MAUT_DV_SPAN,
            },
        },
        "topsis_weights": {
            "SoC": cfg.TOPSIS_WEIGHTS[0],
            "SoH": cfg.TOPSIS_WEIGHTS[1],
            "R_int": cfg.TOPSIS_WEIGHTS[2],
            "dV": cfg.TOPSIS_WEIGHTS[3],
        },
        "priority_weights": dict(cfg.PRIORITY_WEIGHTS),
        "peak_current_a": dict(cfg.PEAK_CURRENT_A),
        "high_demand_priorities": sorted(cfg.HIGH_DEMAND_PRIORITIES),
        "penalties": {
            "wait_gamma": cfg.WAIT_PENALTY_GAMMA,
            "joule_alpha": cfg.JOULE_ALPHA,
        },
        "incident_thresholds": {
            "thermal_stress_ir_mOhm": cfg.THERMAL_STRESS_IR_MOHM,
            "voltage_collapse_ir_mOhm": cfg.VOLTAGE_COLLAPSE_IR_MOHM,
            "voltage_collapse_min_current_a": cfg.VOLTAGE_COLLAPSE_MIN_CURRENT_A,
        },
    }


def write_run_result(
    *,
    comparison: dict[str, Any],
    class_summary: dict[str, Any],
    proposed: pd.DataFrame,
    hsf: pd.DataFrame,
    batteries: pd.DataFrame,
    source: str,
    batteries_file: str | None = None,
    vehicles_file: str | None = None,
    n_batteries: int,
    n_vehicles: int,
    twists: dict[str, Any] | None = None,
    path: Path | None = None,
) -> Path:
    path = path or cfg.RUN_RESULT_JSON
    path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "source": source,
        "batteries_file": batteries_file,
        "vehicles_file": vehicles_file,
        "n_batteries": n_batteries,
        "n_vehicles": n_vehicles,
        "config": solver_config(),
        "twists": twists or {},
        "classification": class_summary,
        "comparison": comparison,
        "assignments": {
            "Proposed": assignments_to_records(proposed),
            "HSF": assignments_to_records(hsf),
        },
        "fleet": fleet_to_records(batteries, proposed),
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path
