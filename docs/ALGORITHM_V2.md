# Real-Time BSS Operation — Method v2
### Literature-grounded extension of the Problem-Statement-2 solver

**System:** Python closed-loop rolling-horizon station simulator, wrapping the unchanged v1 health core
**Reproduce:** `python -m bss_dispatch.rt --batteries <fleet.csv> --vehicles <demand.csv>`
**Artefacts:** `outputs/rt/rt_results.json` · `outputs/rt/figures/*.png`

---

## 0 · What changed, and why

v1 (`docs/METHOD.md`) solves the problem the statement literally poses: gate 200 packs on
health, score them, and match them once to 50 requests. It does that exactly, and it is
retained here unmodified — Stage 1–3 are byte-identical and reproduce the same
89 / 78 / 33 classification.

What v1 cannot represent is that a swapping station is a **circulation under uncertainty**:

| v1 assumes | Reality |
|---|---|
| Packs are static rows with fixed SoC and SoH | Packs leave, come back depleted and older, and must be recharged |
| Every request is visible at solve time | At 09:15 the station does not know who arrives at 09:40 |
| Charging is free and instantaneous | Charging costs money, ages the cell, and competes for bays and kW |
| Health is an input | Health is a **state** the station's own charging decisions degrade |

The five Tier-S/A sources supply exactly the missing pieces. This document maps each one to
the code that implements it, states the calibration honestly, and reports what each is worth.

### Literature → component map

| Layer | Component | Module | Source |
|---|---|---|---|
| L0 | Integrity → 3-tier gate → MAUT/TOPSIS | `integrity/classify/score.py` | Problem statement (unchanged) |
| L1 | Battery state transitions, closed-loop circulation, inventory balance | `rt/states.py` | **Sarker 2015** (T-PWRS) · **Yang 2014** (Energy) |
| L2 | Charging-rate ↔ degradation trade-off, monetised fade | `rt/degradation.py` | **Wu 2018** (T-VT) |
| L3 | ToU energy price, demand charge, transformer cap, DR curtailment | `rt/market.py` | **Sarker 2015** · **Gong 2023** (IJEPES) |
| L4 | Scenario bank, critical-fractile reserve, shadow price of readiness, CVaR | `rt/uncertainty.py` | **Sarker 2015** · **Cui 2023** (Energy, review) |
| — | Receding-horizon MILP scheduler | `rt/charging.py` | Sarker 2015 (MILP formulation style) |
| — | Online allocation with deferral + rationing | `rt/allocator.py` | this work, on the v1 utility |

> **On attribution.** The papers are cited for the *modelling approach* each contributes —
> state-transition MILP scheduling, C-rate-dependent ageing, scenario-based operation under
> demand uncertainty. The functional forms used here are the standard semi-empirical ones,
> and **every coefficient in `rt/config_rt.py` is this project's own calibration**, not a value
> lifted from those papers. Where a constant drives a headline result it is named in §7.
> Armstrong 2013 (Energy Policy) and the Tier-B/C items informed the framing of infrastructure
> sizing and time-varying constraints but are not load-bearing in any equation below.

---

## 1 · L1 — Battery state transitions

**Module:** `rt/states.py`

Every pack occupies exactly one state per 5-minute slot:

```
READY        at the station, off-charger, dispatchable
CHARGING     occupying one of N_bays charger bays
WAITING_BAY  at the station, wants charge, no bay free
IN_SERVICE   out with a vehicle, returns at return_slot
QUARANTINE   hard-blocked by the Stage-2 safety gate
```

Transitions per slot, in physical order:

```
IN_SERVICE  --(trip ends)-->      WAITING_BAY     depleted by trip energy, aged by throughput
READY       --(swap)-->           IN_SERVICE      return booked at dispatch
WAITING_BAY --(bay granted)-->    CHARGING
CHARGING    --(SoC >= target)-->  READY
any         --(fade past gate)--> QUARANTINE      re-gated every slot
```

Pack count is conserved by construction — a swap moves one pack out and books exactly one
return — and `assert_conservation()` verifies it at every one of the 120 slots. A run that
leaked inventory would fail loudly rather than quietly inflating service.

**Health is a state variable, not a constant.** After every charge step and every trip,
`_apply_fade()` reduces SoH, raises R_int on a slope **fitted from the supplied fleet**
(the competition fleet's own SoH↔R_int regression, r = −0.91), re-runs the Stage-2 cascade,
and rebuilds the MAUT score. A pack can therefore be quarantined by the day's own usage.

**Trip model.** Distance comes from the request's `required_range_km`; duration at
25 km/h; consumption at 25 Wh/km; discharge C-rate from the tier's peak current. These are
modelling assumptions, declared in §7.

---

## 2 · L2 — Charging rate ↔ degradation

**Module:** `rt/degradation.py`

Fade over a charging step is cycle plus calendar:

$$\Delta Q_{\text{cyc}} = k_{\text{cyc}}\, f_C(c)\, f_T(T)\, \text{EFC}, \qquad
\Delta Q_{\text{cal}} = k_{\text{cal}}\, f_T(T)\, \Delta t$$

with a **super-linear C-rate stress factor** and an **Arrhenius temperature factor**:

$$f_C(c) = \left(\frac{c}{c_{\text{ref}}}\right)^{\beta},\ \beta = 1.6 \qquad
f_T(T) = \exp\left[\frac{E_a}{R}\left(\frac{1}{T_{\text{ref}}} - \frac{1}{T}\right)\right]$$

At β = 1.6, charging at 2C ages the cell **5.3× faster per amp-hour** than 0.5C; at 45 °C it
ages **2.5× faster** than at 25 °C. Both effects are visible in figure `f3`.

**Physical clamps the scheduler must respect** or its power forecast is wrong:
a CC-CV knee capping the effective rate to 0.3C above 80 % SoC, and a hard fast-charge ban
(≤ 0.5C) on Degraded packs — the same cells whose high R_int makes them worst at absorbing it.

**Ohmic loss is charged, not just discharged.** Grid draw is
$\left(P_{\text{stored}} + I^2R_{\text{int}}\right)/\eta$, so the pack's own resistance costs
money on the way in as well as heat on the way out. This is the v1 Joule term, applied to the
other half of the cycle.

**Monetisation is what makes it a trade-off.** Fade is priced against replacement cost
pro-rated over the end-of-life budget:
$\text{cost} = (\Delta Q\,/\,20\%) \times \text{pack capital}$. Only once fade has a rupee
value can it be compared against an energy bill.

---

## 3 · L3 — Electricity-market operation

**Module:** `rt/market.py`

Three market facts drive the schedule: a **time-of-use tariff** (₹5.50–10.50/kWh, Indian
commercial shape), a **demand charge** on the billing peak kW, and a hard **transformer
ceiling** (60 kW nominal / 30 kW stress) which a **demand-response event** can temporarily
tighten in exchange for payment. `MarketLedger` is the station's meter: the reported bill is
an accumulation of realised slots, never a formula applied afterwards.

---

## 4 · L4 — Demand uncertainty, reserve, and the shadow price

**Module:** `rt/uncertainty.py` — the layer that turns a matcher into an operating policy.

1. **`DemandProfile`** fits a non-homogeneous arrival intensity from the observed
   `arrival_time` column (30-min buckets) and keeps empirical pools for priority, minimum
   SoC, range and wait tolerance. With 50 observations, bootstrapping real values beats
   fitting a parametric family.
2. **`ScenarioBank`** draws 200 Poisson sample paths from that intensity. Sampled **once** and
   shared by every policy, so any difference between policies is policy and not luck.
3. **`ReserveOracle`** reads the bank at slot *t* and answers two questions:

   **How much to hold back** — the critical fractile of premium demand over the next 30
   minutes, less the packs the chargers will have made premium-ready by then:
   $R(t) = \lceil Q_{0.95}(D_\Omega) - \hat{c}(t) \rceil^+$

   **What one pack is worth right now** — standard newsvendor marginal analysis. With
   integer demand $D$ over the window and $A$ packs available, releasing one raises expected
   unmet premium demand by exactly $P(D \ge A)$, so:

   $$\boxed{\ \lambda(t) = \text{VoLL}_{\text{premium}} \cdot P\!\left(D_\Omega \ge A(t)\right)\ }$$

   This needs no tuning. It is 0 when the shelf is deep and rises to the full value of lost
   service when it is bare — visible in `f5`, where λ saturates at ₹300 exactly across the
   window in which premium-ready inventory sits at zero.

**λ couples the two decisions.** It enters the charging objective (raising the marginal value
of SoC, so scarce bay-hours and kW route to Safe packs) *and* the allocation objective (tilting
against spending a good Safe pack on a non-premium rider). One number, derived from the
scenario bank, links inventory risk to both levers.

---

## 5 · The two solvers

### 5.1 Charging — receding-horizon MILP (`rt/charging.py`)

$$\min_{x} \sum_{j,c,h}\Big[\underbrace{E_{jc}\pi_h}_{\text{energy}} + \underbrace{\kappa_{jc}}_{\text{fade}} - \underbrace{v_j\, g_{jc}}_{\text{readiness}}\Big] x_{jch}$$

subject to one rate per pack per slot, the bay count, the per-slot power ceiling, and per-pack
SoC headroom. Binary, solved exactly with HiGHS (`scipy.optimize.milp`), re-solved every slot
with only the first slot implemented.

The readiness value is

$$v_j = \frac{\text{swap revenue} + \lambda(t)\cdot\mathbb{1}[\text{pack }j\text{ can serve premium}]}{\text{SoC}_{\max} - \text{SoC}_{\min}}$$

**This is what makes the scheduler self-arbitraging.** It charges when marginal value exceeds
marginal cost and coasts when it does not — no hand-written peak-avoidance rule exists in the
codebase. Degraded packs, barred from premium by the Stage-2 policy, never attract the
scarcity premium, so bay-hours flow to the packs that can actually relieve a shortage.

*Solver note.* The C-rate menu makes packs near-interchangeable, so the MILP is highly
symmetric and exhaustive branch-and-bound is wasted. It terminates on a 1 % optimality gap or
a 0.35 s cap and takes the incumbent — feasible by construction and provably within the gap.
Median solve is ~0.1–0.26 s; a full 120-slot day runs in ~2 s.

### 5.2 Allocation — online matching with deferral and rationing (`rt/allocator.py`)

$$U_{i,j} = P_i(t)\cdot \text{BSS}_j - \gamma W_i - \alpha I_i^2 R_j - \text{tilt}(i,j)$$

Three additions over v1, all in what is *offered* to the optimiser rather than in the
optimiser (the Hungarian solve is unchanged):

- **Deferral is an explicit move.** Each request carries a dummy column priced by value of
  lost service and convex in urgency, so "hold this rider one more slot" competes on the same
  objective. v1 has no such option.
- **Inventory is rationed by a protection level.** Only the $\max(0, |A| - R(t))$
  *least-suitable* premium-ready Safe packs are released to non-premium riders. Expressing the
  limit as an **edge mask** rather than a count keeps it exactly representable in the
  assignment problem, and releasing the marginal pack first means the premium tier keeps the
  best of what remains. Packs below the premium SoC threshold are never rationed — they are
  not premium capacity.
- **Priority escalates continuously** with defection risk, generalising v1's single 1.5×
  step at 80 % of tolerance into a ramp reaching 2.0× at the tolerance itself.

**The v1 safety guarantee is preserved exactly.** Quarantined packs are excluded from
`dispatchable()`; they are not representable in the solution space. Verified: 0 unsafe
allocations in every health-gated run, in both regimes, across all 30 Monte Carlo futures.

---

## 6 · Results

Five policies, each turning on one component, everything else held fixed.

| Key | Policy | Allocation | Charging |
|---|---|---|---|
| `hsf` | Mandated baseline | Highest-SoC-First, no health gate | uncontrolled |
| `greedy` | Health-greedy | gate + best pack per rider, sequential | uncontrolled |
| `v1_online` | v1 utility, online | v1 Hungarian each slot | uncontrolled |
| `market` | + L2/L3 | v1 Hungarian each slot | **MILP** |
| `full` | **Proposed** | + reserve + defection ramp | **MILP** |

### 6.1 Nominal regime — the dataset exactly as issued

200 packs · 50 requests · 20 bays · 60 kW

| Metric | HSF | v1 online | **FULL** | Δ vs v1 |
|---|---|---|---|---|
| Served | 50/50 | 50/50 | **50/50** | — |
| **Unsafe allocations** | **8** | 0 | **0** | — |
| Avg SoH allocated | 80.7 % | 93.5 % | **93.4 %** | — |
| Energy purchased | 108.1 kWh | 119.9 kWh | 118.3 kWh | −1.3 % |
| **Fleet SoH lost** | 3.72 pp | 4.38 pp | **3.17 pp** | **−27.6 %** |
| **Degradation cost** | ₹2,803 | ₹3,644 | **₹2,475** | **−32.1 %** |
| Mean C-rate used | 0.578 | 0.754 | 0.628 | −16.7 % |
| Bay-slots used | 1,098 | 916 | 1,087 | **+18.7 %** |
| **Opex per swap** | ₹85.18 | ₹103.50 | **₹80.43** | **−22.3 %** |
| Economic surplus | ₹3,241 | ₹2,325 | **₹3,479** | **+49.6 %** |

**The mechanism, stated plainly.** The MILP delivers essentially the same energy through
**19 % more bay-hours at a 17 % lower average C-rate**. Under a fixed power ceiling, spreading
the same kWh across more packs at gentler rates is strictly better, because fade is
super-linear in rate and the ceiling — not time — is what binds. That is the Wu-2018 result,
reproduced as an operating decision rather than a curve.

### 6.2 Stress regime — declared synthetic

60 packs · 10 bays · 30 kW · 211 requests (4× the observed intensity)

| Metric | HSF | v1 online | + Market | **FULL** |
|---|---|---|---|---|
| Served | 153/211 | 134/211 | 133/211 | **143/211** |
| **Critical + High served** | 68.5 % | 41.7 % | 40.9 % | **54.3 %** |
| Premium unserved | 40 | 74 | 75 | **58** |
| **Unsafe allocations** | **11** | 0 | 0 | **0** |
| Degradation cost | ₹2,603 | ₹2,678 | ₹2,468 | **₹2,386** |
| Economic surplus | ₹3,261 | −₹9,045 | −₹9,118 | **−₹2,076** |

The reserve is worth **+12.6 pp of premium service** and **16 fewer stranded premium riders**,
with zero safety cost.

### 6.3 Monte Carlo — 30 independent demand futures, stress regime

Every policy faces the identical 30 realisations (paired comparison).

| Metric | HSF | v1 online | + Market | **FULL** |
|---|---|---|---|---|
| Service rate | 77.5 ± 5.9 % | 69.9 ± 5.2 % | 70.8 ± 5.0 % | **71.9 ± 5.4 %** |
| **Premium service** | 77.1 ± 7.2 % | 58.3 ± 6.6 % | 58.8 ± 6.5 % | **67.3 ± 7.5 %** |
| Premium unserved (mean) | 24.2 | 43.8 | 43.3 | **34.4** |
| **CVaR₉₅ premium unserved** | 46.0 | 60.5 | 59.5 | **55.5** |
| Degradation | ₹3,103 | ₹3,125 | ₹2,521 | **₹2,476** |
| **Unsafe allocations** | **12.9** | 0.0 | 0.0 | **0.0** |
| Surplus | ₹8,256 | ₹216 | ₹1,426 | **₹3,887** |
| CVaR₉₅ worst-day surplus | −₹1,053 | −₹7,363 | −₹5,749 | **−₹5,571** |

The full method improves the **mean** premium service by 9.0 pp over the v1 utility *and* the
**tail** — CVaR₉₅ shortfall falls from 60.5 to 55.5 — so the gain is not bought by taking on
worst-case risk.

### 6.4 The baseline's apparent win, priced

HSF leads on raw service and surplus in the stress regime. It does so by handing riders
**11 quarantined packs** (12.9/day across the Monte Carlo), which mandatory task 3 forbids.
It is disqualified, not out-competed — but the honest framing is quantitative:

> HSF's ₹5,337/day surplus advantage over the proposed method is bought with 11 unsafe
> handovers. It is ahead only while a quarantined dispatch costs **less than ₹485**. That is
> the implied price the baseline puts on ignoring its own safety gate.

This is also why safety is a **hard constraint** in this design and not a priced term: any
objective that lets safety be traded will trade it, and the naive economic ranking above is
exactly what that looks like.

---

## 7 · Limitations, stated plainly

**7.1 Time-of-use arbitrage is inert on this dataset.** The station is bay- and
power-limited, not price-limited. The overnight backlog must clear inside the ₹7.20 morning
block, and the cheap ₹6.30 window falls *after* the demand peak. The MILP's realised energy
price is ₹7.20/kWh against the uncontrolled ₹7.10 — **marginally worse**, and its peak is
59.6 kW against 58.3 kW. The market layer's realised value here is C-rate composition, not
timing. The arbitrage machinery is implemented and priced; it has nothing to trade on this
schedule, and the results do not claim otherwise.

**7.2 The nominal regime cannot exercise an inventory policy.** 200 packs for 50 requests is
over-provisioned by roughly 4×; every health-gated policy serves 50/50 and the reserve never
binds. This is a property of the issued dataset. The stress regime exists to exercise the
layer and is **declared synthetic** — arrivals are Poisson draws from the *observed* arrival
intensity scaled 4×, with attributes bootstrapped from the real pools. No provided data is
edited anywhere.

**7.3 Degradation coefficients are calibrated, not measured.** β = 1.6, Eₐ/R = 3850 K,
k_cyc set to 3,000 cycles-to-80 %, pack capital at ₹10,000/kWh. These are literature-typical
LFP values, not fitted to this fleet — the fleet CSV has no cycling history to fit against.
All degradation *deltas* between policies scale with k_cyc and the pack price; the **ranking**
depends only on β > 1, which is the qualitative claim.

**7.4 Returned-pack health is modelled.** The demand file describes requests, not the packs
riders hand in. Returns are modelled as the dispatched pack coming back after a trip whose
duration and depth follow from `required_range_km` at 25 km/h and 25 Wh/km.

**7.5 The MILP is horizon-approximate.** Coefficients are evaluated at each pack's SoC at the
start of the 15-minute horizon. Only the first slot is implemented, so the approximation never
reaches the ledger, but the deeper horizon slots are not exact.

**7.6 VoLL sets the reserve's aggressiveness.** ₹500/300/120/60 by tier is a stated
assumption. Raising premium VoLL holds more stock back and trades non-premium service for
premium service; the direction of the trade is structural, its size is not.

**7.7 One demand file, one fleet.** Every number here derives from a single 200-pack fleet
and a single 50-request arrival pattern. The Monte Carlo varies demand, not the fleet.

---

## 8 · Reproducibility

```bash
python -m bss_dispatch.rt \
  --batteries Problem_1_Battery_Fleet_200_Packs.csv \
  --vehicles  Problem_1_Vehicle_Demand_50_Requests.csv \
  --replications 30
```

Deterministic: seeded at `RT_RANDOM_SEED = 2026`, no unseeded randomness on any path.
Runtime ≈ 85 s end-to-end including 30 Monte Carlo replications and all figures.

| Artefact | Contents |
|---|---|
| `outputs/rt/rt_results.json` | every policy summary, both regimes, Monte Carlo stats, and the full config block |
| `outputs/rt/figures/f1…f8.png` | architecture, state occupancy, degradation, market, uncertainty, ablation, Monte Carlo, safety break-even |

Self-verification: `assert_conservation()` on every slot (inventory cannot leak) and a
grid-cap assertion on every slot (the schedule cannot exceed the transformer).
