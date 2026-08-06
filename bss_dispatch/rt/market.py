"""Electricity-market operation  [Sarker 2015; Yang 2014; Gong 2023].

A swapping station is a price-responsive industrial load with a sanctioned
connection limit. Three market facts drive the charging schedule:

  1. Energy is time-of-use priced, so *when* a pack is charged has a cost.
  2. Billing carries a demand charge on the peak kW, so the *shape* of the load
     has a cost independent of the energy.
  3. The connection has a hard ceiling, and the utility may pay the station to
     sit further below it during a demand-response event.

The ledger below is the station's meter: everything the scheduler spends is
booked here, so the reported bill is an accumulation of realised slots rather
than a formula evaluated after the fact.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import config_rt as rt


def price_at_slot(slot: int) -> float:
    """Energy price (INR/kWh) applying to a slot."""
    return rt.tariff_at(rt.slot_to_hour(slot))


def in_dr_event(slot: int) -> bool:
    if not rt.DR_EVENT_ENABLED:
        return False
    hour = rt.slot_to_hour(slot)
    return rt.DR_START_HOUR <= hour < rt.DR_END_HOUR


def power_cap_kw(slot: int, base_cap_kw: float) -> float:
    """Binding power ceiling for a slot: the connection, or the DR cap."""
    if in_dr_event(slot):
        return min(base_cap_kw, rt.DR_CAP_KW)
    return base_cap_kw


def price_curve(n_slots: int = rt.N_SLOTS) -> list[float]:
    return [price_at_slot(s) for s in range(n_slots)]


@dataclass
class MarketLedger:
    """Accumulates the station's electricity bill slot by slot."""

    base_cap_kw: float = rt.P_GRID_MAX_KW
    energy_kwh: float = 0.0
    energy_cost_inr: float = 0.0
    joule_loss_kwh: float = 0.0
    peak_kw: float = 0.0
    dr_curtailed_kwh: float = 0.0
    dr_payment_inr: float = 0.0
    load_kw_by_slot: list[float] = field(default_factory=list)
    price_by_slot: list[float] = field(default_factory=list)
    cost_by_slot: list[float] = field(default_factory=list)

    def record_slot(
        self,
        slot: int,
        load_kw: float,
        joule_kw: float = 0.0,
        unconstrained_load_kw: float | None = None,
    ) -> None:
        """Book one slot of realised station load.

        `unconstrained_load_kw` is what the station *would* have drawn absent
        the DR cap; the difference is the curtailment the utility pays for.
        """
        price = price_at_slot(slot)
        hours = rt.SLOT_HOURS
        kwh = load_kw * hours

        self.energy_kwh += kwh
        self.energy_cost_inr += kwh * price
        self.joule_loss_kwh += joule_kw * hours
        self.peak_kw = max(self.peak_kw, load_kw)

        if in_dr_event(slot) and unconstrained_load_kw is not None:
            curtailed = max(0.0, unconstrained_load_kw - load_kw) * hours
            self.dr_curtailed_kwh += curtailed
            self.dr_payment_inr += curtailed * rt.DR_PAYMENT_INR_PER_KWH_CURTAILED

        self.load_kw_by_slot.append(float(load_kw))
        self.price_by_slot.append(float(price))
        self.cost_by_slot.append(float(kwh * price))

    @property
    def demand_charge_inr(self) -> float:
        return self.peak_kw * rt.DEMAND_CHARGE_INR_PER_KW_DAY

    @property
    def total_electricity_inr(self) -> float:
        return self.energy_cost_inr + self.demand_charge_inr - self.dr_payment_inr

    @property
    def avg_price_paid(self) -> float:
        """Volume-weighted price actually achieved (INR/kWh).

        Compared against the flat time-average of the tariff, this is the
        single number that says whether the scheduler shopped well.
        """
        return self.energy_cost_inr / self.energy_kwh if self.energy_kwh > 1e-9 else 0.0

    def summary(self) -> dict:
        return {
            "energy_kwh": round(self.energy_kwh, 3),
            "energy_cost_inr": round(self.energy_cost_inr, 2),
            "joule_loss_kwh": round(self.joule_loss_kwh, 4),
            "peak_kw": round(self.peak_kw, 3),
            "demand_charge_inr": round(self.demand_charge_inr, 2),
            "dr_curtailed_kwh": round(self.dr_curtailed_kwh, 3),
            "dr_payment_inr": round(self.dr_payment_inr, 2),
            "total_electricity_inr": round(self.total_electricity_inr, 2),
            "avg_price_paid_inr_per_kwh": round(self.avg_price_paid, 4),
            "grid_cap_kw": self.base_cap_kw,
            "cap_utilisation_pct": round(
                100.0 * self.peak_kw / self.base_cap_kw, 2
            )
            if self.base_cap_kw
            else 0.0,
        }
