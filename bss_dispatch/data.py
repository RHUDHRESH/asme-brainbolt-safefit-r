"""Measured CSV loading and competition-schema normalisation.

There is no synthetic generator in this module by design: every figure the
system produces must trace back to a file the operator actually supplied.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from . import config as cfg


def load_csv(
    batteries_path: Path | None = None,
    vehicles_path: Path | None = None,
    *,
    require: bool = False,
) -> tuple[pd.DataFrame, pd.DataFrame] | None:
    """Load battery + vehicle CSVs. If require=True, missing files raise."""
    bat_path = Path(batteries_path) if batteries_path else cfg.BATTERIES_CSV
    veh_path = Path(vehicles_path) if vehicles_path else cfg.VEHICLES_CSV

    if not bat_path.exists() or not veh_path.exists():
        if require:
            missing = []
            if not bat_path.exists():
                missing.append(f"batteries file not found: {bat_path}")
            if not veh_path.exists():
                missing.append(f"vehicles file not found: {veh_path}")
            raise FileNotFoundError("; ".join(missing))
        return None

    try:
        batteries = pd.read_csv(bat_path)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Failed to read batteries CSV ({bat_path}): {exc}") from exc
    try:
        vehicles = pd.read_csv(veh_path)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Failed to read vehicles CSV ({veh_path}): {exc}") from exc

    batteries = normalize_batteries(batteries)
    vehicles = normalize_vehicles(vehicles)
    _validate_batteries(batteries)
    _validate_vehicles(vehicles)
    return batteries, vehicles


# ASME Problem 1 / competition column names → internal solver schema
BATTERY_COLUMN_ALIASES: dict[str, str] = {
    "state_of_charge_percent": "SoC",
    "state_of_health_percent": "SoH",
    "temperature_C": "T",
    "max_temperature_last_24h_C": "T_24h_max",
    "internal_resistance_mOhm": "R_int_mOhm",
    "cell_voltage_imbalance_mV": "dV_cell_mV",
    # Descriptive passthrough — surfaced in the dashboard, not used for gating
    "estimated_available_energy_kWh": "E_avail_kWh",
    "nominal_voltage_V": "V_nom",
    "rated_capacity_Ah": "Ah_rated",
}

VEHICLE_COLUMN_ALIASES: dict[str, str] = {
    "request_id": "vehicle_id",
    "minimum_acceptable_SOC_percent": "min_SoC",
    "maximum_wait_time_min": "W_max_min",
    "required_range_km": "range_km",
}

PRIORITY_ALIASES: dict[str, str] = {
    "normal": "Medium",
    "medium": "Medium",
    "critical": "Critical",
    "high": "High",
    "low": "Low",
}


def _rename_aliases(df: pd.DataFrame, aliases: dict[str, str]) -> pd.DataFrame:
    """Rename alias columns to internal names when the target is absent.

    Matching is case-insensitive on the source side.
    """
    out = df.copy()
    lower_map = {str(c).strip().lower(): c for c in out.columns}
    rename: dict[str, str] = {}
    for src, dest in aliases.items():
        src_key = src.lower()
        if src_key in lower_map and dest not in out.columns:
            rename[lower_map[src_key]] = dest
    if rename:
        out = out.rename(columns=rename)
    return out


def normalize_batteries(df: pd.DataFrame) -> pd.DataFrame:
    """Map Problem 1 battery columns onto the internal schema."""
    return _rename_aliases(df, BATTERY_COLUMN_ALIASES)


def normalize_vehicles(df: pd.DataFrame) -> pd.DataFrame:
    """Map Problem 1 demand columns; Normal → Medium; derive arrival_order."""
    out = _rename_aliases(df, VEHICLE_COLUMN_ALIASES)

    if "priority" in out.columns:
        mapped = (
            out["priority"]
            .astype(str)
            .str.strip()
            .map(lambda p: PRIORITY_ALIASES.get(p.lower(), p))
        )
        out["priority"] = mapped

    if "arrival_order" not in out.columns and "arrival_time" in out.columns:
        keyed = pd.to_datetime(out["arrival_time"], errors="coerce")
        order_idx = keyed.argsort(kind="mergesort")
        ranks = np.empty(len(out), dtype=int)
        ranks[order_idx.to_numpy()] = np.arange(1, len(out) + 1)
        out["arrival_order"] = ranks

    return out


def load_measured(
    batteries_path: Path | str | None = None,
    vehicles_path: Path | str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, str]:
    """Load real measured fleet and demand CSVs. Never fabricates data.

    The solver runs on measured inputs only. There is deliberately no synthetic
    fallback: a run that silently invented its own fleet would produce metrics
    indistinguishable from a real one in every artefact downstream.
    """
    if batteries_path and vehicles_path:
        loaded = load_csv(Path(batteries_path), Path(vehicles_path), require=True)
        assert loaded is not None
        return loaded[0], loaded[1], "upload"

    loaded = load_csv()
    if loaded is not None:
        return loaded[0], loaded[1], "csv"

    raise FileNotFoundError(
        "No input data. Supply --batteries and --vehicles, or place "
        f"{cfg.BATTERIES_CSV.name} and {cfg.VEHICLES_CSV.name} in {cfg.DATA_DIR}. "
        "This solver has no synthetic mode."
    )


def _validate_batteries(df: pd.DataFrame) -> None:
    if df.empty:
        raise ValueError("batteries.csv has no data rows")
    required = set(cfg.BATTERY_REQUIRED_COLS)
    missing = required - set(df.columns)
    if missing:
        raise ValueError(
            "batteries.csv missing required columns: "
            f"{sorted(missing)}. Found: {list(df.columns)}"
        )
    for col in ("SoC", "SoH", "T", "T_24h_max", "R_int_mOhm", "dV_cell_mV"):
        if df[col].isna().any():
            raise ValueError(f"batteries.csv has null values in column '{col}'")


def _validate_vehicles(df: pd.DataFrame) -> None:
    if df.empty:
        raise ValueError("vehicles.csv has no data rows")
    required = set(cfg.VEHICLE_REQUIRED_COLS)
    missing = required - set(df.columns)
    if missing:
        raise ValueError(
            "vehicles.csv missing required columns: "
            f"{sorted(missing)}. Found: {list(df.columns)}"
        )
    bad = set(df["priority"].astype(str).unique()) - cfg.VEHICLE_PRIORITIES
    if bad:
        raise ValueError(
            "vehicles.csv has invalid priority values: "
            f"{sorted(bad)}. Allowed: {sorted(cfg.VEHICLE_PRIORITIES)}"
        )
    if df["min_SoC"].isna().any():
        raise ValueError("vehicles.csv has null values in column 'min_SoC'")
