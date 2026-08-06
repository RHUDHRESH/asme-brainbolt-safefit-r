"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prefersReducedMotion } from "@/motion/use-dashboard-motion";
import { cn } from "@/lib/utils";

const STAGES = [
  { id: "1", label: "Integrity" },
  { id: "2", label: "Safety gate" },
  { id: "3", label: "MAUT / TOPSIS" },
  { id: "4", label: "Matching" },
  { id: "5", label: "Joule / twists" },
];

type PipelineTheaterProps = {
  running: boolean;
  progress: number;
};

export function PipelineTheater({ running, progress }: PipelineTheaterProps) {
  const root = useRef<HTMLDivElement>(null);
  const active = Math.min(4, Math.floor((progress / 100) * 5));
  const reduce = typeof window !== "undefined" && prefersReducedMotion();

  useGSAP(
    () => {
      if (!root.current || reduce) return;
      gsap.fromTo(
        root.current.querySelectorAll("[data-stage]"),
        { opacity: 0.35, y: 6 },
        { opacity: 1, y: 0, stagger: 0.06, duration: 0.35, ease: "power2.out" }
      );
    },
    { scope: root, dependencies: [running] }
  );

  useEffect(() => {
    if (!root.current || reduce || !running) return;
    const el = root.current.querySelector(`[data-stage="${active}"]`);
    if (!el) return;
    gsap.fromTo(el, { scale: 0.98 }, { scale: 1, duration: 0.25, ease: "power2.out" });
  }, [active, running, reduce]);

  useEffect(() => {
    if (!root.current || reduce) return;
    const fill = root.current.querySelector("[data-progress-fill]") as HTMLElement | null;
    if (!fill) return;
    gsap.to(fill, {
      scaleX: Math.max(running ? 0.08 : 0, progress / 100),
      duration: 0.4,
      ease: "power2.out",
      transformOrigin: "left center",
    });
  }, [progress, running, reduce]);

  return (
    <div ref={root} data-motion="theater">
      <Card className="shadow-none overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {running ? "Running pipeline…" : "Pipeline ready"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 sm:grid-cols-5">
            {STAGES.map((stage, idx) => {
              const done =
                progress >= ((idx + 1) / 5) * 100 || (!running && progress >= 100);
              const current = running && idx === active;
              return (
                <li
                  key={stage.id}
                  data-stage={idx}
                  className={cn(
                    "rounded-lg border border-border px-3 py-3 transition-all duration-300",
                    current && "border-foreground bg-muted/50",
                    done && !current && "bg-muted/30"
                  )}
                >
                  <p className="text-[10px] tracking-wider text-muted-foreground uppercase">
                    Stage {stage.id}
                  </p>
                  <p className="mt-1 text-sm font-medium">{stage.label}</p>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              data-progress-fill
              className="h-full origin-left rounded-full bg-foreground"
              style={{ transform: `scaleX(${reduce ? progress / 100 : 0})` }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
