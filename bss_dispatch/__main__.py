"""Entrypoint: python -m bss_dispatch — 5-stage BSS pipeline."""

from __future__ import annotations

import argparse
from pathlib import Path

from .allocate import run_hsf_dispatch, run_proposed_global_optimization_dispatch
from .classify import classify_battery_health
from . import config as cfg
from .data import load_measured
from .export_results import write_run_result
from .integrity import run_integrity_prescreen
from .metrics import (
    classification_summary,
    compare_policies,
    format_metrics_table,
    write_metrics,
)
from .plots import generate_diagnostic_plots
from .score import compute_battery_suitability_score
from .twists import boost_priority_near_defection, describe_twist_hooks


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="BSS 5-stage dispatch simulation")
    parser.add_argument("--batteries", type=str, default=None, help="Path to batteries CSV")
    parser.add_argument("--vehicles", type=str, default=None, help="Path to vehicles CSV")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cfg.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    cfg.DATA_DIR.mkdir(parents=True, exist_ok=True)

    if (args.batteries is None) ^ (args.vehicles is None):
        raise SystemExit(
            "Provide both --batteries and --vehicles, or neither to use the "
            "default CSVs in data/."
        )

    try:
        batteries, vehicles, source = load_measured(args.batteries, args.vehicles)
    except FileNotFoundError as exc:
        raise SystemExit(str(exc)) from exc
    bat_name = Path(args.batteries).name if args.batteries else None
    veh_name = Path(args.vehicles).name if args.vehicles else None

    print(f"Data source: {source}")
    if bat_name or veh_name:
        print(f"Files: batteries={bat_name} | vehicles={veh_name}")
    print(f"Batteries: {len(batteries)} | Vehicles: {len(vehicles)}")

    # Stage 1 — integrity pre-screen
    batteries = run_integrity_prescreen(batteries)
    skipped = batteries.attrs.get("integrity_skipped", [])
    if skipped:
        print(f"Stage 1 skipped checks (missing columns): {', '.join(skipped)}")
    n_iq = int(batteries["integrity_quarantine"].sum())
    n_recal = int(batteries["recalibrate_flag"].sum())
    print(f"Stage 1: integrity quarantine={n_iq} | recalibrate flags={n_recal}")

    # Stage 2 — safety gating
    batteries = classify_battery_health(batteries)

    # Stage 3 — MAUT + TOPSIS
    batteries = compute_battery_suitability_score(batteries)

    class_summary = classification_summary(batteries)
    print("\n--- Classification (Stage 2) ---")
    for status, count in class_summary["counts"].items():
        pct = class_summary["pct"][status]
        print(f"  {status}: {count} ({pct:.1f}%)")

    # Stage 5 Twist C (optional) before matching
    if cfg.TWIST_DEFECTION_ENABLED:
        vehicles = boost_priority_near_defection(vehicles)
        print(
            f"Stage 5 Twist C: defection boost enabled "
            f"(factor={cfg.TWIST_DEFECTION_FACTOR})"
        )
    else:
        vehicles = vehicles.copy()
        vehicles["priority_weight"] = vehicles["priority"].map(cfg.PRIORITY_WEIGHTS)

    twist_hooks = describe_twist_hooks()
    print(f"Twist hooks: {twist_hooks}")

    # Stage 4 — bipartite matching (+ Stage 5 joule term inside utility)
    proposed = run_proposed_global_optimization_dispatch(batteries, vehicles)
    hsf = run_hsf_dispatch(batteries, vehicles)

    comparison = compare_policies(proposed, hsf)
    print("\n--- Mandatory Metrics ---")
    print(format_metrics_table(comparison))

    prop = comparison["Proposed"]
    hsf_m = comparison["HSF"]
    print("\n--- Incident Proxies ---")
    print(
        f"  Thermal stress: Proposed={prop['thermal_stress_incidents']} | "
        f"HSF={hsf_m['thermal_stress_incidents']}"
    )
    print(
        f"  Voltage collapse: Proposed={prop['voltage_collapse_incidents']} | "
        f"HSF={hsf_m['voltage_collapse_incidents']}"
    )
    print(
        f"  Critical avg SoH: Proposed={prop['critical_avg_soh']:.1f}% | "
        f"HSF={hsf_m['critical_avg_soh']:.1f}%"
    )
    print(
        f"  Critical avg IR: Proposed={prop['critical_avg_ir']:.1f} mOhm | "
        f"HSF={hsf_m['critical_avg_ir']:.1f} mOhm"
    )

    usable = batteries[batteries["status"] != cfg.STATUS_QUARANTINE]
    if not usable.empty and usable["T_score"].notna().any():
        print(
            f"\nDual-engine: mean BSS={usable['BSS'].mean():.1f} | "
            f"mean TOPSIS={usable['T_score'].mean():.1f}"
        )

    write_metrics(comparison, class_summary, cfg.METRICS_JSON)
    result_path = write_run_result(
        comparison=comparison,
        class_summary=class_summary,
        proposed=proposed,
        hsf=hsf,
        batteries=batteries,
        source=source,
        batteries_file=bat_name,
        vehicles_file=veh_name,
        n_batteries=len(batteries),
        n_vehicles=len(vehicles),
        twists=twist_hooks,
    )
    plot_path = generate_diagnostic_plots(batteries, proposed, hsf, comparison)
    print(f"\nWrote {cfg.METRICS_JSON}")
    print(f"Wrote {result_path}")
    print(f"Wrote {plot_path}")

    if prop["unsafe_allocations"] != 0:
        raise SystemExit("FAILED: Proposed method allocated quarantined packs.")
    print("\nOK: Proposed unsafe allocations = 0")


if __name__ == "__main__":
    main()
