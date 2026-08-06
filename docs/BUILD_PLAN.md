# BUILD_PLAN.md — ASME Brain Bolt 2026 / Siemens Energy PS2P1

Grounded build plan: verified problem statement → weighted literature base →
screen-by-screen spec → 6–8 h sprint timetable.

Source of truth for the brief: `C:\Users\SEC\Downloads\Siemens Energy - PS2P1.pdf`
(3 pages, extracted verbatim below). Source of truth for the literature:
`C:\Users\SEC\Downloads\PAPERS\*.pdf` (10 PDFs, read locally — not summarised
from memory).

---

## 1. The actual problem statement (verified, not paraphrased)

**Organization:** Siemens Energy India Ltd
**Title:** Battery Health Assessment and Dynamic Allocation for Light EVs
**Pillar:** Energy / Manufacturing / Digitalization / Mobility · Difficulty: Medium–Hard
**Tech:** Python, MATLAB/Simulink, Scilab, C/C++, Java "or another suitable coding/simulation environment"

**Data:** 200 battery packs (health, thermal, electrical, usage) + 50 vehicle
requests (range, load, priority, min acceptable SoC, max wait). All teams get
identical inputs.

### Mandatory tasks (9)
1. Classify every battery into exactly one of: Safe and Available / Degraded but Usable / Unsafe-Quarantine
2. Battery Suitability Score 0–100 from **at least four** provided health parameters
3. Allocate: no unsafe pack allocated, ≤1 use per battery, ≤1 battery per vehicle, allocated SoC ≥ vehicle min SoC
4. Account for vehicle priority in the allocation logic
5. Implement through actual coding or simulation
6. Data analysis and visualization
7. Quantitative validation
8. Compare against the fixed baseline: Highest-SoC-First
9. Respond to the unseen 30% onsite twist **using the same core solution**

### Mandatory quantitative outputs (7)
served · unserved · % High+Critical served · unsafe allocations · avg SoH of
allocated · avg BSS of allocated · *optional* avg waiting time **if queueing is
explicitly modelled**

### Mandatory visual outputs
≥3 meaningful visualizations. Suggested: health/score distribution · allocation
by priority · proposed vs HSF · unsafe packs identified.

### Fixed baseline (exact wording)
> Process vehicle requests in **arrival order** and allocate the currently
> available battery with the **highest State of Charge** that satisfies the
> minimum acceptable SoC. Each battery may be used only once.

### Verification rules (5)
unsafe never allocated · no battery reused · no vehicle double-served · min SoC
satisfied · **all results reproducible from the datasets + submitted code**.

### Split & submission
Part 1 = 70% (everything above). 30% revealed onsite. Whole thing must be
solvable, refinable and submittable inside a **6–8 hour window**.
Deliverables: runnable code/model · output file of classifications + assignments ·
baseline comparison · quantitative metrics · ≥3 visualizations · short method
explanation + twist response.

### What the brief does *not* ask for
No electricity market. No day-ahead prices. No degradation cost model. No
charging schedule. No queueing (unless you choose to model it, and then only as
an optional metric). **This single fact drives the literature weighting below.**

---

## 2. Literature base — read, weighted, and mapped to code

Weight = share of the delivered algorithm this paper is allowed to justify.
The rule that produced these weights: *a paper earns weight only where the
Siemens dataset can actually exercise its mechanism.* The dataset is a single
static snapshot with no prices, no time series, and no charger model — so the
market/scheduling papers cannot carry the core, however strong their venues are.

| # | Paper | Venue | Verified from | Weight | What it legitimately buys you |
|---|---|---|---|---|---|
| 1 | Sarker, Pandžić, Ortega-Vazquez — *Optimal Operation and Services Scheduling for an EV Battery Swapping Station* | IEEE Trans. Power Systems, DOI 10.1109/TPWRS.2014.2331560 | local PDF, 10 pp | **25%** | Inventory robust optimization for battery demand + multi-band robust optimization for price. **Use the demand-uncertainty half only**: the "unsupplied batteries" integer variable and the shortage/discount penalty are the clean precedent for a *reserve* of premium packs against the twist's surprise Critical arrivals. |
| 2 | Cui, Wang, Liu, Wang, Dorrell, Li, Zhan — *Operation optimization approaches of EV battery swapping and charging station: A literature review* | Energy 263 (2023) 126095 | local PDF, 14 pp | **20%** | The taxonomy — objectives, constraints, and mathematical programming method per application scenario. This is your **method-selection defence**: it lets you say "MILP assignment with lexicographic objectives is the documented fit for station-level dispatch" and cite a review rather than assert it. Also the source for the framing that BSS operation ≠ BCS operation. |
| 3 | Wu — *(BSS charging schedule minimising stock draw, charging damage, electricity cost)* | IEEE Trans. Vehicular Technology, DOI 10.1109/TVT.2017.2758404 | local PDF, 15 pp | **20%** | Three-term cost: **batteries taken from stock** + **charging damage from high-rate chargers** + electricity cost. The first and second terms map directly onto SafeFit-R's *fleet preservation* and *stress exposure* cost terms. The four charger classes (super/fast/normal/slow) are your twist-ready C-rate module. The GA/DE/PSO hybrid is **not** to be copied — a 200×50 assignment is exactly solvable. |
| 4 | Yang, Yao, Kang, Zhu — *Dynamic operation model of the battery swapping station for EV in electricity market* | Energy 65 (2014) 544–549 | local PDF, 6 pp | **15%** | **Battery state transitions.** The model works by "tracing the number of batteries in different kinds of states" over a 24 h simulation. That state-count formulation is the backbone of your optional rolling/queueing mode and of the twist scenario "5 new Critical requests arrive". Ignore the market-bidding layer. |
| 5 | Armstrong, El Hajj Moussa, Adnot, Galli, Riviere — *Optimal recharging strategy for battery-switch stations for EVs in France* | Energy Policy 60 (2013) 569–582 | local PDF, 14 pp | **8%** | Day-ahead buy/sell strategy, V2G vs G2V, and the finding that **arrival timing is critical** (evenly-spaced arrivals make the BSS profitable). Cite for arrival-process sensitivity in the twist section. Nothing in it touches pack-level safety. |
| 6 | "Gong et al. 2023, IJEPES" | — | **not located** | **2%** | ⚠️ Could not verify this citation. Nothing by Gong in IJEPES 2023 on BSS surfaced in search, and it is not in your local PAPERS folder. The nearest real IJEPES paper is **Ban, Zhang, Li, Li, Liu — *Optimal scheduling for EV battery swapping-charging system based on nanogrids*, IJEPES 130 (2021) 106967**. Either substitute that or drop the slot. Do not ship an unverifiable reference in a submission judged on reproducibility. |
| 7 | Kumbhar, Kalkhambkar, Patil — *Optimal Allocation and Scheduling of Battery Swapping and Charging Stations for Urban City* | ICFT 2025 (IEEE) | local PDF, 7 pp | **5%** | Siting/sizing/day-ahead with annualized cost. Adjacent (planning, not dispatch). Use as one line of related work; weaker venue. |
| 8 | Time-variant reliability-based design optimization paper | local PDF | local | **3%** | Only for time-varying safety/reliability constraints if the twist introduces a degradation-over-horizon rule. |
| 9 | Sarker 2013 ICCVE | local PDF | local | **2%** | Historical precursor to #1. One sentence in related work. |
| 10 | Sarker 2015 one-page variant | duplicate of #1 | local | **0%** | Exclude from the independent paper count. You have 4 near-identical copies of sarker2015 in the folder — cite once. |

### The honest weighting call
Papers 1–4 are titled "Tier S" in your strategy doc because of venue quality, and
that ranking is right *as literature*. But **~60% of their combined machinery
(prices, arbitrage, day-ahead bidding, charger scheduling) has no input in the
Siemens dataset.** The parts that survive contact with the data are: robust
inventory reserve (1), method-selection taxonomy (2), stock-draw + charging-damage
cost terms (3), and battery state-transition accounting (4). Build those four
things. Cite the rest as scope you deliberately excluded because the data does
not support it — that sentence is worth more to a judge than a DRO model you
cannot validate.

### Citation discipline
Every literature claim in the report must be traceable to a PDF in
`Downloads\PAPERS\`. The one exception above (#6) is flagged, not hidden.

---

## 3. Where the repo stands right now

Already built and working:

- `bss_dispatch/` — 5-stage Python solver (`classify` → `score` → `allocate` →
  `metrics` → `twists`), CLI at `python -m bss_dispatch`
- `bss_dispatch/rt/` — the real-time market/degradation/MILP layer built earlier
  this session (market, charging, degradation, uncertainty, simulator, figures)
- `web/` — Next.js judge dashboard, `/` (single-scroll judge page, 879 lines,
  sections `run · kpis · classify · score · assign · charts`) and `/lab`
  (10-zone diagnostics rail, ~10k lines of dashboard components)
- All **six** mandatory quantitative KPIs are already rendered side-by-side with
  HSF in the `kpis` section — verified in `judge-page.tsx:408-486`
- `outputs/run_result.json` carries `classification`, `comparison`,
  `assignments`, and a 200-row `fleet` array
- Decks in `outputs/` (three .pptx), figures, `docs/METHOD.md`, `docs/ALGORITHM_V2.md`

**The gap is not capability. It is scope discipline.** The `rt/` layer answers a
question Siemens did not ask. Keep it as an appendix/twist-readiness exhibit;
do not let it become the headline.

---

## 4. Screen-by-screen build spec

Two surfaces. `/` is what a judge sees. `/lab` is where you go when a judge asks
"show me". Everything below is scored against one rule: **every number on screen
must be recomputable from `outputs/run_result.json`.**

### Surface A — `/` Judge page (single scroll)

| # | Screen | Status | What to build / change | How |
|---|---|---|---|---|
| A0 | **Glossary + header** | exists | Keep. Add the problem-statement title verbatim as the page subtitle so a judge sees you solved *their* problem. | `judge-page.tsx` header block; `<Term>` already handles SoC/SoH/BSS/HSF/R_int/ΔV/T |
| A1 | **Upload (`#run`)** | exists | Keep dual dropzone + "Run on uploads". Add a visible **dataset hash** chip after upload (SHA-256, first 8 chars) — this is your reproducibility proof under Verification Rule 5. | `web/src/components/upload/`, hash in `/api/simulate/route.ts`, echo into `run_result.json` |
| A2 | **Mandatory KPI grid (`#kpis`)** | exists, complete | Keep all 6 tiles. **Add tile 7 conditionally**: avg waiting time, rendered only if the rolling/queue mode was run — the brief makes it optional *and conditional on actually modelling queueing*. Do not show it otherwise. | `judge-page.tsx:408`; gate on `run_result.queueing_modelled === true` |
| A3 | **Verification ribbon** | partial (`compliance-ribbon.tsx`) | Promote it to sit **directly under A2**. Five hard green/red checks matching the brief's five verification rules, each with the count it checked. This is the single highest-value screen in the whole submission. | Reuse `compliance-ribbon.tsx`; assertions computed server-side in `bss_dispatch/integrity.py` and shipped as a `verification` block |
| A4 | **Classification (`#classify`)** | exists | Keep 3-way counts + per-pack reasons. **Add**: a "why this pack" line for every quarantined pack naming the exact triggered rule, and surface the telemetry-contradiction cases (energy > SoC ceiling, T_now > T_24h_max) as their own sub-bucket. | `bss_dispatch/classify.py` already emits reasons; render grouped by rule in the classify section |
| A5 | **BSS score (`#score`)** | exists | Keep. **Change the aggregation to geometric** across ≥4 dimensions (capacity / power / balance / thermal) and show the four sub-scores per pack on hover. Geometric mean is the defensible answer to "why can't a great SoH hide a bad cell spread?" | `bss_dispatch/score.py`; hover via `reason-hover.tsx` |
| A6 | **Assignments (`#assign`)** | exists | Keep the always-visible Reason column. **Add** a one-click CSV export of the full assignment table — this *is* mandatory deliverable #2 ("output file/table containing battery classifications and battery-to-vehicle assignments"). | `web/src/lib/csv-export.ts` exists — wire a button |
| A7 | **Charts (`#charts`)** | exists | Must be **≥3**. Ship exactly the four the brief names: (a) BSS distribution, (b) allocation by priority, (c) proposed vs HSF grouped bars, (d) quarantined packs by trigger rule. Nothing decorative. | Follow `references/palette.md` from the dataviz skill; keep all four in the same colour system |
| A8 | **Head-to-head vs HSF** | exists (`head-to-head.tsx`, 777 lines) | Keep, but **prove baseline fidelity on screen**: show that HSF was run in arrival order, greedily, on the raw pool with no safety filter. Judges will look for a silently safety-filtered baseline. Show the count of quarantined packs HSF allocated. | `bss_dispatch/allocate.py` — keep one canonical HSF function, no variants |
| A9 | **Twist panel** | partial (`twists`) | Build a visible **twist console**: four extension points (safety gate / compatibility / resource / objective), each a toggle, each re-running the same solver and re-rendering A2–A8. This is mandatory task 9 made tangible in 20 seconds of demo. | `bss_dispatch/twists.py` + a params panel; `solver-config-context.tsx` already reads config at runtime |

### Surface B — `/lab` (deep dive, on demand)

Keep as-is. It already covers pipeline theater, fleet explorer, bipartite
lattice, diagnostics workbench, match theater. **Do not build more here.**
One change: add a clearly-labelled **"Beyond the brief"** zone that houses the
`rt/` market + degradation + MILP charging results. Labelling it as beyond-scope
converts it from a liability ("they solved the wrong problem") into an asset
("they knew where the boundary was").

### Surface C — Report + deck (the graded artefacts)

| Artefact | Build |
|---|---|
| 10–12 p report | Generated from `run_result.json`. **Zero manually typed numbers.** Sections: problem → data audit → classification → BSS → allocation → validation → HSF comparison → twist → references (weighted as §2) |
| Assignment/classification CSV | Direct export from A6 |
| 3-min video | Spine: HSF allocates N quarantined packs → separate trust/safety/degradation/fit → architecture in one frame → comparison table + one anomaly certificate → twist console live → close |
| Deck | `scripts/build_deck.py` already renders through real PowerPoint for visual QA — reuse that loop |

---

## 5. Time accounting

### Pre-event (do now, before travel)
Everything in §4 that is marked *build* or *change*. Target state: you arrive
with A1–A9 working on the released 70% data, report generator producing a
complete document with a placeholder twist section, and the deck built. If A3
(verification ribbon) and A9 (twist console) are not done before travel, nothing
else matters — those are the two screens that convert a good solver into a
winning submission under a 6-hour clock.

### On the day — 6 h plan (with the 8 h variant in brackets)

| Clock | Block | Output | Slip rule |
|---|---|---|---|
| 0:00–0:25 | Read the twist. Classify it into exactly one of the four extension points: safety gate, compatibility matrix, resource constraint, objective stack. | One sentence written down naming the point. | If it doesn't fit one of the four in 25 min, it fits two — split it and continue. Do not redesign. |
| 0:25–1:20 [1:40] | Implement the twist module + its assertions. Nothing else changes. | Twist toggle live in A9. | Hard stop. If unfinished at 1:20, ship the twist as a documented scenario with hand-run numbers rather than a live toggle. |
| 1:20–2:00 [2:30] | Run all policies + all scenarios. Freeze results into one immutable `run_result.json`. | Frozen result file + hash. | — |
| 2:00–2:45 [3:15] | **Inspect.** Contradictions, outliers, any metric that moved the wrong way. Recompute HSF independently. | Sign-off that every KPI is explainable out loud. | This block is never cut. Skipping it is how contradictory numbers reach a judge. |
| 2:45–4:30 [5:15] | Generate + edit the report from the frozen file. | 10–12 pages. | Cut editing, never generation. |
| 4:30–5:20 [6:15] | Record the 3-min video against the frozen results. | mp4. | — |
| 5:20–6:00 [7:15] | Independent recomputation, proofread, package, submit. | Submission. | — |
| — [7:15–8:00] | Buffer. Use for a second video take or a deeper twist. | — | — |

### Time rules
- **Freeze early.** After 2:00 no number changes. Every artefact downstream reads the frozen file.
- **Nothing gets typed twice.** A number that exists in two places will disagree by hour five.
- **Do not build onsite.** The only new code on the day is the twist module. Everything else is a re-run.
- **What to cut if you are behind:** the `/lab` deep dive, extra charts beyond four, deck polish. In that order.
- **What is never cut:** the verification ribbon (A3), the baseline-fidelity proof (A8), the inspection block (2:00–2:45).

---

## 6. Open items

1. **Citation #6 (Gong 2023 IJEPES) is unverified.** Replace with Ban et al., IJEPES 130 (2021) 106967, or drop it. Decide before the report generator ships.
2. **Queueing metric.** `maximum_wait_time_min` and `arrival_time` exist in the vehicle CSV. Either model queueing properly and report avg wait, or omit the metric entirely — a half-modelled wait time is worse than none under Verification Rule 5.
3. **`rt/` scope.** Confirm it goes to the "Beyond the brief" lab zone and not into the report body.
