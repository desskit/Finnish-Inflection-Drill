"""
Render icons/icon.svg out to icons/icon-192.png and icons/icon-512.png.

iOS home-screen install and some older Android launchers won't render an SVG
icon; they need PNG. Run this once after editing icon.svg.

Requires: pip install cairosvg
Run:     python scripts/make_icons.py
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import cairosvg
except ImportError:
    print("cairosvg not installed. Run:  pip install cairosvg", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "icons" / "icon.svg"
OUT_DIR = ROOT / "icons"

SIZES = [192, 512]


def main() -> int:
    if not SVG.exists():
        print(f"Missing {SVG}", file=sys.stderr)
        return 1

    svg_bytes = SVG.read_bytes()
    for size in SIZES:
        out = OUT_DIR / f"icon-{size}.png"
        cairosvg.svg2png(
            bytestring=svg_bytes,
            write_to=str(out),
            output_width=size,
            output_height=size,
        )
        print(f"wrote {out.relative_to(ROOT)}  ({size}x{size})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
