/**
 * Explainability engine.
 *
 * Re-derives, on the client, the three decisions a judge will ask about:
 *   1. why a pack was classified Safe / Degraded / Unsafe,
 *   2. how its suitability score was built parameter by parameter,
 *   3. why a request received the pack it did — or why it was refused one.
 *
 * Every rule and constant is read from the SolverConfig the Python pipeline
 * emitted with the run. There are no threshold literals in this file, so the
 * explanation can never disagree with the model that produced the result.
 * Rule precedence mirrors `classify.py` and the feasibility tests mirror
 * `allocate.py`.
 */

import type {
  AssignmentRow,
  FleetBattery,
  SolverConfig,
} from "@/lib/metrics";
import type { HealthTone } from "@/lib/design-tokens";

/* ══════════════════════════════════════════════════════════════
   Parameter dictionary — the "elucidate the parameters" layer
   ══════════════════════════════════════════════════════════════ */

export type ParamKey = "SoH" | "R_int" | "dV" | "T" | "SoC";

export type ParamInfo = {
  key: ParamKey;
  symbol: string;
  name: string;
  /** Lower-case form for use mid-sentence. */
  phrase: string;
  unit: string;
  /** What the number physically is. */
  what: string;
  /** Why a dispatcher should care. */
  why: string;
  /** What goes wrong when it drifts the wrong way. */
  failure: string;
  /** true when a higher reading is healthier. */
  higherIsBetter: boolean;
  tone: string;
};

export const PARAMS: Record<ParamKey, ParamInfo> = {
  SoH: {
    key: "SoH",
    symbol: "SoH",
    name: "State of health",
    phrase: "state of health",
    unit: "%",
    what: "Usable capacity now, as a percentage of the pack's rated capacity when new.",
    why: "Sets the real range a rider gets. A 70% pack delivers roughly two-thirds of the advertised trip on a full charge.",
    failure:
      "Low SoH quietly shortens every trip it serves and accelerates its own decline under load.",
    higherIsBetter: true,
    tone: "var(--health-safe)",
  },
  R_int: {
    key: "R_int",
    symbol: "R_int",
    name: "Internal resistance (DCIR)",
    phrase: "internal resistance",
    unit: "mΩ",
    what: "Opposition to current inside the pack, measured across the whole series string.",
    why: "Drives I²R heating. At a 55 A peak, 50 mΩ burns ~151 W inside the pack; 150 mΩ burns ~454 W.",
    failure:
      "High resistance turns hard acceleration into a thermal event and sags voltage under load, cutting deliverable power.",
    higherIsBetter: false,
    tone: "var(--accent)",
  },
  dV: {
    key: "dV",
    symbol: "ΔV_cell",
    name: "Cell voltage imbalance",
    phrase: "cell imbalance",
    unit: "mV",
    what: "Spread between the highest and lowest cell in the series string.",
    why: "The weakest cell sets the pack's real floor — the string stops when the first cell hits cut-off, not the average.",
    failure:
      "A wide spread means one cell is over-stressed on every cycle, which ends in accelerated ageing and voltage collapse.",
    higherIsBetter: false,
    tone: "var(--prio-critical)",
  },
  T: {
    key: "T",
    symbol: "T",
    name: "Temperature",
    phrase: "temperature",
    unit: "°C",
    what: "Current pack temperature, cross-checked against the recorded 24-hour maximum.",
    why: "Both extremes hurt: heat accelerates chemical ageing, cold raises resistance and cuts deliverable current.",
    failure:
      "Dispatching an already-hot pack into a heavy duty cycle stacks I²R heating on top of existing thermal load.",
    higherIsBetter: false,
    tone: "var(--health-degraded)",
  },
  SoC: {
    key: "SoC",
    symbol: "SoC",
    name: "State of charge",
    phrase: "state of charge",
    unit: "%",
    what: "Energy currently stored, as a percentage of this pack's present capacity.",
    why: "The only thing the Highest-SoC-First baseline looks at — and a feasibility test, not a health measure.",
    failure:
      "Ranking by charge alone hands a rider a full but high-resistance, imbalanced pack that fails mid-route.",
    higherIsBetter: true,
    tone: "var(--prio-medium)",
  },
};

/* ══════════════════════════════════════════════════════════════
   1 · Classification — why Safe / Degraded / Unsafe
   ══════════════════════════════════════════════════════════════ */

export type GateVerdict = "in-band" | "soft-breach" | "hard-breach" | "unknown";

export type GateEvaluation = {
  param: ParamKey;
  value: number | null;
  /** Human rule text, built from the live config. */
  safeRule: string;
  hardRule: string;
  verdict: GateVerdict;
  /** One sentence stating what this reading did to the classification. */
  note: string;
};

export type ClassificationExplanation = {
  status: string;
  tone: HealthTone;
  /** The single rule that decided the class. */
  deciding: string;
  /** Longer narrative for the story surface. */
  narrative: string;
  gates: GateEvaluation[];
  /** Integrity pre-screen fired before any health rule. */
  integrityFailed: boolean;
  reasonCode: string | null;
};

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export function explainClassification(
  pack: FleetBattery | AssignmentRow,
  cfg: SolverConfig
): ClassificationExplanation {
  const t = cfg.thresholds;
  const T = pack.T ?? null;
  const SoH = pack.SoH ?? null;
  const R = pack.R_int_mOhm ?? null;
  const dV = pack.dV_cell_mV ?? null;
  const status = pack.status ?? "";
  const reasonCode =
    "quarantine_reason" in pack ? (pack.quarantine_reason ?? null) : null;
  const integrityFailed =
    "integrity_quarantine" in pack ? Boolean(pack.integrity_quarantine) : false;

  const gates: GateEvaluation[] = [
    {
      param: "T",
      value: T,
      safeRule: `${t.T_safe_min} … ${t.T_safe_max} °C`,
      hardRule: `> ${t.T_degraded_max} °C or < ${t.T_cold_min} °C`,
      verdict:
        T == null
          ? "unknown"
          : T > t.T_degraded_max || T < t.T_cold_min
            ? "hard-breach"
            : T < t.T_safe_min || T > t.T_safe_max
              ? "soft-breach"
              : "in-band",
      note: "",
    },
    {
      param: "SoH",
      value: SoH,
      safeRule: `≥ ${t.SoH_safe_min} %`,
      hardRule: `< ${t.SoH_degraded_min} %`,
      verdict:
        SoH == null
          ? "unknown"
          : SoH < t.SoH_degraded_min
            ? "hard-breach"
            : SoH < t.SoH_safe_min
              ? "soft-breach"
              : "in-band",
      note: "",
    },
    {
      param: "R_int",
      value: R,
      safeRule: `< ${t.R_int_safe_max} mΩ`,
      hardRule: `> ${t.R_int_degraded_max} mΩ`,
      verdict:
        R == null
          ? "unknown"
          : R > t.R_int_degraded_max
            ? "hard-breach"
            : R >= t.R_int_safe_max
              ? "soft-breach"
              : "in-band",
      note: "",
    },
    {
      param: "dV",
      value: dV,
      safeRule: `< ${t.dV_safe_max} mV`,
      hardRule: `> ${t.dV_degraded_max} mV`,
      verdict:
        dV == null
          ? "unknown"
          : dV > t.dV_degraded_max
            ? "hard-breach"
            : dV >= t.dV_safe_max
              ? "soft-breach"
              : "in-band",
      note: "",
    },
  ];

  for (const g of gates) {
    const p = PARAMS[g.param];
    const v = `${fmt(g.value)} ${p.unit}`;
    g.note =
      g.verdict === "hard-breach"
        ? `${v} breaches the hard limit (${g.hardRule}) — this alone forces quarantine.`
        : g.verdict === "soft-breach"
          ? `${v} is outside the safe band (${g.safeRule}) but inside the hard limit — downgrades to Degraded.`
          : g.verdict === "in-band"
            ? `${v} sits inside the safe band (${g.safeRule}).`
            : "No reading supplied for this parameter.";
  }

  const tone: HealthTone = status.toLowerCase().startsWith("safe")
    ? "safe"
    : status.toLowerCase().startsWith("degraded")
      ? "degraded"
      : status
        ? "unsafe"
        : "unknown";

  // Precedence mirrors classify.py: integrity first, then hard gates in order.
  const hard = gates.find((g) => g.verdict === "hard-breach");
  const softs = gates.filter((g) => g.verdict === "soft-breach");

  let deciding: string;
  let narrative: string;

  if (integrityFailed) {
    deciding = "Cross-field integrity check failed before any health rule ran.";
    narrative =
      reasonCode === "sensor_thermal"
        ? "The recorded 24-hour maximum temperature is below the current reading — physically impossible, so the thermal sensor or its log is untrustworthy. The pack is quarantined not because it is known bad, but because its telemetry cannot be believed."
        : "A cross-field consistency test failed, meaning two readings that must agree do not. The pack is quarantined on the grounds that its telemetry is unreliable, regardless of what the individual values say.";
  } else if (hard) {
    const p = PARAMS[hard.param];
    deciding = `${p.symbol} = ${fmt(hard.value)} ${p.unit} breaches the hard limit ${hard.hardRule}.`;
    narrative = `${p.failure} The pack is hard-blocked: the solver removes it from the candidate pool entirely, so no request can be matched to it under any priority.`;
  } else if (softs.length > 0) {
    const list = softs
      .map((g) => `${PARAMS[g.param].symbol} ${fmt(g.value)} ${PARAMS[g.param].unit}`)
      .join(", ");
    deciding = `${list} outside the safe band, but every hard limit holds.`;
    narrative = `The pack is usable but not pristine, so it stays in the pool with a restriction: ${cfg.high_demand_priorities.join(" and ")} requests cannot be matched to it. It remains available for lower-priority, shorter-duty trips.`;
  } else {
    deciding = "All four parameters sit inside their safe bands.";
    narrative =
      "Nothing restricts this pack. It is eligible for every priority tier, and its suitability score alone decides where it goes.";
  }

  return {
    status: status || "Unclassified",
    tone,
    deciding,
    narrative,
    gates,
    integrityFailed,
    reasonCode,
  };
}

/* ══════════════════════════════════════════════════════════════
   2 · Suitability score — parameter by parameter
   ══════════════════════════════════════════════════════════════ */

export type SubScoreExplanation = {
  param: ParamKey;
  /** Raw physical reading. */
  raw: number | null;
  /** Normalised 0–100 utility. */
  sub: number;
  weight: number;
  contribution: number;
  /** The normalisation expression, rendered with live anchors. */
  formula: string;
  /** Worked substitution for this specific pack. */
  working: string;
  /** Points still available on this term. */
  headroom: number;
};

export type BssExplanation = {
  total: number;
  parts: SubScoreExplanation[];
  /** Term where recovering points would move the total the most. */
  biggestLoss: SubScoreExplanation | null;
  formula: string;
};

export function explainBss(
  pack: FleetBattery | AssignmentRow,
  cfg: SolverConfig
): BssExplanation {
  const w = cfg.maut.weights;
  const a = cfg.maut.anchors;

  const parts: SubScoreExplanation[] = [
    {
      param: "SoH",
      raw: pack.SoH ?? null,
      sub: pack.S_SoH ?? 0,
      weight: w.SoH,
      contribution: (pack.S_SoH ?? 0) * w.SoH,
      formula: "S_SoH = SoH",
      working: `${fmt(pack.SoH)} % → ${fmt(pack.S_SoH)} pts`,
      headroom: 0,
    },
    {
      param: "R_int",
      raw: pack.R_int_mOhm ?? null,
      sub: pack.S_IR ?? 0,
      weight: w.IR,
      contribution: (pack.S_IR ?? 0) * w.IR,
      formula: `S_IR = 100 · max(0, 1 − (R_int − ${a.IR_offset}) / ${a.IR_span})`,
      working: `100 · (1 − (${fmt(pack.R_int_mOhm)} − ${a.IR_offset}) / ${a.IR_span}) = ${fmt(pack.S_IR)} pts`,
      headroom: 0,
    },
    {
      param: "dV",
      raw: pack.dV_cell_mV ?? null,
      sub: pack.S_Imb ?? 0,
      weight: w.Imb,
      contribution: (pack.S_Imb ?? 0) * w.Imb,
      formula: `S_Imb = 100 · max(0, 1 − (ΔV − ${a.dV_offset}) / ${a.dV_span})`,
      working: `100 · (1 − (${fmt(pack.dV_cell_mV)} − ${a.dV_offset}) / ${a.dV_span}) = ${fmt(pack.S_Imb)} pts`,
      headroom: 0,
    },
    {
      param: "T",
      raw: pack.T ?? null,
      sub: pack.S_T ?? 0,
      weight: w.T,
      contribution: (pack.S_T ?? 0) * w.T,
      formula: `S_T = 100 · max(0, 1 − |T − ${a.T_ref}| / ${a.T_span})`,
      working: `100 · (1 − |${fmt(pack.T)} − ${a.T_ref}| / ${a.T_span}) = ${fmt(pack.S_T)} pts`,
      headroom: 0,
    },
  ];

  for (const p of parts) {
    // Weighted points still recoverable if this sub-score reached 100.
    p.headroom = (100 - p.sub) * p.weight;
  }

  const total = parts.reduce((s, p) => s + p.contribution, 0);
  const biggestLoss =
    parts.length > 0
      ? parts.reduce((worst, p) => (p.headroom > worst.headroom ? p : worst))
      : null;

  return {
    total,
    parts,
    biggestLoss,
    formula: `BSS = ${w.SoH} · S_SoH + ${w.IR} · S_IR + ${w.Imb} · S_Imb + ${w.T} · S_T`,
  };
}

/* ══════════════════════════════════════════════════════════════
   3 · Allocation — why this pack, or why none
   ══════════════════════════════════════════════════════════════ */

export type RejectReason =
  | "quarantined"
  | "soc-below-min"
  | "degraded-high-priority"
  | "taken"
  | null;

export type CandidateEval = {
  pack: FleetBattery;
  reject: RejectReason;
  /** Utility for this pairing, null when infeasible. */
  utility: number | null;
  jouleP: number;
  chosen: boolean;
};

export const REJECT_COPY: Record<Exclude<RejectReason, null>, string> = {
  quarantined: "Quarantined — hard-blocked from every request",
  "soc-below-min": "Charge below this request's minimum acceptable SoC",
  "degraded-high-priority":
    "Degraded packs are not offered to Critical or High priority",
  taken: "Already allocated to another request in this run",
};

export type AllocationExplanation = {
  served: boolean;
  /** Headline sentence. */
  verdict: string;
  /** Supporting narrative. */
  narrative: string;
  utility: number | null;
  /** Rank of the chosen pack among this request's feasible options, by utility. */
  rank: number | null;
  feasibleCount: number;
  /** The single best pack for this request considered alone. */
  personalBest: CandidateEval | null;
  /** True when the global optimum gave this request something other than its personal best. */
  yieldedToGlobal: boolean;
  candidates: CandidateEval[];
  /** Counts of why the ineligible packs were ineligible. */
  rejectTally: Record<string, number>;
};

/**
 * Recomputes the feasibility tests and utility term from `allocate.py`.
 *
 * Wait time is read from the row when the dataset supplies it; the Problem 1
 * demand file carries only a tolerance (W_max), so the penalty term is zero
 * there — matching what the solver did.
 */
export function explainAllocation(
  row: AssignmentRow,
  fleet: FleetBattery[],
  cfg: SolverConfig,
  /** Battery ids consumed by other requests in the same policy run. */
  takenBy: Map<string, string>
): AllocationExplanation {
  const priority = row.priority;
  const pWeight =
    row.priority_weight ?? cfg.priority_weights[priority] ?? 1;
  const peakI = cfg.peak_current_a[priority] ?? 0;
  const wait = row.wait_min ?? 0;
  const minSoC = row.min_SoC ?? 0;
  const highDemand = cfg.high_demand_priorities.includes(priority);

  const candidates: CandidateEval[] = fleet.map((pack) => {
    const status = (pack.status ?? "").toLowerCase();
    let reject: RejectReason = null;

    if (status.includes("quarantine") || status.includes("unsafe")) {
      reject = "quarantined";
    } else if (pack.SoC != null && pack.SoC < minSoC) {
      reject = "soc-below-min";
    } else if (status.startsWith("degraded") && highDemand) {
      reject = "degraded-high-priority";
    } else {
      const owner = takenBy.get(pack.battery_id);
      if (owner != null && owner !== row.vehicle_id) reject = "taken";
    }

    const rOhm = (pack.R_int_mOhm ?? 0) / 1000;
    const jouleP = peakI * peakI * rOhm;
    const utility =
      reject === "taken" || reject === null
        ? pWeight * (pack.BSS ?? 0) -
          cfg.penalties.wait_gamma * wait -
          cfg.penalties.joule_alpha * peakI * peakI * rOhm
        : null;

    return {
      pack,
      reject,
      utility,
      jouleP,
      chosen: row.battery_id === pack.battery_id,
    };
  });

  const rejectTally: Record<string, number> = {};
  for (const c of candidates) {
    if (c.reject) rejectTally[c.reject] = (rejectTally[c.reject] ?? 0) + 1;
  }

  // Feasible for *this* request ignoring what other requests took.
  const feasible = candidates
    .filter((c) => c.reject === null || c.reject === "taken")
    .sort((a, b) => (b.utility ?? -Infinity) - (a.utility ?? -Infinity));

  const personalBest = feasible[0] ?? null;
  const chosen = candidates.find((c) => c.chosen) ?? null;
  const rank = chosen ? feasible.findIndex((c) => c.chosen) + 1 : null;
  const yieldedToGlobal =
    chosen != null && personalBest != null && !personalBest.chosen;

  if (!row.served || !chosen) {
    const blocked = Object.entries(rejectTally)
      .map(([k, n]) => `${n} ${REJECT_COPY[k as Exclude<RejectReason, null>].toLowerCase()}`)
      .join("; ");
    return {
      served: false,
      verdict: `No pack could be matched to ${row.vehicle_id}.`,
      narrative: `Every candidate failed at least one hard constraint: ${blocked || "none available"}. The solver leaves a request unserved rather than break a safety rule — an unserved rider is recoverable, an unsafe swap is not.`,
      utility: null,
      rank: null,
      feasibleCount: feasible.length,
      personalBest,
      yieldedToGlobal: false,
      candidates,
      rejectTally,
    };
  }

  const p = chosen.pack;
  const verdict = `${row.vehicle_id} received ${p.battery_id} — feasible, and globally optimal across all ${cfg.priority_weights ? "requests" : ""}.`;

  const narrativeParts: string[] = [];
  narrativeParts.push(
    `It cleared every hard constraint: status ${p.status}, charge ${fmt(p.SoC)} % against a ${fmt(minSoC, 0)} % minimum${highDemand ? ", and it is not a Degraded pack (barred for this tier)" : ""}.`
  );
  narrativeParts.push(
    `Its utility for this pairing is ${fmt(chosen.utility)} = ${pWeight} × ${fmt(p.BSS)} (priority × suitability) − ${cfg.penalties.joule_alpha} × ${peakI}² × ${fmt((p.R_int_mOhm ?? 0) / 1000, 4)} Ω (Joule load-match penalty)${wait > 0 ? ` − ${cfg.penalties.wait_gamma} × ${fmt(wait)} (queue wait)` : ""}.`
  );
  if (yieldedToGlobal && personalBest) {
    narrativeParts.push(
      `Note this is rank ${rank} of ${feasible.length} for this request alone — ${personalBest.pack.battery_id} scored higher here, but the Hungarian solver maximises total utility across all requests, so that pack was released to a pairing where it was worth more. Per-request greed is exactly what the baseline does, and it is what costs the baseline its safety record.`
    );
  } else {
    narrativeParts.push(
      `This was also the single best feasible pack for this request, out of ${feasible.length} that cleared the constraints.`
    );
  }

  return {
    served: true,
    verdict,
    narrative: narrativeParts.join(" "),
    utility: chosen.utility,
    rank,
    feasibleCount: feasible.length,
    personalBest,
    yieldedToGlobal,
    candidates,
    rejectTally,
  };
}

/** Battery id → vehicle it was allocated to, for a given policy's rows. */
export function buildTakenMap(rows: AssignmentRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.served && r.battery_id) m.set(r.battery_id, r.vehicle_id);
  }
  return m;
}
