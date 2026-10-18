#!/usr/bin/env python3
"""Fetch the menu pictures the club's printed board does not carry.

`crop-menu-board.py` gets most of the menu out of the board. A few rows have no
tile on any board version the club has sent, and this fills the ones that can be
filled honestly from the open web.

    python scripts/fetch-menu-photos.py

It writes the same place the board crops go - frontend/public/menu/<slug>.webp -
and the same table, `SOURCED_PHOTOS` in frontend/src/data/menuImages.ts, which is
kept separate from `BOARD_PHOTOS` so that re-cutting the board does not wipe
these and vice versa.

--------------------------------------------------------------------------------
The rule these were picked by
--------------------------------------------------------------------------------
A picture on an ordering screen is not decoration - it is what the player is
choosing from. So a source only counts when it is **the same thing the pro shop
hands over**, and when the club may actually use it:

  * packaged goods -> the manufacturer's own product render. Nongshim's picture
    of a Shin Ramyun cup *is* the cup in the pro shop's fridge, and showing a
    maker's product to sell that maker's product is ordinary retail practice.
  * kitchen items -> public domain or CC0 only. No attribution to carry, no
    share-alike to honour, nothing for the club to get wrong later. Several
    better-looking photos were CC BY-SA and were left alone for that reason.

Two rows are still empty and are meant to stay that way until the club's own
board arrives:

  italian-hot-dog       every candidate was a different food. The Commons
                        "Italian hot dog" is a Chilean completo; the Wikipedia
                        article has no photo of the Newark dish at all. A
                        generic hot dog would duplicate hot-dog.webp, which is
                        worse than a blank - two rows, one picture, different
                        prices.
  rice-noodle-tom-yum   Nongshim publishes the Shin Ramyun *Tom Yum* bowl, which
                        is wheat ramyun. The menu row is the *rice noodle* cup.
                        Same brand, same flavour, different product.

Both are on the 2026-09-20 board the club drew. Cutting that board is the fix,
not a closer guess.

Needs Pillow:  python -m pip install pillow
"""

from __future__ import annotations

import io
import re
import sys
import urllib.request
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is needed:  python -m pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "frontend" / "public" / "menu"
TABLE = ROOT / "frontend" / "src" / "data" / "menuImages.ts"

ID = "00000013-0000-4000-8000-0000000000%02d"
UA = "pelhamhills-golf-gps/1.0 (club menu pictures)"

# The board pads its tiles with this, so these have to match or the list of
# pictures reads as two different lists.
PAPER = (252, 251, 249)
MAX_EDGE = 600

# number, slug, url, crop (left, top, right, bottom as fractions) or None, and
# where it came from - the credit line is kept in the code because the club will
# be asked one day and nobody will remember.
SOURCES = [
    (
        11,
        "shin-noodle",
        "https://nongshimusa.com/html5/imgs/products/imgs/shin_ramyun_cup.png",
        None,
        "Nongshim USA product render (nongshimusa.com) - the cup the pro shop sells",
    ),
    (
        5,
        "pie",
        "https://upload.wikimedia.org/wikipedia/commons/6/67/Cherry-Pie-Whole.jpg",
        None,
        "Evan-Amos, Wikimedia Commons, public domain",
    ),
    (
        10,
        "waffle",
        "https://live.staticflickr.com/4248/35080292476_c14b0fea66_b.jpg",
        # Just the waffles. The rest of the frame is a whisk, eggs and a bowl
        # of flour - a picture of baking, not of the thing being sold. Cropped
        # tight enough to lose the egg too: at 64 px on a menu row an egg beside
        # a waffle reads as part of the order.
        (0.58, 0.30, 1.0, 1.0),
        "Flickr, CC0 (via Openverse)",
    ),
]


def fetch(url: str) -> Image.Image:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        return Image.open(io.BytesIO(response.read()))


def flatten(img: Image.Image) -> Image.Image:
    """Drop transparency onto the board's paper, not onto black.

    Manufacturer renders are cut-out PNGs; converting one straight to RGB puts
    the cup on a black square.
    """
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        canvas = Image.new("RGBA", img.size, PAPER + (255,))
        canvas.alpha_composite(img)
        return canvas.convert("RGB")
    return img.convert("RGB")


def square(img: Image.Image) -> Image.Image:
    side = max(img.size)
    canvas = Image.new("RGB", (side, side), PAPER)
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    if side > MAX_EDGE:
        canvas = canvas.resize((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    return canvas


def write_table(rows: list[tuple[str, str, str]]) -> None:
    body = "\n".join(
        f"  // {credit}\n  '{menu_id}': '/menu/{slug}.webp'," for menu_id, slug, credit in rows
    )
    source = TABLE.read_text(encoding="utf-8")
    source = re.sub(
        r"export const SOURCED_PHOTOS: Record<string, string> = \{.*?\n\};",
        "export const SOURCED_PHOTOS: Record<string, string> = {\n"
        "  // Written by scripts/fetch-menu-photos.py - do not edit by hand.\n"
        f"{body}\n}};",
        source,
        flags=re.S,
    )
    TABLE.write_text(source, encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[tuple[str, str, str]] = []

    for number, slug, url, crop, credit in SOURCES:
        print(f"{slug}  <- {url}")
        img = flatten(fetch(url))
        if crop:
            w, h = img.size
            img = img.crop(
                (int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h))
            )
        out = OUT_DIR / f"{slug}.webp"
        square(img).save(out, "WEBP", quality=86, method=6)
        print(f"  {out.name}  {out.stat().st_size // 1024} KB  ({credit})")
        rows.append((ID % number, slug, credit))

    write_table(rows)
    print(f"\nWrote {len(rows)} entries to {TABLE.relative_to(ROOT)}")
    print("Look at them on /food before shipping - a picture on the wrong row is")
    print("worse than no picture.")


if __name__ == "__main__":
    main()
