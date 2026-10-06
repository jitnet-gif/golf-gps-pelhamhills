"""Fly 에 백엔드를 올리고, ElevenLabs 도구를 그 **고정 주소**로 돌려 놓는다.

터널(`voice_up.py`)은 임시방편이다. 주소가 띄울 때마다 바뀌고, 노트북을 닫으면
전화 예약이 죽는다. Fly 에 올리면 `https://pelhamhills-api.fly.dev` 로 고정되므로
도구 주소를 다시 맞출 일이 없다.

    python scripts/fly_up.py --dry-run    # 무엇을 보낼지만 본다 (비밀값은 가린다)
    python scripts/fly_up.py --apply

공개 표면
---------
`fly.toml` 이 `PUBLIC_SURFACE=voice` 를 넘기므로 배포된 앱은 **음성 도구와 Twilio
웹훅만** 연다. 티 시트·리테일·시뮬레이터 라우터와 문자 기록 조회(`/sms/messages`)는
등록조차 되지 않는다 — 전부 인증이 없어서 공개하면 고객 이름·전화번호가 주소만
알면 읽힌다. 그 화면들은 2026-09 에 Supabase 로 옮겨가서(0004) 이 서버가 필요 없다.

배포 뒤에 확인할 것: `/api/v1/tee-sheet/bookings` 와 `/api/v1/sms/messages` 가 404 여야
하고, 음성 도구는 시크릿 없이 401 이어야 한다.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
def app_name() -> str:
    """`fly.toml` 의 app 이름. 여기에 적어 두면 둘이 어긋난다 — 2026-10-06 에
    조직을 옮기며 이름이 바뀌었고, 그때 하드코딩돼 있었다면 엉뚱한 앱에 배포했을 것이다."""
    for line in (ROOT / "fly.toml").read_text(encoding="utf-8").splitlines():
        m = re.match(r'^\s*app\s*=\s*"([^"]+)"', line)
        if m:
            return m.group(1)
    raise SystemExit("fly.toml 에서 app 이름을 찾지 못했다.")


APP = app_name()
BASE = f"https://{APP}.fly.dev"

#: 배포된 앱이 실제로 읽는 값만 보낸다. `.env` 를 통째로 밀어 넣지 않는다 —
#: 로컬 전용 값(PUBLIC_API_BASE_URL 등)이 섞이면 배포가 자기 자신을 잘못 가리킨다.
SECRETS = (
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_AGENT_ID",
    "ELEVENLABS_WEBHOOK_SECRET",
    "VOICE_TOOL_SECRET",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "ALLOWED_ORIGINS",
    "CLUB_TIMEZONE",
    "PROSHOP_PHONE_NUMBER",
    # 문자 예약 비서. 켜는 스위치(SMS_BOOKING_ENABLED)는 fly.toml 에 있다.
    "ANTHROPIC_API_KEY",
    "SMS_AGENT_MODEL",
)


def flyctl() -> str:
    for candidate in ("flyctl", str(Path.home() / ".fly" / "bin" / "flyctl.exe"),
                      str(Path.home() / ".fly" / "bin" / "flyctl")):
        found = shutil.which(candidate) or (candidate if Path(candidate).exists() else None)
        if found:
            return found
    raise SystemExit("flyctl 을 찾지 못했다. https://fly.io/docs/flyctl/install/")


def read_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print("  $", " ".join(c if not c.startswith("--") or "=" not in c else c.split("=")[0] + "=…"
                          for c in cmd[:6]), "…" if len(cmd) > 6 else "")
    return subprocess.run(cmd, cwd=ROOT, **kw)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-secrets", action="store_true")
    args = parser.parse_args()

    fly = flyctl()
    env = read_env()
    present = [k for k in SECRETS if env.get(k)]
    missing = [k for k in SECRETS if not env.get(k)]

    print(f"앱: {APP}  ({BASE})")
    print(f"보낼 비밀값 {len(present)}개: {', '.join(present)}")
    if missing:
        print(f"비어 있어 건너뛸 값: {', '.join(missing)}")

    if not args.apply:
        print("\ndry-run 이다. 실제로 올리려면 --apply.")
        print("⚠️ 배포하면 /api/v1/tee-sheet/* 가 인증 없이 공개된다 (docstring 참고).")
        return 0

    who = subprocess.run([fly, "auth", "whoami"], cwd=ROOT, capture_output=True, text=True)
    if who.returncode != 0:
        raise SystemExit(f"flyctl 로그인이 필요하다: {who.stderr.strip()[:200]}")
    print(f"계정: {who.stdout.strip()}")

    if not args.skip_secrets and present:
        print("\n[1/3] 비밀값")
        pairs = [f"{k}={env[k]}" for k in present]
        # 한 번에 보낸다. 나눠 보내면 앱이 그때마다 재시작한다.
        done = run([fly, "secrets", "set", "--app", APP, "--stage", *pairs])
        if done.returncode != 0:
            raise SystemExit("비밀값 설정 실패. 카드 등록이 안 됐다면 https://fly.io/trial")

    print("\n[2/3] 배포")
    done = run([fly, "deploy", "--remote-only", "--app", APP])
    if done.returncode != 0:
        raise SystemExit("배포 실패. 위 출력을 볼 것.")

    print("\n[3/3] 확인 + 도구 주소 갱신")
    import urllib.request
    try:
        with urllib.request.urlopen(f"{BASE}/", timeout=30) as r:
            print("  헬스체크:", r.status, r.read(80).decode("utf-8", "replace"))
    except Exception as exc:
        raise SystemExit(f"배포는 끝났는데 {BASE} 가 응답하지 않는다: {exc}")

    base = f"{BASE}/api/v1"
    text = ENV.read_text(encoding="utf-8")
    ENV.write_text(re.sub(r"^PUBLIC_API_BASE_URL=.*$", f"PUBLIC_API_BASE_URL={base}",
                          text, flags=re.M), encoding="utf-8")
    print(f"  PUBLIC_API_BASE_URL = {base}")

    done = subprocess.run([sys.executable, str(ROOT / "scripts" / "attach_voice_tools.py"), "--apply"],
                          cwd=ROOT, env={**os.environ, "PUBLIC_API_BASE_URL": base})
    if done.returncode != 0:
        raise SystemExit("도구 주소 갱신 실패.")

    print(f"\n완료. 이제 터널 없이도 {os.getenv('TWILIO_PHONE_NUMBER', '전화번호')} 가 동작한다.")
    print("확인: /api/v1/tee-sheet/bookings 와 /api/v1/sms/messages 가 404 인지 한 번 볼 것.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
