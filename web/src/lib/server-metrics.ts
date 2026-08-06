import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { EMPTY_METRICS, type MetricsPayload, type MetricsResponse } from "@/lib/metrics";

export function repoRoot(): string {
  return path.resolve(process.cwd(), "..");
}

export function metricsPath(): string {
  return path.join(repoRoot(), "outputs", "metrics.json");
}

export function runResultPath(): string {
  return path.join(repoRoot(), "outputs", "run_result.json");
}

export function plotPath(): string {
  return path.join(repoRoot(), "outputs", "bss_dispatch_simulation.png");
}

/**
 * Cold load is honest: do not paint stale outputs/seed as live KPIs.
 * Pass resume=true to load the last run_result for explicit resume flows.
 */
export async function loadMetrics(options?: {
  resume?: boolean;
}): Promise<MetricsResponse> {
  const plotExists = existsSync(plotPath());
  const resume = options?.resume === true;

  if (resume) {
    const runFile = runResultPath();
    if (existsSync(runFile)) {
      const raw = await readFile(runFile, "utf-8");
      const data = JSON.parse(raw) as MetricsPayload & { source?: string };
      return {
        ...data,
        source: (data.source as MetricsResponse["source"]) ?? "live",
        plotExists,
      };
    }
    const file = metricsPath();
    if (existsSync(file)) {
      const raw = await readFile(file, "utf-8");
      const data = JSON.parse(raw) as MetricsPayload;
      return { ...data, source: "live", plotExists };
    }
  }

  return { ...EMPTY_METRICS, plotExists };
}

/** After a successful simulate, read the fresh run_result. */
export async function loadRunResultMetrics(): Promise<MetricsResponse> {
  const plotExists = existsSync(plotPath());
  const runFile = runResultPath();
  if (existsSync(runFile)) {
    const raw = await readFile(runFile, "utf-8");
    const data = JSON.parse(raw) as MetricsPayload & { source?: string };
    return {
      ...data,
      source: (data.source as MetricsResponse["source"]) ?? "live",
      plotExists,
    };
  }
  return { ...EMPTY_METRICS, plotExists };
}
