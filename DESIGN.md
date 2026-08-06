# DESIGN.md — BSS Dispatch

## Visual system
- Runtime: Next.js + shadcn + **Uber Base** structure, **Dark Industrial** surface
- Base: near-black `#05070A` / white `#FFF` / accent `#276EF1`
- Typography: Geist Sans / Geist Mono; type scale ~14 × 1.125. All numeric readouts carry `data-numeric` → mono + tabular figures
- Spacing: 4px grid (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64)
- Radius: ≤ 8px
- Motion: GSAP + CSS, transform/opacity only, 150–250ms; every ambient loop disabled under `prefers-reduced-motion`
- One accent-forward action per viewport

### Health badging system
| Class | Token | Dark | Glyph | Action |
|---|---|---|---|---|
| Safe & Available | `--health-safe` | `#10B981` | ✓ | Direct dispatch |
| Degraded but Usable | `--health-degraded` | `#F59E0B` | ▲ | Blocked from Critical/High |
| Unsafe / Quarantine | `--health-unsafe` | `#EF4444` | ⬤ + hazard stripes | Hard-blocked `x_ij = 0` |

### Vehicle priority tiers
| Tier | Token | Dark |
|---|---|---|
| Critical | `--prio-critical` | `#7C3AED` |
| High | `--prio-high` | `#2563EB` |
| Medium (Problem 1 `Normal`) | `--prio-medium` | `#0891B2` |
| Low | `--prio-low` | `#64748B` |

Utility weights are **not** design constants — they are read from the solver's
`config` block at runtime (`priority_weights`), so a `config.py` edit moves the UI.

### Parameter visual language
`src/components/params/param-primitives.tsx` — one primitive per parameter:
`SocPill` (fill bar + min-SoC marker), `SohRadial` (270° arc), `IrCard` (DCIR
micro-card, pulsing hazard ring past the limit), `ImbalanceSparkline` (per-cell
bars across the pack's series count), `ThermoCard` (now vs 24 h peak + sensor-fault
banner), `HealthBadge`, `PriorityChip`.

Every alert band resolves from `SolverConfigProvider`, never from a literal. The
one exception is SoC display banding (80/50), which has no solver equivalent —
SoC is a per-request feasibility check, not a health gate.

## Information architecture
- **Judge page (`/`)**: one scroll for Siemens Problem 1 — upload → mandatory KPIs → classify (exact reasons + full forms) → score → assign → vs HSF → three charts
- **Lab (`/lab`)**: Overview + left Zones rail (10 results screens) for deep diagnostics
- Lab rail maps to the pipeline: Gating `S1–2`, Scoring `S3`, Match `S4`, Twist `S5`
- Progressive disclosure: Upload → Run → Results unlock
- Cards only for interactive/data containers
- One primary CTA per phase (“Run on uploads”)
- Acronyms expand via sticky glossary + `<Term>` (SoC, SoH, BSS, HSF, R_int, ΔV, T)
## UX principles
1. **Empty first** — results gate locked until `runCompleted`
2. **What / Why / Next** on empty overlay
3. Glance Overview; density lives in Zones
4. Zones open at summary; charts/details expand on demand

## States
| Phase | Visible | Locked |
|---|---|---|
| empty | Upload + stepper | Results |
| upload | Files validating | Results still locked |
| running | Pipeline theater | Results still locked |
| results | Hub + Zones rail; Run setup tucked | Unlocked |
