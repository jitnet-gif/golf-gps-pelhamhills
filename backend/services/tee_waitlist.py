"""티타임 대기자 명단 (`pelham_tee_waitlist`).

자리가 비면 먼저 기다린 사람에게 문자를 보낸다. **자리를 잡아 주지는 않는다** —
문자는 "먼저 답한 사람이 가져간다" 는 안내이고, 예약은 평소 경로로 들어온다.
미리 잠가 두면 답이 없을 때 그 자리가 죽은 채로 남는다.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.services import supabase_rest as rest

TABLE = "pelham_tee_waitlist"

__all__ = ["TABLE", "join", "waiting_entries", "mark_offered", "already_waiting"]


def join(
    *,
    date: str,
    party_size: int,
    last_name: str,
    phone: str,
    first_name: str = "",
    earliest: str = "",
    latest: str = "",
    holes: int = 18,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "date": date,
        "party_size": party_size,
        "last_name": last_name.strip(),
        "phone": phone.strip(),
        "holes": holes,
        "status": "waiting",
    }
    if first_name.strip():
        row["first_name"] = first_name.strip()
    if earliest.strip():
        row["earliest"] = earliest.strip()
    if latest.strip():
        row["latest"] = latest.strip()
    return rest.insert(TABLE, row)


def already_waiting(date: str, phone: str) -> bool:
    """같은 사람이 같은 날에 두 번 등록되는 것을 막는다."""
    if not phone:
        return False
    rows = rest.select(
        TABLE,
        {"select": "id", "date": f"eq.{date}", "phone": f"eq.{phone}",
         "status": "eq.waiting", "limit": "1"},
    )
    return bool(rows)


def waiting_entries(date: str, seats: int, limit: int = 10) -> list[dict[str, Any]]:
    """그날 기다리는 사람들 중 비는 자리에 들어갈 수 있는 사람, 먼저 온 순서로.

    인원이 자리보다 많은 사람은 건너뛴다 — 넷이 기다리는데 두 자리가 비었다고
    문자를 보내면 헛된 기대만 준다.

    **한 명이 아니라 목록을 돌려준다.** 시간대 조건은 호출부가 거르는데(라벨 비교라
    Postgres 필터로 보내면 "10:00 AM" 이 "9:00 AM" 보다 작게 나온다), 한 명만
    돌려주면 오후만 원하는 첫 번째 사람이 아침에 난 자리를 막아 뒤의 사람들까지
    아무도 연락을 못 받는다.
    """
    return rest.select(
        TABLE,
        {
            "select": "id,date,earliest,latest,party_size,first_name,last_name,phone",
            "date": f"eq.{date}",
            "status": "eq.waiting",
            "party_size": f"lte.{seats}",
            "order": "created_at.asc",
            "limit": str(limit),
        },
    )


def mark_offered(entry_id: str, time_label: str) -> None:
    rest.update(
        TABLE,
        {"id": f"eq.{entry_id}"},
        {
            "status": "offered",
            "offered_time": time_label,
            "offered_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
