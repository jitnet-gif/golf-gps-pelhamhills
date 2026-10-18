#!/usr/bin/env python3
"""
Pre-download the Esri World Imagery tiles this course needs, so they can be
re-hosted (see upload_to_r2.py) instead of pulled from Esri on every round.

The tile set here must be IDENTICAL to the one the app asks for at runtime,
otherwise a player gets holes on a grey background. So the geometry is not
re-derived: it mirrors, exactly,
  - frontend/src/lib/tiles.ts          (URL template, z15-19, pad 0.0009)
  - frontend/src/hooks/useMapTiles.ts  (floor() on both ends of each axis)
  - frontend/src/components/OfflineCourse.tsx (all 36 tee+pin points)

Two things that bite:
  - Esri serves {z}/{y}/{x} - y before x. We store {z}/{x}/{y}.jpg, the usual
    slippy-map layout. The swap is silent when you get it wrong: you get real
    imagery, just of the wrong place.
  - Esri answers 200 with a placeholder for tiles it has no coverage for, so a
    status check alone is not enough. Every body is checked for the JPEG magic
    bytes before it is written.

Usage:
    python3 download_tiles.py              # download into ./tiles
    python3 download_tiles.py --dry-run    # just print the bbox and counts
"""

from __future__ import annotations

import argparse
import math
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
HOLES_TS = ROOT / "frontend" / "src" / "data" / "pelhamHills.ts"
OUT_DIR = ROOT / "tiles"

# Kept in step with frontend/src/lib/tiles.ts.
TILE_URL = (
    "https://server.arcgisonline.com/ArcGIS/rest/services/"
    "World_Imagery/MapServer/tile/{z}/{y}/{x}"
)
MIN_ZOOM = 15
MAX_ZOOM = 19

# boundsFor()'s default pad in tiles.ts: ~100 m past the outermost tee and pin.
PAD = 0.0009

# Leave both at None to derive the box from the hole coordinates - the correct
# behaviour, and what keeps this set equal to the app's. Set them (degrees,
# half-width about the course centre) only to deliberately over-cover, e.g. if
# the visual check shows the course running past the edge.
LAT_DELTA: float | None = None
LON_DELTA: float | None = None

WORKERS = 6
RETRIES = 4
JPEG_MAGIC = b"\xff\xd8\xff"
UA = "golf-gps-app tile prefetch, python-requests"


def hole_points() -> list[tuple[float, float]]:
    """The 36 tee and pin coordinates, read from the bundled course data."""
    src = HOLES_TS.read_text(encoding="utf-8")
    pattern = (
        r"latitude:\s*(-?[\d.]+), longitude:\s*(-?[\d.]+), "
        r"teeLatitude:\s*(-?[\d.]+), teeLongitude:\s*(-?[\d.]+)"
    )
    pts: list[tuple[float, float]] = []
    for m in re.finditer(pattern, src):
        pin_lat, pin_lng, tee_lat, tee_lng = map(float, m.groups())
        pts.append((pin_lat, pin_lng))
        pts.append((tee_lat, tee_lng))
    if not pts:
        sys.exit("No hole coordinates parsed from " + str(HOLES_TS))
    return pts


def bounds(pts: list[tuple[float, float]]) -> dict[str, float]:
    lats = [p[0] for p in pts]
    lngs = [p[1] for p in pts]
    if LAT_DELTA is not None or LON_DELTA is not None:
        c_lat = (max(lats) + min(lats)) / 2
        c_lng = (max(lngs) + min(lngs)) / 2
        d_lat = LAT_DELTA if LAT_DELTA is not None else (max(lats) - min(lats)) / 2 + PAD
        d_lng = LON_DELTA if LON_DELTA is not None else (max(lngs) - min(lngs)) / 2 + PAD
        return {
            "north": c_lat + d_lat,
            "south": c_lat - d_lat,
            "east": c_lng + d_lng,
            "west": c_lng - d_lng,
        }
    return {
        "north": max(lats) + PAD,
        "south": min(lats) - PAD,
        "east": max(lngs) + PAD,
        "west": min(lngs) - PAD,
    }


def lon2tile(lon: float, z: float) -> float:
    return (lon + 180) / 360 * 2**z


def lat2tile(lat: float, z: float) -> float:
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2**z


def pyramid(b: dict[str, float]) -> list[tuple[int, int, int]]:
    """Every (z, x, y) the course needs. floor() on both ends, as useMapTiles
    does - ceil() on the far edge pulls in a spurious extra row and column."""
    tiles: list[tuple[int, int, int]] = []
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        x_min = math.floor(lon2tile(b["west"], z))
        x_max = math.floor(lon2tile(b["east"], z))
        y_min = math.floor(lat2tile(b["north"], z))
        y_max = math.floor(lat2tile(b["south"], z))
        for x in range(x_min, x_max + 1):
            for y in range(y_min, y_max + 1):
                tiles.append((z, x, y))
    return tiles


def fetch(session: requests.Session, z: int, x: int, y: int) -> str:
    """Download one tile. Returns 'skip', 'ok', or an error string."""
    dest = OUT_DIR / str(z) / str(x) / (str(y) + ".jpg")
    if dest.exists() and dest.stat().st_size > 0:
        return "skip"

    # Esri's path order is {z}/{y}/{x}; our layout on disk is {z}/{x}/{y}.
    url = TILE_URL.format(z=z, y=y, x=x)
    for attempt in range(RETRIES):
        try:
            r = session.get(url, timeout=30)
            if r.status_code >= 500:
                time.sleep(2**attempt)
                continue
            if r.status_code != 200:
                return "HTTP " + str(r.status_code)
            body = r.content
            if not body.startswith(JPEG_MAGIC):
                # Esri answers 200 with a placeholder where it has no imagery.
                return "not JPEG ({} B, {})".format(
                    len(body), r.headers.get("content-type")
                )
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(body)
            return "ok"
        except requests.RequestException as e:
            if attempt == RETRIES - 1:
                return "{}: {}".format(type(e).__name__, e)
            time.sleep(2**attempt)
    return "gave up after retries"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--dry-run", action="store_true", help="print the plan, download nothing"
    )
    args = ap.parse_args()

    pts = hole_points()
    b = bounds(pts)
    tiles = pyramid(b)

    origin = (
        "derived, pad {:.4f}".format(PAD)
        if LAT_DELTA is None and LON_DELTA is None
        else "LAT_DELTA/LON_DELTA override"
    )
    print("{} tee+pin points from {}".format(len(pts), HOLES_TS.name))
    print(
        "bbox  N {:.7f}  S {:.7f}  E {:.7f}  W {:.7f}".format(
            b["north"], b["south"], b["east"], b["west"]
        )
    )
    print(
        "      half-span {:.7f} lat / {:.7f} lon  ({})".format(
            (b["north"] - b["south"]) / 2, (b["east"] - b["west"]) / 2, origin
        )
    )
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        n = sum(1 for t in tiles if t[0] == z)
        print("      z{}: {} tiles".format(z, n))
    print(
        "total {} tiles, roughly {:.1f} MB".format(
            len(tiles), len(tiles) * 9 / 1024
        )
    )

    if args.dry_run:
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = UA

    counts = {"ok": 0, "skip": 0}
    failures: list[str] = []
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch, session, *t): t for t in tiles}
        for fut in as_completed(futures):
            z, x, y = futures[fut]
            result = fut.result()
            done += 1
            if result in counts:
                counts[result] += 1
            else:
                failures.append("z{}/{}/{}: {}".format(z, x, y, result))
            if done % 50 == 0 or done == len(tiles):
                print(
                    "  {}/{}  ok={} cached={} failed={}".format(
                        done, len(tiles), counts["ok"], counts["skip"], len(failures)
                    ),
                    flush=True,
                )

    on_disk = sum(1 for _ in OUT_DIR.rglob("*.jpg"))
    print(
        "\ndownloaded {}, already present {}, failed {}".format(
            counts["ok"], counts["skip"], len(failures)
        )
    )
    print("{} .jpg files under {}".format(on_disk, OUT_DIR))
    if failures:
        print("\nfailures (re-run to retry - existing files are skipped):")
        for f in failures[:20]:
            print("  " + f)
        if len(failures) > 20:
            print("  ... and {} more".format(len(failures) - 20))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
