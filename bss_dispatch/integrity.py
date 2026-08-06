"""Stage 1: Sensor & telemetry integrity pre-screening."""

from __future__ import annotations

import pandas as pd

from . import config as cfg

INTEGRITY_COLS = (
    "V_pack_V",
    "V_cell_sum_V",
    "I_pack_A",
    "R_interconnect_Ohm",
    "E_reported_Wh",
)


def run_integrity_prescreen(batteries: pd.DataFrame) -> pd.DataFrame:
    """
    Cross-field consistency checks before electrochemical classification.

    - Thermal history: T > T_24h_max → quarantine (sensor_thermal)
    - Voltage conservation: |V_pack - ΣV_cell| > I·R_ic → quarantine (adc_voltage)
    - Energy residual > ±10% → recalibrate flag (not hard quarantine)
    """
    out = batteries.copy()
    n = len(out)
    integrity_quarantine = [False] * n
    integrity_reason = [""] * n
    recalibrate = [False] * n
    skipped: list[str] = []

    has_thermal = {"T", "T_24h_max"}.issubset(out.columns)
    has_voltage = {"V_pack_V", "V_cell_sum_V", "I_pack_A", "R_interconnect_Ohm"}.issubset(
        out.columns
    )
    has_energy = {"E_reported_Wh", "V_pack_V", "SoC", "SoH"}.issubset(out.columns)

    if not has_thermal:
        skipped.append("thermal")
    if not has_voltage:
        skipped.append("voltage")
    if not has_energy:
        skipped.append("energy")

    for i, row in out.iterrows():
        idx = out.index.get_loc(i)

        if has_thermal and float(row["T"]) > float(row["T_24h_max"]):
            integrity_quarantine[idx] = True
            integrity_reason[idx] = "sensor_thermal"
            continue

        if has_voltage:
            # Slack accounts for ADC noise around the I·R interconnect drop.
            dv_pack = abs(float(row["V_pack_V"]) - float(row["V_cell_sum_V"]))
            limit = float(row["I_pack_A"]) * float(row["R_interconnect_Ohm"]) + 0.05
            if dv_pack > limit:
                integrity_quarantine[idx] = True
                integrity_reason[idx] = "adc_voltage"
                continue

        if has_energy:
            e_expected = (
                float(row["V_pack_V"])
                * cfg.PACK_CAPACITY_AH
                * float(row["SoC"])
                / 100.0
                * float(row["SoH"])
                / 100.0
            )
            if e_expected > 1e-9:
                residual = abs(float(row["E_reported_Wh"]) - e_expected) / e_expected
                if residual > cfg.ENERGY_RESIDUAL_TOL:
                    recalibrate[idx] = True

    out["integrity_quarantine"] = integrity_quarantine
    out["integrity_reason"] = integrity_reason
    out["recalibrate_flag"] = recalibrate
    out.attrs["integrity_skipped"] = skipped
    return out
