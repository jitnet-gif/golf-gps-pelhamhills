"""
Indoor Golf Simulator — 관리자(Bay Sheet) API

프론트엔드 /simulator-sheet 화면이 사용하는 엔드포인트.
기존 simulator.py(고객용 예약)는 건드리지 않고, 관리자 기능만 별도 라우터로 추가한다.

  GET   /api/v1/simulator/admin/reservations?date=YYYY-MM-DD
  PATCH /api/v1/simulator/admin/reservations/{id}

예약 출처(walk_in / phone / online / voice_ai)는 현재 DB에 컬럼이 없어서
notes 앞의 태그 "[src:walk_in]" 형태로 저장한다. (추후 source 컬럼 추가 시 교체)
"""

import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import SimulatorBay, SimulatorReservation, get_db

router = APIRouter()

OPEN_HOUR = 14
CLOSE_HOUR = 22
VALID_STATUS = {"confirmed", "checked_in", "paid", "no_show", "cancelled"}
VALID_SOURCE = {"walk_in", "phone", "online", "voice_ai"}
SRC_TAG = re.compile(r"^\[src:(\w+)\]\s*")


def _to_min(hhmm: str) -> int:
    h, m = map(int, hhmm.split(":"))
    return h * 60 + m


def _split_notes(notes: str | None) -> tuple[str, str]:
    notes = notes or ""
    match = SRC_TAG.match(notes)
    if match and match.group(1) in VALID_SOURCE:
        return match.group(1), notes[match.end():]
    return "online", notes


def _serialize(r: SimulatorReservation) -> dict:
    source, notes = _split_notes(r.notes)
    return {
        "id": r.id,
        "confirmation_code": r.confirmation_code,
        "bay_id": r.bay_id,
        "date": r.date.strftime("%Y-%m-%d") if r.date else "",
        "start_time": r.start_time,
        "duration_hours": r.duration_hours,
        "player_count": r.player_count,
        "customer_name": r.customer_name,
        "customer_email": r.customer_email,
        "phone": r.phone or "",
        "notes": notes,
        "status": r.status or "confirmed",
        "source": source,
    }


@router.get("/simulator/admin/reservations")
async def list_reservations_for_day(
    date: str = Query(..., description="YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
):
    try:
        day = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")

    result = await db.execute(
        select(SimulatorReservation)
        .where(func.date(SimulatorReservation.date) == day)
        .order_by(SimulatorReservation.start_time)
    )
    return {"date": date, "reservations": [_serialize(r) for r in result.scalars().all()]}


@router.patch("/simulator/admin/reservations/{reservation_id}")
async def update_reservation(
    reservation_id: int,
    patch: dict,
    db: AsyncSession = Depends(get_db),
):
    reservation = await db.get(SimulatorReservation, reservation_id)
    if reservation is None:
        raise HTTPException(status_code=404, detail="Reservation not found")

    # 이동/길이 변경 후보값
    bay_id = int(patch.get("bay_id", reservation.bay_id))
    start_time = patch.get("start_time", reservation.start_time)
    duration = int(patch.get("duration_hours", reservation.duration_hours))

    if "status" in patch and patch["status"] not in VALID_STATUS:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(VALID_STATUS)}")

    moving = (
        bay_id != reservation.bay_id
        or start_time != reservation.start_time
        or duration != reservation.duration_hours
    )
    if moving:
        start = _to_min(start_time)
        end = start + duration * 60
        if start < OPEN_HOUR * 60 or end > CLOSE_HOUR * 60:
            raise HTTPException(status_code=400, detail="Outside operating hours (2 PM – 10 PM)")

        bay = await db.get(SimulatorBay, bay_id)
        if bay is None or not bay.is_active:
            raise HTTPException(status_code=400, detail="Bay not available")

        same_day = await db.execute(
            select(SimulatorReservation).where(
                and_(
                    SimulatorReservation.bay_id == bay_id,
                    SimulatorReservation.date == reservation.date,
                    SimulatorReservation.id != reservation.id,
                    SimulatorReservation.status != "cancelled",
                )
            )
        )
        for other in same_day.scalars().all():
            o_start = _to_min(other.start_time)
            o_end = o_start + other.duration_hours * 60
            if start < o_end and o_start < end:
                raise HTTPException(status_code=409, detail="Overlaps another booking on that bay")

        reservation.bay_id = bay_id
        reservation.start_time = start_time
        reservation.duration_hours = duration

    for field in ("customer_name", "customer_email", "phone", "player_count", "status"):
        if field in patch:
            setattr(reservation, field, patch[field])

    if "notes" in patch or "source" in patch:
        current_source, current_notes = _split_notes(reservation.notes)
        source = patch.get("source", current_source)
        notes = patch.get("notes", current_notes)
        if source not in VALID_SOURCE:
            source = "online"
        reservation.notes = f"[src:{source}] {notes}".strip()

    await db.commit()
    await db.refresh(reservation)
    return _serialize(reservation)
