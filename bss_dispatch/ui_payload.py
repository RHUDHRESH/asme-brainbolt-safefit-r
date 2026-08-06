"""SafeFit-R results in the dashboard's payload schema.

The dashboard reads exactly one file, `outputs/run_result.json`, and every
figure it paints traces back to it. This module is the single place where solver
frames become that file, so there is no second definition of any metric.

Beyond the legacy schema it adds the fields the physics layer earned: per-edge
energy margin, sag and Joule rise, the split between hard and soft gate reasons,
and the arrival-ordered series that make the time factor visible.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd

from . import config as cfg


def build_payload(
    packs: pd.DataFrame,
    missions: pd.DataFrame,
    proposed: pd.DataFrame,
    baseline: pd.DataFrame,
    *,
    result: dict,
    batteries_file: str | None = None,
    vehicles_file: str | None = None,
) -> dict:
    """Assemble the dashboard payload from solved frames."""
    return {
        "source": result.get("source", "upload"),
        "solver": "SafeFit-R",
        "batteries_file": batteries_file,
        "vehicles_file": vehicles_file,
        "n_batteries": int(len(packs)),
        "n_vehicles": int(len(missions)),
        "input_hash": result.get("input_hash"),
        "config": _config_block(),
        "classification": _classification_block(packs),
        "audit": result.get("audit", {}),
        "verification": {
            "Proposed": result.get("verification", {}),
            "HSF": result.get("verification_hsf", {}),
        },
        "comparison": {
            "Proposed": _policy_metrics(result["metrics"]["SafeFit-R"], proposed),
            "HSF": _policy_metrics(result["metrics"]["HSF"], baseline),
        },
        "assignments": {
            "Proposed": _assignment_rows(proposed, missions),
            "HSF": _assignment_rows(baseline, missions),
        },
        "timeline": _timeline_block(packs, missions, proposed, baseline),
        "fleet": _fleet_rows(packs, proposed),
    }


# --------------------------------------------------------------------------
# Config — the dashboard renders thresholds from here, never from literals
# --------------------------------------------------------------------------


def _config_block() -> dict:
    chem = cfg.CHEMISTRY[cfg.DEFAULT_CHEMISTRY]
    return {
        "pack": {
            "series_cells": cfg.PACK_SERIES_CELLS,
            "capacity_ah": cfg.PACK_CAPACITY_AH,
            "nominal_v": cfg.PACK_NOMINAL_V,
            "nominal_kwh": cfg.PACK_NOMINAL_V * cfg.PACK_CAPACITY_AH / 1000.0,
        },
        "chemistry": {cfg.DEFAULT_CHEMISTRY: chem},
        # Hard gate — a pack crossing any of these is never dispatched.
        "gate_hard": {
            "SoH_min": cfg.SAFEFIT_SOH_QUARANTINE,
            "T_max": cfg.SAFEFIT_T_QUARANTINE,
            "dV_max": cfg.SAFEFIT_DV_QUARANTINE,
            "R_int_max": cfg.SAFEFIT_R_QUARANTINE,
        },
        # Soft gate — pack is usable, but only for lower-severity missions.
        "gate_soft": {
            "SoH_min": cfg.SAFEFIT_SOH_DEGRADED,
            "T_max": cfg.SAFEFIT_T_DEGRADED,
            "dV_max": cfg.SAFEFIT_DV_DEGRADED,
            "R_int_max": cfg.SAFEFIT_R_DEGRADED,
        },
        "feasibility": {
            "energy_reserve_fraction": cfg.ENERGY_RESERVE_FRACTION,
            "sag_floor_fraction": cfg.SAG_FLOOR_FRACTION,
            "thermal_capacity_j_per_k": cfg.PACK_THERMAL_CAPACITY_J_PER_K,
            "joule_retention": cfg.JOULE_RETENTION,
        },
        "fit_cost_weights": {
            "energy_oversupply": cfg.COST_W_ENERGY_OVERSUPPLY,
            "health_oversupply": cfg.COST_W_HEALTH_OVERSUPPLY,
            "stress": cfg.COST_W_STRESS,
            "trust": cfg.COST_W_TRUST,
            "reserve": cfg.COST_W_RESERVE,
        },
        # Lexicographic ladder, highest first. The dashboard renders this as the
        # objective hierarchy instead of a single utility formula.
        "lex_tiers": [
            {"rank": 1, "label": "Zero unsafe allocations", "weight": "structural"},
            {"rank": 2, "label": "Critical service", "weight": cfg.LEX_STEP**3},
            {"rank": 3, "label": "High service", "weight": cfg.LEX_STEP**2},
            {"rank": 4, "label": "Total service", "weight": cfg.LEX_STEP},
            {"rank": 5, "label": "Best fit", "weight": 1.0},
        ],
        "high_demand_priorities": sorted(cfg.HIGH_DEMAND_PRIORITIES),
        # Legacy key names the parameter primitives and gating panel already
        # read. Values are the SafeFit-R gate, so the bands they draw are the
        # bands the solver actually enforces — not the retired v1 thresholds.
        "thresholds": {
            "T_safe_min": chem["T_min_C"],
            "T_safe_max": cfg.SAFEFIT_T_DEGRADED,
            "T_degraded_max": cfg.SAFEFIT_T_QUARANTINE,
            "T_cold_min": chem["T_min_C"],
            "SoH_safe_min": cfg.SAFEFIT_SOH_DEGRADED,
            "SoH_degraded_min": cfg.SAFEFIT_SOH_QUARANTINE,
            "R_int_safe_max": cfg.SAFEFIT_R_DEGRADED,
            "R_int_degraded_max": cfg.SAFEFIT_R_QUARANTINE,
            "dV_safe_max": cfg.SAFEFIT_DV_DEGRADED,
            "dV_degraded_max": cfg.SAFEFIT_DV_QUARANTINE,
            "energy_residual_tol": cfg.ENERGY_TRUST_TOL,
        },
        # The four dimensions the mandatory 0-100 score is built from, and the
        # aggregation that makes one severe weakness impossible to average away.
        "bss_dimensions": [
            {"key": "capacity", "label": "Capacity health", "inputs": ["SoH", "dV_cell_mV"]},
            {"key": "power", "label": "Power health", "inputs": ["R_int_mOhm"]},
            {"key": "balance", "label": "Cell balance", "inputs": ["dV_cell_mV"]},
            {"key": "thermal", "label": "Thermal margin", "inputs": ["T", "T_24h_max"]},
        ],
        "bss_aggregation": "geometric_mean",
        # v1 MAUT/TOPSIS, retained because that policy still ships as the
        # declared ablation. It is NOT how the headline BSS is computed.
        "maut": {
            "weights": {"SoH": cfg.W_SOH, "IR": cfg.W_IR, "Imb": cfg.W_IMB, "T": cfg.W_TEMP},
            "anchors": {
                "T_ref": cfg.MAUT_T_REF,
                "T_span": cfg.MAUT_T_SPAN,
                "IR_offset": cfg.MAUT_IR_OFFSET,
                "IR_span": cfg.MAUT_IR_SPAN,
                "dV_offset": cfg.MAUT_DV_OFFSET,
                "dV_span": cfg.MAUT_DV_SPAN,
            },
        },
        "topsis_weights": dict(
            zip(("SoC", "SoH", "R_int", "dV"), cfg.TOPSIS_WEIGHTS)
        ),
        "priority_weights": cfg.PRIORITY_WEIGHTS,
        "peak_current_a": cfg.PEAK_CURRENT_A,
        "penalties": {
            "wait_gamma": cfg.WAIT_PENALTY_GAMMA,
            "joule_alpha": cfg.JOULE_ALPHA,
        },
        "assumptions": {
            "vehicle_speed_kmh": cfg.VEHICLE_SPEED_KMH,
            "load_peak_factor": cfg.LOAD_PEAK_FACTOR,
        },
        "station_status_blocking": sorted(cfg.STATION_STATUS_BLOCKING),
    }


# --------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------

# Machine reason code → the sentence a judge should read. Kept next to the
# codes themselves so the two can never drift apart.
REASON_TEXT: dict[str, str] = {
    "station_status_quarantine": "Station has flagged this pack REVIEW/QUARANTINE — the declaration outranks any reading",
    "energy_exceeds_physical_ceiling": "Reported energy is above what its charge alone could hold — the telemetry is impossible, not merely drifted",
    "temperature_exceeds_24h_maximum": "Pack is hotter now than its own recorded 24-hour maximum — the thermal log is inconsistent",
    "overtemperature": "Temperature at or above the dispatch limit",
    "state_of_health_below_floor": "Capacity fade past the safety floor",
    "cell_imbalance_critical": "Cell voltage spread at or above the hard limit — the string is uneven",
    "internal_resistance_critical": "Internal resistance at or above the hard limit",
    "capacity_fade": "Reduced capacity — usable, but only for lower-severity missions",
    "elevated_temperature": "Running warm — thermal margin is narrowed",
    "cell_imbalance_elevated": "Cell spread elevated — weak-cell risk under long discharge",
    "internal_resistance_elevated": "Resistance elevated — more sag and heating under load",
    "recent_thermal_excursion": "Exceeded the derate temperature within the last 24 hours",
    "reported_energy_drift": "Reported energy disagrees with charge and health by more than 10%",
    "soh_inconsistent_with_usage_history": "Claimed health does not match this pack's own cycle and age record",
}

HARD_REASONS = frozenset(
    {
        "station_status_quarantine",
        "energy_exceeds_physical_ceiling",
        "temperature_exceeds_24h_maximum",
        "overtemperature",
        "state_of_health_below_floor",
        "cell_imbalance_critical",
        "internal_resistance_critical",
    }
)


def _classification_block(packs: pd.DataFrame) -> dict:
    counts = packs["sf_status"].value_counts().to_dict()
    total = len(packs)

    hard: dict[str, int] = {}
    soft: dict[str, int] = {}
    for status, entry in zip(packs["sf_status"], packs["sf_reasons"]):
        if not entry:
            continue
        target = hard if status == cfg.STATUS_QUARANTINE else soft
        for reason in str(entry).split(";"):
            target[reason] = target.get(reason, 0) + 1

    return {
        "total": total,
        "counts": {k: int(v) for k, v in counts.items()},
        "pct": {k: round(100.0 * v / total, 1) for k, v in counts.items()},
        # Legacy key the dashboard already reads.
        "quarantine_reasons": dict(sorted(hard.items(), key=lambda kv: -kv[1])),
        "degraded_reasons": dict(sorted(soft.items(), key=lambda kv: -kv[1])),
        "reason_text": REASON_TEXT,
        "hard_reason_codes": sorted(HARD_REASONS),
        "untrusted_packs": int((~packs["sf_trusted"]).sum()),
    }


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------


def _policy_metrics(metrics: dict, assign: pd.DataFrame) -> dict:
    total = int(len(assign))
    served = int(metrics["served"])
    out = {
        "total_vehicles": total,
        "successfully_served": served,
        "service_rate_pct": round(100.0 * served / total, 2) if total else 0.0,
        "unserved": int(metrics["unserved"]),
        "high_critical_served_pct": _num(metrics["high_critical_served_pct"]),
        "unsafe_allocations": int(metrics["unsafe_allocations"]),
        "avg_soh_allocated": _num(metrics["avg_soh_allocated"]),
        "avg_bss_allocated": _num(metrics["avg_bss_allocated"]),
        "avg_wait_min": metrics.get("avg_wait_min"),
    }
    out.update(_incidents(assign))
    # Differentiating metrics, carried through under their own names.
    for key in (
        "station_quarantine_allocations",
        "energy_infeasible_allocations",
        "energy_shortfall_total_kWh",
        "worst_energy_shortfall_kWh",
        "untrusted_allocations",
        "avg_soc_oversupply_pts",
        "premium_packs_consumed",
        "degraded_utilisation_pct",
        "deliverable_energy_consumed_kWh",
        "avg_energy_margin_kWh",
    ):
        out[key] = _num(metrics.get(key))
    return out


def _incidents(assign: pd.DataFrame) -> dict:
    """Predicted in-service failures, from the same physics for both policies.

    SafeFit-R refuses these edges outright, so its counts are structurally zero;
    the baseline's counts are what its picks would actually do in service.
    """
    served = assign[assign["served"]]
    if not len(served):
        return {
            "thermal_stress_incidents": 0,
            "voltage_collapse_incidents": 0,
            "critical_avg_soh": None,
            "critical_avg_ir": None,
        }

    chem = cfg.CHEMISTRY[cfg.DEFAULT_CHEMISTRY]
    sag_floor = cfg.PACK_NOMINAL_V * (1.0 - cfg.SAG_FLOOR_FRACTION)
    projected = served.get("projected_T_C")
    sag = served.get("v_sag_V")
    critical = served[served["priority"] == "Critical"]

    return {
        "thermal_stress_incidents": int((projected > chem["T_derate_from_C"]).sum())
        if projected is not None
        else 0,
        "voltage_collapse_incidents": int((sag > sag_floor).sum())
        if sag is not None
        else 0,
        "critical_avg_soh": _num(critical["SoH"].mean()) if len(critical) else None,
        "critical_avg_ir": _num(critical["R_int_mOhm"].mean())
        if len(critical)
        else None,
    }


# --------------------------------------------------------------------------
# Rows
# --------------------------------------------------------------------------

_MISSION_FIELDS = (
    "vehicle_type",
    "load_category",
    "range_km",
    "arrival_time",
    "arrival_order",
    "W_max_min",
    "mis_severity",
    "mis_I_peak_A",
    "mis_duration_h",
    "mis_E_required_kWh",
)


def _assignment_rows(assign: pd.DataFrame, missions: pd.DataFrame) -> list[dict]:
    extras = [c for c in _MISSION_FIELDS if c in missions.columns]
    merged = assign.merge(
        missions[["vehicle_id", *extras]], on="vehicle_id", how="left"
    )
    merged = merged.rename(
        columns={
            "mis_severity": "severity",
            "mis_I_peak_A": "I_peak_A",
            "mis_duration_h": "duration_h",
            "mis_E_required_kWh": "E_mission_kWh",
        }
    )
    return _records(merged)


_FLEET_FIELDS = (
    "battery_id",
    "chemistry",
    "V_nom",
    "Ah_rated",
    "SoC",
    "SoH",
    "T",
    "T_24h_max",
    "R_int_mOhm",
    "dV_cell_mV",
    "cycle_count",
    "age_years",
    "E_avail_kWh",
    "station_status",
    "sf_status",
    "sf_reasons",
    "sf_trusted",
    "sf_BSS",
    "sf_s_capacity",
    "sf_s_power",
    "sf_s_balance",
    "sf_s_thermal",
    "phys_E_nominal_kWh",
    "phys_E_ceiling_kWh",
    "phys_E_usable_kWh",
    "phys_E_deliverable_kWh",
    "phys_imbalance_derate",
    "phys_energy_residual",
    "phys_energy_drift",
    "phys_energy_impossible",
    "phys_thermal_margin_C",
    "phys_thermal_excursion_C",
    "phys_thermal_history_fault",
    "phys_SoH_expected",
    "phys_SoH_residual",
    "phys_aging_inconsistent",
    "phys_rul_cycles",
    "phys_R_per_cell_mOhm",
    "phys_series_cells",
    "phys_station_blocked",
)


def _fleet_rows(packs: pd.DataFrame, proposed: pd.DataFrame) -> list[dict]:
    cols = [c for c in _FLEET_FIELDS if c in packs.columns]
    out = packs[cols].copy()
    out.insert(1, "slot", range(len(out)))

    served = proposed[proposed["served"]]
    assigned = dict(zip(served["battery_id"], served["vehicle_id"]))
    priority = dict(zip(served["battery_id"], served["priority"]))
    out["assigned_vehicle_id"] = out["battery_id"].map(assigned)
    out["priority"] = out["battery_id"].map(priority)

    # Legacy aliases so existing panels keep working unchanged.
    out["status"] = out["sf_status"]
    out["BSS"] = out["sf_BSS"]
    out["quarantine_reason"] = out["sf_reasons"].replace("", None)
    return _records(out)


# --------------------------------------------------------------------------
# Time factor
# --------------------------------------------------------------------------


def _timeline_block(
    packs: pd.DataFrame,
    missions: pd.DataFrame,
    proposed: pd.DataFrame,
    baseline: pd.DataFrame,
) -> dict:
    """Arrival-ordered series: what each policy spends as the day proceeds.

    The dataset's requests span a real morning, and order is the one thing the
    baseline is required to respect. Two effects only show up along this axis:
    the quality a policy hands out drifts as stock is consumed, and the packs
    able to serve the hardest mission are finite and can be spent early.
    """
    order = (
        missions.sort_values("arrival_order")
        if "arrival_order" in missions.columns
        else missions
    )
    sequence = order["vehicle_id"].tolist()

    hardest = float(missions["mis_E_with_reserve_kWh"].max())
    premium = set(packs.loc[packs["phys_E_deliverable_kWh"] >= hardest, "battery_id"])

    series: dict[str, list] = {}
    for label, frame in (("Proposed", proposed), ("HSF", baseline)):
        by_vehicle = frame.set_index("vehicle_id")
        remaining = len(premium)
        rows = []
        for step, vid in enumerate(sequence):
            row = by_vehicle.loc[vid] if vid in by_vehicle.index else None
            served = bool(row["served"]) if row is not None else False
            bid = row["battery_id"] if row is not None and served else None
            if bid in premium:
                remaining -= 1
            rows.append(
                {
                    "step": step,
                    "vehicle_id": vid,
                    "served": served,
                    "battery_id": bid,
                    "SoC": _num(row["SoC"]) if row is not None else None,
                    "SoH": _num(row["SoH"]) if row is not None else None,
                    "E_deliverable_kWh": _num(row["E_deliverable_kWh"])
                    if row is not None
                    else None,
                    "energy_margin_kWh": _num(row["energy_margin_kWh"])
                    if row is not None
                    else None,
                    "premium_remaining": remaining,
                }
            )
        series[label] = rows

    return {
        "arrival_first": str(order["arrival_time"].iloc[0])
        if "arrival_time" in order.columns
        else None,
        "arrival_last": str(order["arrival_time"].iloc[-1])
        if "arrival_time" in order.columns
        else None,
        "premium_pack_count": len(premium),
        "premium_threshold_kWh": hardest,
        "requests": [
            {
                "vehicle_id": r["vehicle_id"],
                "step": i,
                "arrival_time": str(r["arrival_time"]) if "arrival_time" in order.columns else None,
                "priority": r["priority"],
                "wait_budget_min": _num(r.get("mis_wait_budget_min")),
                "severity": _num(r.get("mis_severity")),
                "E_required_kWh": _num(r.get("mis_E_with_reserve_kWh")),
            }
            for i, (_, r) in enumerate(order.iterrows())
        ],
        "series": series,
        "soc_decay_corr": {
            label: _corr(series[label], "SoC") for label in ("Proposed", "HSF")
        },
    }


def _corr(rows: list[dict], field: str) -> float | None:
    xs = [r["step"] for r in rows if r.get(field) is not None]
    ys = [r[field] for r in rows if r.get(field) is not None]
    if len(xs) < 3:
        return None
    return round(float(np.corrcoef(xs, ys)[0, 1]), 4)


# --------------------------------------------------------------------------


def _num(value: Any) -> Any:
    """JSON-safe scalar: NaN and numpy types become null / plain Python."""
    if value is None:
        return None
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        return value
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value)
    return value


def _records(df: pd.DataFrame) -> list[dict]:
    return json.loads(df.to_json(orient="records"))
