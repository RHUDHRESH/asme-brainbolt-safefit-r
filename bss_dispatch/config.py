"""Thresholds, MAUT/TOPSIS weights, and priority multipliers for BSS dispatch."""

from pathlib import Path

# Reproducibility
RANDOM_SEED = 42

# Fleet sizes (synthetic default)
N_BATTERIES = 200
N_VEHICLES = 50

# Pack nominals (15S 40 Ah 48 V LFP)
PACK_SERIES_CELLS = 15
PACK_CAPACITY_AH = 40.0
PACK_NOMINAL_V = 48.0

# --- Stage 1 integrity ---
ENERGY_RESIDUAL_TOL = 0.10  # ±10% Coulomb / capacity drift

# --- Stage 2 classification thresholds ---
T_SAFE_MIN = -5.0
T_SAFE_MAX = 45.0
T_DEGRADED_MAX = 50.0
T_COLD_MIN = -10.0

SOH_SAFE_MIN = 80.0
SOH_DEGRADED_MIN = 70.0

R_INT_SAFE_MAX = 100.0  # mOhm
R_INT_DEGRADED_MAX = 150.0  # mOhm

DV_SAFE_MAX = 50.0  # mV
DV_DEGRADED_MAX = 100.0  # mV

STATUS_SAFE = "Safe and Available"
STATUS_DEGRADED = "Degraded but Usable"
STATUS_QUARANTINE = "Unsafe / Quarantine"

# Priorities that may only receive Safe packs (not Degraded)
HIGH_DEMAND_PRIORITIES = frozenset({"Critical", "High"})

# --- Stage 3 MAUT weights (must sum to 1.0) ---
W_SOH = 0.40
W_TEMP = 0.15
W_IR = 0.25
W_IMB = 0.20

# MAUT sub-score anchors (spec formulas)
MAUT_T_REF = 25.0
MAUT_T_SPAN = 25.0
MAUT_IR_OFFSET = 10.0  # mOhm
MAUT_IR_SPAN = 140.0
MAUT_DV_OFFSET = 5.0  # mV
MAUT_DV_SPAN = 95.0

# TOPSIS: [SoC, SoH, R_int, ΔV] — SoC/SoH benefit; R_int/ΔV cost
TOPSIS_WEIGHTS = (0.35, 0.30, 0.20, 0.15)

# --- Priority multipliers ---
PRIORITY_WEIGHTS = {
    "Critical": 4.0,
    "High": 3.0,
    "Medium": 2.0,
    "Low": 1.0,
}

# Peak discharge current by priority (A) — I_payload for Joule penalty
PEAK_CURRENT_A = {
    "Critical": 55.0,
    "High": 45.0,
    "Medium": 30.0,
    "Low": 20.0,
}

# Stage 4–5 utility penalties
WAIT_PENALTY_GAMMA = 0.5  # utility points per minute of queue wait
JOULE_ALPHA = 0.05  # scales α · I² · R_int(Ω)
INFEASIBLE_UTILITY = -1.0e6

# --- SafeFit-R physics layer -------------------------------------------------
# Cell chemistry constants. Only LFP appears in Problem 1, but the table is the
# extension point for a "multiple chemistries" twist.
CHEMISTRY = {
    "LFP": {
        "cell_nominal_V": 3.2,
        "cell_max_V": 3.65,
        "cell_min_V": 2.50,
        "T_max_C": 55.0,  # discharge upper limit
        "T_min_C": -20.0,
        "T_derate_from_C": 45.0,
    },
}
DEFAULT_CHEMISTRY = "LFP"

# Station-declared status strings that block dispatch outright.
STATION_STATUS_BLOCKING = frozenset({"REVIEW/QUARANTINE", "QUARANTINE", "REVIEW"})

# Telemetry trust: |E_reported − E_usable| / E_usable above this → suspect.
ENERGY_TRUST_TOL = 0.10
# E_reported above the SoC-only ceiling is physically impossible, not just drifted.
ENERGY_CEILING_TOL = 1.005

# Aging-consistency screen: SoH is regressed on cycle_count and age_years across
# the supplied fleet; a pack whose residual exceeds this many robust sigmas has
# telemetry inconsistent with its own usage history.
AGING_RESIDUAL_SIGMA = 3.0
# End-of-life SoH for remaining-useful-life accounting.
SOH_EOL_PERCENT = 60.0

# Mission kinematics — DECLARED ASSUMPTIONS, not dataset facts. Used only to
# convert a range requirement into a current draw for the power-margin check.
VEHICLE_SPEED_KMH = {
    "Personal Commuter": 35.0,
    "Delivery Two-Wheeler": 30.0,
    "Campus Utility EV": 20.0,
}
DEFAULT_SPEED_KMH = 30.0
# Peak-to-average current ratio by payload class.
LOAD_PEAK_FACTOR = {"Light": 1.6, "Medium": 2.0, "Heavy": 2.6}
DEFAULT_PEAK_FACTOR = 2.0

# Pack lumped thermal capacity (J/K) for the Joule-rise estimate: ~12 kg at
# ~1000 J/(kg·K), the usual figure for a cased LFP light-EV pack.
PACK_THERMAL_CAPACITY_J_PER_K = 12_000.0
# Fraction of Joule heat retained over a mission (rest is convected away).
JOULE_RETENTION = 0.35

# Power margin: the pack must hold above this fraction of nominal under peak load.
SAG_FLOOR_FRACTION = 0.85
# Energy reserve required on top of the mission requirement.
ENERGY_RESERVE_FRACTION = 0.05

# --- SafeFit-R three-tier gate ----------------------------------------------
# Inferred from the supplied corpus, NOT universal LFP standards. The v1
# thresholds above are deliberately left untouched so the old policy stays
# runnable as an honest ablation.
SAFEFIT_SOH_QUARANTINE = 65.0
SAFEFIT_SOH_DEGRADED = 75.0
SAFEFIT_T_QUARANTINE = 48.0
SAFEFIT_T_DEGRADED = 42.0
SAFEFIT_DV_QUARANTINE = 100.0
SAFEFIT_DV_DEGRADED = 70.0
SAFEFIT_R_QUARANTINE = 120.0  # mOhm
SAFEFIT_R_DEGRADED = 80.0

# --- Lexicographic objective weights (Stage 4 best-fit) -----------------------
# Applied only after safety, priority service and total service are fixed.
COST_W_ENERGY_OVERSUPPLY = 1.0
COST_W_HEALTH_OVERSUPPLY = 1.2
COST_W_STRESS = 0.8
COST_W_TRUST = 2.0
COST_W_RESERVE = 1.5
# Big-M steps separating lexicographic tiers in the single-pass MILP objective.
LEX_STEP = 1.0e4

# Onsite twist toggles (default off; Twist C applied lightly in main when enabled)
TWIST_GRID_ENABLED = False
TWIST_TOU_ENABLED = False
TWIST_DEFECTION_ENABLED = True
TWIST_DEFECTION_FACTOR = 1.5
TWIST_DEFECTION_RATIO = 0.8  # boost when wait_min / W_max_min >= this

# Incident heuristics (pitch metrics)
THERMAL_STRESS_IR_MOHM = 100.0
VOLTAGE_COLLAPSE_IR_MOHM = 120.0
VOLTAGE_COLLAPSE_MIN_CURRENT_A = 40.0

# Paths
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "outputs"
BATTERIES_CSV = DATA_DIR / "batteries.csv"
VEHICLES_CSV = DATA_DIR / "vehicles.csv"
METRICS_JSON = OUTPUT_DIR / "metrics.json"
RUN_RESULT_JSON = OUTPUT_DIR / "run_result.json"
PLOT_PNG = OUTPUT_DIR / "bss_dispatch_simulation.png"
UPLOADS_DIR = DATA_DIR / "uploads"

BATTERY_REQUIRED_COLS = (
    "battery_id",
    "SoC",
    "SoH",
    "T",
    "T_24h_max",
    "R_int_mOhm",
    "dV_cell_mV",
)
VEHICLE_REQUIRED_COLS = ("vehicle_id", "priority", "min_SoC")
VEHICLE_PRIORITIES = frozenset({"Critical", "High", "Medium", "Low"})
