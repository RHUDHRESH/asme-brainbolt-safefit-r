"""End-to-end SafeFit-R run: audit → gate → score → allocate → verify → compare.

Produces the seven mandatory quantitative outputs for both SafeFit-R and the
Highest-SoC-First baseline, plus the differentiating metrics that expose what
the mandatory set cannot see — chiefly the allocations that satisfy every stated
constraint and still cannot finish the trip.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as cfg
from . import physics, safefit, ui_payload
from .data import load_measured


def solve(
    batteries_path: str | Path | None = None,
    vehicles_path: str | Path | None = None,
) -> tuple[dict, dict]:
    """Run the pipeline, returning (result, frames).

    ``frames`` carries the solved DataFrames so the dashboard payload can be
    built from the same objects the metrics were computed from — there is no
    second path that could disagree.
    """
    batteries, vehicles, source = load_measured(batteries_path, vehicles_path)

    packs = physics.derive_pack_physics(batteries)
    packs = safefit.apply_safety_gate(packs)
    packs = safefit.compute_geometric_bss(packs)

    missions = physics.derive_mission_physics(vehicles)
    missions = _arrival_ordered(missions)

    compat = physics.compatibility_matrix(packs, missions)

    proposed = safefit.allocate_safefit(packs, missions, compat)
    baseline = run_hsf(packs, missions)

    audit = _audit(packs)
    result = {
        "source": source,
        "n_batteries": int(len(packs)),
        "n_vehicles": int(len(missions)),
        "input_hash": _hash_inputs(batteries, vehicles),
        "audit": audit,
        "classification": _classification(packs),
        "metrics": {
            "SafeFit-R": _metrics(proposed, packs, missions),
            "HSF": _metrics(baseline, packs, missions),
        },
        "verification": _verify(proposed, packs, missions),
        "verification_hsf": _verify(baseline, packs, missions),
        "assignments": {
            "SafeFit-R": _records(proposed),
            "HSF": _records(baseline),
        },
    }
    frames = {
        "packs": packs,
        "missions": missions,
        "proposed": proposed,
        "baseline": baseline,
    }
    return result, frames


def run(
    batteries_path: str | Path | None = None,
    vehicles_path: str | Path | None = None,
) -> dict:
    """Solve and return the result document only."""
    return solve(batteries_path, vehicles_path)[0]


def _arrival_ordered(missions: pd.DataFrame) -> pd.DataFrame:
    """Freeze the arrival order the baseline is required to process in."""
    if "arrival_order" in missions.columns:
        return missions.sort_values("arrival_order").reset_index(drop=True)
    if "arrival_time" in missions.columns:
        keyed = pd.to_datetime(missions["arrival_time"], errors="coerce")
        return missions.assign(_k=keyed).sort_values("_k").drop(columns="_k").reset_index(drop=True)
    return missions.reset_index(drop=True)


def run_hsf(packs: pd.DataFrame, missions: pd.DataFrame) -> pd.DataFrame:
    """The fixed baseline, exactly as the brief defines it.

    Arrival order, highest available SoC meeting the minimum, one use per pack.
    No safety filter — adding one here would flatter the baseline and invalidate
    the comparison the brief asks for.
    """
    order = packs.sort_values("SoC", ascending=False)
    used: set = set()
    rows: list[dict] = []

    for i in range(len(missions)):
        mission = missions.iloc[i]
        pick = None
        for j in range(len(order)):
            pack = order.iloc[j]
            if pack["battery_id"] in used:
                continue
            if float(pack["SoC"]) >= float(mission["min_SoC"]):
                pick = pack
                used.add(pack["battery_id"])
                break

        if pick is None:
            rows.append(_hsf_unserved(mission))
        else:
            j_global = int(packs.index[packs["battery_id"] == pick["battery_id"]][0])
            rows.append(_hsf_served(mission, pick, j_global))
    return pd.DataFrame(rows)


def _hsf_served(mission: pd.Series, pack: pd.Series, j: int) -> dict:
    e_deliv = float(pack["phys_E_deliverable_kWh"])
    e_need = float(mission["mis_E_with_reserve_kWh"])
    # Same physics the proposed policy is held to, applied to whatever the
    # baseline picked. The baseline is free to violate these; that is the point.
    r_ohm = float(pack["phys_R_ohm"])
    v_sag = float(mission["mis_I_peak_A"]) * r_ohm
    joule_rise = (
        (float(mission["mis_I_avg_A"]) ** 2)
        * r_ohm
        * float(mission["mis_duration_h"])
        * 3600.0
        * cfg.JOULE_RETENTION
    ) / cfg.PACK_THERMAL_CAPACITY_J_PER_K
    return {
        "v_sag_V": v_sag,
        "joule_rise_C": joule_rise,
        "projected_T_C": float(pack["T"]) + joule_rise,
        "policy": "HSF",
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
        "E_deliverable_kWh": e_deliv,
        "E_required_kWh": e_need,
        "energy_margin_kWh": e_deliv - e_need,
        "unserved_reason": None,
    }


def _hsf_unserved(mission: pd.Series) -> dict:
    return {
        "policy": "HSF",
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
        "unserved_reason": "no_pack_meets_min_SoC",
    }


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------


def _metrics(assign: pd.DataFrame, packs: pd.DataFrame, missions: pd.DataFrame) -> dict:
    served = assign[assign["served"]]
    high = assign[assign["priority"].isin(cfg.HIGH_DEMAND_PRIORITIES)]
    high_served = high[high["served"]]

    quarantined = set(
        packs.loc[packs["sf_status"] == cfg.STATUS_QUARANTINE, "battery_id"]
    )
    station_blocked = set(
        packs.loc[packs["phys_station_blocked"], "battery_id"]
    )
    allocated = set(served["battery_id"])

    # The differentiating metric: allocations that clear every stated constraint
    # and still cannot deliver the mission's energy.
    energy_short = served[served["energy_margin_kWh"] < 0]

    oversupply = (served["SoC"] - served["min_SoC"]).mean() if len(served) else np.nan

    return {
        # --- the seven mandatory outputs ---
        "served": int(len(served)),
        "unserved": int(len(assign) - len(served)),
        "high_critical_served_pct": (
            100.0 * len(high_served) / len(high) if len(high) else 100.0
        ),
        "unsafe_allocations": int(len(allocated & quarantined)),
        "avg_soh_allocated": float(served["SoH"].mean()) if len(served) else np.nan,
        "avg_bss_allocated": float(served["BSS"].mean()) if len(served) else np.nan,
        "avg_wait_min": None,  # queueing not modelled; reported as absent, not zero
        # --- differentiating ---
        "station_quarantine_allocations": int(len(allocated & station_blocked)),
        "energy_infeasible_allocations": int(len(energy_short)),
        "energy_shortfall_total_kWh": float(-energy_short["energy_margin_kWh"].sum())
        if len(energy_short)
        else 0.0,
        "worst_energy_shortfall_kWh": float(-energy_short["energy_margin_kWh"].min())
        if len(energy_short)
        else 0.0,
        "untrusted_allocations": int((~served["trusted"].astype(bool)).sum())
        if len(served)
        else 0,
        "avg_soc_oversupply_pts": float(oversupply) if len(served) else None,
        # Fleet capability consumed to buy that service. A lower average SoH
        # here is the intended result, not a regression: identical service
        # bought with less of the fleet's remaining life is the whole claim.
        "deliverable_energy_consumed_kWh": float(served["E_deliverable_kWh"].sum())
        if len(served)
        else 0.0,
        "avg_energy_margin_kWh": float(served["energy_margin_kWh"].mean())
        if len(served)
        else None,
        "premium_packs_consumed": _premium_consumed(served, packs, missions),
        "degraded_utilisation_pct": _degraded_share(served, packs),
    }


def _premium_consumed(served: pd.DataFrame, packs: pd.DataFrame, missions: pd.DataFrame) -> int:
    """Packs able to serve the hardest mission that were spent on easier ones."""
    if not len(served):
        return 0
    hardest = float(missions["mis_E_with_reserve_kWh"].max())
    premium = set(
        packs.loc[packs["phys_E_deliverable_kWh"] >= hardest, "battery_id"]
    )
    spent_on_easy = served[
        served["battery_id"].isin(premium)
        & (served["E_required_kWh"] < hardest * 0.75)
    ]
    return int(len(spent_on_easy))


def _degraded_share(served: pd.DataFrame, packs: pd.DataFrame) -> float:
    """Share of allocations drawn from the Degraded-but-Usable tier."""
    if not len(served):
        return 0.0
    degraded = set(packs.loc[packs["sf_status"] == cfg.STATUS_DEGRADED, "battery_id"])
    return 100.0 * len(set(served["battery_id"]) & degraded) / len(served)


def _classification(packs: pd.DataFrame) -> dict:
    counts = packs["sf_status"].value_counts().to_dict()
    reasons: dict[str, int] = {}
    for entry in packs.loc[packs["sf_reasons"] != "", "sf_reasons"]:
        for reason in str(entry).split(";"):
            reasons[reason] = reasons.get(reason, 0) + 1
    return {
        "counts": {k: int(v) for k, v in counts.items()},
        "reason_histogram": dict(sorted(reasons.items(), key=lambda kv: -kv[1])),
        "untrusted_packs": int((~packs["sf_trusted"]).sum()),
    }


def _audit(packs: pd.DataFrame) -> dict:
    """Telemetry findings, each traceable to named pack IDs."""

    def ids(mask) -> list[str]:
        return packs.loc[mask, "battery_id"].tolist()

    return {
        "station_declared_quarantine": ids(packs["phys_station_blocked"]),
        "energy_exceeds_physical_ceiling": ids(packs["phys_energy_impossible"]),
        "temperature_exceeds_24h_maximum": ids(packs["phys_thermal_history_fault"]),
        "reported_energy_drift": ids(packs["phys_energy_drift"]),
        "soh_inconsistent_with_history": ids(packs["phys_aging_inconsistent"]),
    }


# --------------------------------------------------------------------------
# Verification — the brief's five rules, recomputed from the assignment table
# --------------------------------------------------------------------------


def _verify(assign: pd.DataFrame, packs: pd.DataFrame, missions: pd.DataFrame) -> dict:
    served = assign[assign["served"]]
    quarantined = set(
        packs.loc[packs["sf_status"] == cfg.STATUS_QUARANTINE, "battery_id"]
    )
    bat_counts = served["battery_id"].value_counts()
    veh_counts = served["vehicle_id"].value_counts()
    soc_ok = (served["SoC"] >= served["min_SoC"]).all() if len(served) else True

    checks = {
        "no_unsafe_allocated": {
            "pass": len(set(served["battery_id"]) & quarantined) == 0,
            "checked": int(len(served)),
            "violations": sorted(set(served["battery_id"]) & quarantined),
        },
        "no_battery_reused": {
            "pass": bool((bat_counts <= 1).all()) if len(bat_counts) else True,
            "checked": int(len(served)),
            "violations": bat_counts[bat_counts > 1].index.tolist(),
        },
        "no_vehicle_double_served": {
            "pass": bool((veh_counts <= 1).all()) if len(veh_counts) else True,
            "checked": int(len(assign)),
            "violations": veh_counts[veh_counts > 1].index.tolist(),
        },
        "min_soc_satisfied": {
            "pass": bool(soc_ok),
            "checked": int(len(served)),
            "violations": served.loc[
                served["SoC"] < served["min_SoC"], "vehicle_id"
            ].tolist(),
        },
        "every_request_accounted": {
            "pass": len(assign) == len(missions)
            and assign["vehicle_id"].nunique() == len(missions),
            "checked": int(len(missions)),
            "violations": [],
        },
    }
    checks["all_pass"] = all(c["pass"] for c in checks.values() if isinstance(c, dict))
    return checks


def _records(df: pd.DataFrame) -> list[dict]:
    return json.loads(df.to_json(orient="records"))


def _hash_inputs(batteries: pd.DataFrame, vehicles: pd.DataFrame) -> str:
    h = hashlib.sha256()
    h.update(pd.util.hash_pandas_object(batteries, index=False).values.tobytes())
    h.update(pd.util.hash_pandas_object(vehicles, index=False).values.tobytes())
    return h.hexdigest()[:16]


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        prog="python -m bss_dispatch.safefit_run",
        description="SafeFit-R battery classification and allocation (ASME Problem 1).",
    )
    parser.add_argument("--batteries", help="battery fleet CSV")
    parser.add_argument("--vehicles", help="vehicle demand CSV")
    parser.add_argument(
        "--outdir", default=str(cfg.OUTPUT_DIR), help="directory for result artefacts"
    )
    args = parser.parse_args(argv)

    result, frames = solve(args.batteries, args.vehicles)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    (outdir / "safefit_result.json").write_text(
        json.dumps(result, indent=2, default=str), encoding="utf-8"
    )
    # The dashboard reads exactly one file; write it from the same frames.
    payload = ui_payload.build_payload(
        frames["packs"],
        frames["missions"],
        frames["proposed"],
        frames["baseline"],
        result=result,
        batteries_file=Path(args.batteries).name if args.batteries else None,
        vehicles_file=Path(args.vehicles).name if args.vehicles else None,
    )
    (outdir / "run_result.json").write_text(
        json.dumps(payload, indent=2, default=str), encoding="utf-8"
    )
    # Mandatory deliverable: one table carrying classifications and assignments.
    pd.DataFrame(result["assignments"]["SafeFit-R"]).to_csv(
        outdir / "safefit_assignments.csv", index=False
    )
    pd.DataFrame(result["assignments"]["HSF"]).to_csv(
        outdir / "hsf_assignments.csv", index=False
    )

    sf = result["metrics"]["SafeFit-R"]
    hsf = result["metrics"]["HSF"]
    verdict = "PASS" if result["verification"]["all_pass"] else "FAIL"

    print(f"input hash {result['input_hash']}  |  verification {verdict}")
    print(f"{'metric':38s}{'SafeFit-R':>14s}{'HSF':>14s}")
    for key in (
        "served",
        "unserved",
        "high_critical_served_pct",
        "unsafe_allocations",
        "avg_soh_allocated",
        "avg_bss_allocated",
        "energy_infeasible_allocations",
        "deliverable_energy_consumed_kWh",
        "avg_soc_oversupply_pts",
    ):
        left, right = sf.get(key), hsf.get(key)
        fmt = lambda v: f"{v:14.2f}" if isinstance(v, float) else f"{str(v):>14s}"
        print(f"{key:38s}{fmt(left)}{fmt(right)}")
    print(f"\nwrote {outdir / 'safefit_result.json'}")
    print(f"wrote {outdir / 'safefit_assignments.csv'}")
    return 0 if result["verification"]["all_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
