"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ResultsLockOverlayProps = {
  onFocusUpload: () => void;
  running: boolean;
};

export function ResultsLockOverlay({
  onFocusUpload,
  running,
}: ResultsLockOverlayProps) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/75 p-4 backdrop-blur-[2px]">
      <Card className="w-full max-w-md shadow-sm border-border/80">
        <CardHeader className="space-y-2">
          <CardTitle className="text-xl tracking-tight">Results locked</CardTitle>
          <CardDescription>
            Metrics stay empty until a deliberate run — no seed KPIs, no stale
            outputs painted as live.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium text-foreground">What</dt>
              <dd className="mt-0.5 text-muted-foreground">
                KPI strip, fleet classification, HSF vs Proposed proof, and
                assignment rows.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Why locked</dt>
              <dd className="mt-0.5 text-muted-foreground">
                Showing numbers without your data implies a completed run that
                never happened.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Next</dt>
              <dd className="mt-0.5 text-muted-foreground">
                Drop your batteries and vehicles CSVs in, then run.
              </dd>
            </div>
          </dl>
          <Button
            className="w-full"
            disabled={running}
            onClick={onFocusUpload}
          >
            Upload CSVs
          </Button>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Every number in this dashboard comes from your files. There is no
            synthetic mode.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
