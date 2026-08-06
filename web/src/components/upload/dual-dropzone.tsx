"use client";

import { useCallback, useRef, useState } from "react";

import { FileChip } from "@/components/upload/file-chip";
import { cn } from "@/lib/utils";
import {
  validateCsvFile,
  type CsvKind,
  type CsvValidation,
} from "@/lib/csv-validate";
import { pulseDrop } from "@/motion/use-unlock-flow";

type DualDropzoneProps = {
  batteries: File | null;
  vehicles: File | null;
  batteryValidation: CsvValidation | null;
  vehicleValidation: CsvValidation | null;
  onBatteries: (file: File | null, validation: CsvValidation | null) => void;
  onVehicles: (file: File | null, validation: CsvValidation | null) => void;
};

export function DualDropzone({
  batteries,
  vehicles,
  batteryValidation,
  vehicleValidation,
  onBatteries,
  onVehicles,
}: DualDropzoneProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DropCard
        title="Battery fleet"
        hint="Drop batteries.csv or Problem 1 fleet CSV"
        kind="batteries"
        dropId="batteries"
        file={batteries}
        validation={batteryValidation}
        onFile={onBatteries}
      />
      <DropCard
        title="Vehicle requests"
        hint="Drop vehicles.csv or Problem 1 demand CSV"
        kind="vehicles"
        dropId="vehicles"
        file={vehicles}
        validation={vehicleValidation}
        onFile={onVehicles}
      />
    </div>
  );
}

type DropCardProps = {
  title: string;
  hint: string;
  kind: CsvKind;
  dropId: string;
  file: File | null;
  validation: CsvValidation | null;
  onFile: (file: File | null, validation: CsvValidation | null) => void;
};

function DropCard({
  title,
  hint,
  kind,
  dropId,
  file,
  validation,
  onFile,
}: DropCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = useCallback(
    async (candidate: File | null) => {
      if (!candidate) {
        onFile(null, null);
        setLocalError(null);
        return;
      }
      const result = await validateCsvFile(candidate, kind);
      onFile(candidate, result);
      setLocalError(result.ok ? null : result.message ?? "Invalid CSV");
      pulseDrop(cardRef.current, result.ok);
    },
    [kind, onFile]
  );

  return (
    <div className="space-y-3">
      <div
        ref={cardRef}
        data-drop={dropId}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0] ?? null;
          void accept(dropped);
        }}
        className={cn(
          "cursor-pointer rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-all duration-300",
          dragging && "scale-[1.01] border-foreground bg-muted/60",
          validation?.ok && "border-emerald-600/40",
          validation && !validation.ok && "border-destructive/50"
        )}
      >
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          Drag & drop or click to browse (.csv)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            void accept(f);
            e.target.value = "";
          }}
        />
      </div>

      {file ? (
        <div data-chip>
          <FileChip
            file={file}
            validation={validation}
            onRemove={() => void accept(null)}
          />
        </div>
      ) : null}

      {localError ? <p className="text-xs text-destructive">{localError}</p> : null}
    </div>
  );
}
