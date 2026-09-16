"""Fly 예약 API(pelhamhills-api)에 Supabase 접속 정보를 시크릿으로 등록한다.

루트 `.env` 의 Supabase URL 과 service_role 키를 읽어 `flyctl secrets import --stage`
의 표준 입력으로 넘긴다. 값은 화면에 출력하지 않는다. `--stage` 라서 지금 도는
머신은 재시작되지 않고, 다음 `flyctl deploy` 때 새 코드와 함께 적용된다.

    python scripts/set_fly_supabase_secrets.py --check   # .env 만 검사 (Fly 에 보내지 않음)
    python scripts/set_fly_supabase_secrets.py           # Fly 에 등록
    flyctl deploy --remote-only -a pelhamhills-api

셸 파이프(`python ... | flyctl secrets import`)를 쓰지 않는 이유: Windows PowerShell 5.1
은 네이티브 프로그램 사이의 파이프에서 줄 끝을 CRLF 로 다시 쓰는데, 그러면 키 값
끝에 `\\r` 이 붙어 들어갈 수 있다. 여기서는 바이트를 그대로 넘긴다.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

from dotenv import dotenv_values

APP = "pelhamhills-api"
PROJECT_REF = "yxpiwwgquyaxjubovzmi"  # 공유 Supabase 프로젝트. 다른 프로젝트 값이면 중단한다.
ROOT = Path(__file__).resolve().parents[1]


def flyctl() -> str:
    found = shutil.which("flyctl") or shutil.which("fly")
    if found:
        return found
    fallback = Path.home() / ".fly" / "bin" / ("flyctl.exe" if os.name == "nt" else "flyctl")
    if fallback.exists():
        return str(fallback)
    sys.exit("flyctl 을 찾을 수 없습니다: https://fly.io/docs/flyctl/install/")


def read_env() -> tuple[str, str]:
    env = dotenv_values(ROOT / ".env")
    # 백엔드(`tee_sheet_supabase._URL_ENV`)와 같은 순서로 찾는다.
    url = (env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip().rstrip("/")
    key = (env.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url.startswith(f"https://{PROJECT_REF}."):
        sys.exit(f"중단: .env 의 Supabase URL 이 프로젝트 {PROJECT_REF} 가 아닙니다.")
    if len(key) < 40:
        sys.exit("중단: .env 에 SUPABASE_SERVICE_ROLE_KEY 가 없거나 너무 짧습니다.")
    return url, key


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help=".env 만 검사하고 Fly 에는 보내지 않는다")
    args = parser.parse_args()

    url, key = read_env()
    if args.check:
        print(f"OK: SUPABASE_URL (프로젝트 {PROJECT_REF}), SUPABASE_SERVICE_ROLE_KEY ({len(key)}자) — Fly 에는 보내지 않았습니다.")
        return

    payload = f"SUPABASE_URL={url}\nSUPABASE_SERVICE_ROLE_KEY={key}\n".encode()
    result = subprocess.run([flyctl(), "secrets", "import", "--stage", "-a", APP], input=payload)
    if result.returncode:
        sys.exit(f"flyctl secrets import 실패 (exit {result.returncode}). 위 메시지를 확인하세요.")
    print(f"완료: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 를 {APP} 에 등록했습니다 (다음 배포 때 적용).")
    print(f"다음 단계: flyctl deploy --remote-only -a {APP}")


if __name__ == "__main__":
    main()
