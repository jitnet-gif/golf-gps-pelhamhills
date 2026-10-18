#!/usr/bin/env python3
"""
Eyeball check for the tiles download_tiles.py produced: stitch one zoom level
into a single mosaic and draw every tee and pin on it.

Why bother, when download_tiles.py already reports 536/536: a complete download
only proves we fetched the box we asked for. It says nothing about whether that
box actually contains the golf course. Seeing all 36 points sit inside the
imagery, with fairway visible around them, is what proves the bbox is right.

The printed margin is the quantitative half of the same check - how far the
outermost point sits from the edge of the covered area, in metres. Comfortably
positive means the box has room; near zero or negative means widen LAT_DELTA /
LON_DELTA in download_tiles.py and re-run it.

Usage:
    python3 verify_coverage.py            # z17 mosaic -> tiles_preview.jpg
    python3 verify_coverage.py --zoom 18
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw

from download_tiles import OUT_DIR, ROOT, bounds, hole_points, lat2tile, lon2tile

TILE_PX = 256


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zoom", type=int, default=17, help="zoom level to stitch")
    ap.add_argument("--out", default=str(ROOT / "tiles_preview.jpg"))
    args = ap.parse_args()

    z = args.zoom
    pts = hole_points()
    b = bounds(pts)

    x_min = math.floor(lon2tile(b["west"], z))
    x_max = math.floor(lon2tile(b["east"], z))
    y_min = math.floor(lat2tile(b["north"], z))
    y_max = math.floor(lat2tile(b["south"], z))
    cols, rows = x_max - x_min + 1, y_max - y_min + 1

    canvas = Image.new("RGB", (cols * TILE_PX, rows * TILE_PX), (20, 20, 20))
    missing = 0
    for x in range(x_min, x_max + 1):
        for y in range(y_min, y_max + 1):
            path = OUT_DIR / str(z) / str(x) / (str(y) + ".jpg")
            if not path.exists():
                missing += 1
                continue
            with Image.open(path) as im:
                canvas.paste(
                    im.convert("RGB"), ((x - x_min) * TILE_PX, (y - y_min) * TILE_PX)
                )

    # Pixel position of a coordinate within the mosaic.
    def to_px(lat: float, lng: float) -> tuple[float, float]:
        return (
            (lon2tile(lng, z) - x_min) * TILE_PX,
            (lat2tile(lat, z) - y_min) * TILE_PX,
        )

    draw = ImageDraw.Draw(canvas)
    # Pins in red, tees in cyan; the list alternates pin, tee per hole.
    for i, (lat, lng) in enumerate(pts):
        px, py = to_px(lat, lng)
        is_pin = i % 2 == 0
        colour = (255, 60, 60) if is_pin else (0, 230, 255)
        r = 7 if is_pin else 5
        draw.ellipse([px - r, py - r, px + r, py + r], fill=colour, outline=(0, 0, 0))
        if is_pin:
            draw.text((px + 9, py - 6), str(i // 2 + 1), fill=(255, 255, 0))

    # Outline of the requested bbox, so any point outside it is obvious.
    nw, se = to_px(b["north"], b["west"]), to_px(b["south"], b["east"])
    draw.rectangle([nw[0], nw[1], se[0], se[1]], outline=(255, 255, 0), width=3)

    canvas.save(args.out, quality=88)

    # Margin from the outermost point to the edge of the covered tile area.
    lats = [p[0] for p in pts]
    lngs = [p[1] for p in pts]
    m_per_deg_lat = 111_320.0
    m_per_deg_lng = 111_320.0 * math.cos(math.radians(sum(lats) / len(lats)))
    margins = {
        "north": (b["north"] - max(lats)) * m_per_deg_lat,
        "south": (min(lats) - b["south"]) * m_per_deg_lat,
        "east": (b["east"] - max(lngs)) * m_per_deg_lng,
        "west": (min(lngs) - b["west"]) * m_per_deg_lng,
    }

    print("mosaic z{}  {}x{} tiles  {}x{} px -> {}".format(
        z, cols, rows, cols * TILE_PX, rows * TILE_PX, args.out))
    if missing:
        print("WARNING: {} tiles missing at this zoom".format(missing))
    print("36 points drawn (red = pin with hole number, cyan = tee)")
    print("margin from outermost point to bbox edge:")
    for side, m in margins.items():
        flag = "  <-- TIGHT" if m < 40 else ""
        print("  {:<5} {:6.1f} m{}".format(side, m, flag))
    inside = all(
        b["south"] <= lat <= b["north"] and b["west"] <= lng <= b["east"]
        for lat, lng in pts
    )
    print("all 36 points inside bbox: {}".format("yes" if inside else "NO"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
