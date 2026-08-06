"""Closed-loop rolling-horizon station simulator.

One slot of station time, in the order the physical station experiences it:

    1  packs whose trips ended come back, depleted and slightly older
    2  new riders arrive and join the queue
    3  riders past their wait tolerance walk out and are booked as lost
    4  the scenario bank is read: reserve level and shadow price for this slot
    5  the allocator matches the queue against held inventory
    6  swaps execute; packs leave, returns are booked
    7  the charging layer buys power for the bays it wants
    8  the meter, the ageing model and the state ledger are all updated

Everything the policies differ on is a keyword on `PolicySpec`, so the five
configurations below share one code path and any difference in their results is
attributable to the named component and nothing else.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .. import config as cfg
from . import allocator as alloc
from . import charging
from . import config_rt as rt
from . import degradation as deg
from . import market
from . import uncertainty as unc
from .states import CHARGING, IN_SERVICE, Station


@dataclass(frozen=True)
class PolicySpec:
    """A named combination of allocation and charging behaviour."""

    key: str
    label: str
    short: str
    allocator: str            # "hsf" | "greedy" | "hungarian"
    charging: str             # "uncontrolled" | "milp"
    use_reserve: bool = False
    use_defection: bool = False
    health_gated: bool = True
    note: str = ""


POLICIES: tuple[PolicySpec, ...] = (
    PolicySpec(
        key="hsf",
        label="Highest-SoC-First + uncontrolled charging",
        short="HSF",
        allocator="hsf",
        charging="uncontrolled",
        health_gated=False,
        note="Mandated baseline. Sorts on charge, ignores health, charges flat out.",
    ),
    PolicySpec(
        key="greedy",
        label="Health-greedy + uncontrolled charging",
        short="Greedy",
        allocator="greedy",
        charging="uncontrolled",
        note="Full Stage-2 gate, best pack per rider, sequential. No global matching.",
    ),
    PolicySpec(
        key="v1_online",
        label="v1 utility, online (no lookahead)",
        short="v1-RT",
        allocator="hungarian",
        charging="uncontrolled",
        note="v1's priority-weighted Hungarian re-solved every slot. No reserve, no market-aware charging.",
    ),
    PolicySpec(
        key="market",
        label="v1 utility + market/degradation-aware charging",
        short="+Market",
        allocator="hungarian",
        charging="milp",
        note="Adds the Wu-2018 C-rate trade-off and the Sarker-2015 market layer.",
    ),
    PolicySpec(
        key="full",
        label="Proposed: + stochastic reserve + defection ramp",
        short="FULL",
        allocator="hungarian",
        charging="milp",
        use_reserve=True,
        use_defection=True,
        note="Adds scenario-based inventory rationing and continuous priority escalation.",
    ),
)

POLICY_BY_KEY = {p.key: p for p in POLICIES}


@dataclass
class StationConfig:
    """Physical station under test."""

    n_bays: int = rt.N_CHARGER_BAYS
    grid_cap_kw: float = rt.P_GRID_MAX_KW
    resident_packs: int | None = None
    label: str = rt.REGIME_NOMINAL


@dataclass
class SlotTrace:
    slot: int
    clock: str
    queue_len: int
    n_swaps: int
    n_defections: int
    load_kw: float
    price: float
    reserve: int
    shadow_price: float
    premium_available: int
    ready: int
    charging: int
    waiting: int
    in_service: int
    quarantine: int


@dataclass
class RunResult:
    policy: PolicySpec
    regime: str
    served: int
    total_requests: int
    defected: int
    unserved_at_close: int
    unsafe_allocations: int
    premium_served: int
    premium_total: int
    avg_soh_allocated: float
    avg_bss_allocated: float
    avg_wait_min: float
    p95_wait_min: float
    market: dict
    fleet: dict
    economics: dict
    traces: list[SlotTrace] = field(default_factory=list)
    swaps: list = field(default_factory=list)
    alloc_diagnostics: list = field(default_factory=list)

    def summary(self) -> dict:
        return {
            "policy": self.policy.key,
            "policy_label": self.policy.label,
            "regime": self.regime,
            "total_requests": self.total_requests,
            "served": self.served,
            "service_rate_pct": round(
                100.0 * self.served / self.total_requests, 2
            )
            if self.total_requests
            else 0.0,
            "defected": self.defected,
            "unserved_at_close": self.unserved_at_close,
            "unsafe_allocations": self.unsafe_allocations,
            "premium_served": self.premium_served,
            "premium_total": self.premium_total,
            "premium_service_rate_pct": round(
                100.0 * self.premium_served / self.premium_total, 2
            )
            if self.premium_total
            else 100.0,
            "premium_unserved": self.premium_total - self.premium_served,
            "avg_soh_allocated": round(self.avg_soh_allocated, 3),
            "avg_bss_allocated": round(self.avg_bss_allocated, 3),
            "avg_wait_min": round(self.avg_wait_min, 3),
            "p95_wait_min": round(self.p95_wait_min, 3),
            **{f"mkt_{k}": v for k, v in self.market.items()},
            **{f"fleet_{k}": v for k, v in self.fleet.items()},
            **self.economics,
        }


def build_requests(vehicles: pd.DataFrame) -> list[alloc.Request]:
    """Turn a demand table into queue objects with slot-indexed arrivals."""
    requests: list[alloc.Request] = []
    for _, row in vehicles.iterrows():
        if "arrival_slot" in row and pd.notna(row["arrival_slot"]):
            slot = int(row["arrival_slot"])
        elif "arrival_time" in row and pd.notna(row["arrival_time"]):
            stamp = pd.to_datetime(row["arrival_time"], errors="coerce")
            hour = stamp.hour + stamp.minute / 60.0 if pd.notna(stamp) else rt.SIM_START_HOUR
            slot = int(np.floor((hour - rt.SIM_START_HOUR) / rt.SLOT_HOURS))
        else:
            slot = 0
        slot = int(np.clip(slot, 0, rt.N_SLOTS - 1))
        requests.append(
            alloc.Request(
                vehicle_id=str(row["vehicle_id"]),
                priority=str(row["priority"]),
                min_soc=float(row["min_SoC"]),
                range_km=float(row.get("range_km", rt.DEFAULT_RANGE_KM) or rt.DEFAULT_RANGE_KM),
                w_max_min=float(row.get("W_max_min", 0.0) or 0.0),
                arrival_slot=slot,
            )
        )
    return requests


def premium_soc_threshold(vehicles: pd.DataFrame, quantile: float = 0.9) -> float:
    """SoC a pack needs before a premium rider is likely to accept it.

    The 90th percentile of the minimum-SoC demanded by Critical/High requests:
    a pack above it satisfies nine out of ten premium riders, so it is a fair
    definition of "premium-ready" inventory for the reserve to count.
    """
    prem = vehicles[vehicles["priority"].isin(rt.PREMIUM_PRIORITIES)]
    pool = prem["min_SoC"] if not prem.empty else vehicles["min_SoC"]
    if pool.empty:
        return 50.0
    return float(np.quantile(pool.to_numpy(dtype=float), quantile))


def _expected_completions(station: Station, theta: float, window_slots: int) -> float:
    """Safe packs on charge that should cross the premium threshold in time.

    Estimated at 1C, the middle of the menu. It only shifts the reserve by the
    stock the chargers are about to replace, so a mild error here changes how
    much is held back, never whether the safety rule itself holds.
    """
    charging_safe = np.flatnonzero(
        (station.state == CHARGING)
        & (station.status == cfg.STATUS_SAFE)
        & (station.soc < theta)
    )
    if charging_safe.size == 0:
        return 0.0
    reachable = 0
    for idx in charging_safe:
        gain = 100.0 * 1.0 * (window_slots * rt.SLOT_HOURS) * (100.0 / max(station.soh[idx], 1.0))
        if station.soc[idx] + gain >= theta:
            reachable += 1
    return float(reachable)


def simulate(
    policy: PolicySpec,
    batteries: pd.DataFrame,
    vehicles: pd.DataFrame,
    oracle: unc.ReserveOracle | None = None,
    station_cfg: StationConfig | None = None,
    regime: str = rt.REGIME_NOMINAL,
    seed: int = rt.RT_RANDOM_SEED,
    collect_traces: bool = True,
) -> RunResult:
    """Run one policy over one demand realisation."""
    scfg = station_cfg or StationConfig()
    rng = np.random.default_rng(seed)

    packs = batteries
    if scfg.resident_packs is not None and scfg.resident_packs < len(batteries):
        packs = batteries.sample(
            n=scfg.resident_packs, random_state=seed
        ).reset_index(drop=True)

    station = Station(packs=packs, n_bays=scfg.n_bays)
    ledger = market.MarketLedger(base_cap_kw=scfg.grid_cap_kw)

    requests = build_requests(vehicles)
    by_slot: dict[int, list[alloc.Request]] = {}
    for req in requests:
        by_slot.setdefault(req.arrival_slot, []).append(req)

    theta = premium_soc_threshold(vehicles)
    window_slots = max(1, rt.RESERVE_LOOKAHEAD_MIN // rt.SLOT_MINUTES)

    queue: list[alloc.Request] = []
    served: list[alloc.Request] = []
    traces: list[SlotTrace] = []
    diagnostics: list[dict] = []
    unsafe = 0

    for slot in range(rt.N_SLOTS):
        station.process_returns(slot)
        queue.extend(by_slot.get(slot, []))

        before = len(queue)
        queue = alloc.prune_defections(queue, slot)
        newly_defected = before - len(queue)

        for req in queue:
            req.update_wait(slot)

        # --- stochastic layer -------------------------------------------
        reserve = 0
        shadow = 0.0
        premium_available = int(
            np.count_nonzero(
                (station.status == cfg.STATUS_SAFE)
                & (station.state != IN_SERVICE)
                & (station.soc >= theta)
            )
        )
        if oracle is not None:
            completions = _expected_completions(station, theta, window_slots)
            reserve = oracle.reserve_level(slot, completions)
            shadow = oracle.shadow_price_inr(slot, premium_available, completions)

        # --- allocation --------------------------------------------------
        if policy.allocator == "hsf":
            matches = alloc.allocate_hsf(station, queue, slot)
            diag: dict = {"slot": slot, "n_matched": len(matches)}
        elif policy.allocator == "greedy":
            matches = alloc.allocate_greedy(station, queue, slot)
            diag = {"slot": slot, "n_matched": len(matches)}
        else:
            matches, diag = alloc.allocate_hungarian(
                station,
                queue,
                slot,
                reserve_safe=reserve if policy.use_reserve else 0,
                shadow_price_inr=shadow if policy.use_reserve else 0.0,
                theta_premium=theta,
                use_defection=policy.use_defection,
                use_reserve=policy.use_reserve,
            )
            diag = {"slot": slot, **diag}
        diag["reserve"] = reserve
        diag["shadow_price_inr"] = round(shadow, 2)

        # --- execute swaps -------------------------------------------------
        for req, idx in matches:
            if station.status[idx] == cfg.STATUS_QUARANTINE:
                unsafe += 1
            event = station.dispatch(
                idx=idx,
                vehicle_id=req.vehicle_id,
                priority=req.priority,
                range_km=req.range_km,
                wait_min=req.wait_min,
                slot=slot,
                rng=rng,
            )
            req.served_slot = slot
            req.battery_id = event.battery_id
            served.append(req)
        matched_ids = {id(r) for r, _ in matches}
        queue = [r for r in queue if id(r) not in matched_ids]

        # --- charging -------------------------------------------------------
        cap = market.power_cap_kw(slot, scfg.grid_cap_kw)
        if policy.charging == "milp":
            decisions, _info = charging.schedule_milp(
                station,
                slot,
                cap_kw=scfg.grid_cap_kw,
                n_bays=scfg.n_bays,
                shadow_price_inr=shadow,
            )
        else:
            decisions = charging.schedule_uncontrolled(
                station, slot, cap_kw=cap, n_bays=scfg.n_bays
            )

        step = station.apply_charging(decisions, slot, market.price_at_slot(slot))
        if step["load_kw"] > cap + 1e-6:
            raise AssertionError(
                f"slot {slot}: load {step['load_kw']:.2f} kW exceeds cap {cap:.2f} kW"
            )
        unconstrained = None
        if market.in_dr_event(slot):
            free = charging.schedule_uncontrolled(
                station, slot, cap_kw=scfg.grid_cap_kw, n_bays=scfg.n_bays
            )
            unconstrained = sum(
                deg.charge_power_kw(
                    deg.effective_c_rate(c, float(station.soc[i]), str(station.status[i])),
                    float(station.r_int[i]),
                )[2]
                for i, c in free.items()
            )
        ledger.record_slot(slot, step["load_kw"], step["joule_kw"], unconstrained)
        station.assert_conservation()

        if collect_traces:
            snap = station.snapshot()
            traces.append(
                SlotTrace(
                    slot=slot,
                    clock=rt.slot_to_clock(slot),
                    queue_len=len(queue),
                    n_swaps=len(matches),
                    n_defections=newly_defected,
                    load_kw=round(step["load_kw"], 3),
                    price=market.price_at_slot(slot),
                    reserve=reserve,
                    shadow_price=round(shadow, 2),
                    premium_available=premium_available,
                    ready=snap["READY"],
                    charging=snap["CHARGING"],
                    waiting=snap["WAITING_BAY"],
                    in_service=snap["IN_SERVICE"],
                    quarantine=snap["QUARANTINE"],
                )
            )
        diagnostics.append(diag)

    return _build_result(
        policy=policy,
        regime=regime,
        station=station,
        ledger=ledger,
        requests=requests,
        served=served,
        queue_at_close=queue,
        unsafe=unsafe,
        traces=traces,
        diagnostics=diagnostics,
    )


def _build_result(
    policy: PolicySpec,
    regime: str,
    station: Station,
    ledger: market.MarketLedger,
    requests: list[alloc.Request],
    served: list[alloc.Request],
    queue_at_close: list[alloc.Request],
    unsafe: int,
    traces: list[SlotTrace],
    diagnostics: list[dict],
) -> RunResult:
    total = len(requests)
    defected = [r for r in requests if r.defected]
    premium_total = sum(1 for r in requests if r.is_premium)
    premium_served = sum(1 for r in served if r.is_premium)

    swaps = station.swaps
    soh_vals = [s.soh_given for s in swaps]
    bss_vals = [s.bss_given for s in swaps]
    waits = [s.wait_min for s in swaps]

    fleet = station.fleet_report()
    mkt = ledger.summary()

    served_ids = {id(r) for r in served}
    revenue = len(served) * rt.SWAP_REVENUE_INR
    lost_service = sum(
        rt.VOLL_INR.get(r.priority, 60.0) for r in requests if id(r) not in served_ids
    )
    opex = mkt["total_electricity_inr"] + fleet["degradation_cost_inr"]
    economics = {
        "revenue_inr": round(revenue, 2),
        "electricity_inr": mkt["total_electricity_inr"],
        "degradation_inr": fleet["degradation_cost_inr"],
        "opex_inr": round(opex, 2),
        "lost_service_inr": round(lost_service, 2),
        "gross_margin_inr": round(revenue - opex, 2),
        "economic_surplus_inr": round(revenue - opex - lost_service, 2),
        "cost_per_swap_inr": round(opex / len(served), 3) if served else 0.0,
    }

    return RunResult(
        policy=policy,
        regime=regime,
        served=len(served),
        total_requests=total,
        defected=len(defected),
        unserved_at_close=len(queue_at_close),
        unsafe_allocations=unsafe,
        premium_served=premium_served,
        premium_total=premium_total,
        avg_soh_allocated=float(np.mean(soh_vals)) if soh_vals else float("nan"),
        avg_bss_allocated=float(np.mean(bss_vals)) if bss_vals else float("nan"),
        avg_wait_min=float(np.mean(waits)) if waits else 0.0,
        p95_wait_min=float(np.quantile(waits, 0.95)) if waits else 0.0,
        market=mkt,
        fleet=fleet,
        economics=economics,
        traces=traces,
        swaps=swaps,
        alloc_diagnostics=diagnostics,
    )
