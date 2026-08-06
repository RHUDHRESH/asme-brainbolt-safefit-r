import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { loadRunResultMetrics, plotPath, repoRoot } from "@/lib/server-metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function resolvePython(): string {
  const candidates = [
    process.env.PYTHON_PATH,
    path.join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "Python",
      "Python312",
      "python.exe"
    ),
    "python",
    "py",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === "python" || candidate === "py") return candidate;
    if (existsSync(candidate)) return candidate;
  }
  return "python";
}

function runDispatch(
  pythonBin: string,
  cwd: string,
  batteriesPath?: string,
  vehiclesPath?: string
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    // SafeFit-R writes both its own result document and outputs/run_result.json,
    // which is the single file every dashboard figure reads.
    const base =
      pythonBin.toLowerCase().endsWith("py") || pythonBin === "py"
        ? ["-3", "-m", "bss_dispatch.safefit_run"]
        : ["-m", "bss_dispatch.safefit_run"];
    const args = [...base];
    if (batteriesPath && vehiclesPath) {
      args.push("--batteries", batteriesPath, "--vehicles", vehiclesPath);
    }

    const child = spawn(pythonBin, args, {
      cwd,
      env: process.env,
      windowsHide: true,
    });

    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", (err) => {
      resolve({ code: 1, stderr: err.message, stdout });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stderr, stdout });
    });
  });
}

async function loadRunResult() {
  const file = path.join(repoRoot(), "outputs", "run_result.json");
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function safeName(name: string, fallback: string): string {
  const base = path.basename(name || fallback).replace(/[^\w.\-]+/g, "_");
  return base.toLowerCase().endsWith(".csv") ? base : `${base}.csv`;
}

export async function POST(request: Request) {
  const root = repoRoot();
  const pythonBin = resolvePython();
  const uploadsDir = path.join(root, "data", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  let batteriesPath: string | undefined;
  let vehiclesPath: string | undefined;
  let batteriesName: string | undefined;
  let vehiclesName: string | undefined;

  // Measured data only. A request without both CSVs is rejected rather than
  // quietly falling through to a fabricated fleet, which is what made the old
  // no-file branch dangerous: its output was shaped exactly like a real run.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      {
        error:
          "Upload both batteries and vehicles CSV files. This API has no synthetic mode.",
      },
      { status: 400 }
    );
  }

  {
    const form = await request.formData();
    const batteries = form.get("batteries");
    const vehicles = form.get("vehicles");

    if (!(batteries instanceof File) || !(vehicles instanceof File)) {
      return NextResponse.json(
        { error: "Upload both batteries and vehicles CSV files." },
        { status: 400 }
      );
    }

    batteriesName = safeName(batteries.name, "batteries.csv");
    vehiclesName = safeName(vehicles.name, "vehicles.csv");
    batteriesPath = path.join(uploadsDir, `batteries_${Date.now()}_${batteriesName}`);
    vehiclesPath = path.join(uploadsDir, `vehicles_${Date.now()}_${vehiclesName}`);

    await writeFile(batteriesPath, Buffer.from(await batteries.arrayBuffer()));
    await writeFile(vehiclesPath, Buffer.from(await vehicles.arrayBuffer()));
  }

  const result = await runDispatch(pythonBin, root, batteriesPath, vehiclesPath);
  const metrics = await loadRunResultMetrics();
  const runResult = await loadRunResult();
  const plotExists = existsSync(plotPath());

  const source = "upload";

  const payload = {
    ...(runResult ?? metrics),
    source,
    batteries_file: batteriesName ?? (runResult?.batteries_file as string | null) ?? null,
    vehicles_file: vehiclesName ?? (runResult?.vehicles_file as string | null) ?? null,
    plotExists,
    python: pythonBin,
  };

  if (result.code !== 0) {
    return NextResponse.json(
      {
        ...payload,
        error: `Simulation exited with code ${result.code}`,
        detail: (result.stderr || result.stdout).slice(0, 2500),
      },
      { status: 200 }
    );
  }

  return NextResponse.json(payload);
}
