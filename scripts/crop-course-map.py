"""
Cut the club's whole-course map out of the scanned yardage book.

    python scripts/crop-course-map.py        # writes frontend/public/course/course-map.webp

The map is the two-page spread `pelham golf course_20260908084445_003.jpeg` in
the root of drive D: (see crop-yardage-book.py for how the book was scanned). It
lies on its side like every page of the scan, and runs across the fold, with
the Pineridge advertiser's box beside one corner and the club's logo and
address below it.

The box below is in the scan's own coordinates, before turning it upright. The
advertiser's box is painted white first, because a rectangle around the map's
irregular edge takes in a corner of it. Then the map is cut out and turned 90
degrees clockwise so its numbers read, which is how the book prints it.

Printed out to COURSE_MAP in frontend/src/data/courseMap.ts: its width and height.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

SOURCE = Path("D:/pelham golf course_20260908084445_003.jpeg")
OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "course" / "course-map.webp"

# (left, top, right, bottom) in the 2550x3300 scan, lying on its side.
AD_BOX = (0, 0, 695, 1135)
MAP_BOX = (313, 717, 2110, 2385)


# Hole 9's number circle sits on the book's fold, so the scan shows it blank.
# The number is written back in, in the printed numbers' serif, at the circle's
# centre in the upright picture.
HOLE_9_CIRCLE = (1170, 1428, 28)  # x, y, radius inside the printed outline
NUMBER_FONT = ("C:/Windows/Fonts/times.ttf", 50)

# Scanned paper is a light grey; anything this close to white on every channel
# is paper, and is made white so the map sits on the app's page, not in a box.
PAPER = 222


def whiten_paper(image: Image.Image) -> None:
    r, g, b = image.split()
    lightest = ImageChops.darker(ImageChops.darker(r, g), b)
    image.paste((255, 255, 255), mask=lightest.point(lambda v: 255 if v > PAPER else 0))


def write_hole_9(image: Image.Image) -> None:
    x, y, radius = HOLE_9_CIRCLE
    draw = ImageDraw.Draw(image)
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill="white")
    draw.text((x, y), "9", fill="black", font=ImageFont.truetype(*NUMBER_FONT), anchor="mm")


def main() -> None:
    scan = Image.open(SOURCE).convert("RGB")
    ImageDraw.Draw(scan).rectangle(AD_BOX, fill="white")
    course = scan.crop(MAP_BOX).rotate(-90, expand=True)
    whiten_paper(course)
    write_hole_9(course)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    course.save(OUT, "WEBP", quality=80, method=6)
    print(f"{OUT} {course.width}x{course.height} {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
