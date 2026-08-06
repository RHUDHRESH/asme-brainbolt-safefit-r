import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  {
    n: "01",
    title: "Integrity pre-screen",
    body: "Thermal history, pack voltage conservation, energy residual checks.",
  },
  {
    n: "02",
    title: "Safety gating",
    body: "Hard tiers: Safe, Degraded, Quarantine — quarantine never dispatched.",
  },
  {
    n: "03",
    title: "MAUT + TOPSIS",
    body: "Dual suitability engines normalize health into comparable scores.",
  },
  {
    n: "04",
    title: "Bipartite matching",
    body: "Hungarian solver maximizes priority-weighted utility under SoC constraints.",
  },
  {
    n: "05",
    title: "Joule + twists",
    body: "I²R load matching with hooks for grid, TOU, and queue defection.",
  },
];

export function PipelineSteps() {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Dispatch pipeline</CardTitle>
        <CardDescription>Five sequential stages from telemetry to assignment.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {STEPS.map((step) => (
            <li key={step.n} className="space-y-2 border-l border-border pl-3">
              <p className="text-xs font-medium tracking-wider text-muted-foreground">
                {step.n}
              </p>
              <p className="font-medium text-foreground">{step.title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
