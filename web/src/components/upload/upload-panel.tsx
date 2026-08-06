"use client";

import { DualDropzone } from "@/components/upload/dual-dropzone";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CsvValidation } from "@/lib/csv-validate";

type UploadPanelProps = {
  batteries: File | null;
  vehicles: File | null;
  batteryValidation: CsvValidation | null;
  vehicleValidation: CsvValidation | null;
  dimmed?: boolean;
  onBatteries: (file: File | null, validation: CsvValidation | null) => void;
  onVehicles: (file: File | null, validation: CsvValidation | null) => void;
};

export function UploadPanel({
  batteries,
  vehicles,
  batteryValidation,
  vehicleValidation,
  dimmed,
  onBatteries,
  onVehicles,
}: UploadPanelProps) {
  return (
    <div
      id="upload-panel"
      data-motion="upload"
      className={dimmed ? "opacity-70 transition-opacity duration-300" : "transition-opacity duration-300"}
    >
      <Card className="shadow-none">
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Upload fleet data</CardTitle>
            <CardDescription>
              Results stay locked until you drop both CSVs and run. Every figure
              is computed from your files — there is no synthetic mode.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <a
              className="underline underline-offset-4 text-muted-foreground hover:text-foreground transition-colors"
              href="/samples/batteries.sample.csv"
              download
            >
              Sample batteries.csv
            </a>
            <a
              className="underline underline-offset-4 text-muted-foreground hover:text-foreground transition-colors"
              href="/samples/vehicles.sample.csv"
              download
            >
              Sample vehicles.csv
            </a>
            {/* The Problem 1 datasets are the organizer's material and are not
                redistributed here. The loader still auto-maps their column
                names, so dropping the originals in works unchanged. */}
            <span className="text-muted-foreground">
              Problem 1 datasets: supplied by Siemens Energy — drop your own
              copies in
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <DualDropzone
            batteries={batteries}
            vehicles={vehicles}
            batteryValidation={batteryValidation}
            vehicleValidation={vehicleValidation}
            onBatteries={onBatteries}
            onVehicles={onVehicles}
          />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Accepts internal columns (SoC, vehicle_id, …) or ASME Problem 1
            names (state_of_charge_percent, request_id, …). Priority{" "}
            <span className="font-medium text-foreground">Normal</span> maps to
            Medium. Quarantine fields still need charge, health, temperature,
            resistance, and imbalance (native or Problem 1 aliases).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
