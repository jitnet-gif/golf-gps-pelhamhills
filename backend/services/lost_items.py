"""분실물 접수대장 (`pelham_lost_items`).

에이전트는 **접수만** 한다. 티켓 번호는 DB 의 시퀀스가 만든다 — 백엔드가 여러
프로세스로 뜨면 파이썬에서 센 번호는 겹칠 수 있고, 그 번호를 손님이 전화로 받아
적는다.

상태를 바꾸는 것(찾음·반환)은 프로 샵 화면(`/admin/lost-items`, 0015)의 일이다. 전화로
"찾았습니다" 라고 먼저 말하면 헛걸음을 만든다. 직원이 "찾음" 으로 바꾸면 손님에게 가는
문자는 `lost_item_notices.py` 가 보낸다.
"""

from __future__ import annotations

from typing import Any

from backend.services import supabase_rest as rest

TABLE = "pelham_lost_items"

__all__ = ["TABLE", "report", "open_tickets_for_phone", "pending_found_notices", "claim_notice", "record_notice"]


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


def pending_found_notices(limit: int = 20) -> list[dict[str, Any]]:
    """직원이 "찾음" 으로 바꿨는데 아직 문자를 보내지 않은 줄 (0015 의 `notified_at`)."""
    return rest.select(
        TABLE,
        {
            "select": "id,ticket,item,caller_name,caller_phone",
            "status": "eq.found",
            "notified_at": "is.null",
            "order": "updated_at.asc",
            "limit": str(limit),
        },
    )


def claim_notice(item_id: str, at: str) -> bool:
    """보내기 **전에** 그 줄을 집는다. 아직 아무도 안 집었을 때만 True.

    보낸 뒤에 적으면, 보내는 사이 다음 패스(또는 다른 프로세스)가 같은 줄을 또 집어
    문자가 두 번 간다. 집은 뒤 발송이 실패하면 `record_notice` 가 실패로 남기고,
    다시 보낼지는 직원이 정한다("Resend text").
    """
    rows = rest.update(
        TABLE,
        {"id": f"eq.{item_id}", "status": "eq.found", "notified_at": "is.null"},
        {"notified_at": at},
    )
    return bool(rows)


def record_notice(item_id: str, status: str, error: str | None = None) -> None:
    rest.update(TABLE, {"id": f"eq.{item_id}"}, {"notify_status": status, "notify_error": error})
