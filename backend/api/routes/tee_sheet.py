"""Pelham Hills 티 시트 API.

와이어 계약: `frontend/lib/teeSheet/types.ts` (frozen).
- 모든 날짜는 ISO `YYYY-MM-DD`. `dayIndex` 는 더 이상 존재하지 않는다 (프론트가 파생).
- 모든 `time` 은 `GET /tee-sheet/slots?date=` 가 돌려주는 슬롯 라벨 중 하나여야 한다.
- Player 는 `firstName`/`lastName` 를 갖고 `name` 은 서버가 파생한다.

영속화는 `backend/services/tee_sheet_store.py` (JSON 파일 + RLock + 원자적 쓰기).
"""

from __future__ import annotations

import asyncio
import logging
import re
import threading
import time
from contextlib import contextmanager
from datetime import date as date_cls, datetime, timedelta, timezone
from enum import Enum
from typing import Any, Iterator, Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from backend.services import tee_sheet_store as store

logger = logging.getLogger(__name__)
router = APIRouter()


# ===== 슬롯 설정 ======================================================
# Chronogolf 와 동일한 간격: 첫 티 6:40 AM, 9분 간격, 오후 6시까지.

FIRST_TEE_MINUTES = 6 * 60 + 40      # 06:40
LAST_TEE_MINUTES = 18 * 60           # 18:00 (경계 포함; 9분 격자에는 안 걸린다)
SLOT_INTERVAL_MINUTES = 9
CARTS_PER_SLOT = 4

WEEKDAY_RATE = 47.79
WEEKEND_RATE = 58.41

# 특정 날짜 강제 요금 (공휴일 / 이벤트 / 시드 데이터 보존용).
# 2026-09-11 은 금요일이지만 시드 데이터가 58.41 이므로 오버라이드로 유지한다.
RATE_OVERRIDES: dict[str, float] = {
    "2026-09-11": 58.41,
}

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SLOT_TIME_RE = re.compile(r"^\d{1,2}:\d{2} (AM|PM)$")
MAX_TASKS = 50
AUDIT_LIMIT = 40


# ===== 열거형 / 모델 ==================================================

class BookingStatus(str, Enum):
    RESERVED = "reserved"
    CHECKED_IN = "checked_in"
    PAID = "paid"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    BLOCKED = "blocked"


class PlayerType(str, Enum):
    EXISTING = "Existing Customer"
    GUEST = "Guest"


class TaskState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


def _split_name(name: str) -> tuple[str, str]:
    """"Betty Lou DiMattio" -> ("Betty", "Lou DiMattio"), "Guest" -> ("Guest", "")."""
    first, _, last = name.strip().partition(" ")
    return first.strip(), last.strip()


class Player(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = "Guest"
    firstName: str = ""
    lastName: str = ""
    email: str = ""
    phone: str = ""
    type: PlayerType = PlayerType.GUEST
    ratePlan: str = "Public"
    arrived: bool = False
    paid: bool = False
    cancelled: bool = False
    no_show: bool = False

    @model_validator(mode="before")
    @classmethod
    def _reconcile_names(cls, data: Any) -> Any:
        """`name` 은 항상 서버가 파생한다.

        - firstName/lastName 중 하나라도 오면 그것이 진실. name 은 재계산.
        - name 만 오면 첫 토큰을 firstName, 나머지를 lastName 으로 쪼갠다.
        """
        if not isinstance(data, dict):
            return data
        data = dict(data)
        first = str(data.get("firstName") or "").strip()
        last = str(data.get("lastName") or "").strip()
        name = str(data.get("name") or "").strip()

        if first or last:
            pass
        elif name:
            first, last = _split_name(name)
        else:
            first, last = "Guest", ""

        data["firstName"] = first
        data["lastName"] = last
        data["name"] = f"{first} {last}".strip()
        return data


class AuditEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    message: str


class TeeBooking(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(..., pattern=r"^\d{1,2}:\d{2} (AM|PM)$")
    holes: Literal[9, 18] = 18
    rate: float = WEEKDAY_RATE
    span: int = Field(default=1, ge=1, le=7)
    color: Literal["blue", "gold", "gray"] = "gold"
    title: str
    status: BookingStatus = BookingStatus.RESERVED
    cartCount: int = Field(default=0, ge=0, le=4)
    notes: str = ""
    players: list[Player] = Field(default_factory=list, max_length=4)
    audit: list[AuditEntry] = Field(default_factory=list)
    cancelReason: str | None = None
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TeeSlot(BaseModel):
    time: str
    minutes: int
    rate: float
    cartsTotal: int


class SlotsResponse(BaseModel):
    date: str
    slots: list[TeeSlot]


class CreateBookingRequest(BaseModel):
    date: str
    time: str
    title: str
    holes: Literal[9, 18] = 18
    rate: float | None = None
    cartCount: int = Field(default=0, ge=0, le=4)
    color: Literal["blue", "gold", "gray"] = "gold"
    notes: str = ""
    span: int = Field(default=1, ge=1, le=7)
    players: list[Player] = Field(default_factory=list, max_length=4)


class PatchBookingRequest(BaseModel):
    date: str | None = None
    time: str | None = None
    title: str | None = None
    holes: Literal[9, 18] | None = None
    rate: float | None = None
    cartCount: int | None = Field(default=None, ge=0, le=4)
    color: Literal["blue", "gold", "gray"] | None = None
    notes: str | None = None
    status: BookingStatus | None = None
    cancelReason: str | None = None
    span: int | None = Field(default=None, ge=1, le=7)


class AddPlayerRequest(BaseModel):
    name: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    email: str = ""
    phone: str = ""
    type: PlayerType = PlayerType.GUEST
    ratePlan: str = "Public"
    arrived: bool = False
    paid: bool = False
    cancelled: bool = False
    no_show: bool = False


class PatchPlayerRequest(BaseModel):
    name: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    email: str | None = None
    phone: str | None = None
    type: PlayerType | None = None
    ratePlan: str | None = None
    arrived: bool | None = None
    paid: bool | None = None
    cancelled: bool | None = None
    no_show: bool | None = None


class ReportBookingLine(BaseModel):
    id: str
    time: str
    title: str
    players: int
    rate: float
    status: BookingStatus


class DailyReport(BaseModel):
    date: str
    total_tee_times: int
    total_slots: int
    booked_slots: int
    available_slots: int
    occupancy_rate: float
    total_revenue: float
    collected_revenue: float
    outstanding_revenue: float
    checked_in: int
    cancelled: int
    no_show: int
    carts: int
    bookings: list[ReportBookingLine]


class WeekSummary(BaseModel):
    total_days: int
    total_tee_times: int
    total_booked_slots: int
    total_revenue: float
    collected_revenue: float
    average_occupancy: float


class WeekReport(BaseModel):
    from_: str = Field(..., alias="from")
    to: str
    days: list[DailyReport]
    summary: WeekSummary

    model_config = {"populate_by_name": True}


class OrchestrationTask(BaseModel):
    id: str
    name: str
    state: TaskState
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    detail: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None


class AvailableTask(BaseModel):
    name: str
    description: str
    endpoint: str


class OrchestrationStatus(BaseModel):
    status: str
    total_bookings: int
    timestamp: datetime
    available_tasks: list[AvailableTask]
    tasks: list[OrchestrationTask]


class TaskAck(BaseModel):
    accepted: bool
    tasks: list[OrchestrationTask]
    message: str


# ===== 시간 / 슬롯 헬퍼 ================================================

def minutes_to_label(minutes: int) -> str:
    normalized = minutes % (24 * 60)
    hour24, minute = divmod(normalized, 60)
    suffix = "AM" if hour24 < 12 else "PM"
    hour12 = hour24 % 12 or 12
    return f"{hour12}:{minute:02d} {suffix}"


def label_to_minutes(label: str) -> int | None:
    match = re.match(r"^(\d{1,2}):(\d{2})\s*(AM|PM)$", label.strip(), re.IGNORECASE)
    if not match:
        return None
    hour = int(match.group(1)) % 12
    if match.group(3).upper() == "PM":
        hour += 12
    return hour * 60 + int(match.group(2))


def parse_iso_date(value: str, field: str = "date") -> date_cls:
    if not isinstance(value, str) or not ISO_DATE_RE.match(value):
        raise HTTPException(status_code=422, detail=f"'{field}' must be an ISO date (YYYY-MM-DD)")
    try:
        return date_cls.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"'{field}' is not a real calendar date: {value}")


def slot_rate_for(iso_date: str) -> float:
    """날짜별 요금: 오버라이드 > 주말 > 평일."""
    override = RATE_OVERRIDES.get(iso_date)
    if override is not None:
        return override
    day = parse_iso_date(iso_date)
    return WEEKEND_RATE if day.weekday() >= 5 else WEEKDAY_RATE


def generate_slots(iso_date: str) -> list[TeeSlot]:
    rate = slot_rate_for(iso_date)
    slots: list[TeeSlot] = []
    minutes = FIRST_TEE_MINUTES
    while minutes <= LAST_TEE_MINUTES:
        slots.append(
            TeeSlot(
                time=minutes_to_label(minutes),
                minutes=minutes,
                rate=rate,
                cartsTotal=CARTS_PER_SLOT,
            )
        )
        minutes += SLOT_INTERVAL_MINUTES
    return slots


def slot_index(iso_date: str) -> dict[str, TeeSlot]:
    return {slot.time: slot for slot in generate_slots(iso_date)}


def require_slot(iso_date: str, time_label: str) -> TeeSlot:
    parse_iso_date(iso_date)
    if not isinstance(time_label, str) or not SLOT_TIME_RE.match(time_label.strip()):
        raise HTTPException(status_code=422, detail=f"'{time_label}' is not a valid tee time label")
    slot = slot_index(iso_date).get(time_label.strip())
    if slot is None:
        raise HTTPException(
            status_code=422,
            detail=f"{time_label} is not a bookable tee time on {iso_date}",
        )
    return slot


def _sort_key(booking: TeeBooking) -> tuple[str, int]:
    return (booking.date, label_to_minutes(booking.time) or 0)


# ===== 저장소 브리지 ===================================================

def _to_models(raw: list[dict[str, Any]]) -> list[TeeBooking]:
    models: list[TeeBooking] = []
    for item in raw:
        try:
            models.append(TeeBooking.model_validate(item))
        except Exception as exc:  # pragma: no cover - 손상 레코드 방어
            logger.warning("티 시트 레코드 파싱 실패, 건너뜀: %s", exc)
    return models


def read_bookings() -> list[TeeBooking]:
    return sorted(_to_models(store.load_bookings()), key=_sort_key)


@contextmanager
def bookings_tx() -> Iterator[list[TeeBooking]]:
    """읽기-수정-쓰기 트랜잭션. 이 블록 안에서 절대 `await` 하지 말 것."""
    with store.mutate() as raw:
        models = sorted(_to_models(raw), key=_sort_key)
        yield models
        models.sort(key=_sort_key)
        raw[:] = [m.model_dump(mode="json") for m in models]


def _find(bookings: list[TeeBooking], booking_id: str) -> TeeBooking:
    for booking in bookings:
        if booking.id == booking_id:
            return booking
    raise HTTPException(status_code=404, detail="Booking not found")


def _audit(booking: TeeBooking, message: str) -> None:
    booking.audit.insert(0, AuditEntry(message=message))
    del booking.audit[AUDIT_LIMIT:]
    booking.updatedAt = datetime.now(timezone.utc)


def require_free_slot(
    bookings: list[TeeBooking], iso_date: str, time_label: str, exclude_id: str | None = None
) -> None:
    for other in bookings:
        if other.id == exclude_id:
            continue
        if other.date == iso_date and other.time == time_label:
            raise HTTPException(
                status_code=409,
                detail=f"{time_label} on {iso_date} is already booked by '{other.title}'",
            )


# ===== 슬롯 엔드포인트 =================================================

@router.get("/tee-sheet/slots", response_model=SlotsResponse)
def get_slots(date: str = Query(..., description="ISO date, YYYY-MM-DD")) -> SlotsResponse:
    parse_iso_date(date)
    return SlotsResponse(date=date, slots=generate_slots(date))


# ===== 예약 CRUD =======================================================

@router.get("/tee-sheet/bookings", response_model=list[TeeBooking])
def list_bookings(
    date: str | None = Query(None),
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
) -> list[TeeBooking]:
    bookings = read_bookings()

    if date:
        parse_iso_date(date)
        return [b for b in bookings if b.date == date]

    if from_ or to:
        low = from_ or "0000-01-01"
        high = to or "9999-12-31"
        if from_:
            parse_iso_date(from_, "from")
        if to:
            parse_iso_date(to, "to")
        return [b for b in bookings if low <= b.date <= high]

    return bookings


@router.get("/tee-sheet/bookings/{booking_id}", response_model=TeeBooking)
def get_booking(booking_id: str) -> TeeBooking:
    return _find(read_bookings(), booking_id)


@router.post("/tee-sheet/bookings", response_model=TeeBooking, status_code=201)
def create_booking(body: CreateBookingRequest) -> TeeBooking:
    slot = require_slot(body.date, body.time)
    time_label = body.time.strip()

    with bookings_tx() as bookings:
        require_free_slot(bookings, body.date, time_label)
        booking = TeeBooking(
            date=body.date,
            time=time_label,
            title=body.title,
            holes=body.holes,
            rate=slot.rate if body.rate is None else body.rate,
            span=body.span,
            color=body.color,
            notes=body.notes,
            cartCount=body.cartCount,
            players=body.players,
        )
        _audit(booking, f"Reservation created for {booking.date} {booking.time}.")
        bookings.append(booking)
        return booking


def _apply_status(booking: TeeBooking, status: BookingStatus, cancel_reason: str | None) -> str:
    """상태 전이 + 플레이어 플래그 동기화. 감사 로그 문구를 돌려준다."""
    booking.status = status

    if status == BookingStatus.CHECKED_IN:
        for player in booking.players:
            if not player.cancelled:
                player.arrived = True
                player.no_show = False
        return "Reservation checked in."

    if status == BookingStatus.PAID:
        for player in booking.players:
            if not player.cancelled:
                player.arrived = True
                player.paid = True
                player.no_show = False
        return "Reservation marked paid."

    if status == BookingStatus.CANCELLED:
        booking.cancelReason = cancel_reason or "Cancelled by pro shop."
        for player in booking.players:
            player.cancelled = True
            player.arrived = False
        return f"Reservation cancelled: {booking.cancelReason}"

    if status == BookingStatus.NO_SHOW:
        for player in booking.players:
            if not player.cancelled:
                player.no_show = True
        return "Reservation marked no-show."

    if status == BookingStatus.BLOCKED:
        return "Tee time blocked."

    # reserved: 취소/노쇼/체크인/결제를 모두 되돌린다.
    # paid 를 남겨두면 취소 후 복구한 예약이 collected_revenue 에 잡혀 매출이 부풀려진다.
    booking.cancelReason = None
    for player in booking.players:
        player.cancelled = False
        player.no_show = False
        player.arrived = False
        player.paid = False
    return "Reservation reinstated as reserved."


@router.patch("/tee-sheet/bookings/{booking_id}", response_model=TeeBooking)
def patch_booking(booking_id: str, body: PatchBookingRequest) -> TeeBooking:
    fields = body.model_dump(exclude_unset=True)

    with bookings_tx() as bookings:
        booking = _find(bookings, booking_id)

        # --- 날짜/시간 이동은 슬롯 재검증 + 충돌 검사 ---
        if "date" in fields or "time" in fields:
            new_date = fields.get("date") or booking.date
            new_time = (fields.get("time") or booking.time).strip()
            require_slot(new_date, new_time)
            if new_date != booking.date or new_time != booking.time:
                require_free_slot(bookings, new_date, new_time, exclude_id=booking.id)
                booking.date = new_date
                booking.time = new_time
                _audit(booking, f"Moved to {new_date} {new_time}.")

        if "title" in fields and fields["title"] is not None and fields["title"] != booking.title:
            booking.title = fields["title"]
            _audit(booking, f"Title changed to '{booking.title}'.")

        if "holes" in fields and fields["holes"] is not None and fields["holes"] != booking.holes:
            booking.holes = fields["holes"]
            _audit(booking, f"Holes set to {booking.holes}.")

        if "rate" in fields and fields["rate"] is not None and fields["rate"] != booking.rate:
            booking.rate = fields["rate"]
            _audit(booking, f"Rate set to ${booking.rate:.2f}.")

        if "cartCount" in fields and fields["cartCount"] is not None and fields["cartCount"] != booking.cartCount:
            booking.cartCount = fields["cartCount"]
            _audit(booking, f"Cart count set to {booking.cartCount}.")

        if "color" in fields and fields["color"] is not None and fields["color"] != booking.color:
            booking.color = fields["color"]
            _audit(booking, f"Color set to {booking.color}.")

        if "span" in fields and fields["span"] is not None and fields["span"] != booking.span:
            booking.span = fields["span"]
            _audit(booking, f"Span set to {booking.span}.")

        if "notes" in fields and fields["notes"] is not None and fields["notes"] != booking.notes:
            booking.notes = fields["notes"]
            _audit(booking, "Notes updated.")

        if "status" in fields and fields["status"] is not None:
            status = BookingStatus(fields["status"])
            message = _apply_status(booking, status, fields.get("cancelReason"))
            _audit(booking, message)
        elif "cancelReason" in fields:
            booking.cancelReason = fields["cancelReason"]
            _audit(booking, f"Cancellation reason set to '{fields['cancelReason']}'."
                   if fields["cancelReason"] else "Cancellation reason cleared.")

        return booking


@router.delete("/tee-sheet/bookings/{booking_id}", status_code=204)
def delete_booking(booking_id: str) -> None:
    with bookings_tx() as bookings:
        booking = _find(bookings, booking_id)
        bookings.remove(booking)


# ===== 플레이어 =======================================================

@router.post("/tee-sheet/bookings/{booking_id}/players", response_model=TeeBooking)
def add_player(booking_id: str, body: AddPlayerRequest) -> TeeBooking:
    with bookings_tx() as bookings:
        booking = _find(bookings, booking_id)
        if len(booking.players) >= 4:
            raise HTTPException(status_code=422, detail="A tee time can contain at most 4 players")
        payload = body.model_dump(exclude_none=True)
        player = Player.model_validate(payload)
        booking.players.append(player)
        _audit(booking, f"Player added: {player.name}.")
        return booking


@router.patch("/tee-sheet/bookings/{booking_id}/players/{player_id}", response_model=TeeBooking)
def patch_player(booking_id: str, player_id: str, body: PatchPlayerRequest) -> TeeBooking:
    fields = body.model_dump(exclude_unset=True)

    with bookings_tx() as bookings:
        booking = _find(bookings, booking_id)
        for index, player in enumerate(booking.players):
            if player.id != player_id:
                continue

            merged = player.model_dump()
            merged.update({k: v for k, v in fields.items() if v is not None})

            # 이름 재계산 규칙: first/last 가 오면 그게 진실, name 만 오면 쪼갠다.
            if fields.get("firstName") is not None or fields.get("lastName") is not None:
                merged.pop("name", None)
            elif fields.get("name") is not None:
                merged["firstName"] = ""
                merged["lastName"] = ""

            updated = Player.model_validate(merged)
            updated.id = player.id
            booking.players[index] = updated
            _audit(booking, f"Player updated: {updated.name}.")
            return booking

    raise HTTPException(status_code=404, detail="Player not found")


@router.delete("/tee-sheet/bookings/{booking_id}/players/{player_id}", response_model=TeeBooking)
def delete_player(booking_id: str, player_id: str) -> TeeBooking:
    with bookings_tx() as bookings:
        booking = _find(bookings, booking_id)
        if len(booking.players) <= 1:
            raise HTTPException(status_code=422, detail="A reservation must keep at least one player")
        for player in booking.players:
            if player.id == player_id:
                booking.players.remove(player)
                _audit(booking, f"Player removed: {player.name}.")
                return booking

    raise HTTPException(status_code=404, detail="Player not found")


# ===== 리포트 =========================================================

def build_daily_report(iso_date: str, bookings: list[TeeBooking]) -> DailyReport:
    day = [b for b in bookings if b.date == iso_date]
    day.sort(key=lambda b: label_to_minutes(b.time) or 0)

    total_slots = len(generate_slots(iso_date)) * CARTS_PER_SLOT
    active = [b for b in day if b.status != BookingStatus.CANCELLED]

    booked_slots = 0
    total_revenue = 0.0
    collected_revenue = 0.0
    carts = 0
    for booking in active:
        payable = [p for p in booking.players if not p.cancelled]
        booked_slots += len(payable)
        total_revenue += booking.rate * len(payable)
        collected_revenue += booking.rate * sum(1 for p in payable if p.paid)
        carts += booking.cartCount

    available = max(total_slots - booked_slots, 0)
    occupancy = (booked_slots / total_slots * 100) if total_slots else 0.0

    return DailyReport(
        date=iso_date,
        total_tee_times=len(day),
        total_slots=total_slots,
        booked_slots=booked_slots,
        available_slots=available,
        occupancy_rate=round(occupancy, 2),
        total_revenue=round(total_revenue, 2),
        collected_revenue=round(collected_revenue, 2),
        outstanding_revenue=round(total_revenue - collected_revenue, 2),
        checked_in=sum(1 for b in day if b.status == BookingStatus.CHECKED_IN),
        cancelled=sum(1 for b in day if b.status == BookingStatus.CANCELLED),
        no_show=sum(1 for b in day if b.status == BookingStatus.NO_SHOW),
        carts=carts,
        bookings=[
            ReportBookingLine(
                id=b.id,
                time=b.time,
                title=b.title,
                players=len(b.players),
                rate=b.rate,
                status=b.status,
            )
            for b in day
        ],
    )


def _current_iso_week() -> tuple[str, str]:
    today = date_cls.today()
    monday = today - timedelta(days=today.weekday())
    return monday.isoformat(), (monday + timedelta(days=6)).isoformat()


@router.get("/tee-sheet/reports/daily", response_model=DailyReport)
def get_daily_report(date: str = Query(...)) -> DailyReport:
    parse_iso_date(date)
    return build_daily_report(date, read_bookings())


@router.get("/tee-sheet/reports/week", response_model=WeekReport, response_model_by_alias=True)
def get_week_report(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
) -> WeekReport:
    default_from, default_to = _current_iso_week()
    start_iso = from_ or default_from
    end_iso = to or default_to
    start = parse_iso_date(start_iso, "from")
    end = parse_iso_date(end_iso, "to")
    if end < start:
        raise HTTPException(status_code=422, detail="'to' must not be before 'from'")
    if (end - start).days > 62:
        raise HTTPException(status_code=422, detail="Week report range is limited to 62 days")

    bookings = read_bookings()
    days: list[DailyReport] = []
    cursor = start
    while cursor <= end:
        days.append(build_daily_report(cursor.isoformat(), bookings))
        cursor += timedelta(days=1)

    total_revenue = sum(d.total_revenue for d in days)
    collected = sum(d.collected_revenue for d in days)
    booked = sum(d.booked_slots for d in days)
    capacity = sum(d.total_slots for d in days)

    return WeekReport(
        **{"from": start_iso},
        to=end_iso,
        days=days,
        summary=WeekSummary(
            total_days=len(days),
            total_tee_times=sum(d.total_tee_times for d in days),
            total_booked_slots=booked,
            total_revenue=round(total_revenue, 2),
            collected_revenue=round(collected, 2),
            average_occupancy=round((booked / capacity * 100) if capacity else 0.0, 2),
        ),
    )


# ===== 작업 레지스트리 =================================================

_task_lock = threading.RLock()
_tasks: list[OrchestrationTask] = []          # 최신순
_inflight: set[asyncio.Task[Any]] = set()     # GC 방지용 강한 참조


def _register_task(name: str, detail: str) -> OrchestrationTask:
    task = OrchestrationTask(
        id=str(uuid4()),
        name=name,
        state=TaskState.QUEUED,
        created_at=datetime.now(timezone.utc),
        detail=detail,
    )
    with _task_lock:
        _tasks.insert(0, task)
        del _tasks[MAX_TASKS:]
    return task


def _update_task(task_id: str, **changes: Any) -> None:
    with _task_lock:
        for task in _tasks:
            if task.id == task_id:
                for key, value in changes.items():
                    setattr(task, key, value)
                return


def _snapshot(task_ids: list[str]) -> list[OrchestrationTask]:
    with _task_lock:
        by_id = {t.id: t for t in _tasks}
        return [by_id[tid].model_copy(deep=True) for tid in task_ids if tid in by_id]


def recent_tasks() -> list[OrchestrationTask]:
    with _task_lock:
        return [t.model_copy(deep=True) for t in _tasks]


def _launch(task: OrchestrationTask, coro_factory: Any) -> None:
    """작업을 이벤트 루프에 올린다. 어떤 경우에도 running 에서 멈추지 않게 한다."""

    async def runner() -> None:
        started = datetime.now(timezone.utc)
        clock = time.perf_counter()
        _update_task(task.id, state=TaskState.RUNNING, started_at=started)
        try:
            result = await coro_factory()
            _update_task(
                task.id,
                state=TaskState.SUCCESS,
                result=result if isinstance(result, dict) else {"value": result},
                finished_at=datetime.now(timezone.utc),
                duration_ms=int((time.perf_counter() - clock) * 1000),
            )
        except asyncio.CancelledError:
            _update_task(
                task.id,
                state=TaskState.FAILED,
                error="Task cancelled before completion",
                finished_at=datetime.now(timezone.utc),
                duration_ms=int((time.perf_counter() - clock) * 1000),
            )
            raise
        except Exception as exc:
            logger.exception("오케스트레이션 작업 실패: %s", task.name)
            _update_task(
                task.id,
                state=TaskState.FAILED,
                error=f"{type(exc).__name__}: {exc}",
                finished_at=datetime.now(timezone.utc),
                duration_ms=int((time.perf_counter() - clock) * 1000),
            )

    handle = asyncio.create_task(runner(), name=f"tee-sheet:{task.name}")
    _inflight.add(handle)
    handle.add_done_callback(_inflight.discard)


# ===== 실제 작업 구현 ==================================================

async def send_reminders(iso_date: str) -> dict[str, Any]:
    """해당 날짜의 유효 예약에 리마인더를 보낸다 (외부 호출은 시뮬레이션)."""
    clock = time.perf_counter()
    targets = [
        b for b in read_bookings()
        if b.date == iso_date and b.status in (BookingStatus.RESERVED, BookingStatus.CHECKED_IN)
    ]
    recipients: list[str] = []
    for booking in targets:
        for player in booking.players:
            if player.cancelled:
                continue
            recipients.append(player.email or f"{player.name.replace(' ', '.').lower()}@example.com")

    await asyncio.sleep(0.25)  # 메일 게이트웨이 왕복 시뮬레이션
    return {
        "task": "send_reminders",
        "date": iso_date,
        "bookings": len(targets),
        "recipients": len(recipients),
        "sent": len(recipients),
        "failed": 0,
        "duration_ms": int((time.perf_counter() - clock) * 1000),
    }


async def build_report_task(iso_date: str) -> dict[str, Any]:
    clock = time.perf_counter()
    report = build_daily_report(iso_date, read_bookings())
    await asyncio.sleep(0.18)  # 리포트 파이프라인 시뮬레이션
    return {
        "task": "generate_report",
        "date": iso_date,
        "total_tee_times": report.total_tee_times,
        "booked_slots": report.booked_slots,
        "total_revenue": report.total_revenue,
        "occupancy_rate": report.occupancy_rate,
        "duration_ms": int((time.perf_counter() - clock) * 1000),
    }


async def refresh_availability(iso_date: str) -> dict[str, Any]:
    clock = time.perf_counter()
    slots = generate_slots(iso_date)
    taken = {b.time for b in read_bookings() if b.date == iso_date and b.status != BookingStatus.CANCELLED}
    await asyncio.sleep(0.12)  # 채널 매니저 푸시 시뮬레이션
    return {
        "task": "refresh_availability",
        "date": iso_date,
        "total_slots": len(slots),
        "taken_slots": len(taken),
        "open_slots": len(slots) - len(taken),
        "duration_ms": int((time.perf_counter() - clock) * 1000),
    }


async def run_daily_batch(iso_date: str) -> dict[str, Any]:
    """리마인더 / 리포트 / 가용성 갱신을 **실제로 동시에** 돌린다."""
    clock = time.perf_counter()
    results = await asyncio.gather(
        send_reminders(iso_date),
        build_report_task(iso_date),
        refresh_availability(iso_date),
        return_exceptions=True,
    )

    subtasks: list[dict[str, Any]] = []
    names = ("send_reminders", "generate_report", "refresh_availability")
    failures = 0
    sequential_ms = 0
    for name, outcome in zip(names, results):
        if isinstance(outcome, BaseException):
            failures += 1
            subtasks.append({"task": name, "status": "failed", "error": str(outcome), "duration_ms": 0})
        else:
            sequential_ms += int(outcome.get("duration_ms") or 0)
            subtasks.append({**outcome, "status": "success"})

    wall_ms = int((time.perf_counter() - clock) * 1000)
    return {
        "task": "daily_batch",
        "date": iso_date,
        "parallel": True,
        "subtasks": subtasks,
        "failed_subtasks": failures,
        # 병렬성 증거: 벽시계 시간이 각 파트 합보다 확연히 작아야 한다.
        "duration_ms": wall_ms,
        "sequential_ms": sequential_ms,
        "speedup": round(sequential_ms / wall_ms, 2) if wall_ms else None,
    }


def cleanup_expired_bookings(before_iso: str) -> dict[str, Any]:
    """`before_iso` 보다 **엄격히 이전** 날짜의 예약을 실제로 삭제한다."""
    removed: list[dict[str, str]] = []
    with bookings_tx() as bookings:
        keep: list[TeeBooking] = []
        for booking in bookings:
            if booking.date < before_iso:
                removed.append({"id": booking.id, "date": booking.date, "time": booking.time,
                                "title": booking.title})
            else:
                keep.append(booking)
        bookings[:] = keep
        remaining = len(keep)

    return {
        "task": "cleanup",
        "status": "success",
        "before": before_iso,
        "deleted": len(removed),
        "remaining": remaining,
        "deleted_bookings": removed,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def cleanup_task(before_iso: str) -> dict[str, Any]:
    return await asyncio.to_thread(cleanup_expired_bookings, before_iso)


NO_SHOW_GRACE_MINUTES = 30


def _minutes_past(iso_date: str, time_label: str, now: datetime) -> int | None:
    """슬롯 시각이 지금보다 몇 분 지났는지. 미래면 음수, 파싱 실패면 None."""
    minutes = label_to_minutes(time_label)
    if minutes is None:
        return None
    try:
        day = date_cls.fromisoformat(iso_date)
    except ValueError:
        return None
    slot_at = datetime.combine(day, datetime.min.time()) + timedelta(minutes=minutes)
    return int((now - slot_at).total_seconds() // 60)


def run_sync_pass(iso_date: str) -> dict[str, Any]:
    """결정론적 동기화 패스.

    무작위 상태 변경은 하지 않는다. 문제를 스캔해서 보고하고,
    슬롯 시각이 30분 넘게 지난 `reserved` 건만 `no_show` 로 넘긴다.
    """
    now = datetime.now()
    findings: list[dict[str, Any]] = []
    updated = 0

    with bookings_tx() as bookings:
        day = [b for b in bookings if b.date == iso_date]
        day.sort(key=lambda b: label_to_minutes(b.time) or 0)

        for booking in day:
            past = _minutes_past(booking.date, booking.time, now)

            if not booking.players and booking.status not in (BookingStatus.BLOCKED, BookingStatus.CANCELLED):
                findings.append({
                    "booking_id": booking.id, "time": booking.time, "title": booking.title,
                    "issue": "empty_booking", "severity": "warning",
                    "detail": "Reservation has no players.", "action": "none",
                })

            if booking.cartCount > len(booking.players):
                findings.append({
                    "booking_id": booking.id, "time": booking.time, "title": booking.title,
                    "issue": "cart_count_exceeds_players", "severity": "warning",
                    "detail": f"{booking.cartCount} carts for {len(booking.players)} players.",
                    "action": "none",
                })

            if booking.status == BookingStatus.RESERVED and past is not None and past > 0:
                if past > NO_SHOW_GRACE_MINUTES:
                    booking.status = BookingStatus.NO_SHOW
                    for player in booking.players:
                        if not player.cancelled:
                            player.no_show = True
                    _audit(booking, f"Sync pass marked no-show ({past} minutes past tee time).")
                    updated += 1
                    findings.append({
                        "booking_id": booking.id, "time": booking.time, "title": booking.title,
                        "issue": "past_tee_time_still_reserved", "severity": "error",
                        "detail": f"Tee time passed {past} minutes ago with no check-in.",
                        "action": "marked_no_show",
                    })
                else:
                    findings.append({
                        "booking_id": booking.id, "time": booking.time, "title": booking.title,
                        "issue": "past_tee_time_still_reserved", "severity": "warning",
                        "detail": f"Tee time passed {past} minutes ago; within the "
                                  f"{NO_SHOW_GRACE_MINUTES} minute grace period.",
                        "action": "no_show_candidate",
                    })

        scanned = len(day)

    return {
        "task": "worker_sync",
        "date": iso_date,
        "scanned": scanned,
        "issues": len(findings),
        "updated": updated,
        "findings": findings,
        "deterministic": True,
    }


async def worker_task(iso_date: str) -> dict[str, Any]:
    return await asyncio.to_thread(run_sync_pass, iso_date)


# ===== 오케스트레이션 엔드포인트 =======================================

AVAILABLE_TASKS = [
    AvailableTask(
        name="daily_batch",
        description="일일 배치: 리마인더 · 리포트 · 가용성 갱신을 병렬로 실행",
        endpoint="POST /tee-sheet/orchestration/daily-batch",
    ),
    AvailableTask(
        name="send_reminders",
        description="해당 날짜 예약자에게 리마인더 발송",
        endpoint="POST /tee-sheet/orchestration/send-reminders",
    ),
    AvailableTask(
        name="cleanup",
        description="기준일 이전의 지난 예약 삭제",
        endpoint="POST /tee-sheet/orchestration/cleanup",
    ),
    AvailableTask(
        name="worker_sync",
        description="결정론적 동기화 패스: 문제 스캔 + 노쇼 처리",
        endpoint="POST /tee-sheet/worker/run",
    ),
]


@router.get("/tee-sheet/orchestration/status", response_model=OrchestrationStatus)
def orchestration_status() -> OrchestrationStatus:
    return OrchestrationStatus(
        status="ready",
        total_bookings=len(read_bookings()),
        timestamp=datetime.now(timezone.utc),
        available_tasks=AVAILABLE_TASKS,
        tasks=recent_tasks(),
    )


@router.post("/tee-sheet/orchestration/daily-batch", response_model=TaskAck)
async def orchestration_daily_batch(date: str | None = Query(None)) -> TaskAck:
    iso_date = date or date_cls.today().isoformat()
    parse_iso_date(iso_date)
    task = _register_task("daily_batch", f"Parallel daily batch for {iso_date}")
    _launch(task, lambda: run_daily_batch(iso_date))
    return TaskAck(
        accepted=True,
        tasks=_snapshot([task.id]),
        message=f"Daily batch queued for {iso_date}; poll /tee-sheet/orchestration/status.",
    )


@router.post("/tee-sheet/orchestration/send-reminders", response_model=TaskAck)
async def orchestration_send_reminders(date: str | None = Query(None)) -> TaskAck:
    iso_date = date or date_cls.today().isoformat()
    parse_iso_date(iso_date)
    task = _register_task("send_reminders", f"Reminder run for {iso_date}")
    _launch(task, lambda: send_reminders(iso_date))
    return TaskAck(
        accepted=True,
        tasks=_snapshot([task.id]),
        message=f"Reminders queued for {iso_date}.",
    )


@router.post("/tee-sheet/orchestration/cleanup", response_model=TaskAck)
async def orchestration_cleanup(before: str | None = Query(None)) -> TaskAck:
    before_iso = before or date_cls.today().isoformat()
    parse_iso_date(before_iso, "before")
    task = _register_task("cleanup", f"Delete bookings before {before_iso}")
    _launch(task, lambda: cleanup_task(before_iso))
    return TaskAck(
        accepted=True,
        tasks=_snapshot([task.id]),
        message=f"Cleanup queued for bookings before {before_iso}.",
    )


@router.post("/tee-sheet/worker/run", response_model=TaskAck)
async def run_worker(date: str | None = Query(None)) -> TaskAck:
    iso_date = date or date_cls.today().isoformat()
    parse_iso_date(iso_date)
    task = _register_task("worker_sync", f"Deterministic sync pass for {iso_date}")
    _launch(task, lambda: worker_task(iso_date))
    return TaskAck(
        accepted=True,
        tasks=_snapshot([task.id]),
        message=f"Sync pass queued for {iso_date}.",
    )
