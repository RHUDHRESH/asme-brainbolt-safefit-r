/**
 * Dark Industrial semantic tokens.
 *
 * Every colour here resolves to a CSS variable declared in globals.css, so the
 * light/dark values stay in one place. Nothing in this file encodes a
 * *threshold* — bands are derived at call sites from the solver config that the
 * Python pipeline emits, so the UI never drifts from the model.
 */

export type HealthTone = "safe" | "degraded" | "unsafe" | "unknown";
export type PriorityTone = "critical" | "high" | "medium" | "low" | "unknown";

export const HEALTH_VAR: Record<HealthTone, string> = {
  safe: "var(--health-safe)",
  degraded: "var(--health-degraded)",
  unsafe: "var(--health-unsafe)",
  unknown: "var(--muted-foreground)",
};

export const PRIORITY_VAR: Record<PriorityTone, string> = {
  critical: "var(--prio-critical)",
  high: "var(--prio-high)",
  medium: "var(--prio-medium)",
  low: "var(--prio-low)",
  unknown: "var(--muted-foreground)",
};

/** Glyphs from the badging system: check / caution / hazard lock. */
export const HEALTH_GLYPH: Record<HealthTone, string> = {
  safe: "✓",
  degraded: "▲",
  unsafe: "⬤",
  unknown: "–",
};

export const HEALTH_LABEL: Record<HealthTone, string> = {
  safe: "Safe & Available",
  degraded: "Degraded but Usable",
  unsafe: "Unsafe / Quarantine",
  unknown: "Unclassified",
};

/** Maps the solver's status strings onto a tone. */
export function healthTone(status?: string | null): HealthTone {
  if (!status) return "unknown";
  const s = status.toLowerCase();
  if (s.startsWith("safe")) return "safe";
  if (s.startsWith("degraded")) return "degraded";
  if (s.includes("unsafe") || s.includes("quarantine")) return "unsafe";
  return "unknown";
}

export function priorityTone(priority?: string | null): PriorityTone {
  if (!priority) return "unknown";
  const p = priority.toLowerCase();
  if (p === "critical") return "critical";
  if (p === "high") return "high";
  // Problem 1 ships "Normal"; the solver normalises it to Medium.
  if (p === "medium" || p === "normal") return "medium";
  if (p === "low") return "low";
  return "unknown";
}

export function healthColor(status?: string | null): string {
  return HEALTH_VAR[healthTone(status)];
}

export function priorityColor(priority?: string | null): string {
  return PRIORITY_VAR[priorityTone(priority)];
}

/** Priority tiers in dispatch order — used for legends and grouped charts. */
export const PRIORITY_ORDER = ["Critical", "High", "Medium", "Low"] as const;

export const STATUS_ORDER = [
  "Safe and Available",
  "Degraded but Usable",
  "Unsafe / Quarantine",
] as const;

/** Human labels for the solver's terse quarantine reason codes. */
export const REASON_LABEL: Record<string, string> = {
  T_high: "Over-temperature",
  T_cold: "Under-temperature",
  SoH_low: "State of health below floor",
  R_int_high: "Internal resistance over limit",
  dV_high: "Cell imbalance over limit",
  sensor_thermal: "Thermal sensor fault (T₂₄ₕ < T_now)",
  adc_voltage: "Pack/cell-sum voltage mismatch",
  energy_residual: "Energy bookkeeping residual",
  integrity: "Cross-field integrity failure",
};

export function reasonLabel(code?: string | null): string {
  if (!code) return "—";
  return REASON_LABEL[code] ?? code.replace(/_/g, " ");
}

/**
 * Three-band tone for a measured value against solver limits.
 * `invert` is for cost parameters (resistance, imbalance) where lower is better.
 */
export function bandTone(
  value: number | null | undefined,
  safeLimit: number,
  degradedLimit: number,
  invert = false
): HealthTone {
  if (value == null || Number.isNaN(value)) return "unknown";
  if (invert) {
    if (value < safeLimit) return "safe";
    if (value <= degradedLimit) return "degraded";
    return "unsafe";
  }
  if (value >= safeLimit) return "safe";
  if (value >= degradedLimit) return "degraded";
  return "unsafe";
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function pct(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp01((value - min) / (max - min));
}
