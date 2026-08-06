"""Acceptance tests for SafeFit-R against the supplied Problem 1 datasets.

These encode the brief's five verification rules plus the physical guarantees
SafeFit-R adds on top. They are the regression net for the onsite sprint: after
a twist module lands, this suite must still pass unchanged.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from bss_dispatch import config as cfg, physics, safefit
from bss_dispatch.safefit_run import run_hsf

DATA = Path(__file__).resolve().parent / "data"
BATTERIES = DATA / "batteries.csv"
VEHICLES = DATA / "vehicles.csv"

pytestmark = pytest.mark.skipif(
    not (BATTERIES.exists() and VEHICLES.exists()),
    reason="Problem 1 datasets not present in tests/data",
)


@pytest.fixture(scope="module")
def solved():
    packs = physics.derive_pack_physics(pd.read_csv(BATTERIES).pipe(_norm_bat))
    packs = safefit.apply_safety_gate(packs)
    packs = safefit.compute_geometric_bss(packs)
    missions = physics.derive_mission_physics(pd.read_csv(VEHICLES).pipe(_norm_veh))
    compat = physics.compatibility_matrix(packs, missions)
    assign = safefit.allocate_safefit(packs, missions, compat)
    return packs, missions, compat, assign


def _norm_bat(df):
    from bss_dispatch.data import normalize_batteries

    return normalize_batteries(df)


def _norm_veh(df):
    from bss_dispatch.data import normalize_vehicles

    return normalize_vehicles(df)


# --- the brief's five verification rules ----------------------------------


def test_no_unsafe_pack_is_allocated(solved):
    packs, _, _, assign = solved
    quarantined = set(packs.loc[packs["sf_status"] == cfg.STATUS_QUARANTINE, "battery_id"])
    allocated = set(assign.loc[assign["served"], "battery_id"])
    assert allocated & quarantined == set()


def test_no_battery_used_twice(solved):
    _, _, _, assign = solved
    served = assign[assign["served"]]
    assert served["battery_id"].is_unique


def test_no_vehicle_receives_two_batteries(solved):
    _, _, _, assign = solved
    assert assign["vehicle_id"].is_unique


def test_min_soc_is_satisfied(solved):
    _, _, _, assign = solved
    served = assign[assign["served"]]
    assert (served["SoC"] >= served["min_SoC"]).all()


def test_every_request_is_accounted_for(solved):
    _, missions, _, assign = solved
    assert len(assign) == len(missions)


# --- guarantees SafeFit-R adds beyond the brief ---------------------------


def test_every_allocation_can_finish_its_mission(solved):
    """The constraint min-SoC cannot express: energy, not percentage."""
    _, _, _, assign = solved
    served = assign[assign["served"]]
    assert (served["energy_margin_kWh"] >= 0).all()


def test_no_allocation_overheats_under_its_own_mission(solved):
    packs, _, _, assign = solved
    served = assign[assign["served"]]
    limit = cfg.CHEMISTRY[cfg.DEFAULT_CHEMISTRY]["T_max_C"]
    assert (served["projected_T_C"] <= limit).all()


def test_station_declared_quarantine_is_never_dispatched(solved):
    packs, _, _, assign = solved
    blocked = set(packs.loc[packs["phys_station_blocked"], "battery_id"])
    allocated = set(assign.loc[assign["served"], "battery_id"])
    assert allocated & blocked == set()


def test_classification_is_exhaustive_and_exclusive(solved):
    packs, _, _, _ = solved
    valid = {cfg.STATUS_SAFE, cfg.STATUS_DEGRADED, cfg.STATUS_QUARANTINE}
    assert set(packs["sf_status"]) <= valid
    assert packs["sf_status"].notna().all()
    assert len(packs) == len(packs["battery_id"].unique())


def test_bss_is_bounded_and_uses_four_dimensions(solved):
    packs, _, _, _ = solved
    assert packs["sf_BSS"].between(0.0, 100.0).all()
    for dim in ("sf_s_capacity", "sf_s_power", "sf_s_balance", "sf_s_thermal"):
        assert packs[dim].between(0.0, 1.0).all()


def test_geometric_mean_punishes_a_single_bad_dimension():
    """A pack strong everywhere but one must not outscore a balanced pack."""
    frame = pd.DataFrame(
        {
            "battery_id": ["LOPSIDED", "BALANCED"],
            "SoH": [99.0, 85.0],
            "dV_cell_mV": [95.0, 30.0],  # lopsided pack is nearly at the limit
            "phys_imbalance_derate": [0.08, 0.03],
            "phys_R_per_cell_mOhm": [3.0, 4.0],
            "phys_thermal_margin_C": [25.0, 24.0],
            "phys_thermal_excursion_C": [0.0, 0.0],
        }
    )
    scored = safefit.compute_geometric_bss(frame)
    lopsided, balanced = scored["sf_BSS"]
    assert lopsided < balanced


# --- baseline fidelity -----------------------------------------------------


def test_hsf_baseline_is_not_secretly_safety_filtered(solved):
    """The baseline must be free to make the mistake the brief expects of it."""
    packs, missions, _, _ = solved
    hsf = run_hsf(packs, missions)
    served = hsf[hsf["served"]]
    quarantined = set(packs.loc[packs["sf_status"] == cfg.STATUS_QUARANTINE, "battery_id"])
    # If this ever hits zero the baseline has been tampered with, not improved.
    assert len(set(served["battery_id"]) & quarantined) > 0


def test_hsf_picks_the_highest_soc_pack_available(solved):
    packs, missions, _, _ = solved
    hsf = run_hsf(packs, missions).set_index("vehicle_id")
    first = missions.sort_values("arrival_order").iloc[0]
    eligible = packs[packs["SoC"] >= float(first["min_SoC"])]
    assert hsf.loc[first["vehicle_id"], "SoC"] == eligible["SoC"].max()


# --- determinism -----------------------------------------------------------


def test_run_is_deterministic(solved):
    packs, missions, compat, assign = solved
    again = safefit.allocate_safefit(packs, missions, compat)
    pd.testing.assert_series_equal(
        assign["battery_id"], again["battery_id"], check_names=False
    )
