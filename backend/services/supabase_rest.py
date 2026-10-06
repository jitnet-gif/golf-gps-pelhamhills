"""`pelham_*` 보조 표에 쓰는 얇은 PostgREST 접근 계층.

티 시트는 `tee_sheet_supabase` 가 전담한다 — 그쪽은 스코프, 업서트, 홀드 정리까지
규칙이 많아 전용 모듈이 필요하다. 반면 고객 조회·분실물·대기자는 "한 줄 넣고,
몇 줄 읽고, 상태 한 칸 바꾼다" 가 전부라, 표마다 같은 코드를 세 번 쓸 이유가 없다.

**설정은 티 시트와 한 벌을 공유한다.** 여기서 환경변수를 다시 읽으면 표마다 다른
프로젝트를 가리키는 사고가 난다. 이 DB 는 다른 앱과 공유하므로 그런 사고는
"우리 표가 비어 보인다" 가 아니라 "남의 DB 에 썼다" 가 된다.
"""

from __future__ import annotations

import logging
from typing import Any

# 같은 패키지 안에서 설정과 클라이언트를 한 벌로 쓰기 위한 의도적인 비공개 이름 사용.
from backend.services.tee_sheet_supabase import _client, configured

logger = logging.getLogger(__name__)

__all__ = ["configured", "select", "insert", "update", "rpc", "SupabaseUnavailable", "RpcRefused"]


class SupabaseUnavailable(RuntimeError):
    """Supabase 가 설정돼 있지 않거나 요청이 실패했다. 호출부가 통화를 살려야 한다."""


class RpcRefused(RuntimeError):
    """SQL 함수가 `pelham_fail` 로 거절했다 (SQLSTATE `PTxxx`).

    `.status` 는 그 숫자(409 등), 문장은 손님에게 읽어도 되는 메시지다. 네트워크·설정
    오류(`SupabaseUnavailable`)와 나누는 이유: 이쪽은 "그 시간은 찼다" 같은 **답**이고,
    저쪽은 "지금은 확인할 수 없다" 다. 비서가 하는 말이 달라야 한다.
    """

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _call(method: str, table: str, **kwargs: Any) -> list[dict[str, Any]]:
    if not configured():
        raise SupabaseUnavailable("Supabase is not configured")
    try:
        with _client() as client:
            res = client.request(method, f"/rest/v1/{table}", **kwargs)
            res.raise_for_status()
            if not res.content:
                return []
            body = res.json()
            return body if isinstance(body, list) else [body]
    except SupabaseUnavailable:
        raise
    except Exception as exc:
        # 본문에는 손님 이름과 번호가 들어 있다. 예외 종류와 표 이름만 남긴다.
        logger.warning("%s %s 실패: %s", method, table, type(exc).__name__)
        raise SupabaseUnavailable(f"{method} {table} failed") from exc


def select(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    return _call("GET", table, params=params)


def insert(table: str, row: dict[str, Any]) -> dict[str, Any]:
    """한 줄 넣고 **DB 가 채운 값까지** 돌려받는다 (기본값·시퀀스로 만든 티켓 번호)."""
    rows = _call(
        "POST", table, json=[row], headers={"Prefer": "return=representation"}
    )
    if not rows:
        raise SupabaseUnavailable(f"insert into {table} returned nothing")
    return rows[0]


def update(table: str, params: dict[str, str], patch: dict[str, Any]) -> list[dict[str, Any]]:
    """필터에 맞는 줄을 고친다. **필터가 비면 거절한다** — 표 전체가 바뀐다."""
    if not params:
        raise ValueError("update needs a filter; refusing to touch every row")
    return _call(
        "PATCH", table, params=params, json=patch,
        headers={"Prefer": "return=representation"},
    )


def rpc(function: str, args: dict[str, Any]) -> Any:
    """`pelham_*` SQL 함수 하나를 부르고 JSON 결과를 그대로 돌려준다."""
    if not configured():
        raise SupabaseUnavailable("Supabase is not configured")
    try:
        with _client() as client:
            res = client.post(f"/rest/v1/rpc/{function}", json=args)
    except Exception as exc:
        logger.warning("rpc %s 실패: %s", function, type(exc).__name__)
        raise SupabaseUnavailable(f"rpc {function} failed") from exc
    if res.is_success:
        return res.json() if res.content else None
    try:
        body = res.json()
    except Exception:
        body = {}
    code = body.get("code") if isinstance(body, dict) else None
    if isinstance(code, str) and code.startswith("PT") and code[2:].isdigit():
        raise RpcRefused(int(code[2:]), str(body.get("message") or ""))
    # 본문에는 손님 정보가 있을 수 있다. 상태와 코드만 남긴다.
    logger.warning("rpc %s 실패: HTTP %s (code %s)", function, res.status_code, code)
    raise SupabaseUnavailable(f"rpc {function} failed: HTTP {res.status_code}")
