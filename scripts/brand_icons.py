"""Renders every icon of the brand from the mark's geometry (docs/brand/README.md, section 6).

The geometry comes from packages/core/src/brand/mark.ts (MARK_VIEWBOX and MARK_SHAPES), so the icons never
drift from the mark the apps draw. PNGs are rendered with headless Chrome, as before; run it whenever the
mark changes instead of editing the images:

    python3 scripts/brand_icons.py
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARK_TS = (ROOT / "packages/core/src/brand/mark.ts").read_text()

GREEN = "#20c997"  # dark-theme accent: the icon background
DARK = "#06221a"  # its accentFg: the mark on the web's icons
WHITE = "#ffffff"  # the mark on the Android app's icons and splash

WIDTH, HEIGHT = (
    float(n) for n in re.search(r"MARK_VIEWBOX = \{ width: (\d+), height: (\d+) \}", MARK_TS).groups()
)
PATH_D = re.search(r"d: '([^']+)'", MARK_TS).group(1)
STROKE = re.search(r"strokeWidth: (\d+)", MARK_TS).group(1)
CAP = re.search(r"linecap: '(\w+)'", MARK_TS).group(1)


def mark(color: str, size: float, height: float) -> str:
    """The mark `height` px high (its viewBox, margin included), centred on a `size` canvas."""
    scale = height / HEIGHT
    x, y = (size - WIDTH * scale) / 2, (size - height) / 2
    return (
        f'<g transform="translate({x:.3f} {y:.3f}) scale({scale:.6f})">'
        f'<path d="{PATH_D}" fill="none" stroke="{color}" stroke-width="{STROKE}" stroke-linecap="{CAP}"/>'
        "</g>"
    )


def icon(size: int, *, color: str, share: float, background: str | None, radius: float = 0) -> str:
    """An SVG document: the mark at `share` of the height, on a (rounded) square or on nothing."""
    back = (
        f'<rect width="{size}" height="{size}" rx="{size * radius:.2f}" fill="{background}"/>'
        if background
        else ""
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f"{back}{mark(color, size, size * share)}</svg>"
    )


def png(svg: str, size: int, out: Path) -> None:
    """Screenshots the SVG with headless Chrome, on a transparent page, at exactly size by size."""
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "icon.html"
        page.write_text(
            "<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>" + svg
        )
        subprocess.run(
            [
                "google-chrome",
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                "--default-background-color=00000000",
                f"--window-size={size},{size}",
                f"--screenshot={out}",
                page.as_uri(),
            ],
            check=True,
            capture_output=True,
        )


def main() -> None:
    brand = ROOT / "docs/brand/assets"
    web = ROOT / "apps/web/public"
    mobile = ROOT / "apps/mobile/assets"

    # The mark itself, black on transparent: the source the test compares with mark.ts.
    (brand / "logo-mark.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH:g} {HEIGHT:g}" role="img"'
        ' aria-label="Zankup">\n'
        f'  <path d="{PATH_D}" fill="none" stroke="#000" stroke-width="{STROKE}" stroke-linecap="{CAP}"/>\n'
        "</svg>\n"
    )
    favicon = icon(64, color=DARK, share=0.6, background=GREEN, radius=14 / 64) + "\n"
    for folder in (brand, web):
        (folder / "favicon.svg").write_text(favicon)

    # The web app (PWA): the dark mark on the green, as on the sign-in panel.
    for folder in (brand, web):
        png(icon(192, color=DARK, share=0.6, background=GREEN, radius=0.219), 192, folder / "icon-192.png")
        png(icon(512, color=DARK, share=0.6, background=GREEN, radius=0.219), 512, folder / "icon-512.png")
        png(icon(512, color=DARK, share=0.44, background=GREEN), 512, folder / "icon-maskable-512.png")
        png(icon(180, color=DARK, share=0.6, background=GREEN), 180, folder / "apple-touch-icon-180.png")

    # The Android app: the white mark on the green; the adaptive layers keep it in the 66 % safe zone.
    png(icon(1024, color=WHITE, share=0.6, background=GREEN), 1024, mobile / "icon.png")
    plain = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">'
        f'<rect width="512" height="512" fill="{GREEN}"/></svg>'
    )
    png(plain, 512, mobile / "android-icon-background.png")
    png(icon(512, color=WHITE, share=0.46, background=None), 512, mobile / "android-icon-foreground.png")
    png(icon(432, color=WHITE, share=0.46, background=None), 432, mobile / "android-icon-monochrome.png")
    png(icon(1024, color=WHITE, share=0.56, background=None), 1024, mobile / "splash-icon.png")


if __name__ == "__main__":
    main()
