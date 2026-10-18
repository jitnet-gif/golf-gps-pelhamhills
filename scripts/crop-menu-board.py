#!/usr/bin/env python3
"""Cut the pro shop's printed FOOD/SNACKS board into one picture per menu row.

The board is a grid of tiles: a photo on white, with the name and price printed
underneath. This lifts the photo out of each tile, drops the caption (the app
prints the name and the *live* price itself - the board's printed price goes
stale the first time the club edits it in /admin), and writes one WebP per menu
id.

    python scripts/crop-menu-board.py 2026-09-19-light "C:/Users/jitne/Downloads/<board>.png"

It writes:
    frontend/public/menu/<slug>.webp          one per mapped tile
    frontend/src/data/menuImages.ts           the id -> path table
    <board's folder>/menu-contact-sheet.png   every crop, captioned, to eyeball

--------------------------------------------------------------------------------
Why this takes a board NAME and not just a file
--------------------------------------------------------------------------------
The club redraws the board, and the tiles move. Three versions exist already:

  2026-09-18-dark    black board, "Daily Specials & Beverages", beer down the side
  2026-09-19-light   white board, has Sausage / Burger / Jin Noodle / Muffin / Cookie
  2026-09-20-light   white board, the current one: Italian Hot Dog, Pie, Waffle,
                     Shin Noodle and a second Rice Noodle (Tom Yum) in their place

Cropping one board with another's layout puts a picture of a burger beside the
words "Italian Hot Dog" on a real customer's phone. So the layout is named
explicitly, the grid is measured per board, and `verify` below re-derives the
grid from the pixels and refuses a file whose tiles are not where the named
layout says they are.

**A tile is only mapped when it is the same product.** The 2026-09-19 board has
no Italian Hot Dog, Pie, Waffle, Shin Noodle or Tom Yum, and its "Jin Noodle" is
a different cup from Shin Ramyun - so those ids are simply absent and those rows
stay text-only. An approximately-right photo is worse than none: the player is
choosing what to eat from it.

Needs Pillow:  python -m pip install pillow
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is needed:  python -m pip install pillow")

try:
    import numpy as np
except ImportError:  # pragma: no cover
    sys.exit("NumPy is needed:  python -m pip install numpy")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "frontend" / "public" / "menu"
TABLE = ROOT / "frontend" / "src" / "data" / "menuImages.ts"

# The ids are 0013_menu_seed.sql's, which data/proShopMenu.ts carries too.
ID = "00000013-0000-4000-8000-0000000000%02d"

# Slug per menu id. The file name, and all the app ever sees.
SLUGS = {
    1: "hot-dog",
    2: "k-hot-dog",
    3: "italian-hot-dog",
    4: "morning-sandwich",
    5: "pie",
    6: "morning-wrap",
    7: "french-fries",
    8: "onion-rings",
    9: "dumplings",
    10: "waffle",
    11: "shin-noodle",
    12: "udon",
    13: "slim-noodle",
    14: "rice-noodle-pho",
    15: "rice-noodle-tom-yum",
    16: "chocolate-bar",
    17: "clif-energy-bar",
    18: "chips",
    19: "nuts",
}

BOARDS = {
    # White board, 1055x1491. Rows and columns measured off the file itself;
    # `verify` re-derives them and complains if a new export has moved.
    #
    # Unmapped tiles on this board: food(0,1) Sausage, food(0,2) Burger,
    # food(2,0) Jin Noodle, snacks(0,0) Muffin, snacks(0,1) Cookie - none of
    # them are on the club's current menu. food(1,4) and food(2,4) are
    # decorative panels, not products.
    "2026-09-19-light": {
        "size": (1055, 1491),
        "bands": {
            "food": [(306, 541), (556, 792), (805, 1039)],
            "snacks": [(1140, 1375)],
        },
        "columns": {"food": (25, 1030, 5), "snacks": (25, 1030, 6)},
        "caption_fraction": 0.30,
        "tiles": {
            # menu number: (section, row, col)
            1: ("food", 0, 0),
            2: ("food", 0, 3),
            4: ("food", 0, 4),
            6: ("food", 1, 0),
            7: ("food", 1, 1),
            8: ("food", 1, 2),
            9: ("food", 1, 3),
            12: ("food", 2, 1),
            13: ("food", 2, 2),
            14: ("food", 2, 3),
            16: ("snacks", 0, 2),
            17: ("snacks", 0, 3),
            18: ("snacks", 0, 4),
            19: ("snacks", 0, 5),
        },
    },
    # The current board. Five across for both FOOD rows and four for SNACKS, so
    # every one of the 19 rows has a picture. Bands are left None until the file
    # is in hand - `verify` fills them in from the pixels and prints what it
    # found, so adding this board is: run it, check the contact sheet, paste the
    # bands back in here.
    "2026-09-20-light": {
        "size": None,
        "bands": None,
        "columns": {"food": None, "snacks": None},
        "caption_fraction": 0.30,
        "tiles": {
            1: ("food", 0, 0),
            2: ("food", 0, 1),
            3: ("food", 0, 2),
            4: ("food", 0, 3),
            5: ("food", 0, 4),
            6: ("food", 1, 0),
            7: ("food", 1, 1),
            8: ("food", 1, 2),
            9: ("food", 1, 3),
            10: ("food", 1, 4),
            11: ("food", 2, 0),
            12: ("food", 2, 1),
            13: ("food", 2, 2),
            14: ("food", 2, 3),
            15: ("food", 2, 4),
            16: ("snacks", 0, 0),
            17: ("snacks", 0, 1),
            18: ("snacks", 0, 2),
            19: ("snacks", 0, 3),
        },
    },
}

# Longest edge of a written tile. The menu row shows it at 64 px and the
# tap-to-open view at phone width; 600 covers both on a 3x screen.
MAX_EDGE = 600


def ink_runs(signal: np.ndarray, threshold: int, min_len: int) -> list[tuple[int, int]]:
    """Stretches where there is something other than paper."""
    out: list[tuple[int, int]] = []
    start = None
    for i, value in enumerate(signal):
        if value > threshold and start is None:
            start = i
        elif value <= threshold and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(signal)))
    return [r for r in out if r[1] - r[0] > min_len]


def verify(img: Image.Image, board: dict, name: str) -> None:
    """Re-derive the grid from the pixels and refuse a file that has moved.

    This is the check that stands between a redrawn board and a customer seeing
    the wrong food. It is deliberately about *shape* rather than OCR: a caption
    reader needs tesseract installed, and this needs nothing.
    """
    grey = np.asarray(img.convert("L")).astype(float)
    found = ink_runs((grey < 240).sum(axis=1), 12, 8)

    if board["size"] and img.size != tuple(board["size"]):
        sys.exit(
            f"{name} was measured at {board['size'][0]}x{board['size'][1]}, this file is "
            f"{img.width}x{img.height}.\nRe-measure, or use the board name that matches."
        )

    if not board["bands"]:
        print(f"{name} has no measured grid yet. Bands of ink in this file:")
        for y0, y1 in found:
            print(f"  y {y0}..{y1}  (height {y1 - y0})")
        for label, (y0, y1) in [(f"band {i}", b) for i, b in enumerate(found)]:
            band = grey[y0:y1]
            cols = ink_runs((band < 240).sum(axis=0), 3, 30)
            if len(cols) >= 3:
                print(f"  {label}: {len(cols)} columns, x {cols[0][0]}..{cols[-1][1]}")
        sys.exit(
            "\nPaste the tile bands and columns into BOARDS[...] and run again.\n"
            "Tile bands are the tall ones (~230 px); the short ones are headings."
        )

    wanted = [b for rows in board["bands"].values() for b in rows]
    for y0, y1 in wanted:
        near = [r for r in found if abs(r[0] - y0) < 20 and abs(r[1] - y1) < 20]
        if not near:
            sys.exit(
                f"{name} expects a row of tiles at y {y0}..{y1} and this file has none.\n"
                f"Ink bands found: {found}\n"
                "This is a different board - do not crop it with this layout."
            )
    print(f"{name}: grid matches the file.")


def cell_box(board: dict, section: str, row: int, col: int) -> tuple[int, int, int, int]:
    y0, y1 = board["bands"][section][row]
    left, right, count = board["columns"][section]
    pitch = (right - left) / count
    x0 = left + col * pitch
    x1 = x0 + pitch
    # Stop above the caption: the app prints the name and the live price itself.
    y1 = y0 + (y1 - y0) * (1 - board["caption_fraction"])
    pad = pitch * 0.04
    return (int(x0 + pad), int(y0), int(x1 - pad), int(y1))


def trim_white(tile: Image.Image, tolerance: int = 247) -> Image.Image:
    """Crop the paper margin the board leaves around each photo."""
    mask = tile.convert("L").point(lambda v: 255 if v < tolerance else 0)
    box = mask.getbbox()
    if not box:
        return tile
    x0, y0, x1, y1 = box
    air = int(max(tile.width, tile.height) * 0.04)
    return tile.crop(
        (
            max(0, x0 - air),
            max(0, y0 - air),
            min(tile.width, x1 + air),
            min(tile.height, y1 + air),
        )
    )


def square(tile: Image.Image) -> Image.Image:
    """Pad to a square on the board's own off-white, so every row matches.

    Squared rather than trimmed to the subject: these sit in a 64 px square on
    the menu row, and a photo cropped to its exact ink is a different shape on
    every line - the list stops reading as a list.
    """
    side = max(tile.size)
    canvas = Image.new("RGB", (side, side), (252, 251, 249))
    canvas.paste(tile, ((side - tile.width) // 2, (side - tile.height) // 2))
    if side > MAX_EDGE:
        canvas = canvas.resize((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    return canvas


def write_table(written: list[tuple[str, str]]) -> None:
    body = "\n".join(f"  '{menu_id}': '/menu/{slug}.webp'," for menu_id, slug in written)
    source = TABLE.read_text(encoding="utf-8")
    source = re.sub(
        r"export const BOARD_PHOTOS: Record<string, string> = \{.*?\n\};",
        "export const BOARD_PHOTOS: Record<string, string> = {\n"
        "  // Written by scripts/crop-menu-board.py - do not edit by hand.\n"
        f"{body}\n}};",
        source,
        flags=re.S,
    )
    TABLE.write_text(source, encoding="utf-8")


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(f"{__doc__}\nBoards: {', '.join(BOARDS)}")

    name, path = sys.argv[1], Path(sys.argv[2])
    if name not in BOARDS:
        sys.exit(f"Unknown board {name!r}. Known: {', '.join(BOARDS)}")
    if not path.exists():
        sys.exit(f"No such board: {path}")

    board = BOARDS[name]
    img = Image.open(path).convert("RGB")
    print(f"Board {path.name}  {img.width}x{img.height}")
    verify(img, board, name)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written: list[tuple[str, str]] = []
    sheet: list[tuple[str, Image.Image]] = []

    for number in sorted(board["tiles"]):
        section, row, col = board["tiles"][number]
        slug = SLUGS[number]
        tile = square(trim_white(img.crop(cell_box(board, section, row, col))))
        out = OUT_DIR / f"{slug}.webp"
        tile.save(out, "WEBP", quality=86, method=6)
        written.append((ID % number, slug))
        sheet.append((slug, tile))
        print(f"  {slug}.webp  {out.stat().st_size // 1024} KB")

    missing = sorted(set(SLUGS) - set(board["tiles"]))
    if missing:
        print("\nNot on this board, so left text-only:")
        for number in missing:
            print(f"  {SLUGS[number]}")

    # The only check that matters is a person seeing that the picture over
    # "italian-hot-dog" is an Italian hot dog.
    cols, cell, label_h = 5, 200, 22
    rows_n = (len(sheet) + cols - 1) // cols
    contact = Image.new("RGB", (cols * cell, rows_n * (cell + label_h)), "white")
    from PIL import ImageDraw

    draw = ImageDraw.Draw(contact)
    for i, (slug, tile) in enumerate(sheet):
        x, y = (i % cols) * cell, (i // cols) * (cell + label_h)
        contact.paste(tile.resize((cell, cell), Image.LANCZOS), (x, y))
        draw.text((x + 4, y + cell + 5), slug, fill="black")
    contact_path = path.parent / "menu-contact-sheet.png"
    contact.save(contact_path)
    print(f"\nContact sheet: {contact_path}")

    write_table(written)
    print(f"Wrote {len(written)} entries to {TABLE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
