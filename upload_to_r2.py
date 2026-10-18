#!/usr/bin/env python3
"""
Upload ./tiles to a Cloudflare R2 bucket, laid out as {z}/{x}/{y}.jpg so the
bucket can be served directly as a slippy-map tile source.

Needs four environment variables:

    CF_R2_ACCOUNT_ID          Cloudflare account id (R2 overview page)
    CF_R2_ACCESS_KEY_ID       R2 API token, Object Read & Write
    CF_R2_SECRET_ACCESS_KEY   shown once when the token is created
    CF_R2_TILES_BUCKET        bucket name, e.g. golf-gps-tiles

Deliberately NOT the golf-gps-photos bucket in .env.example: tiles are
immutable public reference data with a year-long cache header, user photos are
neither, and one bucket policy cannot be right for both.

Uploads are content-addressed by size: a key already present at the same byte
length is skipped, so a re-run after a partial upload is cheap. Pass --force to
re-upload regardless.

Usage:
    python3 upload_to_r2.py --dry-run
    python3 upload_to_r2.py
"""

from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

ROOT = Path(__file__).resolve().parent
TILES_DIR = ROOT / "tiles"

# Tiles never change meaning at a given path, so they are safe to cache hard.
CACHE_CONTROL = "public, max-age=31536000, immutable"
CONTENT_TYPE = "image/jpeg"
WORKERS = 16

REQUIRED = (
    "CF_R2_ACCOUNT_ID",
    "CF_R2_ACCESS_KEY_ID",
    "CF_R2_SECRET_ACCESS_KEY",
    "CF_R2_TILES_BUCKET",
)


def load_env(strict: bool = True) -> dict[str, str] | None:
    """Environment first, then .env.local as a fallback so the keys can live in
    the same gitignored file as the other local secrets.

    strict=False returns None instead of exiting, so --dry-run can fall back to
    a credential-free preview."""
    env = {k: os.environ.get(k, "") for k in REQUIRED}
    local = ROOT / ".env.local"
    if local.exists() and not all(env.values()):
        for line in local.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            if k in REQUIRED and not env[k]:
                env[k] = v.strip().strip("\"'")

    missing = [k for k in REQUIRED if not env[k]]
    if missing:
        if not strict:
            return None
        sys.exit(
            "Missing: "
            + ", ".join(missing)
            + "\nSet them in the environment or in .env.local (gitignored).\n"
            "CF_R2_ACCOUNT_ID is on the R2 overview page; the key pair comes\n"
            "from an R2 API token with Object Read & Write on the bucket."
        )
    return env


def tile_keys() -> list[tuple[Path, str]]:
    """Local file -> object key, key mirroring the on-disk {z}/{x}/{y}.jpg."""
    if not TILES_DIR.is_dir():
        sys.exit("No {} - run download_tiles.py first.".format(TILES_DIR))
    pairs = [
        (p, p.relative_to(TILES_DIR).as_posix())
        for p in sorted(TILES_DIR.rglob("*.jpg"))
    ]
    if not pairs:
        sys.exit("No .jpg tiles under {} - run download_tiles.py first.".format(TILES_DIR))
    return pairs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="list what would upload")
    ap.add_argument("--force", action="store_true", help="re-upload even if present")
    args = ap.parse_args()

    pairs = tile_keys()
    total_bytes = sum(p.stat().st_size for p, _ in pairs)
    print(
        "{} tiles, {:.1f} MB under {}".format(
            len(pairs), total_bytes / 1024 / 1024, TILES_DIR
        )
    )

    # Resolve credentials the same way for both modes - .env.local counts, so a
    # --dry-run with the keys in place still exercises the real connection.
    env = load_env(strict=not args.dry_run)
    if env is None:
        print("\n--dry-run without credentials; would upload keys like:")
        for _, key in pairs[:5]:
            print("  " + key)
        print("  ... {} more".format(len(pairs) - 5))
        return 0

    endpoint = "https://{}.r2.cloudflarestorage.com".format(env["CF_R2_ACCOUNT_ID"])
    bucket = env["CF_R2_TILES_BUCKET"]

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=env["CF_R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["CF_R2_SECRET_ACCESS_KEY"],
        # R2 ignores the region but botocore insists on one being set.
        region_name="auto",
        config=Config(retries={"max_attempts": 5, "mode": "standard"}),
    )

    # Preflight, but never a hard gate: an R2 token scoped to a single bucket
    # commonly has object permissions without bucket-level metadata, so a 403
    # here says nothing about whether the uploads will work. Only a genuine
    # "not found" / connection failure is worth stopping for.
    try:
        s3.head_bucket(Bucket=bucket)
    except ClientError as e:
        code = e.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if code == 403:
            print("note: no bucket-level read on '{}' - continuing.".format(bucket))
        else:
            sys.exit(
                "Cannot reach bucket '{}' at {}: {}\n"
                "Check CF_R2_ACCOUNT_ID, the bucket name, and that the token has\n"
                "Object Read & Write on it.".format(bucket, endpoint, e)
            )
    except BotoCoreError as e:
        # A wrong CF_R2_ACCOUNT_ID resolves to a host that exists but does not
        # serve this account - an SSL/connection error, not a ClientError, and
        # a raw traceback here reads like a bug in the script.
        sys.exit(
            "Could not connect to {}: {}\n"
            "That endpoint is built from CF_R2_ACCOUNT_ID - check it matches the\n"
            "account id on the R2 overview page.".format(endpoint, e)
        )

    existing: dict[str, int] = {}
    if not args.force:
        try:
            paginator = s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=bucket):
                for obj in page.get("Contents", []):
                    existing[obj["Key"]] = obj["Size"]
            print("{} objects already in {}".format(len(existing), bucket))
        except ClientError as e:
            # Same story: no list permission just means we cannot skip
            # unchanged tiles. Re-uploading 536 small objects is cheap.
            print("note: cannot list '{}' ({}) - uploading everything.".format(
                bucket, e.response.get("Error", {}).get("Code", "error")))
            existing = {}

    todo = [
        (p, k)
        for p, k in pairs
        if args.force or existing.get(k) != p.stat().st_size
    ]
    print("{} to upload, {} unchanged".format(len(todo), len(pairs) - len(todo)))

    if args.dry_run:
        for _, key in todo[:10]:
            print("  would put " + key)
        if len(todo) > 10:
            print("  ... {} more".format(len(todo) - 10))
        return 0

    if not todo:
        print("Nothing to do.")
        return 0

    def put(path: Path, key: str) -> str | None:
        try:
            s3.upload_file(
                str(path),
                bucket,
                key,
                ExtraArgs={
                    "ContentType": CONTENT_TYPE,
                    "CacheControl": CACHE_CONTROL,
                },
            )
            return None
        except ClientError as e:
            return "{}: {}".format(key, e)

    failures: list[str] = []
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(put, p, k): k for p, k in todo}
        for fut in as_completed(futures):
            err = fut.result()
            done += 1
            if err:
                failures.append(err)
            if done % 50 == 0 or done == len(todo):
                print(
                    "  {}/{}  failed={}".format(done, len(todo), len(failures)),
                    flush=True,
                )

    print("\nuploaded {}, failed {}".format(len(todo) - len(failures), len(failures)))
    for f in failures[:20]:
        print("  " + f)
    if failures:
        return 1

    print(
        "\nNext: expose the bucket (public r2.dev URL or a custom domain), then\n"
        "set VITE_TILE_URL to  <base>/{z}/{x}/{y}.jpg\n"
        "NOTE: the service worker tile rule in frontend/vite.config.ts matches\n"
        "  /MapServer/tile/{z}/{y}/{x}  and will NOT match that R2 URL shape.\n"
        "Update that urlPattern in the same change or offline caching silently\n"
        "stops working."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
