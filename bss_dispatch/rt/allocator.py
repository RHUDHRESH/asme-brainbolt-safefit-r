"""Real-time slot allocation with inventory rationing.

The v1 allocator solves one assignment over the whole day at once. That is the
right answer to the wrong question: at 09:15 the station does not know who
arrives at 09:40, and the pack it hands to a Medium rider now is not available
to the Critical rider who has not walked in yet.

This module solves the online version. Every slot it matches the *current*
queue against *currently held* inventory, with three additions over v1:

  Deferral is an explicit option. Each request gets a dummy column priced by
  how close it is to walking out, so "hold this rider one more slot" competes
  on the same objective as every pack. v1 has no such move -- it must serve
  everyone immediately or never.

  Inventory is rationed by a protection level. Safe-class packs are the only
  ones a Critical/High request may receive, which makes them the scarce good.
  A non-premium request may take one only if the remaining Safe count stays at
  or above the reserve the scenario bank says is needed to hold the service
  level. This is a booking limit, not a penalty: below the line the edge does
  not exist. Degraded packs are unrationed -- premium requests are barred from
  them anyway, so giving one away costs no premium capacity.

  Priority escalates continuously with defection risk, generalising v1's
  single 1.5x step at 80% of wait tolerance into a ramp that reaches
  DEFECTION_MAX_FACTOR exactly at the tolerance.

Matching itself remains the exact Hungarian solve v1 uses, so the change is in
what is offered to the optimiser, not in the optimiser.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import linear_sum_assignment

from .. import config as cfg
from . import config_rt as rt
from .states import IN_SERVICE, Station


@dataclass
class Request:
    """One rider waiting at the station."""

    vehicle_id: str
    priority: str
    min_soc: float
    range_km: float
    w_max_min: float
    arrival_slot: int
    served_slot: int | None = None
    battery_id: str | None = None
    defected: bool = False
    wait_min: float = 0.0
    history: list[str] = field(default_factory=list)

    def update_wait(self, slot: int) -> float:
        self.wait_min = max(0.0, (slot - self.arrival_slot) * rt.SLOT_MINUTES)
        return self.wait_min

    @property
    def is_premium(self) -> bool:
        return self.priority in rt.PREMIUM_PRIORITIES

    @property
    def urgency(self) -> float:
        """wait / tolerance, clipped to [0, 1]."""
        if self.w_max_min <= 0:
            return 0.0
        return float(min(1.0, self.wait_min / self.w_max_min))


def defection_factor(request: Request) -> float:
    """Continuous priority escalation as a rider approaches walking out.

    Flat until DEFECTION_RAMP_START of the tolerance, then linear to
    DEFECTION_MAX_FACTOR at the tolerance itself. v1's Twist C is the special
    case of a single step; this is the same idea without the discontinuity,
    which matters when the decision is re-taken every five minutes.
    """
    u = request.urgency
    start = rt.DEFECTION_RAMP_START
    if u <= start:
        return 1.0
    frac = (u - start) / max(1e-9, 1.0 - start)
    return 1.0 + frac * (rt.DEFECTION_MAX_FACTOR - 1.0)


def _defer_cost(request: Request, use_defection: bool) -> float:
    """Utility charged for holding a rider one more slot.

    Scaled by value of lost service so the queue is triaged by what a defection
    would actually cost, and convex in urgency so a rider at 90% of tolerance
    is far more expensive to hold than one at 45%.
    """
    voll = rt.VOLL_INR.get(request.priority, 60.0)
    urgency_term = request.urgency ** rt.DEFER_URGENCY_EXP
    base = rt.DEFER_BASE_COST * cfg.PRIORITY_WEIGHTS.get(request.priority, 1.0)
    escalation = defection_factor(request) if use_defection else 1.0
    return float(base + rt.SHADOW_PRICE_SCALE * voll * urgency_term * escalation)


def prune_defections(queue: list[Request], slot: int) -> list[Request]:
    """Remove riders whose wait tolerance has expired; they are lost demand."""
    survivors: list[Request] = []
    for req in queue:
        req.update_wait(slot)
        if req.w_max_min > 0 and req.wait_min > req.w_max_min:
            req.defected = True
        else:
            survivors.append(req)
    return survivors


# ------------------------------------------------------------ policies ----
def allocate_hsf(station: Station, queue: list[Request], slot: int) -> list[tuple[Request, int]]:
    """Highest-SoC-First, in arrival order, with no health gate.

    The mandated baseline, carried into real time unchanged: sort what is on
    the shelf by charge, walk the queue in arrival order, hand over the first
    pack that clears the rider's minimum SoC. Quarantined packs are on the
    shelf, so quarantined packs get handed over.
    """
    available = np.flatnonzero(station.state != IN_SERVICE)  # anything on the shelf
    if available.size == 0:
        return []
    order = available[np.argsort(-station.soc[available])]
    taken: set[int] = set()
    matches: list[tuple[Request, int]] = []

    for req in sorted(queue, key=lambda r: r.arrival_slot):
        for idx in order:
            idx = int(idx)
            if idx in taken:
                continue
            if station.soc[idx] >= req.min_soc:
                taken.add(idx)
                matches.append((req, idx))
                break
    return matches


def allocate_greedy(station: Station, queue: list[Request], slot: int) -> list[tuple[Request, int]]:
    """Health-aware but myopic: best available pack, one rider at a time.

    Applies the full Stage-2 gate and ranks by suitability, but resolves the
    queue sequentially by priority then arrival. It is the natural "obvious"
    improvement on the baseline and the control that shows what global
    matching is worth on top of good gating.
    """
    taken: set[int] = set()
    matches: list[tuple[Request, int]] = []
    ordered = sorted(
        queue,
        key=lambda r: (-cfg.PRIORITY_WEIGHTS.get(r.priority, 1.0), r.arrival_slot),
    )
    for req in ordered:
        feasible = np.flatnonzero(station.dispatchable(req.min_soc, req.priority))
        feasible = np.array([i for i in feasible if int(i) not in taken], dtype=int)
        if feasible.size == 0:
            continue
        best = int(feasible[np.argmax(station.bss[feasible])])
        taken.add(best)
        matches.append((req, best))
    return matches


def allocate_hungarian(
    station: Station,
    queue: list[Request],
    slot: int,
    reserve_safe: int = 0,
    shadow_price_inr: float = 0.0,
    theta_premium: float = 0.0,
    use_defection: bool = False,
    use_reserve: bool = False,
) -> tuple[list[tuple[Request, int]], dict]:
    """Global slot matching with deferral, rationing and escalation.

    U(i,j) = P_i(t) . BSS_j - gamma . W_i - alpha . I_i^2 . R_j - tilt(i,j)

    P_i(t) carries the defection ramp; the Joule term is v1's, unchanged; the
    tilt discourages spending a *good* Safe pack on a non-premium rider when
    the shadow price is high, without forbidding it. Forbidding is the
    protection level's job, applied before the matrix is built.
    """
    if not queue:
        return [], {"n_requests": 0, "n_matched": 0, "rationed_edges": 0}

    safe_present = np.flatnonzero(
        (station.status == cfg.STATUS_SAFE) & (station.state != IN_SERVICE)
    )
    safe_pool = int(safe_present.size)

    # The scarce good is not "a Safe pack", it is a Safe pack charged enough
    # that a premium rider could actually accept it. Safe packs below that
    # threshold are not premium capacity and are never rationed.
    eligible = safe_present[station.soc[safe_present] >= theta_premium]
    n_eligible = int(eligible.size)

    # Protection level, applied as a partitioned booking limit: release only
    # the `budget` least-suitable eligible packs to non-premium riders and hold
    # the rest for forecast premium demand. Expressing the limit as an edge
    # mask rather than a count keeps it exactly representable in the
    # Hungarian solve, and releasing the *marginal* pack first means the
    # premium tier keeps the best of what remains.
    if use_reserve:
        ration_budget = max(0, n_eligible - reserve_safe)
        by_suitability = eligible[np.argsort(station.bss[eligible])]
        releasable_safe = set(int(i) for i in by_suitability[:ration_budget])
        releasable_safe |= set(
            int(i) for i in safe_present if station.soc[i] < theta_premium
        )
    else:
        ration_budget = n_eligible
        releasable_safe = set(int(i) for i in safe_present)

    m = len(queue)
    pack_idx: list[int] = []
    for req in queue:
        pack_idx.extend(np.flatnonzero(station.dispatchable(req.min_soc, req.priority)).tolist())
    packs = np.array(sorted(set(int(i) for i in pack_idx)), dtype=int)
    n = packs.size

    if n == 0:
        return [], {
            "n_requests": m,
            "n_matched": 0,
            "rationed_edges": 0,
            "safe_pool": safe_pool,
            "reserve_safe": reserve_safe,
        }

    utility = np.full((m, n + m), cfg.INFEASIBLE_UTILITY, dtype=float)
    rationed = 0

    for i, req in enumerate(queue):
        p_base = cfg.PRIORITY_WEIGHTS.get(req.priority, 1.0)
        p_eff = p_base * (defection_factor(req) if use_defection else 1.0)
        peak_i = cfg.PEAK_CURRENT_A.get(req.priority, 25.0)
        feasible = station.dispatchable(req.min_soc, req.priority)

        for col, j in enumerate(packs):
            if not feasible[j]:
                continue
            is_safe = station.status[j] == cfg.STATUS_SAFE
            if is_safe and not req.is_premium and int(j) not in releasable_safe:
                rationed += 1
                continue

            r_ohm = float(station.r_int[j]) / 1000.0
            joule = cfg.JOULE_ALPHA * (peak_i**2) * r_ohm
            tilt = 0.0
            if is_safe and not req.is_premium:
                tilt = (
                    rt.SHADOW_PRICE_SCALE
                    * shadow_price_inr
                    * (float(station.bss[j]) / 100.0)
                )
            utility[i, col] = (
                p_eff * float(station.bss[j])
                - cfg.WAIT_PENALTY_GAMMA * req.wait_min
                - joule
                - tilt
            )

        # deferral column, one per request
        utility[i, n + i] = -_defer_cost(req, use_defection)

    feasible_mask = utility > cfg.INFEASIBLE_UTILITY / 2
    if not feasible_mask.any():
        return [], {
            "n_requests": m,
            "n_matched": 0,
            "rationed_edges": rationed,
            "safe_pool": safe_pool,
            "reserve_safe": reserve_safe,
        }

    cost = np.where(feasible_mask, float(utility[feasible_mask].max()) - utility, 1.0e9)
    rows, cols = linear_sum_assignment(cost)

    matches: list[tuple[Request, int]] = []
    spent_safe = 0
    for i, col in zip(rows, cols):
        if col >= n or not feasible_mask[i, col]:
            continue  # deferred, or an infeasible edge the padding forced
        j = int(packs[col])
        req = queue[i]
        if station.status[j] == cfg.STATUS_SAFE and not req.is_premium:
            spent_safe += 1
        matches.append((req, j))

    return matches, {
        "n_requests": m,
        "n_matched": len(matches),
        "rationed_edges": rationed,
        "safe_pool": safe_pool,
        "premium_eligible": n_eligible,
        "ration_budget": ration_budget,
        "reserve_safe": reserve_safe,
        "safe_spent_on_non_premium": spent_safe,
        "shadow_price_inr": round(float(shadow_price_inr), 2),
    }
