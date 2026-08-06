"""Receding-horizon charging scheduler  [Sarker 2015; Wu 2018; Yang 2014].

Decides, every slot, which packs occupy the charger bays and at what C-rate.

The decision is a genuine three-way trade-off and all three legs are priced in
rupees so they can be compared:

    spend now      energy at the prevailing ToU price, plus the pack's own
                   I^2.R loss, divided by converter efficiency
    spend later    capacity fade, super-linear in C-rate and Arrhenius in
                   temperature, monetised against replacement cost  [W18]
    earn           readiness -- a charged pack is a swap you can sell, and,
                   when premium inventory is thin, a stockout you avoid

The marginal value of one point of SoC is

    v_soc(j) = ( swap revenue + lambda(t) . 1[pack j can serve premium] )
               / (SoC_target - SoC_floor)

with lambda(t) the stochastic shadow price from `uncertainty.ReserveOracle`.
That single coupling is what makes the scheduler self-arbitraging: when energy
is cheap or inventory is thin, v_soc exceeds marginal cost and the bays fill at
high C-rate; at peak tariff with a deep shelf it does not, and the station
coasts. No hand-tuned peak-avoidance rule is needed, and none is used.

Solved exactly as a MILP over a binary C-rate menu with HiGHS
(`scipy.optimize.milp`), re-solved every slot with only the first slot
implemented -- standard receding horizon.
"""

from __future__ import annotations

import numpy as np
from scipy import sparse
from scipy.optimize import Bounds, LinearConstraint, milp

from .. import config as cfg
from . import config_rt as rt
from . import degradation as deg
from . import market
from .states import Station


def marginal_soc_value(
    station: Station,
    idx: int,
    shadow_price_inr: float,
) -> float:
    """INR earned per additional point of SoC on pack `idx`.

    A Degraded pack is barred from Critical/High by the Stage-2 policy, so the
    scarcity premium does not apply to it -- it can only ever earn the swap
    revenue. That asymmetry is what steers scarce bay-hours to the packs that
    can actually relieve a premium shortage.
    """
    span = max(rt.SOC_TARGET_PCT - rt.SOC_FLOOR_PCT, 1.0)
    value = rt.SWAP_REVENUE_INR
    if station.status[idx] == cfg.STATUS_SAFE:
        value += shadow_price_inr
    return value / span


def _candidates(station: Station, shadow_price_inr: float, limit: int) -> np.ndarray:
    """Prune the charge-eligible set to the most valuable `limit` packs.

    Keeps the MILP small enough to re-solve every slot. Ranking is by value
    density at the reference C-rate, so the packs dropped are the ones the
    optimiser would have left idle anyway.
    """
    eligible = np.flatnonzero(station.charge_eligible())
    if eligible.size <= limit:
        return eligible

    scores = np.empty(eligible.size, dtype=float)
    for k, idx in enumerate(eligible):
        v = marginal_soc_value(station, int(idx), shadow_price_inr)
        headroom = rt.SOC_TARGET_PCT - station.soc[idx]
        scores[k] = v * min(headroom, 20.0) - station.r_int[idx] * 0.01
    keep = np.argsort(-scores)[:limit]
    return eligible[np.sort(keep)]


def schedule_uncontrolled(
    station: Station,
    slot: int,
    cap_kw: float,
    n_bays: int,
) -> dict[int, float]:
    """Baseline: plug in whatever needs charge, as fast as the pack allows.

    Bays go to the emptiest packs first, at the highest C-rate the cell will
    accept, until either the bays or the transformer runs out. No price
    awareness, no degradation awareness -- the way an unmanaged station runs,
    and the charging-side counterpart of the Highest-SoC-First baseline.
    """
    eligible = np.flatnonzero(station.charge_eligible())
    if eligible.size == 0:
        return {}
    order = eligible[np.argsort(station.soc[eligible])]

    c_max = max(rt.C_RATE_MENU)
    decisions: dict[int, float] = {}
    load = 0.0
    for idx in order:
        if len(decisions) >= n_bays:
            break
        c_eff = deg.effective_c_rate(c_max, float(station.soc[idx]), str(station.status[idx]))
        if c_eff <= 0.0:
            continue
        _, _, p_grid = deg.charge_power_kw(c_eff, float(station.r_int[idx]))
        if load + p_grid > cap_kw + 1e-9:
            # step down through the menu rather than skipping the pack
            placed = False
            for c in sorted((c for c in rt.C_RATE_MENU if c > 0), reverse=True):
                c_try = deg.effective_c_rate(c, float(station.soc[idx]), str(station.status[idx]))
                if c_try <= 0.0:
                    continue
                _, _, p_try = deg.charge_power_kw(c_try, float(station.r_int[idx]))
                if load + p_try <= cap_kw + 1e-9:
                    decisions[int(idx)] = c
                    load += p_try
                    placed = True
                    break
            if not placed:
                continue
        else:
            decisions[int(idx)] = c_max
            load += p_grid
    return decisions


def schedule_milp(
    station: Station,
    slot: int,
    cap_kw: float,
    n_bays: int,
    shadow_price_inr: float = 0.0,
    horizon: int = rt.MPC_HORIZON_SLOTS,
    candidate_limit: int | None = None,
) -> tuple[dict[int, float], dict]:
    """Exact receding-horizon MILP over the C-rate menu.

    minimise  sum_{j,c,h} [ energy(j,c,h) + fade(j,c) - value(j,c) ] . x[j,c,h]

    s.t.  sum_c x[j,c,h]                <= 1        one rate per pack per slot
          sum_{j,c} x[j,c,h]            <= N_bays   bay count
          sum_{j,c} P_grid(j,c) x[j,c,h] <= cap(h)  transformer / DR ceiling
          sum_{h,c} gain(j,c) x[j,c,h]  <= headroom_j   no overcharging

    Coefficients are evaluated at each pack's SoC at the start of the horizon.
    Within a 20-minute window the SoC drift is small, and only the first slot
    is ever implemented, so the approximation never reaches the ledger.
    """
    limit = candidate_limit if candidate_limit is not None else max(2 * n_bays, n_bays + 12)
    cand = _candidates(station, shadow_price_inr, limit)
    rates = tuple(c for c in rt.C_RATE_MENU if c > 0.0)
    n_j, n_c, n_h = cand.size, len(rates), max(1, horizon)

    if n_j == 0 or n_c == 0:
        return {}, {"n_vars": 0, "status": "empty", "objective": 0.0}

    n_vars = n_j * n_c * n_h

    def vid(j: int, c: int, h: int) -> int:
        return (j * n_c + c) * n_h + h

    obj = np.zeros(n_vars, dtype=float)
    power = np.zeros(n_vars, dtype=float)
    gain = np.zeros(n_vars, dtype=float)

    prices = [market.price_at_slot(slot + h) for h in range(n_h)]

    # Physics is identical across the horizon; only the tariff moves. Evaluate
    # each (pack, C-rate) once at unit price and scale, rather than re-deriving
    # the same fade and power figures once per slot.
    for j, idx in enumerate(cand):
        idx = int(idx)
        v_soc = marginal_soc_value(station, idx, shadow_price_inr)
        for c, c_rate in enumerate(rates):
            step = deg.evaluate_charge_step(
                c_requested=c_rate,
                soc_pct=float(station.soc[idx]),
                soh_pct=float(station.soh[idx]),
                temp_c=float(station.temp[idx]),
                r_int_mohm=float(station.r_int[idx]),
                status=str(station.status[idx]),
                price_inr_per_kwh=1.0,
            )
            kwh = step["energy_kwh"]
            deg_inr = step["degradation_inr"]
            value = v_soc * step["soc_gain_pct"]
            for h in range(n_h):
                v = vid(j, c, h)
                obj[v] = kwh * prices[h] + deg_inr - value
                power[v] = step["p_grid_kw"]
                gain[v] = step["soc_gain_pct"]

    rows: list[sparse.csr_matrix] = []
    lb: list[float] = []
    ub: list[float] = []

    # (1) one C-rate per pack per slot
    r_idx, c_idx = [], []
    for j in range(n_j):
        for h in range(n_h):
            row = j * n_h + h
            for c in range(n_c):
                r_idx.append(row)
                c_idx.append(vid(j, c, h))
    a_one = sparse.csr_matrix(
        (np.ones(len(r_idx)), (r_idx, c_idx)), shape=(n_j * n_h, n_vars)
    )
    rows.append(a_one)
    lb += [-np.inf] * (n_j * n_h)
    ub += [1.0] * (n_j * n_h)

    # (2) bay count and (3) grid power, per slot
    r_bay, c_bay = [], []
    r_pow, c_pow, v_pow = [], [], []
    cap_ub: list[float] = []
    for h in range(n_h):
        for j in range(n_j):
            for c in range(n_c):
                v = vid(j, c, h)
                r_bay.append(h)
                c_bay.append(v)
                if power[v] > 0.0:
                    r_pow.append(h)
                    c_pow.append(v)
                    v_pow.append(power[v])
        cap_ub.append(market.power_cap_kw(slot + h, cap_kw))

    rows.append(
        sparse.csr_matrix((np.ones(len(r_bay)), (r_bay, c_bay)), shape=(n_h, n_vars))
    )
    lb += [-np.inf] * n_h
    ub += [float(n_bays)] * n_h

    rows.append(
        sparse.csr_matrix((v_pow, (r_pow, c_pow)), shape=(n_h, n_vars))
    )
    lb += [-np.inf] * n_h
    ub += cap_ub

    # (4) headroom per pack over the whole horizon
    r_hr, c_hr, v_hr = [], [], []
    hr_ub: list[float] = []
    for j, idx in enumerate(cand):
        for c in range(n_c):
            for h in range(n_h):
                v = vid(j, c, h)
                if gain[v] > 0.0:
                    r_hr.append(j)
                    c_hr.append(v)
                    v_hr.append(gain[v])
        hr_ub.append(max(0.0, rt.SOC_TARGET_PCT - float(station.soc[int(idx)])))
    rows.append(sparse.csr_matrix((v_hr, (r_hr, c_hr)), shape=(n_j, n_vars)))
    lb += [-np.inf] * n_j
    ub += hr_ub

    constraints = LinearConstraint(sparse.vstack(rows, format="csr"), lb, ub)
    res = milp(
        c=obj,
        constraints=constraints,
        integrality=np.ones(n_vars),
        bounds=Bounds(0, 1),
        options={
            "mip_rel_gap": rt.MILP_REL_GAP,
            "time_limit": rt.MILP_TIME_LIMIT_S,
            "presolve": True,
        },
    )

    # An incumbent returned under the gap or time limit is feasible by
    # construction -- every constraint is satisfied, it is simply not proven
    # optimal. Take it. Only a genuinely empty result falls back.
    if res.x is None:
        return (
            schedule_uncontrolled(station, slot, cap_kw, n_bays),
            {"n_vars": n_vars, "status": "fallback", "objective": 0.0},
        )

    x = np.asarray(res.x)
    decisions: dict[int, float] = {}
    for j, idx in enumerate(cand):
        for c, c_rate in enumerate(rates):
            if x[vid(j, c, 0)] > 0.5:
                decisions[int(idx)] = float(c_rate)
                break

    return decisions, {
        "n_vars": n_vars,
        "n_candidates": int(n_j),
        "status": "optimal" if res.success else "incumbent",
        "mip_gap": float(getattr(res, "mip_gap", np.nan)),
        "objective": float(res.fun) if res.fun is not None else 0.0,
        "shadow_price_inr": float(shadow_price_inr),
    }
