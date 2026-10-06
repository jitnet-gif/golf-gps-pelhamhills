"""전화 예약을 한 번에 올리고 **켜 둔 동안 살아 있게** 지킨다.

    python scripts/voice_up.py            # 전부 올리고 Ctrl-C 까지 지킨다
    python scripts/voice_up.py --no-backend   # 백엔드를 따로 띄워 뒀을 때

무엇을 하나
-----------
백엔드(:8000) → 프록시(:8099) → cloudflared 터널을 띄우고, 받은 공개 주소를 `.env` 에
쓴 뒤 ElevenLabs 에 등록된 도구 12개를 그 주소로 다시 겨눈다.

왜 한 덩어리인가
----------------
`trycloudflare` 주소는 띄울 때마다 바뀐다. 터널만 새로 띄우고 도구 주소를 안 맞추면
등록된 도구가 **죽은 주소**를 가리키고, 그 사실은 손님이 전화해서 예약이 실패한
뒤에야 드러난다. 그래서 "터널 띄우기" 와 "도구 주소 갱신" 은 절대 따로 일어나지 않는다.

왜 지키고 있나
--------------
터널은 밤새 돌다가 끊긴다. 끊긴 줄 모르고 두면 전화는 받는데 예약만 안 되는 상태가
된다 — 가장 나쁜 고장이다. 그래서 이 스크립트는 터널이 죽으면 다시 띄우고 **도구
주소까지 다시 맞춘 뒤** 계속 지킨다. 주기적으로 공개 주소를 직접 찔러 확인한다.

이건 어디까지나 임시방편이다. 상설로 쓰려면 백엔드를 상시 호스팅해야 한다
(`scripts/fly_up.py`). 노트북을 닫으면 전화 예약은 그 순간 멈춘다.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
PROXY_PORT = os.getenv("VOICE_PROXY_PORT", "8099")
BACKEND_PORT = "8000"
TUNNEL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")

#: 공개 주소가 살아 있는지 확인하는 주기(초). 너무 자주 찌르면 로그만 지저분해진다.
HEALTH_EVERY = 60

CLOUDFLARED_CANDIDATES = (
    "cloudflared",
    r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
    r"C:\Program Files\cloudflared\cloudflared.exe",
)

procs: list[subprocess.Popen] = []


def stamp() -> str:
    return time.strftime("%H:%M:%S")


def say(msg: str) -> None:
    print(f"[{stamp()}] {msg}", flush=True)


def find_cloudflared() -> str:
    for candidate in CLOUDFLARED_CANDIDATES:
        found = shutil.which(candidate) or (candidate if Path(candidate).exists() else None)
        if found:
            return found
    raise SystemExit(
        "cloudflared 를 찾지 못했다. https://developers.cloudflare.com/cloudflare-one/"
        "connections/connect-networks/downloads/ 에서 받거나 PATH 에 넣을 것."
    )


def wait_http(url: str, seconds: int = 40) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=3)
            return True
        except urllib.error.HTTPError:
            return True          # 405 등도 "떠 있다" 는 뜻이다
        except Exception:
            time.sleep(0.5)
    return False


def public_alive(base: str) -> bool:
    """공개 주소가 **프록시까지** 살아 있는지. 터널만 떠 있고 뒤가 죽은 경우를 잡는다."""
    try:
        urllib.request.urlopen(f"{base.rsplit('/api/v1', 1)[0]}/healthz", timeout=8)
        return True
    except urllib.error.HTTPError as e:
        return e.code == 404      # 프록시가 /healthz 외에는 404 를 준다 = 살아 있다
    except Exception:
        return False


def set_env_value(key: str, value: str) -> None:
    text = ENV.read_text(encoding="utf-8")
    if re.search(rf"^{key}=.*$", text, flags=re.M):
        text = re.sub(rf"^{key}=.*$", f"{key}={value}", text, flags=re.M)
    else:
        text = text.rstrip("\n") + f"\n{key}={value}\n"
    ENV.write_text(text, encoding="utf-8")


def start_tunnel() -> tuple[subprocess.Popen, str]:
    proc = subprocess.Popen(
        [find_cloudflared(), "tunnel", "--url", f"http://localhost:{PROXY_PORT}", "--no-autoupdate"],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    procs.append(proc)
    deadline = time.time() + 60
    while time.time() < deadline and proc.stdout is not None:
        line = proc.stdout.readline()
        if not line:
            if proc.poll() is not None:
                break
            continue
        match = TUNNEL_RE.search(line)
        if match:
            return proc, match.group(0)
    proc.terminate()
    raise RuntimeError("터널 주소를 받지 못했다")


def point_tools_at(base: str) -> bool:
    """`.env` 와 ElevenLabs 의 도구 주소를 이 주소로 맞춘다."""
    set_env_value("PUBLIC_API_BASE_URL", base)
    done = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "attach_voice_tools.py"), "--apply"],
        cwd=ROOT, env={**os.environ, "PUBLIC_API_BASE_URL": base},
        capture_output=True, text=True)
    if done.returncode != 0:
        say("도구 주소 갱신 실패:")
        print(done.stdout[-800:], done.stderr[-800:])
        return False
    return True


def shutdown() -> None:
    for p in reversed(procs):
        if p.poll() is None:
            p.terminate()
    print()
    say("내렸다. 지금부터 전화 예약 도구는 죽은 주소를 가리킨다.")
    say("다시 쓰려면 이 스크립트를 또 돌릴 것 (도구 주소가 그때 다시 맞춰진다).")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-backend", action="store_true", help="백엔드는 따로 띄워 뒀다")
    parser.add_argument("--force", action="store_true", help="Fly 가 살아 있어도 터널을 띄운다")
    args = parser.parse_args()

    # Fly 가 멀쩡한데 이걸 띄우면, 터널이 끊길 때마다 워치독이 ElevenLabs 도구 12개를
    # **터널 주소로 돌려놓는다**. 그 창을 닫는 순간 전화 예약이 죽는다 — 상시 서버가
    # 있는데도. 그래서 기본적으로 멈춘다.
    fly_base = "https://pelham-hills-api.fly.dev"
    if not args.force:
        try:
            urllib.request.urlopen(f"{fly_base}/", timeout=8)
        except Exception:
            pass
        else:
            raise SystemExit(
                f"{fly_base} 가 살아 있다. 터널은 Fly 가 죽었을 때만 쓴다 —\n"
                "지금 띄우면 ElevenLabs 도구가 이 노트북을 가리키게 되고, 창을 닫으면 멈춘다.\n"
                "그래도 띄우려면 --force."
            )

    if not args.no_backend:
        say(f"백엔드 :{BACKEND_PORT}")
        procs.append(subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.main:app",
             "--host", "127.0.0.1", "--port", BACKEND_PORT, "--log-level", "warning"],
            cwd=ROOT))
    if not wait_http(f"http://127.0.0.1:{BACKEND_PORT}/"):
        shutdown()
        raise SystemExit("백엔드가 뜨지 않았다.")

    say(f"프록시 :{PROXY_PORT} (음성 도구 경로만 공개)")
    procs.append(subprocess.Popen(
        [sys.executable, str(ROOT / "scripts" / "voice_tunnel_proxy.py")], cwd=ROOT))
    if not wait_http(f"http://127.0.0.1:{PROXY_PORT}/healthz"):
        shutdown()
        raise SystemExit("프록시가 뜨지 않았다.")

    tunnel, url = start_tunnel()
    base = f"{url}/api/v1"
    say(f"터널 {url}")
    if not point_tools_at(base):
        shutdown()
        raise SystemExit("도구 주소를 맞추지 못했다.")
    say("도구 12개를 이 주소로 겨눴다.")

    number = os.getenv("TWILIO_PHONE_NUMBER", "(번호 미설정)")
    print("\n" + "=" * 62)
    print(f"  준비됨. {number} 로 전화하면 된다.")
    print("  ⚠️ 실제 티 시트에 기록된다 (TEE_SHEET_BACKEND=supabase).")
    print("  터널이 끊기면 알아서 다시 띄우고 도구 주소도 다시 맞춘다.")
    print("  Ctrl-C 로 내리면 예약 도구가 죽는다.")
    print("=" * 62 + "\n")

    last_check = time.time()
    try:
        while True:
            if tunnel.poll() is not None:
                say("터널이 끊겼다. 다시 띄운다.")
            elif time.time() - last_check >= HEALTH_EVERY:
                last_check = time.time()
                if public_alive(base):
                    continue
                say("공개 주소가 응답하지 않는다. 터널을 다시 띄운다.")
                tunnel.terminate()
            else:
                time.sleep(1)
                continue

            try:
                tunnel, url = start_tunnel()
            except Exception as exc:
                say(f"터널 재시작 실패({exc}). 10초 뒤 다시 시도한다.")
                time.sleep(10)
                continue
            new_base = f"{url}/api/v1"
            say(f"새 터널 {url}")
            if point_tools_at(new_base):
                base = new_base
                say("도구 주소를 새 주소로 다시 맞췄다. 예약이 다시 동작한다.")
            last_check = time.time()
    except KeyboardInterrupt:
        pass
    shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
