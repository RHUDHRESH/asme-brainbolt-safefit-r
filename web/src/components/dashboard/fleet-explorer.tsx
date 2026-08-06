"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import {
  AssignmentDetailSheet,
  type DetailSelection,
} from "@/components/dashboard/assignment-detail-sheet";
import { FleetHealth } from "@/components/dashboard/fleet-health";
import { ReasonHover } from "@/components/dashboard/reason-hover";
import { ZoneSection } from "@/components/dashboard/zone-section";
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
import type {
  ClassificationSummary,
  DrillFilter,
  FleetBattery,
} from "@/lib/metrics";
import { downloadCsv } from "@/lib/csv-export";
import { formatPct, formatScore } from "@/lib/metrics";
import { oneLineReason, shortStatus } from "@/lib/safety-gates";
import type { ResultsScreen } from "@/components/dashboard/results-nav";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  "Safe and Available": "#048848",
  "Degraded but Usable": "#ffc043",
  "Unsafe / Quarantine": "#e11900",
};

const PAGE = 25;

type FleetExplorerProps = {
  classification: ClassificationSummary | null;
  fleet: FleetBattery[];
  drillFilter: DrillFilter;
  onDrillChange: (filter: DrillFilter) => void;
  onNavigate?: (screen: ResultsScreen, filter?: DrillFilter) => void;
};

export function FleetExplorer({
  classification,
  fleet,
  drillFilter,
  onDrillChange,
  onNavigate,
}: FleetExplorerProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<DetailSelection | null>(null);
  const [chartsOpen, setChartsOpen] = useState(false);

  const filtered = useMemo(() => {
    let rows = fleet;
    if (drillFilter.status) {
      rows = rows.filter((r) => r.status === drillFilter.status);
    }
    if (drillFilter.quarantineReason) {
      rows = rows.filter(
        (r) => (r.quarantine_reason ?? "") === drillFilter.quarantineReason
      );
    }
    if (drillFilter.focusBatteryId) {
      rows = rows.filter((r) => r.battery_id === drillFilter.focusBatteryId);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.battery_id.toLowerCase().includes(q) ||
          (r.assigned_vehicle_id ?? "").toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [fleet, drillFilter, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageSafe = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(pageSafe * PAGE, pageSafe * PAGE + PAGE);

  const scatter = useMemo(
    () =>
      fleet
        .filter((b) => b.SoC != null && b.SoH != null)
        .map((b) => ({
          id: b.battery_id,
          SoC: b.SoC as number,
          SoH: b.SoH as number,
          status: b.status,
          fill: STATUS_COLOR[b.status] ?? "#78716c",
        })),
    [fleet]
  );

  const rIntScatter = useMemo(
    () =>
      fleet
        .filter((b) => b.R_int_mOhm != null && b.SoH != null)
        .map((b) => ({
          id: b.battery_id,
          R_int: b.R_int_mOhm as number,
          SoH: b.SoH as number,
          status: b.status,
          fill: STATUS_COLOR[b.status] ?? "#78716c",
        })),
    [fleet]
  );

  const sohBuckets = useMemo(() => {
    const buckets = [
      { name: "≤60", min: 0, max: 60, count: 0 },
      { name: "60–75", min: 60, max: 75, count: 0 },
      { name: "75–85", min: 75, max: 85, count: 0 },
      { name: "85–95", min: 85, max: 95, count: 0 },
      { name: ">95", min: 95, max: 101, count: 0 },
    ];
    for (const b of fleet) {
      if (b.SoH == null) continue;
      const bucket = buckets.find((x) => b.SoH! >= x.min && b.SoH! < x.max);
      if (bucket) bucket.count += 1;
    }
    return buckets;
  }, [fleet]);

  const exportFleet = () =>
    downloadCsv(
      "fleet.csv",
      filtered.map((r) => ({
        battery_id: r.battery_id,
        status: r.status,
        SoC: r.SoC,
        SoH: r.SoH,
        R_int_mOhm: r.R_int_mOhm,
        dV_cell_mV: r.dV_cell_mV,
        quarantine_reason: r.quarantine_reason ?? "",
        assigned_vehicle_id: r.assigned_vehicle_id ?? "",
        BSS: r.BSS,
        T_score: r.T_score,
      }))
    );

  const charts = (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">SoC × SoH</CardTitle>
            <CardDescription>Click a point for pack detail.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="SoC"
                    name="SoC"
                    unit="%"
                    domain={[40, 100]}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="SoH"
                    name="SoH"
                    unit="%"
                    domain={[40, 100]}
                    tick={{ fontSize: 11 }}
                  />
                  <ZAxis range={[40, 40]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    formatter={(value) =>
                      typeof value === "number" ? value.toFixed(1) : value
                    }
                    labelFormatter={(_, payload) =>
                      (payload?.[0]?.payload as { id?: string })?.id ?? ""
                    }
                  />
                  <Scatter
                    data={scatter}
                    onClick={(d) => {
                      const id = (d as { id?: string })?.id;
                      const bat = fleet.find((b) => b.battery_id === id);
                      if (bat) setSelection({ kind: "fleet", battery: bat });
                    }}
                  >
                    {scatter.map((p) => (
                      <Cell
                        key={p.id}
                        fill={p.fill}
                        className="cursor-pointer"
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">SoH distribution</CardTitle>
            <CardDescription>Pack counts by health band.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sohBuckets}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="var(--foreground)" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">R_int × SoH</CardTitle>
          <CardDescription>
            Internal resistance vs health — click a point for detail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="R_int"
                  name="R_int"
                  unit=" mΩ"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="SoH"
                  name="SoH"
                  unit="%"
                  domain={[40, 100]}
                  tick={{ fontSize: 11 }}
                />
                <ZAxis range={[40, 40]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  formatter={(value) =>
                    typeof value === "number" ? value.toFixed(1) : value
                  }
                  labelFormatter={(_, payload) =>
                    (payload?.[0]?.payload as { id?: string })?.id ?? ""
                  }
                />
                <Scatter
                  data={rIntScatter}
                  onClick={(d) => {
                    const id = (d as { id?: string })?.id;
                    const bat = fleet.find((b) => b.battery_id === id);
                    if (bat) setSelection({ kind: "fleet", battery: bat });
                  }}
                >
                  {rIntScatter.map((p) => (
                    <Cell
                      key={p.id}
                      fill={p.fill}
                      className="cursor-pointer"
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </>
  );

  return (
    <div data-screen="fleet" className="space-y-6">
      <ZoneSection
        title="Fleet"
        description="Tier counts and pack table first. Charts expand on demand — every row and point opens detail."
        detailsOpen={chartsOpen}
        onDetailsOpenChange={setChartsOpen}
        detailsLabel="Show charts"
        detailsHideLabel="Hide charts"
        details={charts}
        actions={
          <Button type="button" size="sm" variant="outline" onClick={exportFleet}>
            Export CSV
          </Button>
        }
      >
        <FleetHealth
          classification={classification}
          unlocked
          onTierClick={(status) => {
            setPage(0);
            onDrillChange({
              ...drillFilter,
              status,
              quarantineReason: undefined,
            });
          }}
          onReasonClick={(reason) => {
            setPage(0);
            onDrillChange({
              ...drillFilter,
              quarantineReason: reason,
              status: "Unsafe / Quarantine",
            });
          }}
        />
      </ZoneSection>

      <Card className="shadow-none">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-base">Pack table</CardTitle>
            <CardDescription>
              {filtered.length} packs
              {drillFilter.status ? ` · ${drillFilter.status}` : ""}
              {drillFilter.quarantineReason
                ? ` · ${drillFilter.quarantineReason}`
                : ""}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search battery / vehicle…"
              className="h-9 min-w-[12rem] flex-1 border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setQuery("");
                setPage(0);
                onDrillChange({});
              }}
            >
              Clear filters
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Battery</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>SoC</TableHead>
                <TableHead>SoH</TableHead>
                <TableHead>R_int</TableHead>
                <TableHead>Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((row) => (
                <TableRow
                  key={row.battery_id}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-muted/40",
                    drillFilter.focusBatteryId === row.battery_id && "bg-muted/50"
                  )}
                  onClick={() => setSelection({ kind: "fleet", battery: row })}
                >
                  <TableCell className="font-mono text-xs">
                    {row.battery_id}
                  </TableCell>
                  <TableCell>
                    <ReasonHover pack={row}>
                      <span
                        className={cn(
                          "inline-block border px-1.5 py-0.5 text-[10px] font-semibold",
                          row.status.includes("Safe") &&
                            "border-[var(--positive)] text-[var(--positive)]",
                          row.status.includes("Degraded") &&
                            "border-[var(--warning)]",
                          row.status.includes("Quarantine") &&
                            "border-[var(--negative)] bg-[var(--negative)] text-white"
                        )}
                      >
                        {shortStatus(row.status)}
                      </span>
                    </ReasonHover>
                  </TableCell>
                  <TableCell className="max-w-[22rem] truncate text-xs text-muted-foreground">
                    <ReasonHover pack={row}>
                      <span
                        className="underline-offset-2 hover:underline"
                        title={row.quarantine_reason ?? oneLineReason(row)}
                      >
                        {row.quarantine_reason ?? oneLineReason(row)}
                      </span>
                    </ReasonHover>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.SoC == null ? "—" : formatPct(row.SoC)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.SoH == null ? "—" : formatPct(row.SoH)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.R_int_mOhm == null ? "—" : formatScore(row.R_int_mOhm)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.assigned_vehicle_id ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No packs match this filter.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
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
