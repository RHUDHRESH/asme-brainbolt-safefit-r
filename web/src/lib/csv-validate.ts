export const BATTERY_REQUIRED = [
  "battery_id",
  "SoC",
  "SoH",
  "T",
  "T_24h_max",
  "R_int_mOhm",
  "dV_cell_mV",
] as const;

export const VEHICLE_REQUIRED = ["vehicle_id", "priority", "min_SoC"] as const;

/** Problem 1 / competition aliases → internal column name (matched case-insensitively). */
export const BATTERY_ALIASES: Record<string, string> = {
  state_of_charge_percent: "SoC",
  state_of_health_percent: "SoH",
  temperature_c: "T",
  max_temperature_last_24h_c: "T_24h_max",
  internal_resistance_mohm: "R_int_mOhm",
  cell_voltage_imbalance_mv: "dV_cell_mV",
};

export const VEHICLE_ALIASES: Record<string, string> = {
  request_id: "vehicle_id",
  vehicle_id: "vehicle_id",
  minimum_acceptable_soc_percent: "min_SoC",
  min_soc: "min_SoC",
  maximum_wait_time_min: "W_max_min",
  w_max_min: "W_max_min",
};

export const VEHICLE_PRIORITIES = new Set([
  "critical",
  "high",
  "medium",
  "low",
  "normal", // Problem 1 — mapped to Medium in Python
]);

export type CsvKind = "batteries" | "vehicles";

export type CsvValidation = {
  ok: boolean;
  rows: number;
  columns: string[];
  missing: string[];
  message?: string;
  schema?: "internal" | "problem1";
};

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeHeaderName(name: string): string {
  return name
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/^\ufeff/, "")
    .toLowerCase();
}

function parseHeader(text: string): string[] {
  const cleaned = stripBom(text);
  const first =
    cleaned.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  return first.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
}

function countRows(text: string): number {
  const lines = stripBom(text)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

/** Resolve which internal required columns are covered by header (native or alias). */
export function resolveColumns(
  columns: string[],
  required: readonly string[],
  aliases: Record<string, string>
): { present: Set<string>; missing: string[]; schema: "internal" | "problem1" } {
  const requiredSet = new Set<string>(required);
  const requiredByLower = new Map(
    required.map((col) => [col.toLowerCase(), col] as const)
  );
  const present = new Set<string>();
  let usedAlias = false;

  for (const raw of columns) {
    const lower = normalizeHeaderName(raw);
    const native = requiredByLower.get(lower);
    if (native) {
      present.add(native);
      continue;
    }
    const mapped = aliases[lower];
    if (mapped && requiredSet.has(mapped)) {
      present.add(mapped);
      usedAlias = true;
    }
  }

  const missing = required.filter((col) => !present.has(col));
  return {
    present,
    missing: [...missing],
    schema: usedAlias ? "problem1" : "internal",
  };
}

export async function validateCsvFile(
  file: File,
  kind: CsvKind
): Promise<CsvValidation> {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return {
      ok: false,
      rows: 0,
      columns: [],
      missing: [],
      message: "Only .csv files are accepted",
    };
  }

  const text = await file.text();
  const columns = parseHeader(text);
  const rows = countRows(text);
  const required = kind === "batteries" ? BATTERY_REQUIRED : VEHICLE_REQUIRED;
  const aliases = kind === "batteries" ? BATTERY_ALIASES : VEHICLE_ALIASES;
  const { missing, schema } = resolveColumns(columns, required, aliases);

  if (rows < 1) {
    return {
      ok: false,
      rows,
      columns,
      missing,
      message: "CSV has no data rows",
    };
  }

  if (missing.length) {
    return {
      ok: false,
      rows,
      columns,
      missing,
      message: `Missing columns: ${missing.join(", ")} (also accepts Problem 1 names like request_id / minimum_acceptable_SOC_percent)`,
    };
  }

  if (kind === "vehicles") {
    const lines = stripBom(text)
      .split(/\r?\n/)
      .filter((l) => l.trim());
    const header = lines[0]
      .split(",")
      .map((c) => normalizeHeaderName(c));
    const pIdx = header.indexOf("priority");
    if (pIdx >= 0) {
      const bad = new Set<string>();
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        const p = (parts[pIdx] ?? "").trim().replace(/^"|"$/g, "");
        if (p && !VEHICLE_PRIORITIES.has(p.toLowerCase())) bad.add(p);
      }
      if (bad.size) {
        return {
          ok: false,
          rows,
          columns,
          missing: [],
          message: `Invalid priority values: ${[...bad].join(", ")}`,
        };
      }
    }
  }

  return {
    ok: true,
    rows,
    columns,
    missing: [],
    schema,
    message:
      schema === "problem1"
        ? "Problem 1 schema recognized"
        : undefined,
  };
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
