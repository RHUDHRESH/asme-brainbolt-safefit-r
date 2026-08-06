"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  delta,
  formatPct,
  formatScore,
  servedLabel,
  type MetricsPayload,
} from "@/lib/metrics";
import { cn } from "@/lib/utils";

type KpiStripProps = {
  metrics: MetricsPayload | null;
  unlocked: boolean;
  className?: string;
  showFleetChips?: boolean;
  showDeltas?: boolean;
  onKpiClick?: (label: string) => void;
};

export function KpiStrip({
  metrics,
  unlocked,
  className,
  showFleetChips = false,
  showDeltas = false,
  onKpiClick,
}: KpiStripProps) {
  if (!unlocked || !metrics?.comparison) {
    return (
      <section
        aria-label="Key performance indicators locked"
        className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="shadow-none">
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-16" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-24" />
              <Skeleton className="mt-2 h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </section>
    );
  }

  const p = metrics.comparison.Proposed;
  const h = metrics.comparison.HSF;

  const items = [
    {
      label: "Served",
      value: servedLabel(p),
      hint: `HSF ${servedLabel(h)}`,
      delta: null as string | null,
    },
    {
      label: "Unsafe",
      value: String(p.unsafe_allocations),
      hint: `HSF ${h.unsafe_allocations}`,
      delta: `${delta(p.unsafe_allocations, h.unsafe_allocations)} vs HSF`,
      good: p.unsafe_allocations === 0,
    },
    {
      label: "Avg SoH",
      value: formatPct(p.avg_soh_allocated),
      hint: `HSF ${formatPct(h.avg_soh_allocated)}`,
      delta: `+${formatScore(delta(p.avg_soh_allocated, h.avg_soh_allocated))} pp`,
    },
    {
      label: "Avg BSS",
      value: formatScore(p.avg_bss_allocated),
      hint: `HSF ${formatScore(h.avg_bss_allocated)}`,
      delta: `+${formatScore(delta(p.avg_bss_allocated, h.avg_bss_allocated))}`,
    },
  ];

  return (
    <div className={cn("space-y-4", className)}>
      {showFleetChips ? (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="tracking-wider">
            {metrics.n_batteries ?? "—"} packs
          </Badge>
          <Badge variant="secondary" className="tracking-wider">
            {metrics.n_vehicles ?? "—"} requests
          </Badge>
        </div>
      ) : null}

      <section
        aria-label="Key performance indicators"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {items.map((item) => (
          <Card
            key={item.label}
            data-kpi
            role={onKpiClick ? "button" : undefined}
            tabIndex={onKpiClick ? 0 : undefined}
            onClick={() => onKpiClick?.(item.label)}
            onKeyDown={(e) => {
              if (!onKpiClick) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onKpiClick(item.label);
              }
            }}
            className={cn(
              "shadow-none transition-shadow duration-300 hover:shadow-sm",
              onKpiClick && "cursor-pointer"
            )}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p
                className={cn(
                  "text-2xl font-semibold tracking-tight tabular-nums",
                  item.good === false && "text-destructive"
                )}
              >
                {item.value}
              </p>
              <p className="text-xs text-muted-foreground">{item.hint}</p>
              {item.delta ? (
                <p className="text-xs font-medium text-foreground/80">
                  {item.delta}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </section>

      {showDeltas ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="border border-border px-3 py-2 text-sm">
            <p className="text-xs text-muted-foreground">SoH vs HSF</p>
            <p className="font-semibold tabular-nums">
              +{formatScore(delta(p.avg_soh_allocated, h.avg_soh_allocated))} pp
            </p>
          </div>
          <div className="border border-border px-3 py-2 text-sm">
            <p className="text-xs text-muted-foreground">Unsafe avoided</p>
            <p className="font-semibold tabular-nums">
              {h.unsafe_allocations - p.unsafe_allocations} packs
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
