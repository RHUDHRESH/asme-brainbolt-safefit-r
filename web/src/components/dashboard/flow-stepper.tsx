"use client";

import { cn } from "@/lib/utils";

type FlowStepperProps = {
  batteriesOk: boolean;
  vehiclesOk: boolean;
  canRun: boolean;
  running: boolean;
  completed: boolean;
};

export function FlowStepper({
  batteriesOk,
  vehiclesOk,
  canRun,
  running,
  completed,
}: FlowStepperProps) {
  const steps = [
    { label: "Batteries", done: batteriesOk },
    { label: "Requests", done: vehiclesOk },
    { label: "Run", done: completed || running },
  ];

  return (
    <nav
      aria-label="Upload progress"
      className="sticky top-0 z-20 -mx-6 border-b border-border/80 bg-background/90 px-6 py-3 backdrop-blur-sm md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
    >
      <ol className="flex items-center gap-2">
        {steps.map((step, i) => (
          <li key={step.label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex h-8 flex-1 items-center justify-center rounded-md border text-xs font-medium transition-colors duration-300",
                step.done
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground"
              )}
            >
              {i + 1}. {step.label}
            </div>
            {i < steps.length - 1 ? (
              <span className="hidden text-muted-foreground sm:inline">→</span>
            ) : null}
          </li>
        ))}
      </ol>
      {canRun && !completed && !running ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Both files valid — click Run on uploads.
        </p>
      ) : null}
    </nav>
  );
}
