"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes, type CsvValidation } from "@/lib/csv-validate";

type FileChipProps = {
  file: File;
  validation: CsvValidation | null;
  onRemove: () => void;
};

export function FileChip({ file, validation, onRemove }: FileChipProps) {
  const ok = validation?.ok;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(file.size)}
          {validation ? ` · ${validation.rows} rows` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {ok === true ? (
          <Badge>
            {validation?.schema === "problem1" ? "Problem 1 OK" : "Valid"}
          </Badge>
        ) : null}
        {ok === false ? (
          <Badge variant="destructive" title={validation?.message}>
            Invalid
          </Badge>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
