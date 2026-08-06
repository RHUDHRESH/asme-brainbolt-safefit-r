"use client";

/**
 * Parameter visual language.
 *
 * One primitive per battery-health parameter, each carrying its own alert
 * behaviour. Gating limits come from the live solver config (never literals) so
 * the badge a judge sees always matches the rule the model applied. The only
 * literals here are SoC *display* bands, which have no solver equivalent —
 * SoC is a per-request feasibility check (SoC ≥ min_SoC), not a health gate.
 */

import { useMemo } from "react";

import { useThresholds } from "@/components/params/solver-config-context";
import {
  HEALTH_GLYPH,
  HEALTH_VAR,
  bandTone,
  clamp01,
  healthTone,
  priorityColor,
  priorityTone,
  type HealthTone,
} from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

/** Display-only SoC bands. Not a safety gate — see module note. */
const SOC_DISPLAY_BANDS = { good: 80, fair: 50 } as const;

function socTone(soc: number | null | undefined): HealthTone {
  if (soc == null || Number.isNaN(soc)) return "unknown";
  if (soc > SOC_DISPLAY_BANDS.good) return "safe";
  if (soc >= SOC_DISPLAY_BANDS.fair) return "degraded";
  return "unsafe";
}

function toneStyle(tone: HealthTone): React.CSSProperties {
  return { "--tone": HEALTH_VAR[tone] } as React.CSSProperties;
}

const SIZES = {
  sm: { label: "text-[10px]", value: "text-[11px]", bar: "h-2" },
  md: { label: "text-[11px]", value: "text-sm", bar: "h-2.5" },
} as const;

type Size = keyof typeof SIZES;

/* ── State of Charge ─────────────────────────────────────────────
   Horizontal pill bar with internal fill + digital percentage.
   An optional `min` marker shows the request's minimum acceptable SoC. */
export function SocPill({
  value,
  min,
  size = "md",
  showLabel = true,
  className,
}: {
  value: number | null | undefined;
  min?: number | null;
  size?: Size;
  showLabel?: boolean;
  className?: string;
}) {
  const tone = socTone(value);
  const s = SIZES[size];
  const fill = value == null ? 0 : clamp01(value / 100) * 100;
  const meets = value != null && min != null ? value >= min : null;

  return (
    <div className={cn("flex flex-col gap-1", className)} style={toneStyle(tone)}>
      {showLabel ? (
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("uppercase tracking-[0.14em] text-muted-foreground", s.label)}>
            SoC
          </span>
          <span
            data-numeric
            className={cn("font-semibold tabular-nums", s.value)}
            style={{ color: "var(--tone)" }}
          >
            {value == null ? "—" : `${value.toFixed(1)}%`}
          </span>
        </div>
      ) : null}
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-secondary ring-1 ring-inset ring-border",
          s.bar
        )}
        role="meter"
        aria-valuenow={value ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="State of charge"
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${fill}%`,
            background:
              "linear-gradient(90deg, color-mix(in srgb, var(--tone) 55%, transparent), var(--tone))",
            boxShadow: "0 0 10px -2px var(--tone)",
          }}
        />
        {min != null ? (
          <div
            className="absolute inset-y-0 w-px"
            style={{
              left: `${clamp01(min / 100) * 100}%`,
              background: meets ? "var(--foreground)" : "var(--health-unsafe)",
              opacity: 0.9,
            }}
            title={`Minimum acceptable SoC ${min.toFixed(0)}%`}
          />
        ) : null}
      </div>
      {min != null ? (
        <p className="text-[10px] text-muted-foreground">
          min {min.toFixed(0)}%{" "}
          <span style={{ color: meets ? "var(--health-safe)" : "var(--health-unsafe)" }}>
            {meets ? "met" : "not met"}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/* ── State of Health ─────────────────────────────────────────────
   Radial arc meter ringed in the tone of its gating band. */
export function SohRadial({
  value,
  size = 76,
  label = "SoH",
  sublabel,
  className,
}: {
  value: number | null | undefined;
  size?: number;
  label?: string;
  sublabel?: string;
  className?: string;
}) {
  const th = useThresholds();
  const tone: HealthTone = th
    ? bandTone(value, th.SoH_safe_min, th.SoH_degraded_min)
    : "unknown";

  const stroke = 7;
  const r = (size - stroke) / 2;
  // 270° sweep, opening at the bottom
  const circumference = 2 * Math.PI * r;
  const arcFraction = 0.75;
  const arcLen = circumference * arcFraction;
  const progress = value == null ? 0 : clamp01(value / 100);

  return (
    <div
      className={cn("flex flex-col items-center gap-1", className)}
      style={toneStyle(tone)}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="meter"
          aria-valuenow={value ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} ${value?.toFixed(1) ?? "unknown"} percent`}
          style={{ transform: "rotate(135deg)" }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--secondary)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLen} ${circumference}`}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--tone)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLen * progress} ${circumference}`}
            style={{
              transition: "stroke-dasharray 800ms cubic-bezier(0.2,0.8,0.2,1)",
              filter: "drop-shadow(0 0 5px color-mix(in srgb, var(--tone) 65%, transparent))",
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            data-numeric
            className="text-sm font-semibold tabular-nums"
            style={{ color: "var(--tone)" }}
          >
            {value == null ? "—" : value.toFixed(1)}
          </span>
          <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </span>
        </div>
      </div>
      {sublabel ? (
        <span className="text-[10px] text-muted-foreground">{sublabel}</span>
      ) : null}
    </div>
  );
}

/* ── Internal resistance ─────────────────────────────────────────
   Compact DCIR micro-card. Caution outline in the degraded band,
   pulsing hazard ring + I²R warning past the quarantine limit. */
export function IrCard({
  value,
  compact = false,
  className,
}: {
  value: number | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const th = useThresholds();
  const tone: HealthTone = th
    ? bandTone(value, th.R_int_safe_max, th.R_int_degraded_max, true)
    : "unknown";

  if (compact) {
    return (
      <span
        data-numeric
        className={cn("tabular-nums font-medium", className)}
        style={{ color: HEALTH_VAR[tone] }}
      >
        {value == null ? "—" : `${value.toFixed(1)} mΩ`}
      </span>
    );
  }

  return (
    <div
      className={cn(
        "relative flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2",
        tone === "unsafe" && "pulse-hazard",
        className
      )}
      style={{
        ...toneStyle(tone),
        borderColor: "color-mix(in srgb, var(--tone) 50%, transparent)",
      }}
    >
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        R<sub>int</sub> · pack DCIR
      </span>
      <span
        data-numeric
        className="text-lg font-semibold tabular-nums"
        style={{ color: "var(--tone)" }}
      >
        {value == null ? "—" : value.toFixed(1)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">mΩ</span>
      </span>
      {tone === "unsafe" ? (
        <span className="text-[10px] font-medium" style={{ color: "var(--tone)" }}>
          I²R heat risk
        </span>
      ) : tone === "degraded" ? (
        <span className="text-[10px] text-muted-foreground">elevated · watch</span>
      ) : null}
    </div>
  );
}

/* ── Cell voltage imbalance ──────────────────────────────────────
   Per-cell bar chart across the pack's series count.
   The dataset reports pack-level max spread only, so the per-cell
   heights are a deterministic *modelled* spread (stable per pack id)
   scaled to the measured Δ — the readout and alert use the measured
   value. The caption states this on screen. */
export function ImbalanceSparkline({
  value,
  packId,
  cells = 15,
  height = 36,
  showCaption = true,
  className,
}: {
  value: number | null | undefined;
  packId?: string;
  cells?: number;
  height?: number;
  showCaption?: boolean;
  className?: string;
}) {
  const th = useThresholds();
  const tone: HealthTone = th
    ? bandTone(value, th.dV_safe_max, th.dV_degraded_max, true)
    : "unknown";

  const bars = useMemo(() => {
    // Deterministic hash → stable spread shape for a given pack.
    let seed = 0;
    const key = packId ?? "pack";
    for (let i = 0; i < key.length; i += 1) {
      seed = (seed * 31 + key.charCodeAt(i)) % 100003;
    }
    const out: number[] = [];
    for (let i = 0; i < cells; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      out.push((seed / 2147483648) * 2 - 1); // −1..1
    }
    // Normalise so the extremes hit exactly ±0.5 → full span = measured Δ
    const lo = Math.min(...out);
    const hi = Math.max(...out);
    const span = hi - lo || 1;
    return out.map((v) => (v - lo) / span - 0.5);
  }, [cells, packId]);

  const delta = value ?? 0;

  return (
    <div className={cn("flex flex-col gap-1", className)} style={toneStyle(tone)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          ΔV<sub>cell</sub> · {cells}S
        </span>
        <span
          data-numeric
          className="text-sm font-semibold tabular-nums"
          style={{ color: "var(--tone)" }}
        >
          {value == null ? "—" : `${value.toFixed(1)} mV`}
        </span>
      </div>
      <div
        className="flex items-end gap-[2px] rounded-sm bg-secondary/50 px-1 py-1 ring-1 ring-inset ring-border"
        style={{ height }}
        aria-hidden
      >
        {bars.map((b, i) => {
          const mag = Math.abs(b) * 2; // 0..1
          return (
            <div
              key={i}
              className="flex-1 rounded-[1px] transition-all duration-500"
              style={{
                height: `${18 + mag * 78}%`,
                background:
                  value == null
                    ? "var(--muted-foreground)"
                    : `color-mix(in srgb, var(--tone) ${35 + mag * 65}%, transparent)`,
              }}
            />
          );
        })}
      </div>
      {showCaption ? (
        <p className="text-[9px] leading-tight text-muted-foreground">
          {value == null
            ? "no telemetry"
            : `max spread ${delta.toFixed(1)} mV · per-cell heights modelled from pack Δ`}
        </p>
      ) : null}
      {tone === "unsafe" ? (
        <span className="text-[10px] font-medium" style={{ color: "var(--tone)" }}>
          Voltage collapse risk
        </span>
      ) : null}
    </div>
  );
}

/* ── Temperature ─────────────────────────────────────────────────
   Dual-value thermometer: current vs 24 h peak. Flags the cross-field
   integrity fault when the recorded 24 h max sits below T_now. */
export function ThermoCard({
  now,
  peak24h,
  className,
}: {
  now: number | null | undefined;
  peak24h?: number | null;
  className?: string;
}) {
  const th = useThresholds();
  const tone: HealthTone = th
    ? bandTone(now, th.T_safe_max, th.T_degraded_max, true)
    : "unknown";
  const sensorFault =
    now != null && peak24h != null && peak24h < now;

  // Scale spans the solver's own cold floor → quarantine ceiling.
  const lo = th?.T_cold_min ?? 0;
  const hi = th ? th.T_degraded_max + 8 : 60;
  const posOf = (v: number) => clamp01((v - lo) / (hi - lo)) * 100;

  return (
    <div
      className={cn("flex flex-col gap-1.5 rounded-md border bg-card px-3 py-2", className)}
      style={{
        ...toneStyle(tone),
        borderColor: sensorFault
          ? "var(--health-unsafe)"
          : "color-mix(in srgb, var(--tone) 40%, transparent)",
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Temperature
        </span>
        <span data-numeric className="text-xs tabular-nums text-muted-foreground">
          24h peak {peak24h == null ? "—" : `${peak24h.toFixed(1)}°`}
        </span>
      </div>
      <span
        data-numeric
        className="text-lg font-semibold tabular-nums"
        style={{ color: "var(--tone)" }}
      >
        {now == null ? "—" : now.toFixed(1)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">°C now</span>
      </span>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary ring-1 ring-inset ring-border">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{
            width: `${now == null ? 0 : posOf(now)}%`,
            background: "linear-gradient(90deg, var(--prio-medium), var(--tone))",
          }}
        />
        {peak24h != null ? (
          <div
            className="absolute inset-y-0 w-px bg-foreground/70"
            style={{ left: `${posOf(peak24h)}%` }}
            title={`24 h peak ${peak24h.toFixed(1)} °C`}
          />
        ) : null}
        {th ? (
          <div
            className="absolute inset-y-0 w-px"
            style={{
              left: `${posOf(th.T_safe_max)}%`,
              background: "var(--health-degraded)",
            }}
            title={`Safe ceiling ${th.T_safe_max} °C`}
          />
        ) : null}
      </div>
      {sensorFault ? (
        <p
          className="rounded-sm px-1.5 py-1 text-[10px] font-medium"
          style={{
            background: "color-mix(in srgb, var(--health-unsafe) 18%, transparent)",
            color: "var(--health-unsafe)",
          }}
        >
          Sensor fault — 24 h max below current reading
        </p>
      ) : null}
    </div>
  );
}

/* ── Badges ──────────────────────────────────────────────────── */

export function HealthBadge({
  status,
  size = "md",
  showGlyph = true,
  className,
}: {
  status?: string | null;
  size?: Size;
  showGlyph?: boolean;
  className?: string;
}) {
  const tone = healthTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium",
        size === "sm" ? "text-[10px]" : "text-xs",
        className
      )}
      style={{
        ...toneStyle(tone),
        color: "var(--tone)",
        borderColor: "color-mix(in srgb, var(--tone) 45%, transparent)",
        background: "color-mix(in srgb, var(--tone) 12%, transparent)",
      }}
    >
      {showGlyph ? (
        <span aria-hidden className="text-[9px] leading-none">
          {HEALTH_GLYPH[tone]}
        </span>
      ) : null}
      {status ?? "Unclassified"}
    </span>
  );
}

export function PriorityChip({
  priority,
  weight,
  size = "md",
  className,
}: {
  priority?: string | null;
  weight?: number | null;
  size?: Size;
  className?: string;
}) {
  const tone = priorityTone(priority);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium",
        size === "sm" ? "text-[10px]" : "text-xs",
        className
      )}
      style={{
        color: priorityColor(priority),
        borderColor: `color-mix(in srgb, ${priorityColor(priority)} 45%, transparent)`,
        background: `color-mix(in srgb, ${priorityColor(priority)} 12%, transparent)`,
      }}
      data-priority={tone}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: priorityColor(priority) }}
      />
      {priority ?? "—"}
      {weight != null ? (
        <span data-numeric className="opacity-70">
          ×{weight.toFixed(1)}
        </span>
      ) : null}
    </span>
  );
}

/** Big numeric readout used across KPI surfaces. */
export function Readout({
  value,
  unit,
  tone,
  label,
  hint,
  className,
}: {
  value: string;
  unit?: string;
  tone?: HealthTone;
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span
        data-numeric
        className="text-2xl font-semibold tabular-nums leading-none"
        style={tone ? { color: HEALTH_VAR[tone] } : undefined}
      >
        {value}
        {unit ? (
          <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>
        ) : null}
      </span>
      {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
