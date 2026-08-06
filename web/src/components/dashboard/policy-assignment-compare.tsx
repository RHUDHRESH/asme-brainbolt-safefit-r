"use client";

import { useMemo, useState } from "react";
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

import {
  AssignmentDetailSheet,
  type DetailSelection,
} from "@/components/dashboard/assignment-detail-sheet";
import { HeadToHead } from "@/components/dashboard/head-to-head";
import { ReasonHover } from "@/components/dashboard/reason-hover";
import { ZoneSection } from "@/components/dashboard/zone-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AssignmentRow, DrillFilter, FleetBattery } from "@/lib/metrics";
import { formatPct, formatScore } from "@/lib/metrics";
import { downloadCsv } from "@/lib/csv-export";
import { oneLineReason } from "@/lib/safety-gates";
import { cn } from "@/lib/utils";
import type { ResultsScreen } from "@/components/dashboard/results-nav";

const PAGE = 25;
const QUARANTINE = "Unsafe / Quarantine";

type CompareRow = {
  vehicle_id: string;
  priority: string;
  proposed: AssignmentRow | undefined;
  hsf: AssignmentRow | undefined;
  samePack: boolean;
  sohDelta: number | null;
  hsfUnsafe: boolean;
  diverged: boolean;
};

type PolicyAssignmentCompareProps = {
  proposed?: AssignmentRow[];
  hsf?: AssignmentRow[];
  fleet?: FleetBattery[];
  drillFilter: DrillFilter;
  onDrillChange: (filter: DrillFilter) => void;
  onNavigate?: (screen: ResultsScreen, filter?: DrillFilter) => void;
};

export function PolicyAssignmentCompare({
  proposed = [],
  hsf = [],
  fleet = [],
  drillFilter,
  onDrillChange,
  onNavigate,
}: PolicyAssignmentCompareProps) {
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<DetailSelection | null>(null);
  const [chartsOpen, setChartsOpen] = useState(false);

  const rows = useMemo(() => {
    const map = new Map<string, CompareRow>();
    for (const r of proposed) {
      map.set(r.vehicle_id, {
        vehicle_id: r.vehicle_id,
        priority: r.priority,
        proposed: r,
        hsf: undefined,
        samePack: false,
        sohDelta: null,
        hsfUnsafe: false,
        diverged: false,
      });
    }
    for (const r of hsf) {
      const existing = map.get(r.vehicle_id);
      if (existing) {
        existing.hsf = r;
      } else {
        map.set(r.vehicle_id, {
          vehicle_id: r.vehicle_id,
          priority: r.priority,
          proposed: undefined,
          hsf: r,
          samePack: false,
          sohDelta: null,
          hsfUnsafe: false,
          diverged: false,
        });
      }
    }
    const out = [...map.values()].map((row) => {
      const samePack =
        !!row.proposed?.battery_id &&
        row.proposed.battery_id === row.hsf?.battery_id;
      const sohDelta =
        row.proposed?.SoH != null && row.hsf?.SoH != null
          ? row.proposed.SoH - row.hsf.SoH
          : null;
      const hsfUnsafe = row.hsf?.status === QUARANTINE;
      const diverged =
        !samePack ||
        hsfUnsafe ||
        (sohDelta != null && Math.abs(sohDelta) > 0.01);
      return { ...row, samePack, sohDelta, hsfUnsafe, diverged };
    });
    out.sort((a, b) => a.vehicle_id.localeCompare(b.vehicle_id));
    return out;
  }, [proposed, hsf]);

  const filtered = useMemo(() => {
    let list = rows;
    if (drillFilter.divergencesOnly) list = list.filter((r) => r.diverged);
    if (drillFilter.focusVehicleId) {
      list = list.filter((r) => r.vehicle_id === drillFilter.focusVehicleId);
    }
    return list;
  }, [rows, drillFilter]);

  const summary = useMemo(() => {
    const same = rows.filter((r) => r.samePack).length;
    const sohWins = rows.filter((r) => (r.sohDelta ?? 0) > 0).length;
    const hsfUnsafe = rows.filter((r) => r.hsfUnsafe).length;
    return { same, sohWins, hsfUnsafe, total: rows.length };
  }, [rows]);

  const chartData = useMemo(() => {
    const avg = (list: AssignmentRow[], key: "SoH" | "BSS") => {
      const vals = list
        .filter((r) => r.served && r[key] != null)
        .map((r) => r[key] as number);
      if (!vals.length) return 0;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    return [
      {
        name: "Avg SoH",
        Proposed: avg(proposed, "SoH"),
        HSF: avg(hsf, "SoH"),
      },
      {
        name: "Avg BSS",
        Proposed: avg(proposed, "BSS"),
        HSF: avg(hsf, "BSS"),
      },
      {
        name: "Unsafe",
        Proposed: proposed.filter((r) => r.status === QUARANTINE).length,
        HSF: hsf.filter((r) => r.status === QUARANTINE).length,
      },
    ];
  }, [proposed, hsf]);

  const sohDeltaBars = useMemo(() => {
    return rows
      .filter(
        (r) =>
          (r.priority === "Critical" || r.priority === "High") &&
          r.sohDelta != null
      )
      .sort((a, b) => Math.abs(b.sohDelta!) - Math.abs(a.sohDelta!))
      .slice(0, 15)
      .map((r) => ({
        name: r.vehicle_id,
        delta: Number(r.sohDelta!.toFixed(2)),
      }));
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageSafe = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(pageSafe * PAGE, pageSafe * PAGE + PAGE);

  return (
    <div data-screen="compare" className="space-y-6">
      <HeadToHead proposed={proposed} hsf={hsf} fleet={fleet} />

      <ZoneSection
        title="Proposed vs HSF"
        description="Per-vehicle matching differences. Click a row for Proposed detail."
        detailsOpen={chartsOpen}
        onDetailsOpenChange={setChartsOpen}
        detailsLabel="Show charts"
        detailsHideLabel="Hide charts"
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv(
                "compare-proposed-hsf.csv",
                filtered.map((r) => ({
                  vehicle_id: r.vehicle_id,
                  priority: r.priority,
                  proposed_battery: r.proposed?.battery_id ?? "",
                  proposed_SoH: r.proposed?.SoH ?? "",
                  proposed_BSS: r.proposed?.BSS ?? "",
                  hsf_battery: r.hsf?.battery_id ?? "",
                  hsf_SoH: r.hsf?.SoH ?? "",
                  hsf_BSS: r.hsf?.BSS ?? "",
                  soh_delta: r.sohDelta ?? "",
                  same_pack: r.samePack,
                  hsf_unsafe: r.hsfUnsafe,
                }))
              )
            }
          >
            Export CSV
          </Button>
        }
        details={
          <div className="space-y-4">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Proposed" fill="var(--foreground)" radius={4} />
                  <Bar dataKey="HSF" fill="var(--muted-foreground)" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {sohDeltaBars.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Top Critical/High SoH deltas (Proposed − HSF)
                </p>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={sohDeltaBars}
                      layout="vertical"
                      margin={{ left: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={72}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip />
                      <Bar dataKey="delta" fill="var(--uber-accent)" radius={3} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null}
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{summary.total} vehicles</Badge>
          <Badge variant="outline">Same pack: {summary.same}</Badge>
          <Badge variant="outline">SoH wins: {summary.sohWins}</Badge>
          <Badge variant={summary.hsfUnsafe ? "destructive" : "outline"}>
            HSF unsafe: {summary.hsfUnsafe}
          </Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={drillFilter.divergencesOnly ? "default" : "outline"}
            onClick={() => {
              setPage(0);
              onDrillChange({
                ...drillFilter,
                divergencesOnly: !drillFilter.divergencesOnly,
              });
            }}
          >
            Divergences only
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setPage(0);
              onDrillChange({});
            }}
          >
            Clear
          </Button>
        </div>
      </ZoneSection>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Vehicle table</CardTitle>
          <CardDescription>
            {filtered.length} rows
            {drillFilter.divergencesOnly ? " · divergences only" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle</TableHead>
                <TableHead>Pri</TableHead>
                <TableHead>Proposed</TableHead>
                <TableHead>HSF</TableHead>
                <TableHead>Δ SoH</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((row) => (
                <TableRow
                  key={row.vehicle_id}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-muted/40",
                    row.hsfUnsafe && "bg-destructive/5"
                  )}
                  onClick={() => {
                    if (row.proposed) {
                      setSelection({
                        kind: "assignment",
                        row: row.proposed,
                        hsf: row.hsf,
                      });
                    } else if (row.hsf) {
                      setSelection({
                        kind: "assignment",
                        row: row.hsf,
                        hsf: row.hsf,
                      });
                    }
                  }}
                >
                  <TableCell className="font-medium">{row.vehicle_id}</TableCell>
                  <TableCell>{row.priority}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <ReasonHover
                      pack={row.proposed}
                      vehicleId={row.vehicle_id}
                      priority={row.priority}
                      proposed={row.proposed}
                      hsf={row.hsf}
                    >
                      <span className="underline-offset-2 hover:underline">
                        {row.proposed?.battery_id ?? "—"}
                        {row.proposed?.SoH != null
                          ? ` · ${formatPct(row.proposed.SoH)}`
                          : ""}
                      </span>
                    </ReasonHover>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <ReasonHover
                      pack={row.hsf}
                      vehicleId={row.vehicle_id}
                      priority={row.priority}
                      proposed={row.proposed}
                      hsf={row.hsf}
                    >
                      <span className="underline-offset-2 hover:underline">
                        {row.hsf?.battery_id ?? "—"}
                        {row.hsf?.SoH != null
                          ? ` · ${formatPct(row.hsf.SoH)}`
                          : ""}
                      </span>
                    </ReasonHover>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.sohDelta == null
                      ? "—"
                      : `${row.sohDelta >= 0 ? "+" : ""}${formatScore(row.sohDelta)}`}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.samePack ? "same" : "diff"}
                    {row.hsfUnsafe ? " · HSF unsafe" : ""}
                  </TableCell>
                  <TableCell className="max-w-[26rem] truncate text-xs text-muted-foreground">
                    {(() => {
                      const why = row.hsfUnsafe
                        ? `HSF handed quarantine · Proposed ${oneLineReason(row.proposed ?? {})}`
                        : row.samePack
                          ? "Same pack under both policies"
                          : `Proposed healthier or safer · ${oneLineReason(row.proposed ?? {})}`;
                      return <span title={why}>{why}</span>;
                    })()}
                  </TableCell>
                </TableRow>
              ))}
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No rows match this filter.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {pageSafe + 1} / {pageCount}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={pageSafe <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Prev
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={pageSafe >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AssignmentDetailSheet
        selection={selection}
        open={selection != null}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
        onNavigate={onNavigate}
      />
    </div>
  );
}
