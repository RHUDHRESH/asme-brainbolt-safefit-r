"""Entrypoint: python -m bss_dispatch.rt — full v2 study + figures.

    python -m bss_dispatch.rt --batteries <fleet.csv> --vehicles <demand.csv>

Runs the ablation on both regimes, the Monte Carlo robustness study, and
renders every figure used in the deck. Deterministic: same inputs, same
outputs, seeded at `config_rt.RT_RANDOM_SEED`.
"""

from __future__ import annotations

import argparse

from . import config_rt as rt
from . import experiments, figures


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="BSS real-time (v2) operating study")
    parser.add_argument("--batteries", required=True, help="battery fleet CSV")
    parser.add_argument("--vehicles", required=True, help="vehicle demand CSV")
    parser.add_argument(
        "--replications", type=int, default=30,
        help="Monte Carlo demand futures (default 30)",
    )
    parser.add_argument("--no-figures", action="store_true", help="skip figure rendering")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    study = experiments.run_all(
        args.batteries, args.vehicles, n_replications=args.replications
    )

    if not args.no_figures:
        print("\n--- Rendering figures ---")
        paths = figures.generate_all(study)
        for name, path in paths.items():
            print(f"  {name:<18} {path}")

    nominal = study["payload"]["ablation"]["nominal"]["policies"]
    stress = study["payload"]["ablation"]["stress"]["policies"]
    print("\n--- Headline ---")
    print(
        f"  Nominal  · degradation  v1 ₹{nominal['v1_online']['degradation_inr']:,.0f}"
        f"  ->  FULL ₹{nominal['full']['degradation_inr']:,.0f}"
    )
    print(
        f"  Stress   · premium served  v1 {stress['v1_online']['premium_service_rate_pct']:.1f}%"
        f"  ->  FULL {stress['full']['premium_service_rate_pct']:.1f}%"
    )
    print(
        f"  Safety   · unsafe allocations  HSF {stress['hsf']['unsafe_allocations']}"
        f"  ->  FULL {stress['full']['unsafe_allocations']}"
    )
    print(f"\n  Results: {rt.RT_RESULTS_JSON}")
    print(f"  Figures: {rt.FIGURE_DIR}")


if __name__ == "__main__":
    main()
