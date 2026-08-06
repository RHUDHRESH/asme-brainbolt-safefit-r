"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPct, type ClassificationSummary } from "@/lib/metrics";
import { useBarReveal } from "@/motion/use-unlock-flow";
import { cn } from "@/lib/utils";

const TIER_ORDER = [
  "Safe and Available",
  "Degraded but Usable",
  "Unsafe / Quarantine",
] as const;

const TIER_TONE: Record<string, string> = {
  "Safe and Available": "bg-[var(--positive)]",
  "Degraded but Usable": "bg-[var(--warning)]",
  "Unsafe / Quarantine": "bg-[var(--negative)]",
};

type FleetHealthProps = {
  classification: ClassificationSummary | null;
  unlocked: boolean;
  onTierClick?: (status: string) => void;
  onReasonClick?: (reason: string) => void;
};

export function FleetHealth({
  classification,
  unlocked,
  onTierClick,
  onReasonClick,
}: FleetHealthProps) {
  const barRef = useBarReveal(unlocked && !!classification);

  if (!unlocked || !classification) {
    return (
      <Card className="shadow-none h-full" data-motion="fleet">
        <CardHeader>
          <CardTitle>Fleet health</CardTitle>
          <CardDescription>
            Classification appears after you run the solver.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md" />
          ))}
          <p className="text-sm text-muted-foreground">
            No fake bars — upload your fleet and demand CSVs to populate this.
          </p>
        </CardContent>
      </Card>
    );
  }

  const reasons = Object.entries(classification.quarantine_reasons).sort(
    (a, b) => b[1] - a[1]
  );
  const maxReason = reasons[0]?.[1] ?? 1;
  const hasReasons = reasons.length > 0;

  return (
    <div data-motion="fleet" ref={barRef}>
      <Card className="shadow-none h-full">
        <CardHeader>
          <CardTitle>Fleet health</CardTitle>
          <CardDescription>
            {classification.total} packs classified into three operational tiers.
            Click a tier or quarantine reason to filter the explorer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            {TIER_ORDER.map((tier) => {
              const count = classification.counts[tier] ?? 0;
              const pct = classification.pct[tier] ?? 0;
              return (
                <button
                  key={tier}
                  type="button"
                  className={cn(
                    "w-full space-y-2 rounded-md text-left transition-colors",
                    onTierClick && "hover:bg-muted/40 -mx-1 px-1 py-1"
                  )}
                  onClick={() => onTierClick?.(tier)}
                >
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{tier}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {count} · {formatPct(pct)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      data-bar-fill
                      className={`h-full origin-left rounded-full ${TIER_TONE[tier]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          <Separator />

          <Collapsible defaultOpen={hasReasons}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Quarantine triggers (tucked)</p>
              <CollapsibleTrigger className="text-xs font-semibold tracking-wider text-muted-foreground uppercase underline-offset-4 hover:underline">
                Toggle
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="mt-3 space-y-3">
              {!hasReasons ? (
                <p className="text-sm text-muted-foreground">
                  No quarantined packs.
                </p>
              ) : (
                reasons.map(([reason, count]) => (
                  <button
                    key={reason}
                    type="button"
                    className={cn(
                      "w-full space-y-1.5 text-left",
                      onReasonClick && "hover:bg-muted/40 -mx-1 rounded-md px-1 py-1"
                    )}
                    onClick={() => onReasonClick?.(reason)}
                  >
                    <div className="flex justify-between text-xs">
                      <span className="font-mono text-muted-foreground">
                        {reason}
                      </span>
                      <span className="tabular-nums">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        data-bar-fill
                        className="h-full origin-left rounded-full bg-[var(--negative)]/80"
                        style={{ width: `${(count / maxReason) * 100}%` }}
                      />
                    </div>
                  </button>
                ))
              )}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </div>
  );
}
