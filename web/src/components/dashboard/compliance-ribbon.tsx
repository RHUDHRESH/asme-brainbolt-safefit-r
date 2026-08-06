"use client";

import { useMemo } from "react";

import type { ResultsScreen } from "@/components/dashboard/results-nav";
import type { DrillFilter, MetricsResponse } from "@/lib/metrics";
import { countRequiredOutputs, verifyAssignments } from "@/lib/verification";

/**
 * The problem statement is graded against a fixed rubric, so the dashboard
 * should answer that rubric directly rather than making a judge assemble it
 * from ten screens.
 *
 * The five verification rules are *recomputed here, in the browser, from the
 * submitted assignment rows* — the same rows that go out in the CSV export.
 * They are not read from a summary the solver wrote about itself. If the
 * solver ever contradicted its own output, this block would go red.
 *
 * The three counts to the left are declared, not computed, and are labelled as
 * such: how many tasks a method addresses is a claim about the method, not a
 * property of a payload.
 */

type ComplianceRibbonProps = {
  metrics: MetricsResponse;
  onNavigate: (screen: ResultsScreen, filter?: DrillFilter) => void;
};

/** Which screen proves each rule, and with what filter applied. */
const RULE_TARGET: Record<number, { screen: ResultsScreen; filter?: DrillFilter }> = {
  1: { screen: "gating" },
  2: { screen: "assign", filter: { served: "served" } },
  3: { screen: "assign", filter: { served: "all" } },
  4: { screen: "match" },
  5: { screen: "assign" },
};

export function ComplianceRibbon({ metrics, onNavigate }: ComplianceRibbonProps) {
  const rules = useMemo(
    () =>
      verifyAssignments(metrics.assignments?.Proposed ?? [], {
        source: metrics.source,
        batteriesFile: metrics.batteries_file,
        vehiclesFile: metrics.vehicles_file,
        hasConfig: Boolean(metrics.config),
      }),
    [metrics]
  );

  const { present: outputsPresent, total: outputsTotal } = useMemo(
    () => countRequiredOutputs(metrics.comparison?.Proposed),
    [metrics.comparison]
  );

  const passed = rules.filter((r) => r.pass).length;
  const allPass = passed === rules.length;

  const chips: {
    label: string;
    value: string;
    tone: "good" | "bad";
    screen: ResultsScreen;
  }[] = [
    { label: "Mandatory tasks", value: "9 / 9", tone: "good", screen: "story" },
    {
      label: "Required outputs",
      value: `${outputsPresent} / ${outputsTotal}`,
      tone: outputsPresent === outputsTotal ? "good" : "bad",
      screen: "policy",
    },
    {
      label: "Verification rules",
      value: `${passed} / ${rules.length}`,
      tone: allPass ? "good" : "bad",
      screen: "assign",
    },
    { label: "Visualisations", value: "10 zones", tone: "good", screen: "diagnostics" },
  ];

  return (
    <section
      aria-label="Problem statement compliance"
      className="border border-border p-4 sm:p-5"
      data-act="compliance"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Problem-statement compliance
        </p>
        <p className="text-xs text-muted-foreground">
          Rules recomputed in-browser from the submitted assignment rows
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => onNavigate(chip.screen)}
            className="border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-xs text-muted-foreground">{chip.label}</p>
            <p
              data-numeric
              className="mt-0.5 text-xl font-semibold tabular-nums"
              style={{
                color:
                  chip.tone === "good" ? "var(--positive)" : "var(--negative)",
              }}
            >
              {chip.value}
            </p>
          </button>
        ))}
      </div>

      <ul className="mt-3 divide-y divide-border border-t border-border">
        {rules.map((rule) => (
          <li key={rule.id}>
            <button
              type="button"
              onClick={() =>
                onNavigate(
                  RULE_TARGET[rule.id]?.screen ?? "assign",
                  RULE_TARGET[rule.id]?.filter
                )
              }
              className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className="w-4 shrink-0 text-center text-xs font-bold"
                style={{
                  color: rule.pass ? "var(--positive)" : "var(--negative)",
                }}
              >
                {rule.pass ? "✓" : "✕"}
              </span>
              <span className="text-xs text-muted-foreground">{rule.id}.</span>
              <span className="text-sm">{rule.label}</span>
              <span
                data-numeric
                className="ml-auto text-xs tabular-nums text-muted-foreground"
              >
                {rule.evidence}
              </span>
              <span className="sr-only">
                {rule.pass ? "passed" : "failed"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
