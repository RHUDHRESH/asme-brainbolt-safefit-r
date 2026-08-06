"use client";

import { Button } from "@/components/ui/button";
import type { ResultsScreen } from "@/components/dashboard/results-nav";
import {
  delta,
  formatPct,
  formatScore,
  type DrillFilter,
  type PolicyMetrics,
} from "@/lib/metrics";

type DecideProveStripProps = {
  nBatteries?: number | null;
  nVehicles?: number | null;
  proposed?: PolicyMetrics | null;
  hsf?: PolicyMetrics | null;
  onNavigate: (screen: ResultsScreen, filter?: DrillFilter) => void;
};

export function DecideProveStrip({
  nBatteries,
  nVehicles,
  proposed,
  hsf,
  onNavigate,
}: DecideProveStripProps) {
  const packs = nBatteries ?? "—";
  const reqs = nVehicles ?? "—";
  const unsafeAvoided =
    proposed && hsf
      ? hsf.unsafe_allocations - proposed.unsafe_allocations
      : null;
  const sohDelta =
    proposed && hsf
      ? delta(proposed.avg_soh_allocated, hsf.avg_soh_allocated)
      : null;
  const servedDelta =
    proposed && hsf
      ? proposed.successfully_served - hsf.successfully_served
      : null;

  return (
    <section
      aria-label="Decide and prove"
      className="space-y-4"
      data-act="decide"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col justify-between gap-4 border border-border p-4 sm:p-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              3 · Decide
            </p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              <span className="tabular-nums">{packs}</span>
              <span className="mx-2 text-muted-foreground">→</span>
              <span className="tabular-nums">{reqs}</span>
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Match safe packs to priority demand — watch the theater.
            </p>
          </div>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => onNavigate("match")}
          >
            Watch matching
          </Button>
        </div>

        <div className="border border-border p-4 sm:p-5">
          <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            4 · Prove vs HSF
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Beat Highest-SoC-First without handing out unsafe packs.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              className="border border-border px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() =>
                onNavigate("compare", { divergencesOnly: true })
              }
            >
              <p className="text-xs text-muted-foreground">Unsafe avoided</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {unsafeAvoided == null ? "—" : unsafeAvoided}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {proposed && hsf
                  ? `HSF handed out ${hsf.unsafe_allocations}`
                  : "—"}
              </p>
            </button>
            <button
              type="button"
              className="border border-border px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onNavigate("policy")}
            >
              <p className="text-xs text-muted-foreground">SoH Δ</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {sohDelta == null
                  ? "—"
                  : `+${formatScore(sohDelta)}`}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  pp
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {proposed && hsf
                  ? `${formatPct(proposed.avg_soh_allocated)} vs ${formatPct(hsf.avg_soh_allocated)}`
                  : "—"}
              </p>
            </button>
            <button
              type="button"
              className="border border-border px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onNavigate("assign", { served: "served" })}
            >
              <p className="text-xs text-muted-foreground">Served Δ</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {servedDelta == null
                  ? "—"
                  : servedDelta >= 0
                    ? `+${servedDelta}`
                    : servedDelta}
              </p>
              {/* A bare "+0" reads as a missing number. It is in fact the
                  headline: both policies serve everyone, and the whole
                  argument is that they differ on safety, not on service. */}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {proposed && hsf
                  ? servedDelta === 0
                    ? `${proposed.successfully_served} vs ${hsf.successfully_served} — service parity`
                    : `${proposed.successfully_served} vs ${hsf.successfully_served}`
                  : "—"}
              </p>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
