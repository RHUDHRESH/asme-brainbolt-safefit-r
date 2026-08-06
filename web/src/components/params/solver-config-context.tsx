"use client";

import { createContext, useContext, useMemo } from "react";

import type { SolverConfig } from "@/lib/metrics";

/**
 * Solver thresholds travel down the tree instead of being re-declared in each
 * chart. Value is null until a run completes — components must handle that,
 * which is what keeps the locked/empty state honest.
 */
const SolverConfigContext = createContext<SolverConfig | null>(null);

export function SolverConfigProvider({
  config,
  children,
}: {
  config: SolverConfig | null | undefined;
  children: React.ReactNode;
}) {
  const value = useMemo(() => config ?? null, [config]);
  return (
    <SolverConfigContext.Provider value={value}>
      {children}
    </SolverConfigContext.Provider>
  );
}

export function useSolverConfig(): SolverConfig | null {
  return useContext(SolverConfigContext);
}

/** Thresholds for a single parameter, resolved from the live solver config. */
export function useThresholds() {
  const cfg = useSolverConfig();
  return cfg?.thresholds ?? null;
}
