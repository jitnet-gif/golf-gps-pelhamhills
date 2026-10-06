"""분실물 접수대장 (`pelham_lost_items`).

에이전트는 **접수만** 한다. 티켓 번호는 DB 의 시퀀스가 만든다 — 백엔드가 여러
프로세스로 뜨면 파이썬에서 센 번호는 겹칠 수 있고, 그 번호를 손님이 전화로 받아
적는다.

상태를 바꾸는 것(찾음·반환)은 프로 샵 화면의 일이다. 전화로 "찾았습니다" 라고
먼저 말하면 헛걸음을 만든다.
"""

from __future__ import annotations

from typing import Any

from backend.services import supabase_rest as rest

TABLE = "pelham_lost_items"

__all__ = ["TABLE", "report", "open_tickets_for_phone"]


def report(
    *,
    item: str,
    description: str = "",
    lost_on: str | None = None,
    where_lost: str = "",
    caller_phone: str = "",
    caller_name: str = "",
) -> dict[str, Any]:
    """새 분실물 티켓. `ticket` 과 `id` 가 채워진 줄을 돌려준다."""
    row: dict[str, Any] = {"item": item.strip(), "status": "searching"}
    if description.strip():
        row["description"] = description.strip()
    if lost_on:
        row["lost_on"] = lost_on
    if where_lost.strip():
        row["where_lost"] = where_lost.strip()
    if caller_phone.strip():
        row["caller_phone"] = caller_phone.strip()
    if caller_name.strip():
        row["caller_name"] = caller_name.strip()
    return rest.insert(TABLE, row)


def open_tickets_for_phone(phone: str, limit: int = 5) -> list[dict[str, Any]]:
    """그 번호로 접수된, 아직 돌려주지 않은 티켓."""
    if not phone:
        return []
    return rest.select(
        TABLE,
        {
            "select": "ticket,item,status,created_at",
            "caller_phone": f"eq.{phone}",
            "status": "neq.returned",
            "order": "created_at.desc",
            "limit": str(limit),
        },
    )
