/**
 * Head-to-head analysis: the two packs the two policies chose for the SAME
 * request. This is the only pack-vs-pack comparison the problem actually poses.
 *
 * Everything here is derived from the run payload. The one physical model used
 * is P = I²R, with I taken from the solver's own per-priority peak-current
 * table — the same figure the Joule penalty uses — so the wattage shown is the
 * same quantity the optimiser was minimising, not a new invention.
 */

import type { AssignmentRow, FleetBattery, SolverConfig } from "@/lib/metrics";
import { healthTone } from "@/lib/design-tokens";

export type Duel = {
  vehicleId: string;
  priority: string;
  /** Request context straight from the demand CSV. */
  minSoC: number | null;
  rangeKm: number | null;
  loadCategory: string | null;
  vehicleType: string | null;
  proposed: AssignmentRow;
  hsf: AssignmentRow;
  /** Peak discharge current for this tier (A), from solver config. */
  peakI: number;
  /** I²R dissipation inside each pack at that peak, in watts. */
  wattsProposed: number;
  wattsHsf: number;
  deltaWatts: number;
  /** HSF handed over a pack the gate had blocked. */
  hsfUnsafe: boolean;
  /** HSF's pack was merely degraded, not blocked. */
  hsfDegraded: boolean;
  sohDelta: number;
  bssDelta: number;
  socDelta: number;
  /** Higher = worse HSF decision. Unsafe dominates, then heat. */
  severity: number;
  samePack: boolean;
};

function watts(peakI: number, mOhm: number | null | undefined): number {
  return peakI * peakI * ((mOhm ?? 0) / 1000);
}

export function buildDuels(
  proposed: AssignmentRow[],
  hsf: AssignmentRow[],
  cfg: SolverConfig
): Duel[] {
  const hsfBy = new Map(hsf.map((r) => [r.vehicle_id, r]));
  const out: Duel[] = [];

  for (const p of proposed) {
    const h = hsfBy.get(p.vehicle_id);
    if (!h || !p.served || !h.served) continue;

    const peakI = cfg.peak_current_a[p.priority] ?? 0;
    const wp = watts(peakI, p.R_int_mOhm);
    const wh = watts(peakI, h.R_int_mOhm);
    const hsfUnsafe = healthTone(h.status) === "unsafe";
    const hsfDegraded = healthTone(h.status) === "degraded";
    const samePack = p.battery_id === h.battery_id;

    out.push({
      vehicleId: p.vehicle_id,
      priority: p.priority,
      minSoC: p.min_SoC ?? null,
      rangeKm: p.range_km ?? null,
      loadCategory: p.load_category ?? null,
      vehicleType: p.vehicle_type ?? null,
      proposed: p,
      hsf: h,
      peakI,
      wattsProposed: wp,
      wattsHsf: wh,
      deltaWatts: wh - wp,
      hsfUnsafe,
      hsfDegraded,
      sohDelta: (p.SoH ?? 0) - (h.SoH ?? 0),
      bssDelta: (p.BSS ?? 0) - (h.BSS ?? 0),
      socDelta: (p.SoC ?? 0) - (h.SoC ?? 0),
      severity:
        (hsfUnsafe ? 10_000 : hsfDegraded ? 1_000 : 0) +
        Math.max(0, wh - wp),
      samePack,
    });
  }

  out.sort((a, b) => b.severity - a.severity);
  return out;
}

/* ── Fleet-level statistics ─────────────────────────────────── */

/** Pearson correlation over the pairs where both fields are present. */
export function correlation(
  fleet: FleetBattery[],
  a: keyof FleetBattery,
  b: keyof FleetBattery
): number | null {
  const pairs = fleet
    .map((p) => [p[a], p[b]] as const)
    .filter(
      (v): v is readonly [number, number] =>
        typeof v[0] === "number" && typeof v[1] === "number"
    );
  if (pairs.length < 3) return null;

  const n = pairs.length;
  const mx = pairs.reduce((s, v) => s + v[0], 0) / n;
  const my = pairs.reduce((s, v) => s + v[1], 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : num / den;
}

export type DuelSummary = {
  total: number;
  diverged: number;
  hsfUnsafe: number;
  hsfDegraded: number;
  totalExtraWatts: number;
  avgSohDelta: number;
  /** How informative charge is about health, across this fleet. */
  corrSocSoH: number | null;
  corrSocRint: number | null;
  corrSohRint: number | null;
};

export function summarise(
  duels: Duel[],
  fleet: FleetBattery[]
): DuelSummary {
  const diverged = duels.filter((d) => !d.samePack);
  return {
    total: duels.length,
    diverged: diverged.length,
    hsfUnsafe: duels.filter((d) => d.hsfUnsafe).length,
    hsfDegraded: duels.filter((d) => d.hsfDegraded).length,
    totalExtraWatts: duels.reduce((s, d) => s + Math.max(0, d.deltaWatts), 0),
    avgSohDelta: duels.length
      ? duels.reduce((s, d) => s + d.sohDelta, 0) / duels.length
      : 0,
    corrSocSoH: correlation(fleet, "SoC", "SoH"),
    corrSocRint: correlation(fleet, "SoC", "R_int_mOhm"),
    corrSohRint: correlation(fleet, "SoH", "R_int_mOhm"),
  };
}

/** Plain-language reading of a correlation's strength, as a noun phrase. */
export function corrStrength(r: number | null): string {
  if (r == null) return "not computable";
  const a = Math.abs(r);
  if (a < 0.2) return "no usable relationship";
  if (a < 0.4) return "a weak relationship";
  if (a < 0.6) return "a moderate relationship";
  if (a < 0.8) return "a strong relationship";
  return "a very strong relationship";
}

/** Adverbial form, for dropping mid-sentence ("tells you …"). */
export function corrPhrase(r: number | null): string {
  if (r == null) return "an unknown amount";
  const a = Math.abs(r);
  if (a < 0.2) return "essentially nothing";
  if (a < 0.4) return "very little";
  if (a < 0.6) return "something, but not much";
  if (a < 0.8) return "a good deal";
  return "almost everything";
}
