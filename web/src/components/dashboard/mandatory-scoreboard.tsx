"use client";

/**
 * Screen 5 — mandatory quantitative comparison.
 *
 * The seven outputs the problem statement requires, proposed against the fixed
 * Highest-SoC-First baseline on identical input. Row tone is computed from the
 * delta and each metric's own direction of goodness, so a regression would show
 * red without anyone having to remember to flip a flag.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HEALTH_VAR } from "@/lib/design-tokens";
import type { PolicyMetrics } from "@/lib/metrics";
import { cn } from "@/lib/utils";

type Row = {
  metric: string;
  /** true when a higher number is better */
  higherIsBetter: boolean;
  p: number;
  h: number;
  format: (n: number) => string;
  /**
   * Formatter for the Δ column. A gap between two percentages is measured in
   * percentage points, not percent, and a gap between two "x / 100" scores is
   * just a number — reusing `format` for both mislabels the unit.
   */
  deltaFormat?: (n: number) => string;
  /** Extra qualifier rendered next to the proposed value. */
  note?: string;
  hint?: string;
};

export function MandatoryScoreboard({
  proposed,
  hsf,
  className,
}: {
  proposed: PolicyMetrics;
  hsf: PolicyMetrics;
  className?: string;
}) {
  const int = (n: number) => String(Math.round(n));
  const pct1 = (n: number) => `${n.toFixed(1)}%`;
  const num1 = (n: number) => n.toFixed(1);
  const pp1 = (n: number) => `${n.toFixed(1)} pp`;

  const rows: Row[] = [
    {
      metric: "Successfully served vehicles",
      higherIsBetter: true,
      p: proposed.successfully_served,
      h: hsf.successfully_served,
      format: int,
      note: `/ ${proposed.total_vehicles}`,
    },
    {
      metric: "Unserved vehicles",
      higherIsBetter: false,
      p: proposed.unserved,
      h: hsf.unserved,
      format: int,
    },
    {
      metric: "High & Critical priority served",
      higherIsBetter: true,
      p: proposed.high_critical_served_pct,
      h: hsf.high_critical_served_pct,
      format: pct1,
      deltaFormat: pp1,
    },
    {
      metric: "Unsafe battery allocations",
      higherIsBetter: false,
      p: proposed.unsafe_allocations,
      h: hsf.unsafe_allocations,
      format: int,
      note: proposed.unsafe_allocations === 0 ? "STRICT" : undefined,
      hint: "Verification rule 1 — a quarantined pack must never be allocated.",
    },
    {
      metric: "Average SoH of allocated packs",
      higherIsBetter: true,
      p: proposed.avg_soh_allocated,
      h: hsf.avg_soh_allocated,
      format: pct1,
      deltaFormat: pp1,
    },
    {
      metric: "Average suitability score (BSS)",
      higherIsBetter: true,
      p: proposed.avg_bss_allocated,
      h: hsf.avg_bss_allocated,
      format: (n) => `${n.toFixed(1)} / 100`,
      deltaFormat: num1,
    },
    {
      metric: "Stranded en route",
      higherIsBetter: false,
      p: proposed.energy_infeasible_allocations,
      h: hsf.energy_infeasible_allocations,
      format: (n) => String(Math.round(n)),
      hint: "Beyond the mandatory set — allocations that satisfy minimum SoC and still cannot deliver the mission's energy.",
    },
  ];

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Mandatory quantitative outputs</CardTitle>
        <CardDescription>
          Same {proposed.total_vehicles} requests, same fleet, same run. Baseline
          is the fixed Highest-SoC-First policy.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-y border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Metric</th>
                <th className="px-4 py-2 text-right font-medium">Proposed</th>
                <th className="px-4 py-2 text-right font-medium">Baseline (HSF)</th>
                <th className="px-4 py-2 text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const diff = r.p - r.h;
                const better = r.higherIsBetter ? diff > 0 : diff < 0;
                const tie = Math.abs(diff) < 1e-9;
                const tone = tie
                  ? "var(--muted-foreground)"
                  : better
                    ? HEALTH_VAR.safe
                    : HEALTH_VAR.unsafe;
                // Baseline gets a warning tint whenever it loses the row.
                const baselineTone = tie
                  ? "var(--muted-foreground)"
                  : better
                    ? HEALTH_VAR.degraded
                    : HEALTH_VAR.safe;

                return (
                  <tr
                    key={r.metric}
                    className="rise-in border-b border-border/60 last:border-0 hover:bg-secondary/40"
                    style={{ animationDelay: `${i * 45}ms` }}
                  >
                    <td className="px-4 py-3 align-top">
                      <span className="font-medium">{r.metric}</span>
                      {r.hint ? (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {r.hint}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <span className="inline-flex items-baseline justify-end gap-1.5">
                        <span
                          aria-hidden
                          className="size-1.5 translate-y-[-2px] rounded-full"
                          style={{ background: tone }}
                        />
                        <span
                          data-numeric
                          className="text-base font-semibold tabular-nums"
                          style={{ color: tone }}
                        >
                          {r.format(r.p)}
                        </span>
                        {r.note ? (
                          <span className="text-[10px] text-muted-foreground">
                            {r.note}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <span
                        data-numeric
                        className="tabular-nums"
                        style={{ color: baselineTone }}
                      >
                        {r.format(r.h)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <span
                        data-numeric
                        className="text-xs font-semibold tabular-nums"
                        style={{ color: tone }}
                      >
                        {tie
                          ? "—"
                          : `${diff > 0 ? "+" : ""}${(r.deltaFormat ?? r.format)(diff)}`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          Every figure recomputes from the submitted assignment rows — see
          Assign for the row-level table and CSV export.
        </p>
      </CardContent>
    </Card>
  );
}
