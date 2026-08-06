# Battery Health Assessment & Dynamic Allocation for Light EVs
### Siemens Energy · ASME Brain Bolt 2026 · Problem Statement 2, Part 1 — Method & Compliance Document

**System:** Python 5-stage solver + Next.js operations dashboard
**Datasets:** `Problem_1_Battery_Fleet_200_Packs.csv` (200 packs) · `Problem_1_Vehicle_Demand_50_Requests.csv` (50 requests)
**Reproduce:** `python -m bss_dispatch --batteries <fleet.csv> --vehicles <demand.csv>`

---

## 0 · Compliance matrix

Every mandatory item from the problem statement, and exactly where it is satisfied.

### Mandatory tasks

| # | Requirement | Where | Status |
|---|---|---|---|
| 1 | Classify every battery into exactly one of three categories | `classify.py` → Stage 2 | ✅ 200/200 classified, mutually exclusive |
| 2 | Suitability score 0–100 from ≥ 4 health parameters | `score.py` → MAUT over SoH, R_int, ΔV_cell, T | ✅ 4 parameters, plus TOPSIS cross-check |
| 3 | Allocate: no unsafe, ≤1 battery/vehicle, ≤1 vehicle/battery, meets min SoC | `allocate.py` → hard constraints + Hungarian | ✅ all four enforced structurally |
| 4 | Account for vehicle priority | Priority multiplier `P_class` in the utility matrix | ✅ 4.0 / 3.0 / 2.0 / 1.0 |
| 5 | Implement through actual coding or simulation | Runnable Python package, no notebooks | ✅ |
| 6 | Data analysis and visualization | 4-panel matplotlib PNG + judge page (`/`) with three charts + exact reason panel; deep lab at `/lab` | ✅ |
| 7 | Quantitatively validate | `metrics.py` → all mandatory outputs recomputed from assignment rows | ✅ |
| 8 | Compare against Highest-SoC-First | `allocate.py::run_hsf_dispatch`, identical inputs | ✅ |
| 9 | Respond to unseen 30% onsite twist | `twists.py` → 3 hooks on the same core solver | ✅ see §8 |

### Mandatory quantitative outputs — real dataset

| # | Output | Proposed | Baseline (HSF) |
|---|---|---|---|
| 1 | Successfully served vehicles | **50 / 50** | 50 / 50 |
| 2 | Unserved vehicles | **0** | 0 |
| 3 | High & Critical priority served | **100.0 %** | 100.0 % |
| 4 | Unsafe battery allocations | **0** | **12** |
| 5 | Average SoH of allocated packs | **90.7 %** | 78.8 % |
| 6 | Average suitability score (BSS) | **81.4 / 100** | 67.9 / 100 |
| 7 | *(optional)* average waiting time | not modelled — see §9.3 | — |

**The headline:** both policies serve every request. The baseline achieves that by handing **12 quarantined packs** to riders. The proposed method serves the same 50 with **zero** safety violations and **+11.9 pp** average state of health.

### Mandatory visual outputs

Requirement is "at least three". Delivered: **four static** (`outputs/bss_dispatch_simulation.png`) plus **ten interactive dashboard zones**.

| Required example | Delivered |
|---|---|
| Battery-health / suitability-score distribution | Static panel 1 (MAUT vs TOPSIS scatter) · Judge page: classification + BSS copy · Lab Scoring zone |
| Vehicle allocation results by priority | Static panel 2 · Judge page priority chart · Lab Diagnostics |
| Proposed vs HSF baseline | Static panel 3 · Judge page KPI strip + compare chart · Lab Policy / Compare |
| Unsafe / quarantined batteries identified | Static panel 4 · Judge page quarantine reason list (code + full form) + gate checklist |

### Verification rules

| # | Rule | How it is guaranteed |
|---|---|---|
| 1 | Unsafe battery never allocated | Quarantined packs are **removed from the candidate matrix before it is built** (`allocate.py:56`). Not a penalty — they are not representable in the solution space. Asserted at exit: run fails loudly if violated. |
| 2 | A battery cannot serve two vehicles | Hungarian assignment returns a matching — each column used at most once by construction. |
| 3 | A vehicle cannot receive two batteries | Each row used at most once by construction. |
| 4 | Allocated battery satisfies min acceptable SoC | `SoC < min_SoC` edges are set to `INFEASIBLE_UTILITY` and masked to cost `1e9`, then discarded post-solve if still selected. |
| 5 | Results reproducible from datasets + code | Deterministic. `RANDOM_SEED = 42`; no randomness on the CSV path at all. Full assignment rows exported to `outputs/run_result.json`. |

---

## 1 · Input contract

The solver accepts the competition schema directly and normalises it to an internal one. **No manual pre-processing of the provided CSVs is required.**

### Battery fleet mapping (`data.py::BATTERY_COLUMN_ALIASES`)

| Competition column | Internal | Role |
|---|---|---|
| `state_of_charge_percent` | `SoC` | feasibility test |
| `state_of_health_percent` | `SoH` | gate + score |
| `temperature_C` | `T` | gate + score |
| `max_temperature_last_24h_C` | `T_24h_max` | integrity cross-check |
| `internal_resistance_mOhm` | `R_int_mOhm` | gate + score + Joule term |
| `cell_voltage_imbalance_mV` | `dV_cell_mV` | gate + score |
| `estimated_available_energy_kWh` | `E_avail_kWh` | display |
| `nominal_voltage_V`, `rated_capacity_Ah` | `V_nom`, `Ah_rated` | display |
| `cycle_count`, `age_years`, `chemistry`, `station_status` | pass-through | display / provenance |

### Vehicle demand mapping (`data.py::VEHICLE_COLUMN_ALIASES`)

| Competition column | Internal | Role |
|---|---|---|
| `request_id` | `vehicle_id` | key |
| `minimum_acceptable_SOC_percent` | `min_SoC` | **hard feasibility constraint** |
| `maximum_wait_time_min` | `W_max_min` | twist hook input |
| `required_range_km` | `range_km` | display |
| `arrival_time` | → `arrival_order` | **HSF baseline ordering** |
| `priority` | `priority` | utility multiplier |
| `vehicle_type`, `load_category` | pass-through | display |

**Priority normalisation.** The demand file uses `Critical / High / Normal`. `Normal → Medium` (`PRIORITY_ALIASES`), giving the four-tier scheme. On this dataset: **Critical 4, High 22, Medium 24, Low 0**.

**Arrival order derivation.** `arrival_time` is parsed and rank-ordered with a stable mergesort. This matters: the baseline is *defined* as processing "in arrival order", so getting this wrong would invalidate the comparison.

---

## 2 · Stage 1 — Sensor & telemetry integrity pre-screen

**Module:** `integrity.py` · **Principle:** a reading you cannot trust is more dangerous than a reading you know is bad.

Runs **before** any electrochemical rule. Three cross-field consistency tests, each self-skipping when its input columns are absent.

### 2.1 Thermal history conservation → hard quarantine

$$T_{\text{now}} > T_{24\text{h,max}} \;\Rightarrow\; \texttt{sensor\_thermal}$$

The 24-hour maximum cannot be lower than the current reading — it is a running maximum that includes now. If it is, either the thermistor or its logger is faulty. **The pack is quarantined for untrustworthiness, not for measured harm.**

### 2.2 Voltage conservation (Kirchhoff) → hard quarantine

$$\bigl|V_{\text{pack}} - \textstyle\sum V_{\text{cell}}\bigr| > I_{\text{pack}} \cdot R_{\text{interconnect}} + 0.05\ \text{V} \;\Rightarrow\; \texttt{adc\_voltage}$$

Terminal voltage must equal the cell-sum plus the ohmic drop across the interconnects. The 50 mV slack absorbs ADC noise. A breach means a broken sense line or a miscalibrated ADC.

### 2.3 Energy bookkeeping → soft recalibration flag

$$E_{\text{expected}} = V_{\text{pack}} \cdot Q_{\text{rated}} \cdot \frac{\text{SoC}}{100} \cdot \frac{\text{SoH}}{100}, \qquad \left|\frac{E_{\text{reported}} - E_{\text{expected}}}{E_{\text{expected}}}\right| > 0.10$$

Coulomb-counting drift. **This is deliberately *not* a quarantine** — it flags the BMS for recalibration while leaving the pack dispatchable, because drift in the fuel gauge is not a safety hazard.

> **On the competition dataset:** only test 2.1 can run — the fleet CSV supplies no `V_pack_V`, `I_pack_A`, `R_interconnect_Ohm` or `E_reported_Wh` columns. The solver reports `Stage 1 skipped checks (missing columns): voltage, energy` rather than silently passing. **3 packs** fail 2.1.

---

## 3 · Stage 2 — Multi-physical safety gating & 3-tier classification

**Module:** `classify.py` · Satisfies **mandatory task 1**.

### 3.1 Thresholds (`config.py` — single source of truth)

| Parameter | Safe band | Degraded band | Hard block |
|---|---|---|---|
| Temperature `T` | −5 … 45 °C | 45 < T ≤ 50 °C | > 50 °C or < −10 °C |
| State of health `SoH` | ≥ 80 % | 70 … 80 % | < 70 % |
| Internal resistance `R_int` | < 100 mΩ | 100 … 150 mΩ | > 150 mΩ |
| Cell imbalance `ΔV_cell` | < 50 mV | 50 … 100 mV | > 100 mV |

### 3.2 Decision procedure — strict precedence

Classification is **not** a score. It is a short-circuiting rule cascade, evaluated in this exact order:

```
1.  integrity_quarantine ................ → Unsafe / Quarantine  (reason = integrity_reason)
2.  T > 50 °C ........................... → Unsafe / Quarantine  (T_high)
3.  T < −10 °C .......................... → Unsafe / Quarantine  (T_cold)
4.  SoH < 70 % .......................... → Unsafe / Quarantine  (SoH_low)
5.  R_int > 150 mΩ ...................... → Unsafe / Quarantine  (R_int_high)
6.  ΔV_cell > 100 mV .................... → Unsafe / Quarantine  (dV_high)
7.  ALL of: −5 ≤ T ≤ 45, SoH ≥ 80,
    R_int < 100, ΔV < 50 ................ → Safe and Available
8.  otherwise ........................... → Degraded but Usable
```

**Consequences of this design:**

- **Exactly one category per pack** — the cascade returns on first match, so categories are mutually exclusive and collectively exhaustive. Satisfies mandatory task 1 literally.
- **Any single hard breach is sufficient.** A pack with a perfect SoH of 99 % and ΔV of 110 mV is quarantined. There is no averaging across parameters at the safety layer — that is the entire point of separating gating from scoring.
- **One recorded reason per pack**, being the *first* rule that fired. The dashboard surfaces this precedence explicitly so a judge can see why a pack with two breaches reports only one.
- **Degraded is a residual class**, not a positively-defined one: everything that survives the hard gates but misses at least one safe band.

### 3.3 Result — real dataset

| Class | Count | Share |
|---|---|---|
| Safe and Available | 89 | 44.5 % |
| Degraded but Usable | 78 | 39.0 % |
| Unsafe / Quarantine | 33 | 16.5 % |

**Quarantine root cause** (first rule to fire):

| Trigger | Count | Share of blocked |
|---|---|---|
| `SoH_low` — state of health below 70 % | 29 | 87.9 % |
| `sensor_thermal` — T₂₄ₕ < T_now | 3 | 9.1 % |
| `dV_high` — imbalance above 100 mV | 1 | 3.0 % |

Notably **zero** packs are blocked on temperature or resistance: this fleet's maxima are ≈ 53 °C on one pack and ≈ 90 mΩ, both inside the hard limits. Degradation in this fleet presents as capacity fade, not thermal runaway.

---

## 4 · Stage 3 — Battery Suitability Score (dual engine)

**Module:** `score.py` · Satisfies **mandatory task 2** (0–100, ≥ 4 parameters).

### 4.1 Engine A — MAUT (Multi-Attribute Utility Theory)

$$\boxed{\;\text{BSS}_j = 0.40\,S_{\text{SoH}} + 0.25\,S_{\text{IR}} + 0.20\,S_{\text{Imb}} + 0.15\,S_{T}\;}$$

Weights sum to exactly 1.00, so BSS is bounded on **[0, 100]** by construction.

Each physical parameter is normalised to a 0–100 utility before weighting:

| Sub-score | Formula | Shape | Anchors |
|---|---|---|---|
| $S_{\text{SoH}}$ | $\text{SoH}$ | identity | already a 0–100 percentage |
| $S_{\text{IR}}$ | $100 \cdot \max\!\left(0,\; 1 - \dfrac{R_{\text{int}} - 10}{140}\right)$ | inverted linear cost | 10 mΩ → 100 pts, 150 mΩ → 0 pts |
| $S_{\text{Imb}}$ | $100 \cdot \max\!\left(0,\; 1 - \dfrac{\Delta V - 5}{95}\right)$ | inverted linear cost | 5 mV → 100 pts, 100 mV → 0 pts |
| $S_{T}$ | $100 \cdot \max\!\left(0,\; 1 - \dfrac{\lvert T - 25\rvert}{25}\right)$ | symmetric tent | peak at 25 °C, zero at 0 °C and 50 °C |

**Why these weights.** SoH at 0.40 dominates because it sets the range the rider actually gets. R_int at 0.25 is second because it drives $I^2R$ heating and voltage sag under load — the failure mode the baseline is blind to. Imbalance at 0.20 captures the weakest-cell floor. Temperature at 0.15 is lowest because it is the most transient: a hot pack cools, a degraded pack does not.

**Why the anchors are where they are.** The cost-curve endpoints deliberately coincide with the Stage-2 hard limits (150 mΩ, 100 mV). A pack at the edge of quarantine scores exactly 0 on that term. The $S_T$ tent is centred on 25 °C room temperature and reaches zero at both 0 °C and 50 °C, penalising cold as well as heat — cold raises resistance and cuts deliverable current.

**The `max(0, ·)` clamp** prevents a single catastrophic parameter from driving the term negative and cannibalising the others. Below the floor the term contributes nothing; it cannot contribute *less* than nothing.

### 4.2 Engine B — TOPSIS (Technique for Order Preference by Similarity to Ideal Solution)

An independent second opinion on the same packs, over the attribute vector $[\text{SoC}, \text{SoH}, R_{\text{int}}, \Delta V]$ with weights $[0.35, 0.30, 0.20, 0.15]$.

**Step 1 — vector normalisation** (removes units so attributes are comparable):
$$r_{ij} = \frac{x_{ij}}{\sqrt{\sum_{k} x_{kj}^{2}}}$$

**Step 2 — weighting:** $v_{ij} = w_j \cdot r_{ij}$

**Step 3 — ideal and anti-ideal points.** SoC and SoH are *benefit* criteria (more is better); R_int and ΔV are *cost* criteria (less is better):
$$A^{+} = \{\max_i v_{ij}\ \text{for benefit},\; \min_i v_{ij}\ \text{for cost}\}, \qquad A^{-} = \text{the converse}$$

**Step 4 — Euclidean separation:**
$$d_i^{+} = \sqrt{\sum_j (v_{ij} - A_j^{+})^2}, \qquad d_i^{-} = \sqrt{\sum_j (v_{ij} - A_j^{-})^2}$$

**Step 5 — relative closeness:**
$$T_{\text{score},i} = 100 \cdot \frac{d_i^{-}}{d_i^{+} + d_i^{-}}$$

**Two engines, deliberately different.** MAUT is *absolute* — a pack's score does not depend on the rest of the fleet. TOPSIS is *relative* — it ranks against the best and worst actually present. TOPSIS also includes SoC, which MAUT excludes on purpose. Agreement between them is evidence the ranking is a property of the packs and not an artefact of one weighting choice. **Quarantined packs receive `NaN` T_score** — they are excluded from the normalisation basis so they cannot distort the ideal points.

**Only MAUT BSS enters the allocation utility.** TOPSIS is a validation instrument, reported alongside but never load-bearing.

---

## 5 · Stage 4 — Priority-weighted bipartite matching

**Module:** `allocate.py` · Satisfies **mandatory tasks 3 and 4**.

### 5.1 Feasibility — three hard constraints

An edge between request $i$ and pack $j$ exists **only if all three hold**:

```
(a)  status_j ≠ Unsafe / Quarantine        ← verification rule 1
(b)  SoC_j ≥ min_SoC_i                     ← verification rule 4
(c)  ¬(status_j = Degraded ∧ priority_i ∈ {Critical, High})
```

Constraint **(c)** is a design decision beyond the letter of the problem statement: a Degraded pack is legal to dispatch, but not to a Critical or High-priority request. Those tiers carry the heaviest duty cycles and tightest wait tolerances, which is exactly where a marginal pack is most likely to fail. On this dataset (c) removes 41 otherwise-feasible packs from a typical Critical request's pool.

Infeasible edges are initialised to $-10^6$ and, after the cost transform, masked to $10^9$ — they cannot be selected.

### 5.2 The utility function

For every feasible pairing:

$$\boxed{\;U_{i,j} = \underbrace{P_{\text{class},i} \cdot \text{BSS}_j}_{\text{priority} \times \text{suitability}} \;-\; \underbrace{\gamma \cdot W_i}_{\text{queue wait}} \;-\; \underbrace{\alpha \cdot I_{\text{payload},i}^{2} \cdot R_{\text{int},j}}_{\text{Joule load-match}}\;}$$

with $\gamma = 0.5$ utility-points per minute and $\alpha = 0.05$.

| Priority | $P_{\text{class}}$ | $I_{\text{payload}}$ |
|---|---|---|
| Critical | 4.0 | 55 A |
| High | 3.0 | 45 A |
| Medium | 2.0 | 30 A |
| Low | 1.0 | 20 A |

**The Joule term is the engineering heart of the method.** $P = I^2R$ is the actual power dissipated *inside* the pack. Because $I$ is squared and indexed by priority, a heavy-duty Critical request (55 A) is penalised **9.4×** harder for the same internal resistance than a Low-priority one (20 A):

$$\frac{55^2}{20^2} = \frac{3025}{400} = 7.56 \quad\text{(and 3.4× vs Medium)}$$

The practical effect: **high-resistance packs are steered toward light duty cycles rather than being rejected outright.** This is load-matching, not filtering. A 90 mΩ pack is perfectly serviceable on a 20 A campus utility run and dangerous on a 55 A heavy delivery.

### 5.3 Solving — Hungarian algorithm

`scipy.optimize.linear_sum_assignment` solves the **assignment problem** — minimum-cost perfect matching on a bipartite graph — in $O(n^3)$ polynomial time. It is exact, not heuristic.

Because the library minimises, utilities are converted to costs by reflection about the feasible maximum:

$$C_{i,j} = \max\bigl(U_{\text{feasible}}\bigr) - U_{i,j}$$

This is monotonic, so **argmin of $C$ = argmax of $U$** — no distortion of the ranking.

**Why global optimisation rather than greedy?** The Hungarian solver maximises total utility across all 50 requests simultaneously. A consequence judges notice immediately: a request does not always get its personally-best pack. On the real data, REQ-004 receives BAT-050 (rank **2** of 49 feasible) because BAT-093 — rank 1 for REQ-004 — is worth more to REQ-036. Greedy per-request selection is precisely what the baseline does, and it is why the baseline strands quarantined packs on later arrivals. **The dashboard states this explicitly for every request** rather than hiding it.

### 5.4 The fixed baseline — Highest-SoC-First

Implemented exactly as specified, in `run_hsf_dispatch`:

```
packs ← sort(batteries, by SoC descending)
for each vehicle in ARRIVAL ORDER:
    for each pack in packs:
        if pack unused and pack.SoC ≥ vehicle.min_SoC:
            assign; mark used; break
```

**Critically, it has no health gate** — that is not an oversight, it is the definition of the baseline and the source of its failure. It sees one column.

---

## 6 · Results on the competition dataset

### 6.1 Mandatory metrics

| Metric | Proposed | HSF | Δ |
|---|---|---|---|
| Successfully served | 50 / 50 | 50 / 50 | — |
| Unserved | 0 | 0 | — |
| High & Critical served | 100.0 % | 100.0 % | — |
| **Unsafe allocations** | **0** | **12** | **−12** |
| **Average SoH allocated** | **90.7 %** | 78.8 % | **+11.9 pp** |
| **Average BSS allocated** | **81.4** | 67.9 | **+13.5** |
| Critical-tier avg SoH | 96.2 % | 74.8 % | +21.4 pp |
| Critical-tier avg R_int | 43.5 mΩ | 68.7 mΩ | −25.2 mΩ |

### 6.2 Where the baseline fails, by tier

| Tier | Requests | Proposed served | HSF served | **HSF unsafe** |
|---|---|---|---|---|
| Critical | 4 | 4 | 4 | **1** |
| High | 22 | 22 | 22 | **7** |
| Medium | 24 | 24 | 24 | **4** |

Service rate is identical. **Safety is not.**

### 6.3 The statistical case against ranking by charge

Correlations measured across all 200 packs:

| Relationship | Pearson *r* | Reading |
|---|---|---|
| SoC ↔ SoH | **−0.083** | essentially no relationship |
| SoC ↔ R_int | **+0.083** | essentially no relationship |
| SoH ↔ R_int | **−0.908** | very strong |

**This is the core finding, and it is not the obvious one.** High-SoC packs are *not* systematically unhealthy — that hypothesis was tested and rejected (packs at 100 % SoC average 80.8 % SoH; all others average 80.0 %). The real problem is that **state of charge carries almost no information about pack health**, while the health parameters are near-perfectly coupled to one another.

The baseline is therefore not making a bad trade-off. It is sorting on the one available column that is, with respect to safety, statistically indistinguishable from noise — and then acting on that ordering with full confidence.

### 6.4 The physical consequence

Using each tier's own peak current and $P = I^2R$:

- **All 50** requests received a different pack under the two policies.
- Baseline picks dissipate **+1,308 W** more heat inside the cells, aggregated across the run.
- Worst single case — **REQ-004**, Critical, heavy delivery, 89 km:

| | Proposed · BAT-050 | HSF · BAT-049 |
|---|---|---|
| Status | Safe and Available | **Unsafe / Quarantine** |
| SoC | 73.6 % | **100.0 %** ← the only thing HSF read |
| SoH | 90.8 % | 66.0 % |
| R_int | 47.5 mΩ | 83.1 mΩ |
| $I^2R$ @ 55 A | 144 W | **252 W** |

The baseline traded 24.8 pp of state of health for 26.4 pp of charge, and produced **75 % more waste heat** in a pack the safety gate had already blocked.

---

## 7 · The dashboard — every screen

**Stack:** Next.js 16 · React 19 · Tailwind v4 · shadcn/Base UI · GSAP · Geist.
**Design system:** Uber Base structure on a Dark Industrial surface. Health tones `#10B981 / #F59E0B / #EF4444`; priority tiers `#7C3AED / #2563EB / #0891B2 / #64748B`.

> **Architectural guarantee — nothing is hardcoded.** `config.py` serialises every threshold, weight, priority multiplier and peak current into the run payload's `config` block. The UI reads them at render time. Change `R_INT_SAFE_MAX` in Python and the tier cards, alert bands, formula callouts and written explanations all move with it. Chart bin counts derive from fleet size, axis ranges from observed min/max, and the scatter only offers axes the uploaded CSV actually populates.

### Cold-start contract

The dashboard opens **empty and locked**. No KPI is painted until a run completes. Prior `outputs/` are never auto-loaded — `?resume=1` is the single explicit opt-in. This is deliberate: a judge must never see a number that did not come from the data they just supplied.

### 7.1 Overview
KPI hub and drill target. Every tile links into the zone that explains it. Locked until `runCompleted`.

### 7.2 Story — guided walkthrough, evidence-backed
Five beats, each carrying live data rather than prose:

1. **HAVE** — fleet mass split into the three classes.
2. **CLASSIFY** — *why this pack got this label.* Pick any pack; renders all four gates as `IN BAND / SOFT BREACH / HARD BREACH`, names the single deciding rule, and explains the physical failure mode.
3. **SCORE** — *how suitability is computed.* Every MAUT term expands to show its normalisation formula, the worked substitution for that pack, what the parameter physically is, why it carries its weight, and its failure mode. Plus a sensitivity read: which term is costing the most points.
4. **MATCH** — *why this rider got this pack.* The candidate pool narrowing constraint by constraint, the ranked shortlist with utility arithmetic, and — when the global optimum differs from the request's personal best — why that pack went elsewhere.
5. **PROVE** — the four headline metrics against the baseline.

### 7.3 Gating (Stages 1–2)
Flow banner (raw stream → integrity check → 3-tier gating), then three glass tier cards printing the **live** bounds beside the counts, so the rule text can never drift from the numbers it produced. Quarantine root-cause donut with precedence explained.

### 7.4 Scoring (Stage 3)
The MAUT formula rendered at live weights. Four normalisation curves — one per sub-score — drawn from the solver's own anchors, **with the actual fleet plotted as dots along each curve** so the distribution and the transfer function are visible together.

### 7.5 Fleet
Full 200-pack roster explorer with filtering and drill-through.

### 7.6 Match (Stage 4)
**Bipartite lattice** — requests on the left coloured by tier and labelled with required range and minimum SoC; candidate packs on the right ranked by BSS with quarantined packs locked at the bottom. The chosen edge glows; hovering a request draws its **blocked** edges as dashed red lines, each labelled with the constraint that rejected it. Those rejections are re-derived client-side from the same rules the solver applied. Below it, the original deal-playback theater and pair ledger.

### 7.7 Policy
The seven mandatory quantitative outputs as an executive scoreboard. Row tone is computed from each metric's own direction of goodness, so a regression would surface red automatically rather than depending on someone remembering to flip a flag.

### 7.8 Assign
Row-level assignment table with CSV export — the submission artefact required by scope item 2.

### 7.9 Compare — head-to-head
The comparison the problem actually poses: not two arbitrary packs, but **the two packs the two policies chose for the same request**.

- **The case** — the three correlations of §6.3 as bars, plus the tally (12 blocked handovers, +1,308 W, +11.9 pp SoH, 50/50 divergences).
- **The duel** — opens automatically on the most damaging divergence in the run. Request context, both packs fully decomposed, per-parameter tug-of-war, and a bottom line stating the trade in watts at that vehicle's own peak current.
- **"See it as HSF does"** — a blindfold mode that blurs every health parameter and collapses both packs to one giant SoC number. From that view the baseline's pick is the obvious winner. Toggling it off reveals what the column hid. It argues the point by letting you make the mistake first.
- **Divergence ladder** — all 50 ranked by damage, `BLOCKED` badges first.

### 7.10 Diagnostics — linked workbench
One shared filter drives every view. Selecting a score band, priority tier, block reason or rack shelf narrows all the others.

- **Score histogram** — stacked by class, clickable bins, hover breakdown.
- **Service by priority** — proposed vs baseline, with the crimson cap showing unsafe handovers.
- **Parameter explorer** — free choice of X and Y across any two populated numeric fields (SoC, SoH, R_int, ΔV, T, BSS, cycles, age).
- **Block-reason breakdown** — click to isolate.
- **Station rack map** — 200 shelves in dataset order, non-matching cells faded, click to pin a pack and read its full classification reasoning inline.

### 7.11 Static diagnostic PNG
`outputs/bss_dispatch_simulation.png` — 2×2 matplotlib grid: MAUT vs TOPSIS scatter, allocation rate by priority, HSF vs Proposed metric bars, quarantine triggers. Included because the submission requires a static artefact independent of the web app.

---

## 8 · Response to the 30 % onsite twist

**Module:** `twists.py` · Satisfies **mandatory task 9**.

Three hooks are already wired into the solver. **None of them is a rewrite** — each modifies exactly one term of the existing utility matrix or one constraint on the charger schedule. The gating, scoring, matching and verification layers are untouched.

### Twist A — grid power ceiling · `apply_grid_limit(schedule, p_max)`
$$\sum_k P_{\text{charge},k} \le P_{\text{grid,max}}$$
Charger bays are deferred under a grid cap, **Degraded packs first** (sorted by status rank, then ascending power), preserving full-health inventory for the next swap wave. Returns `charge_allowed` / `charge_deferred` flags plus realised load.

### Twist B — time-of-use tariff · `apply_tou_cost(schedule, tariff)`
$$\min \sum_t \text{tariff}(t) \cdot P_{\text{charge}}(t)$$
The tariff table is an **input**, not a constant — any schedule can be supplied on the day.

### Twist C — queue wait & defection · `boost_priority_near_defection(...)` — **currently armed**
$$P_{\text{class}} \leftarrow P_{\text{class}} \times 1.5 \quad\text{when}\quad \frac{W_i}{W_{\max,i}} \ge 0.8$$
As a request approaches its stated wait tolerance, its multiplier inflates — a Low-priority rider about to walk out-ranks a freshly arrived Medium. This runs **before** the utility matrix is built, so it needs no solver change at all.

> **Honest status on this dataset.** The demand file supplies `maximum_wait_time_min` (tolerance) but no elapsed queue clock. Twist C is therefore armed and idle: `W_i = 0` for every request, so the multiplier is inert and the wait penalty term contributes zero. Feed a live queue clock on the day and it engages with **no code change**. The dashboard stated this explicitly rather than implying a live queue model exists.

**Why this generalises.** Any twist that changes *what a pairing is worth* lands in $U_{i,j}$. Any twist that changes *what is legal* lands in the feasibility mask. Any twist about *charging* lands in the schedule functions. The Hungarian solver, the gates and the verification rules never move.

---

## 9 · Limitations stated plainly

These are declared rather than hidden, because a judge will find them.

### 9.1 Incident proxies read zero on this fleet
`thermal_stress_incidents` and `voltage_collapse_incidents` trigger above 100 mΩ and 120 mΩ respectively. This fleet's maximum internal resistance is ≈ 90 mΩ, so **both counters are 0 for both policies**. The thresholds were not retuned to manufacture a win. The differentiators that *are* real here are the 12 unsafe allocations, the 11.9 pp SoH gap, and the 25.2 mΩ Critical-tier resistance gap.

### 9.2 The cell-imbalance sparkline is modelled, and says so
The dataset reports pack-level **maximum spread** only, not per-cell voltages. The 15-bar visual is a deterministic spread (stable per pack ID) scaled to the measured Δ. The numeric readout and the alert band use the **real measured value**. The caption on screen reads *"per-cell heights modelled from pack Δ"*.

### 9.3 Waiting time is not modelled
Optional output 7 is not claimed. No queue simulation exists, so no average waiting time is reported. Reporting one would require inventing a service-time model the data does not support.

### 9.4 Constraint (c) is a design choice, not a requirement
Barring Degraded packs from Critical/High priority is stricter than the problem statement demands. It is stated openly because it costs service capacity in exchange for safety margin, and a judge may reasonably want to interrogate the trade.

### 9.5 Peak current is a modelling assumption
`PEAK_CURRENT_A` (55/45/30/20 A) is inferred from the stated 20–60 A duty range for light 2W/3W EVs by priority tier, not measured per vehicle. It is used consistently in both the Joule penalty and the dashboard's wattage readouts, so the two never disagree.

---

## 10 · Reproducibility & artefacts

```bash
# Full pipeline on the competition datasets
python -m bss_dispatch \
  --batteries Problem_1_Battery_Fleet_200_Packs.csv \
  --vehicles  Problem_1_Vehicle_Demand_50_Requests.csv
```

| Artefact | Contents |
|---|---|
| `outputs/metrics.json` | Classification summary + full policy comparison |
| `outputs/run_result.json` | Everything above **plus** per-pack classifications, per-request assignments for both policies, all MAUT sub-scores, and the complete solver config block |
| `outputs/bss_dispatch_simulation.png` | 4-panel static diagnostic figure |
| Dashboard `Assign` zone | CSV export of the assignment table |

**Determinism.** No randomness executes on the CSV path. `RANDOM_SEED = 42` governs only the synthetic demo generator, which is never used when files are supplied. The same inputs produce byte-identical outputs.

**Self-verification.** The run terminates with a non-zero exit and the message `FAILED: Proposed method allocated quarantined packs` if verification rule 1 is ever violated. A green run is a proof, not an assertion.
