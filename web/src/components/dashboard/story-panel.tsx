"use client";

/**
 * Guided walkthrough.
 *
 * The beat structure and jump-to-zone navigation are unchanged; what is new is
 * that each beat now carries the live evidence for its claim — a real pack, a
 * real request, and the solver's own reasoning — instead of prose alone. Beats
 * 2, 3 and 4 answer the three questions judges actually ask: why this class,
 * how the score is built, and why this pack went to this rider.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";

import {
  AllocationExplainer,
  BssExplainer,
  ClassificationExplainer,
} from "@/components/dashboard/explain-cards";
import { useSolverConfig } from "@/components/params/solver-config-context";
import { HealthBadge, PriorityChip } from "@/components/params/param-primitives";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ResultsScreen } from "@/components/dashboard/results-nav";
import {
  HEALTH_VAR,
  STATUS_ORDER,
  healthTone,
  priorityColor,
} from "@/lib/design-tokens";
import type { AssignmentRow, FleetBattery, MetricsResponse } from "@/lib/metrics";
import { prefersReducedMotion } from "@/motion/use-dashboard-motion";
import { cn } from "@/lib/utils";

export const STORY_BEATS: {
  id: string;
  title: string;
  short: string;
  body: string;
  screen: ResultsScreen;
}[] = [
  {
    id: "have",
    title: "1 · HAVE — what the station owns",
    short: "Have",
    body: "Start with inventory. Every pack is sorted into exactly one of three classes before any request is considered. Quarantined packs are removed from the pool entirely — they cannot be matched under any priority.",
    screen: "gating",
  },
  {
    id: "classify",
    title: "2 · CLASSIFY — why this pack got this label",
    short: "Classify",
    body: "Four physical parameters, each with a safe band and a hard limit. Breach a hard limit and the pack is blocked outright; fall outside a safe band and it is usable but restricted. Pick any pack to see which rule decided its fate.",
    screen: "gating",
  },
  {
    id: "score",
    title: "3 · SCORE — how suitability is computed",
    short: "Score",
    body: "Surviving packs are ranked 0–100 by a weighted utility over the same four parameters. Expand any term to see the normalisation formula, the substitution for this pack, and what that parameter physically means.",
    screen: "scoring",
  },
  {
    id: "match",
    title: "4 · MATCH — why this rider got this pack",
    short: "Match",
    body: "Priority-weighted matching over the whole request set at once. Pick a request to see the pool narrow constraint by constraint, the ranked shortlist, and the utility arithmetic behind the winner.",
    screen: "match",
  },
  {
    id: "prove",
    title: "5 · PROVE — against the fixed baseline",
    short: "Prove",
    body: "The same fleet, the same requests, run through Highest-SoC-First. Every mandatory metric side by side, and per-request divergences where the baseline chose differently.",
    screen: "policy",
  },
];

type StoryPanelProps = {
  beat: number;
  onBeatChange: (beat: number) => void;
  onJump: (screen: ResultsScreen) => void;
  onExitOverview: () => void;
  metrics: MetricsResponse;
};

export function StoryPanel({
  beat,
  onBeatChange,
  onJump,
  onExitOverview,
  metrics,
}: StoryPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cfg = useSolverConfig();
  const current = STORY_BEATS[beat] ?? STORY_BEATS[0];

  const fleet = useMemo(() => metrics.fleet ?? [], [metrics.fleet]);
  const proposed = useMemo(
    () => metrics.assignments?.Proposed ?? [],
    [metrics.assignments]
  );

  useEffect(() => {
    if (!panelRef.current || prefersReducedMotion()) return;
    gsap.fromTo(
      panelRef.current,
      { opacity: 0.4, y: 8 },
      { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }
    );
  }, [beat]);

  return (
    <div data-screen="story" className="space-y-4">
      <Card className="shadow-none">
        <CardHeader className="gap-2">
          <CardTitle>Judge story</CardTitle>
          <CardDescription>
            Five beats, each backed by live evidence from this run. Every claim
            below is recomputed from the payload — pick a different pack or
            request and the reasoning follows it.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Beat rail */}
          <ol className="grid gap-1.5 sm:grid-cols-5">
            {STORY_BEATS.map((b, i) => {
              const active = i === beat;
              const done = i < beat;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onBeatChange(i)}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                      active
                        ? "border-accent bg-accent/15"
                        : done
                          ? "border-border bg-secondary/60"
                          : "border-border text-muted-foreground hover:bg-secondary/40"
                    )}
                  >
                    <span
                      data-numeric
                      className={cn(
                        "block text-[9px] tracking-[0.16em]",
                        active ? "text-accent" : "text-muted-foreground"
                      )}
                    >
                      BEAT {i + 1}
                    </span>
                    <span className="block text-xs font-semibold">{b.short}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* Narrative */}
          <div
            ref={panelRef}
            className="space-y-2 rounded-lg border border-border bg-secondary/30 p-4"
          >
            <h3 className="text-lg font-semibold tracking-tight">
              {current.title}
            </h3>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {current.body}
            </p>
          </div>

          {/* Live evidence for this beat */}
          {cfg ? (
            <div className="space-y-4">
              {current.id === "have" ? (
                <InventoryBeat fleet={fleet} metrics={metrics} onJump={onJump} />
              ) : null}
              {current.id === "classify" ? (
                <ClassifyBeat fleet={fleet} />
              ) : null}
              {current.id === "score" ? <ScoreBeat fleet={fleet} /> : null}
              {current.id === "match" ? (
                <MatchBeat fleet={fleet} proposed={proposed} />
              ) : null}
              {current.id === "prove" ? (
                <ProveBeat metrics={metrics} onJump={onJump} />
              ) : null}
            </div>
          ) : null}

          {/* Controls */}
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={beat === 0}
              onClick={() => onBeatChange(Math.max(0, beat - 1))}
            >
              Prev
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={beat >= STORY_BEATS.length - 1}
              onClick={() => onBeatChange(Math.min(STORY_BEATS.length - 1, beat + 1))}
            >
              Next beat
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onJump(current.screen)}
            >
              Open {current.screen} zone →
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="sm:ml-auto"
              onClick={onExitOverview}
            >
              Back to Overview
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Beat 1 · inventory ─────────────────────────────────────── */

function InventoryBeat({
  fleet,
  metrics,
  onJump,
}: {
  fleet: FleetBattery[];
  metrics: MetricsResponse;
  onJump: (screen: ResultsScreen) => void;
}) {
  const cls = metrics.classification;
  if (!cls) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {STATUS_ORDER.map((status) => {
        const tone = healthTone(status);
        const count = cls.counts[status] ?? 0;
        const pct = cls.pct[status] ?? 0;
        const sample = fleet.filter((b) => b.status === status).slice(0, 40);
        return (
          <button
            key={status}
            type="button"
            onClick={() => onJump("gating")}
            className="glass-panel rounded-lg border-0 p-3 text-left"
            style={{ "--tone": HEALTH_VAR[tone] } as React.CSSProperties}
          >
            <span className="relative flex items-baseline gap-2">
              <span
                data-numeric
                className="text-2xl font-semibold"
                style={{ color: HEALTH_VAR[tone] }}
              >
                {count}
              </span>
              <span data-numeric className="text-[11px] text-muted-foreground">
                {pct.toFixed(1)}%
              </span>
            </span>
            <span className="relative mt-0.5 block text-[11px] font-medium">
              {status}
            </span>
            <span className="relative mt-2 flex flex-wrap gap-[3px]">
              {sample.map((b) => (
                <span
                  key={b.battery_id}
                  className="size-1.5 rounded-[1px]"
                  style={{ background: HEALTH_VAR[tone], opacity: 0.75 }}
                />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Beat 2 · classification reasoning ──────────────────────── */

function ClassifyBeat({ fleet }: { fleet: FleetBattery[] }) {
  // Default to one representative pack per class so the contrast is visible.
  const exemplars = useMemo(() => {
    const pick = (tone: string) => fleet.find((b) => healthTone(b.status) === tone);
    return {
      safe: pick("safe"),
      degraded: pick("degraded"),
      unsafe: pick("unsafe"),
    };
  }, [fleet]);

  const [selected, setSelected] = useState<string | null>(null);
  const pack =
    fleet.find((b) => b.battery_id === selected) ??
    exemplars.unsafe ??
    exemplars.degraded ??
    exemplars.safe ??
    null;

  if (!pack) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Inspect a pack:</span>
        {(["unsafe", "degraded", "safe"] as const).map((k) => {
          const ex = exemplars[k];
          if (!ex) return null;
          return (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={pack.battery_id === ex.battery_id ? "default" : "outline"}
              onClick={() => setSelected(ex.battery_id)}
              style={
                pack.battery_id === ex.battery_id
                  ? {
                      background: HEALTH_VAR[k],
                      borderColor: HEALTH_VAR[k],
                      color: "#000",
                    }
                  : { borderColor: `color-mix(in srgb, ${HEALTH_VAR[k]} 45%, transparent)` }
              }
            >
              {ex.battery_id}
            </Button>
          );
        })}
        <select
          value={pack.battery_id}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Choose any pack"
          className="ml-auto rounded-md border border-border bg-secondary px-2 py-1 font-mono text-xs"
        >
          {fleet.map((b) => (
            <option key={b.battery_id} value={b.battery_id}>
              {b.battery_id} · {b.status}
            </option>
          ))}
        </select>
      </div>
      <ClassificationExplainer pack={pack} />
    </div>
  );
}

/* ── Beat 3 · score construction ────────────────────────────── */

function ScoreBeat({ fleet }: { fleet: FleetBattery[] }) {
  const scored = useMemo(
    () => fleet.filter((b) => b.BSS != null).sort((a, b) => (b.BSS ?? 0) - (a.BSS ?? 0)),
    [fleet]
  );
  const [selected, setSelected] = useState<string | null>(null);
  const best = scored[0];
  const worst = scored[scored.length - 1];
  const pack = scored.find((b) => b.battery_id === selected) ?? best ?? null;

  if (!pack) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Compare:</span>
        {[
          { label: `Best · ${best?.battery_id}`, id: best?.battery_id },
          { label: `Weakest · ${worst?.battery_id}`, id: worst?.battery_id },
        ].map((o) =>
          o.id ? (
            <Button
              key={o.id}
              type="button"
              size="sm"
              variant={pack.battery_id === o.id ? "default" : "outline"}
              onClick={() => setSelected(o.id!)}
            >
              {o.label}
            </Button>
          ) : null
        )}
        <select
          value={pack.battery_id}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Choose any scored pack"
          className="ml-auto rounded-md border border-border bg-secondary px-2 py-1 font-mono text-xs"
        >
          {scored.map((b) => (
            <option key={b.battery_id} value={b.battery_id}>
              {b.battery_id} · {b.BSS?.toFixed(1)}
            </option>
          ))}
        </select>
      </div>
      <BssExplainer pack={pack} />
    </div>
  );
}

/* ── Beat 4 · allocation reasoning ──────────────────────────── */

function MatchBeat({
  fleet,
  proposed,
}: {
  fleet: FleetBattery[];
  proposed: AssignmentRow[];
}) {
  const ordered = useMemo(() => {
    const rank: Record<string, number> = {
      Critical: 0,
      High: 1,
      Medium: 2,
      Low: 3,
    };
    return [...proposed].sort(
      (a, b) =>
        (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) ||
        (a.arrival_order ?? 0) - (b.arrival_order ?? 0)
    );
  }, [proposed]);

  const unserved = ordered.filter((r) => !r.served);
  const [selected, setSelected] = useState<string | null>(null);
  const row =
    ordered.find((r) => r.vehicle_id === selected) ??
    unserved[0] ??
    ordered[0] ??
    null;

  if (!row) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Inspect a request:</span>
        {ordered.slice(0, 4).map((r) => (
          <Button
            key={r.vehicle_id}
            type="button"
            size="sm"
            variant={row.vehicle_id === r.vehicle_id ? "default" : "outline"}
            onClick={() => setSelected(r.vehicle_id)}
            style={
              row.vehicle_id === r.vehicle_id
                ? {
                    background: priorityColor(r.priority),
                    borderColor: priorityColor(r.priority),
                    color: "#fff",
                  }
                : undefined
            }
          >
            {r.vehicle_id}
          </Button>
        ))}
        {unserved.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSelected(unserved[0].vehicle_id)}
            style={{ borderColor: "var(--health-unsafe)", color: "var(--health-unsafe)" }}
          >
            {unserved.length} unserved
          </Button>
        ) : null}
        <select
          value={row.vehicle_id}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Choose any request"
          className="ml-auto rounded-md border border-border bg-secondary px-2 py-1 font-mono text-xs"
        >
          {ordered.map((r) => (
            <option key={r.vehicle_id} value={r.vehicle_id}>
              {r.vehicle_id} · {r.priority} · {r.served ? r.battery_id : "unserved"}
            </option>
          ))}
        </select>
      </div>
      <AllocationExplainer row={row} fleet={fleet} allRows={proposed} />
    </div>
  );
}

/* ── Beat 5 · proof ─────────────────────────────────────────── */

function ProveBeat({
  metrics,
  onJump,
}: {
  metrics: MetricsResponse;
  onJump: (screen: ResultsScreen) => void;
}) {
  const c = metrics.comparison;
  if (!c) return null;
  const p = c.Proposed;
  const h = c.HSF;

  const headline = [
    {
      label: "Unsafe allocations",
      p: p.unsafe_allocations,
      h: h.unsafe_allocations,
      lowerBetter: true,
      fmt: (n: number) => String(Math.round(n)),
    },
    {
      label: "Avg SoH allocated",
      p: p.avg_soh_allocated,
      h: h.avg_soh_allocated,
      lowerBetter: false,
      fmt: (n: number) => `${n.toFixed(1)}%`,
    },
    {
      label: "Avg suitability",
      p: p.avg_bss_allocated,
      h: h.avg_bss_allocated,
      lowerBetter: false,
      fmt: (n: number) => n.toFixed(1),
    },
    {
      // The allocations that clear every stated constraint and still strand the
      // vehicle. No mandatory metric can see this one.
      label: "Stranded en route",
      p: p.energy_infeasible_allocations,
      h: h.energy_infeasible_allocations,
      lowerBetter: true,
      fmt: (n: number) => String(Math.round(n)),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {headline.map((m) => {
          const win = m.lowerBetter ? m.p < m.h : m.p > m.h;
          const tone = win ? "var(--health-safe)" : "var(--muted-foreground)";
          return (
            <div
              key={m.label}
              className="rounded-lg border p-3"
              style={{ borderColor: `color-mix(in srgb, ${tone} 38%, transparent)` }}
            >
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {m.label}
              </p>
              <p
                data-numeric
                className="mt-1 text-2xl font-semibold leading-none"
                style={{ color: tone }}
              >
                {m.fmt(m.p)}
              </p>
              <p data-numeric className="mt-1 text-[11px] text-muted-foreground">
                HSF {m.fmt(m.h)}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onJump("policy")}>
          Full scoreboard →
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onJump("compare")}>
          Per-request divergences →
        </Button>
      </div>
    </div>
  );
}

/** Legend chip set reused by the coach drawer. */
export function StoryLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_ORDER.map((s) => (
        <HealthBadge key={s} status={s} size="sm" />
      ))}
      {(["Critical", "High", "Medium", "Low"] as const).map((p) => (
        <PriorityChip key={p} priority={p} size="sm" />
      ))}
    </div>
  );
}
