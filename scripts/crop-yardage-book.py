"""
Cut each hole's pictures out of the scanned yardage book.

    python scripts/crop-yardage-book.py            # writes frontend/public/holes/

The club's printed yardage book - the same book data/pelhamHillsBook.ts
transcribes - was scanned on 2026-09-08 into the root of drive D:, one two-page
spread per file, lying on its side (text reads bottom to top). Each hole's
spread has, on one page, an aerial photo of the hole above its number, notes and
an advertiser's box, and on the facing page the illustrated layout: tees,
hazards, yardage markers and a green inset. This keeps the layout drawing and the
aerial photo and leaves the advertising behind.

Which scan is which hole cannot be read off the file names - the scanner numbered
them in two batches and a third was named by hand - so the mapping below was read
off the pages themselves. The other scans in that folder are the cover, the pub
and tournament pages, the simulator page, the scorecard and a whole-course map.

    hole  file (D:\\)
       1  pelham golf course_004.jpeg
       2  pelham golf course_005.jpeg
       3  pelham golf course_006.jpeg
       4  pelham golf course_007.jpeg
       5  pelham golf course_008.jpeg
       6  pelham golf course_009.jpeg
       7  pelham golf course_20260908084442.jpeg
       8  pelham golf course_20260908084443_001.jpeg
       9  pelham golf course_20260908084444_002.jpeg
      10  pelham golf course_20260908084446_004.jpeg
      11  pelham golf course_20260908084447_005.jpeg
      12  pelham golf course_20260908084448_006.jpeg
      13  pelham golf course_20260908084449_007.jpeg
      14  pelham golf course_20260908084450_008.jpeg
      15  pelham golf course_20260908084456_009.jpeg
      16  pelham map add.jpeg
      17  pelham map add_001.jpeg
      18  pelham map add_002.jpeg

Every scan is 2550x3300 and the book sat in the same place on the glass for all
of them, so one pair of boxes fits every hole. The boxes are in the coordinates
of the scan turned upright (rotated 90 degrees clockwise, 3300x2550): the layout
page is the right-hand page, the photo the top band of the left-hand page, cut
short of the grey wave that runs under it and of the page edges either side.

Output is webp, which the service worker's image cache keeps once a picture has
been seen, and which the precache deliberately does not swallow on first visit -
see vite.config.ts. Sizes must match HOLE_LAYOUT_SIZE and HOLE_PHOTO_SIZE in
frontend/src/data/holeImages.ts, which the app uses to hold space for a picture
before it loads.

Needs Pillow (pip install pillow).
"""

import os
import sys

from PIL import Image

SOURCE_DIR = os.environ.get("YARDAGE_BOOK_DIR", "D:/")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "holes")

BATCH = "pelham golf course"
SCANS = {
    1: f"{BATCH}_004.jpeg",
    2: f"{BATCH}_005.jpeg",
    3: f"{BATCH}_006.jpeg",
    4: f"{BATCH}_007.jpeg",
    5: f"{BATCH}_008.jpeg",
    6: f"{BATCH}_009.jpeg",
    7: f"{BATCH}_20260908084442.jpeg",
    8: f"{BATCH}_20260908084443_001.jpeg",
    9: f"{BATCH}_20260908084444_002.jpeg",
    10: f"{BATCH}_20260908084446_004.jpeg",
    11: f"{BATCH}_20260908084447_005.jpeg",
    12: f"{BATCH}_20260908084448_006.jpeg",
    13: f"{BATCH}_20260908084449_007.jpeg",
    14: f"{BATCH}_20260908084450_008.jpeg",
    15: f"{BATCH}_20260908084456_009.jpeg",
    16: "pelham map add.jpeg",
    17: "pelham map add_001.jpeg",
    18: "pelham map add_002.jpeg",
}

# (left, top, right, bottom) in the upright scan.
LAYOUT_BOX = (2165, 40, 3290, 2100)
PHOTO_BOX = (858, 26, 2056, 452)

LAYOUT_WIDTH = 540
PHOTO_WIDTH = 960


def resized(image: Image.Image, width: int) -> Image.Image:
    return image.resize((width, round(width * image.height / image.width)), Image.LANCZOS)


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    sizes = set()

    for hole, name in SCANS.items():
        path = os.path.join(SOURCE_DIR, name)
        if not os.path.exists(path):
            print(f"missing scan for hole {hole}: {path}", file=sys.stderr)
            return 1

        upright = Image.open(path).convert("RGB").rotate(-90, expand=True)
        if upright.size != (3300, 2550):
            print(f"hole {hole}: unexpected scan size {upright.size}", file=sys.stderr)
            return 1

        layout = resized(upright.crop(LAYOUT_BOX), LAYOUT_WIDTH)
        photo = resized(upright.crop(PHOTO_BOX), PHOTO_WIDTH)
        sizes.add((layout.size, photo.size))

        for kind, image, quality in (("layout", layout, 78), ("photo", photo, 76)):
            out = os.path.join(OUT_DIR, f"hole-{hole}-{kind}.webp")
            image.save(out, "WEBP", quality=quality, method=6)
            total += os.path.getsize(out)

    (layout_size, photo_size), = sizes
    print(f"18 holes: layout {layout_size[0]}x{layout_size[1]}, photo {photo_size[0]}x{photo_size[1]}")
    print(f"{total // 1024} KB in {os.path.normpath(OUT_DIR)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
