"use client";

import { useMemo, useState } from "react";

import {
  AssignmentDetailSheet,
  type DetailSelection,
} from "@/components/dashboard/assignment-detail-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ResultsScreen } from "@/components/dashboard/results-nav";
import type { DrillFilter, MetricsResponse } from "@/lib/metrics";

type AppHeaderProps = {
  source: string;
  unsafe: number | null;
  running: boolean;
  canRunUpload: boolean;
  locked: boolean;
  nBatteries?: number | null;
  nVehicles?: number | null;
  metrics?: MetricsResponse | null;
  onRunUpload: () => void;
  onNavigate?: (screen: ResultsScreen, filter?: DrillFilter) => void;
  progress: number;
};

export function AppHeader({
  source,
  unsafe,
  running,
  canRunUpload,
  locked,
  nBatteries,
  nVehicles,
  metrics,
  onRunUpload,
  onNavigate,
  progress,
}: AppHeaderProps) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<DetailSelection | null>(null);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !metrics || locked) return [] as DetailSelection[];
    const out: DetailSelection[] = [];
    for (const b of metrics.fleet ?? []) {
      if (b.battery_id.toLowerCase().includes(q)) {
        out.push({ kind: "fleet", battery: b });
      }
      if (out.length >= 8) break;
    }
    if (out.length < 8) {
      for (const r of metrics.assignments?.Proposed ?? []) {
        if (r.vehicle_id.toLowerCase().includes(q)) {
          out.push({ kind: "assignment", row: r });
        }
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [query, metrics, locked]);

  return (
    <header className="border-b border-border/80 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Siemens Energy · ASME Brain Bolt 2026
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            BSS Dispatch
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {locked
                ? "Upload fleet CSVs · unlock results after a run"
                : "Every figure below is recomputed from this run"}
            </span>
            <Badge variant="secondary">{locked ? "No run" : source}</Badge>
            {locked || unsafe == null ? (
              <Badge variant="outline">Unsafe: —</Badge>
            ) : (
              <button
                type="button"
                className="inline-flex"
                onClick={() =>
                  onNavigate?.("compare", { divergencesOnly: true })
                }
                disabled={!onNavigate}
              >
                <Badge
                  variant={unsafe === 0 ? "default" : "destructive"}
                  className={
                    onNavigate
                      ? "cursor-pointer hover:opacity-90"
                      : undefined
                  }
                >
                  Unsafe: {unsafe}
                </Badge>
              </button>
            )}
            {!locked && nBatteries != null && nVehicles != null ? (
              <Badge variant="outline">
                {nBatteries} packs · {nVehicles} requests
              </Badge>
            ) : null}
          </div>

          {!locked && metrics ? (
            <div className="relative w-full max-w-md pt-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search BAT-… or REQ-…"
            className="h-9 w-full border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--uber-accent)]"
                aria-label="Search packs and vehicles"
              />
              {query.trim() && hits.length > 0 ? (
                <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto border border-border bg-background shadow-sm">
                  {hits.map((hit) => {
                    const key =
                      hit.kind === "fleet"
                        ? hit.battery.battery_id
                        : hit.row.vehicle_id;
                    const label =
                      hit.kind === "fleet"
                        ? `${hit.battery.battery_id} · ${hit.battery.status}`
                        : `${hit.row.vehicle_id} · ${hit.row.priority}`;
                    return (
                      <li key={`${hit.kind}-${key}`}>
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/50"
                          onClick={() => {
                            setSelection(hit);
                            setQuery("");
                          }}
                        >
                          {label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-64">
          {/* Before a run the CTA is the one accent action on screen. After
              results exist the primary action lives in the zones, so re-running
              steps down to a secondary control rather than shouting over the
              data it would replace. */}
          <Button
            data-motion="run-cta"
            variant={locked ? "default" : "outline"}
            onClick={onRunUpload}
            disabled={running || !canRunUpload}
            className="w-full transition-transform duration-200 active:scale-[0.99]"
            style={{ opacity: canRunUpload ? 1 : 0.45 }}
          >
            {running
              ? "Running…"
              : locked
                ? "Run on uploads"
                : "Re-run on uploads"}
          </Button>
          {running ? (
            <Progress value={Math.max(12, progress)} className="h-1.5" />
          ) : null}
        </div>
      </div>

      <AssignmentDetailSheet
        selection={selection}
        open={selection != null}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
        onNavigate={onNavigate}
      />
    </header>
  );
}
