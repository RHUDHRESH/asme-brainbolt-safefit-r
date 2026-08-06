"use client";

import type { AssignmentRow } from "@/lib/metrics";
import { formatPct, formatScore } from "@/lib/metrics";
import { shortStatus } from "@/lib/safety-gates";
import { cn } from "@/lib/utils";

type HsfTwinProps = {
  proposed?: AssignmentRow | null;
  hsf?: AssignmentRow | null;
  className?: string;
};

function Side({
  label,
  row,
  emphasize,
}: {
  label: string;
  row?: AssignmentRow | null;
  emphasize?: boolean;
}) {
  if (!row) {
    return (
      <div className="border border-border px-2 py-2 text-xs text-muted-foreground">
        {label}: —
      </div>
    );
  }
  const unsafe = (row.status ?? "").includes("Quarantine");
  return (
    <div
      className={cn(
        "border px-2 py-2 text-xs",
        emphasize ? "border-foreground" : "border-border",
        unsafe && "border-[var(--negative)]"
      )}
    >
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-0.5 font-mono font-semibold">
        {row.battery_id ?? "unserved"}
      </p>
      <p className="mt-1 tabular-nums text-muted-foreground">
        {shortStatus(row.status)}
        {row.SoH != null ? ` · SoH ${formatPct(row.SoH)}` : ""}
        {row.SoC != null ? ` · SoC ${formatPct(row.SoC)}` : ""}
        {row.BSS != null ? ` · BSS ${formatScore(row.BSS)}` : ""}
      </p>
      {unsafe ? (
        <p className="mt-1 font-semibold text-[var(--negative)]">
          Unsafe allocation
        </p>
      ) : null}
    </div>
  );
}

export function HsfTwin({ proposed, hsf, className }: HsfTwinProps) {
  const same =
    proposed?.battery_id &&
    hsf?.battery_id &&
    proposed.battery_id === hsf.battery_id;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="grid grid-cols-2 gap-2">
        <Side label="Proposed" row={proposed} emphasize />
        <Side label="HSF" row={hsf} />
      </div>
      {same ? (
        <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          Aligned — same pack
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          HSF = highest SoC ≥ min, no health gate.
        </p>
      )}
    </div>
  );
}
