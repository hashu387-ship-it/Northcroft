"""Recolour the QS Team logo and square mark to suit each look in Settings > Appearance.

The original artwork is white lettering, a grey and black smoky glow and a grey glass building,
with red accents. Each version maps the greys onto a colour ramp by brightness and keeps the reds:

  blue   Northcroft navy, Aurora, QS Team glass and Dark (and every dark surface by default)
  gold   Onyx (black and gold)
  violet Purple glass
  ink    light looks (Pearl, Clay glass, Light): navy lettering and building with a pale blue haze,
         so the logo sits on a light background without a dark plate

Run from the repository root:  python3 scripts/tint-logos.py
Reads public/brand/northcroft-qs-team-logo-*.webp and qs-team-mark-512.png, writes the versions
next to them.
"""
import colorsys
from pathlib import Path

import numpy as np
from PIL import Image

BRAND = Path("public/brand")

RAMPS = {
    "blue": [(0.0, (4, 18, 52)), (0.35, (14, 52, 120)), (0.65, (60, 120, 210)), (0.85, (170, 205, 245)), (1.0, (255, 255, 255))],
    "gold": [(0.0, (14, 10, 4)), (0.35, (70, 50, 18)), (0.65, (170, 130, 62)), (0.85, (232, 208, 150)), (1.0, (255, 252, 242))],
    "violet": [(0.0, (16, 8, 40)), (0.35, (50, 26, 110)), (0.65, (130, 100, 230)), (0.85, (210, 196, 252)), (1.0, (255, 255, 255))],
    # Light looks: bright parts (the white lettering) become deep navy, dark parts a pale haze.
    "ink": [(0.0, (214, 226, 246)), (0.3, (150, 180, 226)), (0.6, (44, 92, 172)), (0.85, (8, 42, 110)), (1.0, (1, 32, 97))],
}


def ramp(name: str, t: np.ndarray) -> np.ndarray:
    stops = RAMPS[name]
    xs = np.array([s[0] for s in stops])
    out = np.zeros(t.shape + (3,), dtype=np.float64)
    for c in range(3):
        out[..., c] = np.interp(t, xs, np.array([s[1][c] for s in stops], dtype=np.float64))
    return out


def tint(img: Image.Image, name: str) -> Image.Image:
    rgba = np.asarray(img.convert("RGBA")).astype(np.float64)
    rgb, alpha = rgba[..., :3] / 255.0, rgba[..., 3]
    hsv = np.vectorize(colorsys.rgb_to_hsv, otypes=[float, float, float])
    h, s, v = hsv(rgb[..., 0], rgb[..., 1], rgb[..., 2])
    red = (s > 0.45) & (v > 0.35) & ((h < 0.06) | (h > 0.94))
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    out = ramp(name, lum)
    a = alpha.copy()
    if name == "ink":
        # The dark smoke fades to a light haze instead of a dark cloud.
        a = alpha * np.clip(0.25 + 0.75 * lum ** 0.8, 0, 1)
    out[red] = rgba[..., :3][red]
    a[red] = alpha[red]
    res = np.dstack([out, a]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(res, "RGBA")


def main() -> None:
    for w in (900, 1320, 1774):
        src = Image.open(BRAND / f"northcroft-qs-team-logo-{w}.webp")
        for name in RAMPS:
            tint(src, name).save(BRAND / f"northcroft-qs-team-logo-{name}-{w}.webp", "WEBP", quality=88, method=6)
    mark = Image.open(BRAND / "qs-team-mark-512.png").convert("RGBA")
    for name in ("blue", "gold", "violet"):
        t = tint(mark, name).convert("RGB")
        t.save(BRAND / f"qs-team-mark-{name}-512.webp", "WEBP", quality=88, method=6)
        t.resize((160, 160), Image.LANCZOS).save(BRAND / f"qs-team-mark-{name}-160.webp", "WEBP", quality=88, method=6)
    print("done")


if __name__ == "__main__":
    main()
