"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { GateChecklist } from "@/components/dashboard/gate-checklist";
import { HsfTwin } from "@/components/dashboard/hsf-twin";
import type { ResultsScreen } from "@/components/dashboard/results-nav";
import type { AssignmentRow, DrillFilter, FleetBattery } from "@/lib/metrics";
import { formatPct, formatScore } from "@/lib/metrics";
import {
  buildGateChecklist,
  oneLineReason,
  reasonLabel,
} from "@/lib/safety-gates";

export type DetailSelection =
  | { kind: "assignment"; row: AssignmentRow; hsf?: AssignmentRow | null }
  | { kind: "fleet"; battery: FleetBattery; hsf?: AssignmentRow | null };

type AssignmentDetailSheetProps = {
  selection: DetailSelection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: (screen: ResultsScreen, filter?: DrillFilter) => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p className="font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function fromFleet(b: FleetBattery) {
  const assigned = Boolean(b.assigned_vehicle_id);
  return {
    title: b.battery_id,
    description: assigned
      ? `Assigned to ${b.assigned_vehicle_id}`
      : "Not allocated in Proposed matching",
    batteryId: b.battery_id,
    vehicleId: b.assigned_vehicle_id,
    pack: b,
    proposed: null as AssignmentRow | null,
    fields: [
      { label: "Battery", value: b.battery_id },
      { label: "Status", value: b.status },
      {
        label: "Reason",
        value: b.quarantine_reason
          ? `${b.quarantine_reason} · ${reasonLabel(b.quarantine_reason)}`
          : oneLineReason(b),
      },
      { label: "SoC", value: b.SoC == null ? "—" : formatPct(b.SoC) },
      { label: "SoH", value: b.SoH == null ? "—" : formatPct(b.SoH) },
      { label: "T", value: b.T == null ? "—" : `${formatScore(b.T)}°C` },
      {
        label: "R int (mΩ)",
        value: b.R_int_mOhm == null ? "—" : formatScore(b.R_int_mOhm),
      },
      {
        label: "ΔV (mV)",
        value: b.dV_cell_mV == null ? "—" : formatScore(b.dV_cell_mV),
      },
      { label: "Vehicle", value: b.assigned_vehicle_id ?? "—" },
      { label: "Priority", value: b.priority ?? "—" },
      { label: "BSS", value: b.BSS == null ? "—" : formatScore(b.BSS) },
      {
        label: "T score",
        value: b.T_score == null ? "—" : formatScore(b.T_score),
      },
    ],
  };
}

function fromAssignment(row: AssignmentRow) {
  return {
    title: row.vehicle_id,
    description: `${row.vehicle_id} · ${row.served ? "Served" : "Unserved"}`,
    batteryId: row.battery_id,
    vehicleId: row.vehicle_id,
    pack: row,
    proposed: row,
    fields: [
      { label: "Vehicle", value: row.vehicle_id },
      { label: "Priority", value: row.priority },
      { label: "Battery", value: row.battery_id ?? "—" },
      { label: "Status", value: row.status ?? "—" },
      {
        label: "Reason",
        value: row.quarantine_reason
          ? `${row.quarantine_reason} · ${reasonLabel(row.quarantine_reason)}`
          : oneLineReason(row),
      },
      {
        label: "min SoC",
        value: row.min_SoC == null ? "—" : formatPct(row.min_SoC),
      },
      { label: "SoC", value: row.SoC == null ? "—" : formatPct(row.SoC) },
      { label: "SoH", value: row.SoH == null ? "—" : formatPct(row.SoH) },
      { label: "T", value: row.T == null ? "—" : `${formatScore(row.T)}°C` },
      { label: "BSS", value: row.BSS == null ? "—" : formatScore(row.BSS) },
      {
        label: "T score",
        value: row.T_score == null ? "—" : formatScore(row.T_score),
      },
      {
        label: "R int (mΩ)",
        value: row.R_int_mOhm == null ? "—" : formatScore(row.R_int_mOhm),
      },
      {
        label: "ΔV (mV)",
        value: row.dV_cell_mV == null ? "—" : formatScore(row.dV_cell_mV),
      },
      { label: "Served", value: row.served ? "Yes" : "No" },
    ],
  };
}

export function AssignmentDetailSheet({
  selection,
  open,
  onOpenChange,
  onNavigate,
}: AssignmentDetailSheetProps) {
  const view =
    selection?.kind === "fleet"
      ? fromFleet(selection.battery)
      : selection?.kind === "assignment"
        ? fromAssignment(selection.row)
        : null;

  const hsf = selection?.hsf ?? null;
  const checklist = view ? buildGateChecklist(view.pack) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{view?.title ?? "Detail"}</SheetTitle>
          <SheetDescription>
            {view?.description ?? "Select a pack or assignment row."}
          </SheetDescription>
        </SheetHeader>
        {view ? (
          <div className="space-y-6 px-8 pb-8">
            <p className="text-sm text-muted-foreground">
              {oneLineReason(view.pack)}
            </p>
            <div className="grid grid-cols-2 gap-4">
              {view.fields.slice(0, 4).map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              {view.fields.slice(4).map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </div>
            <Separator />
            <div>
              <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Gate checklist
              </p>
              <GateChecklist rows={checklist} />
            </div>
            {view.proposed || hsf ? (
              <>
                <Separator />
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    Proposed vs HSF
                  </p>
                  <HsfTwin proposed={view.proposed} hsf={hsf} />
                </div>
              </>
            ) : null}
            {onNavigate ? (
              <>
                <Separator />
                <div className="flex flex-wrap gap-2">
                  {view.batteryId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onOpenChange(false);
                        onNavigate("fleet", {
                          focusBatteryId: view.batteryId ?? undefined,
                        });
                      }}
                    >
                      View in Fleet
                    </Button>
                  ) : null}
                  {view.vehicleId && view.vehicleId !== "—" ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          onOpenChange(false);
                          onNavigate("assign", {
                            focusVehicleId: view.vehicleId ?? undefined,
                            served: "all",
                          });
                        }}
                      >
                        View in Assign
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          onOpenChange(false);
                          onNavigate("compare", {
                            focusVehicleId: view.vehicleId ?? undefined,
                          });
                        }}
                      >
                        View in Compare
                      </Button>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
