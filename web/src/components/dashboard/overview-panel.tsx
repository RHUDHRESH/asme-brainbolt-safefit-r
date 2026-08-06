"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

import { AttentionStrip } from "@/components/dashboard/attention-strip";
import { ComplianceRibbon } from "@/components/dashboard/compliance-ribbon";
import { DecideProveStrip } from "@/components/dashboard/decide-prove-strip";
import { HaveFleetMass } from "@/components/dashboard/have-fleet-mass";
import { NeedDemandFunnel } from "@/components/dashboard/need-demand-funnel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResultsScreen } from "@/components/dashboard/results-nav";
import type { DrillFilter, MetricsResponse } from "@/lib/metrics";
import { prefersReducedMotion } from "@/motion/use-dashboard-motion";

type OverviewPanelProps = {
  metrics: MetricsResponse;
  unlocked?: boolean;
  onNavigate: (screen: ResultsScreen, filter?: DrillFilter) => void;
  onStartStory?: () => void;
};

export function OverviewPanel({
  metrics,
  unlocked = true,
  onNavigate,
  onStartStory,
}: OverviewPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!unlocked || !rootRef.current || prefersReducedMotion()) return;
    const acts = rootRef.current.querySelectorAll("[data-act]");
    gsap.fromTo(
      acts,
      { opacity: 0, y: 12 },
      {
        opacity: 1,
        y: 0,
        duration: 0.22,
        stagger: 0.06,
        ease: "power2.out",
      }
    );
  }, [unlocked, metrics.n_batteries, metrics.n_vehicles]);

  if (!unlocked) {
    return (
      <div data-screen="overview" className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">
            Have packs → Serve priority demand → Beat HSF without unsafe packs.
          </p>
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div ref={rootRef} data-screen="overview" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Have packs → Serve priority demand → Beat HSF without unsafe packs.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => (onStartStory ? onStartStory() : onNavigate("story"))}
        >
          Start story
        </Button>
      </div>

      {/* The rubric first. A judge arrives with the problem statement in hand;
          this answers it before the narrative starts. */}
      <ComplianceRibbon metrics={metrics} onNavigate={onNavigate} />

      <HaveFleetMass
        classification={metrics.classification}
        nBatteries={metrics.n_batteries}
        onNavigate={onNavigate}
      />

      <NeedDemandFunnel
        assignments={metrics.assignments?.Proposed}
        nVehicles={metrics.n_vehicles}
        onNavigate={onNavigate}
      />

      <DecideProveStrip
        nBatteries={metrics.n_batteries}
        nVehicles={metrics.n_vehicles}
        proposed={metrics.comparison?.Proposed}
        hsf={metrics.comparison?.HSF}
        onNavigate={onNavigate}
      />

      <AttentionStrip metrics={metrics} onNavigate={onNavigate} />
    </div>
  );
}
