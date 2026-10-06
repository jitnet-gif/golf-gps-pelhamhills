"""티타임 대기자 명단 (`pelham_tee_waitlist`).

자리가 비면 먼저 기다린 사람에게 그 자리를 **잠깐 잡아 두고** 문자를 보낸다.
YES 로 답하면 그대로 예약이 되고, 답이 없으면 잡아 둔 자리가 풀려 다음 사람에게
간다. 흐름 전체는 `services/waitlist_offers.py` 에 있고, 여기는 표 읽기·쓰기뿐이다.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.services import supabase_rest as rest

TABLE = "pelham_tee_waitlist"

__all__ = ["TABLE", "join", "already_waiting", "open_entries", "claim_offer", "set_status"]


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


def open_entries(date_from: str) -> list[dict[str, Any]]:
    """`date_from` 이후 날짜의, 아직 끝나지 않은(기다리는 중·제안받은) 대기자 전부.

    먼저 온 순서로 돌려준다. 시간대 조건은 호출부가 분으로 바꿔 거른다 — 라벨을
    Postgres 필터로 보내면 "10:00 AM" 이 "9:00 AM" 보다 작게 나온다.
    """
    return rest.select(
        TABLE,
        {
            "select": "id,date,earliest,latest,party_size,holes,first_name,last_name,phone,"
                      "status,offered_time,offered_at",
            "date": f"gte.{date_from}",
            "status": "in.(waiting,offered)",
            "order": "created_at.asc",
            "limit": "200",
        },
    )


def claim_offer(entry_id: str, time_label: str) -> bool:
    """`waiting` 인 줄만 `offered` 로 바꾼다. 바뀌었으면 True.

    조건부로 바꾸는 이유: 1분 루프와 취소 직후의 즉시 실행이 겹치면 같은 사람에게
    자리를 두 번 잡아 줄 수 있다. 진 쪽은 False 를 받고 잡아 둔 자리를 돌려놓는다.
    """
    now = datetime.now(timezone.utc).isoformat()
    rows = rest.update(
        TABLE,
        {"id": f"eq.{entry_id}", "status": "eq.waiting"},
        {"status": "offered", "offered_time": time_label, "offered_at": now, "updated_at": now},
    )
    return bool(rows)


def set_status(entry_id: str, status: str, *, only_from: str | None = None) -> bool:
    """상태를 바꾼다. `only_from` 을 주면 그 상태일 때만 바꾼다. 바뀌었으면 True."""
    params = {"id": f"eq.{entry_id}"}
    if only_from:
        params["status"] = f"eq.{only_from}"
    rows = rest.update(
        TABLE, params,
        {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()},
    )
    return bool(rows)
