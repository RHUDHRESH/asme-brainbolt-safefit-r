/**
 * Client-side re-derivation of the SafeFit-R safety gate.
 *
 * The thresholds live in the solver and travel on `config.thresholds`; the
 * constants below are only the fallback for a caller with no payload in hand.
 * They must stay equal to the SafeFit-R values in bss_dispatch/config.py — if
 * the two ever disagree, the UI is describing a gate the solver is not running.
 *
 * The gate is two-level and the levels mean different things:
 *   hard  → never dispatched, at any priority, for any mission
 *   soft  → dispatchable, but the mission-fit cost steers it toward easier work
 *
 * Three of the hard reasons are not health readings at all. Station status is a
 * human declaration; the energy-ceiling and thermal-history checks are the pack
 * contradicting its own telemetry. A pack can be perfectly healthy on every
 * gauge and still fail those, which is exactly why they sit above the gauges.
 */

export const GATES = {
  T_SAFE_MIN: -20,
  T_SAFE_MAX: 42,
  T_DEGRADED_MAX: 48,
  T_COLD_MIN: -20,
  SOH_SAFE_MIN: 75,
  SOH_DEGRADED_MIN: 65,
  R_INT_SAFE_MAX: 80,
  R_INT_DEGRADED_MAX: 120,
  DV_SAFE_MAX: 70,
  DV_DEGRADED_MAX: 100,
};

export type GateThresholds = typeof GATES;

/** Maps a solver `config.thresholds` block onto the gate constants. */
export function gatesFromConfig(
  thresholds?: Record<string, number> | null
): GateThresholds {
  if (!thresholds) return GATES;
  return {
    T_SAFE_MIN: thresholds.T_safe_min ?? GATES.T_SAFE_MIN,
    T_SAFE_MAX: thresholds.T_safe_max ?? GATES.T_SAFE_MAX,
    T_DEGRADED_MAX: thresholds.T_degraded_max ?? GATES.T_DEGRADED_MAX,
    T_COLD_MIN: thresholds.T_cold_min ?? GATES.T_COLD_MIN,
    SOH_SAFE_MIN: thresholds.SoH_safe_min ?? GATES.SOH_SAFE_MIN,
    SOH_DEGRADED_MIN: thresholds.SoH_degraded_min ?? GATES.SOH_DEGRADED_MIN,
    R_INT_SAFE_MAX: thresholds.R_int_safe_max ?? GATES.R_INT_SAFE_MAX,
    R_INT_DEGRADED_MAX:
      thresholds.R_int_degraded_max ?? GATES.R_INT_DEGRADED_MAX,
    DV_SAFE_MAX: thresholds.dV_safe_max ?? GATES.DV_SAFE_MAX,
    DV_DEGRADED_MAX: thresholds.dV_degraded_max ?? GATES.DV_DEGRADED_MAX,
  };
}

/**
 * Reason code → the sentence a judge should read.
 *
 * The solver emits its own copy of this map on `classification.reason_text`,
 * which wins when present. This copy is the fallback and the type anchor.
 */
export const REASON_COPY: Record<string, string> = {
  // --- hard: declaration and self-contradiction ---
  station_status_quarantine:
    "Station has flagged this pack REVIEW/QUARANTINE — the declaration outranks any reading",
  energy_exceeds_physical_ceiling:
    "Reported energy is above what its charge alone could hold — the telemetry is impossible, not merely drifted",
  temperature_exceeds_24h_maximum:
    "Pack is hotter now than its own recorded 24-hour maximum — the thermal log is inconsistent",
  // --- hard: health gauges ---
  overtemperature: "Temperature at or above the dispatch limit",
  state_of_health_below_floor: "Capacity fade past the safety floor",
  cell_imbalance_critical:
    "Cell voltage spread at or above the hard limit — the series string is uneven",
  internal_resistance_critical:
    "Internal resistance at or above the hard limit",
  // --- soft ---
  capacity_fade:
    "Reduced capacity — usable, but only for lower-severity missions",
  elevated_temperature: "Running warm — thermal margin is narrowed",
  cell_imbalance_elevated:
    "Cell spread elevated — weak-cell risk under long discharge",
  internal_resistance_elevated:
    "Resistance elevated — more sag and heating under load",
  recent_thermal_excursion:
    "Exceeded the derate temperature within the last 24 hours",
  // --- trust, not safety ---
  reported_energy_drift:
    "Reported energy disagrees with charge and health by more than 10%",
  soh_inconsistent_with_usage_history:
    "Claimed health does not match this pack's own cycle and age record",
  // --- retired v1 codes, kept so an archived run still reads ---
  T_high: "Temperature above the hard maximum",
  T_cold: "Temperature below the hard minimum",
  SoH_low: "State of Health below the hard minimum",
  R_int_high: "Internal Resistance above the hard maximum",
  dV_high: "Cell Voltage Imbalance above the hard maximum",
  sensor_thermal:
    "Integrity fault: live Temperature exceeds the recorded 24-hour thermal history",
  adc_voltage:
    "Integrity fault: pack voltage does not match the sum of measured cell voltages",
  integrity: "Integrity check failed — sensor or telemetry inconsistency",
};

/** Codes that block dispatch outright, as opposed to narrowing it. */
export const HARD_REASONS = new Set([
  "station_status_quarantine",
  "energy_exceeds_physical_ceiling",
  "temperature_exceeds_24h_maximum",
  "overtemperature",
  "state_of_health_below_floor",
  "cell_imbalance_critical",
  "internal_resistance_critical",
  "T_high",
  "T_cold",
  "SoH_low",
  "R_int_high",
  "dV_high",
  "sensor_thermal",
  "adc_voltage",
  "integrity",
]);

/** Full display names for gate checklist rows (judge UI). */
export const GATE_METRIC_FULL: Record<string, string> = {
  T: "Temperature (T)",
  SoH: "State of Health (SoH)",
  R_int: "Internal Resistance (R_int)",
  dV: "Cell Voltage Imbalance (ΔV)",
};

export type GateResult = "pass" | "soft" | "fail";

export type GateRow = {
  metric: string;
  value: string;
  limit: string;
  result: GateResult;
};

export type PackLike = {
  status?: string | null;
  SoC?: number | null;
  SoH?: number | null;
  T?: number | null;
  R_int_mOhm?: number | null;
  dV_cell_mV?: number | null;
  quarantine_reason?: string | null;
  BSS?: number | null;
  T_score?: number | null;
  min_SoC?: number | null;
  priority?: string | null;
  battery_id?: string | null;
  /** Evidence the health gauges cannot express. */
  T_24h_max?: number | null;
  E_avail_kWh?: number | null;
  station_status?: string | null;
};

function fmt(n: number | null | undefined, unit = "", digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}${unit}`;
}

/**
 * Human sentence for one or more reason codes.
 *
 * The solver joins multiple reasons with a semicolon, so a pack that fails the
 * station check *and* runs hot reads as both, not as a raw code string.
 */
export function reasonLabel(
  code: string | null | undefined,
  copy: Record<string, string> = REASON_COPY
): string {
  if (!code) return "";
  return String(code)
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => copy[c] ?? REASON_COPY[c] ?? c)
    .join(" · ");
}

/** Whether any code in a joined reason string blocks dispatch. */
export function isHardReason(code: string | null | undefined): boolean {
  if (!code) return false;
  return String(code)
    .split(";")
    .some((c) => HARD_REASONS.has(c.trim()));
}

/** Failed / soft first. */
export function buildGateChecklist(
  pack: PackLike,
  gates: GateThresholds = GATES
): GateRow[] {
  const t = pack.T;
  const soh = pack.SoH;
  const r = pack.R_int_mOhm;
  const dv = pack.dV_cell_mV;
  const g = gates;

  // Declaration and self-contradiction checks come first: they can fail a pack
  // whose every gauge reads healthy, so burying them under the gauges would
  // misrepresent why it is blocked.
  const evidence: GateRow[] = [];
  const codes = String(pack.quarantine_reason ?? "").split(";").map((c) => c.trim());
  const flagged = (code: string) => codes.includes(code);

  if (pack.station_status != null || flagged("station_status_quarantine")) {
    const blocked = flagged("station_status_quarantine");
    evidence.push({
      metric: "Station declaration",
      value: pack.station_status ?? (blocked ? "REVIEW/QUARANTINE" : "AVAILABLE"),
      limit: "must not be REVIEW/QUARANTINE",
      result: blocked ? "fail" : "pass",
    });
  }
  if (flagged("energy_exceeds_physical_ceiling")) {
    evidence.push({
      metric: "Reported energy",
      value: pack.E_avail_kWh != null ? `${pack.E_avail_kWh.toFixed(3)} kWh` : "—",
      limit: "must not exceed the charge-only ceiling",
      result: "fail",
    });
  }
  if (flagged("temperature_exceeds_24h_maximum")) {
    evidence.push({
      metric: "Thermal history",
      value:
        pack.T != null && pack.T_24h_max != null
          ? `${pack.T.toFixed(1)} > ${pack.T_24h_max.toFixed(1)} °C`
          : "inconsistent",
      limit: "now must not exceed the 24 h maximum",
      result: "fail",
    });
  }

  const rows: GateRow[] = [
    {
      metric: GATE_METRIC_FULL.T,
      value: fmt(t, "°C"),
      limit: `${g.T_SAFE_MIN}…${g.T_SAFE_MAX} °C safe · hard ≤${g.T_DEGRADED_MAX} / ≥${g.T_COLD_MIN}`,
      result:
        t == null
          ? "pass"
          : t > g.T_DEGRADED_MAX || t < g.T_COLD_MIN
            ? "fail"
            : t < g.T_SAFE_MIN || t > g.T_SAFE_MAX
              ? "soft"
              : "pass",
    },
    {
      metric: GATE_METRIC_FULL.SoH,
      value: fmt(soh, "%"),
      limit: `≥${g.SOH_SAFE_MIN}% safe · hard ≥${g.SOH_DEGRADED_MIN}%`,
      result:
        soh == null
          ? "pass"
          : soh < g.SOH_DEGRADED_MIN
            ? "fail"
            : soh < g.SOH_SAFE_MIN
              ? "soft"
              : "pass",
    },
    {
      metric: GATE_METRIC_FULL.R_int,
      value: fmt(r, " mΩ"),
      limit: `<${g.R_INT_SAFE_MAX} mΩ safe · hard ≤${g.R_INT_DEGRADED_MAX}`,
      result:
        r == null
          ? "pass"
          : r > g.R_INT_DEGRADED_MAX
            ? "fail"
            : r >= g.R_INT_SAFE_MAX
              ? "soft"
              : "pass",
    },
    {
      metric: GATE_METRIC_FULL.dV,
      value: fmt(dv, " mV"),
      limit: `<${g.DV_SAFE_MAX} mV safe · hard ≤${g.DV_DEGRADED_MAX}`,
      result:
        dv == null
          ? "pass"
          : dv > g.DV_DEGRADED_MAX
            ? "fail"
            : dv >= g.DV_SAFE_MAX
              ? "soft"
              : "pass",
    },
  ];

  const rank = { fail: 0, soft: 1, pass: 2 };
  return [...evidence, ...rows.sort((a, b) => rank[a.result] - rank[b.result])];
}

export function oneLineReason(pack: PackLike): string {
  const status = pack.status ?? "";
  const code = pack.quarantine_reason ?? "";

  if (status.includes("Quarantine") || code) {
    const checklist = buildGateChecklist(pack);
    const failed = checklist.find((r) => r.result === "fail");
    if (failed) {
      return `Blocked · ${failed.metric} ${failed.value} (${failed.limit.split("·")[0]?.trim() ?? failed.limit})`;
    }
    if (code) return `Blocked · ${reasonLabel(code)}`;
    return "Blocked · quarantine";
  }

  if (status.includes("Degraded")) {
    const soft = buildGateChecklist(pack).find((r) => r.result === "soft");
    if (soft) {
      return `Degraded · ${soft.metric} ${soft.value} · Critical/High blocked`;
    }
    return "Degraded · soft gate · Critical/High blocked";
  }

  if (status.includes("Safe")) {
    return "All soft gates in band · eligible for all priorities";
  }

  return status || "No status";
}

export function assignmentOneLiner(args: {
  vehicleId: string;
  batteryId: string | null;
  priority: string;
  SoC: number | null;
  minSoC: number | null;
  BSS: number | null;
  status: string | null;
  hsfBatteryId?: string | null;
  hsfStatus?: string | null;
}): string {
  const socOk =
    args.SoC != null && args.minSoC != null
      ? `SoC ${args.SoC.toFixed(0)}≥${args.minSoC.toFixed(0)}`
      : args.SoC != null
        ? `SoC ${args.SoC.toFixed(0)}%`
        : "SoC —";
  const bss =
    args.BSS != null ? `BSS ${args.BSS.toFixed(1)}` : "BSS —";
  const hsf =
    args.hsfBatteryId != null
      ? ` · HSF→${args.hsfBatteryId}${
          args.hsfStatus?.includes("Quarantine") ? " (Quarantine)" : ""
        }`
      : "";
  return `${args.vehicleId} ← ${args.batteryId ?? "—"} · ${args.priority} · ${socOk} · ${bss}${hsf}`;
}

export function shortStatus(status: string | null | undefined): string {
  if (!status) return "—";
  if (status.includes("Safe")) return "Safe";
  if (status.includes("Degraded")) return "Degraded";
  if (status.includes("Quarantine")) return "Quarantine";
  return status;
}
