"use client";

import { useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

import {
  AssignmentDetailSheet,
  type DetailSelection,
} from "@/components/dashboard/assignment-detail-sheet";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AssignmentRow, DrillFilter } from "@/lib/metrics";
import { formatPct, formatScore } from "@/lib/metrics";
import { downloadCsv } from "@/lib/csv-export";
import { shortStatus } from "@/lib/safety-gates";
import { prefersReducedMotion } from "@/motion/use-dashboard-motion";
import type { ResultsScreen } from "@/components/dashboard/results-nav";
import { cn } from "@/lib/utils";

type FilterMode = "all" | "served" | "unserved";
const PAGE = 25;

type AssignmentsTableProps = {
  proposed?: AssignmentRow[];
  hsf?: AssignmentRow[];
  unlocked: boolean;
  drillFilter?: DrillFilter;
  onNavigate?: (screen: ResultsScreen, filter?: DrillFilter) => void;
};

function filterRows(rows: AssignmentRow[], mode: FilterMode): AssignmentRow[] {
  if (mode === "served") return rows.filter((r) => r.served);
  if (mode === "unserved") return rows.filter((r) => !r.served);
  return rows;
}

export function AssignmentsTable({
  proposed,
  hsf,
  unlocked,
  drillFilter,
  onNavigate,
}: AssignmentsTableProps) {
  const root = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<FilterMode>(
    drillFilter?.served ?? "served"
  );
  const [policy, setPolicy] = useState<"Proposed" | "HSF">("Proposed");
  const [showScoreColumns, setShowScoreColumns] = useState(false);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<DetailSelection | null>(null);

  // A drill-in from another panel overrides the local filter, but only on the
  // edge where it changes — otherwise the user could never filter back out.
  // Adjusting during render is React's documented alternative to a setState
  // effect here, and it avoids the extra render pass an effect would cost.
  const [lastDrill, setLastDrill] = useState(drillFilter?.served);
  if (drillFilter?.served !== lastDrill) {
    setLastDrill(drillFilter?.served);
    if (drillFilter?.served) setFilter(drillFilter.served);
  }

  const source = useMemo(
    () => (policy === "Proposed" ? (proposed ?? []) : (hsf ?? [])),
    [policy, proposed, hsf]
  );
  const hsfByVehicle = useMemo(() => {
    const m = new Map<string, AssignmentRow>();
    for (const r of hsf ?? []) m.set(r.vehicle_id, r);
    return m;
  }, [hsf]);
  const proposedByVehicle = useMemo(() => {
    const m = new Map<string, AssignmentRow>();
    for (const r of proposed ?? []) m.set(r.vehicle_id, r);
    return m;
  }, [proposed]);
  // Read the drill-in fields once, so what the memo closes over and what its
  // dependency list names are the same expressions.
  const focusVehicleId = drillFilter?.focusVehicleId;
  const focusPriority = drillFilter?.priority;
  const filtered = useMemo(() => {
    let rows = filterRows(source, filter);
    if (focusVehicleId) {
      rows = rows.filter((r) => r.vehicle_id === focusVehicleId);
    }
    if (focusPriority) {
      rows = rows.filter((r) => r.priority === focusPriority);
    }
    return rows;
  }, [source, filter, focusVehicleId, focusPriority]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageSafe = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(pageSafe * PAGE, pageSafe * PAGE + PAGE);
  const colSpan = showScoreColumns ? 9 : 6;

  useGSAP(
    () => {
      if (!root.current || prefersReducedMotion() || !unlocked) return;
      gsap.from(root.current.querySelectorAll("tbody tr"), {
        opacity: 0,
        y: 8,
        stagger: 0.03,
        duration: 0.35,
        ease: "power2.out",
      });
    },
    {
      scope: root,
      dependencies: [unlocked, filter, policy, pageSafe, pageRows[0]?.vehicle_id],
    }
  );

  if (!unlocked) {
    return (
      <Card className="shadow-none" data-screen="assign">
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
          <CardDescription>Locked until a dispatch run completes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div ref={root} data-screen="assign" className="space-y-4">
      <ZoneSection
        title="Assignments"
        description={`Click a row for detail. ${filtered.length} matches · page size ${PAGE}.`}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv(
                "assignments-proposed.csv",
                filterRows(proposed ?? [], filter).map((r) => ({
                  vehicle_id: r.vehicle_id,
                  priority: r.priority,
                  served: r.served,
                  battery_id: r.battery_id ?? "",
                  status: r.status ?? "",
                  SoC: r.SoC ?? "",
                  SoH: r.SoH ?? "",
                  BSS: r.BSS ?? "",
                  T_score: r.T_score ?? "",
                  R_int_mOhm: r.R_int_mOhm ?? "",
                }))
              )
            }
          >
            Export CSV
          </Button>
        }
      >
      <Card className="shadow-none">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["all", "served", "unserved"] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="xs"
                variant={filter === mode ? "default" : "outline"}
                onClick={() => {
                  setFilter(mode);
                  setPage(0);
                }}
                className={cn(filter !== mode && "text-muted-foreground")}
              >
                {mode}
              </Button>
            ))}
            {drillFilter?.priority ? (
              <span className="inline-flex items-center gap-1 border border-border px-2 py-1 text-xs">
                Priority: {drillFilter.priority}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={policy}
            onValueChange={(v) => {
              setPolicy(v as "Proposed" | "HSF");
              setPage(0);
            }}
          >
            <TabsList>
              <TabsTrigger value="Proposed">Proposed</TabsTrigger>
              <TabsTrigger value="HSF">HSF</TabsTrigger>
            </TabsList>
            <TabsContent value={policy} className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Battery</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>SoC</TableHead>
                    <TableHead>BSS</TableHead>
                    {showScoreColumns ? (
                      <>
                        <TableHead>SoH</TableHead>
                        <TableHead>T</TableHead>
                        <TableHead>R_int</TableHead>
                      </>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => {
                    const proposedRow =
                      policy === "Proposed"
                        ? row
                        : proposedByVehicle.get(row.vehicle_id);
                    const hsfRow =
                      policy === "HSF"
                        ? row
                        : hsfByVehicle.get(row.vehicle_id);
                    return (
                    <TableRow
                      key={`${row.vehicle_id}-${row.battery_id ?? "none"}`}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                      onClick={() =>
                        setSelection({
                          kind: "assignment",
                          row: proposedRow ?? row,
                          hsf: hsfRow,
                        })
                      }
                    >
                      <TableCell className="font-medium">
                        {row.vehicle_id}
                      </TableCell>
                      <TableCell>{row.priority}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <ReasonHover
                          pack={row}
                          vehicleId={row.vehicle_id}
                          priority={row.priority}
                          proposed={proposedRow}
                          hsf={hsfRow}
                        >
                          <span className="underline-offset-2 hover:underline">
                            {row.battery_id ?? "—"}
                          </span>
                        </ReasonHover>
                        {policy === "Proposed" && hsfRow?.battery_id ? (
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            HSF → {hsfRow.battery_id}
                            {hsfRow.status?.includes("Quarantine")
                              ? " · unsafe"
                              : ""}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs">
                        <ReasonHover pack={row}>
                          <span
                            className={cn(
                              "inline-block border px-1.5 py-0.5 text-[10px] font-semibold",
                              (row.status ?? "").includes("Safe") &&
                                "border-[var(--positive)] text-[var(--positive)]",
                              (row.status ?? "").includes("Degraded") &&
                                "border-[var(--warning)]",
                              (row.status ?? "").includes("Quarantine") &&
                                "border-[var(--negative)] bg-[var(--negative)] text-white"
                            )}
                          >
                            {shortStatus(row.status) ||
                              (row.served ? "served" : "unserved")}
                          </span>
                        </ReasonHover>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.SoC == null ? "—" : formatPct(row.SoC)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.BSS == null ? "—" : formatScore(row.BSS)}
                      </TableCell>
                      {showScoreColumns ? (
                        <>
                          <TableCell className="tabular-nums">
                            {row.SoH == null ? "—" : formatPct(row.SoH)}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {row.T_score == null
                              ? "—"
                              : formatScore(row.T_score)}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {row.R_int_mOhm == null
                              ? "—"
                              : formatScore(row.R_int_mOhm)}
                          </TableCell>
                        </>
                      ) : null}
                    </TableRow>
                    );
                  })}
                  {pageRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={colSpan}
                        className="text-muted-foreground"
                      >
                        No assignments match this filter.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowScoreColumns((v) => !v)}
              >
                Score columns {showScoreColumns ? "(hide)" : "(show)"}
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                Page {pageSafe + 1} / {pageCount}
              </span>
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
      </ZoneSection>

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
