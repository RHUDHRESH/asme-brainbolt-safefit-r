# BSS Dispatch UI (`web/`)

Next.js dashboard for the ASME BSS solver — shadcn + Uber Base + GSAP motion.

## Run

```bash
cd web
pnpm install
pnpm dev
```

Open http://localhost:3000

| Route | Audience |
|---|---|
| `/` | **Judge page** — single scroll, full-form acronyms, exact quarantine reasons |
| `/lab` | Deep-dive 10-zone diagnostics (previous dashboard) |

## Empty-first flow

Cold load returns `source: "empty"` — no seed KPIs, no auto-paint of prior `outputs/`. Results stay locked until **Run on uploads** succeeds (`runCompleted`).

Phases: `empty` → `upload` → `running` → `results` (`data-phase` on `<main>`).

Append `?resume=1` to reload the last successful run without re-uploading.

## Upload demo

1. Grab samples from `/samples/batteries.sample.csv` and `/samples/vehicles.sample.csv` (or Problem 1 samples)
2. Drop them into the two upload zones
3. **Run on uploads** posts multipart form data to `/api/simulate`
4. Python runs `bss_dispatch --batteries … --vehicles …`
5. Judge page unlocks: 6 mandatory KPIs, classification with reason codes + full English, assignments with a permanent Reason column, three charts

ASME Problem 1 fleet/demand CSVs auto-map (`state_of_charge_percent` → SoC, `request_id` → vehicle_id, `Normal` → Medium).

## Glossary (always on the judge page)

| Abbr | Full form |
|---|---|
| SoC | State of Charge |
| SoH | State of Health |
| BSS | Battery Suitability Score |
| HSF | Highest-SoC-First |
| R_int | Internal Resistance |
| ΔV | Cell Voltage Imbalance |
| T | Temperature |

## API

- `GET /api/metrics` — empty by default; `?resume=1` loads last `run_result.json`
- `POST /api/simulate` — multipart `batteries` + `vehicles` = upload run

## Decks

From repo root:

```powershell
.\scripts\build_all_decks.ps1
```

Writes:

- `outputs/BSS_Problem1_Judge_Deck.pptx` — Problem 1 compliance deck
- `outputs/BSS_RT_TierS_Deck.pptx` — Tier-S real-time research deck
