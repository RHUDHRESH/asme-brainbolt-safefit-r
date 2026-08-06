export type PolicyMetrics = {
  total_vehicles: number;
  successfully_served: number;
  service_rate_pct: number;
  unserved: number;
  high_critical_served_pct: number;
  unsafe_allocations: number;
  avg_soh_allocated: number;
  avg_bss_allocated: number;
  /** Predicted in-service failures, from the same physics for both policies. */
  thermal_stress_incidents: number;
  voltage_collapse_incidents: number;
  /** Null when the demand set contains no Critical requests. */
  critical_avg_soh: number | null;
  critical_avg_ir: number | null;
  /** Optional — present only when queueing is explicitly modelled. */
  avg_wait_min?: number | null;
  /**
   * SafeFit-R differentiating metrics. `energy_infeasible_allocations` is the
   * one the mandatory set cannot see: allocations that satisfy min-SoC and
   * still cannot deliver the mission's energy.
   */
  station_quarantine_allocations: number;
  energy_infeasible_allocations: number;
  energy_shortfall_total_kWh: number;
  worst_energy_shortfall_kWh: number;
  untrusted_allocations: number;
  avg_soc_oversupply_pts?: number | null;
  premium_packs_consumed?: number | null;
  degraded_utilisation_pct?: number | null;
  deliverable_energy_consumed_kWh?: number | null;
  avg_energy_margin_kWh?: number | null;
};

export type ClassificationSummary = {
  total: number;
  counts: Record<string, number>;
  pct: Record<string, number>;
  /** Hard-gate reasons — these packs are never dispatched. */
  quarantine_reasons: Record<string, number>;
  /** Soft-gate reasons — usable, but only for lower-severity missions. */
  degraded_reasons?: Record<string, number>;
  /** Reason code → the sentence a judge should read. Emitted by the solver. */
  reason_text?: Record<string, string>;
  hard_reason_codes?: string[];
  untrusted_packs?: number;
};

/** MAUT sub-scores, present on every scored pack. */
export type SubScores = {
  S_SoH?: number | null;
  S_IR?: number | null;
  S_Imb?: number | null;
  S_T?: number | null;
};

export type AssignmentRow = SubScores & {
  vehicle_id: string;
  priority: string;
  served: boolean;
  battery_id: string | null;
  status: string | null;
  quarantine_reason?: string | null;
  SoC: number | null;
  SoH: number | null;
  T?: number | null;
  T_24h_max?: number | null;
  BSS: number | null;
  T_score: number | null;
  R_int_mOhm: number | null;
  dV_cell_mV?: number | null;
  min_SoC?: number | null;
  /** Request descriptors carried straight from the demand CSV. */
  vehicle_type?: string | null;
  load_category?: string | null;
  range_km?: number | null;
  arrival_time?: string | null;
  arrival_order?: number | null;
  wait_min?: number | null;
  W_max_min?: number | null;
  priority_weight?: number | null;
  /** Pack usage telemetry from the fleet CSV. */
  cycle_count?: number | null;
  age_years?: number | null;
  E_avail_kWh?: number | null;
  /**
   * SafeFit-R per-edge physics. `energy_margin_kWh` below zero means the pack
   * clears every stated constraint and still cannot finish the trip.
   */
  E_deliverable_kWh?: number | null;
  E_required_kWh?: number | null;
  energy_margin_kWh?: number | null;
  v_sag_V?: number | null;
  joule_rise_C?: number | null;
  projected_T_C?: number | null;
  fit_cost?: number | null;
  trusted?: boolean | null;
  unserved_reason?: string | null;
  severity?: number | null;
  I_peak_A?: number | null;
  duration_h?: number | null;
  E_mission_kWh?: number | null;
};

/** One arrival step of a policy's dispatch, in the order the day happened. */
export type TimelineStep = {
  step: number;
  vehicle_id: string;
  served: boolean;
  battery_id: string | null;
  SoC: number | null;
  SoH: number | null;
  E_deliverable_kWh: number | null;
  energy_margin_kWh: number | null;
  /** Packs still on the shelf that could serve the hardest mission. */
  premium_remaining: number;
};

export type TimelineRequest = {
  vehicle_id: string;
  step: number;
  arrival_time: string | null;
  priority: string;
  wait_budget_min: number | null;
  severity: number | null;
  E_required_kWh: number | null;
};

export type TimelineBlock = {
  arrival_first: string | null;
  arrival_last: string | null;
  premium_pack_count: number;
  premium_threshold_kWh: number;
  requests: TimelineRequest[];
  series: { Proposed: TimelineStep[]; HSF: TimelineStep[] };
  /** Correlation of allocated SoC against arrival order, per policy. */
  soc_decay_corr: { Proposed: number | null; HSF: number | null };
};

/** One of the brief's five verification rules, recomputed from the assignments. */
export type VerificationCheck = {
  pass: boolean;
  checked: number;
  violations: string[];
};

export type VerificationBlock = Record<string, VerificationCheck | boolean> & {
  all_pass?: boolean;
};

export type FleetBattery = SubScores & {
  battery_id: string;
  /** Physical shelf index = row order in the fleet dataset. */
  slot?: number | null;
  status: string;
  SoC: number | null;
  SoH: number | null;
  T?: number | null;
  T_24h_max?: number | null;
  R_int_mOhm: number | null;
  dV_cell_mV: number | null;
  quarantine_reason?: string | null;
  assigned_vehicle_id: string | null;
  priority: string | null;
  BSS: number | null;
  T_score: number | null;
  cycle_count?: number | null;
  age_years?: number | null;
  E_avail_kWh?: number | null;
  chemistry?: string | null;
  V_nom?: number | null;
  Ah_rated?: number | null;
  station_status?: string | null;
  integrity_quarantine?: boolean;
  recalibrate_flag?: boolean;
};

/**
 * Thresholds/weights emitted by the Python solver. The dashboard renders these
 * verbatim so a config.py change shows up in the UI without a code edit.
 */
/** One rung of the lexicographic objective ladder. */
export type LexTier = {
  rank: number;
  label: string;
  weight: number | string;
};

export type BssDimension = {
  key: "capacity" | "power" | "balance" | "thermal";
  label: string;
  inputs: string[];
};

export type SolverConfig = {
  pack: {
    series_cells: number;
    capacity_ah: number;
    nominal_v: number;
    nominal_kwh?: number;
  };
  /** SafeFit-R gate. Crossing a hard limit blocks dispatch outright. */
  gate_hard?: {
    SoH_min: number;
    T_max: number;
    dV_max: number;
    R_int_max: number;
  };
  /** Crossing a soft limit narrows which missions a pack may take. */
  gate_soft?: {
    SoH_min: number;
    T_max: number;
    dV_max: number;
    R_int_max: number;
  };
  feasibility?: {
    energy_reserve_fraction: number;
    sag_floor_fraction: number;
    thermal_capacity_j_per_k: number;
    joule_retention: number;
  };
  fit_cost_weights?: Record<string, number>;
  lex_tiers?: LexTier[];
  bss_dimensions?: BssDimension[];
  bss_aggregation?: string;
  chemistry?: Record<string, Record<string, number>>;
  assumptions?: {
    vehicle_speed_kmh: Record<string, number>;
    load_peak_factor: Record<string, number>;
  };
  station_status_blocking?: string[];
  thresholds: {
    T_safe_min: number;
    T_safe_max: number;
    T_degraded_max: number;
    T_cold_min: number;
    SoH_safe_min: number;
    SoH_degraded_min: number;
    R_int_safe_max: number;
    R_int_degraded_max: number;
    dV_safe_max: number;
    dV_degraded_max: number;
    energy_residual_tol: number;
  };
  maut: {
    weights: { SoH: number; IR: number; Imb: number; T: number };
    anchors: {
      T_ref: number;
      T_span: number;
      IR_offset: number;
      IR_span: number;
      dV_offset: number;
      dV_span: number;
    };
  };
  topsis_weights: { SoC: number; SoH: number; R_int: number; dV: number };
  priority_weights: Record<string, number>;
  peak_current_a: Record<string, number>;
  high_demand_priorities: string[];
  penalties: { wait_gamma: number; joule_alpha: number };
  incident_thresholds: {
    thermal_stress_ir_mOhm: number;
    voltage_collapse_ir_mOhm: number;
    voltage_collapse_min_current_a: number;
  };
};

export type TwistHook = {
  enabled: boolean;
  fn: string;
  factor?: number;
  ratio?: number;
};

export type DrillFilter = {
  status?: string;
  quarantineReason?: string;
  served?: "all" | "served" | "unserved";
  priority?: string;
  focusVehicleId?: string;
  focusBatteryId?: string;
  divergencesOnly?: boolean;
};

/**
 * Where the painted numbers came from. There is deliberately no synthetic or
 * seed member: the only way to produce results is to upload measured CSVs.
 * "csv" is a run off the default files in data/, "live" a resumed prior run.
 */
export type MetricsSource = "empty" | "upload" | "csv" | "live";

export type MetricsPayload = {
  classification: ClassificationSummary | null;
  comparison: {
    Proposed: PolicyMetrics;
    HSF: PolicyMetrics;
  } | null;
  assignments?: {
    Proposed: AssignmentRow[];
    HSF: AssignmentRow[];
  };
  fleet?: FleetBattery[];
  config?: SolverConfig | null;
  twists?: Record<string, TwistHook>;
  timeline?: TimelineBlock | null;
  verification?: { Proposed: VerificationBlock; HSF: VerificationBlock } | null;
  audit?: Record<string, string[]>;
  input_hash?: string | null;
  solver?: string | null;
  batteries_file?: string | null;
  vehicles_file?: string | null;
  n_batteries?: number;
  n_vehicles?: number;
};

export type MetricsResponse = MetricsPayload & {
  source: MetricsSource;
  plotExists?: boolean;
  error?: string;
  detail?: string;
};

export type FlowPhase = "empty" | "upload" | "running" | "results";

export function deriveFlowPhase(s: {
  running: boolean;
  runCompleted: boolean;
  hasAnyFile: boolean;
  canRunUpload: boolean;
}): FlowPhase {
  if (s.running) return "running";
  if (s.runCompleted) return "results";
  if (s.hasAnyFile || s.canRunUpload) return "upload";
  return "empty";
}

/** An em dash, not a zero: a metric with no basis must not read as a measurement. */
export const NO_VALUE = "—";

export function formatPct(n: number | null | undefined, digits = 1): string {
  return n == null || Number.isNaN(n) ? NO_VALUE : `${n.toFixed(digits)}%`;
}

export function formatScore(n: number | null | undefined, digits = 1): string {
  return n == null || Number.isNaN(n) ? NO_VALUE : n.toFixed(digits);
}

export function delta(proposed: number, baseline: number): number {
  return proposed - baseline;
}

export function servedLabel(m: PolicyMetrics): string {
  return `${m.successfully_served} / ${m.total_vehicles}`;
}

export const EMPTY_METRICS: MetricsResponse = {
  source: "empty",
  classification: null,
  comparison: null,
  batteries_file: null,
  vehicles_file: null,
};
