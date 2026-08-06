"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AssignmentsTable } from "@/components/dashboard/assignments-table";
import { DiagnosticsPanel } from "@/components/dashboard/diagnostics-panel";
import { GatingPanel } from "@/components/dashboard/gating-panel";
import { ScoringEnginePanel } from "@/components/dashboard/scoring-engine-panel";
import { SolverConfigProvider } from "@/components/params/solver-config-context";
import { FleetExplorer } from "@/components/dashboard/fleet-explorer";
import { FleetHealth } from "@/components/dashboard/fleet-health";
import { FlowStepper } from "@/components/dashboard/flow-stepper";
import { MatchTheaterPanel } from "@/components/dashboard/match-theater-panel";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import { PipelineTheater } from "@/components/dashboard/pipeline-theater";
import { PolicyAssignmentCompare } from "@/components/dashboard/policy-assignment-compare";
import { PolicyCompare } from "@/components/dashboard/policy-compare";
import { StoryCoachDrawer } from "@/components/dashboard/story-coach-drawer";
import { StoryPanel } from "@/components/dashboard/story-panel";
import {
  ResultsNav,
  type ResultsScreen,
} from "@/components/dashboard/results-nav";
import { ResultsLockOverlay } from "@/components/dashboard/results-lock-overlay";
import { AppHeader } from "@/components/layout/app-header";
import { UploadPanel } from "@/components/upload/upload-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CsvValidation } from "@/lib/csv-validate";
import {
  deriveFlowPhase,
  EMPTY_METRICS,
  type DrillFilter,
  type MetricsResponse,
} from "@/lib/metrics";
import { useUnlockFlow } from "@/motion/use-unlock-flow";
import { cn } from "@/lib/utils";

export function DashboardShell() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<MetricsResponse>(EMPTY_METRICS);
  const [runCompleted, setRunCompleted] = useState(false);
  const [unlockKey, setUnlockKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resultsScreen, setResultsScreen] = useState<ResultsScreen>("overview");
  const [drillFilter, setDrillFilter] = useState<DrillFilter>({});
  const [storyBeat, setStoryBeat] = useState(0);
  const [storyCoachOpen, setStoryCoachOpen] = useState(false);
  const [runSetupOpen, setRunSetupOpen] = useState(true);

  const [batteries, setBatteries] = useState<File | null>(null);
  const [vehicles, setVehicles] = useState<File | null>(null);
  const [batteryValidation, setBatteryValidation] = useState<CsvValidation | null>(
    null
  );
  const [vehicleValidation, setVehicleValidation] = useState<CsvValidation | null>(
    null
  );

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

  useUnlockFlow({
    root: rootRef,
    phase,
    canRunUpload,
    unlockKey,
    resultsScreen: locked ? undefined : resultsScreen,
  });

  const navigate = useCallback(
    (screen: ResultsScreen, filter: DrillFilter = {}) => {
      setDrillFilter(filter);
      setResultsScreen(screen);
    },
    []
  );

  const applyPayload = useCallback((data: MetricsResponse) => {
    setMetrics(data);
    if (data.error) {
      setNotice(
        `${data.error}${data.detail ? ` — ${data.detail.slice(0, 220)}` : ""}`
      );
      setRunCompleted(false);
    } else if (data.comparison) {
      setNotice(null);
      setRunCompleted(true);
      setResultsScreen("overview");
      setDrillFilter({});
      setStoryBeat(0);
      setStoryCoachOpen(false);
      setRunSetupOpen(false);
      setUnlockKey((k) => k + 1);
    }
  }, []);

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

  const focusUpload = useCallback(() => {
    setRunSetupOpen(true);
    requestAnimationFrame(() => {
      document.getElementById("upload-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      const drop = document.querySelector<HTMLElement>('[data-drop="batteries"]');
      drop?.focus();
    });
  }, []);

  // Measured data only: there is exactly one way to produce results, and it
  // requires two valid CSVs.
  const runSimulation = useCallback(
    async () => {
      if (!canRunUpload || !batteries || !vehicles) {
        setError("Add two valid CSV files before running.");
        return;
      }

      setRunning(true);
      setError(null);
      setNotice(null);
      setRunSetupOpen(true);
      startProgress();

      try {
        const form = new FormData();
        form.append("batteries", batteries);
        form.append("vehicles", vehicles);
        const res = await fetch("/api/simulate", {
          method: "POST",
          body: form,
        });

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
    },
    [applyPayload, batteries, canRunUpload, startProgress, stopProgress, vehicles]
  );

  // Cold start is already empty from the initial state above; this only has to
  // stop the progress ticker when the shell unmounts mid-run.
  useEffect(() => stopProgress, [stopProgress]);

  // Cold start stays empty by default. `?resume=1` is the one explicit opt-in
  // that repaints the last run — useful for picking a demo back up without
  // re-uploading, and never automatic. Kept self-contained (no callback in the
  // dependency list) so it runs exactly once on mount.
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
        setMetrics(data);
        setNotice(null);
        setRunCompleted(true);
        setResultsScreen("overview");
        setUnlockKey((k) => k + 1);
      } catch {
        // Resume is best-effort; the empty state is a valid outcome.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const unsafe = metrics.comparison?.Proposed.unsafe_allocations ?? null;
  const showRunSetup = locked || running || runSetupOpen;

  return (
    <SolverConfigProvider config={locked ? null : metrics.config}>
    <div ref={rootRef} className="flex min-h-full flex-1 flex-col">
      <AppHeader
        source={metrics.source}
        unsafe={unsafe}
        running={running}
        canRunUpload={canRunUpload}
        locked={locked}
        nBatteries={metrics.n_batteries}
        nVehicles={metrics.n_vehicles}
        metrics={locked ? null : metrics}
        onRunUpload={() => void runSimulation()}
        onNavigate={navigate}
        progress={progress}
      />

      <main
        data-motion="flow"
        data-phase={phase}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
      >
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Run failed</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{error}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={running}
                  onClick={() => void runSimulation()}
                >
                  Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setError(null)}>
                  Dismiss
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {notice ? (
          <Alert>
            <AlertTitle>Simulation note</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {!locked ? (
          <div className="flex items-center justify-between gap-3 border border-border px-3 py-2">
            <div>
              <p className="text-sm font-semibold">Run setup</p>
              <p className="text-xs text-muted-foreground">
                Upload, stepper, and pipeline — tucked after unlock.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRunSetupOpen((o) => !o)}
            >
              {runSetupOpen ? "Hide" : "Show"}
            </Button>
          </div>
        ) : null}

        {showRunSetup ? (
          <div className="space-y-6" data-run-setup>
            <FlowStepper
              batteriesOk={Boolean(batteryValidation?.ok)}
              vehiclesOk={Boolean(vehicleValidation?.ok)}
              canRun={canRunUpload}
              running={running}
              completed={runCompleted}
            />
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
            <PipelineTheater running={running} progress={progress} />
          </div>
        ) : null}

        <div
          data-motion="results-gate"
          className={cn(
            "relative transition-opacity duration-300",
            locked && "min-h-[28rem]"
          )}
        >
          {locked ? (
            <ResultsLockOverlay
              running={running}
              onFocusUpload={focusUpload}
            />
          ) : null}

          <div
            className={cn(
              "transition-opacity duration-500",
              locked && "pointer-events-none select-none opacity-40"
            )}
            aria-hidden={locked}
          >
            {locked ? (
              <div className="space-y-6">
                <OverviewPanel
                  metrics={EMPTY_METRICS}
                  unlocked={false}
                  onNavigate={navigate}
                />
                <div className="grid gap-6 lg:grid-cols-2">
                  <FleetHealth classification={null} unlocked={false} />
                  <PolicyCompare metrics={null} unlocked={false} />
                </div>
                <AssignmentsTable unlocked={false} />
              </div>
            ) : (
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                <ResultsNav
                  value={resultsScreen}
                  onChange={(screen) => navigate(screen, {})}
                  orientation="vertical"
                />
                <div className="min-w-0 flex-1 space-y-6">
                  {resultsScreen === "overview" ? (
                    <OverviewPanel
                      metrics={metrics}
                      unlocked
                      onNavigate={navigate}
                      onStartStory={() => {
                        setStoryCoachOpen(true);
                        setStoryBeat(0);
                      }}
                    />
                  ) : null}

                  {resultsScreen === "gating" ? (
                    <GatingPanel
                      classification={metrics.classification}
                      fleet={metrics.fleet ?? []}
                    />
                  ) : null}

                  {resultsScreen === "scoring" ? (
                    <ScoringEnginePanel fleet={metrics.fleet ?? []} />
                  ) : null}

                  {resultsScreen === "fleet" ? (
                    <FleetExplorer
                      classification={metrics.classification}
                      fleet={metrics.fleet ?? []}
                      drillFilter={drillFilter}
                      onDrillChange={setDrillFilter}
                      onNavigate={navigate}
                    />
                  ) : null}

                  {resultsScreen === "story" ? (
                    <StoryPanel
                      beat={storyBeat}
                      onBeatChange={setStoryBeat}
                      onJump={(screen) => navigate(screen, {})}
                      onExitOverview={() => navigate("overview", {})}
                      metrics={metrics}
                    />
                  ) : null}

                  {resultsScreen === "policy" ? (
                    <PolicyCompare
                      metrics={metrics}
                      unlocked
                      onOpenCompare={() =>
                        navigate("compare", { divergencesOnly: true })
                      }
                    />
                  ) : null}

                  {resultsScreen === "match" ? (
                    <MatchTheaterPanel
                      fleet={metrics.fleet ?? []}
                      proposed={metrics.assignments?.Proposed ?? []}
                      hsf={metrics.assignments?.HSF ?? []}
                      autoPlayKey={unlockKey}
                      onNavigate={navigate}
                    />
                  ) : null}

                  {resultsScreen === "assign" ? (
                    <AssignmentsTable
                      proposed={metrics.assignments?.Proposed}
                      hsf={metrics.assignments?.HSF}
                      unlocked
                      drillFilter={drillFilter}
                      onNavigate={navigate}
                    />
                  ) : null}

                  {resultsScreen === "compare" ? (
                    <PolicyAssignmentCompare
                      proposed={metrics.assignments?.Proposed}
                      hsf={metrics.assignments?.HSF}
                      fleet={metrics.fleet}
                      drillFilter={drillFilter}
                      onDrillChange={setDrillFilter}
                      onNavigate={navigate}
                    />
                  ) : null}

                  {resultsScreen === "diagnostics" ? (
                    <DiagnosticsPanel metrics={metrics} unlocked />
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="border-t border-border pb-8 pt-4 text-sm text-muted-foreground">
          <p>
            Phase:{" "}
            <span className="font-medium text-foreground">{phase}</span>
            {" · "}
            Source:{" "}
            <span className="font-medium text-foreground">
              {locked ? "waiting for run" : metrics.source}
            </span>
            {metrics.batteries_file
              ? ` · ${metrics.batteries_file} / ${metrics.vehicles_file}`
              : null}
          </p>
          <p className="mt-1">
            Cold start never paints prior outputs. Samples:{" "}
            <code className="text-xs">/samples/*.sample.csv</code>
          </p>
        </footer>
      </main>

      {!locked ? (
        <StoryCoachDrawer
          open={storyCoachOpen}
          onOpenChange={setStoryCoachOpen}
          beat={storyBeat}
          onBeatChange={setStoryBeat}
          onJump={(screen) => navigate(screen, {})}
          metrics={metrics}
        />
      ) : null}
    </div>
    </SolverConfigProvider>
  );
}
