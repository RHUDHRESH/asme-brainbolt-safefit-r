"use client";

/**
 * Screen 5 — the time factor.
 *
 * The demand set is a real morning: 50 requests arriving 08:00 → 13:43, and
 * arrival order is the one thing the fixed baseline is required to respect.
 * Two effects only exist along that axis, and neither shows up in any of the
 * seven mandatory metrics:
 *
 *   1. Premium burn-down — the packs able to serve the hardest mission are
 *      finite. Spend them early and the hard request arriving at noon has
 *      nothing left. This is a stock problem, and stock problems are invisible
 *      in a snapshot.
 *   2. Quality drift — a policy that always hands over its fullest pack hands
 *      over steadily worse ones as the day proceeds.
 *
 * Both series are drawn from `timeline` in the solver payload, which is built
 * from the same frames the metrics were computed from.
 *
 * Colour follows the app's established policy convention (Proposed = safe tone,
 * HSF = degraded tone). That pair sits at ΔE 8.9 under protanopia — above the
 * floor but close — so identity is carried by direct labels, a legend and
 * distinct line styles, never by hue alone.
 */

import { useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HEALTH_VAR, priorityColor } from "@/lib/design-tokens";
import type { TimelineBlock, TimelineStep } from "@/lib/metrics";
import { cn } from "@/lib/utils";

const PROPOSED_TONE = HEALTH_VAR.safe;
const HSF_TONE = HEALTH_VAR.degraded;

type PolicyKey = "Proposed" | "HSF";

const POLICY: Record<PolicyKey, { tone: string; dash?: string; label: string }> = {
  Proposed: { tone: PROPOSED_TONE, label: "SafeFit-R" },
  HSF: { tone: HSF_TONE, dash: "5 3", label: "Highest-SoC-First" },
};

export function DispatchTimeline({
  timeline,
  className,
}: {
  timeline: TimelineBlock | null | undefined;
  className?: string;
}) {
  const [cursor, setCursor] = useState<number | null>(null);

  const requestByStep = useMemo(() => {
    const m = new Map<number, TimelineBlock["requests"][number]>();
    for (const r of timeline?.requests ?? []) m.set(r.step, r);
    return m;
  }, [timeline]);

  if (!timeline || !timeline.series?.Proposed?.length) return null;

  const steps = timeline.series.Proposed.length;
  const tightBudget = timeline.requests.filter(
    (r) => r.wait_budget_min != null && r.wait_budget_min <= 5
  );

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="text-base">
          The time factor — what each policy spends as the day proceeds
        </CardTitle>
        <CardDescription>
          {steps} requests in arrival order
          {timeline.arrival_first && timeline.arrival_last
            ? `, ${clockOf(timeline.arrival_first)} → ${clockOf(timeline.arrival_last)}`
            : ""}
          . Stock is finite and order is not reversible — neither fact is
          visible in a snapshot metric.
        </CardDescription>
        <Legend />
      </CardHeader>

      <CardContent className="space-y-5">
        <StatRow timeline={timeline} tightBudget={tightBudget.length} />

        <Facet
          title="Premium packs left on the shelf"
          subtitle={`Packs able to serve the hardest mission (${timeline.premium_threshold_kWh.toFixed(2)} kWh). There are only ${timeline.premium_pack_count}.`}
        >
          <BurnDownChart
            timeline={timeline}
            cursor={cursor}
            onCursor={setCursor}
          />
        </Facet>

        <Facet
          title="Energy margin of each allocation"
          subtitle="Deliverable energy minus what the mission needs. Below the line the vehicle cannot finish the trip — and every one of those allocations still satisfies minimum SoC."
        >
          <MarginChart
            timeline={timeline}
            cursor={cursor}
            onCursor={setCursor}
          />
        </Facet>

        <Readout
          request={cursor != null ? requestByStep.get(cursor) : undefined}
          proposed={cursor != null ? timeline.series.Proposed[cursor] : undefined}
          hsf={cursor != null ? timeline.series.HSF[cursor] : undefined}
        />

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Average waiting time is reported as <strong>not modelled</strong>, not
          as zero. The datasets give arrival times and wait budgets but no swap
          service time and no bay count, so a wait figure would need two invented
          parameters. The wait budget is still load-bearing: it is the urgency
          term that decides which request is deferred when supply binds.
        </p>
      </CardContent>
    </Card>
  );
}

/* ── chrome ───────────────────────────────────────────── */

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
      {(Object.keys(POLICY) as PolicyKey[]).map((key) => (
        <span key={key} className="flex items-center gap-1.5">
          <svg width="20" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="20"
              y2="3"
              stroke={POLICY[key].tone}
              strokeWidth="2"
              strokeDasharray={POLICY[key].dash}
            />
          </svg>
          {POLICY[key].label}
        </span>
      ))}
    </div>
  );
}

function Facet({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="space-y-1.5">
      <figcaption className="space-y-0.5">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {subtitle}
        </p>
      </figcaption>
      <div className="overflow-x-auto">{children}</div>
    </figure>
  );
}

function StatRow({
  timeline,
  tightBudget,
}: {
  timeline: TimelineBlock;
  tightBudget: number;
}) {
  const corr = timeline.soc_decay_corr;
  const spent = (key: PolicyKey) => {
    const series = timeline.series[key];
    return timeline.premium_pack_count - series[series.length - 1].premium_remaining;
  };

  const tiles = [
    {
      label: "Charge handed out vs arrival order",
      value: fmtCorr(corr.HSF),
      hint: `SafeFit-R ${fmtCorr(corr.Proposed)}`,
      tone: HSF_TONE,
      note: "correlation — the baseline's quality decays through the morning",
    },
    {
      label: "Premium packs spent",
      value: `${spent("HSF")} of ${timeline.premium_pack_count}`,
      hint: `SafeFit-R ${spent("Proposed")} of ${timeline.premium_pack_count}`,
      tone: HSF_TONE,
      note: "the only packs that can serve the hardest mission",
    },
    {
      label: "Requests with a ≤5 min wait budget",
      value: String(tightBudget),
      hint: "all High or Critical",
      tone: priorityColor("High"),
      note: "these cannot wait for a pack to come off charge",
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-md border border-border px-3 py-2">
          <p className="text-[10px] uppercase leading-snug tracking-[0.12em] text-muted-foreground">
            {t.label}
          </p>
          <p
            data-numeric
            className="mt-1 text-xl font-semibold leading-none"
            style={{ color: t.tone }}
          >
            {t.value}
          </p>
          <p data-numeric className="mt-1 text-[11px] text-muted-foreground">
            {t.hint}
          </p>
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            {t.note}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ── charts ───────────────────────────────────────────── */

const W = 760;
const H = 138;
// Top padding leaves a clear band for the unit caption above the first tick.
const PAD = { top: 18, right: 12, bottom: 18, left: 38 };

function plotBox() {
  return {
    x0: PAD.left,
    x1: W - PAD.right,
    y0: PAD.top,
    y1: H - PAD.bottom,
  };
}

function BurnDownChart({
  timeline,
  cursor,
  onCursor,
}: {
  timeline: TimelineBlock;
  cursor: number | null;
  onCursor: (v: number | null) => void;
}) {
  const box = plotBox();
  const n = timeline.series.Proposed.length;
  const maxY = Math.max(1, timeline.premium_pack_count);

  const sx = (step: number) =>
    box.x0 + (step / Math.max(1, n - 1)) * (box.x1 - box.x0);
  const sy = (v: number) => box.y1 - (v / maxY) * (box.y1 - box.y0);

  /** Step-after path: stock changes at the moment a pack is taken. */
  const path = (series: TimelineStep[]) => {
    let d = `M${sx(0)} ${sy(series[0].premium_remaining)}`;
    for (let i = 1; i < series.length; i += 1) {
      d += ` L${sx(i)} ${sy(series[i - 1].premium_remaining)}`;
      d += ` L${sx(i)} ${sy(series[i].premium_remaining)}`;
    }
    return d;
  };

  return (
    <ChartFrame
      box={box}
      n={n}
      cursor={cursor}
      onCursor={onCursor}
      yTicks={rangeTicks(maxY)}
      sy={sy}
      sx={sx}
      yLabel="packs"
    >
      {(Object.keys(POLICY) as PolicyKey[]).map((key) => {
        const series = timeline.series[key];
        const last = series[series.length - 1];
        // A series that ends at the floor would push its label onto the axis
        // caption, so labels are clamped inside the plot band and nudged apart.
        const anchor = sy(last.premium_remaining);
        const offset = key === "HSF" ? 11 : -5;
        const labelY = Math.min(
          Math.max(anchor + offset, box.y0 + 9),
          box.y1 - 4
        );
        return (
          <g key={key}>
            <path
              d={path(series)}
              fill="none"
              stroke={POLICY[key].tone}
              strokeWidth={2}
              strokeDasharray={POLICY[key].dash}
            />
            {/* Direct label — identity must not rest on hue alone. */}
            <text
              x={box.x1 - 2}
              y={labelY}
              fontSize="9"
              textAnchor="end"
              fill={POLICY[key].tone}
            >
              {POLICY[key].label} · {last.premium_remaining} left
            </text>
          </g>
        );
      })}
    </ChartFrame>
  );
}

function MarginChart({
  timeline,
  cursor,
  onCursor,
}: {
  timeline: TimelineBlock;
  cursor: number | null;
  onCursor: (v: number | null) => void;
}) {
  const box = plotBox();
  const n = timeline.series.Proposed.length;

  const all = [...timeline.series.Proposed, ...timeline.series.HSF]
    .map((s) => s.energy_margin_kWh)
    .filter((v): v is number => v != null);
  const hi = Math.max(0.05, ...all);
  const lo = Math.min(-0.05, ...all);

  const sx = (step: number) =>
    box.x0 + (step / Math.max(1, n - 1)) * (box.x1 - box.x0);
  const sy = (v: number) => box.y1 - ((v - lo) / (hi - lo)) * (box.y1 - box.y0);
  const zeroY = sy(0);

  return (
    <ChartFrame
      box={box}
      n={n}
      cursor={cursor}
      onCursor={onCursor}
      yTicks={[lo, 0, hi]}
      sy={sy}
      sx={sx}
      yLabel="kWh"
      format={(v) => v.toFixed(2)}
    >
      {/* Zero is the decision boundary, so it is drawn as a rule, not a gridline. */}
      <line
        x1={box.x0}
        y1={zeroY}
        x2={box.x1}
        y2={zeroY}
        stroke={HEALTH_VAR.unsafe}
        strokeWidth={1}
        strokeDasharray="2 2"
        opacity={0.8}
      />
      <text x={box.x0 + 2} y={zeroY - 3} fontSize="8" fill={HEALTH_VAR.unsafe}>
        cannot finish the trip below here
      </text>

      {(Object.keys(POLICY) as PolicyKey[]).map((key) =>
        timeline.series[key].map((s) => {
          if (s.energy_margin_kWh == null) return null;
          const short = s.energy_margin_kWh < 0;
          return (
            <circle
              key={`${key}-${s.step}`}
              cx={sx(s.step)}
              cy={sy(s.energy_margin_kWh)}
              r={short ? 3.4 : 2.4}
              fill={short ? HEALTH_VAR.unsafe : POLICY[key].tone}
              fillOpacity={short ? 1 : 0.75}
              // A 2px surface ring keeps overlapping marks separable.
              stroke="var(--card)"
              strokeWidth={1}
            />
          );
        })
      )}
    </ChartFrame>
  );
}

/** Shared axes, gridlines and crosshair for the facets. */
function ChartFrame({
  box,
  n,
  cursor,
  onCursor,
  yTicks,
  sy,
  sx,
  yLabel,
  format = (v: number) => String(Math.round(v)),
  children,
}: {
  box: ReturnType<typeof plotBox>;
  n: number;
  cursor: number | null;
  onCursor: (v: number | null) => void;
  yTicks: number[];
  sy: (v: number) => number;
  sx: (step: number) => number;
  yLabel: string;
  format?: (v: number) => string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ minWidth: 520, height: H }}
      role="img"
      aria-label={`${yLabel} against arrival order`}
      onMouseLeave={() => onCursor(null)}
    >
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={box.x0}
            y1={sy(t)}
            x2={box.x1}
            y2={sy(t)}
            stroke="var(--border)"
            strokeWidth={0.6}
            opacity={0.55}
          />
          <text
            x={box.x0 - 5}
            y={sy(t) + 3}
            fontSize="8"
            textAnchor="end"
            fill="var(--muted-foreground)"
          >
            {format(t)}
          </text>
        </g>
      ))}

      {/* Unit caption sits above the plot band, clear of the topmost tick. */}
      <text x={2} y={8} fontSize="8" fill="var(--muted-foreground)">
        {yLabel}
      </text>
      <text
        x={box.x0}
        y={H - 4}
        fontSize="8"
        fill="var(--muted-foreground)"
      >
        first arrival
      </text>
      <text
        x={box.x1}
        y={H - 4}
        fontSize="8"
        textAnchor="end"
        fill="var(--muted-foreground)"
      >
        last arrival
      </text>

      {children}

      {cursor != null ? (
        <line
          x1={sx(cursor)}
          y1={box.y0}
          x2={sx(cursor)}
          y2={box.y1}
          stroke="var(--foreground)"
          strokeWidth={0.8}
          opacity={0.5}
        />
      ) : null}

      {/* One wide hit target per step — bigger than the marks it selects. */}
      {Array.from({ length: n }, (_, i) => (
        <rect
          key={i}
          x={sx(i) - (box.x1 - box.x0) / (2 * n)}
          y={box.y0}
          width={(box.x1 - box.x0) / n}
          height={box.y1 - box.y0}
          fill="transparent"
          onMouseEnter={() => onCursor(i)}
        />
      ))}
    </svg>
  );
}

/* ── readout ──────────────────────────────────────────── */

function Readout({
  request,
  proposed,
  hsf,
}: {
  request?: TimelineBlock["requests"][number];
  proposed?: TimelineStep;
  hsf?: TimelineStep;
}) {
  if (!request || !proposed || !hsf) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Hover the charts to compare what each policy handed the same request.
      </p>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 sm:grid-cols-3">
      <div>
        <p className="font-mono text-xs text-foreground">{request.vehicle_id}</p>
        <p className="text-[11px] text-muted-foreground">
          {clockOf(request.arrival_time)} · {request.priority}
          {request.wait_budget_min != null
            ? ` · ${request.wait_budget_min} min budget`
            : ""}
        </p>
        <p data-numeric className="text-[11px] text-muted-foreground">
          needs {request.E_required_kWh?.toFixed(2) ?? "—"} kWh
        </p>
      </div>
      {(
        [
          ["Proposed", proposed],
          ["HSF", hsf],
        ] as const
      ).map(([key, step]) => (
        <div key={key}>
          <p className="text-[10px] uppercase tracking-[0.12em]" style={{ color: POLICY[key].tone }}>
            {POLICY[key].label}
          </p>
          <p data-numeric className="font-mono text-xs text-foreground">
            {step.battery_id ?? "unserved"}
          </p>
          <p data-numeric className="text-[11px] text-muted-foreground">
            {step.energy_margin_kWh != null ? (
              <span
                style={{
                  color:
                    step.energy_margin_kWh < 0 ? HEALTH_VAR.unsafe : undefined,
                }}
              >
                {step.energy_margin_kWh >= 0 ? "+" : ""}
                {(step.energy_margin_kWh * 1000).toFixed(0)} Wh margin
              </span>
            ) : (
              "—"
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────── */

function rangeTicks(max: number): number[] {
  if (max <= 4) return Array.from({ length: max + 1 }, (_, i) => i);
  return [0, Math.round(max / 2), max];
}

function fmtCorr(v: number | null): string {
  return v == null ? "—" : `r = ${v.toFixed(2)}`;
}

function clockOf(iso: string | null): string {
  if (!iso) return "—";
  const m = /(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : iso;
}
