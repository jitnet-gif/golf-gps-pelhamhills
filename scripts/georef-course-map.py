"""
Lay the club's printed course map on the satellite map.

    python scripts/georef-course-map.py [check.png]

Reads frontend/public/course/course-map.webp - crop-course-map.py's cut of the
yardage book, which prints the course with south at the top - and writes
frontend/public/course/course-map-geo.webp: the same picture turned north-up
and bent so that every hole's drawn tee and green sit on that hole's tee and pin
in the course data (frontend/src/data/pelhamHills.ts). Printed out: the
COURSE_MAP_OVERLAY constant for frontend/src/data/courseMap.ts.

The drawing is not to scale - its holes run from 1.75 to 2.3 pixels a metre -
so one straight stretch cannot line it up. It is bent with a thin-plate spline
through the tee and green of each hole: exact at those points, smooth between.

Turning the page over turns its printing upside down too. Each hole's number
disc, and the clubhouse sign, is turned back on the spot so they read. The
paper around the course is made see-through so the satellite map shows there.

Pass a path to also write a check picture with the course data's tee-to-pin
lines drawn on the result.
"""

import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "frontend" / "public" / "course" / "course-map.webp"
OUT = ROOT / "frontend" / "public" / "course" / "course-map-geo.webp"
HOLES_TS = ROOT / "frontend" / "src" / "data" / "pelhamHills.ts"

# Where each hole's tee and green are drawn, in pixels of the picture turned
# north-up (x right, y down). Read off the map at the end of each hole's line.
DRAWN = {
    1: ((767, 270), (788, 1018)),
    3: ((1008, 1519), (130, 1217)),
    4: ((90, 1047), (733, 1182)),
    5: ((770, 1110), (549, 874)),
    6: ((460, 992), (95, 195)),
    7: ((105, 113), (318, 132)),
    8: ((445, 110), (368, 712)),
    9: ((447, 738), (578, 100)),
    10: ((800, 242), (1490, 680)),
    11: ((1488, 745), (918, 770)),
    12: ((873, 830), (1153, 918)),
    13: ((1237, 970), (1053, 1660)),
    14: ((1140, 1727), (1468, 1452)),
    15: ((1553, 1497), (1333, 982)),
    16: ((1258, 925), (1523, 840)),
    17: ((1588, 770), (1513, 195)),
    18: ((1568, 100), (983, 268)),
}
# Hole 2 is left out: its tee and pin in the course data are 157 m apart on a
# 335-yard hole, so they would drag the drawing out of shape.

# Number discs, north-up pixels (refined to the disc's centre below).
NUMBERS = {
    1: (770, 780), 2: (948, 1257), 3: (598, 1335), 4: (462, 1155), 5: (640, 982),
    6: (107, 527), 7: (228, 120), 8: (365, 500), 9: (497, 368), 10: (1258, 565),
    11: (1183, 700), 12: (1058, 885), 13: (1128, 1387), 14: (1258, 1427),
    15: (1413, 1187), 16: (1403, 880), 17: (1533, 445), 18: (1188, 288),
}
DISC_INSIDE = 28   # radius inside the printed outline - what gets turned
DISC_KEEP = 36     # radius kept solid when the paper is made see-through
PAPER_MIN = 110    # paper: every channel at least this light...
PAPER_GREY = 24    # ...and channels this close together (no colour)
CLOSE = 15         # see-through gaps narrower than this many pixels are filled back in
CLUBHOUSE = (866, 132, 958, 196)

# Local metres around the course; only their ratio matters to the fit.
LAT0, LNG0 = 42.984, -79.300
M_LAT = 111_092.0
M_LNG = 81_570.0
PX_PER_M = 2.0     # output resolution, about the drawing's own
SMOOTHING = 1.0    # thin-plate regularisation; 0 passes exactly through every point


def course_points():
    text = HOLES_TS.read_text(encoding="utf-8")
    pattern = re.compile(
        r"holeNumber:\s*(\d+),.*?latitude:\s*([-\d.]+),\s*longitude:\s*([-\d.]+),"
        r"\s*teeLatitude:\s*([-\d.]+),\s*teeLongitude:\s*([-\d.]+)"
    )
    holes = {}
    for m in pattern.finditer(text):
        n, lat, lng, tlat, tlng = int(m[1]), *map(float, m.groups()[1:])
        holes[n] = ((tlat, tlng), (lat, lng))
    return holes


def to_m(lat, lng):
    return ((lng - LNG0) * M_LNG, (lat - LAT0) * M_LAT)


def tps_kernel(r):
    with np.errstate(divide="ignore", invalid="ignore"):
        k = r * r * np.log(r)
    return np.nan_to_num(k)


def fit_tps(src, dst, smoothing):
    """Thin-plate spline taking src (n,2) to dst (n,2)."""
    n = len(src)
    d = np.linalg.norm(src[:, None, :] - src[None, :, :], axis=2)
    k = tps_kernel(d) + smoothing * np.eye(n)
    p = np.hstack([np.ones((n, 1)), src])
    a = np.zeros((n + 3, n + 3))
    a[:n, :n], a[:n, n:], a[n:, :n] = k, p, p.T
    b = np.zeros((n + 3, 2))
    b[:n] = dst
    coef = np.linalg.solve(a, b)
    return src, coef[:n], coef[n:]


def apply_tps(model, pts):
    src, w, aff = model
    d = np.linalg.norm(pts[:, None, :] - src[None, :, :], axis=2)
    return tps_kernel(d) @ w + np.hstack([np.ones((len(pts), 1)), pts]) @ aff


def disc_centre(rgb, x, y, radius=40):
    """Centre of the white-and-black disc near (x, y): the low-colour pixels."""
    h, w, _ = rgb.shape
    for _ in range(3):
        x0, x1 = max(0, x - radius), min(w, x + radius + 1)
        y0, y1 = max(0, y - radius), min(h, y + radius + 1)
        patch = rgb[y0:y1, x0:x1].astype(int)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        inside = (xx - x) ** 2 + (yy - y) ** 2 <= radius * radius
        grey = (patch.max(axis=2) - patch.min(axis=2)) < 40
        mask = inside & grey
        if mask.sum() < 50:
            break
        nx, ny = int(round(xx[mask].mean())), int(round(yy[mask].mean()))
        if (nx, ny) == (x, y):
            break
        x, y = nx, ny
    return x, y


def turn_in_place(image, box):
    image.paste(image.crop(box).rotate(180), box[:2])


def turn_disc(image, cx, cy, r):
    box = (cx - r, cy - r, cx + r + 1, cy + r + 1)
    turned = image.crop(box).rotate(180)
    mask = Image.new("L", turned.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, 2 * r, 2 * r), fill=255)
    image.paste(turned, box[:2], mask)


def bilinear(rgba, u, v):
    h, w, _ = rgba.shape
    inside = (u >= 0) & (v >= 0) & (u <= w - 1) & (v <= h - 1)
    u = np.clip(u, 0, w - 1.001)
    v = np.clip(v, 0, h - 1.001)
    x0, y0 = np.floor(u).astype(int), np.floor(v).astype(int)
    fx, fy = (u - x0)[:, None], (v - y0)[:, None]
    a, b = rgba[y0, x0], rgba[y0, x0 + 1]
    c, d = rgba[y0 + 1, x0], rgba[y0 + 1, x0 + 1]
    out = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
    out[~inside] = 0
    return out


def main():
    picture = Image.open(SOURCE).convert("RGB").rotate(180)
    rgb = np.asarray(picture)

    centres = {}
    for n, (x, y) in NUMBERS.items():
        cx, cy = disc_centre(rgb, x, y)
        if abs(cx - x) > 12 or abs(cy - y) > 12:
            cx, cy = x, y  # the refinement wandered off; trust the reading
        centres[n] = (cx, cy)
        turn_disc(picture, cx, cy, DISC_INSIDE)
    turn_in_place(picture, CLUBHOUSE)

    rgba = np.dstack([np.asarray(picture), np.full(rgb.shape[:2], 255, np.uint8)]).astype(np.float32)
    # Paper is light and colourless: the white page, the scanner's grey speckle
    # on it, the book's fold. Everything the course is printed in has colour.
    colour = rgba[..., :3]
    paper = (colour.min(axis=2) > PAPER_MIN) & (colour.max(axis=2) - colour.min(axis=2) < PAPER_GREY)
    yy, xx = np.mgrid[0 : rgb.shape[0], 0 : rgb.shape[1]]
    for cx, cy in centres.values():
        paper &= (xx - cx) ** 2 + (yy - cy) ** 2 > DISC_KEEP * DISC_KEEP
    left, top, right, bottom = CLUBHOUSE
    paper[top:bottom, left:right] = False
    # A median pass drops the odd speck either way, so the edge is clean. Then
    # the drawing is closed over small gaps: the white flag-and-cup marks on the
    # greens and the thin cart paths are paint, not paper, and must not become
    # pin-holes onto the satellite picture.
    see_through = Image.fromarray((paper * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5))
    see_through = see_through.filter(ImageFilter.MinFilter(CLOSE)).filter(ImageFilter.MaxFilter(CLOSE))
    rgba[np.asarray(see_through) > 127, 3] = 0
    # Premultiply so see-through pixels do not bleed white into their neighbours.
    rgba[..., :3] *= rgba[..., 3:4] / 255.0

    holes = course_points()
    geo, drawn = [], []
    for n, (tee_px, pin_px) in DRAWN.items():
        tee, pin = holes[n]
        geo += [to_m(*tee), to_m(*pin)]
        drawn += [tee_px, pin_px]
    geo, drawn = np.array(geo, float), np.array(drawn, float)

    model = fit_tps(geo, drawn, SMOOTHING)
    back = fit_tps(drawn, geo, SMOOTHING)

    # How far a single straight stretch would have left each point, for the record.
    p = np.hstack([np.ones((len(drawn), 1)), drawn])
    affine, *_ = np.linalg.lstsq(p, geo, rcond=None)
    miss = np.linalg.norm(p @ affine - geo, axis=1)
    print(f"straight fit would miss by {miss.mean():.0f} m on average, {miss.max():.0f} m at worst")
    fit_miss = np.linalg.norm(apply_tps(model, geo) - drawn, axis=1)
    print(f"spline misses the drawn points by {fit_miss.max():.1f} px at worst")

    h, w = rgb.shape[:2]
    edge = np.array([(x, 0) for x in range(0, w, 20)] + [(x, h) for x in range(0, w, 20)]
                    + [(0, y) for y in range(0, h, 20)] + [(w, y) for y in range(0, h, 20)], float)
    ring = apply_tps(back, edge)
    xmin, ymin = ring.min(axis=0) - 20
    xmax, ymax = ring.max(axis=0) + 20

    out_w = int(math.ceil((xmax - xmin) * PX_PER_M))
    out_h = int(math.ceil((ymax - ymin) * PX_PER_M))
    result = np.zeros((out_h, out_w, 4), np.float32)
    cols = xmin + (np.arange(out_w) + 0.5) / PX_PER_M
    best = {n: (1e18, None) for n in centres}
    for j0 in range(0, out_h, 64):
        rows = ymax - (np.arange(j0, min(out_h, j0 + 64)) + 0.5) / PX_PER_M
        gx, gy = np.meshgrid(cols, rows)
        pts = np.column_stack([gx.ravel(), gy.ravel()])
        uv = apply_tps(model, pts)
        result[j0 : j0 + len(rows)] = bilinear(rgba, uv[:, 0], uv[:, 1]).reshape(len(rows), out_w, 4)
        for n, (cx, cy) in centres.items():
            d = (uv[:, 0] - cx) ** 2 + (uv[:, 1] - cy) ** 2
            i = int(d.argmin())
            if d[i] < best[n][0]:
                best[n] = (d[i], pts[i])

    alpha = result[..., 3:4]
    with np.errstate(divide="ignore", invalid="ignore"):
        colour = np.where(alpha > 0, result[..., :3] * 255.0 / alpha, 0)
    out = np.dstack([colour, alpha]).clip(0, 255).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(OUT, "WEBP", quality=82, method=6)

    south, north = LAT0 + ymin / M_LAT, LAT0 + ymax / M_LAT
    west, east = LNG0 + xmin / M_LNG, LNG0 + xmax / M_LNG
    labels = {n: (LAT0 + pt[1] / M_LAT, LNG0 + pt[0] / M_LNG) for n, (_, pt) in best.items()}
    print(f"{OUT} {out_w}x{out_h} {OUT.stat().st_size // 1024} KB")
    print("export const COURSE_MAP_OVERLAY = {")
    print("  url: '/course/course-map-geo.webp',")
    print(f"  bounds: [[{south:.7f}, {west:.7f}], [{north:.7f}, {east:.7f}]],")
    print("  numbers: [")
    for n in sorted(labels):
        lat, lng = labels[n]
        print(f"    {{ holeNumber: {n}, lat: {lat:.7f}, lng: {lng:.7f} }},")
    print("  ],")
    print("} as const;")

    if len(sys.argv) > 1:
        check = Image.fromarray(out, "RGBA").convert("RGB")
        draw = ImageDraw.Draw(check)
        to_px = lambda lat, lng: ((to_m(lat, lng)[0] - xmin) * PX_PER_M, (ymax - to_m(lat, lng)[1]) * PX_PER_M)
        for n, (tee, pin) in holes.items():
            a, b = to_px(*tee), to_px(*pin)
            draw.line([a, b], fill=(255, 0, 255), width=3)
            draw.ellipse((b[0] - 7, b[1] - 7, b[0] + 7, b[1] + 7), outline=(255, 0, 255), width=3)
            draw.rectangle((a[0] - 5, a[1] - 5, a[0] + 5, a[1] + 5), outline=(0, 255, 255), width=3)
        for n, (lat, lng) in labels.items():
            x, y = to_px(lat, lng)
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(255, 0, 0))
        check.save(sys.argv[1])


if __name__ == "__main__":
    main()
