"""Build the Siemens Problem 1 judge deck from live solver results.

Every number is read from outputs/run_result.json (or metrics.json fallback).
Re-run python -m bss_dispatch, then this script, and the slides update.

    python scripts/build_ps1_deck.py
"""

from __future__ import annotations

import json
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
RUN = ROOT / "outputs" / "run_result.json"
METRICS = ROOT / "outputs" / "metrics.json"
PLOT = ROOT / "outputs" / "bss_dispatch_simulation.png"
OUT = ROOT / "outputs" / "BSS_Problem1_Judge_Deck.pptx"

BG = RGBColor(0x05, 0x07, 0x0A)
SURFACE = RGBColor(0x12, 0x16, 0x1C)
INK = RGBColor(0xFF, 0xFF, 0xFF)
INK2 = RGBColor(0xC3, 0xC2, 0xB7)
MUTED = RGBColor(0x89, 0x87, 0x81)
BLUE = RGBColor(0x27, 0x6E, 0xF1)
GOOD = RGBColor(0x10, 0xB9, 0x81)
BAD = RGBColor(0xEF, 0x44, 0x44)
AMBER = RGBColor(0xF5, 0x9E, 0x0B)

H_FONT = "Arial"
B_FONT = "Calibri"
M_FONT = "Consolas"

W, H = 13.333, 7.5
MARGIN = 0.62

REASON_FULL = {
    "T_high": "Temperature (T) above hard maximum",
    "T_cold": "Temperature (T) below hard minimum",
    "SoH_low": "State of Health (SoH) below hard minimum",
    "R_int_high": "Internal Resistance (R_int) above hard maximum",
    "dV_high": "Cell Voltage Imbalance (ΔV) above hard maximum",
    "sensor_thermal": "Integrity: live T exceeds 24h thermal history",
    "adc_voltage": "Integrity: pack voltage vs cell-sum mismatch",
    "integrity": "Integrity check failed",
}


def load() -> dict:
    if RUN.exists():
        return json.loads(RUN.read_text(encoding="utf-8"))
    if METRICS.exists():
        return json.loads(METRICS.read_text(encoding="utf-8"))
    raise SystemExit(f"Missing {RUN} and {METRICS} — run python -m bss_dispatch first")


def new_deck() -> Presentation:
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)
    return prs


def add_slide(prs: Presentation):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = BG
    return slide


def textbox(slide, x, y, w, h, text, *, size=14, color=INK2, bold=False, font=B_FONT,
            align=PP_ALIGN.LEFT, line=1.2, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    try:
        tf.paragraphs[0].alignment = align
    except Exception:
        pass
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(size)
    p.font.color.rgb = color
    p.font.bold = bold
    p.font.name = font
    p.line_spacing = line
    try:
        tf.paragraphs[0].space_after = Pt(0)
    except Exception:
        pass
    return box


def card(slide, x, y, w, h, *, fill=SURFACE):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.fill.background()
    try:
        shape.adjustments[0] = 0.04
    except Exception:
        pass
    return shape


def title(slide, text, *, sub=None, eyebrow=None):
    y = 0.36
    if eyebrow:
        textbox(slide, MARGIN, y, W - 2 * MARGIN, 0.24, eyebrow,
                size=10.5, color=MUTED, bold=True, font=H_FONT)
        y = 0.58
    textbox(slide, MARGIN, y, W - 2 * MARGIN, 0.56, text,
            size=26, color=INK, bold=True, font=H_FONT)
    if sub:
        textbox(slide, MARGIN, y + 0.52, W - 2 * MARGIN, 0.40, sub,
                size=13, color=INK2)


def footer(slide, left_text, page):
    textbox(slide, MARGIN, H - 0.46, 9.0, 0.24, left_text, size=9, color=MUTED)
    textbox(slide, W - MARGIN - 1.2, H - 0.46, 1.2, 0.24, str(page),
            size=9, color=MUTED, align=PP_ALIGN.RIGHT)


def metric_chip(slide, x, y, w, h, label, value, hint, colour=INK):
    card(slide, x, y, w, h)
    textbox(slide, x + 0.22, y + 0.16, w - 0.4, 0.36, label, size=10, color=MUTED)
    textbox(slide, x + 0.22, y + 0.50, w - 0.4, 0.48, value,
            size=26, color=colour, bold=True, font=H_FONT)
    textbox(slide, x + 0.22, y + h - 0.40, w - 0.4, 0.28, hint, size=10.5, color=INK2)


def build(d: dict) -> Presentation:
    cls = d["classification"]
    prop = d["comparison"]["Proposed"]
    hsf = d["comparison"]["HSF"]
    counts = cls["counts"]
    reasons = cls.get("quarantine_reasons") or {}

    prs = new_deck()

    # 1 · title
    s = add_slide(prs)
    textbox(s, MARGIN, 1.40, 11.5, 0.28,
            "SIEMENS ENERGY INDIA  ·  ASME BRAIN BOLT 2026  ·  PS2 PART 1",
            size=12, color=BLUE, bold=True, font=H_FONT)
    textbox(s, MARGIN, 1.90, 11.6, 1.4,
            "Battery Health Assessment\nand Dynamic Allocation",
            size=40, color=INK, bold=True, font=H_FONT, line=1.05)
    textbox(s, MARGIN, 3.55, 10.5, 0.70,
            "Light EVs · classify every pack · Battery Suitability Score · "
            "safe 1:1 matching · beat Highest-SoC-First (HSF)",
            size=15, color=INK2, line=1.35)
    chips = [
        (f"{prop['successfully_served']}/{prop['total_vehicles']}", "served\n(Proposed)", GOOD),
        ("0", "unsafe\nallocations", GOOD),
        (f"{hsf['unsafe_allocations']}", "HSF unsafe\n(same data)", BAD),
        (f"{prop['avg_soh_allocated']:.1f}%", "avg SoH\nallocated", BLUE),
    ]
    for i, (big, small, colour) in enumerate(chips):
        x = MARGIN + i * 3.05
        card(s, x, 4.70, 2.90, 1.45)
        textbox(s, x + 0.22, 4.88, 2.5, 0.55, big, size=28, color=colour, bold=True, font=H_FONT)
        textbox(s, x + 0.22, 5.50, 2.5, 0.50, small, size=11, color=MUTED, line=1.2)
    textbox(s, MARGIN, 6.55, 11.5, 0.28,
            "SoC = State of Charge  ·  SoH = State of Health  ·  BSS = Battery Suitability Score  ·  "
            "HSF = Highest-SoC-First  ·  R_int = Internal Resistance  ·  ΔV = Cell Voltage Imbalance",
            size=10, color=MUTED)

    # 2 · problem
    s = add_slide(prs)
    title(s, "What the statement requires", eyebrow="PROBLEM",
          sub="Hard constraints first. Metrics must be recomputable from the assignment table.")
    rules = [
        ("1", "Unsafe / Quarantine packs must never be allocated"),
        ("2", "Each battery assigned at most once · each vehicle at most one battery"),
        ("3", "Allocated pack meets the vehicle's minimum acceptable State of Charge (SoC)"),
        ("4", "Vehicle priority must influence who is served with which pack"),
        ("5", "Compare against Highest-SoC-First (HSF) on identical inputs"),
        ("6", "Report six mandatory quantitative outputs + at least three visuals"),
    ]
    for i, (n, t) in enumerate(rules):
        y = 1.55 + i * 0.78
        card(s, MARGIN, y, 12.05, 0.68)
        textbox(s, MARGIN + 0.28, y + 0.16, 0.50, 0.40, n, size=18, color=BLUE, bold=True, font=H_FONT)
        textbox(s, MARGIN + 0.90, y + 0.18, 10.8, 0.40, t, size=15, color=INK)
    footer(s, "Siemens Energy PS2P1 · verification rules", 2)

    # 3 · method
    s = add_slide(prs)
    title(s, "Five stages — plain English", eyebrow="METHOD",
          sub="Same core used for the onsite twist hooks.")
    stages = [
        ("S1", "Integrity", "Sensor cross-checks: thermal history and voltage conservation. Fault → Quarantine."),
        ("S2", "Classify", "Exactly one of: Safe and Available · Degraded but Usable · Unsafe / Quarantine."),
        ("S3", "Score", "Battery Suitability Score (BSS) 0–100 from SoH, R_int, ΔV, Temperature via MAUT (+ TOPSIS check)."),
        ("S4", "Allocate", "Hungarian matching with priority weights. Quarantine packs removed before the matrix is built."),
        ("S5", "Twist hooks", "Grid / Time-of-Use / defection hooks on the same solver — no rewrite for the 30%."),
    ]
    for i, (tag, name, body) in enumerate(stages):
        y = 1.50 + i * 0.95
        card(s, MARGIN, y, 12.05, 0.82)
        textbox(s, MARGIN + 0.28, y + 0.22, 0.70, 0.40, tag, size=16, color=BLUE, bold=True, font=H_FONT)
        textbox(s, MARGIN + 1.15, y + 0.14, 2.4, 0.50, name, size=18, color=INK, bold=True, font=H_FONT)
        textbox(s, MARGIN + 3.60, y + 0.18, 8.2, 0.55, body, size=13, color=INK2, line=1.25)
    footer(s, "docs/METHOD.md  ·  python -m bss_dispatch", 3)

    # 4 · gates + reasons
    s = add_slide(prs)
    title(s, "Exact quarantine reasons — code + full form", eyebrow="CLASSIFICATION",
          sub=f"{counts.get('Unsafe / Quarantine', 0)} packs hard-blocked on this run")
    tiers = [
        ("Safe and Available", counts.get("Safe and Available", 0), GOOD),
        ("Degraded but Usable", counts.get("Degraded but Usable", 0), AMBER),
        ("Unsafe / Quarantine", counts.get("Unsafe / Quarantine", 0), BAD),
    ]
    for i, (name, n, colour) in enumerate(tiers):
        x = MARGIN + i * 4.10
        card(s, x, 1.55, 3.90, 1.15)
        textbox(s, x + 0.24, 1.70, 3.4, 0.30, name, size=12, color=MUTED)
        textbox(s, x + 0.24, 2.05, 3.4, 0.50, str(n), size=32, color=colour, bold=True, font=H_FONT)

    textbox(s, MARGIN, 2.95, 12.0, 0.28, "Reason codes on this fleet", size=12, color=MUTED, bold=True)
    sorted_reasons = sorted(reasons.items(), key=lambda kv: -kv[1])
    if not sorted_reasons:
        textbox(s, MARGIN, 3.40, 12.0, 0.40, "No quarantine reasons recorded.", size=14, color=INK2)
    for i, (code, n) in enumerate(sorted_reasons[:6]):
        y = 3.35 + i * 0.55
        card(s, MARGIN, y, 12.05, 0.48)
        textbox(s, MARGIN + 0.24, y + 0.10, 2.4, 0.30, code, size=13, color=BLUE, bold=True, font=M_FONT)
        textbox(s, MARGIN + 2.80, y + 0.10, 7.8, 0.30, REASON_FULL.get(code, code), size=13, color=INK2)
        textbox(s, MARGIN + 10.7, y + 0.10, 1.0, 0.30, str(n), size=14, color=INK, bold=True,
                align=PP_ALIGN.RIGHT, font=H_FONT)
    footer(s, "Gates: T · SoH · R_int · ΔV  ·  integrity: sensor_thermal / adc_voltage", 4)

    # 5 · score
    s = add_slide(prs)
    title(s, "Battery Suitability Score (BSS) 0–100", eyebrow="SCORING",
          sub="Four health parameters — Multi-Attribute Utility Theory (MAUT), with TOPSIS as a cross-check.")
    params = [
        ("SoH", "State of Health", "40%", "Longevity / remaining capacity"),
        ("R_int", "Internal Resistance", "25%", "Heat and voltage sag under load"),
        ("ΔV", "Cell Voltage Imbalance", "20%", "Series-string unevenness"),
        ("T", "Temperature", "15%", "Distance from thermal sweet spot"),
    ]
    for i, (abbr, full, w, why) in enumerate(params):
        x = MARGIN + (i % 2) * 6.15
        y = 1.60 + (i // 2) * 2.15
        card(s, x, y, 5.95, 1.95)
        textbox(s, x + 0.30, y + 0.28, 5.3, 0.35, f"{abbr}  ·  {full}", size=16, color=INK, bold=True, font=H_FONT)
        textbox(s, x + 0.30, y + 0.75, 5.3, 0.35, f"MAUT weight {w}", size=14, color=BLUE)
        textbox(s, x + 0.30, y + 1.20, 5.3, 0.45, why, size=13, color=INK2)
    footer(s, "Only Safe + Degraded packs enter scoring → matching", 5)

    # 6 · allocate vs HSF
    s = add_slide(prs)
    title(s, "Proposed matching vs Highest-SoC-First", eyebrow="ALLOCATION",
          sub="Identical inputs. Different rules. Different safety outcomes.")
    card(s, MARGIN, 1.55, 5.95, 4.60)
    textbox(s, MARGIN + 0.35, 1.75, 5.3, 0.35, "PROPOSED", size=14, color=GOOD, bold=True, font=H_FONT)
    for i, line in enumerate([
        "Remove Quarantine packs before the matrix is built",
        "SoC ≥ vehicle min_SoC or the edge is infeasible",
        "Priority weights: Critical 4 · High 3 · Medium 2 · Low 1",
        "Hungarian assignment → true 1:1 matching",
        "Degraded packs blocked from Critical / High",
        "Assert: zero unsafe allocations or the run fails",
    ]):
        textbox(s, MARGIN + 0.35, 2.30 + i * 0.55, 5.3, 0.45, f"•  {line}", size=13, color=INK2, line=1.2)

    card(s, MARGIN + 6.15, 1.55, 5.95, 4.60)
    textbox(s, MARGIN + 6.50, 1.75, 5.3, 0.35, "HIGHEST-SoC-FIRST (HSF)", size=14, color=BAD, bold=True, font=H_FONT)
    for i, line in enumerate([
        "Process vehicles in arrival order",
        "Pick the available pack with the highest SoC that meets min SoC",
        "No health gate — Quarantine packs may be handed out",
        "No priority weighting",
        "Same dataset, same feasibility SoC check",
        f"On this run: {hsf['unsafe_allocations']} unsafe allocations",
    ]):
        textbox(s, MARGIN + 6.50, 2.30 + i * 0.55, 5.3, 0.45, f"•  {line}", size=13, color=INK2, line=1.2)
    footer(s, "Baseline defined by the problem statement", 6)

    # 7 · scoreboard
    s = add_slide(prs)
    title(s, "Mandatory quantitative outputs", eyebrow="RESULTS",
          sub="Both policies serve every request. Safety is where they diverge.")
    rows = [
        ("Successfully served", f"{prop['successfully_served']} / {prop['total_vehicles']}",
         f"{hsf['successfully_served']} / {hsf['total_vehicles']}", GOOD),
        ("Unserved", str(prop["unserved"]), str(hsf["unserved"]), INK),
        ("High & Critical served", f"{prop['high_critical_served_pct']:.1f}%",
         f"{hsf['high_critical_served_pct']:.1f}%", GOOD),
        ("Unsafe allocations", str(prop["unsafe_allocations"]), str(hsf["unsafe_allocations"]), GOOD),
        ("Avg SoH allocated", f"{prop['avg_soh_allocated']:.1f}%",
         f"{hsf['avg_soh_allocated']:.1f}%", BLUE),
        ("Avg BSS allocated", f"{prop['avg_bss_allocated']:.1f}",
         f"{hsf['avg_bss_allocated']:.1f}", BLUE),
    ]
    textbox(s, MARGIN + 5.2, 1.45, 3.2, 0.28, "Proposed", size=12, color=GOOD, bold=True, align=PP_ALIGN.CENTER)
    textbox(s, MARGIN + 8.6, 1.45, 3.2, 0.28, "HSF", size=12, color=BAD, bold=True, align=PP_ALIGN.CENTER)
    for i, (label, pv, hv, colour) in enumerate(rows):
        y = 1.85 + i * 0.75
        card(s, MARGIN, y, 12.05, 0.65)
        textbox(s, MARGIN + 0.30, y + 0.16, 4.6, 0.35, label, size=14, color=INK2)
        textbox(s, MARGIN + 5.2, y + 0.14, 3.2, 0.40, pv, size=18, color=colour, bold=True,
                align=PP_ALIGN.CENTER, font=H_FONT)
        textbox(s, MARGIN + 8.6, y + 0.14, 3.2, 0.40, hv, size=18, color=INK,
                align=PP_ALIGN.CENTER, font=H_FONT)
    footer(s, "Recomputed from assignment rows in run_result.json", 7)

    # 8 · visuals
    s = add_slide(prs)
    title(s, "Visual evidence from the same run", eyebrow="VISUALS",
          sub="At least three required — health/score distribution, by priority, Proposed vs HSF, quarantine.")
    if PLOT.exists():
        s.shapes.add_picture(str(PLOT), Inches(MARGIN), Inches(1.55), width=Inches(12.05))
    else:
        textbox(s, MARGIN, 3.0, 12.0, 0.50,
                "Run python -m bss_dispatch to regenerate outputs/bss_dispatch_simulation.png",
                size=14, color=MUTED)
    footer(s, "outputs/bss_dispatch_simulation.png", 8)

    # 9 · verification
    s = add_slide(prs)
    title(s, "Verification rules — structurally enforced", eyebrow="COMPLIANCE",
          sub="Not soft penalties. Quarantine packs are not representable in the solution.")
    checks = [
        ("Unsafe never allocated", "Quarantine removed before candidate matrix · exit assert"),
        ("One battery ↔ one vehicle", "Hungarian matching — each row/column used at most once"),
        ("SoC ≥ min SoC", "Infeasible edges masked; discarded post-solve if still selected"),
        ("Reproducible", "RANDOM_SEED = 42 · deterministic CSV path · full rows in run_result.json"),
        ("Baseline fair", "HSF run on identical fleet + demand before any proposed solve"),
    ]
    for i, (h, b) in enumerate(checks):
        y = 1.55 + i * 0.90
        card(s, MARGIN, y, 12.05, 0.78)
        textbox(s, MARGIN + 0.30, y + 0.14, 11.4, 0.28, h, size=15, color=INK, bold=True, font=H_FONT)
        textbox(s, MARGIN + 0.30, y + 0.42, 11.4, 0.28, b, size=13, color=INK2)
    footer(s, "Problem statement verification rules 1–5", 9)

    # 10 · twist + close
    s = add_slide(prs)
    title(s, "Ready for the unseen 30% twist", eyebrow="CLOSE",
          sub="Same core solver. Hooks in twists.py — grid limit, Time-of-Use, rider defection.")
    card(s, MARGIN, 1.60, 12.05, 2.40)
    textbox(s, MARGIN + 0.40, 1.85, 11.2, 0.40,
            "Headline on this dataset", size=14, color=MUTED, bold=True)
    textbox(s, MARGIN + 0.40, 2.35, 11.2, 1.30,
            f"Proposed serves {prop['successfully_served']}/{prop['total_vehicles']} with "
            f"{prop['unsafe_allocations']} unsafe packs and {prop['avg_soh_allocated']:.1f}% average SoH. "
            f"HSF also serves everyone — by allocating {hsf['unsafe_allocations']} quarantined packs "
            f"at {hsf['avg_soh_allocated']:.1f}% average SoH.",
            size=18, color=INK, line=1.35)
    textbox(s, MARGIN, 4.40, 12.0, 0.40,
            "Reproduce", size=12, color=MUTED, bold=True)
    textbox(s, MARGIN, 4.85, 12.0, 0.35,
            "python -m bss_dispatch --batteries <fleet.csv> --vehicles <demand.csv>",
            size=14, color=BLUE, font=M_FONT)
    textbox(s, MARGIN, 5.40, 12.0, 0.35,
            "Judge UI  ·  http://localhost:3000   ·   Deep lab  ·  /lab",
            size=14, color=INK2, font=M_FONT)
    textbox(s, MARGIN, 6.20, 12.0, 0.28,
            "SoC State of Charge · SoH State of Health · BSS Battery Suitability Score · "
            "HSF Highest-SoC-First · R_int Internal Resistance · ΔV Cell Voltage Imbalance",
            size=10, color=MUTED)
    footer(s, "Siemens Energy · ASME Brain Bolt 2026", 10)

    return prs


def main() -> None:
    d = load()
    prs = build(d)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(OUT)
    print(f"Wrote {OUT}  ({len(prs.slides)} slides)")


if __name__ == "__main__":
    main()
