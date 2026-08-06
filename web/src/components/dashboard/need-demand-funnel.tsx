"use client";

import { useMemo } from "react";

import type { ResultsScreen } from "@/components/dashboard/results-nav";
import type { AssignmentRow, DrillFilter } from "@/lib/metrics";
import { cn } from "@/lib/utils";

const PRIORITIES = [
  {
    key: "Critical",
    bar: "bg-[var(--negative)]",
    label: "Critical",
  },
  {
    key: "High",
    bar: "bg-[#c2410c]",
    label: "High",
  },
  {
    key: "Medium",
    bar: "bg-[var(--warning)]",
    label: "Medium",
  },
  {
    key: "Low",
    bar: "bg-[#545454]",
    label: "Low",
  },
] as const;

type NeedDemandFunnelProps = {
  assignments?: AssignmentRow[];
  nVehicles?: number | null;
  onNavigate: (screen: ResultsScreen, filter?: DrillFilter) => void;
};

export function NeedDemandFunnel({
  assignments = [],
  nVehicles,
  onNavigate,
}: NeedDemandFunnelProps) {
  const { total, counts } = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of assignments) {
      c[r.priority] = (c[r.priority] ?? 0) + 1;
    }
    const t =
      nVehicles ??
      assignments.length ??
      Object.values(c).reduce((a, b) => a + b, 0);
    return { total: t, counts: c };
  }, [assignments, nVehicles]);

  return (
    <section
      aria-label="What we need"
      className="space-y-4 border border-border p-4 sm:p-5"
      data-act="need"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            2 · Need
          </p>
          <h3 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            <span className="tabular-nums">{total}</span> requests
          </h3>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Vehicles arrive with urgency — Critical eats first.
          </p>
        </div>
        <button
          type="button"
          className="text-sm font-medium text-[var(--uber-accent)] underline-offset-4 hover:underline"
          onClick={() => onNavigate("assign", { served: "all" })}
        >
          Open Assign →
        </button>
      </div>

      <div className="flex h-10 w-full overflow-hidden border border-border">
        {PRIORITIES.map((p) => {
          const count = counts[p.key] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          if (count === 0) return null;
          return (
            <button
              key={p.key}
              type="button"
              title={`${p.label}: ${count}`}
              style={{ width: `${pct}%` }}
              className={cn(
                "min-w-[2rem] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                p.bar
              )}
              onClick={() =>
                onNavigate("assign", {
                  served: "all",
                  priority: p.key,
                })
              }
            />
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PRIORITIES.map((p) => {
          const count = counts[p.key] ?? 0;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() =>
                onNavigate("assign", {
                  served: "all",
                  priority: p.key,
                })
              }
              className="border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* The swatch makes these tiles the bar's legend. Without it the
                  stacked bar above encodes priority by colour alone and there
                  is nothing on screen that decodes it. */}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className={cn("inline-block h-2 w-2 shrink-0", p.bar)}
                />
                {p.label}
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {count}
                {total > 0 && count > 0 ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {((count / total) * 100).toFixed(0)}%
                  </span>
                ) : null}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
