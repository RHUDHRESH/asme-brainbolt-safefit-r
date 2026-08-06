"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Ordered to mirror the seven presentation screens judges are walked through. */
export const RESULTS_SCREENS = [
  "overview",
  "story",
  "gating",
  "scoring",
  "fleet",
  "match",
  "policy",
  "assign",
  "compare",
  "diagnostics",
] as const;

export type ResultsScreen = (typeof RESULTS_SCREENS)[number];

export const ZONE_LABELS: Record<ResultsScreen, string> = {
  overview: "Overview",
  story: "Story",
  gating: "Gating",
  scoring: "Scoring",
  fleet: "Fleet",
  match: "Match",
  policy: "Policy",
  assign: "Assign",
  compare: "Compare",
  diagnostics: "Diagnostics",
};

/** Stage number shown in the rail, tying each zone back to the pipeline. */
export const ZONE_STAGE: Partial<Record<ResultsScreen, string>> = {
  gating: "S1–2",
  scoring: "S3",
  match: "S4",
};

type ResultsNavProps = {
  value: ResultsScreen;
  onChange: (screen: ResultsScreen) => void;
  className?: string;
  orientation?: "vertical" | "horizontal";
  locked?: boolean;
};

export function ResultsNav({
  value,
  onChange,
  className,
  orientation = "vertical",
  locked = false,
}: ResultsNavProps) {
  if (orientation === "horizontal") {
    return (
      <nav
        aria-label="Results zones"
        className={cn(
          "flex gap-1 overflow-x-auto border-b border-border pb-3",
          className
        )}
      >
        {RESULTS_SCREENS.map((screen) => {
          const active = value === screen;
          return (
            <Button
              key={screen}
              type="button"
              size="sm"
              variant={active ? "default" : "ghost"}
              disabled={locked}
              aria-current={active ? "page" : undefined}
              onClick={() => onChange(screen)}
              className="shrink-0"
            >
              {ZONE_LABELS[screen]}
            </Button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Zones"
      className={cn(
        "flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border pb-3 lg:w-44 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4",
        className
      )}
    >
      <p className="mb-1 hidden px-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase lg:block">
        Zones
      </p>
      {RESULTS_SCREENS.map((screen) => {
        const active = value === screen;
        const stage = ZONE_STAGE[screen];
        return (
          <Button
            key={screen}
            type="button"
            size="sm"
            variant={active ? "default" : "ghost"}
            disabled={locked}
            aria-current={active ? "page" : undefined}
            data-active={active ? "true" : undefined}
            onClick={() => onChange(screen)}
            className={cn(
              "group shrink-0 justify-start gap-2 lg:w-full",
              active && "bg-primary text-primary-foreground",
              !active && "text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "hidden h-4 w-0.5 shrink-0 rounded-full transition-colors lg:block",
                active ? "bg-primary-foreground" : "bg-border group-hover:bg-accent"
              )}
            />
            <span className="min-w-0 flex-1 truncate text-left">
              {ZONE_LABELS[screen]}
            </span>
            {stage ? (
              <span
                data-numeric
                className={cn(
                  "hidden shrink-0 text-[9px] tracking-tight lg:inline",
                  active ? "opacity-70" : "opacity-50"
                )}
              >
                {stage}
              </span>
            ) : null}
          </Button>
        );
      })}
    </nav>
  );
}

/** @deprecated use ZONE_LABELS */
export const LABELS = ZONE_LABELS;
