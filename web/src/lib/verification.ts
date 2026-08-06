/**
 * The problem statement's five verification rules, recomputed from submitted
 * assignment rows.
 *
 * Kept as a pure function, separate from the component that renders it, for
 * one reason: a compliance check that cannot be pointed at bad data and shown
 * to fail is decoration. This can be — see `verification.test.ts`, which runs
 * it against the HSF baseline and expects rule 1 to go red on 12 violations.
 */

import type { AssignmentRow, PolicyMetrics } from "@/lib/metrics";

export type RuleCheck = {
  id: number;
  label: string;
  pass: boolean;
  evidence: string;
};

export type RunMeta = {
  source?: string | null;
  batteriesFile?: string | null;
  vehiclesFile?: string | null;
  hasConfig?: boolean;
};

function distinct<T>(values: T[]): number {
  return new Set(values).size;
}

export function verifyAssignments(
  rows: AssignmentRow[],
  meta: RunMeta = {}
): RuleCheck[] {
  const served = rows.filter((r) => r.served && r.battery_id);

  // Substring match, as everywhere else in the app: the solver emits the full
  // "Unsafe / Quarantine" label and only that class contains the word.
  const unsafe = served.filter((r) => (r.status ?? "").includes("Quarantine"));

  const packIds = served.map((r) => r.battery_id as string);
  const vehicleIds = rows.map((r) => r.vehicle_id);

  const margins = served
    .filter((r) => r.SoC != null && r.min_SoC != null)
    .map((r) => (r.SoC as number) - (r.min_SoC as number));
  const socBreaches = margins.filter((m) => m < 0).length;
  const minMargin = margins.length ? Math.min(...margins) : null;

  const reproducible =
    meta.source === "upload" &&
    Boolean(meta.batteriesFile) &&
    Boolean(meta.vehiclesFile) &&
    Boolean(meta.hasConfig);

  return [
    {
      id: 1,
      label: "No quarantined pack allocated",
      pass: unsafe.length === 0,
      evidence: `${unsafe.length} unsafe in ${served.length} allocations`,
    },
    {
      id: 2,
      label: "No battery used twice",
      pass: distinct(packIds) === packIds.length,
      evidence: `${distinct(packIds)} distinct packs across ${packIds.length} allocations`,
    },
    {
      id: 3,
      label: "No vehicle receives two batteries",
      pass: distinct(vehicleIds) === vehicleIds.length,
      evidence: `${distinct(vehicleIds)} distinct requests in ${vehicleIds.length} rows`,
    },
    {
      id: 4,
      label: "Every pack meets the request's minimum SoC",
      pass: socBreaches === 0 && margins.length > 0,
      evidence:
        margins.length === 0
          ? "no SoC data on rows"
          : `${socBreaches} breaches · tightest margin ${
              minMargin! >= 0 ? "+" : ""
            }${minMargin!.toFixed(1)} pp`,
    },
    {
      id: 5,
      label: "Reproducible from the submitted datasets",
      pass: reproducible,
      evidence: reproducible
        ? `${meta.batteriesFile} · ${meta.vehiclesFile}`
        : "run from uploaded CSVs to satisfy this",
    },
  ];
}

/**
 * The six *required* quantitative outputs, counted by actually being present
 * and finite rather than assumed. The seventh (average waiting time) is
 * optional in the statement and only claimable with an explicit queue model,
 * so it is deliberately not counted here.
 */
export function countRequiredOutputs(p?: PolicyMetrics | null): {
  present: number;
  total: number;
} {
  const required = p
    ? [
        p.successfully_served,
        p.unserved,
        p.high_critical_served_pct,
        p.unsafe_allocations,
        p.avg_soh_allocated,
        p.avg_bss_allocated,
      ]
    : [];
  return {
    present: required.filter((v) => v != null && Number.isFinite(v)).length,
    total: 6,
  };
}
