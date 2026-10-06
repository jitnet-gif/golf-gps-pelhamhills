"""backend/tests 전체에 걸리는 안전장치.

⚠️ 개발 머신의 셸이나 `.env` 에 실제 Supabase 설정이 있을 수 있다. 그 프로젝트는 다른
앱과 **공유**하고, supabase 모드의 `tee_sheet_store.reset()` 은 테이블을 통째로 비운다.
테스트 하나가 저장 엔진을 잘못 고르면 운영 티 시트가 날아간다. 그래서 모든 테스트는
- 저장 엔진을 json 으로 시작하고,
- Supabase 접속 정보를 가짜 값으로 채운 채 시작한다. 셋 다 채워져 있으면
  `tee_sheet_supabase._config()` 가 settings 로 넘어가지 않으므로 `backend.core.config`
  가 임포트되지 않고, 그 안의 `load_dotenv(override=True)` 도 돌지 않는다
  (돌면 `.env` 의 진짜 키가 os.environ 을 덮어쓴다).
- 기본 전송 계층은 요청을 전부 거절한다. 가짜 URL 이라도 DNS 조회는 네트워크다.

supabase 모드가 필요한 테스트는 `fake_postgrest.install(monkeypatch)` 로 옵트인한다.
그 함수가 여기 값을 덮어쓰고, 테스트가 끝나면 monkeypatch 가 여기 값으로 되돌린다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

# 테스트 모듈들보다 먼저 임포트된다. `pytest` 를 그냥 실행하면 cwd 가 sys.path 에 없다.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import tee_sheet_supabase as sb  # noqa: E402

_NO_NETWORK_URL = "https://no-network.invalid"
_NO_NETWORK_KEY = "conftest-fake-key"


def _refuse(request: httpx.Request) -> httpx.Response:
    # install() 없이 supabase 경로에 들어온 테스트는 여기서 막힌다.
    # 저장 계층이 이것을 SupabaseStoreError 로 바꾸므로 테스트는 빨갛게 실패한다.
    raise httpx.ConnectError("network is disabled in backend/tests", request=request)


@pytest.fixture(autouse=True)
def _isolate_tee_sheet_backend(monkeypatch):
    monkeypatch.setenv("TEE_SHEET_BACKEND", "json")
    monkeypatch.setenv("SUPABASE_URL", _NO_NETWORK_URL)
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", _NO_NETWORK_URL)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", _NO_NETWORK_KEY)
    monkeypatch.setattr(sb, "_transport", httpx.MockTransport(_refuse))
    monkeypatch.setenv("SMS_BOOKING_ENABLED", "")

    # Twilio 도 꺼 둔다. `send_sms` 는 `settings.TWILIO_ENABLED` 가 참이면 **진짜로**
    # 보낸다. 번호가 비어 있던 동안은 우연히 안전했을 뿐이고, `.env` 에
    # TWILIO_PHONE_NUMBER 를 채운 날(2026-10-05) 예약 확정 테스트가 실제 Twilio API 를
    # 스무 번 넘게 두드렸다. 전부 실패해서 전달되지는 않았지만, 유효한 번호였다면
    # 모르는 사람에게 테스트 문자가 갔을 것이다.
    #
    # 환경변수가 아니라 settings 객체를 고치는 이유: `settings` 는 임포트 시점에 한 번
    # 만들어지므로 그 뒤에 os.environ 을 바꿔도 이미 읽은 값은 그대로다.
    # `send_sms` 는 이 상태에서 status="skipped" 로 끝나므로 함수 본문은 그대로 돈다.
    #
    # **여기서 config 를 임포트하지 않는다.** 이미 올라와 있을 때만 건드린다.
    # 이 파일이 처음 임포트하면 그 안의 `load_dotenv(override=True)` 가 방금 깔아 둔
    # 가짜 SUPABASE_URL·키·`TEE_SHEET_BACKEND=json` 을 **진짜 .env 값으로 덮어쓴다** —
    # 이 파일이 막으려던 바로 그 사고다. config 가 없다면 `twilio_sms` 도 없으므로
    # 문자를 보낼 경로 자체가 없다.
    cfg = sys.modules.get("backend.core.config")
    if cfg is not None:
        for field in (
            "TWILIO_ACCOUNT_SID",
            "TWILIO_AUTH_TOKEN",
            "TWILIO_PHONE_NUMBER",
            "TWILIO_MESSAGING_SERVICE_SID",
            # 문자 예약 비서(`services/sms_agent.py`)도 같은 이유로 끈다. `.env` 에 키가
            # 있으면 손님 문자를 흉내 낸 테스트가 실제 Claude API 를 부른다.
            "ANTHROPIC_API_KEY",
        ):
            monkeypatch.setattr(cfg.settings, field, "", raising=False)

    yield
