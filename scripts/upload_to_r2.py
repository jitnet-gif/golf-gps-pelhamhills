#!/usr/bin/env python3
"""코스 타일을 Cloudflare R2 에 올린다.

`scripts/generate-tiles.ts` 가 만든 `tiles/<courseId>/{z}/{x}/{y}.webp` 를 같은
모양 그대로 버킷에 넣는다. R2 는 S3 호환이라 boto3 로 바로 붙는다.

## `scripts/upload-to-r2.ts` 와의 관계

같은 일을 하는 스크립트가 둘이다. TypeScript 쪽이 `npm run upload-r2` 와
`npm run deploy:tiles` 파이프라인에 연결돼 있는 **정식 경로**이고, 이 파이썬
스크립트는 노드 툴체인 없이 손으로 한 번 올릴 때 쓰는 물건이다.

둘이 만드는 키는 **반드시 같아야 한다** (`tiles/<courseId>/{z}/{x}/{y}.<ext>`).
어긋나면 앱이 타일을 못 찾는데, 404 가 조용히 빈 타일로 보일 뿐이라 알아채기까지
오래 걸린다. 그래서 접두사와 환경변수 이름을 TS 쪽에 맞춰 두었다.

TS 쪽에 없는 것이 둘 있다:
  - `Cache-Control: immutable` — 타일은 좌표가 곧 내용이라 절대 바뀌지 않는다.
    이게 없으면 CDN 이 매번 되물어 첫 화면이 느려진다.
  - 진짜 이어올리기 — TS 쪽은 `skipped` 를 세는 자리만 있고 건너뛰는 코드가 없어
    항상 0 이다. 여기서는 버킷을 먼저 훑어 이미 있는 키를 실제로 건너뛴다.
    타일 수천 장을 올리다 끊겼을 때 처음부터 다시 하지 않으려면 이게 필요하다.

## 사전 준비

    pip install boto3          # backend/requirements.txt 에 이미 있다
    Cloudflare 대시보드 > R2 > Manage API Tokens 에서 Access Key / Secret 발급

## 환경변수

    CLOUDFLARE_ACCOUNT_ID          예: 1234567890abcdef1234567890abcdef
    CLOUDFLARE_ACCESS_KEY_ID
    CLOUDFLARE_ACCESS_KEY_SECRET
    R2_BUCKET_NAME                 기본값 golf-tiles
    CDN_DOMAIN                     선택. 퍼블릭 도메인을 연결했다면.

Cloudflare 문서와 R2 대시보드는 같은 값을 `R2_ACCOUNT_ID` /
`R2_SECRET_ACCESS_KEY` 로 부른다. 대시보드에서 복사해 온 이름을 그대로 쓰다
"환경변수 누락" 을 보는 일이 없도록 그 철자도 받아 준다 — 다만 저장소의 정식
이름은 위쪽(`CLOUDFLARE_*`)이고, 둘 다 있으면 그쪽이 이긴다.

## 사용법

    python scripts/upload_to_r2.py                       # tiles/pelham-hills
    python scripts/upload_to_r2.py --dry-run             # 올리지 않고 계획만
    python scripts/upload_to_r2.py --course-id my-course
    python scripts/upload_to_r2.py --force               # 이미 있는 것도 다시
"""

from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
except ImportError:  # pragma: no cover - 안내가 트레이스백보다 낫다
    raise SystemExit("boto3 가 필요하다: pip install boto3") from None

ROOT = Path(__file__).resolve().parent.parent

DEFAULT_COURSE_ID = "pelham-hills"
DEFAULT_TILES_DIR = ROOT / "tiles"
DEFAULT_BUCKET = "golf-tiles"
MAX_WORKERS = 8

#: 타일은 좌표가 곧 내용이다. 같은 z/x/y 가 다른 그림이 되는 일은 없으므로
#: 1년 immutable 로 못 박는다. 코스 이미지를 새로 뜨면 courseId 를 바꾼다.
CACHE_CONTROL = "public, max-age=31536000, immutable"

#: `scripts/upload-to-r2.ts` 의 `getContentType` 과 같은 표.
CONTENT_TYPES = {
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".json": "application/json",
    ".gz": "application/gzip",
}

#: 정식 이름이 앞, 대시보드에서 복사해 오는 철자가 뒤.
CREDENTIAL_ENV = {
    "account_id": ("CLOUDFLARE_ACCOUNT_ID", "R2_ACCOUNT_ID"),
    "access_key_id": ("CLOUDFLARE_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"),
    "secret_access_key": ("CLOUDFLARE_ACCESS_KEY_SECRET", "R2_SECRET_ACCESS_KEY"),
}


def env_any(names: tuple[str, ...]) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def get_client():
    credentials = {key: env_any(names) for key, names in CREDENTIAL_ENV.items()}

    missing = [
        f"{names[0]} (또는 {names[1]})"
        for key, names in CREDENTIAL_ENV.items()
        if not credentials[key]
    ]
    if missing:
        raise SystemExit("환경변수 누락:\n  " + "\n  ".join(missing))

    return boto3.client(
        "s3",
        endpoint_url=f"https://{credentials['account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=credentials["access_key_id"],
        aws_secret_access_key=credentials["secret_access_key"],
        region_name="auto",
    )


def content_type_for(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")


def existing_keys(client, bucket: str, prefix: str) -> set[str]:
    """버킷에 이미 있는 키. 이어올리기의 근거다.

    타일 수천 장 중간에 끊겼을 때 처음부터 다시 올리지 않기 위한 것이므로,
    목록 조회가 실패해도 업로드 자체를 막지는 않는다 — 최악이 "전부 다시 올림"
    이라 되돌릴 수 없는 손해가 아니다.
    """
    keys: set[str] = set()
    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                keys.add(item["Key"])
    except (BotoCoreError, ClientError) as exc:
        print(f"⚠️  기존 키 목록을 못 읽었다 ({exc}). 전부 다시 올린다.", file=sys.stderr)
        return set()
    return keys


def upload_one(client, bucket: str, local_path: Path, key: str) -> str:
    client.upload_file(
        str(local_path),
        bucket,
        key,
        ExtraArgs={"ContentType": content_type_for(local_path), "CacheControl": CACHE_CONTROL},
    )
    return key


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--course-id", default=DEFAULT_COURSE_ID,
                        help=f"코스 id. 로컬 디렉터리 이름이자 원격 키의 일부 (기본값: {DEFAULT_COURSE_ID})")
    parser.add_argument("--tiles-dir", type=Path, default=DEFAULT_TILES_DIR,
                        help=f"generate-tiles 의 출력 디렉터리 (기본값: {DEFAULT_TILES_DIR})")
    parser.add_argument("--force", action="store_true",
                        help="버킷에 이미 있는 키도 다시 올린다")
    parser.add_argument("--dry-run", action="store_true",
                        help="올리지 않고 무엇을 올릴지만 보여준다")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS)
    args = parser.parse_args()

    course_dir = args.tiles_dir / args.course_id
    if not course_dir.is_dir():
        raise SystemExit(
            f"{course_dir} 가 없다. 먼저 타일을 만들 것:\n  npm run generate-tiles"
        )

    files = sorted(path for path in course_dir.rglob("*") if path.is_file())
    if not files:
        raise SystemExit(f"{course_dir} 에 올릴 파일이 없다.")

    bucket = os.environ.get("R2_BUCKET_NAME", "").strip() or DEFAULT_BUCKET

    # 키 모양은 `scripts/upload-to-r2.ts` 와 **반드시** 같아야 한다.
    # tiles/<courseId>/{z}/{x}/{y}.<ext>
    prefix = f"tiles/{args.course_id}/"
    planned = [(path, prefix + path.relative_to(course_dir).as_posix()) for path in files]

    if args.dry_run:
        print(f"버킷 '{bucket}' 에 {len(planned)}개를 올릴 예정:")
        for _, key in planned[:5]:
            print("  ", key)
        if len(planned) > 5:
            print(f"   … 그리고 {len(planned) - 5}개 더")
        return 0

    client = get_client()

    skipped = 0
    if not args.force:
        already = existing_keys(client, bucket, prefix)
        before = len(planned)
        planned = [(path, key) for path, key in planned if key not in already]
        skipped = before - len(planned)
        if skipped:
            print(f"{skipped}개는 이미 버킷에 있어 건너뛴다 (--force 로 무시 가능).")

    if not planned:
        print("올릴 것이 없다. 전부 최신이다.")
        return 0

    print(f"{len(planned)}개 타일을 버킷 '{bucket}' 에 올린다...")

    ok, failed = 0, 0
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(upload_one, client, bucket, path, key): key
            for path, key in planned
        }
        for future in as_completed(futures):
            try:
                future.result()
                ok += 1
                if ok % 100 == 0:
                    print(f"  {ok}/{len(planned)} 완료...")
            except Exception as exc:
                failed += 1
                print(f"  실패: {futures[future]} — {exc}", file=sys.stderr)

    print(f"\n완료 — 성공 {ok} / 실패 {failed} / 건너뜀 {skipped}")

    cdn = os.environ.get("CDN_DOMAIN", "").strip().rstrip("/")
    base = cdn or "https://<R2 퍼블릭 도메인>"
    print(f"\n앱이 읽을 URL 패턴:\n  {base}/{prefix}{{z}}/{{x}}/{{y}}.webp")

    # 하나라도 실패하면 0 이 아닌 코드로 끝낸다. `deploy:tiles` 같은 파이프라인에
    # 물렸을 때 절반만 올라간 채로 다음 단계가 도는 것을 막는다.
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
