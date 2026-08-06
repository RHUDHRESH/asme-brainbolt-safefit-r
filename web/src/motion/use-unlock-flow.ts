"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

import { prefersReducedMotion } from "@/motion/use-dashboard-motion";
import type { FlowPhase } from "@/lib/metrics";

type UnlockFlowArgs = {
  root: React.RefObject<HTMLElement | null>;
  phase: FlowPhase;
  canRunUpload: boolean;
  unlockKey: number;
  resultsScreen?: string;
};

export function useUnlockFlow({
  root,
  phase,
  canRunUpload,
  unlockKey,
  resultsScreen,
}: UnlockFlowArgs) {
  const prevScreen = useRef<string | undefined>(undefined);

  useGSAP(
    () => {
      if (!root.current || prefersReducedMotion()) return;

      const gate = root.current.querySelector('[data-motion="results-gate"]');
      const upload = root.current.querySelector('[data-motion="upload"]');
      const cta = root.current.querySelector('[data-motion="run-cta"]');

      if (phase === "empty" || phase === "upload") {
        if (gate) gsap.set(gate, { opacity: 1 });
        if (upload) {
          gsap.fromTo(
            upload,
            { opacity: 0, y: 12 },
            { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }
          );
        }
      }

      if (cta) {
        gsap.to(cta, {
          opacity: canRunUpload ? 1 : 0.45,
          scale: canRunUpload ? 1 : 0.99,
          duration: 0.35,
          ease: "power2.out",
        });
      }

      if (phase === "running" && upload) {
        gsap.to(upload, { opacity: 0.7, duration: 0.3 });
      }

      if (phase === "results" && gate) {
        const tl = gsap.timeline();
        tl.fromTo(
          gate,
          { opacity: 0.35, y: 10 },
          { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }
        );
        const kpis = gate.querySelectorAll("[data-kpi]");
        if (kpis.length) {
          tl.fromTo(
            kpis,
            { opacity: 0, y: 14 },
            { opacity: 1, y: 0, stagger: 0.07, duration: 0.4, ease: "power2.out" },
            "-=0.1"
          );
        }
        const panels = gate.querySelectorAll(
          '[data-motion="fleet"], [data-motion="policy"]'
        );
        if (panels.length) {
          tl.fromTo(
            panels,
            { opacity: 0, y: 12 },
            { opacity: 1, y: 0, stagger: 0.1, duration: 0.4, ease: "power2.out" },
            "-=0.15"
          );
        }
      }
    },
    { dependencies: [phase, canRunUpload, unlockKey] }
  );

  useEffect(() => {
    if (!root.current || prefersReducedMotion()) {
      prevScreen.current = resultsScreen;
      return;
    }
    if (phase !== "results" || !resultsScreen) {
      prevScreen.current = resultsScreen;
      return;
    }
    if (prevScreen.current === resultsScreen) return;

    const panel = root.current.querySelector(
      `[data-screen="${resultsScreen}"]`
    );
    if (panel) {
      gsap.fromTo(
        panel,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" }
      );
    }
    prevScreen.current = resultsScreen;
  }, [phase, resultsScreen, root]);
}

export function pulseDrop(el: HTMLElement | null, ok: boolean) {
  if (!el || prefersReducedMotion()) return;
  if (ok) {
    gsap.fromTo(el, { scale: 1.02 }, { scale: 1, duration: 0.25, ease: "power2.out" });
  } else {
    gsap
      .timeline()
      .to(el, { x: -4, duration: 0.05 })
      .to(el, { x: 4, duration: 0.08 })
      .to(el, { x: -2, duration: 0.06 })
      .to(el, { x: 0, duration: 0.06 });
  }
}

export function useBarReveal(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !active || prefersReducedMotion()) return;
    const bars = ref.current.querySelectorAll("[data-bar-fill]");
    gsap.fromTo(
      bars,
      { scaleX: 0 },
      {
        scaleX: 1,
        transformOrigin: "left center",
        stagger: 0.06,
        duration: 0.55,
        ease: "power2.out",
      }
    );
  }, [active]);
  return ref;
}
