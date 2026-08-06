"use client";

/**
 * Screen 2 — multi-physical safety gating & 3-tier classification.
 *
 * Flow banner (raw stream → integrity check → gating), then one glass tier card
 * per class. Counts, percentages and every printed bound come from the run:
 * the bounds are read off the solver config, so the card text can never drift
 * from the rule that produced the counts.
 */

import { useMemo } from "react";

import { useSolverConfig } from "@/components/params/solver-config-context";
import { ZoneSection } from "@/components/dashboard/zone-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  HEALTH_GLYPH,
  HEALTH_VAR,
  STATUS_ORDER,
  healthTone,
  reasonLabel,
  type HealthTone,
} from "@/lib/design-tokens";
import type { ClassificationSummary, FleetBattery, SolverConfig } from "@/lib/metrics";
import { cn } from "@/lib/utils";

type Bound = { label: string; text: string };

function boundsFor(tone: HealthTone, c: SolverConfig): Bound[] {
  const t = c.thresholds;
  if (tone === "safe") {
    return [
      { label: "T", text: `${t.T_safe_min} … ${t.T_safe_max} °C` },
      { label: "SoH", text: `≥ ${t.SoH_safe_min} %` },
      { label: "R_int", text: `< ${t.R_int_safe_max} mΩ` },
      { label: "ΔV_cell", text: `< ${t.dV_safe_max} mV` },
    ];
  }
  if (tone === "degraded") {
    return [
      { label: "T", text: `${t.T_safe_max} < T ≤ ${t.T_degraded_max} °C` },
      { label: "SoH", text: `${t.SoH_degraded_min} … ${t.SoH_safe_min} %` },
      { label: "R_int", text: `${t.R_int_safe_max} … ${t.R_int_degraded_max} mΩ` },
      { label: "ΔV_cell", text: `${t.dV_safe_max} … ${t.dV_degraded_max} mV` },
    ];
  }
  return [
    { label: "T", text: `> ${t.T_degraded_max} °C or < ${t.T_cold_min} °C` },
    { label: "SoH", text: `< ${t.SoH_degraded_min} %` },
    { label: "R_int", text: `> ${t.R_int_degraded_max} mΩ` },
    { label: "ΔV_cell", text: `> ${t.dV_degraded_max} mV` },
    { label: "Integrity", text: "T₂₄ₕ,max < T_now" },
  ];
}

const ACTION: Record<HealthTone, string> = {
  safe: "Direct unconstrained dispatch",
  degraded: "Restricted — blocked from Critical / High requests",
  unsafe: "Hard-blocked (x_ij = 0) · routed to cooling rack",
  unknown: "—",
};

export function GatingPanel({
  classification,
  fleet,
  className,
}: {
  classification: ClassificationSummary | null;
  fleet: FleetBattery[];
  className?: string;
}) {
  const cfg = useSolverConfig();

  const integrityCount = useMemo(
    () => fleet.filter((b) => b.integrity_quarantine).length,
    [fleet]
  );

  if (!cfg || !classification) return null;

  const total = classification.total;

  return (
    <div className={cn("space-y-6", className)}>
      <ZoneSection
        title="Stage 1–2 — safety gating"
        description="Every pack passes a cross-field integrity check before any health rule runs, then lands in exactly one of three classes."
      >
        {/* Flow banner */}
        <div className="relative overflow-hidden rounded-lg border bg-card p-4">
          <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-30" />
          <ol className="relative flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <FlowStep
              index={1}
              title={`Raw ${total} pack snapshot stream`}
              detail={`${cfg.pack.series_cells}S · ${cfg.pack.capacity_ah} Ah · ${cfg.pack.nominal_v} V LFP`}
              tone="var(--muted-foreground)"
            />
            <FlowArrow />
            <FlowStep
              index={2}
              title="Cross-field integrity check"
              detail={
                integrityCount > 0
                  ? `${integrityCount} pack${integrityCount === 1 ? "" : "s"} failed sensor consistency`
                  : "no sensor inconsistencies detected"
              }
              tone="var(--accent)"
            />
            <FlowArrow />
            <FlowStep
              index={3}
              title="3-tier gating"
              detail="four physical bounds, hard-blocking on any breach"
              tone="var(--health-safe)"
            />
          </ol>
        </div>

        {/* Tier cards */}
        <div className="grid gap-4 lg:grid-cols-3">
          {STATUS_ORDER.map((status, i) => {
            const tone = healthTone(status);
            const count = classification.counts[status] ?? 0;
            const pct = classification.pct[status] ?? 0;
            return (
              <TierCard
                key={status}
                status={status}
                tone={tone}
                count={count}
                pct={pct}
                total={total}
                bounds={boundsFor(tone, cfg)}
                delay={i * 90}
              />
            );
          })}
        </div>
      </ZoneSection>

      {/* Quarantine root cause */}
      {Object.keys(classification.quarantine_reasons).length > 0 ? (
        <ZoneSection
          title="Quarantine root cause"
          description="Which rule fired first for each blocked pack. The solver records one reason per pack, evaluated in precedence order."
        >
          <QuarantineBreakdown reasons={classification.quarantine_reasons} />
        </ZoneSection>
      ) : null}
    </div>
  );
}

function FlowStep({
  index,
  title,
  detail,
  tone,
}: {
  index: number;
  title: string;
  detail: string;
  tone: string;
}) {
  return (
    <li className="min-w-0 flex-1">
      <div className="flex items-start gap-2">
        <span
          data-numeric
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
          style={{
            color: tone,
            background: `color-mix(in srgb, ${tone} 15%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 45%, transparent)`,
          }}
        >
          {index}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold">{title}</p>
          <p className="text-[11px] text-muted-foreground">{detail}</p>
        </div>
      </div>
    </li>
  );
}

function FlowArrow() {
  return (
    <li aria-hidden className="hidden shrink-0 items-center px-1 sm:flex">
      <svg width="28" height="8" viewBox="0 0 28 8">
        <path
          d="M0 4 H22"
          stroke="var(--border)"
          strokeWidth="1.5"
          className="edge-flow"
        />
        <path d="M22 1 L27 4 L22 7 Z" fill="var(--border)" />
      </svg>
    </li>
  );
}

function TierCard({
  status,
  tone,
  count,
  pct,
  total,
  bounds,
  delay,
}: {
  status: string;
  tone: HealthTone;
  count: number;
  pct: number;
  total: number;
  bounds: Bound[];
  delay: number;
}) {
  return (
    <Card
      className={cn(
        "glass-panel rise-in relative overflow-hidden border-0",
        tone === "unsafe" && "hazard-stripes"
      )}
      style={
        {
          "--tone": HEALTH_VAR[tone],
          animationDelay: `${delay}ms`,
        } as React.CSSProperties
      }
    >
      <CardHeader className={cn("relative gap-2", tone === "unsafe" && "pt-5")}>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-full text-xs"
            style={{
              color: HEALTH_VAR[tone],
              background: `color-mix(in srgb, ${HEALTH_VAR[tone]} 18%, transparent)`,
            }}
          >
            {HEALTH_GLYPH[tone]}
          </span>
          <CardTitle className="text-sm" style={{ color: HEALTH_VAR[tone] }}>
            {status}
          </CardTitle>
        </div>
        <div className="flex items-baseline gap-2">
          <span
            data-numeric
            className="text-4xl font-semibold leading-none tabular-nums"
            style={{ color: HEALTH_VAR[tone] }}
          >
            {count}
          </span>
          <span data-numeric className="text-sm text-muted-foreground">
            / {total} · {pct.toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: HEALTH_VAR[tone],
              boxShadow: `0 0 10px -2px ${HEALTH_VAR[tone]}`,
              transition: "width 900ms cubic-bezier(0.2,0.8,0.2,1)",
            }}
          />
        </div>
      </CardHeader>

      <CardContent className="relative space-y-3">
        <dl className="space-y-1.5">
          {bounds.map((b) => (
            <div
              key={b.label}
              className="grid grid-cols-[4.5rem_1fr] items-baseline gap-2 text-[11px]"
            >
              <dt data-numeric className="text-muted-foreground">
                {b.label}
              </dt>
              <dd data-numeric className="tabular-nums">
                {b.text}
              </dd>
            </div>
          ))}
        </dl>
        <p
          className="rounded-sm px-2 py-1.5 text-[11px] font-medium"
          style={{
            background: `color-mix(in srgb, ${HEALTH_VAR[tone]} 12%, transparent)`,
            color: HEALTH_VAR[tone],
          }}
        >
          {ACTION[tone]}
        </p>
      </CardContent>
    </Card>
  );
}

function QuarantineBreakdown({ reasons }: { reasons: Record<string, number> }) {
  const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return null;

  // Donut geometry — arcs are laid out by a running sum computed up front so
  // nothing mutates while rendering.
  const size = 168;
  const r = 62;
  const stroke = 22;
  const circumference = 2 * Math.PI * r;

  const arcs = entries.reduce<
    { code: string; n: number; dash: number; offset: number }[]
  >((acc, [code, n]) => {
    const prev = acc[acc.length - 1];
    const offset = prev ? prev.offset + prev.dash : 0;
    acc.push({ code, n, dash: circumference * (n / total), offset });
    return acc;
  }, []);

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
      <CardContent className="flex flex-col items-center gap-6 pt-6 sm:flex-row sm:items-center">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Quarantine reasons">
            <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
              {arcs.map((arc, i) => (
                <circle
                  key={arc.code}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={palette[i % palette.length]}
                  strokeWidth={stroke}
                  strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
                  strokeDashoffset={-arc.offset}
                  style={{ transition: "stroke-dasharray 800ms ease-out" }}
                >
                  <title>{`${reasonLabel(arc.code)}: ${arc.n}`}</title>
                </circle>
              ))}
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              data-numeric
              className="text-2xl font-semibold"
              style={{ color: "var(--health-unsafe)" }}
            >
              {total}
            </span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              blocked
            </span>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-2">
          {entries.map(([code, n], i) => (
            <li key={code} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: palette[i % palette.length] }}
              />
              <span className="min-w-0 flex-1 truncate">{reasonLabel(code)}</span>
              <span data-numeric className="shrink-0 tabular-nums font-semibold">
                {n}
              </span>
              <span data-numeric className="w-12 shrink-0 text-right text-muted-foreground">
                {((n / total) * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
