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
    yield
