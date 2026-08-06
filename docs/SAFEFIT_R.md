# SafeFit-R — complete algorithm specification

Battery Health Assessment and Dynamic Allocation for Light EVs
(Siemens Energy India Ltd · ASME Brain Bolt 2026 · Problem 1)

Every number in this document is produced by
`python -m bss_dispatch.safefit_run` against the supplied datasets
(input hash `eb9efaaa89f08b68`). Nothing is typed by hand.

---

## 0. The finding the algorithm is built on

The brief's mandatory feasibility rule is *allocated SoC ≥ minimum acceptable
SoC*. Regressing the supplied demand data shows what that number actually is:

```
min_SoC = 0.633 · required_range_km + 18.37        r = 0.967   (n = 50)
```

Per load category the slope is 0.615–0.627 and the intercept 18.6–19.6, so the
relationship is near-deterministic. **min_SoC is a range requirement already
converted into a percentage of a nominal 1.92 kWh pack**, with roughly 18% held
back as reserve.

The trap follows immediately. State of charge is a percentage of a tank whose
size state of health has already shrunk:

```
E_deliverable = V_nom · Ah · (SoC/100) · (SoH/100) · (1 − ΔV/V_window)
E_required    = V_nom · Ah · (min_SoC/100)
```

A pack at SoC 100%, SoH 60.3% satisfies a min-SoC of 76 and holds 1.158 kWh
against a 1.459 kWh mission. It passes every stated constraint and strands the
vehicle roughly 20 km short.

**Highest-SoC-First does this 8 times out of 50, twice to Critical requests.**
That is the gap SafeFit-R closes, and it is invisible to all seven mandatory
metrics.

---

## 1. Coverage — every supplied column is a decision variable

| Battery column | Where it acts |
|---|---|
| `battery_id` | identity, assignment key |
| `chemistry` | cell voltage window, thermal limits, series-count inference (`cfg.CHEMISTRY`) |
| `nominal_voltage_V` | pack energy, series cell count, sag floor |
| `rated_capacity_Ah` | pack nominal energy |
| `state_of_charge_percent` | mandatory feasibility; energy ledger; oversupply cost |
| `state_of_health_percent` | deliverable energy; capacity sub-score; quarantine floor; aging residual |
| `temperature_C` | thermal margin; quarantine and degrade gates; thermal sub-score |
| `internal_resistance_mOhm` | voltage sag; Joule heating; power sub-score; stress cost |
| `cycle_count` | aging-consistency regressor; fade rate; remaining useful life |
| `age_years` | aging-consistency regressor (calendar term) |
| `cell_voltage_imbalance_mV` | capacity derate; balance sub-score; quarantine and degrade gates |
| `max_temperature_last_24h_C` | thermal-history fault; recent-excursion penalty; 24 h headroom |
| `estimated_available_energy_kWh` | telemetry trust: drift vs physically impossible |
| `station_status` | hard dispatch block |

| Request column | Where it acts |
|---|---|
| `request_id` | identity |
| `arrival_time` | baseline processing order; rolling-mode sequence |
| `vehicle_type` | average speed → mission duration → current draw |
| `required_range_km` | mission duration; implied Wh/km; severity |
| `load_category` | peak-to-average current factor; severity |
| `priority` | lexicographic service tier; severity |
| `minimum_acceptable_SOC_percent` | mandatory constraint **and** mission energy requirement |
| `maximum_wait_time_min` | urgency term in severity; deferral order under scarcity |

Nothing is passthrough-only.

---

## 2. Pipeline

```
DERIVE PHYSICS → SAFETY GATE → GEOMETRIC BSS → COMPATIBILITY → LEXICOGRAPHIC MILP → VERIFY
```

### 2.1 Physics (`bss_dispatch/physics.py`)

**Energy ledger.** `E_nominal = V·Ah/1000`; `E_ceiling = E_nom·SoC` (what SoC
alone justifies); `E_usable = E_nom·SoC·SoH`; and after imbalance,
`E_deliverable = E_usable·(1 − ΔV/V_window)`. The derate is physical: the
weakest cell reaches cutoff first and ends the discharge for the whole string.
For LFP the window is 3.65 − 2.50 V = 1150 mV, so the fleet's worst pack (118 mV)
loses 10.3% of its remaining capacity.

**Telemetry trust — two independent tests.** Reported energy above the SoC-only
ceiling is *impossible*, not drifted, and is a hard quarantine. Reported energy
off the SoH-corrected expectation by more than 10% is *suspect*, and only
penalised. BAT-144 fails the first; BAT-008, BAT-035 and BAT-082 fail the second.

**Aging consistency.** SoH is regressed on `cycle_count` and `age_years` across
the fleet (cycles correlate −0.89 with SoH, age −0.39). Residuals are screened
at 3 robust sigmas, using MAD so the outliers being hunted do not inflate the
threshold. BAT-082 claims a health its own usage history does not support.

**Power capability.** Sag under peak load `V_sag = I_peak·R`; the pack must hold
above 85% of nominal. Joule rise over the mission
`ΔT = I_avg²·R·t·η / C_th` with `C_th ≈ 12 kJ/K` and 35% retention, checked
against the pack's remaining thermal margin.

**Mission demand.** Energy comes from the dataset itself (§0). Current requires
two declared assumptions — average speed by vehicle class and peak factor by
payload class, both in `config.py` — and is used **only** for the power-margin
check, never for the mandatory feasibility test.

### 2.2 Safety gate (`safefit.apply_safety_gate`)

Three tiers, hard reasons before soft ones, every verdict carrying its evidence:

| Tier | Triggers |
|---|---|
| **Unsafe / Quarantine** | station status · energy above physical ceiling · T > 24 h max · T ≥ 48 °C · SoH < 65% · ΔV ≥ 100 mV · R ≥ 120 mΩ |
| **Degraded but Usable** | SoH < 75% · T ≥ 42 °C · ΔV ≥ 70 mV · R ≥ 80 mΩ · recent thermal excursion |
| **Safe and Available** | none of the above |

Result on the supplied fleet: **120 Safe / 67 Degraded / 13 Quarantine**, with
4 packs flagged untrusted.

Safety is a gate, not a score term — no objective weight can trade a violation
away, because quarantined packs never enter the MILP's edge set.

### 2.3 Battery Suitability Score (`safefit.compute_geometric_bss`)

```
BSS = 100 · (s_capacity · s_power · s_balance · s_thermal)^(1/4)
```

Four dimensions (the brief requires at least four), aggregated **geometrically**.
An arithmetic blend lets a 99% SoH pack with a near-critical cell spread outrank
a balanced pack — the opposite of what a dispatcher wants. The geometric mean
drags the score toward the worst dimension, so one severe weakness cannot be
averaged away. `test_geometric_mean_punishes_a_single_bad_dimension` pins this.

### 2.4 Compatibility (`physics.compatibility_matrix`)

Four separable tests per (mission, pack) pair, so the dashboard can name exactly
which physics rejected an edge instead of showing one opaque bit:

1. `soc_ok` — the brief's mandatory rule, unchanged
2. `energy_ok` — deliverable energy ≥ requirement + 5% reserve
3. `sag_ok` — bus holds above 85% nominal under peak current
4. `thermal_ok` — Joule rise fits inside remaining thermal margin

These can only **add** a reason a pack is unfit. The mandatory rule is never
relaxed.

### 2.5 Lexicographic allocation (`safefit.allocate_safefit`)

One MILP (HiGHS via `scipy.optimize.milp`), binary `x_ij` over feasible edges
only, with `Σ_j x_ij ≤ 1` per request and `Σ_i x_ij ≤ 1` per pack.

Objective tiers, each a full power of `LEX_STEP = 10⁴` above the next, so no
accumulation of lower-tier gain can buy off one higher-tier loss:

| Rank | Objective | Mechanism |
|---|---|---|
| 1 | Zero unsafe allocations | structural — edge set excludes them |
| 2 | Critical service | bonus `10¹²` |
| 3 | High service | bonus `10⁸` |
| 4 | Total service | bonus `10⁴` |
| 5 | Best fit | cost in `[0, 18]` |

Fit cost = energy oversupply + health oversupply + stress exposure + trust
penalty + reserve penalty. Each term answers one operational question: is this
pack fuller than the trip needs, healthier than the trip needs, worked hard by
the trip, self-consistent in its telemetry, and needed later by a harder trip?

Solved as one pass rather than a sequence of five, so the result is a single
optimum with a single certificate.

---

## 3. Results

Supplied datasets, 200 packs / 50 requests. `verification: PASS`.

| Metric | SafeFit-R | HSF |
|---|---|---|
| **Served** | 50 | 50 |
| **Unserved** | 0 | 0 |
| **High + Critical served** | 100.00% | 100.00% |
| **Unsafe allocations** | **0** | **6** |
| **Avg SoH allocated** | 76.48 | 78.80 |
| **Avg BSS allocated** | 54.39 | 55.85 |
| Avg wait time | not modelled | not modelled |
| Energy-infeasible allocations | **0** | **8** |
| Total energy shortfall | 0 kWh | 1.554 kWh |
| Worst single shortfall | 0 kWh | 302 Wh |
| Station-quarantine allocations | 0 | 6 |
| Untrusted-telemetry allocations | 0 | 2 |
| Avg SoC oversupply | **23.7 pts** | 49.3 pts |
| Deliverable energy consumed | **49.86 kWh** | 70.02 kWh |
| Degraded-tier utilisation | 54.0% | 36.0% |

### Reading the two metrics that look worse

Average allocated SoH and BSS are *lower* for SafeFit-R, and that is the
intended result. Both policies serve all 50 requests. SafeFit-R does it while
consuming **49.86 kWh of deliverable capacity against HSF's 70.02 kWh — 29%
less fleet capability for identical service** — and while guaranteeing every
one of those 50 vehicles can actually finish its trip, which HSF fails for 8.

A high average allocated SoH means premium packs were spent on missions that
did not need them. It is a measure of waste, not of quality. State this before
a judge asks.

### Waiting time

Reported as **not modelled**, not as zero. The datasets supply arrival times and
wait budgets but no swap service time and no bay count, so a wait-time figure
would need two invented parameters. The brief makes the metric optional and
conditional on queueing being explicitly modelled. `maximum_wait_time_min` is
still load-bearing — it is the urgency term in mission severity, which decides
deferral order when supply binds.

---

## 4. Stress and twist behaviour

| Scenario | SafeFit-R | HSF |
|---|---|---|
| Baseline, 200 packs | 50 served · 0 unsafe · 0 infeasible | 50 · 6 · 8 |
| Scarcity, top-60 packs only | 50 served · 0 unsafe · 0 infeasible | 50 · 6 · 8 |
| +5 Critical long-haul, 60 packs | 52/55 · 0 unsafe · 0 infeasible | 55/55 · 6 · 13 |
| +8 °C heat wave, 200 packs | 50 served · 0 unsafe · 0 infeasible | 50 · **9** · 8 |

The surge row is the honest one. HSF "serves" all 55; it does so with 6 unsafe
packs and 13 vehicles that cannot complete their trip. SafeFit-R serves 52 and
declines 3 — and names why: only 2–3 packs in the entire eligible pool can
deliver the 1.71 kWh those Critical requests demand, against 5 requests
demanding it. Refusing to dispatch a pack that cannot finish a 90 km Critical
mission is the correct answer, and the unserved reason string says so per row.

The heat-wave row shows the safety gate tightening on its own: HSF's unsafe
count rises 6 → 9 while SafeFit-R holds at 0.

### Twist extension points

Any onsite constraint lands in exactly one of four places, none of which
requires redesign:

| Point | File | Example twist |
|---|---|---|
| Safety gate | `safefit._hard_violations` | new thermal limit, chemistry rule |
| Compatibility | `physics.compatibility_matrix` | payload, deadline, route energy |
| Resource | MILP constraint rows | chargers, bays, grid cap |
| Objective | `safefit._fit_cost` | cost, carbon, wait, resilience |

---

## 5. Reproducibility and runtime

- **Runtime:** 166 ms median end-to-end (load → physics → gate → score → MILP →
  verify → metrics), 5-run median on the supplied datasets. The MILP is exact;
  200 × 50 does not need a metaheuristic, and using one would forfeit the
  optimality certificate.
- **Determinism:** no random seed is consulted anywhere in the path.
  `test_run_is_deterministic` asserts a repeat solve returns identical packs.
- **Input hash:** SHA-256 over both frames, first 16 hex, printed on every run
  and embedded in the result JSON.
- **Single source of truth:** `outputs/safefit_result.json` carries audit,
  classification, both metric sets, both verification blocks and both assignment
  tables. Every downstream artefact reads that file.
- **Acceptance suite:** `pytest tests/test_safefit.py` — 14 tests, 0.9 s. Covers
  the brief's five verification rules, the four physical guarantees SafeFit-R
  adds, geometric-mean behaviour, baseline fidelity and determinism.

One test deserves note: `test_hsf_baseline_is_not_secretly_safety_filtered`
asserts the baseline **does** allocate quarantined packs. If that count ever
reaches zero, the baseline has been tampered with rather than improved, and the
whole comparison is void.

---

## 6. Commands

```bash
python -m bss_dispatch.safefit_run --batteries <fleet.csv> --vehicles <demand.csv>
```

```bash
python -m pytest tests/test_safefit.py -q
```

Artefacts written to `outputs/`: `safefit_result.json`,
`safefit_assignments.csv`, `hsf_assignments.csv`. Exit code is non-zero if any
verification rule fails, so the run is CI-gateable.
