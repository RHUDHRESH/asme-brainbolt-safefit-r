"""Battery state-transition model and station inventory ledger
[Sarker 2015; Yang 2014; Cui 2023].

The v1 solver sees a static rack: 200 rows, each with a fixed SoC and health,
matched once. Real stations are a circulation. A pack leaves in a vehicle,
comes back depleted and slightly older, queues for a bay, charges, and only
then becomes inventory again. Nothing about that loop is visible in a one-shot
assignment, and it is the loop that makes readiness scarce.

Every pack occupies exactly one state per slot:

    READY        at the station, off-charger, dispatchable
    CHARGING     occupying one of the N_bays charger bays
    WAITING_BAY  at the station, wants charge, no bay free
    IN_SERVICE   out with a vehicle, returns at `return_slot`
    QUARANTINE   hard-blocked by the Stage-2 safety gate

with the inventory balance, per slot, per class:

    n_at_station(t+1) = n_at_station(t) - swaps(t) + returns(t)

Pack count is conserved by construction: a swap moves one pack out and books
one return, so the ledger cannot leak inventory. `assert_conservation()`
enforces that at every step.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .. import config as cfg
from ..classify import _classify_row
from ..score import maut_terms
from . import config_rt as rt
from . import degradation as deg

READY = 0
CHARGING = 1
WAITING_BAY = 2
IN_SERVICE = 3
QUARANTINE = 4

STATE_NAMES = {
    READY: "READY",
    CHARGING: "CHARGING",
    WAITING_BAY: "WAITING_BAY",
    IN_SERVICE: "IN_SERVICE",
    QUARANTINE: "QUARANTINE",
}


@dataclass
class SwapEvent:
    slot: int
    vehicle_id: str
    priority: str
    battery_id: str
    soc_given: float
    soh_given: float
    bss_given: float
    r_int_given: float
    status_given: str
    wait_min: float
    return_slot: int


@dataclass
class Station:
    """Mutable pack population with a slot-stepped state machine."""

    packs: pd.DataFrame
    n_bays: int = rt.N_CHARGER_BAYS

    # populated in __post_init__
    ids: np.ndarray = field(init=False)
    soc: np.ndarray = field(init=False)
    soh: np.ndarray = field(init=False)
    temp: np.ndarray = field(init=False)
    r_int: np.ndarray = field(init=False)
    dv: np.ndarray = field(init=False)
    bss: np.ndarray = field(init=False)
    status: np.ndarray = field(init=False)
    state: np.ndarray = field(init=False)
    return_slot: np.ndarray = field(init=False)

    def __post_init__(self) -> None:
        df = self.packs.reset_index(drop=True)
        n = len(df)
        self.ids = df["battery_id"].to_numpy(dtype=object)
        self.soc = df["SoC"].to_numpy(dtype=float).copy()
        self.soh = df["SoH"].to_numpy(dtype=float).copy()
        self.temp = df["T"].to_numpy(dtype=float).copy()
        self.r_int = df["R_int_mOhm"].to_numpy(dtype=float).copy()
        self.dv = df["dV_cell_mV"].to_numpy(dtype=float).copy()
        self.bss = df["BSS"].to_numpy(dtype=float).copy()
        self.status = df["status"].to_numpy(dtype=object).copy()
        self.integrity = (
            df["integrity_quarantine"].to_numpy(dtype=bool).copy()
            if "integrity_quarantine" in df.columns
            else np.zeros(n, dtype=bool)
        )
        self.integrity_reason = (
            df["integrity_reason"].fillna("").to_numpy(dtype=object).copy()
            if "integrity_reason" in df.columns
            else np.array([""] * n, dtype=object)
        )

        self.state = np.where(
            self.status == cfg.STATUS_QUARANTINE, QUARANTINE, READY
        ).astype(int)
        self.return_slot = np.full(n, -1, dtype=int)

        # opening condition, kept for the "what did the day cost the fleet" report
        self.soh_open = self.soh.copy()
        self.r_int_open = self.r_int.copy()
        self.soc_open = self.soc.copy()

        # accumulators
        self.soh_lost = np.zeros(n, dtype=float)
        self.energy_kwh = np.zeros(n, dtype=float)
        self.deg_inr = np.zeros(n, dtype=float)
        self.n_dispatch = np.zeros(n, dtype=int)
        self.charge_slots = np.zeros(n, dtype=int)
        self.c_rate_hist: list[float] = []

        self.r_slope = deg.fit_r_soh_slope(df)
        self.swaps: list[SwapEvent] = []
        self.n_packs = n

        # depth-of-discharge booked at dispatch, settled on return
        self._pending_dod = np.zeros(n, dtype=float)
        self._pending_c_dis = np.zeros(n, dtype=float)

    # ------------------------------------------------------------ masks ---
    def at_station(self) -> np.ndarray:
        return self.state != IN_SERVICE

    def dispatchable(self, min_soc: float, priority: str) -> np.ndarray:
        """Packs legally assignable to a request, per the v1 hard constraints.

        Identical rules to `allocate.run_proposed_global_optimization_dispatch`:
        never quarantined, SoC at or above the request's floor, and Degraded
        packs barred from Critical/High. The only addition is physical
        presence -- a pack out on the road cannot be swapped into anything.
        """
        ok = (
            (self.state != IN_SERVICE)
            & (self.state != QUARANTINE)
            & (self.status != cfg.STATUS_QUARANTINE)
            & (self.soc >= min_soc)
        )
        if priority in cfg.HIGH_DEMAND_PRIORITIES:
            ok &= self.status != cfg.STATUS_DEGRADED
        return ok

    def charge_eligible(self) -> np.ndarray:
        """Packs that could usefully occupy a bay this slot."""
        return (
            (self.state != IN_SERVICE)
            & (self.status != cfg.STATUS_QUARANTINE)
            & (self.soc < rt.SOC_TARGET_PCT - 1e-9)
        )

    def premium_ready_count(self, min_soc: float = 0.0) -> int:
        """Packs available *right now* to a Critical/High request.

        This is the inventory the stochastic reserve protects: not pack count,
        but count of packs that a premium request could actually accept.
        """
        return int(np.count_nonzero(self.dispatchable(min_soc, "Critical")))

    # ------------------------------------------------------- transitions ---
    def dispatch(
        self,
        idx: int,
        vehicle_id: str,
        priority: str,
        range_km: float,
        wait_min: float,
        slot: int,
        rng: np.random.Generator,
    ) -> SwapEvent:
        """READY/CHARGING/WAITING_BAY -> IN_SERVICE, with the return booked."""
        distance = float(range_km) if np.isfinite(range_km) and range_km > 0 else rt.DEFAULT_RANGE_KM
        trip_min = distance / rt.AVG_SPEED_KMPH * 60.0
        trip_min += float(rng.uniform(0.0, rt.RETURN_JITTER_MIN))
        back = slot + max(1, int(math.ceil(trip_min / rt.SLOT_MINUTES)))

        event = SwapEvent(
            slot=slot,
            vehicle_id=str(vehicle_id),
            priority=str(priority),
            battery_id=str(self.ids[idx]),
            soc_given=float(self.soc[idx]),
            soh_given=float(self.soh[idx]),
            bss_given=float(self.bss[idx]),
            r_int_given=float(self.r_int[idx]),
            status_given=str(self.status[idx]),
            wait_min=float(wait_min),
            return_slot=back,
        )

        # depth of discharge the trip will impose, booked now, applied on return
        energy_wh = distance * rt.WH_PER_KM
        usable_wh = rt.PACK_NOMINAL_KWH * 1000.0 * self.soh[idx] / 100.0
        self._pending_dod[idx] = min(
            100.0 * energy_wh / max(usable_wh, 1e-6),
            max(0.0, self.soc[idx] - rt.SOC_FLOOR_PCT),
        )
        self._pending_c_dis[idx] = (
            cfg.PEAK_CURRENT_A.get(str(priority), 25.0) / cfg.PACK_CAPACITY_AH
        )

        self.state[idx] = IN_SERVICE
        self.return_slot[idx] = back
        self.n_dispatch[idx] += 1
        self.swaps.append(event)
        return event

    def process_returns(self, slot: int) -> list[int]:
        """IN_SERVICE -> WAITING_BAY for every pack whose trip has ended.

        The pack comes back measurably worse than it left: depleted by the trip
        energy, aged by the discharge throughput, and with the ohmic growth
        that accompanies that fade. It is then re-gated and re-scored, so a
        pack can be quarantined by the day's own usage.
        """
        due = np.flatnonzero((self.state == IN_SERVICE) & (self.return_slot <= slot))
        for idx in due:
            dod = float(self._pending_dod[idx])
            fade = deg.discharge_fade_pct(
                dod, float(self._pending_c_dis[idx]), float(self.temp[idx]), float(self.soh[idx])
            )
            self.soc[idx] = max(rt.SOC_FLOOR_PCT, self.soc[idx] - dod)
            self._apply_fade(int(idx), fade)
            self.state[idx] = WAITING_BAY
            self.return_slot[idx] = -1
            self._pending_dod[idx] = 0.0
            self._pending_c_dis[idx] = 0.0
        return [int(i) for i in due]

    def apply_charging(
        self,
        decisions: dict[int, float],
        slot: int,
        price_inr_per_kwh: float,
    ) -> dict:
        """Execute one slot of the charging schedule and re-state every pack.

        `decisions` maps pack index -> requested C-rate. Packs not named are
        left alone; whether they read WAITING_BAY or READY afterwards depends
        only on whether they still want charge.
        """
        load_kw = 0.0
        joule_kw = 0.0
        energy_cost = 0.0
        deg_cost = 0.0
        fade_total = 0.0
        n_charging = 0

        active = {i: c for i, c in decisions.items() if c > 0.0}
        if len(active) > self.n_bays:
            raise ValueError(
                f"charging schedule uses {len(active)} bays, station has {self.n_bays}"
            )

        for idx, c_req in active.items():
            step = deg.evaluate_charge_step(
                c_requested=c_req,
                soc_pct=float(self.soc[idx]),
                soh_pct=float(self.soh[idx]),
                temp_c=float(self.temp[idx]),
                r_int_mohm=float(self.r_int[idx]),
                status=str(self.status[idx]),
                price_inr_per_kwh=price_inr_per_kwh,
            )
            self.soc[idx] = min(rt.SOC_TARGET_PCT, self.soc[idx] + step["soc_gain_pct"])
            self._apply_fade(idx, step["fade_pct"])
            self.energy_kwh[idx] += step["energy_kwh"]
            self.deg_inr[idx] += step["degradation_inr"]
            self.charge_slots[idx] += 1
            self.c_rate_hist.append(step["c_effective"])

            load_kw += step["p_grid_kw"]
            joule_kw += step["p_joule_kw"]
            energy_cost += step["energy_cost_inr"]
            deg_cost += step["degradation_inr"]
            fade_total += step["fade_pct"]
            n_charging += 1

        # calendar ageing runs on every pack resting at the station
        resting = np.flatnonzero(self.at_station())
        for idx in resting:
            if idx in active:
                continue
            cal = deg.calendar_fade_pct(float(self.temp[idx]), rt.SLOT_HOURS)
            self._apply_fade(int(idx), cal)
            self.deg_inr[idx] += deg.fade_to_inr(cal)
            deg_cost += deg.fade_to_inr(cal)
            fade_total += cal

        self._restate(active)

        return {
            "load_kw": load_kw,
            "joule_kw": joule_kw,
            "energy_cost_inr": energy_cost,
            "degradation_inr": deg_cost,
            "fade_pct": fade_total,
            "n_charging": n_charging,
        }

    # -------------------------------------------------------- internals ---
    def _restate(self, active: dict[int, float]) -> None:
        """Recompute READY / CHARGING / WAITING_BAY / QUARANTINE labels."""
        at_station = self.at_station()
        quarantined = self.status == cfg.STATUS_QUARANTINE
        wants_charge = self.soc < rt.SOC_TARGET_PCT - 1e-9

        new_state = self.state.copy()
        new_state[at_station & quarantined] = QUARANTINE
        free = at_station & ~quarantined
        new_state[free & wants_charge] = WAITING_BAY
        new_state[free & ~wants_charge] = READY
        for idx in active:
            new_state[idx] = CHARGING
        self.state = new_state

    def _apply_fade(self, idx: int, fade_pct: float) -> None:
        """Age one pack, then re-gate and re-score it.

        Health is a state variable here, not a constant: SoH falls, R_int rises
        on the fitted fleet slope, the Stage-2 cascade re-runs, and the MAUT
        score is rebuilt from the new readings. A pack that ages past a hard
        gate during the day is quarantined during the day.
        """
        if fade_pct <= 0.0:
            return
        self.soh[idx] = max(0.0, self.soh[idx] - fade_pct)
        self.r_int[idx] += deg.r_growth_mohm(fade_pct, self.r_slope)
        self.soh_lost[idx] += fade_pct

        status, reason = _classify_row(
            {
                "integrity_quarantine": bool(self.integrity[idx]),
                "integrity_reason": self.integrity_reason[idx],
                "T": float(self.temp[idx]),
                "SoH": float(self.soh[idx]),
                "R_int_mOhm": float(self.r_int[idx]),
                "dV_cell_mV": float(self.dv[idx]),
            }
        )
        self.status[idx] = status
        if status == cfg.STATUS_QUARANTINE and self.state[idx] != IN_SERVICE:
            self.state[idx] = QUARANTINE
        _, _, _, _, bss = maut_terms(
            self.soh[idx], self.temp[idx], self.r_int[idx], self.dv[idx]
        )
        self.bss[idx] = float(bss)

    # ------------------------------------------------------- reporting ----
    def snapshot(self) -> dict[str, int]:
        counts = {name: 0 for name in STATE_NAMES.values()}
        for code, name in STATE_NAMES.items():
            counts[name] = int(np.count_nonzero(self.state == code))
        return counts

    def _c_rate_histogram(self) -> list[int]:
        """Bay-slots spent at each non-zero rate on the menu.

        Effective rates are clamped by the CC-CV taper and the Degraded cap, so
        realised values land between menu entries; each is counted against the
        nearest menu rate.
        """
        menu = [c for c in rt.C_RATE_MENU if c > 0]
        counts = [0] * len(menu)
        for c in self.c_rate_hist:
            nearest = min(range(len(menu)), key=lambda k: abs(menu[k] - c))
            counts[nearest] += 1
        return counts

    def assert_conservation(self) -> None:
        total = sum(self.snapshot().values())
        if total != self.n_packs:
            raise AssertionError(
                f"inventory leak: {total} states for {self.n_packs} packs"
            )

    def fleet_report(self) -> dict:
        return {
            "n_packs": self.n_packs,
            "soh_open_mean": round(float(self.soh_open.mean()), 4),
            "soh_close_mean": round(float(self.soh.mean()), 4),
            "soh_lost_total_pct": round(float(self.soh_lost.sum()), 5),
            "soh_lost_mean_pct": round(float(self.soh_lost.mean()), 6),
            "degradation_cost_inr": round(float(self.deg_inr.sum()), 2),
            "energy_delivered_kwh": round(float(self.energy_kwh.sum()), 3),
            "total_dispatches": int(self.n_dispatch.sum()),
            "total_charge_slots": int(self.charge_slots.sum()),
            "mean_c_rate_used": round(
                float(np.mean(self.c_rate_hist)) if self.c_rate_hist else 0.0, 4
            ),
            "c_rate_histogram": self._c_rate_histogram(),
            "packs_quarantined_during_day": int(
                np.count_nonzero(
                    (self.status == cfg.STATUS_QUARANTINE)
                    & (self.packs["status"].to_numpy(dtype=object) != cfg.STATUS_QUARANTINE)
                )
            ),
        }
