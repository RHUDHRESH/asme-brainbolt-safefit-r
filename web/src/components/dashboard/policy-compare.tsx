"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { MandatoryScoreboard } from "@/components/dashboard/mandatory-scoreboard";
import { ZoneSection } from "@/components/dashboard/zone-section";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  delta,
  formatPct,
  formatScore,
  type MetricsPayload,
  type PolicyMetrics,
} from "@/lib/metrics";
import { useState } from "react";

type PolicyCompareProps = {
  metrics: MetricsPayload | null;
  unlocked: boolean;
  onOpenCompare?: () => void;
};

function moreMetricRows(p: PolicyMetrics, h: PolicyMetrics) {
  return [
    {
      metric: "Unserved",
      proposed: String(p.unserved),
      hsf: String(h.unserved),
    },
    {
      metric: "High/critical served %",
      proposed: formatPct(p.high_critical_served_pct),
      hsf: formatPct(h.high_critical_served_pct),
    },
    {
      metric: "Service rate %",
      proposed: formatPct(p.service_rate_pct),
      hsf: formatPct(h.service_rate_pct),
    },
    {
      metric: "Thermal stress incidents",
      proposed: String(p.thermal_stress_incidents),
      hsf: String(h.thermal_stress_incidents),
    },
    {
      metric: "Voltage collapse incidents",
      proposed: String(p.voltage_collapse_incidents),
      hsf: String(h.voltage_collapse_incidents),
    },
    {
      metric: "Critical avg SoH",
      proposed: formatPct(p.critical_avg_soh),
      hsf: formatPct(h.critical_avg_soh),
    },
    {
      metric: "Critical avg IR",
      proposed: formatScore(p.critical_avg_ir),
      hsf: formatScore(h.critical_avg_ir),
    },
  ];
}

export function PolicyCompare({
  metrics,
  unlocked,
  onOpenCompare,
}: PolicyCompareProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!unlocked || !metrics?.comparison) {
    return (
      <Card className="shadow-none h-full" data-motion="policy">
        <CardHeader>
          <CardTitle>Policy proof</CardTitle>
          <CardDescription>
            HSF vs Proposed comparison unlocks after a run.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  const p = metrics.comparison.Proposed;
  const h = metrics.comparison.HSF;

  const chartData = [
    { name: "Service %", Proposed: p.service_rate_pct, HSF: h.service_rate_pct },
    {
      name: "Avg SoH",
      Proposed: p.avg_soh_allocated,
      HSF: h.avg_soh_allocated,
    },
    { name: "Avg BSS", Proposed: p.avg_bss_allocated, HSF: h.avg_bss_allocated },
    {
      name: "Unsafe",
      Proposed: p.unsafe_allocations,
      HSF: h.unsafe_allocations,
    },
    {
      name: "Crit SoH",
      Proposed: p.critical_avg_soh,
      HSF: h.critical_avg_soh,
    },
    {
      name: "Crit IR",
      Proposed: p.critical_avg_ir,
      HSF: h.critical_avg_ir,
    },
  ];

  const tucked = moreMetricRows(p, h);

  return (
    <div data-motion="policy" data-screen="policy">
      <ZoneSection
        title="Policy proof"
        description="Proposed global matching vs Highest-SoC-First on the same fleet."
        detailsOpen={detailsOpen}
        onDetailsOpenChange={setDetailsOpen}
        detailsLabel="Show chart & more metrics"
        detailsHideLabel="Hide chart & more metrics"
        actions={
          onOpenCompare ? (
            <Button type="button" size="sm" variant="outline" onClick={onOpenCompare}>
              Open Compare
            </Button>
          ) : null
        }
        details={
          <div className="space-y-4">
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  barGap={4}
                  className={onOpenCompare ? "cursor-pointer" : undefined}
                  onClick={() => onOpenCompare?.()}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Proposed" fill="var(--foreground)" radius={4} />
                  <Bar dataKey="HSF" fill="var(--muted-foreground)" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Proposed</TableHead>
                  <TableHead>HSF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tucked.map((row) => (
                  <TableRow key={row.metric}>
                    <TableCell className="font-medium">{row.metric}</TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {row.proposed}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {row.hsf}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <div
            className="border px-3 py-2 text-sm"
            style={{ borderColor: "color-mix(in srgb, var(--health-safe) 40%, transparent)" }}
          >
            <p className="text-muted-foreground text-xs">SoH advantage</p>
            <p
              data-numeric
              className="text-xl font-semibold tabular-nums"
              style={{ color: "var(--health-safe)" }}
            >
              +{formatScore(delta(p.avg_soh_allocated, h.avg_soh_allocated))} pp
            </p>
          </div>
          <div
            className="border px-3 py-2 text-sm"
            style={{ borderColor: "color-mix(in srgb, var(--health-unsafe) 40%, transparent)" }}
          >
            <p className="text-muted-foreground text-xs">Unsafe allocations avoided</p>
            <p
              data-numeric
              className="text-xl font-semibold tabular-nums"
              style={{ color: "var(--health-unsafe)" }}
            >
              {h.unsafe_allocations - p.unsafe_allocations} packs
            </p>
          </div>
        </div>

        {/* The mandatory scoreboard is the authoritative table and already
            carries every metric the short summary repeated. A second table
            saying the same thing directly under it only invited the reader to
            check whether the two agreed. */}
        <MandatoryScoreboard proposed={p} hsf={h} className="mt-4" />
      </ZoneSection>
    </div>
  );
}
