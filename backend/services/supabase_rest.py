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

__all__ = ["configured", "select", "insert", "update", "SupabaseUnavailable"]


class SupabaseUnavailable(RuntimeError):
    """Supabase 가 설정돼 있지 않거나 요청이 실패했다. 호출부가 통화를 살려야 한다."""


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
