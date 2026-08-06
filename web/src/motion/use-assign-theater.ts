"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import gsap from "gsap";

import type { AssignmentRow, FleetBattery } from "@/lib/metrics";
import { prefersReducedMotion } from "@/motion/use-dashboard-motion";

const PRIORITY_ORDER: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export function orderAssignments(rows: AssignmentRow[]): AssignmentRow[] {
  return [...rows]
    .filter((r) => r.served && r.battery_id)
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 9;
      const pb = PRIORITY_ORDER[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return a.vehicle_id.localeCompare(b.vehicle_id);
    });
}

type UseAssignTheaterArgs = {
  assignments: AssignmentRow[];
  autoPlayKey: number;
  speed: 1 | 2;
  enabled: boolean;
  onProgress: (assigned: number, total: number) => void;
  /** Fired each deal step with the committed pair (null on reset). */
  onStep: (row: AssignmentRow | null, index: number) => void;
};

/**
 * Deal-sequence theater: no DOM cell lighting.
 * Each step commits one assignment via onStep for the Pairing Desk UI.
 */
export function useAssignTheater({
  assignments,
  autoPlayKey,
  speed,
  enabled,
  onProgress,
  onStep,
}: UseAssignTheaterArgs) {
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const ordered = useMemo(() => orderAssignments(assignments), [assignments]);
  // The timeline reads these through refs so a re-render with new callbacks
  // never tears down a running animation. Syncing them in an effect rather than
  // during render keeps the write out of the render phase.
  const onStepRef = useRef(onStep);
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onStepRef.current = onStep;
    onProgressRef.current = onProgress;
  }, [onStep, onProgress]);

  const kill = useCallback(() => {
    tlRef.current?.kill();
    tlRef.current = null;
  }, []);

  const revealFinal = useCallback(() => {
    ordered.forEach((row, i) => {
      onStepRef.current(row, i);
    });
    if (ordered.length > 0) {
      onStepRef.current(ordered[ordered.length - 1], ordered.length - 1);
    } else {
      onStepRef.current(null, -1);
    }
    onProgressRef.current(ordered.length, ordered.length);
  }, [ordered]);

  const reset = useCallback(() => {
    onStepRef.current(null, -1);
    onProgressRef.current(0, ordered.length);
  }, [ordered.length]);

  const play = useCallback(() => {
    kill();
    if (!enabled || ordered.length === 0) {
      revealFinal();
      return;
    }

    if (prefersReducedMotion()) {
      revealFinal();
      return;
    }

    reset();
    const tl = gsap.timeline({
      onComplete: () => onProgressRef.current(ordered.length, ordered.length),
    });
    tlRef.current = tl;

    const step = 0.28 / speed;
    ordered.forEach((row, i) => {
      tl.add(() => {
        onStepRef.current(row, i);
        onProgressRef.current(i + 1, ordered.length);
      }, i * step);
    });
  }, [enabled, kill, ordered, reset, revealFinal, speed]);

  const pause = useCallback(() => {
    tlRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    tlRef.current?.resume();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    play();
    return () => kill();
  }, [autoPlayKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { play, pause, resume, kill, ordered, revealFinal, reset };
}

export function fleetToAssignmentRow(b: FleetBattery): AssignmentRow {
  return {
    vehicle_id: b.assigned_vehicle_id ?? "—",
    priority: b.priority ?? "—",
    served: Boolean(b.assigned_vehicle_id),
    battery_id: b.battery_id,
    status: b.status,
    SoC: b.SoC,
    SoH: b.SoH,
    BSS: b.BSS,
    T_score: b.T_score,
    R_int_mOhm: b.R_int_mOhm,
  };
}
