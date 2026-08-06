/**
 * Canonical abbreviations → full forms for the judge-facing UI.
 * First-use expansion and the sticky glossary both read from here.
 */

export type TermDef = {
  abbr: string;
  full: string;
  definition: string;
};

export const TERMS = {
  SoC: {
    abbr: "SoC",
    full: "State of Charge",
    definition: "How full the pack is right now, as a percent of rated capacity.",
  },
  SoH: {
    abbr: "SoH",
    full: "State of Health",
    definition: "Remaining capacity relative to a new pack — the primary longevity signal.",
  },
  BSS: {
    abbr: "BSS",
    full: "Battery Suitability Score",
    definition: "0–100 score from SoH, internal resistance, cell imbalance, and temperature.",
  },
  HSF: {
    abbr: "HSF",
    full: "Highest-SoC-First",
    definition:
      "Fixed baseline: serve requests in arrival order with the highest-SoC pack that meets min SoC — no health gate.",
  },
  R_int: {
    abbr: "R_int",
    full: "Internal Resistance",
    definition: "DCIR of the pack in milliohms — high values mean heat and voltage sag under load.",
  },
  dV: {
    abbr: "ΔV",
    full: "Cell Voltage Imbalance",
    definition: "Spread between the highest and lowest cell voltages in the series string.",
  },
  T: {
    abbr: "T",
    full: "Temperature",
    definition: "Live pack temperature in °C — hard-blocked outside the safe thermal window.",
  },
  MAUT: {
    abbr: "MAUT",
    full: "Multi-Attribute Utility Theory",
    definition: "Weighted utility used to build the Battery Suitability Score.",
  },
  TOPSIS: {
    abbr: "TOPSIS",
    full: "Technique for Order Preference by Similarity to Ideal Solution",
    definition: "Cross-check ranking method run alongside MAUT for score consistency.",
  },
} as const satisfies Record<string, TermDef>;

export type TermKey = keyof typeof TERMS;

/** Ordered glossary strip for the sticky header. */
export const GLOSSARY_KEYS: TermKey[] = [
  "SoC",
  "SoH",
  "BSS",
  "HSF",
  "R_int",
  "dV",
  "T",
];

export function expand(key: TermKey): string {
  const t = TERMS[key];
  return `${t.abbr} (${t.full})`;
}

export function label(key: TermKey, mode: "abbr" | "full" | "expand" = "expand"): string {
  const t = TERMS[key];
  if (mode === "abbr") return t.abbr;
  if (mode === "full") return t.full;
  return expand(key);
}
