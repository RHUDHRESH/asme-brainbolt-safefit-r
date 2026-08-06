"""Parameters for the real-time (v2) BSS operating layer.

Single source of truth, exactly as `config.py` is for the v1 health core. Every
constant below is serialised into the run payload so a figure, a slide or a
dashboard tile can never drift from the value the solver actually used.

Provenance tags in the comments map each block to the paper that motivates it:
  [S15] Sarker, Pandzic, Ortega-Vazquez, IEEE Trans. Power Systems, 2015
  [C23] Cui et al., Energy, 2023 (review)
  [W18] Wu, IEEE Trans. Vehicular Technology, 2018
  [Y14] Yang et al., Energy, 2014
  [A13] Armstrong et al., Energy Policy, 2013
  [G23] Gong et al., IJEPES, 2023
"""

from __future__ import annotations

from pathlib import Path

from .. import config as cfg

# ---------------------------------------------------------------- clock ----
# 5-minute dispatch slot: fine enough that a swap decision is "real time"
# relative to the 2-19 min wait tolerances in the demand file, coarse enough
# that a receding-horizon MILP stays solvable every slot.
SLOT_MINUTES = 5
SLOTS_PER_HOUR = 60 // SLOT_MINUTES
SLOT_HOURS = SLOT_MINUTES / 60.0

# Simulation window. Starts two hours before the first arrival so the charging
# layer can pre-position inventory against the morning tariff step, and runs
# two hours past the last arrival so dispatched packs come back and are billed.
SIM_START_HOUR = 6.0    # 06:00
SIM_END_HOUR = 16.0     # 16:00
N_SLOTS = int((SIM_END_HOUR - SIM_START_HOUR) * SLOTS_PER_HOUR)

# Receding-horizon depth for the charging MILP (slots). 3 x 5 min = 15 min.
# Deep lookahead buys little here: because the objective prices readiness at
# its marginal value, tariff arbitrage falls out of comparing cost to value in
# each slot rather than out of horizon depth. The horizon is carried so the
# solve respects per-pack headroom and bay contention over the next few slots.
MPC_HORIZON_SLOTS = 3
# The C-rate menu makes packs near-interchangeable, so the MILP is highly
# symmetric and exhaustive branch-and-bound is wasted effort. Terminate on a
# 1% optimality gap or a wall-clock cap, whichever comes first, and take the
# incumbent -- which is feasible by construction and provably within the gap.
MILP_REL_GAP = 0.01
MILP_TIME_LIMIT_S = 0.35
# Look-ahead window used by the stochastic reserve, in minutes. Set to the
# median wait tolerance in the demand file: the reserve should cover the
# demand that would defect before the next charge cycle completes.
RESERVE_LOOKAHEAD_MIN = 30

# ------------------------------------------------------- station sizing ----
# [S15] models chargers as the scarce resource, not packs. A 200-pack rack with
# 20 bays is the realistic ratio for a light-EV station: bays carry the capex.
N_CHARGER_BAYS = 20
P_GRID_MAX_KW = 60.0          # transformer / sanctioned-load ceiling
SOC_TARGET_PCT = 95.0         # charge target; above this a bay is released
SOC_FLOOR_PCT = 5.0           # packs are never discharged below this

# --------------------------------------------------- charging behaviour ----
# [W18] the decision variable is the C-rate, not a binary on/off. 0 = idle.
C_RATE_MENU = (0.0, 0.25, 0.5, 1.0, 1.5, 2.0)
ETA_CHARGER = 0.94            # AC->DC conversion efficiency
CV_TAPER_SOC_PCT = 80.0       # CC-CV knee
CV_TAPER_C_RATE = 0.30        # effective ceiling above the knee
# Degraded packs are not allowed to fast-charge: high R_int means the same
# C-rate dumps far more heat into an already-compromised cell.
C_RATE_MAX_DEGRADED = 0.50

PACK_NOMINAL_KWH = cfg.PACK_NOMINAL_V * cfg.PACK_CAPACITY_AH / 1000.0  # 1.92

# ------------------------------------------ degradation model  [W18] -------
# Semi-empirical cycle + calendar fade. Cycle term carries a super-linear
# C-rate stress factor (the trade-off [W18] quantifies) and an Arrhenius
# temperature factor.
K_CYC_PCT_PER_EFC = 0.00667   # %SoH per equivalent full cycle at reference
C_RATE_REF = 0.5              # reference C-rate for the stress factor
BETA_C_RATE = 1.6             # stress exponent; >1 makes fast charging costly
EA_OVER_R_K = 3850.0          # Ea/R (K), Ea ~ 32 kJ/mol
T_REF_K = 298.15              # 25 degC
K_CAL_PCT_PER_HOUR = 2.283e-4  # 20% fade over 10 years at reference temp
# Ohmic growth couples to fade; slope is fitted from the fleet CSV at runtime
# and falls back to this if the fit is unavailable.
R_GROWTH_MOHM_PER_PCT_SOH = 1.11

# Monetisation: fade is only a trade-off once it has a price.
PACK_COST_INR_PER_KWH = 10_000.0
EOL_FADE_PCT = 20.0           # 100% -> 80% SoH defines end of life
PACK_REPLACEMENT_INR = PACK_NOMINAL_KWH * PACK_COST_INR_PER_KWH

# ------------------------------------------ electricity market  [S15][G23] --
# Indian commercial ToU shape (INR/kWh), indexed by hour of day.
TOU_TARIFF_INR_PER_KWH = {
    **{h: 5.50 for h in range(0, 6)},     # off-peak night
    **{h: 7.20 for h in range(6, 9)},     # normal morning
    **{h: 10.50 for h in range(9, 12)},   # morning peak
    **{h: 6.30 for h in range(12, 16)},   # solar-hours rebate
    **{h: 7.20 for h in range(16, 18)},   # normal
    **{h: 10.50 for h in range(18, 22)},  # evening peak
    **{h: 5.50 for h in range(22, 24)},   # off-peak night
}
# Sanctioned-demand charge, INR per kW of billing peak per month, amortised to
# a single operating day.
DEMAND_CHARGE_INR_PER_KW_MONTH = 350.0
DEMAND_CHARGE_INR_PER_KW_DAY = DEMAND_CHARGE_INR_PER_KW_MONTH / 30.0

# Demand-response event: the utility pays the station to hold below a cap.
DR_EVENT_ENABLED = False
DR_START_HOUR = 10.0
DR_END_HOUR = 11.0
DR_CAP_KW = 25.0
DR_PAYMENT_INR_PER_KWH_CURTAILED = 4.0

# ----------------------------------------- demand uncertainty  [S15][C23] --
N_SCENARIOS = 200             # scenario fan for the reserve / shadow price
SERVICE_LEVEL = 0.95          # reserve covers demand at this quantile
CVAR_ALPHA = 0.95             # tail level for the risk report
ARRIVAL_BUCKET_MIN = 30       # bucket width for the non-homogeneous rate fit

# Value of lost service, INR per defected request. Sets the exchange rate
# between service risk and money, so the reserve, the tariff and the
# degradation cost are all denominated in the same unit.
VOLL_INR = {
    "Critical": 500.0,
    "High": 300.0,
    "Medium": 120.0,
    "Low": 60.0,
}
SWAP_REVENUE_INR = 150.0
PREMIUM_PRIORITIES = frozenset({"Critical", "High"})

# ------------------------------------------- trip / return model  [Y14] ----
# Dispatched packs are not gone: they come back depleted and re-enter the
# charging queue. Closed-loop circulation is what makes inventory a state.
AVG_SPEED_KMPH = 25.0
WH_PER_KM = 25.0
DEFAULT_RANGE_KM = 40.0
RETURN_JITTER_MIN = 10.0      # spread on trip duration

# --------------------------------------------- real-time allocation --------
# Deferring a queued request one slot is an explicit alternative, priced by
# how close the rider is to walking out.
DEFER_BASE_COST = 2.0         # utility points per slot deferred
DEFER_URGENCY_EXP = 2.0       # convexity as wait -> W_max
SHADOW_PRICE_SCALE = 0.35     # converts INR of stockout risk to utility points

# Rolling defection-risk priority escalation, generalising v1's Twist C from a
# single step to a continuous ramp.
DEFECTION_RAMP_START = 0.5    # wait/W_max at which escalation begins
DEFECTION_MAX_FACTOR = 2.0    # multiplier at wait == W_max

# ----------------------------------------------------------- regimes -------
# Regime A reproduces the competition dataset as issued. Regime B is a declared
# stress test: the same station under the demand intensity the Tier-S papers
# actually study. Regime B synthesises arrivals by scaling the *observed*
# arrival process; it never edits the provided data.
REGIME_NOMINAL = "nominal"
REGIME_STRESS = "stress"
STRESS_DEMAND_MULTIPLIER = 4.0
STRESS_RESIDENT_PACKS = 60    # smaller rack: bays and inventory both bind
STRESS_N_BAYS = 10
STRESS_P_GRID_MAX_KW = 30.0

# ------------------------------------------------------------- paths -------
RT_OUTPUT_DIR = cfg.ROOT / "outputs" / "rt"
FIGURE_DIR = RT_OUTPUT_DIR / "figures"
RT_RESULTS_JSON = RT_OUTPUT_DIR / "rt_results.json"
ABLATION_JSON = RT_OUTPUT_DIR / "ablation.json"
MONTECARLO_JSON = RT_OUTPUT_DIR / "montecarlo.json"

RT_RANDOM_SEED = 2026


def tariff_at(hour_of_day: float) -> float:
    """INR/kWh for a wall-clock hour (fractional hours allowed)."""
    return TOU_TARIFF_INR_PER_KWH[int(hour_of_day) % 24]


def slot_to_hour(slot: int) -> float:
    """Wall-clock hour at the start of a slot index."""
    return SIM_START_HOUR + slot * SLOT_HOURS


def slot_to_clock(slot: int) -> str:
    """HH:MM label for a slot index."""
    total = int(round(SIM_START_HOUR * 60 + slot * SLOT_MINUTES))
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def as_dict() -> dict:
    """Serialisable snapshot of every parameter the run depended on."""
    return {
        "slot_minutes": SLOT_MINUTES,
        "n_slots": N_SLOTS,
        "sim_window": [SIM_START_HOUR, SIM_END_HOUR],
        "mpc_horizon_slots": MPC_HORIZON_SLOTS,
        "reserve_lookahead_min": RESERVE_LOOKAHEAD_MIN,
        "n_charger_bays": N_CHARGER_BAYS,
        "p_grid_max_kw": P_GRID_MAX_KW,
        "soc_target_pct": SOC_TARGET_PCT,
        "c_rate_menu": list(C_RATE_MENU),
        "eta_charger": ETA_CHARGER,
        "cv_taper_soc_pct": CV_TAPER_SOC_PCT,
        "cv_taper_c_rate": CV_TAPER_C_RATE,
        "c_rate_max_degraded": C_RATE_MAX_DEGRADED,
        "pack_nominal_kwh": PACK_NOMINAL_KWH,
        "degradation": {
            "k_cyc_pct_per_efc": K_CYC_PCT_PER_EFC,
            "c_rate_ref": C_RATE_REF,
            "beta_c_rate": BETA_C_RATE,
            "ea_over_r_k": EA_OVER_R_K,
            "t_ref_k": T_REF_K,
            "k_cal_pct_per_hour": K_CAL_PCT_PER_HOUR,
            "pack_replacement_inr": PACK_REPLACEMENT_INR,
            "eol_fade_pct": EOL_FADE_PCT,
        },
        "market": {
            "tou_inr_per_kwh": TOU_TARIFF_INR_PER_KWH,
            "demand_charge_inr_per_kw_day": DEMAND_CHARGE_INR_PER_KW_DAY,
            "dr_enabled": DR_EVENT_ENABLED,
            "dr_window": [DR_START_HOUR, DR_END_HOUR],
            "dr_cap_kw": DR_CAP_KW,
        },
        "uncertainty": {
            "n_scenarios": N_SCENARIOS,
            "service_level": SERVICE_LEVEL,
            "cvar_alpha": CVAR_ALPHA,
            "voll_inr": VOLL_INR,
        },
        "trip": {
            "avg_speed_kmph": AVG_SPEED_KMPH,
            "wh_per_km": WH_PER_KM,
        },
        "allocation": {
            "defer_base_cost": DEFER_BASE_COST,
            "shadow_price_scale": SHADOW_PRICE_SCALE,
            "defection_ramp_start": DEFECTION_RAMP_START,
            "defection_max_factor": DEFECTION_MAX_FACTOR,
        },
        "seed": RT_RANDOM_SEED,
    }


def ensure_dirs() -> None:
    for path in (RT_OUTPUT_DIR, FIGURE_DIR):
        Path(path).mkdir(parents=True, exist_ok=True)
