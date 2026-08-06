"""Demand uncertainty, inventory reserve and the shadow price of readiness
[Sarker 2015; Cui 2023].

This is the layer that turns a myopic matcher into an operating policy.

A one-shot Hungarian assignment is optimal for the demand it can see. In real
time it is not, because serving a Medium request now with the last Safe pack is
only correct if no Critical request arrives before another pack is charged.
Deciding that requires a distribution over future demand, not a point forecast.

Three objects, in order of use:

  DemandProfile   a non-homogeneous arrival process fitted to the observed
                  arrival file -- rate per slot plus empirical pools for
                  priority, minimum SoC, range and wait tolerance.

  ScenarioBank    S sample paths drawn from that process. Sampled once and
                  reused, so every policy faces the identical future and any
                  difference between them is policy, not luck.

  ReserveOracle   reads the bank at slot t and answers the two questions the
                  allocator needs:
                    - how many premium-eligible packs must be held back to
                      hit the target service level? (a critical-fractile
                      safety stock)
                    - what is one more pack worth right now? (the marginal
                      expected stockout cost, in rupees)

The shadow price is standard newsvendor marginal analysis: with integer demand
D over the look-ahead window and A packs available, releasing one pack raises
expected unmet premium demand by exactly P(D >= A), so its opportunity cost is

    lambda(t) = VoLL_premium . P(D >= A)

which goes to zero when inventory is deep and to the full value of lost service
when the shelf is bare. Nothing needs tuning: the curve comes out of the
scenario bank.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import config_rt as rt


# ------------------------------------------------------------- profile ----
@dataclass
class DemandProfile:
    """Non-homogeneous arrival process fitted to an observed demand file."""

    rate_by_slot: np.ndarray          # expected arrivals per slot
    priorities: tuple[str, ...]
    priority_p: np.ndarray
    min_soc_pool: np.ndarray
    range_pool: np.ndarray
    wmax_pool: np.ndarray
    observed_count: int

    @property
    def premium_share(self) -> float:
        prem = [
            p for i, p in enumerate(self.priorities) if p in rt.PREMIUM_PRIORITIES
        ]
        return float(
            sum(self.priority_p[self.priorities.index(p)] for p in prem)
        )


def fit_demand_profile(
    vehicles: pd.DataFrame,
    n_slots: int = rt.N_SLOTS,
) -> DemandProfile:
    """Fit arrival intensity and attribute pools from the demand CSV.

    Arrival times are bucketed at `ARRIVAL_BUCKET_MIN` and the count in each
    bucket is spread evenly across its slots, giving a piecewise-constant
    intensity. Attributes are kept as empirical pools and bootstrapped rather
    than fitted to a parametric family -- with 50 observations, resampling the
    real values is more honest than assuming a shape.
    """
    rate = np.zeros(n_slots, dtype=float)

    slots_per_bucket = max(1, rt.ARRIVAL_BUCKET_MIN // rt.SLOT_MINUTES)
    if "arrival_time" in vehicles.columns:
        stamps = pd.to_datetime(vehicles["arrival_time"], errors="coerce")
        valid = stamps.dropna()
        if not valid.empty:
            hours = (
                valid.dt.hour.to_numpy(dtype=float)
                + valid.dt.minute.to_numpy(dtype=float) / 60.0
            )
            slot_idx = np.floor(
                (hours - rt.SIM_START_HOUR) / rt.SLOT_HOURS
            ).astype(int)
            slot_idx = slot_idx[(slot_idx >= 0) & (slot_idx < n_slots)]
            bucket = slot_idx // slots_per_bucket
            for b, count in zip(*np.unique(bucket, return_counts=True)):
                lo = int(b) * slots_per_bucket
                hi = min(n_slots, lo + slots_per_bucket)
                if hi > lo:
                    rate[lo:hi] += count / (hi - lo)

    if rate.sum() <= 0:  # no usable timestamps: spread uniformly over the day
        rate[:] = len(vehicles) / max(n_slots, 1)

    prio_counts = vehicles["priority"].astype(str).value_counts()
    priorities = tuple(prio_counts.index.tolist())
    priority_p = (prio_counts / prio_counts.sum()).to_numpy(dtype=float)

    def _pool(col: str, fallback: float) -> np.ndarray:
        if col in vehicles.columns:
            vals = pd.to_numeric(vehicles[col], errors="coerce").dropna().to_numpy(float)
            if vals.size:
                return vals
        return np.array([fallback], dtype=float)

    return DemandProfile(
        rate_by_slot=rate,
        priorities=priorities,
        priority_p=priority_p,
        min_soc_pool=_pool("min_SoC", 40.0),
        range_pool=_pool("range_km", rt.DEFAULT_RANGE_KM),
        wmax_pool=_pool("W_max_min", 10.0),
        observed_count=len(vehicles),
    )


# ------------------------------------------------------------ scenarios ---
@dataclass
class ScenarioBank:
    """S sampled demand futures, shared by every policy under test."""

    total: np.ndarray    # (S, n_slots) arrivals per slot
    premium: np.ndarray  # (S, n_slots) Critical+High arrivals per slot

    @property
    def n_scenarios(self) -> int:
        return self.total.shape[0]

    def window_premium(self, slot: int, window_slots: int) -> np.ndarray:
        """Premium arrivals in [slot, slot + window) for every scenario."""
        n_slots = self.premium.shape[1]
        lo = min(max(slot, 0), n_slots)
        hi = min(lo + window_slots, n_slots)
        if hi <= lo:
            return np.zeros(self.n_scenarios, dtype=float)
        return self.premium[:, lo:hi].sum(axis=1)


def build_scenario_bank(
    profile: DemandProfile,
    n_scenarios: int = rt.N_SCENARIOS,
    demand_multiplier: float = 1.0,
    seed: int = rt.RT_RANDOM_SEED,
) -> ScenarioBank:
    """Draw S non-homogeneous Poisson paths and split them by priority."""
    rng = np.random.default_rng(seed)
    lam = profile.rate_by_slot * demand_multiplier
    total = rng.poisson(lam=np.broadcast_to(lam, (n_scenarios, lam.size)))

    premium_p = float(
        sum(
            profile.priority_p[i]
            for i, p in enumerate(profile.priorities)
            if p in rt.PREMIUM_PRIORITIES
        )
    )
    premium = rng.binomial(total, premium_p)
    return ScenarioBank(total=total.astype(float), premium=premium.astype(float))


def sample_requests(
    profile: DemandProfile,
    demand_multiplier: float = 1.0,
    seed: int = rt.RT_RANDOM_SEED,
    n_slots: int = rt.N_SLOTS,
    prefix: str = "SIM",
) -> pd.DataFrame:
    """Draw one realised demand path as a request table.

    Used for the stress regime and for Monte Carlo replications. Attributes are
    bootstrapped from the observed pools so the synthetic requests are made of
    real values in real proportions.
    """
    rng = np.random.default_rng(seed)
    lam = profile.rate_by_slot * demand_multiplier
    counts = rng.poisson(lam=lam)

    rows: list[dict] = []
    n = 0
    for slot in range(min(n_slots, counts.size)):
        for _ in range(int(counts[slot])):
            n += 1
            priority = str(rng.choice(profile.priorities, p=profile.priority_p))
            rows.append(
                {
                    "vehicle_id": f"{prefix}-{n:04d}",
                    "priority": priority,
                    "min_SoC": float(rng.choice(profile.min_soc_pool)),
                    "range_km": float(rng.choice(profile.range_pool)),
                    "W_max_min": float(rng.choice(profile.wmax_pool)),
                    "arrival_slot": int(slot),
                    "arrival_order": n,
                    "wait_min": 0.0,
                }
            )
    return pd.DataFrame(rows)


# ------------------------------------------------------------- oracle -----
@dataclass
class ReserveOracle:
    """Turns the scenario bank into a reserve level and a shadow price."""

    bank: ScenarioBank
    window_slots: int = max(1, rt.RESERVE_LOOKAHEAD_MIN // rt.SLOT_MINUTES)
    service_level: float = rt.SERVICE_LEVEL
    voll_inr: float = rt.VOLL_INR["High"]

    def __post_init__(self) -> None:
        self._cache: dict[int, np.ndarray] = {}

    def _demand(self, slot: int) -> np.ndarray:
        if slot not in self._cache:
            self._cache[slot] = self.bank.window_premium(slot, self.window_slots)
        return self._cache[slot]

    def reserve_level(self, slot: int, expected_completions: float = 0.0) -> int:
        """Premium-eligible packs to hold back, at the target service level.

        The critical fractile of look-ahead premium demand, less the packs the
        charging layer will have made premium-eligible by then. Holding stock
        the chargers are about to replace would be waste, not prudence.
        """
        demand = self._demand(slot)
        if demand.size == 0:
            return 0
        q = float(np.quantile(demand, self.service_level))
        return int(max(0.0, np.ceil(q - max(0.0, expected_completions))))

    def stockout_probability(self, slot: int, available: float) -> float:
        """P(look-ahead premium demand >= available)."""
        demand = self._demand(slot)
        if demand.size == 0:
            return 0.0
        return float(np.mean(demand >= max(available, 0.0)))

    def shadow_price_inr(
        self,
        slot: int,
        available: int,
        expected_completions: float = 0.0,
    ) -> float:
        """Marginal opportunity cost of releasing one premium-eligible pack.

        Newsvendor marginal analysis: with A units on hand, one more unit of
        demand than A goes unmet, so shipping one unit now raises expected
        unmet premium demand by P(D >= A).
        """
        effective = max(0.0, available + max(0.0, expected_completions))
        if effective <= 0.0:
            return float(self.voll_inr)
        return float(self.voll_inr * self.stockout_probability(slot, effective))

    def demand_quantiles(self, slot: int, qs=(0.5, 0.9, 0.95)) -> dict[str, float]:
        demand = self._demand(slot)
        if demand.size == 0:
            return {f"q{int(q * 100)}": 0.0 for q in qs}
        return {f"q{int(q * 100)}": float(np.quantile(demand, q)) for q in qs}


# ---------------------------------------------------------------- risk ----
def cvar(losses, alpha: float = rt.CVAR_ALPHA) -> float:
    """Conditional Value at Risk: mean of the worst (1-alpha) tail.

    Reported alongside the mean because a policy that is good on average and
    catastrophic on the worst 5% of days is not a policy an operator can run.
    """
    arr = np.asarray(list(losses), dtype=float)
    if arr.size == 0:
        return 0.0
    threshold = float(np.quantile(arr, alpha))
    tail = arr[arr >= threshold]
    return float(tail.mean()) if tail.size else threshold
