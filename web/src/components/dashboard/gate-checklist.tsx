"use client";

import type { GateRow } from "@/lib/safety-gates";
import { cn } from "@/lib/utils";

const RESULT_LABEL: Record<GateRow["result"], string> = {
  pass: "PASS",
  soft: "SOFT",
  fail: "FAIL",
};

type GateChecklistProps = {
  rows: GateRow[];
  className?: string;
};

export function GateChecklist({ rows, className }: GateChecklistProps) {
  return (
    <ul className={cn("space-y-1.5", className)}>
      {rows.map((row) => (
        <li
          key={row.metric}
          className="grid grid-cols-[minmax(0,10.5rem)_1fr_auto] items-baseline gap-2 text-xs"
        >
          <span className="font-medium leading-snug text-foreground">
            {row.metric}
          </span>
          <span className="min-w-0 truncate text-muted-foreground">
            <span data-numeric className="tabular-nums text-foreground">
              {row.value}
            </span>
            <span className="mx-1">·</span>
            <span className="text-[10px]">{row.limit}</span>
          </span>
          <span
            className={cn(
              "shrink-0 border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
              row.result === "pass" &&
                "border-[var(--positive)] text-[var(--positive)]",
              row.result === "soft" &&
                "border-[var(--warning)] text-foreground",
              row.result === "fail" &&
                "border-[var(--negative)] bg-[var(--negative)] text-white"
            )}
          >
            {RESULT_LABEL[row.result]}
          </span>
        </li>
      ))}
    </ul>
  );
}
