"""`ops/elevenlabs/agent.json` 을 ElevenLabs 계정에 밀어 넣는다.

왜 스크립트인가: 에이전트의 프롬프트와 도구 스키마는 이 시스템에서 코드만큼 중요한
설정이다. 대시보드에서 클릭해 고치면 "왜 이렇게 바뀌었나" 가 아무 데도 남지 않고,
스테이징과 운영이 조용히 어긋난다. 그래서 원본은 저장소에 두고 이 스크립트로만 민다.

사용법
------
    python scripts/elevenlabs_sync_agent.py            # 도구 + 에이전트 동기화
    python scripts/elevenlabs_sync_agent.py --dry-run  # 보낼 페이로드만 출력
    python scripts/elevenlabs_sync_agent.py --phones    # 등록된 전화번호 목록
    python scripts/elevenlabs_sync_agent.py --assign-phone <phone_number_id>

처음 실행하면 에이전트가 새로 만들어지고 agent_id 를 찍어 준다. 그 값을 `.env` 의
`ELEVENLABS_AGENT_ID` 에 넣으면, 이후 실행은 새로 만들지 않고 그것을 고친다.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - 안내가 트레이스백보다 낫다
    print("python-dotenv 가 필요하다: pip install python-dotenv", file=sys.stderr)
    raise SystemExit(2) from None

load_dotenv(ROOT / ".env", override=True)

from backend.services import voice_agent  # noqa: E402  (.env 를 먼저 읽어야 한다)

CONFIG_PATH = ROOT / "ops" / "elevenlabs" / "agent.json"


# ===== 설정 렌더링 =====================================================

def strip_comments(value: Any) -> Any:
    """`_` 로 시작하는 키를 재귀적으로 걷어낸다.

    JSON 에는 주석이 없다. 이 저장소의 다른 설정 파일들처럼 "왜 이 값인가" 를
    파일 안에 남기고 싶어서 쓰는 관례이고, 전송 직전에 지운다.
    """
    if isinstance(value, dict):
        return {k: strip_comments(v) for k, v in value.items() if not k.startswith("_")}
    if isinstance(value, list):
        return [strip_comments(item) for item in value]
    return value


def substitute(value: Any, replacements: dict[str, str]) -> Any:
    """`{{NAME}}` 자리표시자를 문자열 안에서 치환한다."""
    if isinstance(value, dict):
        return {k: substitute(v, replacements) for k, v in value.items()}
    if isinstance(value, list):
        return [substitute(item, replacements) for item in value]
    if isinstance(value, str):
        for name, replacement in replacements.items():
            value = value.replace("{{" + name + "}}", replacement)
        return value
    return value


def drop_empty_headers(tool: dict[str, Any]) -> dict[str, Any]:
    """값이 빈 요청 헤더를 제거한다.

    `VOICE_TOOL_SECRET` 을 아직 안 정한 로컬 개발에서, 빈 문자열 헤더를 보내면
    ElevenLabs 가 스키마 검증에서 막거나 우리 서버가 401 을 낸다. 헤더 자체를
    빼는 편이 "인증 없음" 이라는 의도에 정확히 맞는다.
    """
    schema = tool.get("api_schema", {})
    headers = schema.get("request_headers")
    if isinstance(headers, dict):
        kept = {k: v for k, v in headers.items() if str(v).strip()}
        if kept:
            schema["request_headers"] = kept
        else:
            schema.pop("request_headers", None)
    return tool


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise SystemExit(f"설정 파일이 없다: {CONFIG_PATH}")

    raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    api_base = os.getenv("PUBLIC_API_BASE_URL", "").strip().rstrip("/")
    if not api_base:
        raise SystemExit(
            "PUBLIC_API_BASE_URL 이 비어 있다. 에이전트가 우리 서버를 부를 주소가 없으면\n"
            "도구를 만들어도 아무것도 호출하지 못한다. .env 에 채울 것.\n"
            "  로컬: ngrok 등 터널 주소 + /api/v1\n"
            "  배포: https://<api 도메인>/api/v1"
        )
    if api_base.startswith("http://localhost") or api_base.startswith("http://127."):
        print(
            "⚠️  PUBLIC_API_BASE_URL 이 localhost 다. ElevenLabs 서버는 이 주소에 닿지 못한다.\n"
            "    웹 위젯 테스트는 되지만 도구 호출은 전부 실패한다. 터널 주소를 쓸 것.",
            file=sys.stderr,
        )

    rendered = substitute(
        strip_comments(raw),
        {
            "API_BASE": api_base,
            "TOOL_SECRET": os.getenv("VOICE_TOOL_SECRET", "").strip(),
        },
    )
    rendered["tools"] = [drop_empty_headers(tool) for tool in rendered.get("tools", [])]
    return rendered


# ===== 동기화 ==========================================================

def sync(dry_run: bool) -> int:
    config = load_config()
    tools = config.pop("tools", [])

    if dry_run:
        print(json.dumps({"agent": config, "tools": tools}, indent=2, ensure_ascii=False))
        return 0

    existing = voice_agent.list_tools()
    tool_ids: list[str] = []
    for tool in tools:
        tool_id, created = voice_agent.upsert_tool(tool, existing)
        tool_ids.append(tool_id)
        print(f"  {'만듦' if created else '갱신'}: {tool['name']} -> {tool_id}")

    # 에이전트는 도구를 id 로만 참조한다. 도구를 먼저 만들어야 하는 이유다.
    config["conversation_config"]["agent"]["prompt"]["tool_ids"] = tool_ids

    current = voice_agent.agent_id()
    if current:
        voice_agent.update_agent(current, config)
        print(f"\n✅ 에이전트 갱신됨: {current}")
    else:
        current = voice_agent.create_agent(config)
        print(f"\n✅ 에이전트 생성됨: {current}")
        print(f"\n   .env 에 다음 줄을 넣을 것 — 안 넣으면 다음 실행이 또 새로 만든다:")
        print(f"   ELEVENLABS_AGENT_ID={current}")

    return 0


def show_phones() -> int:
    numbers = voice_agent.list_phone_numbers()
    if not numbers:
        print(
            "등록된 전화번호가 없다.\n"
            "전화선을 열려면 Twilio 에서 번호를 사고 ElevenLabs 대시보드의\n"
            "Agents → Phone Numbers 에서 등록해야 한다. 이 저장소 밖의 계정 작업이다."
        )
        return 0
    for number in numbers:
        print(
            f"  {number.get('phone_number', '?'):<18} "
            f"id={number.get('phone_number_id') or number.get('id')} "
            f"agent={number.get('assigned_agent') or number.get('agent_id') or '(없음)'}"
        )
    return 0


def assign_phone(phone_number_id: str) -> int:
    target = voice_agent.agent_id()
    if not target:
        raise SystemExit("ELEVENLABS_AGENT_ID 가 비어 있다. 먼저 동기화를 실행할 것.")
    voice_agent.assign_phone_number(phone_number_id, target)
    print(f"✅ {phone_number_id} → {target}. 이제 그 번호로 걸면 에이전트가 받는다.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="보낼 페이로드만 출력한다")
    parser.add_argument("--phones", action="store_true", help="등록된 전화번호를 나열한다")
    parser.add_argument("--assign-phone", metavar="PHONE_NUMBER_ID", help="번호를 에이전트에 연결한다")
    args = parser.parse_args()

    try:
        if args.phones:
            return show_phones()
        if args.assign_phone:
            return assign_phone(args.assign_phone)
        return sync(args.dry_run)
    except voice_agent.VoiceAgentError as exc:
        # API 응답 본문을 그대로 보여준다. 에이전트 스키마는 필드가 많아서
        # "요청 실패" 로 뭉개면 무엇이 틀렸는지 알 방법이 없다.
        print(f"\n❌ {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
