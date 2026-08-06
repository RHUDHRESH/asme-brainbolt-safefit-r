# BSS Dispatch in MATLAB / Simulink — feasibility study & reference implementation

**Question:** what would this system look like built in MATLAB instead of Python?
**Short answer:** Stages 1–4 port almost 1:1 and several become *shorter* and more readable. The real reason to reach for MATLAB is not the port — it is **Simulink/Simscape**, which lets you turn the central claim from an asserted number into a simulated physical trace.

---

## 0 · The strategic point

Our Python solver is a **static optimiser**. It answers *"given this fleet snapshot, what is the best allocation?"* and reports that HSF's pack for REQ-004 dissipates **252 W vs 144 W** at a 55 A peak.

That number is exact physics (`P = I²R`) but it is an **instantaneous** figure. It does not tell you what actually happens to the pack over an 89 km heavy-delivery route.

MATLAB's differentiator is that it can answer the next question:

> *Does the baseline's pack actually cross the 50 °C quarantine line mid-route — and when?*

That converts the argument from *"this allocation is worse by 108 W"* to *"this allocation thermally fails at kilometre 31."* The problem statement explicitly invites a **"coding-based or simulation-based"** solution; MATLAB is where the *simulation* half becomes real.

**Recommendation up front:** keep the optimiser wherever it already works, and add MATLAB only for §5 (dynamic validation). A full rewrite buys readability and loses a working, verified dashboard.

---

## 1 · Function mapping

| Concern | Python (current) | MATLAB equivalent | Notes |
|---|---|---|---|
| CSV ingestion | `pandas.read_csv` | `readtable` | `VariableNamingRule="preserve"` keeps competition headers |
| Column aliasing | `df.rename(columns=...)` | `renamevars(T, old, new)` | Cleaner, vectorised |
| Tabular store | `DataFrame` | `table` / `timetable` | `timetable` is a real win for `arrival_time` |
| Categoricals | `str` columns | `categorical` | Ordinal categories give free priority ordering |
| Vector norm | `np.sqrt((x**2).sum(0))` | `vecnorm(X,2,1)` | Shorter |
| Assignment solve | `scipy.optimize.linear_sum_assignment` | **`matchpairs`** | ⚠ **Not the same algorithm** — see §4 |
| Group aggregation | `df.groupby().agg()` | `groupsummary` | Comparable |
| Correlation | manual / `np.corrcoef` | `corrcoef` (base) or `corr` (Stats TB) | |
| 4-panel figure | `plt.subplots(2,2)` | `tiledlayout(2,2)` + `nexttile` | Better default layout control |
| JSON export | `json.dumps` | `jsonencode` | |
| Dashboard | Next.js + React | **App Designer** (`uifigure`, `uigridlayout`) | See §6 |
| Rule cascade | `if/elif` chain | vectorised mask loop **or Stateflow** | Stateflow is a genuine upgrade — §3.2 |
| Dynamic physics | *(none)* | **Simulink / Simscape Battery** | The actual reason to do this — §5 |

---

## 2 · Data ingestion

MATLAB handles the competition schema cleanly. `VariableNamingRule="preserve"` is essential — without it MATLAB mangles `state_of_charge_percent` into a valid identifier and the alias map silently misses.

```matlab
function [packs, reqs] = loadFleet(batteryFile, demandFile)
%LOADFLEET Read the ASME Problem 1 CSVs and normalise to the solver schema.

    opts = detectImportOptions(batteryFile, "VariableNamingRule", "preserve");
    packs = readtable(batteryFile, opts);

    packs = renamevars(packs, ...
        ["state_of_charge_percent","state_of_health_percent","temperature_C", ...
         "max_temperature_last_24h_C","internal_resistance_mOhm", ...
         "cell_voltage_imbalance_mV","estimated_available_energy_kWh"], ...
        ["SoC","SoH","T","T_24h_max","R_int_mOhm","dV_cell_mV","E_avail_kWh"]);

    opts = detectImportOptions(demandFile, "VariableNamingRule", "preserve");
    reqs = readtable(demandFile, opts);

    reqs = renamevars(reqs, ...
        ["request_id","minimum_acceptable_SOC_percent", ...
         "maximum_wait_time_min","required_range_km"], ...
        ["vehicle_id","min_SoC","W_max_min","range_km"]);

    % Problem 1 ships Critical / High / Normal. Normal maps to Medium, and an
    % ORDINAL categorical gives us free sorting and comparison downstream.
    p = string(reqs.priority);
    p(p == "Normal") = "Medium";
    reqs.priority = categorical(p, ["Low","Medium","High","Critical"], "Ordinal", true);

    % The baseline is DEFINED as arrival-ordered, so this must be exact.
    reqs.arrival_time  = datetime(reqs.arrival_time);
    reqs = sortrows(reqs, "arrival_time");
    reqs.arrival_order = (1:height(reqs))';
end
```

**Where MATLAB is genuinely better:** the ordinal `categorical`. In Python we carry a `PRIORITY_WEIGHTS` dict and compare strings. Here `reqs.priority >= "High"` is a valid, self-documenting expression, and `groupsummary` groups by tier in the correct order automatically.

---

## 3 · Stages 1–2: integrity and gating

### 3.1 Integrity pre-screen — fully vectorised

```matlab
function packs = integrityPrescreen(packs, cfg)
    n = height(packs);
    packs.integrity_quarantine = false(n,1);
    packs.integrity_reason     = strings(n,1);
    packs.recalibrate_flag     = false(n,1);

    % Test 1 — thermal history conservation. A 24 h running maximum cannot sit
    % below the current reading; if it does, the sensor or its log is faulty.
    if all(ismember(["T","T_24h_max"], packs.Properties.VariableNames))
        bad = packs.T > packs.T_24h_max;
        packs.integrity_quarantine(bad) = true;
        packs.integrity_reason(bad)     = "sensor_thermal";
    end

    % Test 2 — Kirchhoff voltage conservation (skipped on Problem 1: no columns)
    vCols = ["V_pack_V","V_cell_sum_V","I_pack_A","R_interconnect_Ohm"];
    if all(ismember(vCols, packs.Properties.VariableNames))
        drop  = packs.I_pack_A .* packs.R_interconnect_Ohm + 0.05;   % +ADC slack
        bad   = abs(packs.V_pack_V - packs.V_cell_sum_V) > drop ...
                & ~packs.integrity_quarantine;                        % precedence
        packs.integrity_quarantine(bad) = true;
        packs.integrity_reason(bad)     = "adc_voltage";
    end

    % Test 3 — energy bookkeeping. SOFT flag only: gauge drift is not a hazard.
    if all(ismember(["E_reported_Wh","V_pack_V"], packs.Properties.VariableNames))
        eExp = packs.V_pack_V .* cfg.pack.capacity_ah ...
             .* packs.SoC/100 .* packs.SoH/100;
        packs.recalibrate_flag = abs(packs.E_reported_Wh - eExp)./eExp > cfg.energyTol;
    end
end
```

### 3.2 Classification — precedence preserved under vectorisation

The Python version short-circuits with `return`. Vectorising must **not** lose that: a pack breaching both `SoH_low` and `dV_high` has to report `SoH_low`, because that is the rule that actually fired.

```matlab
function packs = classifyHealth(packs, cfg)
    n       = height(packs);
    blocked = packs.integrity_quarantine;
    reason  = packs.integrity_reason;

    % Rule cascade, in the SAME order as classify.py. First match wins.
    rules = { ...
        packs.T       >  cfg.T_degraded_max,   "T_high"     ; ...
        packs.T       <  cfg.T_cold_min,       "T_cold"     ; ...
        packs.SoH     <  cfg.SoH_degraded_min, "SoH_low"    ; ...
        packs.R_int_mOhm  > cfg.R_int_degraded_max, "R_int_high" ; ...
        packs.dV_cell_mV  > cfg.dV_degraded_max,    "dV_high"    };

    for k = 1:size(rules,1)
        hit          = rules{k,1} & ~blocked;   % ← the short-circuit
        reason(hit)  = rules{k,2};
        blocked      = blocked | hit;
    end

    isSafe = packs.T >= cfg.T_safe_min & packs.T <= cfg.T_safe_max ...
           & packs.SoH >= cfg.SoH_safe_min ...
           & packs.R_int_mOhm < cfg.R_int_safe_max ...
           & packs.dV_cell_mV < cfg.dV_safe_max;

    status              = repmat("Degraded but Usable", n, 1);
    status(isSafe & ~blocked) = "Safe and Available";
    status(blocked)           = "Unsafe / Quarantine";

    packs.status = categorical(status, ...
        ["Safe and Available","Degraded but Usable","Unsafe / Quarantine"]);
    packs.quarantine_reason = reason;
end
```

> **Stateflow alternative — worth considering.** This cascade is a textbook state machine. Modelling it in **Stateflow** gives you an executable *diagram* of the gating logic, with transition coverage reporting and animated debugging. For a judging panel, being able to step through the chart and watch a pack fall out at `SoH < 70` is more persuasive than reading a `for` loop. It also produces certification-style artefacts if this were ever headed toward production.

---

## 4 · Stage 3–4: scoring and matching

### 4.1 MAUT + TOPSIS — MATLAB's best showing

TOPSIS in particular is markedly cleaner than the numpy version:

```matlab
function packs = scorePacks(packs, cfg)
    % ---- Engine A: MAUT ------------------------------------------------
    a = cfg.maut.anchors;
    S_SoH = packs.SoH;
    S_IR  = 100*max(0, 1 - (packs.R_int_mOhm - a.IR_offset)/a.IR_span);
    S_Imb = 100*max(0, 1 - (packs.dV_cell_mV - a.dV_offset)/a.dV_span);
    S_T   = 100*max(0, 1 - abs(packs.T - a.T_ref)/a.T_span);

    w = cfg.maut.weights;                       % [.40 .25 .20 .15], sums to 1
    packs.BSS = w.SoH*S_SoH + w.IR*S_IR + w.Imb*S_Imb + w.T*S_T;
    [packs.S_SoH, packs.S_IR, packs.S_Imb, packs.S_T] = deal(S_SoH,S_IR,S_Imb,S_T);

    % ---- Engine B: TOPSIS ----------------------------------------------
    % Quarantined packs are excluded from the normalisation basis so they
    % cannot drag the ideal/anti-ideal points.
    ok = packs.status ~= "Unsafe / Quarantine";
    X  = [packs.SoC(ok), packs.SoH(ok), packs.R_int_mOhm(ok), packs.dV_cell_mV(ok)];

    R = X ./ vecnorm(X, 2, 1);                  % vector normalisation
    V = R .* cfg.topsisWeights;                 % [.35 .30 .20 .15]

    benefit = [true true false false];          % SoC,SoH benefit; R,dV cost
    Aplus   = max(V).*benefit + min(V).*~benefit;
    Aminus  = min(V).*benefit + max(V).*~benefit;

    dPlus  = vecnorm(V - Aplus,  2, 2);
    dMinus = vecnorm(V - Aminus, 2, 2);

    packs.T_score      = nan(height(packs),1);
    packs.T_score(ok)  = 100 * dMinus ./ (dPlus + dMinus);
end
```

Five lines of TOPSIS versus roughly twenty of numpy, and each line reads as the mathematics.

### 4.2 The assignment solve — ⚠ **this does not port directly**

`matchpairs` is **not** the Hungarian algorithm. Per MathWorks, Hungarian is O(N⁴) whereas `matchpairs` runs **O(N³ log N)** dense / **O(nnz · N log N)** sparse. Two consequences:

**(a) `costUnmatched` changes the semantics.** `matchpairs` compares `2*costUnmatched` against cost entries to decide whether leaving a row or column unmatched is cheaper. There is no equivalent in `linear_sum_assignment`. This is actually *better* for our problem — unserved vehicles become a first-class outcome rather than something we post-filter — but the parameter must be tuned deliberately.

**(b) Infeasibility must be expressed structurally.** Our Python masks infeasible edges to `1e9`. In MATLAB the correct idiom is a **sparse cost matrix containing only feasible edges** — the `nnz` term in the complexity confirms that only stored entries are candidates.

```matlab
function assign = allocateProposed(packs, reqs, cfg)
    cand = packs(packs.status ~= "Unsafe / Quarantine" & ~isnan(packs.BSS), :);
    m = height(reqs);  n = height(cand);

    rowIdx = []; colIdx = []; util = [];

    for i = 1:m
        pri   = reqs.priority(i);
        pW    = cfg.priorityWeights.(string(pri));
        peakI = cfg.peakCurrent.(string(pri));
        wait  = 0;                                  % no queue clock in this data

        % --- the three hard constraints ---------------------------------
        feas = cand.SoC >= reqs.min_SoC(i);                      % rule 4
        if ismember(pri, ["Critical","High"])                    % design rule (c)
            feas = feas & cand.status ~= "Degraded but Usable";
        end
        j = find(feas);
        if isempty(j), continue; end

        % U = P·BSS − γ·W − α·I²·R    (R in ohms)
        U = pW*cand.BSS(j) ...
          - cfg.gamma*wait ...
          - cfg.alpha*(peakI^2)*(cand.R_int_mOhm(j)/1000);

        rowIdx = [rowIdx; repmat(i,numel(j),1)];
        colIdx = [colIdx; j];
        util   = [util;   U];
    end

    % matchpairs MINIMISES, so reflect utility about its feasible maximum.
    % Monotonic ⇒ argmin(C) == argmax(U), no distortion of the ranking.
    cost = max(util) - util;

    % Sparse: only feasible pairs exist as entries. Infeasible pairs are
    % structurally absent rather than expensively penalised.
    C = sparse(rowIdx, colIdx, cost, m, n);

    % costUnmatched must exceed any real cost, or the solver will prefer to
    % leave rows unmatched rather than pay for a legitimate assignment.
    M = matchpairs(C, max(cost) + 1);            % M = [row, col] pairs

    assign = buildAssignmentTable(M, reqs, cand);
end
```

> **⚠ Verify before relying on this.** I could not confirm from MathWorks documentation how `matchpairs` treats explicit `Inf`/`NaN` entries, and there is at least one reported issue with sparse cost matrices on R2023a. **Validate the sparse path against a small hand-checked case, and keep a dense fallback** using a large finite penalty (`1e9`) that mirrors the Python. Do not assume equivalence — the two solvers can return *different but equally optimal* matchings when ties exist, which would make a line-by-line diff against the Python output misleading.

### 4.3 The HSF baseline

Inherently sequential — no vectorisation gain, and that is fine. It is ten lines in either language.

```matlab
function assign = allocateHSF(packs, reqs)
    [~, order] = sort(packs.SoC, "descend");     % highest charge first
    pool = packs(order,:);
    used = false(height(pool),1);
    reqs = sortrows(reqs, "arrival_order");      % ← baseline definition

    for i = 1:height(reqs)
        k = find(~used & pool.SoC >= reqs.min_SoC(i), 1, "first");
        if isempty(k), continue; end             % unserved
        used(k) = true;                          % no health gate — by design
        % ... record pairing
    end
end
```

---

## 5 · The actual reason to use MATLAB — dynamic thermal validation

Everything above is a translation. **This is new capability.**

### 5.1 What it proves

Our static model says BAT-049 dissipates 252 W versus BAT-050's 144 W at REQ-004's 55 A peak. A Simulink model answers the question that number only gestures at: **over an 89 km heavy-delivery route, does BAT-049 actually exceed the 50 °C hard limit — and where?**

### 5.2 Lumped thermal model

A first-order energy balance per pack:

$$C_{\text{th}} \frac{dT}{dt} = \underbrace{I(t)^2 R_{\text{int}}(T, \text{SoC})}_{\text{Joule heating}} - \underbrace{hA\bigl(T - T_{\text{amb}}\bigr)}_{\text{convective loss}}$$

with resistance itself temperature- and charge-dependent — the coupling a static model cannot capture:

$$R_{\text{int}}(T,\text{SoC}) = R_{25} \cdot \bigl[1 + \alpha_R (25 - T)\bigr] \cdot f(\text{SoC})$$

This is a **positive feedback loop**: heat raises resistance, which raises heat. A pack near the limit does not drift toward it linearly — it accelerates. That is precisely the failure mode the baseline walks into, and precisely what a static I²R figure understates.

```matlab
function [t, T, verdict] = simulateSwap(pack, req, cfg)
%SIMULATESWAP Thermal trajectory of one pack over one request's duty cycle.

    Rint25 = pack.R_int_mOhm/1000;              % Ω at 25 °C
    Ipeak  = cfg.peakCurrent.(string(req.priority));

    % Duty cycle scaled to the request's actual required range.
    duration = req.range_km / cfg.avgSpeed_kmh * 3600;      % s
    drive    = @(t) Ipeak * cfg.dutyProfile(mod(t, cfg.cyclePeriod));

    % Coupled ODE: temperature rise feeds back into resistance.
    odefun = @(t,T) ( drive(t).^2 .* Rint25 .* (1 + cfg.alphaR*(25 - T)) ...
                    - cfg.hA*(T - cfg.T_ambient) ) / cfg.C_th;

    [t, T] = ode45(odefun, [0 duration], pack.T);

    verdict = struct( ...
        "peakTemp",     max(T), ...
        "crossedLimit", any(T > cfg.T_degraded_max), ...
        "timeToLimit",  firstCrossing(t, T, cfg.T_degraded_max), ...
        "kmToLimit",    firstCrossing(t,T,cfg.T_degraded_max)/3600*cfg.avgSpeed_kmh);
end
```

**The output is the slide that wins the room:** two temperature traces on one axis, the 50 °C quarantine line drawn across, and the baseline's pack crossing it at a specific kilometre while the proposed pack plateaus safely below.

### 5.3 Simscape Battery — the high-fidelity route

If you want physical credibility rather than a lumped approximation, **Simscape Battery** (R2022b+) provides it. It models electrochemical behaviour including charge dynamics, hysteresis, ageing and thermal effects, and its **Battery Pack Builder** auto-generates Simscape models matching a chosen pack topology — including cooling-plate connections, so electrical and thermal responses can be evaluated together.

For our 15S 40 Ah 48 V LFP pack:

```matlab
cell   = batteryCell(Geometry = batteryCylindricalGeometry());
module = batteryModule(cell, NumSeriesCells = 15, ...
                             NumParallelCells = 1);
pack   = batteryPack(module, ...);
% → buildBattery(pack, "LibraryName", "bssPackLib")
```

Per-cell resolution also makes **ΔV_cell honest**. Recall §9.2 of `METHOD.md`: our dashboard's 15-bar imbalance sparkline is a *modelled* spread, because the dataset gives pack-level maximum spread only. A Simscape 15S model computes real per-cell voltages — the caveat disappears.

> **Be honest about the assumptions.** `C_th`, `hA`, `alphaR`, `avgSpeed_kmh` and the duty profile are **not in the competition dataset**. They must be sourced from LFP literature and declared as assumptions, exactly as `PEAK_CURRENT_A` is declared in `METHOD.md` §9.5. A simulation resting on undeclared parameters is weaker than the static number it replaced.

---

## 6 · Dashboard in App Designer

Honest assessment: **App Designer will not match the current web dashboard**, and that is fine — it is aimed at a different job.

```matlab
fig = uifigure("Name","BSS Dispatch", "Color",[0.02 0.03 0.04]);
g   = uigridlayout(fig, [3 4], "BackgroundColor",[0.02 0.03 0.04]);

kpi   = uigridlayout(g, [1 4]);  kpi.Layout.Row = 1;  kpi.Layout.Column = [1 4];
axDist = uiaxes(g); axDist.Layout.Row = 2; axDist.Layout.Column = [1 2];
axCmp  = uiaxes(g); axCmp.Layout.Row  = 2; axCmp.Layout.Column = [3 4];

tbl = uitable(g, "Data", assignTable, "ColumnSortable", true);
tbl.Layout.Row = 3;  tbl.Layout.Column = [1 4];

% Cross-filtering: the workbench behaviour from the web Diagnostics zone
tbl.SelectionChangedFcn = @(src,ev) highlightPack(src, ev, axDist, axCmp);
```

| Capability | Web dashboard | App Designer |
|---|---|---|
| Cross-filtered charts | ✅ | ✅ via `SelectionChangedFcn` |
| Custom SVG (rack map, bipartite lattice) | ✅ | ⚠ hand-rolled on `uiaxes`, laborious |
| Animation / transitions | ✅ GSAP | ❌ effectively none |
| Blindfold-style interaction | ✅ | ⚠ possible, clumsy |
| Shipping to judges | needs Node | ✅ **standalone `.exe` via MATLAB Compiler** |
| Live Simulink coupling | ❌ | ✅ **native** |

**The one place App Designer clearly wins:** it can drive a Simulink simulation live from the UI, and it compiles to a standalone executable a judge can run with no toolchain. If §5 becomes the centrepiece, the dashboard should live where the simulation lives.

---

## 7 · Where each language genuinely wins

| Aspect | Verdict |
|---|---|
| CSV ingest & schema mapping | **MATLAB** — `renamevars` + ordinal `categorical` beat the alias dict |
| TOPSIS / linear algebra | **MATLAB** — `vecnorm` makes it read like the maths |
| Rule cascade | **Tie**, or MATLAB *if* Stateflow is used (executable diagram) |
| Assignment solve | **Python** — `linear_sum_assignment` is a true Hungarian with well-understood semantics; `matchpairs` needs validation |
| Gating precedence clarity | **Python** — short-circuit `return` is unambiguous; vectorised masks need care |
| Dynamic physical simulation | **MATLAB, decisively** — no Python equivalent without major effort |
| Per-cell ΔV fidelity | **MATLAB** — Simscape removes our modelled-spread caveat |
| Dashboard richness | **Python/web, decisively** |
| Distribution to judges | **MATLAB** — compiled `.exe`, no runtime install |
| Reproducibility | **Tie** — both deterministic |

---

## 8 · Effort estimate

| Work item | Effort | Risk |
|---|---|---|
| Port Stages 1–3 (ingest, integrity, gating, scoring) | ~4 h | Low — near-mechanical |
| Port Stage 4 (`matchpairs`) | ~3 h | **Medium** — semantics differ; needs hand-verified tests |
| Port HSF baseline + metrics | ~2 h | Low |
| `tiledlayout` static figures | ~2 h | Low |
| **Simulink thermal model (§5)** | **~8 h** | **Medium** — parameters must be sourced and declared |
| Simscape Battery 15S pack | ~6 h | Medium-high — requires the toolbox licence |
| App Designer dashboard | ~12 h | High — will still be a downgrade on the web UI |

**Recommended split, if MATLAB is on the table:**

1. **Do §5 only.** Build the thermal simulation, feed it the existing `outputs/run_result.json`, and produce the two-trace figure. ~8 hours for the single most persuasive artefact in the deck — it upgrades "108 W worse" into "thermally fails at kilometre 31."
2. Keep the Python solver and web dashboard as they are. They work, they are verified, and they satisfy every mandatory requirement already.
3. Port the full solver **only** if a judge explicitly requires a single-environment submission.

The problem statement permits *"Python, MATLAB/Simulink, Scilab, C/C++, Java or another suitable coding/simulation environment"* — it does not require one environment. A Python optimiser validated by a Simulink physical model is a legitimate and, arguably, stronger answer than either alone.

---

## Sources

- [matchpairs — Solve linear assignment problem (MathWorks)](https://www.mathworks.com/help/matlab/ref/matchpairs.html)
- [Matchpair and Hungarian algorithm — MATLAB Answers](https://www.mathworks.com/matlabcentral/answers/898507-matchpair-and-hungarian-algorithm)
- [matchpairs costUnmatched parameter — MATLAB Answers](https://www.mathworks.com/matlabcentral/answers/505480-matchpairs-function-input-parameter-costunmatched)
- [Simscape Battery (MathWorks)](https://www.mathworks.com/products/simscape-battery.html)
- [Battery Pack Modeling — Simscape Battery](https://www.mathworks.com/help/simscape-battery/create-battery-pack.html)
- [Build Model of Battery Module with Thermal Effects](https://www.mathworks.com/help/simscape-battery/ug/build-battery-module-thermal-effects.html)
- [Thermal Management — Simscape Battery](https://www.mathworks.com/help/simscape-battery/thermal-management-system.html)
- [uigridlayout — Create grid layout manager (MathWorks)](https://www.mathworks.com/help/matlab/ref/uigridlayout.html)
- [uitable — Create table user interface component (MathWorks)](https://www.mathworks.com/help/matlab/ref/uitable.html)
- [Lay Out Apps Programmatically (MathWorks)](https://www.mathworks.com/help/matlab/creating_guis/lay-out-apps-programmatically.html)
