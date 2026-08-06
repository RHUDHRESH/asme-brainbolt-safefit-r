"use client";

/**
 * Interactive visual diagnostics.
 *
 * One shared filter drives every view: click a histogram bin, a class chip, a
 * priority bar or a rack shelf and all the other charts narrow to that subset.
 * Axes are user-selectable across the real parameters present in the payload,
 * and bin counts / axis ranges are derived from the data on every render, so
 * feeding a different fleet reshapes the charts rather than distorting them.
 */

import { useMemo, useState } from "react";

import { useSolverConfig } from "@/components/params/solver-config-context";
import { ClassificationExplainer } from "@/components/dashboard/explain-cards";
import { RackGrid } from "@/components/dashboard/rack-grid";
import { ZoneSection } from "@/components/dashboard/zone-section";
import { HealthBadge } from "@/components/params/param-primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  HEALTH_VAR,
  PRIORITY_ORDER,
  STATUS_ORDER,
  healthTone,
  priorityColor,
  reasonLabel,
} from "@/lib/design-tokens";
import { PARAMS, type ParamKey } from "@/lib/explain";
import type { AssignmentRow, ClassificationSummary, FleetBattery } from "@/lib/metrics";
import { cn } from "@/lib/utils";

/** Numeric fields a judge can put on an axis, resolved against the payload. */
const AXIS_FIELDS: { key: ParamKey | "BSS" | "cycle_count" | "age_years"; field: keyof FleetBattery; label: string; unit: string }[] = [
  { key: "SoC", field: "SoC", label: "State of charge", unit: "%" },
  { key: "SoH", field: "SoH", label: "State of health", unit: "%" },
  { key: "R_int", field: "R_int_mOhm", label: "Internal resistance", unit: "mΩ" },
  { key: "dV", field: "dV_cell_mV", label: "Cell imbalance", unit: "mV" },
  { key: "T", field: "T", label: "Temperature", unit: "°C" },
  { key: "BSS", field: "BSS", label: "Suitability score", unit: "pts" },
  { key: "cycle_count", field: "cycle_count", label: "Cycle count", unit: "cycles" },
  { key: "age_years", field: "age_years", label: "Age", unit: "yr" },
];

export type DiagFilter = {
  status?: string;
  reason?: string;
  priority?: string;
  /** Inclusive BSS bin, set by clicking the histogram. */
  scoreBin?: [number, number];
  allocatedOnly?: boolean;
};

function matches(b: FleetBattery, f: DiagFilter): boolean {
  if (f.status && b.status !== f.status) return false;
  if (f.reason && b.quarantine_reason !== f.reason) return false;
  if (f.priority && b.priority !== f.priority) return false;
  if (f.allocatedOnly && b.assigned_vehicle_id == null) return false;
  if (f.scoreBin) {
    const v = b.BSS;
    if (v == null || v < f.scoreBin[0] || v >= f.scoreBin[1]) return false;
  }
  return true;
}

function describe(f: DiagFilter): string[] {
  const out: string[] = [];
  if (f.status) out.push(f.status);
  if (f.reason) out.push(reasonLabel(f.reason));
  if (f.priority) out.push(`${f.priority} priority`);
  if (f.allocatedOnly) out.push("allocated only");
  if (f.scoreBin) out.push(`BSS ${f.scoreBin[0].toFixed(0)}–${f.scoreBin[1].toFixed(0)}`);
  return out;
}

export function DiagnosticsWorkbench({
  fleet,
  proposed,
  hsf,
  classification,
  className,
}: {
  fleet: FleetBattery[];
  proposed: AssignmentRow[];
  hsf: AssignmentRow[];
  classification: ClassificationSummary | null;
  className?: string;
}) {
  const cfg = useSolverConfig();
  const [filter, setFilter] = useState<DiagFilter>({});
  const [inspect, setInspect] = useState<string | null>(null);

  const filtered = useMemo(() => fleet.filter((b) => matches(b, filter)), [fleet, filter]);
  const active = describe(filter);
  const inspected = fleet.find((b) => b.battery_id === inspect) ?? null;

  const toggle = <K extends keyof DiagFilter>(key: K, value: DiagFilter[K]) =>
    setFilter((f) => ({ ...f, [key]: f[key] === value ? undefined : value }));

  if (!cfg || fleet.length === 0) return null;

  return (
    <div className={cn("space-y-5", className)}>
      {/* ── Filter bar ─────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Filter
          </span>
          {STATUS_ORDER.map((s) => {
            const on = filter.status === s;
            const tone = HEALTH_VAR[healthTone(s)];
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggle("status", s)}
                aria-pressed={on}
                className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={{
                  color: on ? "#000" : tone,
                  background: on ? tone : `color-mix(in srgb, ${tone} 10%, transparent)`,
                  borderColor: `color-mix(in srgb, ${tone} 45%, transparent)`,
                }}
              >
                {s} · {fleet.filter((b) => b.status === s).length}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => toggle("allocatedOnly", true)}
            aria-pressed={Boolean(filter.allocatedOnly)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              filter.allocatedOnly
                ? "border-accent bg-accent text-white"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            Allocated only
          </button>

          <span className="ml-auto flex items-center gap-2">
            <span data-numeric className="text-[11px] text-muted-foreground">
              {filtered.length} / {fleet.length} packs
            </span>
            {active.length > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setFilter({})}>
                Clear
              </Button>
            ) : null}
          </span>

          {active.length > 0 ? (
            <p className="w-full text-[11px] text-muted-foreground">
              Showing: {active.join(" · ")}. Every chart below is scoped to this
              selection; the faded series is the unfiltered fleet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Charts ─────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <ScoreHistogram
          fleet={fleet}
          filtered={filtered}
          bin={filter.scoreBin}
          onPickBin={(b) =>
            setFilter((f) => ({
              ...f,
              scoreBin:
                f.scoreBin && f.scoreBin[0] === b[0] ? undefined : b,
            }))
          }
        />
        <PriorityServiceChart
          proposed={proposed}
          hsf={hsf}
          selected={filter.priority}
          onPick={(p) => toggle("priority", p)}
        />
        <ParameterScatter fleet={fleet} filtered={filtered} onInspect={setInspect} />
        {classification ? (
          <QuarantineReasons
            classification={classification}
            selected={filter.reason}
            onPick={(r) => toggle("reason", r)}
          />
        ) : null}
      </div>

      {/* ── Rack, scoped to the filter ─────────────────────── */}
      <ZoneSection
        title="Station rack"
        description="Physical shelf layout in dataset order. Hover to inspect, click to pin a pack and read why it was classified the way it was."
      >
        <RackGrid
          fleet={fleet}
          highlight={new Set(filtered.map((b) => b.battery_id))}
          dimUnhighlighted={active.length > 0}
          onSelect={(b) => setInspect(b.battery_id)}
        />
      </ZoneSection>

      {/* ── Pinned pack explanation ────────────────────────── */}
      {inspected ? (
        <ZoneSection
          title={`Why ${inspected.battery_id} is ${inspected.status}`}
          description="The exact rule evaluation the solver ran on this pack."
          actions={
            <Button type="button" size="sm" variant="outline" onClick={() => setInspect(null)}>
              Close
            </Button>
          }
        >
          <ClassificationExplainer pack={inspected} />
        </ZoneSection>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Score histogram — click a bin to cross-filter
   ══════════════════════════════════════════════════════════════ */

function ScoreHistogram({
  fleet,
  filtered,
  bin,
  onPickBin,
}: {
  fleet: FleetBattery[];
  filtered: FleetBattery[];
  bin?: [number, number];
  onPickBin: (bin: [number, number]) => void;
}) {
  const model = useMemo(() => {
    const scored = fleet.filter((b) => b.BSS != null);
    if (scored.length === 0) return null;
    const scores = scored.map((b) => b.BSS as number);
    const count = Math.min(24, Math.max(8, Math.ceil(Math.sqrt(scored.length))));
    const lo = Math.floor(Math.min(...scores) / 5) * 5;
    const hi = Math.ceil(Math.max(...scores) / 5) * 5;
    const width = (hi - lo) / count || 1;

    const bins = Array.from({ length: count }, (_, i) => ({
      from: lo + i * width,
      to: lo + (i + 1) * width,
      safe: 0,
      degraded: 0,
      unsafe: 0,
      total: 0,
      inFilter: 0,
    }));
    for (const b of scored) {
      const idx = Math.min(count - 1, Math.floor(((b.BSS as number) - lo) / width));
      const tone = healthTone(b.status);
      if (tone === "safe" || tone === "degraded" || tone === "unsafe") bins[idx][tone] += 1;
      bins[idx].total += 1;
    }
    const inSet = new Set(filtered.map((b) => b.battery_id));
    for (const b of scored) {
      if (!inSet.has(b.battery_id)) continue;
      const idx = Math.min(count - 1, Math.floor(((b.BSS as number) - lo) / width));
      bins[idx].inFilter += 1;
    }
    return { bins, max: Math.max(...bins.map((x) => x.total), 1), lo, hi, width };
  }, [fleet, filtered]);

  const [hover, setHover] = useState<number | null>(null);
  if (!model) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Suitability score distribution</CardTitle>
        <CardDescription>
          {fleet.length} packs, stacked by class. Bin width{" "}
          <span data-numeric>{model.width.toFixed(1)}</span> pts — click a bar to
          filter every chart to that band.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="relative flex h-48 items-end gap-[3px]">
          {model.bins.map((b, i) => {
            const selected = bin != null && Math.abs(bin[0] - b.from) < 1e-6;
            const dimmed = bin != null && !selected;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onPickBin([b.from, b.to])}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                aria-label={`${b.from.toFixed(0)} to ${b.to.toFixed(0)} BSS, ${b.total} packs`}
                className="group relative flex h-full flex-1 flex-col justify-end transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                style={{ opacity: dimmed ? 0.3 : 1 }}
              >
                {(["unsafe", "degraded", "safe"] as const).map((k) =>
                  b[k] > 0 ? (
                    <span
                      key={k}
                      className="w-full transition-all duration-500"
                      style={{
                        height: `${(b[k] / model.max) * 100}%`,
                        background: HEALTH_VAR[k],
                        opacity: 0.92,
                      }}
                    />
                  ) : null
                )}
                {selected ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-1 h-0.5"
                    style={{ background: "var(--foreground)" }}
                  />
                ) : null}
              </button>
            );
          })}

          {hover != null ? (
            <div
              className="pointer-events-none absolute -top-1 z-10 rounded-md border border-border bg-popover px-2 py-1.5 text-[10px] shadow-lg"
              style={{
                left: `${(hover / model.bins.length) * 100}%`,
                transform: "translateX(-50%)",
              }}
            >
              <p data-numeric className="font-semibold">
                {model.bins[hover].from.toFixed(0)}–{model.bins[hover].to.toFixed(0)} BSS
              </p>
              {(["safe", "degraded", "unsafe"] as const).map((k) =>
                model.bins[hover][k] > 0 ? (
                  <p key={k} className="flex items-center gap-1">
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: HEALTH_VAR[k] }}
                    />
                    <span data-numeric>{model.bins[hover][k]}</span>
                  </p>
                ) : null
              )}
            </div>
          ) : null}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span data-numeric>{model.lo} BSS</span>
          <span>lower suitability ← → higher</span>
          <span data-numeric>{model.hi} BSS</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Service by priority — click a tier to cross-filter
   ══════════════════════════════════════════════════════════════ */

function PriorityServiceChart({
  proposed,
  hsf,
  selected,
  onPick,
}: {
  proposed: AssignmentRow[];
  hsf: AssignmentRow[];
  selected?: string;
  onPick: (priority: string) => void;
}) {
  const data = useMemo(() => {
    const summarise = (rows: AssignmentRow[]) => {
      const acc: Record<string, { served: number; unsafe: number; total: number }> = {};
      for (const r of rows) {
        const key = r.priority || "—";
        acc[key] ??= { served: 0, unsafe: 0, total: 0 };
        acc[key].total += 1;
        if (r.served) acc[key].served += 1;
        if (r.served && healthTone(r.status) === "unsafe") acc[key].unsafe += 1;
      }
      return acc;
    };
    const p = summarise(proposed);
    const h = summarise(hsf);
    return PRIORITY_ORDER.filter((k) => p[k] || h[k]).map((k) => ({
      priority: k as string,
      proposed: p[k] ?? { served: 0, unsafe: 0, total: 0 },
      hsf: h[k] ?? { served: 0, unsafe: 0, total: 0 },
    }));
  }, [hsf, proposed]);

  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Service by priority tier</CardTitle>
        <CardDescription>
          Bar length is requests served; the crimson cap is how many of those
          received a quarantined pack. Click a tier to filter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((d) => {
          const on = selected === d.priority;
          const dim = selected != null && !on;
          return (
            <button
              key={d.priority}
              type="button"
              onClick={() => onPick(d.priority)}
              aria-pressed={on}
              className={cn(
                "w-full space-y-1.5 rounded-md px-2 py-1.5 text-left transition-colors",
                on ? "bg-secondary" : "hover:bg-secondary/50"
              )}
              style={{ opacity: dim ? 0.42 : 1 }}
            >
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium" style={{ color: priorityColor(d.priority) }}>
                  {d.priority}
                </span>
                <span data-numeric className="text-muted-foreground">
                  {d.proposed.total} requests
                </span>
              </div>
              {(
                [
                  { label: "Proposed", v: d.proposed, solid: true },
                  { label: "HSF", v: d.hsf, solid: false },
                ] as const
              ).map((row) => {
                const pctServed = row.v.total ? (row.v.served / row.v.total) * 100 : 0;
                const pctUnsafe = row.v.total ? (row.v.unsafe / row.v.total) * 100 : 0;
                return (
                  <span key={row.label} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[10px] text-muted-foreground">
                      {row.label}
                    </span>
                    <span className="relative h-4 flex-1 overflow-hidden rounded-sm bg-secondary ring-1 ring-inset ring-border">
                      <span
                        className="absolute inset-y-0 left-0 transition-[width] duration-700"
                        style={{
                          width: `${pctServed}%`,
                          background: row.solid
                            ? priorityColor(d.priority)
                            : `color-mix(in srgb, ${priorityColor(d.priority)} 36%, transparent)`,
                        }}
                      />
                      {pctUnsafe > 0 ? (
                        <span
                          className="absolute inset-y-0 right-0"
                          style={{ width: `${pctUnsafe}%`, background: HEALTH_VAR.unsafe }}
                          title={`${row.v.unsafe} unsafe allocation(s)`}
                        />
                      ) : null}
                    </span>
                    <span data-numeric className="w-12 shrink-0 text-right text-[11px]">
                      {row.v.served}/{row.v.total}
                    </span>
                    <span
                      data-numeric
                      className="w-9 shrink-0 text-right text-[11px] font-semibold"
                      style={{ color: HEALTH_VAR.unsafe }}
                    >
                      {row.v.unsafe > 0 ? `⚠${row.v.unsafe}` : ""}
                    </span>
                  </span>
                );
              })}
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Parameter scatter — pick any two real fields
   ══════════════════════════════════════════════════════════════ */

function ParameterScatter({
  fleet,
  filtered,
  onInspect,
}: {
  fleet: FleetBattery[];
  filtered: FleetBattery[];
  onInspect: (id: string) => void;
}) {
  // Only offer axes the payload actually populates.
  const available = useMemo(
    () => AXIS_FIELDS.filter((f) => fleet.some((b) => b[f.field] != null)),
    [fleet]
  );
  const [xKey, setXKey] = useState("R_int");
  const [yKey, setYKey] = useState("SoC");
  const [hover, setHover] = useState<FleetBattery | null>(null);

  const xf = available.find((f) => f.key === xKey) ?? available[0];
  const yf = available.find((f) => f.key === yKey) ?? available[1] ?? available[0];

  const W = 360;
  const H = 250;
  const pad = { l: 40, r: 10, t: 10, b: 32 };

  const model = useMemo(() => {
    if (!xf || !yf) return null;
    const pts = fleet.filter((b) => b[xf.field] != null && b[yf.field] != null);
    if (pts.length === 0) return null;
    const xs = pts.map((b) => Number(b[xf.field]));
    const ys = pts.map((b) => Number(b[yf.field]));
    const pad10 = (lo: number, hi: number) => {
      const span = hi - lo || 1;
      return [lo - span * 0.05, hi + span * 0.05] as const;
    };
    const [x0, x1] = pad10(Math.min(...xs), Math.max(...xs));
    const [y0, y1] = pad10(Math.min(...ys), Math.max(...ys));
    return { pts, x0, x1, y0, y1 };
  }, [fleet, xf, yf]);

  if (!model || !xf || !yf) return null;

  const inSet = new Set(filtered.map((b) => b.battery_id));
  const px = (v: number) => pad.l + ((v - model.x0) / (model.x1 - model.x0)) * (W - pad.l - pad.r);
  const py = (v: number) => H - pad.b - ((v - model.y0) / (model.y1 - model.y0)) * (H - pad.t - pad.b);

  const xInfo = xf.key in PARAMS ? PARAMS[xf.key as ParamKey] : null;

  return (
    <Card>
      <CardHeader className="gap-2 pb-2">
        <CardTitle className="text-base">Parameter explorer</CardTitle>
        <CardDescription>
          Any two measured fields against each other. Ringed dots are packs the
          proposed method allocated; hover for the pack, click to pin it.
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">X</span>
            <select
              value={xf.key}
              onChange={(e) => setXKey(e.target.value)}
              className="rounded-md border border-border bg-secondary px-1.5 py-0.5"
            >
              {available.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Y</span>
            <select
              value={yf.key}
              onChange={(e) => setYKey(e.target.value)}
              className="rounded-md border border-border bg-secondary px-1.5 py-0.5"
            >
              {available.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${yf.label} against ${xf.label}`}>
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1={pad.l}
                x2={W - pad.r}
                y1={pad.t + f * (H - pad.t - pad.b)}
                y2={pad.t + f * (H - pad.t - pad.b)}
                stroke="var(--border)"
                strokeWidth={1}
              />
            ))}
            {model.pts.map((b) => {
              const tone = healthTone(b.status);
              const allocated = b.assigned_vehicle_id != null;
              const on = inSet.has(b.battery_id);
              return (
                <circle
                  key={b.battery_id}
                  cx={px(Number(b[xf.field]))}
                  cy={py(Number(b[yf.field]))}
                  r={allocated ? 4 : 2.8}
                  fill={HEALTH_VAR[tone]}
                  fillOpacity={on ? (allocated ? 0.95 : 0.55) : 0.1}
                  stroke={allocated && on ? "var(--foreground)" : "none"}
                  strokeWidth={0.7}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover(b)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onInspect(b.battery_id)}
                />
              );
            })}
            <text x={pad.l} y={H - 6} fontSize="9" fill="var(--muted-foreground)">
              {model.x0.toFixed(0)}
            </text>
            <text x={W - pad.r} y={H - 6} fontSize="9" fill="var(--muted-foreground)" textAnchor="end">
              {xf.label} ({xf.unit}) →
            </text>
            <text x={4} y={pad.t + 8} fontSize="9" fill="var(--muted-foreground)">
              {model.y1.toFixed(0)}
            </text>
            <text x={4} y={H - pad.b} fontSize="9" fill="var(--muted-foreground)">
              {model.y0.toFixed(0)}
            </text>
          </svg>

          {hover ? (
            <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-border bg-popover px-2 py-1.5 text-[10px] shadow-lg">
              <p data-numeric className="font-semibold">{hover.battery_id}</p>
              <HealthBadge status={hover.status} size="sm" showGlyph={false} />
              <p data-numeric className="mt-1">
                {xf.label} {Number(hover[xf.field]).toFixed(1)} {xf.unit}
              </p>
              <p data-numeric>
                {yf.label} {Number(hover[yf.field]).toFixed(1)} {yf.unit}
              </p>
              {hover.assigned_vehicle_id ? (
                <p className="mt-0.5 text-muted-foreground">
                  → {hover.assigned_vehicle_id}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {xInfo ? (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{xInfo.symbol}. </span>
            {xInfo.why}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Quarantine reasons — click a slice to cross-filter
   ══════════════════════════════════════════════════════════════ */

function QuarantineReasons({
  classification,
  selected,
  onPick,
}: {
  classification: ClassificationSummary;
  selected?: string;
  onPick: (reason: string) => void;
}) {
  const entries = Object.entries(classification.quarantine_reasons).sort(
    (a, b) => b[1] - a[1]
  );
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return null;

  const palette = [
    "var(--health-unsafe)",
    "var(--health-degraded)",
    "var(--prio-critical)",
    "var(--accent)",
    "var(--prio-medium)",
    "var(--prio-low)",
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Why packs were blocked</CardTitle>
        <CardDescription>
          The first rule that fired for each quarantined pack, in the
          solver&apos;s precedence order. Click a reason to filter the rack and
          scatter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {entries.map(([code, n], i) => {
          const on = selected === code;
          const dim = selected != null && !on;
          const pct = (n / total) * 100;
          return (
            <button
              key={code}
              type="button"
              onClick={() => onPick(code)}
              aria-pressed={on}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left transition-colors",
                on ? "bg-secondary" : "hover:bg-secondary/50"
              )}
              style={{ opacity: dim ? 0.45 : 1 }}
            >
              <span className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: palette[i % palette.length] }}
                  />
                  <span className="truncate">{reasonLabel(code)}</span>
                </span>
                <span className="shrink-0">
                  <span data-numeric className="font-semibold">{n}</span>
                  <span data-numeric className="ml-1.5 text-muted-foreground">
                    {pct.toFixed(1)}%
                  </span>
                </span>
              </span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-secondary">
                <span
                  className="block h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${pct}%`, background: palette[i % palette.length] }}
                />
              </span>
            </button>
          );
        })}
        <p className="pt-1 text-[10px] text-muted-foreground">
          <span data-numeric className="font-semibold text-foreground">{total}</span>{" "}
          packs removed from the candidate pool before matching began.
        </p>
      </CardContent>
    </Card>
  );
}
