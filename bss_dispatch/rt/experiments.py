"""Experiment harness: ablation across policies, regimes and Monte Carlo.

Three studies, each answering a question a judge will actually ask.

  Ablation      Turn one literature component on at a time, holding everything
                else fixed, and report what each is worth. Five policies from
                the mandated baseline up to the full method.

  Regimes       Nominal reproduces the competition dataset exactly as issued.
                Stress is a declared synthetic test at the demand intensity the
                Tier-S papers study, on a smaller rack with a tighter grid --
                because the issued dataset is over-provisioned (200 packs for
                50 requests) and cannot exercise an inventory policy.

  Monte Carlo   The same policies against many sampled demand futures, so the
                claim is a distribution and not a single lucky day. Reports
                mean, spread and CVaR of the tail.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pandas as pd

from ..classify import classify_battery_health
from ..data import load_csv
from ..integrity import run_integrity_prescreen
from ..score import compute_battery_suitability_score
from . import config_rt as rt
from . import simulator as sim
from . import uncertainty as unc


def prepare_fleet(batteries: pd.DataFrame) -> pd.DataFrame:
    """Run the unchanged v1 health core: integrity -> gate -> score."""
    out = run_integrity_prescreen(batteries)
    out = classify_battery_health(out)
    return compute_battery_suitability_score(out)


def load_competition_data(
    batteries_path: str | Path,
    vehicles_path: str | Path,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    loaded = load_csv(Path(batteries_path), Path(vehicles_path), require=True)
    assert loaded is not None
    batteries, vehicles = loaded
    return prepare_fleet(batteries), vehicles


# --------------------------------------------------------------- ablation --
def run_ablation(
    batteries: pd.DataFrame,
    vehicles: pd.DataFrame,
    regime: str = rt.REGIME_NOMINAL,
    verbose: bool = True,
) -> dict:
    """Run every policy on one regime and return comparable summaries."""
    profile = unc.fit_demand_profile(vehicles)

    if regime == rt.REGIME_STRESS:
        demand = unc.sample_requests(
            profile,
            demand_multiplier=rt.STRESS_DEMAND_MULTIPLIER,
            seed=rt.RT_RANDOM_SEED,
            prefix="STR",
        )
        station_cfg = sim.StationConfig(
            n_bays=rt.STRESS_N_BAYS,
            grid_cap_kw=rt.STRESS_P_GRID_MAX_KW,
            resident_packs=rt.STRESS_RESIDENT_PACKS,
            label=regime,
        )
        multiplier = rt.STRESS_DEMAND_MULTIPLIER
    else:
        demand = vehicles
        station_cfg = sim.StationConfig(label=regime)
        multiplier = 1.0

    bank = unc.build_scenario_bank(
        profile, n_scenarios=rt.N_SCENARIOS, demand_multiplier=multiplier
    )
    oracle = unc.ReserveOracle(bank=bank)

    results: dict[str, dict] = {}
    runs: dict[str, sim.RunResult] = {}
    for policy in sim.POLICIES:
        t0 = time.perf_counter()
        result = sim.simulate(
            policy=policy,
            batteries=batteries,
            vehicles=demand,
            oracle=oracle,
            station_cfg=station_cfg,
            regime=regime,
        )
        elapsed = time.perf_counter() - t0
        summary = result.summary()
        summary["runtime_s"] = round(elapsed, 2)
        results[policy.key] = summary
        runs[policy.key] = result
        if verbose:
            print(
                f"  [{regime}] {policy.short:<8} "
                f"served {summary['served']}/{summary['total_requests']:<4} "
                f"prem {summary['premium_service_rate_pct']:>6.1f}%  "
                f"unsafe {summary['unsafe_allocations']:<3} "
                f"elec Rs{summary['mkt_total_electricity_inr']:>8.0f}  "
                f"deg Rs{summary['fleet_degradation_cost_inr']:>7.0f}  "
                f"surplus Rs{summary['economic_surplus_inr']:>8.0f}  "
                f"({elapsed:.1f}s)"
            )

    return {
        "regime": regime,
        "demand_multiplier": multiplier,
        "n_requests": int(len(demand)),
        "station": asdict(station_cfg),
        "policies": results,
        "_runs": runs,
    }


# ------------------------------------------------------------ monte carlo --
def run_monte_carlo(
    batteries: pd.DataFrame,
    vehicles: pd.DataFrame,
    policy_keys: tuple[str, ...] = ("hsf", "v1_online", "market", "full"),
    n_replications: int = 40,
    regime: str = rt.REGIME_STRESS,
    verbose: bool = True,
) -> dict:
    """Replicate each policy against independently sampled demand futures.

    Every policy faces the identical set of realisations -- same seeds, same
    arrival paths -- so the comparison is paired and the spread reported is
    policy risk, not sampling noise.
    """
    profile = unc.fit_demand_profile(vehicles)
    multiplier = (
        rt.STRESS_DEMAND_MULTIPLIER if regime == rt.REGIME_STRESS else 1.0
    )
    station_cfg = (
        sim.StationConfig(
            n_bays=rt.STRESS_N_BAYS,
            grid_cap_kw=rt.STRESS_P_GRID_MAX_KW,
            resident_packs=rt.STRESS_RESIDENT_PACKS,
            label=regime,
        )
        if regime == rt.REGIME_STRESS
        else sim.StationConfig(label=regime)
    )

    bank = unc.build_scenario_bank(
        profile, n_scenarios=rt.N_SCENARIOS, demand_multiplier=multiplier
    )
    oracle = unc.ReserveOracle(bank=bank)

    per_policy: dict[str, list[dict]] = {k: [] for k in policy_keys}
    for rep in range(n_replications):
        seed = rt.RT_RANDOM_SEED + 1000 + rep
        demand = unc.sample_requests(
            profile, demand_multiplier=multiplier, seed=seed, prefix=f"MC{rep:02d}"
        )
        if demand.empty:
            continue
        for key in policy_keys:
            result = sim.simulate(
                policy=sim.POLICY_BY_KEY[key],
                batteries=batteries,
                vehicles=demand,
                oracle=oracle,
                station_cfg=station_cfg,
                regime=regime,
                seed=seed,
                collect_traces=False,
            )
            per_policy[key].append(result.summary())
        if verbose and (rep + 1) % 5 == 0:
            print(f"  monte carlo: {rep + 1}/{n_replications} replications")

    stats: dict[str, dict] = {}
    for key, rows in per_policy.items():
        if not rows:
            continue
        frame = pd.DataFrame(rows)
        premium_unserved = frame["premium_unserved"].to_numpy(dtype=float)
        stats[key] = {
            "policy_label": sim.POLICY_BY_KEY[key].label,
            "n_replications": len(rows),
            "service_rate_mean": round(float(frame["service_rate_pct"].mean()), 2),
            "service_rate_std": round(float(frame["service_rate_pct"].std(ddof=1)), 2),
            "service_rate_min": round(float(frame["service_rate_pct"].min()), 2),
            "premium_service_mean": round(
                float(frame["premium_service_rate_pct"].mean()), 2
            ),
            "premium_service_std": round(
                float(frame["premium_service_rate_pct"].std(ddof=1)), 2
            ),
            "premium_unserved_mean": round(float(premium_unserved.mean()), 3),
            "premium_unserved_cvar95": round(float(unc.cvar(premium_unserved)), 3),
            "premium_unserved_worst": int(premium_unserved.max()),
            "unsafe_mean": round(float(frame["unsafe_allocations"].mean()), 3),
            "electricity_mean_inr": round(
                float(frame["mkt_total_electricity_inr"].mean()), 2
            ),
            "degradation_mean_inr": round(
                float(frame["fleet_degradation_cost_inr"].mean()), 2
            ),
            "surplus_mean_inr": round(float(frame["economic_surplus_inr"].mean()), 2),
            "surplus_std_inr": round(
                float(frame["economic_surplus_inr"].std(ddof=1)), 2
            ),
            "surplus_cvar95_loss_inr": round(
                float(-unc.cvar(-frame["economic_surplus_inr"].to_numpy(dtype=float))), 2
            ),
            "avg_wait_mean_min": round(float(frame["avg_wait_min"].mean()), 3),
        }

    return {
        "regime": regime,
        "demand_multiplier": multiplier,
        "n_replications": n_replications,
        "policies": stats,
        "_raw": {k: v for k, v in per_policy.items()},
    }


# ------------------------------------------------------------------ main --
def _strip_runs(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if not k.startswith("_")}


def run_all(
    batteries_path: str | Path,
    vehicles_path: str | Path,
    n_replications: int = 40,
    verbose: bool = True,
) -> dict:
    rt.ensure_dirs()
    batteries, vehicles = load_competition_data(batteries_path, vehicles_path)

    if verbose:
        counts = batteries["status"].value_counts().to_dict()
        print(f"Fleet: {len(batteries)} packs -> {counts}")
        print(f"Demand: {len(vehicles)} requests")
        print("\n--- Ablation: nominal regime (dataset as issued) ---")

    nominal = run_ablation(batteries, vehicles, rt.REGIME_NOMINAL, verbose)

    if verbose:
        print("\n--- Ablation: stress regime (declared synthetic) ---")
    stress = run_ablation(batteries, vehicles, rt.REGIME_STRESS, verbose)

    if verbose:
        print(f"\n--- Monte Carlo: {n_replications} demand futures (stress) ---")
    mc = run_monte_carlo(
        batteries,
        vehicles,
        n_replications=n_replications,
        regime=rt.REGIME_STRESS,
        verbose=verbose,
    )

    payload = {
        "config": rt.as_dict(),
        "fleet": {
            "n_packs": int(len(batteries)),
            "classification": batteries["status"].value_counts().to_dict(),
            "quarantine_reasons": batteries.loc[
                batteries["status"] == "Unsafe / Quarantine", "quarantine_reason"
            ]
            .value_counts()
            .to_dict(),
        },
        "ablation": {
            rt.REGIME_NOMINAL: _strip_runs(nominal),
            rt.REGIME_STRESS: _strip_runs(stress),
        },
        "monte_carlo": _strip_runs(mc),
    }

    rt.RT_RESULTS_JSON.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    if verbose:
        print(f"\nWrote {rt.RT_RESULTS_JSON}")

    return {
        "payload": payload,
        "nominal": nominal,
        "stress": stress,
        "monte_carlo": mc,
        "batteries": batteries,
        "vehicles": vehicles,
    }
