"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

import { StoryPanel } from "@/components/dashboard/story-panel";
import type { ResultsScreen } from "@/components/dashboard/results-nav";
import { Button } from "@/components/ui/button";
import type { MetricsResponse } from "@/lib/metrics";
import { prefersReducedMotion } from "@/motion/use-dashboard-motion";
import { cn } from "@/lib/utils";

type StoryCoachDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beat: number;
  onBeatChange: (beat: number) => void;
  onJump: (screen: ResultsScreen) => void;
  /** The drawer shows the same evidence-backed beats as the Story zone. */
  metrics: MetricsResponse;
};

export function StoryCoachDrawer({
  open,
  onOpenChange,
  beat,
  onBeatChange,
  onJump,
  metrics,
}: StoryCoachDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelRef.current || prefersReducedMotion()) return;
    if (open) {
      gsap.fromTo(
        panelRef.current,
        { x: 24, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.22, ease: "power2.out" }
      );
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Judge story coach"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        aria-label="Close story coach"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        className={cn(
          "relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-background p-4 shadow-lg sm:p-6"
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Coach
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
        <StoryPanel
          beat={beat}
          onBeatChange={onBeatChange}
          onJump={(screen) => {
            onJump(screen);
          }}
          onExitOverview={() => {
            onOpenChange(false);
            onJump("overview");
          }}
          metrics={metrics}
        />
      </div>
    </div>
  );
}
