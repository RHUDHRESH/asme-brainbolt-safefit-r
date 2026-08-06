"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PipelineSteps } from "@/components/dashboard/pipeline-steps";
import { ZoneSection } from "@/components/dashboard/zone-section";
import { DiagnosticsWorkbench } from "@/components/dashboard/diagnostics-workbench";
import type { MetricsResponse } from "@/lib/metrics";

type DiagnosticsPanelProps = {
  metrics: MetricsResponse;
  unlocked: boolean;
};

export function DiagnosticsPanel({ metrics, unlocked }: DiagnosticsPanelProps) {
  if (!unlocked) {
    return (
      <Card className="shadow-none" data-screen="diagnostics">
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
          <CardDescription>Unlocks after a successful run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  const fleet = metrics.fleet ?? [];
  const proposed = metrics.assignments?.Proposed ?? [];
  const hsf = metrics.assignments?.HSF ?? [];

  return (
    <div data-screen="diagnostics" className="space-y-6">
      <ZoneSection
        title="Visual diagnostics"
        description="One linked workbench over this run's payload. Selecting anywhere — a score band, a priority tier, a block reason, a shelf — narrows every other view to the same subset."
      >
        <DiagnosticsWorkbench
          fleet={fleet}
          proposed={proposed}
          hsf={hsf}
          classification={metrics.classification}
        />
      </ZoneSection>

      <ZoneSection
        title="Run meta"
        description="Provenance for this unlock, plus the solver's own matplotlib output."
      >
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Run meta</CardTitle>
            <CardDescription>
              Source, files, and fleet counts from the last unlock.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                  Source
                </dt>
                <dd className="mt-1 font-medium">{metrics.source}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                  Fleet size
                </dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {metrics.n_batteries ?? "—"} packs ·{" "}
                  {metrics.n_vehicles ?? "—"} requests
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                  Batteries file
                </dt>
                <dd className="mt-1 font-mono text-xs">
                  {metrics.batteries_file ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                  Vehicles file
                </dt>
                <dd className="mt-1 font-mono text-xs">
                  {metrics.vehicles_file ?? "—"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Accordion>
          <AccordionItem value="pipeline">
            <AccordionTrigger>Dispatch pipeline (tucked)</AccordionTrigger>
            <AccordionContent>
              <PipelineSteps />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Simulation plot</CardTitle>
            <CardDescription>
              Streamed from outputs when the solver wrote a PNG.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.plotExists ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/api/plot"
                alt="BSS dispatch simulation plot"
                className="w-full border border-border bg-muted/30"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No plot file found for this run (
                <code className="text-xs">
                  outputs/bss_dispatch_simulation.png
                </code>
                ).
              </p>
            )}
          </CardContent>
        </Card>
      </ZoneSection>
    </div>
  );
}
