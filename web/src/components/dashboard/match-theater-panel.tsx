"use client";

import { useCallback, useMemo, useState } from "react";

import {
  AssignmentDetailSheet,
  type DetailSelection,
} from "@/components/dashboard/assignment-detail-sheet";
import { BipartiteLattice } from "@/components/dashboard/bipartite-lattice";
import { ReasonHover } from "@/components/dashboard/reason-hover";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ResultsScreen } from "@/components/dashboard/results-nav";
import type { AssignmentRow, DrillFilter, FleetBattery } from "@/lib/metrics";
import { formatPct } from "@/lib/metrics";
import { shortStatus } from "@/lib/safety-gates";
import {
  orderAssignments,
  useAssignTheater,
} from "@/motion/use-assign-theater";
import { cn } from "@/lib/utils";

const PRIORITY_GROUPS = ["Critical", "High", "Medium", "Low"] as const;

type MatchTheaterPanelProps = {
  fleet: FleetBattery[];
  proposed: AssignmentRow[];
  hsf?: AssignmentRow[];
  autoPlayKey: number;
  onNavigate?: (screen: ResultsScreen, filter?: DrillFilter) => void;
};

export function MatchTheaterPanel({
  fleet,
  proposed,
  hsf = [],
  autoPlayKey,
  onNavigate,
}: MatchTheaterPanelProps) {
  const [policy, setPolicy] = useState<"Proposed" | "HSF">("Proposed");
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState({ assigned: 0, total: 0 });
  const [selection, setSelection] = useState<DetailSelection | null>(null);
  const [replayKey, setReplayKey] = useState(0);
  const [currentDeal, setCurrentDeal] = useState<AssignmentRow | null>(null);
  const [committedIds, setCommittedIds] = useState<Set<string>>(new Set());
  const [showUnused, setShowUnused] = useState(false);
  const [ledgerQuery, setLedgerQuery] = useState("");

  const assignments = policy === "Proposed" ? proposed : hsf;

  const hsfByVehicle = useMemo(() => {
    const m = new Map<string, AssignmentRow>();
    for (const r of hsf) m.set(r.vehicle_id, r);
    return m;
  }, [hsf]);
  const proposedByVehicle = useMemo(() => {
    const m = new Map<string, AssignmentRow>();
    for (const r of proposed) m.set(r.vehicle_id, r);
    return m;
  }, [proposed]);

  const fleetById = useMemo(() => {
    const m = new Map<string, FleetBattery>();
    for (const b of fleet) m.set(b.battery_id, b);
    return m;
  }, [fleet]);

  const pool = useMemo(() => {
    const safe = fleet.filter((b) => b.status === "Safe and Available").length;
    const degraded = fleet.filter(
      (b) => b.status === "Degraded but Usable"
    ).length;
    const quarantine = fleet.filter(
      (b) => b.status === "Unsafe / Quarantine"
    ).length;
    return { safe, degraded, quarantine, total: fleet.length };
  }, [fleet]);

  const assignedPackIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of assignments) {
      if (r.served && r.battery_id) s.add(r.battery_id);
    }
    return s;
  }, [assignments]);

  const unusedPacks = useMemo(
    () => fleet.filter((b) => !assignedPackIds.has(b.battery_id)),
    [fleet, assignedPackIds]
  );

  const onProgress = useCallback((assigned: number, total: number) => {
    setProgress({ assigned, total });
  }, []);

  const onStep = useCallback(
    (row: AssignmentRow | null, index: number) => {
      if (row == null || index < 0) {
        setCurrentDeal(null);
        setCommittedIds(new Set());
        return;
      }
      setCurrentDeal(row);
      setCommittedIds(
        new Set(
          orderAssignments(assignments)
            .slice(0, index + 1)
            .map((r) => r.vehicle_id)
        )
      );
    },
    [assignments]
  );

  const { pause, resume, ordered } = useAssignTheater({
    assignments,
    autoPlayKey: autoPlayKey + replayKey + (policy === "HSF" ? 1000 : 0),
    speed,
    enabled: assignments.length > 0 || fleet.length > 0,
    onProgress,
    onStep,
  });

  const dealPack = currentDeal?.battery_id
    ? fleetById.get(currentDeal.battery_id)
    : undefined;

  const ledgerRows = useMemo(() => {
    const q = ledgerQuery.trim().toLowerCase();
    return ordered.filter((r) => {
      if (!q) return true;
      return (
        r.vehicle_id.toLowerCase().includes(q) ||
        (r.battery_id ?? "").toLowerCase().includes(q) ||
        r.priority.toLowerCase().includes(q)
      );
    });
  }, [ordered, ledgerQuery]);

  const groupedLedger = useMemo(() => {
    const groups: Record<string, AssignmentRow[]> = {};
    for (const p of PRIORITY_GROUPS) groups[p] = [];
    for (const r of ledgerRows) {
      const key = PRIORITY_GROUPS.includes(
        r.priority as (typeof PRIORITY_GROUPS)[number]
      )
        ? r.priority
        : "Low";
      groups[key].push(r);
    }
    return groups;
  }, [ledgerRows]);

  const focusPair = (row: AssignmentRow) => {
    setCurrentDeal(row);
    const proposedRow =
      policy === "Proposed" ? row : proposedByVehicle.get(row.vehicle_id);
    const hsfRow = policy === "HSF" ? row : hsfByVehicle.get(row.vehicle_id);
    setSelection({
      kind: "assignment",
      row: proposedRow ?? row,
      hsf: hsfRow,
    });
  };

  return (
    <div data-screen="match" className="space-y-4">
      <BipartiteLattice
        fleet={fleet}
        proposed={proposed}
        onSelectVehicle={(row) =>
          setSelection({
            kind: "assignment",
            row: proposedByVehicle.get(row.vehicle_id) ?? row,
            hsf: hsfByVehicle.get(row.vehicle_id),
          })
        }
      />

      <Card className="shadow-none">
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Matching</CardTitle>
            <CardDescription>
              One request. One pack. Watch the deal — then read the ledger.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={policy === "Proposed" ? "default" : "outline"}
              onClick={() => {
                setPolicy("Proposed");
                setPaused(false);
                setCommittedIds(new Set());
                setCurrentDeal(null);
              }}
            >
              Proposed
            </Button>
            <Button
              type="button"
              size="sm"
              variant={policy === "HSF" ? "default" : "outline"}
              onClick={() => {
                setPolicy("HSF");
                setPaused(false);
                setCommittedIds(new Set());
                setCurrentDeal(null);
              }}
            >
              HSF
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Pool strip */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {(
              [
                {
                  label: "Safe",
                  count: pool.safe,
                  status: "Safe and Available",
                  tone: "text-[var(--positive)]",
                },
                {
                  label: "Degraded",
                  count: pool.degraded,
                  status: "Degraded but Usable",
                  tone: "text-foreground",
                },
                {
                  label: "Quarantine",
                  count: pool.quarantine,
                  status: "Unsafe / Quarantine",
                  tone: "text-[var(--negative)]",
                },
              ] as const
            ).map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() =>
                  onNavigate?.("fleet", { status: p.status })
                }
                className="border border-border px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="text-xs text-muted-foreground">{p.label} pool</p>
                <p className={cn("text-2xl font-semibold tabular-nums", p.tone)}>
                  {p.count}
                </p>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setPaused(false);
                setCommittedIds(new Set());
                setCurrentDeal(null);
                setReplayKey((k) => k + 1);
              }}
            >
              Replay deals
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (paused) {
                  resume();
                  setPaused(false);
                } else {
                  pause();
                  setPaused(true);
                }
              }}
            >
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={speed === 1 ? "default" : "outline"}
              onClick={() => setSpeed(1)}
            >
              1×
            </Button>
            <Button
              type="button"
              size="sm"
              variant={speed === 2 ? "default" : "outline"}
              onClick={() => setSpeed(2)}
            >
              2×
            </Button>
            <p className="text-xs text-muted-foreground tabular-nums sm:ml-auto">
              Dealt {progress.assigned} / {progress.total || ordered.length}
              {currentDeal ? ` · now ${currentDeal.priority}` : ""}
            </p>
          </div>

          {/* Deal stage */}
          <div
            className="border border-border bg-muted/20 px-4 py-6 sm:px-8"
            aria-live="polite"
          >
            {currentDeal ? (
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6">
                <ReasonHover
                  pack={currentDeal}
                  vehicleId={currentDeal.vehicle_id}
                  priority={currentDeal.priority}
                  proposed={
                    policy === "Proposed"
                      ? currentDeal
                      : proposedByVehicle.get(currentDeal.vehicle_id)
                  }
                  hsf={
                    policy === "HSF"
                      ? currentDeal
                      : hsfByVehicle.get(currentDeal.vehicle_id)
                  }
                >
                  <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                <button
                  type="button"
                  onClick={() => focusPair(currentDeal)}
                  className="w-full max-w-[14rem] border border-foreground bg-background px-4 py-4 text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--uber-accent)] sm:w-auto"
                >
                  <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    Request · {currentDeal.priority}
                  </p>
                  <p className="mt-1 font-mono text-xl font-semibold">
                    {currentDeal.vehicle_id}
                  </p>
                </button>
                <span
                  className="text-2xl font-semibold text-muted-foreground"
                  aria-hidden
                >
                  →
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (dealPack) {
                      setSelection({ kind: "fleet", battery: dealPack });
                    } else {
                      focusPair(currentDeal);
                    }
                  }}
                  className="w-full max-w-[14rem] border border-foreground bg-foreground px-4 py-4 text-left text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--uber-accent)] sm:w-auto"
                >
                  <p className="text-[10px] font-semibold tracking-[0.14em] uppercase opacity-70">
                    Pack · {shortStatus(currentDeal.status)}
                  </p>
                  <p className="mt-1 font-mono text-xl font-semibold">
                    {currentDeal.battery_id ?? "—"}
                  </p>
                  <p className="mt-1 text-sm tabular-nums opacity-80">
                    SoH{" "}
                    {currentDeal.SoH == null
                      ? "—"
                      : formatPct(currentDeal.SoH)}
                  </p>
                </button>
                  </div>
                </ReasonHover>
              </div>
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                {ordered.length === 0
                  ? "No served assignments for this policy."
                  : "Replay deals to watch each request claim a pack — or pick a ledger row."}
              </p>
            )}
          </div>

          {/* Unused packs tuck */}
          <div className="space-y-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowUnused((v) => !v)}
            >
              {showUnused ? "Hide" : "Show"} unused packs ({unusedPacks.length})
            </Button>
            {showUnused ? (
              <div className="flex flex-wrap gap-1 border border-border p-2">
                {unusedPacks.slice(0, 80).map((bat) => (
                  <button
                    key={bat.battery_id}
                    type="button"
                    title={`${bat.battery_id} · ${bat.status}`}
                    onClick={() =>
                      setSelection({ kind: "fleet", battery: bat })
                    }
                    className={cn(
                      "h-3 w-3 rounded-[2px]",
                      bat.status === "Safe and Available" &&
                        "bg-[var(--positive)]",
                      bat.status === "Degraded but Usable" &&
                        "bg-[var(--warning)]",
                      bat.status === "Unsafe / Quarantine" &&
                        "bg-[var(--negative)] opacity-50"
                    )}
                  />
                ))}
                {unusedPacks.length > 80 ? (
                  <span className="text-xs text-muted-foreground">
                    +{unusedPacks.length - 80} more — open Fleet
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Pair ledger */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Pair ledger</h3>
                <p className="text-xs text-muted-foreground">
                  {ordered.length} deals · Critical first · click a row for
                  detail
                </p>
              </div>
              <input
                value={ledgerQuery}
                onChange={(e) => setLedgerQuery(e.target.value)}
                placeholder="Search vehicle / pack…"
                className="h-9 w-full max-w-xs border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
                aria-label="Search pair ledger"
              />
            </div>

            <div className="max-h-[28rem] space-y-4 overflow-y-auto border border-border p-3">
              {PRIORITY_GROUPS.map((priority) => {
                const rows = groupedLedger[priority] ?? [];
                if (rows.length === 0) return null;
                return (
                  <div key={priority} className="space-y-1.5">
                    <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                      {priority} · {rows.length}
                    </p>
                    <ul className="space-y-1">
                      {rows.map((row) => {
                        const committed = committedIds.has(row.vehicle_id);
                        const active =
                          currentDeal?.vehicle_id === row.vehicle_id;
                        const proposedRow =
                          policy === "Proposed"
                            ? row
                            : proposedByVehicle.get(row.vehicle_id);
                        const hsfRow =
                          policy === "HSF"
                            ? row
                            : hsfByVehicle.get(row.vehicle_id);
                        return (
                          <li key={row.vehicle_id}>
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => focusPair(row)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  focusPair(row);
                                }
                              }}
                              className={cn(
                                "flex w-full cursor-pointer items-center gap-2 border px-2 py-2 text-left text-sm transition-colors",
                                active
                                  ? "border-foreground bg-foreground text-background"
                                  : committed
                                    ? "border-border bg-background hover:bg-muted/40"
                                    : "border-transparent opacity-35 hover:opacity-60"
                              )}
                            >
                              <span className="w-20 shrink-0 font-mono text-xs">
                                {row.vehicle_id}
                              </span>
                              <span className="text-muted-foreground" aria-hidden>
                                →
                              </span>
                              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                {row.battery_id ?? "—"}
                              </span>
                              <span className="shrink-0 tabular-nums text-xs opacity-80">
                                {row.SoH == null ? "—" : formatPct(row.SoH)}
                              </span>
                              <ReasonHover
                                pack={row}
                                vehicleId={row.vehicle_id}
                                priority={row.priority}
                                proposed={proposedRow}
                                hsf={hsfRow}
                              >
                                <span className="hidden shrink-0 border px-1 py-0.5 text-[10px] opacity-90 sm:inline">
                                  {shortStatus(row.status)}
                                </span>
                              </ReasonHover>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
              {ledgerRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pairs match this search.
                </p>
              ) : null}
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
