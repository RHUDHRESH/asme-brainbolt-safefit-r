"""Export each slide of a .pptx to PNG using the installed PowerPoint.

Visual QA: LibreOffice is not available here, but PowerPoint is, and it renders
with the real fonts, so what comes out is what a judge will see.

    python scripts/render_deck.py [deck.pptx] [outdir]
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import win32com.client

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DECK = ROOT / "outputs" / "ASME_BrainBolt_2026_BSS_Method_v2.pptx"


def render(deck: Path, outdir: Path, width: int = 1600) -> list[Path]:
    outdir.mkdir(parents=True, exist_ok=True)
    for stale in outdir.glob("*.png"):
        stale.unlink()

    app = win32com.client.Dispatch("PowerPoint.Application")
    pres = None
    try:
        # WithWindow=False is rejected by some builds; open normally and close fast.
        pres = app.Presentations.Open(str(deck), ReadOnly=True, WithWindow=False)
        pres.Export(str(outdir), "PNG", width, int(width * 7.5 / 13.333))
    finally:
        if pres is not None:
            pres.Close()
        app.Quit()

    # PowerPoint writes Slide1.PNG .. SlideN.PNG; normalise to zero-padded names.
    # Windows globbing is case-insensitive, so match once and dedupe by real path.
    seen: dict[str, Path] = {}
    for src in outdir.iterdir():
        if src.suffix.lower() == ".png":
            seen[str(src).lower()] = src

    out: list[Path] = []
    for src in sorted(seen.values()):
        digits = "".join(c for c in src.stem if c.isdigit())
        if not digits:
            continue
        dst = outdir / f"slide-{int(digits):02d}.png"
        if src.name != dst.name:
            shutil.move(str(src), str(dst))
        out.append(dst)
    return sorted(out)


def main() -> None:
    deck = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DECK
    outdir = Path(sys.argv[2]) if len(sys.argv) > 2 else deck.parent / "slides"
    paths = render(deck, outdir)
    for path in paths:
        print(path)


if __name__ == "__main__":
    main()
