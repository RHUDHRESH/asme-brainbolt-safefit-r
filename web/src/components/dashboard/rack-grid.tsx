"use client";

/**
 * Spatial rack map — one cell per pack, laid out in shelf order.
 *
 * Shelf position is the pack's row index in the fleet dataset (`slot`), which is
 * the only ordering the data actually gives us; the column count adapts to the
 * fleet size rather than assuming a rack shape. Hovering a cell surfaces its
 * readouts; clicking drills into the fleet explorer.
 */

import { useMemo, useState } from "react";

import {
  HealthBadge,
  ImbalanceSparkline,
  IrCard,
  SocPill,
  ThermoCard,
} from "@/components/params/param-primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HEALTH_VAR, STATUS_ORDER, healthTone } from "@/lib/design-tokens";
import type { FleetBattery } from "@/lib/metrics";
import { cn } from "@/lib/utils";

/** Prefer a 20-wide rack when it divides evenly, else the nearest tidy width. */
function rackColumns(n: number): number {
  for (const w of [20, 25, 16, 10, 12, 15]) {
    if (n % w === 0 && n / w >= 4) return w;
  }
  return Math.ceil(Math.sqrt(n * 2));
}

export function RackGrid({
  fleet,
  onSelect,
  highlight,
  dimUnhighlighted = false,
  className,
}: {
  fleet: FleetBattery[];
  onSelect?: (battery: FleetBattery) => void;
  /** Battery ids matching the active cross-filter. */
  highlight?: Set<string>;
  dimUnhighlighted?: boolean;
  className?: string;
}) {
  const [hover, setHover] = useState<FleetBattery | null>(null);

  const ordered = useMemo(
    () => [...fleet].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)),
    [fleet]
  );
  const cols = rackColumns(ordered.length || 1);
  const rows = Math.ceil(ordered.length / cols);

  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const b of ordered) acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, [ordered]);

  const focus = hover;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Station rack map</CardTitle>
          <span data-numeric className="text-[11px] text-muted-foreground">
            {rows} × {cols} shelves · {ordered.length} packs
          </span>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {STATUS_ORDER.map((s) => (
            <li key={s} className="flex items-center gap-1.5 text-[11px]">
              <span
                aria-hidden
                className="size-2.5 rounded-[2px]"
                style={{ background: HEALTH_VAR[healthTone(s)] }}
              />
              <span className="text-muted-foreground">{s}</span>
              <span data-numeric className="font-semibold">
                {counts[s] ?? 0}
              </span>
            </li>
          ))}
        </ul>
      </CardHeader>

      <CardContent className="space-y-3">
        <div
          className="grid-backdrop relative rounded-md border border-border p-2"
          onMouseLeave={() => setHover(null)}
        >
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {ordered.map((b, i) => {
              const tone = healthTone(b.status);
              const assigned = b.assigned_vehicle_id != null;
              const isFocus = focus?.battery_id === b.battery_id;
              const muted =
                dimUnhighlighted && highlight != null && !highlight.has(b.battery_id);
              return (
                <button
                  key={b.battery_id}
                  type="button"
                  onMouseEnter={() => setHover(b)}
                  onFocus={() => setHover(b)}
                  onClick={() => onSelect?.(b)}
                  aria-label={`${b.battery_id}, ${b.status}${assigned ? `, assigned to ${b.assigned_vehicle_id}` : ""}`}
                  className={cn(
                    "relative aspect-square rounded-[2px] transition-transform duration-150",
                    "hover:z-10 hover:scale-[1.35] focus-visible:z-10 focus-visible:scale-[1.35] focus-visible:outline-none",
                    tone === "unsafe" && !muted && "pulse-hazard"
                  )}
                  style={{
                    background: `color-mix(in srgb, ${HEALTH_VAR[tone]} ${assigned ? 100 : 42}%, transparent)`,
                    opacity: muted ? 0.12 : 1,
                    boxShadow: isFocus
                      ? `0 0 0 1.5px var(--foreground), 0 0 12px -2px ${HEALTH_VAR[tone]}`
                      : assigned && !muted
                        ? `0 0 8px -3px ${HEALTH_VAR[tone]}`
                        : undefined,
                    animationDelay: `${(i % 40) * 25}ms`,
                  }}
                >
                  {assigned ? (
                    <span
                      aria-hidden
                      className="absolute inset-0 flex items-center justify-center text-[6px] font-bold text-black/70"
                    >
                      ●
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Solid cells are packs allocated by the proposed method; faded cells are
          idle inventory. Shelf order follows the fleet dataset row order.
        </p>

        {/* Hover inspector */}
        <div className="min-h-[8.5rem] rounded-md border border-border bg-secondary/40 p-3">
          {focus ? (
            <div className="flash-in space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span data-numeric className="text-sm font-semibold">
                  {focus.battery_id}
                </span>
                <HealthBadge status={focus.status} size="sm" />
                {focus.assigned_vehicle_id ? (
                  <span className="text-[11px] text-muted-foreground">
                    → <span data-numeric className="text-foreground">{focus.assigned_vehicle_id}</span>{" "}
                    ({focus.priority})
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">unallocated</span>
                )}
                {focus.BSS != null ? (
                  <span className="text-[11px] text-muted-foreground">
                    BSS{" "}
                    <span data-numeric className="font-semibold text-foreground">
                      {focus.BSS.toFixed(1)}
                    </span>
                  </span>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SocPill value={focus.SoC} />
                <ThermoCard now={focus.T} peak24h={focus.T_24h_max} />
                <IrCard value={focus.R_int_mOhm} />
                <ImbalanceSparkline
                  value={focus.dV_cell_mV}
                  packId={focus.battery_id}
                  showCaption={false}
                  height={30}
                />
              </div>
            </div>
          ) : (
            <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Hover a shelf to inspect the pack.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
