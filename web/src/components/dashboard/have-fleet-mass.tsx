"use client";

import type { ResultsScreen } from "@/components/dashboard/results-nav";
import type { ClassificationSummary, DrillFilter } from "@/lib/metrics";
import { reasonLabel } from "@/lib/safety-gates";
import { cn } from "@/lib/utils";

const TIERS: {
  key: string;
  label: string;
  tone: string;
  bar: string;
}[] = [
  {
    key: "Safe and Available",
    label: "Safe",
    tone: "text-[var(--positive)]",
    bar: "bg-[var(--positive)]",
  },
  {
    key: "Degraded but Usable",
    label: "Degraded",
    tone: "text-foreground",
    bar: "bg-[var(--warning)]",
  },
  {
    key: "Unsafe / Quarantine",
    label: "Quarantine",
    tone: "text-[var(--negative)]",
    bar: "bg-[var(--negative)]",
  },
];

type HaveFleetMassProps = {
  classification: ClassificationSummary | null;
  nBatteries?: number | null;
  onNavigate: (screen: ResultsScreen, filter?: DrillFilter) => void;
};

export function HaveFleetMass({
  classification,
  nBatteries,
  onNavigate,
}: HaveFleetMassProps) {
  const total =
    classification?.total ?? nBatteries ?? 0;
  const counts = classification?.counts ?? {};
  const reasons = classification?.quarantine_reasons ?? {};
  const reasonEntries = Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <section
      aria-label="What we have"
      className="space-y-4 border border-border p-4 sm:p-5"
      data-act="have"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            1 · Have
          </p>
          <h3 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            <span className="tabular-nums">{total}</span> packs
          </h3>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            These packs are what the station can legally hand out.
          </p>
        </div>
        <button
          type="button"
          className="text-sm font-medium text-[var(--uber-accent)] underline-offset-4 hover:underline"
          onClick={() => onNavigate("fleet")}
        >
          Open Fleet →
        </button>
      </div>

      <div className="space-y-3">
        {TIERS.map((tier) => {
          const count = counts[tier.key] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <button
              key={tier.key}
              type="button"
              onClick={() =>
                onNavigate("fleet", { status: tier.key })
              }
              className="group block w-full space-y-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className={cn("font-medium", tier.tone)}>
                  {tier.label}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {count}
                  <span className="ml-1 text-xs">
                    {/* Gating, Fleet and Story all print one decimal. Rounding
                        to whole percent here made Overview disagree with every
                        other zone on the same number (45% vs 44.5%). */}
                    ({pct.toFixed(1)}%)
                  </span>
                </span>
              </div>
              <div className="h-3 w-full bg-muted">
                <div
                  className={cn(
                    "h-full transition-[width] duration-200 group-hover:opacity-90",
                    tier.bar
                  )}
                  style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {reasonEntries.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {reasonEntries.map(([reason, n]) => (
            <button
              key={reason}
              type="button"
              title={`${reason} · ${reasonLabel(reason)} · ${n} packs`}
              onClick={() =>
                onNavigate("fleet", {
                  status: "Unsafe / Quarantine",
                  quarantineReason: reason,
                })
              }
              className="border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              {reason}: {n}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
