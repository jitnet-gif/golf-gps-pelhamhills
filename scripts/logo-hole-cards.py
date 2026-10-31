"""
Put the club's logo on each hole card.

    python scripts/logo-hole-cards.py

Each layout crop-yardage-book.py cuts carries the book's page number and a
scatter of grey dots in its top corner. The book numbers the nines the other way
round from the club (see pelhamHillsBook.ts), so that number is wrong for the
hole the card is filed under. This paints the number and dots out with the
page's own paper and sets frontend/public/club-logo.png there; the hole's number
is in the app's title above the picture.

Run it after crop-yardage-book.py. Running it again changes nothing visible.

Needs Pillow and numpy.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
HOLES = ROOT / "frontend" / "public" / "holes"
LOGO = ROOT / "frontend" / "public" / "club-logo.png"

ERASE = (415, 0, 540, 130)   # (left, top, right, bottom) holding the number and dots
DOTS = (415, 130, 540, 190)  # the last dots, below the logo, among yardage labels
DOT_GREY = (80, 242)         # a dot's grey level, darkest to lightest
INK_MAX = 80                 # darker than this is a label, which stays
INK_CLEAR = 8                # pixels kept untouched around a label
LOGO_CENTRE = (468, 76)
LOGO_SIZE = 132
ART_MIN = 45                 # channel spread at or above this is the course drawing
ART_CLEAR = 8                # pixels kept untouched around the drawing
QUALITY = 78                 # crop-yardage-book.py's for the layouts
SUPER = 4                    # the logo's round edge is cut at this scale


def paint_out(image):
    """Cover the corner with the page's paper, leaving any of the drawing there."""
    rgb = np.asarray(image).astype(int)
    art = Image.fromarray(((rgb.max(axis=2) - rgb.min(axis=2) >= ART_MIN) * 255).astype(np.uint8))
    art = np.asarray(art.filter(ImageFilter.MaxFilter(2 * ART_CLEAR + 1))) > 127

    left, top, right, bottom = ERASE
    mask = np.zeros(rgb.shape[:2], np.uint8)
    mask[top:bottom, left:right] = 255

    grey = rgb.max(axis=2)
    ink = Image.fromarray(((grey < INK_MAX) * 255).astype(np.uint8))
    ink = np.asarray(ink.filter(ImageFilter.MaxFilter(2 * INK_CLEAR + 1))) > 127
    left, top, right, bottom = DOTS
    dots = (grey >= DOT_GREY[0]) & (grey <= DOT_GREY[1]) & ~ink
    dots = Image.fromarray((dots * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13))
    mask[top:bottom, left:right] = (np.asarray(dots) * ~ink)[top:bottom, left:right]
    mask[art] = 0
    soft = Image.fromarray(mask).filter(ImageFilter.GaussianBlur(3))

    paper = tuple(int(v) for v in np.median(rgb[200:260, 440:540].reshape(-1, 3), axis=0))
    image.paste(Image.new("RGB", image.size, paper), (0, 0), soft)


def logo_stamp():
    """The logo at LOGO_SIZE, cut to its circle so its white square does not show."""
    logo = Image.open(LOGO).convert("RGB").resize((LOGO_SIZE, LOGO_SIZE), Image.LANCZOS)
    big = Image.new("L", (LOGO_SIZE * SUPER, LOGO_SIZE * SUPER), 0)
    ImageDraw.Draw(big).ellipse((0, 0, big.width - 1, big.height - 1), fill=255)
    return logo, big.resize(logo.size, Image.LANCZOS)


def main():
    logo, round_edge = logo_stamp()
    at = (LOGO_CENTRE[0] - LOGO_SIZE // 2, LOGO_CENTRE[1] - LOGO_SIZE // 2)
    for hole in range(1, 19):
        path = HOLES / f"hole-{hole}-layout.webp"
        image = Image.open(path).convert("RGB")
        paint_out(image)
        image.paste(logo, at, round_edge)
        image.save(path, "WEBP", quality=QUALITY, method=6)
    print(f"logo on 18 cards in {HOLES}")


if __name__ == "__main__":
    main()
