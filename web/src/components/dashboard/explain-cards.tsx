"use client";

/**
 * Reusable explanation surfaces.
 *
 * Each card takes a real pack or assignment row and renders the reasoning the
 * solver actually applied, sourced from `@/lib/explain`. Nothing here holds a
 * threshold of its own.
 */

import { useMemo, useState } from "react";

import { useSolverConfig } from "@/components/params/solver-config-context";
import {
  HealthBadge,
  ImbalanceSparkline,
  IrCard,
  PriorityChip,
  SocPill,
  SohRadial,
  ThermoCard,
} from "@/components/params/param-primitives";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HEALTH_VAR } from "@/lib/design-tokens";
import {
  PARAMS,
  REJECT_COPY,
  buildTakenMap,
  explainAllocation,
  explainBss,
  explainClassification,
  type GateVerdict,
  type ParamKey,
} from "@/lib/explain";
import type { AssignmentRow, FleetBattery } from "@/lib/metrics";
import { cn } from "@/lib/utils";

const VERDICT_TONE: Record<GateVerdict, string> = {
  "in-band": "var(--health-safe)",
  "soft-breach": "var(--health-degraded)",
  "hard-breach": "var(--health-unsafe)",
  unknown: "var(--muted-foreground)",
};

const VERDICT_LABEL: Record<GateVerdict, string> = {
  "in-band": "IN BAND",
  "soft-breach": "SOFT BREACH",
  "hard-breach": "HARD BREACH",
  unknown: "NO DATA",
};

/* ══════════════════════════════════════════════════════════════
   Why this classification?
   ══════════════════════════════════════════════════════════════ */

export function ClassificationExplainer({
  pack,
  className,
}: {
  pack: FleetBattery;
  className?: string;
}) {
  const cfg = useSolverConfig();
  const ex = useMemo(
    () => (cfg ? explainClassification(pack, cfg) : null),
    [cfg, pack]
  );
  if (!cfg || !ex) return null;

  const tone = HEALTH_VAR[ex.tone];

  return (
    <Card
      className={cn("glass-panel border-0", className)}
      style={{ "--tone": tone } as React.CSSProperties}
    >
      <CardHeader className="relative gap-2 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span data-numeric className="text-sm font-semibold">
            {pack.battery_id}
          </span>
          <HealthBadge status={pack.status} size="sm" />
          {ex.integrityFailed ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: "color-mix(in srgb, var(--health-unsafe) 16%, transparent)",
                color: "var(--health-unsafe)",
              }}
            >
              INTEGRITY PRE-SCREEN
            </span>
          ) : null}
        </div>
        <CardDescription className="text-xs">
          <span className="font-medium text-foreground">Deciding rule: </span>
          {ex.deciding}
        </CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-3">
        {/* Per-parameter gate evaluation */}
        <ul className="space-y-1.5">
          {ex.gates.map((g) => {
            const info = PARAMS[g.param];
            const vt = VERDICT_TONE[g.verdict];
            return (
              <li
                key={g.param}
                className="grid grid-cols-[5rem_1fr_auto] items-baseline gap-2 rounded-sm px-2 py-1.5"
                style={{
                  background: `color-mix(in srgb, ${vt} 8%, transparent)`,
                  boxShadow: `inset 2px 0 0 ${vt}`,
                }}
              >
                <span data-numeric className="text-[11px] font-semibold">
                  {info.symbol}
                </span>
                <span className="min-w-0 text-[11px] text-muted-foreground">
                  <span data-numeric className="text-foreground">
                    {g.value == null ? "—" : g.value.toFixed(1)} {info.unit}
                  </span>
                  <span className="mx-1.5">·</span>
                  <span data-numeric>safe {g.safeRule}</span>
                  <span className="mx-1.5">·</span>
                  <span data-numeric>block {g.hardRule}</span>
                </span>
                <span
                  data-numeric
                  className="shrink-0 text-[9px] font-semibold tracking-wider"
                  style={{ color: vt }}
                >
                  {VERDICT_LABEL[g.verdict]}
                </span>
              </li>
            );
          })}
        </ul>

        <p
          className="rounded-sm px-3 py-2 text-xs leading-relaxed"
          style={{
            background: `color-mix(in srgb, ${tone} 10%, transparent)`,
          }}
        >
          {ex.narrative}
        </p>

        {/* The readings themselves */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SocPill value={pack.SoC} />
          <ThermoCard now={pack.T} peak24h={pack.T_24h_max} />
          <IrCard value={pack.R_int_mOhm} />
          <ImbalanceSparkline value={pack.dV_cell_mV} packId={pack.battery_id} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   How the suitability score was built
   ══════════════════════════════════════════════════════════════ */

export function BssExplainer({
  pack,
  showParamGlossary = true,
  className,
}: {
  pack: FleetBattery | AssignmentRow;
  showParamGlossary?: boolean;
  className?: string;
}) {
  const cfg = useSolverConfig();
  const [open, setOpen] = useState<ParamKey | null>(null);
  const ex = useMemo(() => (cfg ? explainBss(pack, cfg) : null), [cfg, pack]);
  if (!cfg || !ex) return null;

  const id = "battery_id" in pack ? pack.battery_id : null;

  return (
    <Card className={className}>
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-base">
            Suitability score{id ? ` · ${id}` : ""}
          </CardTitle>
          <span className="flex items-baseline gap-1.5">
            <span
              data-numeric
              className="text-3xl font-semibold leading-none"
              style={{ color: "var(--accent)" }}
            >
              {ex.total.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">/ 100</span>
          </span>
        </div>
        <CardDescription data-numeric className="text-[11px]">
          {ex.formula}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stacked contribution bar */}
        <div className="space-y-1">
          <div className="flex h-4 w-full overflow-hidden rounded-full ring-1 ring-inset ring-border">
            {ex.parts.map((p) => (
              <div
                key={p.param}
                className="transition-[width] duration-700"
                style={{ width: `${p.contribution}%`, background: PARAMS[p.param].tone }}
                title={`${PARAMS[p.param].symbol}: +${p.contribution.toFixed(1)}`}
              />
            ))}
            <div
              className="flex-1"
              style={{ background: "var(--secondary)" }}
              title={`${(100 - ex.total).toFixed(1)} pts not earned`}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Filled segments are earned points; the grey tail is{" "}
            <span data-numeric>{(100 - ex.total).toFixed(1)}</span> pts lost to
            degradation.
          </p>
        </div>

        {/* Per-term working */}
        <ul className="space-y-2">
          {ex.parts.map((p) => {
            const info = PARAMS[p.param];
            const isOpen = open === p.param;
            return (
              <li key={p.param}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : p.param)}
                  aria-expanded={isOpen}
                  className="w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ background: info.tone }}
                      />
                      <span data-numeric className="text-xs font-semibold">
                        {info.symbol}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {info.name}
                      </span>
                    </span>
                    <span className="flex items-baseline gap-2 text-[11px]">
                      <span data-numeric className="text-muted-foreground">
                        {p.sub.toFixed(1)} × {p.weight}
                      </span>
                      <span
                        data-numeric
                        className="text-sm font-semibold"
                        style={{ color: info.tone }}
                      >
                        +{p.contribution.toFixed(1)}
                      </span>
                    </span>
                  </div>

                  {/* Sub-score meter */}
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full transition-[width] duration-700"
                      style={{ width: `${p.sub}%`, background: info.tone }}
                    />
                  </div>

                  {isOpen ? (
                    <div className="flash-in mt-2 space-y-1.5 border-t border-border pt-2">
                      <p data-numeric className="text-[10px] text-muted-foreground">
                        {p.formula}
                      </p>
                      <p data-numeric className="text-[11px]">
                        {p.working}
                      </p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">
                          What it is.{" "}
                        </span>
                        {info.what}
                      </p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Why it is weighted {p.weight}.{" "}
                        </span>
                        {info.why}
                      </p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Failure mode.{" "}
                        </span>
                        {info.failure}
                      </p>
                    </div>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {ex.biggestLoss && ex.biggestLoss.headroom > 0.5 ? (
          <p className="rounded-sm bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed">
            <span className="font-medium">Where the points went. </span>
            This pack loses the most on{" "}
            <span style={{ color: PARAMS[ex.biggestLoss.param].tone }}>
              {PARAMS[ex.biggestLoss.param].phrase}
            </span>{" "}
            — <span data-numeric>{ex.biggestLoss.headroom.toFixed(1)}</span>{" "}
            weighted points are unavailable there. Fixing that one parameter
            would move the score more than any other.
          </p>
        ) : null}

        {showParamGlossary ? (
          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium">
              What do the four parameters mean?
            </summary>
            <dl className="mt-2 space-y-2.5">
              {ex.parts.map((p) => {
                const info = PARAMS[p.param];
                return (
                  <div key={p.param}>
                    <dt
                      data-numeric
                      className="text-[11px] font-semibold"
                      style={{ color: info.tone }}
                    >
                      {info.symbol} — {info.name} ({info.unit})
                    </dt>
                    <dd className="text-[11px] leading-relaxed text-muted-foreground">
                      {info.what} {info.why}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Why this pack was allotted — or refused
   ══════════════════════════════════════════════════════════════ */

export function AllocationExplainer({
  row,
  fleet,
  allRows,
  className,
}: {
  row: AssignmentRow;
  fleet: FleetBattery[];
  allRows: AssignmentRow[];
  className?: string;
}) {
  const cfg = useSolverConfig();
  const taken = useMemo(() => buildTakenMap(allRows), [allRows]);
  const ex = useMemo(
    () => (cfg ? explainAllocation(row, fleet, cfg, taken) : null),
    [cfg, fleet, row, taken]
  );
  if (!cfg || !ex) return null;

  const tone = ex.served ? "var(--health-safe)" : "var(--health-unsafe)";
  // Packs consumed by other requests stay on the shortlist: they are what make
  // the global optimum differ from this request's personal best, and the
  // narrative refers to them by rank.
  const top = ex.candidates
    .filter((c) => c.reject === null || c.reject === "taken" || c.chosen)
    .sort((a, b) => (b.utility ?? -Infinity) - (a.utility ?? -Infinity))
    .slice(0, 6);

  return (
    <Card
      className={cn("glass-panel border-0", className)}
      style={{ "--tone": tone } as React.CSSProperties}
    >
      <CardHeader className="relative gap-2 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span data-numeric className="text-sm font-semibold">
            {row.vehicle_id}
          </span>
          <PriorityChip
            priority={row.priority}
            weight={row.priority_weight ?? cfg.priority_weights[row.priority]}
            size="sm"
          />
          {row.vehicle_type ? (
            <span className="text-[11px] text-muted-foreground">
              {row.vehicle_type}
              {row.load_category ? ` · ${row.load_category}` : ""}
              {row.range_km != null ? ` · ${row.range_km} km` : ""}
            </span>
          ) : null}
        </div>
        <CardTitle className="text-sm" style={{ color: tone }}>
          {ex.verdict}
        </CardTitle>
      </CardHeader>

      <CardContent className="relative space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {ex.narrative}
        </p>

        {/* Constraint funnel — how the pool narrowed */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            How the pool narrowed
          </p>
          <FunnelRow
            label={`${fleet.length} packs in the station`}
            n={fleet.length}
            total={fleet.length}
            tone="var(--muted-foreground)"
          />
          {(
            [
              "quarantined",
              "soc-below-min",
              "degraded-high-priority",
              "taken",
            ] as const
          ).map((k) =>
            ex.rejectTally[k] ? (
              <FunnelRow
                key={k}
                label={`− ${ex.rejectTally[k]} · ${REJECT_COPY[k]}`}
                n={ex.rejectTally[k]}
                total={fleet.length}
                tone="var(--health-unsafe)"
                negative
              />
            ) : null
          )}
          <FunnelRow
            label={`${ex.feasibleCount} feasible for this request`}
            n={ex.feasibleCount}
            total={fleet.length}
            tone={tone}
          />
        </div>

        {/* Ranked shortlist */}
        {top.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Top candidates by utility
            </p>
            <ul className="space-y-1">
              {top.map((c, i) => (
                <li
                  key={c.pack.battery_id}
                  className={cn(
                    "grid grid-cols-[1.25rem_5.5rem_1fr_auto] items-baseline gap-2 rounded-sm px-2 py-1.5 text-[11px]",
                    c.chosen && "ring-1 ring-inset"
                  )}
                  style={{
                    background: c.chosen
                      ? `color-mix(in srgb, ${tone} 12%, transparent)`
                      : "var(--secondary)",
                    ...(c.chosen ? { boxShadow: `inset 0 0 0 1px ${tone}` } : {}),
                  }}
                >
                  <span data-numeric className="text-muted-foreground">
                    {i + 1}
                  </span>
                  <span data-numeric className="font-medium">
                    {c.pack.battery_id}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    BSS <span data-numeric>{c.pack.BSS?.toFixed(1)}</span> · SoC{" "}
                    <span data-numeric>{c.pack.SoC?.toFixed(0)}%</span> · I²R{" "}
                    <span data-numeric>{c.jouleP.toFixed(0)} W</span>
                    {c.reject === "taken" ? " · taken elsewhere" : ""}
                  </span>
                  <span
                    data-numeric
                    className="shrink-0 font-semibold"
                    style={{ color: c.chosen ? tone : "var(--muted-foreground)" }}
                  >
                    {c.utility?.toFixed(1) ?? "—"}
                    {c.chosen ? " ✓" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FunnelRow({
  label,
  n,
  total,
  tone,
  negative = false,
}: {
  label: string;
  n: number;
  total: number;
  tone: string;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-3 w-24 shrink-0 overflow-hidden rounded-sm bg-secondary">
        <div
          className="h-full transition-[width] duration-700"
          style={{
            width: `${total ? (n / total) * 100 : 0}%`,
            background: tone,
            opacity: negative ? 0.6 : 1,
          }}
        />
      </div>
      <span className="min-w-0 truncate text-[11px] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

/** Compact SoH radial + score, for embedding beside an explainer. */
export function PackGlance({ pack }: { pack: FleetBattery }) {
  return (
    <div className="flex items-center gap-3">
      <SohRadial value={pack.SoH} size={64} />
      <div className="min-w-0 flex-1 space-y-1">
        <span data-numeric className="text-xs font-semibold">
          {pack.battery_id}
        </span>
        <HealthBadge status={pack.status} size="sm" />
      </div>
    </div>
  );
}
