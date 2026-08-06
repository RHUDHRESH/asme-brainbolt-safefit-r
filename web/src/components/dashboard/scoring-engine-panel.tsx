"use client";

/**
 * Screen 3 — Battery Suitability Scoring engine.
 *
 * Renders the MAUT formula with the *live* weights the solver used, plots each
 * sub-score's normalisation curve from the solver's own anchors, and lets a
 * judge compare any two real packs from the uploaded fleet side by side.
 * Defaults to the highest- and lowest-scoring eligible packs in the dataset.
 */

import { useMemo } from "react";

import { useSolverConfig } from "@/components/params/solver-config-context";
import { ZoneSection } from "@/components/dashboard/zone-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FleetBattery } from "@/lib/metrics";
import { cn } from "@/lib/utils";

type SubScoreKey = "SoH" | "IR" | "Imb" | "T";

const SUB_META: Record<
  SubScoreKey,
  { symbol: string; title: string; unit: string; field: keyof FleetBattery; score: keyof FleetBattery }
> = {
  SoH: { symbol: "S_SoH", title: "State of health", unit: "%", field: "SoH", score: "S_SoH" },
  IR: { symbol: "S_IR", title: "Internal resistance", unit: "mΩ", field: "R_int_mOhm", score: "S_IR" },
  Imb: { symbol: "S_Imb", title: "Cell imbalance", unit: "mV", field: "dV_cell_mV", score: "S_Imb" },
  T: { symbol: "S_T", title: "Temperature", unit: "°C", field: "T", score: "S_T" },
};

const SUB_TONE: Record<SubScoreKey, string> = {
  SoH: "var(--health-safe)",
  IR: "var(--accent)",
  Imb: "var(--prio-critical)",
  T: "var(--health-degraded)",
};

export function ScoringEnginePanel({
  fleet,
  className,
}: {
  fleet: FleetBattery[];
  className?: string;
}) {
  const cfg = useSolverConfig();

  const scored = useMemo(
    () => fleet.filter((b) => b.BSS != null).sort((a, b) => (b.BSS ?? 0) - (a.BSS ?? 0)),
    [fleet]
  );

  if (!cfg || scored.length === 0) return null;

  const w = cfg.maut.weights;
  const a = cfg.maut.anchors;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Formula callout */}
      <ZoneSection
        title="Stage 3 — Battery Suitability Score"
        description="Multi-Attribute Utility Theory. Four health parameters, weights read live from the solver."
      >
        <div
          className="sweep-sheen relative overflow-hidden rounded-lg border bg-card p-5 sm:p-7"
          style={{ "--tone": "var(--accent)" } as React.CSSProperties}
        >
          <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-[0.35]" />
          <div className="relative flex flex-wrap items-center justify-center gap-x-2 gap-y-3 text-center">
            <span
              data-numeric
              className="text-xl font-semibold sm:text-2xl"
              style={{ color: "var(--accent)" }}
            >
              BSS<sub className="text-sm">j</sub>
            </span>
            <span className="text-xl text-muted-foreground sm:text-2xl">=</span>
            {(Object.keys(SUB_META) as SubScoreKey[]).map((key, i) => (
              <span key={key} className="flex items-center gap-2">
                {i > 0 ? (
                  <span className="text-xl text-muted-foreground sm:text-2xl">+</span>
                ) : null}
                <span
                  className="flex items-baseline gap-1 rounded-md px-2 py-1"
                  style={{
                    background: `color-mix(in srgb, ${SUB_TONE[key]} 14%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${SUB_TONE[key]} 40%, transparent)`,
                  }}
                >
                  <span
                    data-numeric
                    className="text-lg font-semibold sm:text-xl"
                    style={{ color: SUB_TONE[key] }}
                  >
                    {w[key].toFixed(2)}
                  </span>
                  <span className="text-sm text-muted-foreground">·</span>
                  <span
                    data-numeric
                    className="text-base sm:text-lg"
                    style={{ color: SUB_TONE[key] }}
                  >
                    {SUB_META[key].symbol}
                  </span>
                </span>
              </span>
            ))}
          </div>
          <p className="relative mt-4 text-center text-xs text-muted-foreground">
            Weights sum to{" "}
            <span data-numeric className="text-foreground">
              {(w.SoH + w.IR + w.Imb + w.T).toFixed(2)}
            </span>
            . A second engine (TOPSIS, weights{" "}
            <span data-numeric>
              {cfg.topsis_weights.SoC}/{cfg.topsis_weights.SoH}/{cfg.topsis_weights.R_int}/
              {cfg.topsis_weights.dV}
            </span>
            ) scores the same packs independently as a cross-check.
          </p>
        </div>
      </ZoneSection>

      {/* Normalisation curves */}
      <ZoneSection
        title="Sub-score normalisation"
        description="How each physical unit maps onto a 0–100 utility. Curves are drawn from the solver's anchors; dots are the real packs in this fleet."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <NormalisationCurve
            tone={SUB_TONE.SoH}
            title="S_SoH — identity"
            domain={[cfg.thresholds.SoH_degraded_min, 100]}
            unit="% SoH"
            fn={(x) => x}
            samples={scored.map((b) => b.SoH).filter((v): v is number => v != null)}
            note={`Direct pass-through above the ${cfg.thresholds.SoH_degraded_min}% floor.`}
          />
          <NormalisationCurve
            tone={SUB_TONE.IR}
            title="S_IR — inverted cost"
            domain={[a.IR_offset, a.IR_offset + a.IR_span]}
            unit="mΩ"
            fn={(x) => 100 * Math.max(0, 1 - (x - a.IR_offset) / a.IR_span)}
            samples={scored.map((b) => b.R_int_mOhm).filter((v): v is number => v != null)}
            note={`${a.IR_offset}→${a.IR_offset + a.IR_span} mΩ maps 100→0 pts.`}
          />
          <NormalisationCurve
            tone={SUB_TONE.Imb}
            title="S_Imb — inverted cost"
            domain={[a.dV_offset, a.dV_offset + a.dV_span]}
            unit="mV"
            fn={(x) => 100 * Math.max(0, 1 - (x - a.dV_offset) / a.dV_span)}
            samples={scored.map((b) => b.dV_cell_mV).filter((v): v is number => v != null)}
            note={`${a.dV_offset}→${a.dV_offset + a.dV_span} mV maps 100→0 pts.`}
          />
          <NormalisationCurve
            tone={SUB_TONE.T}
            title="S_T — penalty about ambient"
            domain={[a.T_ref - a.T_span, a.T_ref + a.T_span]}
            unit="°C"
            fn={(x) => 100 * Math.max(0, 1 - Math.abs(x - a.T_ref) / a.T_span)}
            samples={scored.map((b) => b.T).filter((v): v is number => v != null)}
            note={`Peaks at ${a.T_ref} °C, zero at ±${a.T_span} °C.`}
          />
        </div>
      </ZoneSection>

    </div>
  );
}

/** Utility curve with the fleet's actual values plotted along it. */
function NormalisationCurve({
  title,
  tone,
  domain,
  unit,
  fn,
  samples,
  note,
}: {
  title: string;
  tone: string;
  domain: [number, number];
  unit: string;
  fn: (x: number) => number;
  samples: number[];
  note: string;
}) {
  const W = 240;
  const H = 96;
  const [lo, hi] = domain;

  const path = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 60; i += 1) {
      const x = lo + ((hi - lo) * i) / 60;
      const y = fn(x);
      pts.push(`${(i / 60) * W},${H - (y / 100) * H}`);
    }
    return `M${pts.join(" L")}`;
  }, [fn, hi, lo]);

  const dots = useMemo(() => {
    // Thin to keep the SVG light while preserving the visible distribution.
    const step = Math.max(1, Math.floor(samples.length / 60));
    return samples
      .filter((_, i) => i % step === 0)
      .map((v) => {
        const cx = ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * W;
        const cy = H - (fn(v) / 100) * H;
        return { cx, cy };
      });
  }, [fn, hi, lo, samples]);

  return (
    <Card
      className="overflow-hidden"
      style={{ "--tone": tone } as React.CSSProperties}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm" style={{ color: tone }}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: H }}
          role="img"
          aria-label={`${title} normalisation curve`}
        >
          <defs>
            <linearGradient id={`fill-${title.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1={0}
              x2={W}
              y1={H * f}
              y2={H * f}
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}
          <path d={`${path} L${W},${H} L0,${H} Z`} fill={`url(#fill-${title.replace(/\W/g, "")})`} />
          <path
            d={path}
            fill="none"
            stroke={tone}
            strokeWidth={2}
            style={{ filter: `drop-shadow(0 0 4px color-mix(in srgb, ${tone} 60%, transparent))` }}
          />
          {/* The caption promises the real fleet plotted on the curve, so the
              dots have to read as dots. At r=2 / 0.5 alpha they dissolved into
              the line's glow and the claim looked unbacked. */}
          {dots.map((d, i) => (
            <circle
              key={i}
              cx={d.cx}
              cy={d.cy}
              r={2.6}
              fill={tone}
              opacity={0.85}
              stroke="var(--background)"
              strokeWidth={0.8}
            />
          ))}
        </svg>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span data-numeric>
            {lo} {unit}
          </span>
          <span data-numeric>
            {hi} {unit}
          </span>
        </div>
        <p className="text-[10px] leading-tight text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}
