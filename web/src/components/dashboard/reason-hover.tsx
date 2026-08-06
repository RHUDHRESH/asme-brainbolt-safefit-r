"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { GateChecklist } from "@/components/dashboard/gate-checklist";
import { HsfTwin } from "@/components/dashboard/hsf-twin";
import type { AssignmentRow } from "@/lib/metrics";
import {
  assignmentOneLiner,
  buildGateChecklist,
  oneLineReason,
  reasonLabel,
  type PackLike,
} from "@/lib/safety-gates";
import { cn } from "@/lib/utils";

type ReasonHoverProps = {
  children: ReactNode;
  pack?: PackLike | null;
  /** Assignment context for match/assign rows */
  vehicleId?: string;
  priority?: string;
  proposed?: AssignmentRow | null;
  hsf?: AssignmentRow | null;
  className?: string;
  /** Extra footer line */
  footer?: ReactNode;
};

export function ReasonHover({
  children,
  pack,
  vehicleId,
  priority,
  proposed,
  hsf,
  className,
  footer,
}: ReasonHoverProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Held stable so the blur handler below keeps a single identity — the popover
  // closes on a short delay so a pointer can travel into it without dismissing.
  const scheduleClose = useCallback(() => {
    clearClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, [clearClose]);

  const openNow = useCallback(() => {
    clearClose();
    setOpen(true);
  }, [clearClose]);

  useEffect(() => clearClose, [clearClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onBlurCapture = useCallback(
    (e: React.FocusEvent) => {
      if (!rootRef.current?.contains(e.relatedTarget as Node)) {
        scheduleClose();
      }
    },
    [scheduleClose]
  );

  const effectivePack: PackLike =
    pack ??
    (proposed
      ? {
          status: proposed.status,
          SoC: proposed.SoC,
          SoH: proposed.SoH,
          T: proposed.T,
          R_int_mOhm: proposed.R_int_mOhm,
          dV_cell_mV: proposed.dV_cell_mV,
          quarantine_reason: proposed.quarantine_reason,
          BSS: proposed.BSS,
          min_SoC: proposed.min_SoC,
          priority: proposed.priority ?? priority,
          battery_id: proposed.battery_id,
        }
      : {});

  const checklist = buildGateChecklist(effectivePack);
  const tip =
    vehicleId
      ? assignmentOneLiner({
          vehicleId,
          batteryId: proposed?.battery_id ?? effectivePack.battery_id ?? null,
          priority: priority ?? proposed?.priority ?? "—",
          SoC: proposed?.SoC ?? effectivePack.SoC ?? null,
          minSoC: proposed?.min_SoC ?? effectivePack.min_SoC ?? null,
          BSS: proposed?.BSS ?? effectivePack.BSS ?? null,
          status: proposed?.status ?? effectivePack.status ?? null,
          hsfBatteryId: hsf?.battery_id,
          hsfStatus: hsf?.status,
        })
      : oneLineReason(effectivePack);

  const reasonCode = effectivePack.quarantine_reason;

  return (
    <div
      ref={rootRef}
      className={cn("relative inline-flex max-w-full", className)}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
      onFocusCapture={openNow}
      onBlurCapture={onBlurCapture}
    >
      <div
        className="max-w-full text-left outline-none focus-within:ring-2 focus-within:ring-[var(--uber-accent)]"
        aria-describedby={open ? id : undefined}
      >
        {children}
      </div>

      {open ? (
        <div
          id={id}
          role="tooltip"
          className={cn(
            "absolute z-40 w-[min(20rem,calc(100vw-2rem))] border border-border bg-background p-3 shadow-md",
            "left-0 top-full mt-1 sm:left-auto sm:right-0"
          )}
          onMouseEnter={openNow}
          onMouseLeave={scheduleClose}
        >
          <p className="text-xs font-medium leading-snug text-foreground">
            {tip}
          </p>
          {reasonCode ? (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {reasonCode} · {reasonLabel(reasonCode)}
            </p>
          ) : null}
          <div className="mt-3 border-t border-border pt-2">
            <p className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Gate checklist
            </p>
            <GateChecklist rows={checklist} />
          </div>
          {proposed || hsf ? (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Proposed vs HSF
              </p>
              <HsfTwin proposed={proposed} hsf={hsf} />
            </div>
          ) : null}
          {footer ? (
            <div className="mt-2 text-[10px] text-muted-foreground">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
