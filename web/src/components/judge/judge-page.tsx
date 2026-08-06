"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DispatchTimeline } from "@/components/dashboard/dispatch-timeline";
import { GateChecklist } from "@/components/dashboard/gate-checklist";
import { GlossaryStrip, Term, TermProvider } from "@/components/terms/term";
import { UploadPanel } from "@/components/upload/upload-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CsvValidation } from "@/lib/csv-validate";
import {
  EMPTY_METRICS,
  deriveFlowPhase,
  formatPct,
  formatScore,
  servedLabel,
  type AssignmentRow,
  type FleetBattery,
  type MetricsResponse,
} from "@/lib/metrics";
import {
  buildGateChecklist,
  gatesFromConfig,
  oneLineReason,
  reasonLabel,
  shortStatus,
} from "@/lib/safety-gates";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  "Safe and Available": "var(--health-safe)",
  "Degraded but Usable": "var(--health-degraded)",
  "Unsafe / Quarantine": "var(--health-unsafe)",
};

function LockedBlock({ label }: { label: string }) {
  return (
    <div className="border border-dashed border-border px-4 py-10 text-center">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Upload both CSVs and run — nothing is painted until then.
      </p>
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
  className,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24 space-y-4", className)}>
      <header className="space-y-1">
        {eyebrow ? (
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </header>
      {children}
    </section>
  );
}

export function JudgePage() {
  const [metrics, setMetrics] = useState<MetricsResponse>(EMPTY_METRICS);
  const [runCompleted, setRunCompleted] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [batteries, setBatteries] = useState<File | null>(null);
  const [vehicles, setVehicles] = useState<File | null>(null);
  const [batteryValidation, setBatteryValidation] =
    useState<CsvValidation | null>(null);
  const [vehicleValidation, setVehicleValidation] =
    useState<CsvValidation | null>(null);
  const [selectedPack, setSelectedPack] = useState<FleetBattery | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const canRunUpload = Boolean(
    batteries && vehicles && batteryValidation?.ok && vehicleValidation?.ok
  );
  const hasAnyFile = Boolean(batteries || vehicles);
  const phase = deriveFlowPhase({
    running,
    runCompleted,
    hasAnyFile,
    canRunUpload,
  });
  const locked = phase !== "results";

  const stopProgress = useCallback(() => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }, []);

  const startProgress = useCallback(() => {
    stopProgress();
    setProgress(8);
    progressTimer.current = setInterval(() => {
      setProgress((p) => (p >= 92 ? p : p + Math.random() * 8 + 2));
    }, 350);
  }, [stopProgress]);

  const applyPayload = useCallback((data: MetricsResponse) => {
    setMetrics(data);
    if (data.error && !data.comparison) {
      setRunCompleted(false);
      setError(
        `${data.error}${data.detail ? ` — ${data.detail.slice(0, 220)}` : ""}`
      );
    } else if (data.comparison) {
      setError(null);
      setRunCompleted(true);
      const firstQ = (data.fleet ?? []).find((b) =>
        b.status.includes("Quarantine")
      );
      setSelectedPack(firstQ ?? data.fleet?.[0] ?? null);
    }
  }, []);

  const runSimulation = useCallback(async () => {
    if (!canRunUpload || !batteries || !vehicles) {
      setError("Add two valid CSV files before running.");
      return;
    }
    setRunning(true);
    setError(null);
    startProgress();
    try {
      const form = new FormData();
      form.append("batteries", batteries);
      form.append("vehicles", vehicles);
      const res = await fetch("/api/simulate", { method: "POST", body: form });
      const data = (await res.json()) as MetricsResponse;
      if (!res.ok && !data.comparison) {
        throw new Error(data.error ?? `Simulate API ${res.status}`);
      }
      setProgress(100);
      applyPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
      setRunCompleted(false);
    } finally {
      stopProgress();
      setTimeout(() => setProgress(0), 600);
      setRunning(false);
    }
  }, [
    applyPayload,
    batteries,
    canRunUpload,
    startProgress,
    stopProgress,
    vehicles,
  ]);

  // Cold start is already empty from the initial state above; this only has to
  // stop the progress ticker when the page unmounts mid-run.
  useEffect(() => stopProgress, [stopProgress]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      new URLSearchParams(window.location.search).get("resume") !== "1"
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/metrics?resume=1");
        const data = (await res.json()) as MetricsResponse;
        if (cancelled || !data.comparison) return;
        applyPayload(data);
      } catch {
        /* empty is valid */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyPayload]);

  const proposed = metrics.comparison?.Proposed ?? null;
  const hsf = metrics.comparison?.HSF ?? null;
  const classification = metrics.classification;
  // `?? []` mints a fresh array on every render, which would invalidate every
  // memo below it. Hoist the raw values, then default once behind a memo.
  const fleetSource = metrics.fleet;
  const proposedSource = metrics.assignments?.Proposed;
  const hsfSource = metrics.assignments?.HSF;
  const fleet = useMemo(() => fleetSource ?? [], [fleetSource]);
  const assignments = useMemo(() => proposedSource ?? [], [proposedSource]);
  const hsfAssign = useMemo(() => hsfSource ?? [], [hsfSource]);

  const quarantinePacks = useMemo(
    () => fleet.filter((b) => b.status.includes("Quarantine")),
    [fleet]
  );

  const reasonRows = useMemo(() => {
    const q = classification?.quarantine_reasons ?? {};
    return Object.entries(q)
      .map(([code, count]) => ({
        code,
        count,
        // The solver ships its own code→sentence map, so a new gate rule
        // explains itself in the UI without a matching code edit here.
        label: reasonLabel(code, classification?.reason_text),
      }))
      .sort((a, b) => b.count - a.count);
  }, [classification]);

  const classChart = useMemo(() => {
    if (!classification) return [];
    return Object.entries(classification.counts).map(([name, count]) => ({
      name: name.replace(" / ", " · "),
      count,
      fill: STATUS_COLOR[name] ?? "var(--muted-foreground)",
    }));
  }, [classification]);

  const priorityChart = useMemo(() => {
    const order = ["Critical", "High", "Medium", "Low"];
    const buckets = new Map<string, { priority: string; served: number; total: number }>();
    for (const p of order) buckets.set(p, { priority: p, served: 0, total: 0 });
    for (const row of assignments) {
      const key = row.priority in buckets ? row.priority : "Medium";
      const b = buckets.get(key)!;
      b.total += 1;
      if (row.served) b.served += 1;
    }
    return [...buckets.values()];
  }, [assignments]);

  const compareChart = useMemo(() => {
    if (!proposed || !hsf) return [];
    return [
      {
        metric: "Unsafe allocations",
        Proposed: proposed.unsafe_allocations,
        HSF: hsf.unsafe_allocations,
      },
      {
        metric: "Avg SoH (%)",
        Proposed: Number(proposed.avg_soh_allocated.toFixed(1)),
        HSF: Number(hsf.avg_soh_allocated.toFixed(1)),
      },
      {
        metric: "Avg BSS",
        Proposed: Number(proposed.avg_bss_allocated.toFixed(1)),
        HSF: Number(hsf.avg_bss_allocated.toFixed(1)),
      },
    ];
  }, [proposed, hsf]);

  const hsfByVehicle = useMemo(() => {
    const m = new Map<string, AssignmentRow>();
    for (const r of hsfAssign) m.set(r.vehicle_id, r);
    return m;
  }, [hsfAssign]);

  const gatePack = selectedPack;
  // Bands come from the solver's own config, never from a constant in the UI.
  const gateRows = gatePack
    ? buildGateChecklist(gatePack, gatesFromConfig(metrics.config?.thresholds))
    : [];

  return (
    <TermProvider>
      <div className="flex min-h-full flex-1 flex-col">
        <header className="border-b border-border/80">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Siemens Energy · ASME Brain Bolt 2026 · Problem Statement 2 Part 1
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                BSS Dispatch
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground leading-relaxed">
                Battery Health Assessment and Dynamic Allocation for Light EVs —
                classify every pack, score suitability, allocate safely, and beat{" "}
                <Term of="HSF" mode="expand" />.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary">
                  {locked ? "No run yet" : metrics.source}
                </Badge>
                {!locked && proposed ? (
                  <Badge
                    variant={
                      proposed.unsafe_allocations === 0 ? "default" : "destructive"
                    }
                  >
                    Unsafe allocations: {proposed.unsafe_allocations}
                  </Badge>
                ) : (
                  <Badge variant="outline">Unsafe allocations: —</Badge>
                )}
                {!locked && metrics.n_batteries != null ? (
                  <Badge variant="outline">
                    {metrics.n_batteries} packs · {metrics.n_vehicles} requests
                  </Badge>
                ) : null}
                <Link
                  href="/lab"
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Deep-dive lab
                </Link>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-56">
              <Button
                onClick={() => void runSimulation()}
                disabled={running || !canRunUpload}
                className="w-full"
                style={{ opacity: canRunUpload ? 1 : 0.45 }}
              >
                {running ? "Running…" : locked ? "Run on uploads" : "Re-run"}
              </Button>
              {running ? (
                <Progress value={Math.max(12, progress)} className="h-1.5" />
              ) : null}
            </div>
          </div>
        </header>

        <GlossaryStrip />

        <main
          data-phase={phase}
          className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-8 sm:px-6"
        >
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Run failed</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{error}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={running}
                  onClick={() => void runSimulation()}
                >
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <Section
            id="run"
            eyebrow="Step 0"
            title="Upload fleet data and run"
          >
            <UploadPanel
              batteries={batteries}
              vehicles={vehicles}
              batteryValidation={batteryValidation}
              vehicleValidation={vehicleValidation}
              dimmed={phase === "running"}
              onBatteries={(file, validation) => {
                setBatteries(file);
                setBatteryValidation(validation);
              }}
              onVehicles={(file, validation) => {
                setVehicles(file);
                setVehicleValidation(validation);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Tip: append <span className="font-mono">?resume=1</span> to reload
              the last successful run without re-uploading.
            </p>
          </Section>

          <Section
            id="kpis"
            eyebrow="Mandatory outputs"
            title="Proposed method versus Highest-SoC-First"
          >
            {locked || !proposed || !hsf ? (
              <LockedBlock label="Key performance indicators locked" />
            ) : (
              <div
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                data-motion="kpis"
              >
                {[
                  {
                    label: "Successfully served vehicles",
                    value: servedLabel(proposed),
                    hint: `HSF ${servedLabel(hsf)}`,
                  },
                  {
                    label: "Unserved vehicles",
                    value: String(proposed.unserved),
                    hint: `HSF ${hsf.unserved}`,
                  },
                  {
                    label: "High & Critical priority served",
                    value: formatPct(proposed.high_critical_served_pct),
                    hint: `HSF ${formatPct(hsf.high_critical_served_pct)}`,
                  },
                  {
                    label: "Unsafe battery allocations",
                    value: String(proposed.unsafe_allocations),
                    hint: `HSF ${hsf.unsafe_allocations}`,
                    good: proposed.unsafe_allocations === 0,
                  },
                  {
                    label: "Average State of Health of allocated packs",
                    value: formatPct(proposed.avg_soh_allocated),
                    hint: `HSF ${formatPct(hsf.avg_soh_allocated)}`,
                  },
                  {
                    label: "Average Battery Suitability Score of allocated packs",
                    value: formatScore(proposed.avg_bss_allocated),
                    hint: `HSF ${formatScore(hsf.avg_bss_allocated)}`,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="border border-border bg-card px-4 py-3"
                  >
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {item.label}
                    </p>
                    <p
                      data-numeric
                      className={cn(
                        "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
                        "good" in item && item.good
                          ? "text-[var(--health-safe)]"
                          : "text-foreground"
                      )}
                    >
                      {item.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.hint}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {!locked && proposed && hsf && proposed.unsafe_allocations === 0 && hsf.unsafe_allocations > 0 ? (
              <p className="text-sm leading-relaxed text-foreground">
                Both policies serve every request.{" "}
                <Term of="HSF" mode="abbr" /> does it by handing out{" "}
                <strong>{hsf.unsafe_allocations}</strong> quarantined packs.
                The proposed method serves the same demand with{" "}
                <strong>zero</strong> unsafe allocations and higher average{" "}
                <Term of="SoH" mode="abbr" />.
              </p>
            ) : null}
          </Section>

          <Section
            id="classify"
            eyebrow="Stages 1–2"
            title="Classify every pack — Safe, Degraded, or Quarantine"
          >
            {locked || !classification ? (
              <LockedBlock label="Classification locked" />
            ) : (
              <div className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-3">
                  {Object.entries(classification.counts).map(([status, count]) => (
                    <div
                      key={status}
                      className="border border-border px-4 py-3"
                      style={{
                        borderLeftWidth: 3,
                        borderLeftColor: STATUS_COLOR[status],
                      }}
                    >
                      <p className="text-xs text-muted-foreground">{status}</p>
                      <p
                        data-numeric
                        className="mt-1 text-2xl font-semibold tabular-nums"
                      >
                        {count}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatPct(classification.pct[status] ?? 0)} of fleet
                      </p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">
                      Exact quarantine reasons
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Every Unsafe / Quarantine pack carries a machine reason
                      code and a full-English explanation. These packs never
                      enter the solver&apos;s edge set, so safety is structural
                      rather than weighted — no objective can trade a violation
                      away. Note the top three reasons are not health readings:
                      a station declaration, and two packs contradicting their
                      own telemetry.
                    </p>
                    <ul className="space-y-2">
                      {reasonRows.map((r) => (
                        <li
                          key={r.code}
                          className="border border-border px-3 py-2"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-xs text-[var(--uber-accent)]">
                              {r.code}
                            </span>
                            <span
                              data-numeric
                              className="text-sm font-semibold tabular-nums"
                            >
                              {r.count}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-snug text-muted-foreground">
                            {r.label}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">
                      Why this pack is blocked — gate checklist
                    </h3>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {quarantinePacks.slice(0, 40).map((b) => (
                        <button
                          key={b.battery_id}
                          type="button"
                          onClick={() => setSelectedPack(b)}
                          className={cn(
                            "border px-2 py-1 font-mono text-[10px]",
                            selectedPack?.battery_id === b.battery_id
                              ? "border-[var(--uber-accent)] bg-[var(--uber-accent)]/10 text-foreground"
                              : "border-border text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {b.battery_id}
                        </button>
                      ))}
                    </div>
                    {gatePack ? (
                      <div className="border border-border p-3 space-y-3">
                        <div>
                          <p className="text-sm font-semibold">
                            {gatePack.battery_id} · {gatePack.status}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {oneLineReason(gatePack)}
                          </p>
                          {gatePack.quarantine_reason ? (
                            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                              {gatePack.quarantine_reason} ·{" "}
                              {reasonLabel(
                                gatePack.quarantine_reason,
                                classification?.reason_text
                              )}
                            </p>
                          ) : null}
                        </div>
                        <GateChecklist rows={gateRows} />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </Section>

          <Section
            id="score"
            eyebrow="Stage 3"
            title="Battery Suitability Score from four health parameters"
          >
            {locked ? (
              <LockedBlock label="Scoring locked" />
            ) : (
              <div className="space-y-3 border border-border px-4 py-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  The <Term of="BSS" mode="expand" /> is a 0–100 score over four
                  health dimensions — capacity, power, cell balance and thermal
                  margin — drawn from <Term of="SoH" mode="expand" />,{" "}
                  <Term of="R_int" mode="expand" />,{" "}
                  <Term of="dV" mode="expand" /> and{" "}
                  <Term of="T" mode="expand" />. The four are combined as a{" "}
                  <strong>geometric mean</strong>, not a weighted sum: an
                  average would let a 99% health pack with a collapsing cell
                  spread outrank a balanced one, which is the opposite of what a
                  dispatcher wants. The geometric mean pulls the score toward
                  the worst dimension, so one severe weakness cannot be averaged
                  away. Only Safe and Degraded packs are scored for dispatch;
                  Quarantine packs never enter the match path.
                </p>
                {proposed ? (
                  <p className="text-sm">
                    Allocated average BSS:{" "}
                    <span data-numeric className="font-semibold tabular-nums">
                      {formatScore(proposed.avg_bss_allocated)}
                    </span>{" "}
                    vs HSF{" "}
                    <span data-numeric className="tabular-nums">
                      {formatScore(hsf!.avg_bss_allocated)}
                    </span>
                  </p>
                ) : null}
              </div>
            )}
          </Section>

          <Section
            id="assign"
            eyebrow="Stage 4"
            title="Assignments — one pack per vehicle, reasons always visible"
          >
            {locked || assignments.length === 0 ? (
              <LockedBlock label="Assignments locked" />
            ) : (
              <div className="overflow-x-auto border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Battery</TableHead>
                      <TableHead>
                        <Term of="SoC" mode="abbr" /> vs min
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <Term of="BSS" mode="abbr" />
                      </TableHead>
                      <TableHead className="min-w-[14rem]">Reason</TableHead>
                      <TableHead>
                        <Term of="HSF" mode="abbr" /> twin
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((row) => {
                      const twin = hsfByVehicle.get(row.vehicle_id);
                      const reason = oneLineReason({
                        status: row.status,
                        SoC: row.SoC,
                        SoH: row.SoH,
                        T: row.T,
                        R_int_mOhm: row.R_int_mOhm,
                        dV_cell_mV: row.dV_cell_mV,
                        quarantine_reason: row.quarantine_reason,
                        BSS: row.BSS,
                        min_SoC: row.min_SoC,
                      });
                      return (
                        <TableRow key={row.vehicle_id}>
                          <TableCell className="font-mono text-xs">
                            {row.vehicle_id}
                          </TableCell>
                          <TableCell>{row.priority}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.battery_id ?? "—"}
                          </TableCell>
                          <TableCell data-numeric className="tabular-nums text-xs">
                            {row.SoC != null ? `${row.SoC.toFixed(0)}%` : "—"}
                            {row.min_SoC != null
                              ? ` ≥ ${row.min_SoC.toFixed(0)}%`
                              : ""}
                          </TableCell>
                          <TableCell className="text-xs">
                            {shortStatus(row.status)}
                          </TableCell>
                          <TableCell data-numeric className="tabular-nums text-xs">
                            {row.BSS != null ? formatScore(row.BSS) : "—"}
                          </TableCell>
                          <TableCell className="max-w-xs text-xs text-muted-foreground leading-snug">
                            {reason}
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="font-mono">
                              {twin?.battery_id ?? "—"}
                            </span>
                            {twin?.status?.includes("Quarantine") ? (
                              <span className="ml-1 text-[var(--health-unsafe)]">
                                · Quarantine
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <Section
            id="charts"
            eyebrow="Visuals"
            title="Three charts judges need"
          >
            {locked || !classification || !proposed || !hsf ? (
              <LockedBlock label="Charts locked" />
            ) : (
              <div className="grid gap-8">
                <div className="border border-border p-4">
                  <h3 className="mb-3 text-sm font-semibold">
                    Fleet classification counts
                  </h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={classChart}>
                        <CartesianGrid
                          stroke="var(--border)"
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                        />
                        <YAxis
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--background)",
                            border: "1px solid var(--border)",
                            fontSize: 12,
                          }}
                        />
                        <Bar dataKey="count" radius={0}>
                          {classChart.map((d) => (
                            <Cell key={d.name} fill={d.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="border border-border p-4">
                  <h3 className="mb-3 text-sm font-semibold">
                    Vehicles served by priority (Proposed)
                  </h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={priorityChart}>
                        <CartesianGrid
                          stroke="var(--border)"
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="priority"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                        />
                        <YAxis
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--background)",
                            border: "1px solid var(--border)",
                            fontSize: 12,
                          }}
                        />
                        <Legend />
                        <Bar
                          dataKey="served"
                          name="Served"
                          fill="var(--uber-accent)"
                        />
                        <Bar
                          dataKey="total"
                          name="Total requests"
                          fill="var(--muted-foreground)"
                          fillOpacity={0.35}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="border border-border p-4">
                  <h3 className="mb-3 text-sm font-semibold">
                    Proposed versus Highest-SoC-First
                  </h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={compareChart}>
                        <CartesianGrid
                          stroke="var(--border)"
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="metric"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                        />
                        <YAxis
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--background)",
                            border: "1px solid var(--border)",
                            fontSize: 12,
                          }}
                        />
                        <Legend />
                        <Bar
                          dataKey="Proposed"
                          fill="var(--health-safe)"
                          radius={0}
                        />
                        <Bar
                          dataKey="HSF"
                          name="Highest-SoC-First"
                          fill="var(--health-unsafe)"
                          radius={0}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </Section>

          <Section
            id="time"
            eyebrow="Stage 5"
            title="The time factor — stock is finite and order is not reversible"
          >
            {locked || !metrics.timeline ? (
              <LockedBlock label="Timeline locked" />
            ) : (
              <DispatchTimeline timeline={metrics.timeline} />
            )}
          </Section>

          <footer className="border-t border-border pt-6 pb-10 text-xs text-muted-foreground space-y-2">
            <p>
              Solver:{" "}
              <span className="font-mono">
                python -m bss_dispatch.safefit_run
              </span>{" "}
              · Verification: quarantined packs never enter the MILP edge set ·
              Every metric recomputed from the assignment rows.
            </p>
            <p>
              Deep diagnostics, pipeline theater, and twist hooks live in the{" "}
              <Link href="/lab" className="underline underline-offset-4">
                lab view
              </Link>
              .
            </p>
          </footer>
        </main>
      </div>
    </TermProvider>
  );
}
