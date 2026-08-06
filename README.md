# SafeFit-R — Battery Health Assessment and Dynamic Allocation for Light EVs

Solution to **Siemens Energy India · Problem Statement 2 Part 1**, ASME Brain
Bolt (The Engineers Sprint), IMECE India 2026 regional round.

Classify 200 battery packs, score their suitability, and allocate them to 50
vehicle requests without ever dispatching an unsafe pack — then beat the fixed
Highest-SoC-First baseline on evidence a judge can recompute.

---

## The finding the whole thing is built on

The brief's mandatory rule is *allocated SoC ≥ minimum acceptable SoC*.
Regressing the supplied demand data shows what that number actually is:

```
min_SoC = 0.633 × required_range_km + 18.37        r = 0.967  (n = 50)
```

So `min_SoC` is a **range requirement already expressed as a percentage of a
nominal 1.92 kWh pack**. But state of charge is a percentage of a tank that
state of health has already shrunk:

```
E_deliverable = V·Ah · (SoC/100) · (SoH/100) · (1 − ΔV/V_window)
E_required    = V·Ah · (min_SoC/100)
```

A pack at SoC 100%, SoH 60.3% satisfies a min-SoC of 76 and holds 1.158 kWh
against a 1.459 kWh mission. It passes every stated constraint and strands the
vehicle about 20 km short.

**Highest-SoC-First does this 8 times out of 50, twice to Critical requests** —
and not one of the seven mandatory metrics can see it.

---

## Results

200 packs / 50 requests, `verification: PASS`, 166 ms end-to-end.

| Metric | SafeFit-R | HSF |
|---|---|---|
| Served / Unserved | 50 / 0 | 50 / 0 |
| High + Critical served | 100% | 100% |
| **Unsafe allocations** | **0** | **6** |
| **Stranded en route** | **0** | **8** |
| Avg SoH allocated | 76.48 | 78.80 |
| Avg BSS allocated | 54.39 | 55.85 |
| Deliverable energy consumed | **49.86 kWh** | 70.02 kWh |
| Avg SoC oversupply | 23.7 pts | 49.3 pts |

Average allocated SoH is *lower* by design. Both policies serve all 50 requests;
SafeFit-R does it consuming **29% less fleet capability** while guaranteeing
every vehicle can finish its trip. A high average allocated SoH measures waste,
not quality.

Waiting time is reported as **not modelled**, not as zero — the datasets supply
arrival times and wait budgets but no service time or bay count, and the brief
makes the metric conditional on queueing actually being modelled.

---

## Pipeline

```
DERIVE PHYSICS → SAFETY GATE → GEOMETRIC BSS → COMPATIBILITY → LEXICOGRAPHIC MILP → VERIFY
```

- **Physics** (`bss_dispatch/physics.py`) — energy ledger, telemetry trust,
  aging consistency, power capability, mission demand. Every one of the 14
  battery columns and 8 request columns is a decision variable; nothing is
  passthrough-only.
- **Safety gate** (`bss_dispatch/safefit.py`) — three tiers with a per-pack
  evidence trail. Station declaration and physical impossibility outrank every
  health reading.
- **BSS** — `100 · (capacity · power · balance · thermal)^(1/4)`. Geometric, so
  one severe weakness cannot be averaged away.
- **Allocation** — one MILP (HiGHS) whose objective is a lexicographic ladder:
  zero unsafe → Critical → High → total service → best fit. Safety is
  structural: quarantined packs never enter the edge set.

Full specification with derivations: **[docs/SAFEFIT_R.md](docs/SAFEFIT_R.md)**.
Competition plan and weighted literature base: **[docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)**.

---

## Run it

The two input CSVs are **not in this repository** — see [Data](#data) below.
Put them at `tests/data/batteries.csv` and `tests/data/vehicles.csv`, or point
the flags anywhere you like:

```bash
pip install -r requirements.txt
python -m bss_dispatch.safefit_run --batteries tests/data/batteries.csv --vehicles tests/data/vehicles.csv
```

Writes to `outputs/`: `safefit_result.json`, `run_result.json` (the dashboard's
single source of truth), `safefit_assignments.csv`, `hsf_assignments.csv`.
Exit code is non-zero if any verification rule fails, so it is CI-gateable.

### Tests

```bash
python -m pytest tests/test_safefit.py -q
```

14 tests: the brief's five verification rules, the four physical guarantees
SafeFit-R adds, geometric-mean behaviour, baseline fidelity, determinism. The
suite skips itself cleanly when the datasets are absent, so a fresh clone
without the data does not report false failures.

One is worth naming: `test_hsf_baseline_is_not_secretly_safety_filtered` asserts
the baseline **does** allocate quarantined packs. If that ever reaches zero, the
baseline has been tampered with rather than improved, and the comparison is void.

### Dashboard

```bash
cd web && pnpm install && pnpm dev
```

Open <http://localhost:3000>. Results stay locked until two CSVs are uploaded
and run — there is no synthetic mode anywhere in the system.

---

## Reproducibility

- **Deterministic** — no random seed is consulted anywhere in the solve path.
- **Input hash** — SHA-256 over both frames, printed on every run and embedded
  in the result JSON.
- **One source of truth** — every dashboard figure, table and chart reads
  `outputs/run_result.json`. No number is typed by hand anywhere.

## Layout

```
bss_dispatch/      solver — physics, safety gate, scoring, MILP allocation
  rt/              real-time market/degradation layer (beyond the brief's scope)
tests/             acceptance suite + the supplied Problem 1 datasets
docs/              algorithm specification, competition build plan, method notes
web/               Next.js judge dashboard and diagnostics lab
outputs/           generated run artefacts and decks
scripts/           deck rendering and demo helpers
```

## Data

The 200-pack fleet dataset and 50-request demand dataset were supplied to all
competing teams by **Siemens Energy India** for this problem statement. They are
the organizer's material, not ours to redistribute, so they are **deliberately
excluded** from this repository along with every generated artefact derived from
them.

Everything needed to reproduce the published numbers is here — the solver, the
thresholds, the tests and the specification. Supply the two CSVs and you will
get the same input hash (`eb9efaaa89f08b68`) and the same results, because the
solve path consults no random seed.

Expected columns:

- **batteries** — `battery_id, chemistry, nominal_voltage_V, rated_capacity_Ah,
  state_of_charge_percent, state_of_health_percent, temperature_C,
  internal_resistance_mOhm, cycle_count, age_years, cell_voltage_imbalance_mV,
  max_temperature_last_24h_C, estimated_available_energy_kWh, station_status`
- **vehicles** — `request_id, arrival_time, vehicle_type, required_range_km,
  load_category, priority, minimum_acceptable_SOC_percent, maximum_wait_time_min`

Internal column names (`SoC`, `SoH`, `vehicle_id`, …) are accepted too; the
loader maps the Problem 1 names onto them automatically.
