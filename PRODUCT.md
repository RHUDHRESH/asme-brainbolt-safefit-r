# PRODUCT.md — BSS Dispatch

## Product
Battery Swapping Station (BSS) operations dashboard for Siemens Energy / ASME Brain Bolt 2026.

## Mode
**Operate** — task completion, not marketing persuasion.

## Audience
Competition judges and operators who upload fleet CSVs and must trust that metrics only appear after a real run.

## Core promise
No fake data, ever. Cold start is empty/locked until the user uploads batteries + vehicles CSVs and runs. There is no synthetic mode anywhere in the system.

## Primary flows
1. Upload batteries.csv + vehicles.csv → Run on uploads → unlock results on the **Judge page** (`/`)
2. Optional deep dive: **Lab** (`/lab`) — 10-zone diagnostics rail

## Information architecture
- **`/` Judge page** — single scroll: glossary (full forms) → upload → 6 mandatory KPIs → classify with exact quarantine reasons → BSS score → assignments with always-visible Reason column → 3 charts → Proposed vs Highest-SoC-First
- **`/lab`** — previous multi-zone command hub (pipeline theater, story coach, twist hooks)

## Anti-goals
- Any synthetic or generated fleet reaching a chart, metric, or export
- Auto-loading prior `outputs/` as if the user provided data
- Painting seed KPIs / Fleet Health on first paint
- Decorative dashboard clutter before data exists
