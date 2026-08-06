"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

import { GLOSSARY_KEYS, TERMS, type TermKey } from "@/lib/terms";
import { cn } from "@/lib/utils";

const SeenCtx = createContext<{ mark: (k: TermKey) => boolean } | null>(null);

/** Tracks first-use expansions within a page tree. */
export function TermProvider({ children }: { children: ReactNode }) {
  const seen = useRef(new Set<TermKey>());
  const api = useMemo(
    () => ({
      mark: (k: TermKey) => {
        if (seen.current.has(k)) return false;
        seen.current.add(k);
        return true;
      },
    }),
    []
  );
  return <SeenCtx.Provider value={api}>{children}</SeenCtx.Provider>;
}

type TermProps = {
  of: TermKey;
  /** Force expand / abbr / full regardless of first-use. */
  mode?: "auto" | "expand" | "abbr" | "full";
  className?: string;
  title?: boolean;
};

export function Term({ of: key, mode = "auto", className, title }: TermProps) {
  const ctx = useContext(SeenCtx);
  const t = TERMS[key];
  let text: string;
  if (mode === "abbr") text = t.abbr;
  else if (mode === "full") text = t.full;
  else if (mode === "expand") text = `${t.abbr} (${t.full})`;
  else {
    const first = ctx?.mark(key) ?? true;
    text = first ? `${t.abbr} (${t.full})` : t.abbr;
  }

  return (
    <abbr
      className={cn("no-underline", className)}
      title={title === false ? undefined : `${t.full} — ${t.definition}`}
    >
      {text}
    </abbr>
  );
}

export function GlossaryStrip({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 border-b border-border/80 bg-background/95 backdrop-blur-sm",
        className
      )}
    >
      <div className="mx-auto flex w-full max-w-5xl gap-x-4 gap-y-1 overflow-x-auto px-4 py-2.5 sm:px-6">
        {GLOSSARY_KEYS.map((key) => {
          const t = TERMS[key];
          return (
            <span
              key={key}
              className="shrink-0 text-[11px] leading-snug text-muted-foreground"
              title={t.definition}
            >
              <span className="font-semibold text-foreground">{t.abbr}</span>
              <span className="mx-1 text-border">·</span>
              <span>{t.full}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
