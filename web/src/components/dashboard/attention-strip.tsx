"use client";

import { Button } from "@/components/ui/button";
import type { ResultsScreen } from "@/components/dashboard/results-nav";
import type { DrillFilter, MetricsResponse } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export type AttentionAlert = {
  id: string;
  title: string;
  detail: string;
  tone: "critical" | "warn" | "ok";
  screen: ResultsScreen;
  filter?: DrillFilter;
  cta: string;
};

export function deriveAttentionAlerts(
  metrics: MetricsResponse
): AttentionAlert[] {
  const alerts: AttentionAlert[] = [];
  const p = metrics.comparison?.Proposed;
  const h = metrics.comparison?.HSF;
  if (!p || !h) return alerts;

  const quarantine =
    metrics.classification?.counts["Unsafe / Quarantine"] ?? 0;
  const sohGap = p.avg_soh_allocated - h.avg_soh_allocated;

  if (h.unsafe_allocations > 0) {
    alerts.push({
      id: "hsf-unsafe",
      title: `HSF unsafe allocations: ${h.unsafe_allocations}`,
      detail: `Proposed kept unsafe at ${p.unsafe_allocations} (STRICT).`,
      tone: "critical",
      screen: "compare",
      filter: { divergencesOnly: true },
      cta: "Open Compare",
    });
  }

  if (quarantine > 0) {
    alerts.push({
      id: "quarantine",
      title: `${quarantine} packs quarantined`,
      detail: "Filtered out of Proposed matching.",
      tone: "warn",
      screen: "fleet",
      filter: { status: "Unsafe / Quarantine" },
      cta: "Open Fleet",
    });
  }

  if (p.unserved > 0) {
    alerts.push({
      id: "unserved",
      title: `${p.unserved} vehicles unserved`,
      detail: "Proposed could not allocate a feasible pack.",
      tone: "warn",
      screen: "assign",
      filter: { served: "unserved" },
      cta: "Open Assign",
    });
  }

  if (sohGap > 0.5) {
    alerts.push({
      id: "soh-gap",
      title: `SoH advantage +${sohGap.toFixed(1)} pp vs HSF`,
      detail: "Proposed allocates healthier packs on average.",
      tone: "ok",
      screen: "policy",
      cta: "Open Policy",
    });
  }

  return alerts.slice(0, 4);
}

type AttentionStripProps = {
  metrics: MetricsResponse;
  onNavigate: (screen: ResultsScreen, filter?: DrillFilter) => void;
};

export function AttentionStrip({ metrics, onNavigate }: AttentionStripProps) {
  const alerts = deriveAttentionAlerts(metrics);

  return (
    <section
      aria-label="Attention"
      className="space-y-2 border border-border px-3 py-3"
    >
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Attention
      </p>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No critical findings.</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={cn(
                "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
                "border-l-2 pl-3",
                a.tone === "critical" && "border-l-destructive",
                a.tone === "warn" && "border-l-amber-500",
                a.tone === "ok" && "border-l-emerald-600"
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{a.title}</p>
                <p className="text-xs text-muted-foreground">{a.detail}</p>
              </div>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="shrink-0"
                onClick={() => onNavigate(a.screen, a.filter)}
              >
                {a.cta}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
