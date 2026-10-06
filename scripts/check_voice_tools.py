"""음성 도구가 세 곳에서 일치하는지 본다. 어긋나면 통화 중에 404 가 난다.

도구 하나를 추가할 때 손대야 하는 곳이 셋이다:

  1. `backend/api/routes/voice.py`      — 실제 구현 (`@tools_router.post`)
  2. `ops/elevenlabs/agent.json`        — 에이전트가 아는 도구 목록
  3. `scripts/voice_tunnel_proxy.py`    — 터널로 내보낼 허용 경로

셋 중 하나를 빠뜨려도 로컬에서는 멀쩡해 보인다. 프록시만 빠뜨리면 터널 뒤에서만
404 가 나는데, 그때는 이미 손님이 전화를 걸고 있다. 그래서 커밋 전에 이걸 돌린다.

    python scripts/check_voice_tools.py      # 어긋나면 종료코드 1
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VOICE = ROOT / "backend" / "api" / "routes" / "voice.py"
AGENT = ROOT / "ops" / "elevenlabs" / "agent.json"
PROXY = ROOT / "scripts" / "voice_tunnel_proxy.py"

API_PREFIX = "/api/v1"


def implemented() -> set[str]:
    """voice.py 가 실제로 서비스하는 도구 경로."""
    return set(re.findall(r'tools_router\.post\("([^"]+)"', VOICE.read_text(encoding="utf-8")))


def declared() -> dict[str, str]:
    """agent.json 이 에이전트에게 알려 주는 도구 이름 -> 경로."""
    data = json.loads(AGENT.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for tool in data.get("tools", []):
        name = str(tool.get("name", ""))
        if name.startswith("_"):
            continue
        url = tool.get("api_schema", {}).get("url", "")
        out[name] = url.replace("{{API_BASE}}", "")
    return out


def exposed() -> set[str]:
    """프록시가 공개하는 경로. post-call 은 시크릿이 있을 때만 열리므로 뺀다."""
    text = PROXY.read_text(encoding="utf-8")
    block = text.split("ALLOW = {", 1)[1].split("}", 1)[0]
    return {m for m in re.findall(r'"([^"]+)"', block)}


def main() -> int:
    impl = implemented()
    decl = declared()
    prox = exposed()
    decl_paths = set(decl.values())
    prox_paths = {p[len(API_PREFIX):] for p in prox if p.startswith(API_PREFIX)}

    problems: list[str] = []

    missing_impl = decl_paths - impl
    if missing_impl:
        problems.append(
            "agent.json 에 있는데 voice.py 에 없다 (에이전트가 부르면 404): "
            + ", ".join(sorted(missing_impl))
        )

    unknown = impl - decl_paths
    if unknown:
        problems.append(
            "voice.py 에 있는데 agent.json 에 없다 (에이전트가 존재를 모른다): "
            + ", ".join(sorted(unknown))
        )

    unexposed = decl_paths - prox_paths
    if unexposed:
        problems.append(
            "agent.json 에 있는데 프록시가 막는다 (터널 뒤에서만 404): "
            + ", ".join(sorted(unexposed))
        )

    stray = prox_paths - impl
    if stray:
        problems.append(
            "프록시가 여는데 구현이 없다 (공개할 이유가 없는 경로): " + ", ".join(sorted(stray))
        )

    print(f"구현 {len(impl)}  ·  agent.json {len(decl)}  ·  프록시 {len(prox_paths)}")
    for name in sorted(decl):
        mark = "OK " if decl[name] in impl and decl[name] in prox_paths else "!! "
        print(f"  {mark}{name:18s} {decl[name]}")

    if problems:
        print()
        for line in problems:
            print("  어긋남: " + line)
        return 1

    print("\n세 곳이 일치한다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
