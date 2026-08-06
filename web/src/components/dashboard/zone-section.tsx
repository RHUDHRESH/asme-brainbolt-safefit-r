"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ZoneSectionProps = {
  title: string;
  description?: string;
  /** Optional action row (export, filters) */
  actions?: ReactNode;
  /** When set, shows a disclosure toggle for denser content */
  detailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
  detailsLabel?: string;
  detailsHideLabel?: string;
  details?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ZoneSection({
  title,
  description,
  actions,
  detailsOpen,
  onDetailsOpenChange,
  detailsLabel = "Show charts / details",
  detailsHideLabel = "Hide charts / details",
  details,
  children,
  className,
}: ZoneSectionProps) {
  const canToggle = details != null && onDetailsOpenChange != null;

  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          {canToggle ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onDetailsOpenChange!(!detailsOpen)}
            >
              {detailsOpen ? detailsHideLabel : detailsLabel}
            </Button>
          ) : null}
        </div>
      </div>
      {children}
      {canToggle && detailsOpen ? (
        <div className="space-y-4 border-t border-border pt-4">{details}</div>
      ) : null}
    </section>
  );
}
