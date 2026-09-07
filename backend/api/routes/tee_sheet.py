from __future__ import annotations

from datetime import datetime, timezone, timedelta
from enum import Enum
from random import randint
from typing import Literal, Optional
from uuid import uuid4
import asyncio
import logging

from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from pydantic import BaseModel, Field, model_validator

logger = logging.getLogger(__name__)
router = APIRouter()


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


class Player(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = "Guest"
    email: str = ""
    phone: str = ""
    type: PlayerType = PlayerType.GUEST
    ratePlan: str = "Public"
    arrived: bool = False
    paid: bool = False
    cancelled: bool = False
    no_show: bool = False


class AuditEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    message: str


class TeeBooking(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    date: str = "September 11, 2026"
    time: str = Field(..., pattern=r"^\d{1,2}:\d{2} (AM|PM)$")
    holes: Literal[9, 18] = 18
    rate: float = 58.41
    dayIndex: int = Field(default=0, ge=0, le=6)
    span: int = Field(default=1, ge=1, le=7)
    color: Literal["blue", "gold", "gray"] = "gold"
    title: str
    status: BookingStatus = BookingStatus.RESERVED
    cartCount: int = Field(default=0, ge=0, le=4)
    players: list[Player] = Field(default_factory=list, max_length=4)
    audit: list[AuditEntry] = Field(default_factory=list)
    cancelReason: str | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def ensure_players(self) -> "TeeBooking":
        if len(self.players) > 4:
            raise ValueError("A tee time can contain at most 4 players")
        return self


class CreateBookingRequest(BaseModel):
    time: str = Field(..., pattern=r"^\d{1,2}:\d{2} (AM|PM)$")
    date: str = "September 11, 2026"
    dayIndex: int = Field(default=0, ge=0, le=6)
    title: str
    players: list[Player] = Field(default_factory=list, max_length=4)
    holes: Literal[9, 18] = 18
    rate: float = 58.41
    cartCount: int = Field(default=0, ge=0, le=4)


class PatchBookingRequest(BaseModel):
    status: BookingStatus | None = None
    holes: Literal[9, 18] | None = None
    rate: float | None = None
    cartCount: int | None = Field(default=None, ge=0, le=4)
    cancelReason: str | None = None


class AddPlayerRequest(BaseModel):
    name: str = "Guest"
    email: str = ""
    phone: str = ""
    type: PlayerType = PlayerType.GUEST


class PatchPlayerRequest(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    type: PlayerType | None = None
    ratePlan: str | None = None
    arrived: bool | None = None
    paid: bool | None = None
    cancelled: bool | None = None
    no_show: bool | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _audit(booking: TeeBooking, message: str) -> None:
    booking.audit.insert(0, AuditEntry(message=message))
    del booking.audit[20:]
    booking.updated_at = _now()


def _seed() -> list[TeeBooking]:
    return [
        TeeBooking(
            id="b-predote",
            date="September 10, 2026",
            time="6:58 AM",
            dayIndex=3,
            span=1,
            color="gold",
            title="Predote, Marie",
            rate=47.79,
            cartCount=2,
            players=[
                Player(name="Marie Predote", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single with Weekday Cart"),
                Player(name="Betty Lou DiMattio", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single with Weekday Cart"),
                Player(name="Roseann Norton", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single with Weekday Cart"),
                Player(name="Steve Murphy", type=PlayerType.EXISTING, ratePlan="Full Member - Single with 7 Day Cart"),
            ],
            audit=[AuditEntry(message="Imported from Chronogolf tee sheet for September 10, 2026.")],
        ),
        TeeBooking(
            id="b-wheeland",
            date="September 10, 2026",
            time="7:07 AM",
            dayIndex=3,
            span=1,
            color="blue",
            title="Wheeland, Bryan",
            rate=47.79,
            players=[
                Player(name="Bryan Wheeland", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="Alf Wheeland", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single with Weekday Cart"),
                Player(name="Colin Scott", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="David Neville", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single with Weekday Cart"),
            ],
            audit=[AuditEntry(message="Imported from Chronogolf tee sheet for September 10, 2026.")],
        ),
        TeeBooking(
            id="b-marshall",
            date="September 10, 2026",
            time="7:16 AM",
            dayIndex=3,
            span=1,
            color="gold",
            title="Marshall, Dan",
            rate=47.79,
            cartCount=1,
            players=[
                Player(name="Dan Marshall", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="Leslie Reid", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="Joe Grdovich", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="Peter Catti", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
            ],
            audit=[AuditEntry(message="Imported from Chronogolf tee sheet for September 10, 2026.")],
        ),
        TeeBooking(
            id="b-nicalou",
            date="September 10, 2026",
            time="7:25 AM",
            dayIndex=3,
            span=1,
            color="blue",
            title="Nicalou, Chris",
            rate=47.79,
            cartCount=1,
            players=[
                Player(name="Chris Nicalou", type=PlayerType.EXISTING, ratePlan="Full Member - Single with 7 Day Cart"),
                Player(name="Triada Nicolou", type=PlayerType.EXISTING, ratePlan="Full Member - Single with 7 Day Cart"),
            ],
            audit=[AuditEntry(message="Imported from Chronogolf tee sheet for September 10, 2026.")],
        ),
        TeeBooking(
            id="b-carlsson",
            date="September 10, 2026",
            time="8:01 AM",
            dayIndex=3,
            span=1,
            color="gold",
            title="Carlsson, James",
            rate=47.79,
            players=[
                Player(name="James Carlsson", type=PlayerType.EXISTING, ratePlan="GolfNow"),
                Player(name="Guest", ratePlan="GolfNow"),
                Player(name="Guest", ratePlan="GolfNow"),
            ],
            audit=[AuditEntry(message="Imported from Chronogolf tee sheet for September 10, 2026.")],
        ),
        TeeBooking(
            id="b-costea",
            date="September 10, 2026",
            time="8:10 AM",
            dayIndex=3,
            span=1,
            color="blue",
            title="Costea, Rick",
            rate=47.79,
            cartCount=2,
            players=[
                Player(name="Rick Costea", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="Rudy Videchak", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="Roger Denis", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
            ],
            audit=[AuditEntry(message="Imported from Chronogolf tee sheet for September 10, 2026.")],
        ),
        TeeBooking(
            id="b-sep11-predote",
            date="September 11, 2026",
            time="6:58 AM",
            dayIndex=4,
            span=1,
            color="gold",
            title="Predote, Marie",
            rate=58.41,
            cartCount=2,
            players=[
                Player(name="Marie Predote", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single with Weekday Cart"),
                Player(name="Roseann Norton", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single with Weekday Cart"),
                Player(name="Betty Lou DiMattio", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single with Weekday Cart"),
                Player(name="Steve Murphy", type=PlayerType.EXISTING, ratePlan="Full Member - Single with 7 Day Cart"),
            ],
            audit=[AuditEntry(message="Imported from visible Chronogolf tee sheet for September 11, 2026.")],
        ),
        TeeBooking(
            id="b-sep11-marshall",
            date="September 11, 2026",
            time="7:07 AM",
            dayIndex=4,
            span=1,
            color="blue",
            title="Marshall, Dan",
            rate=58.41,
            cartCount=1,
            players=[
                Player(name="Dan Marshall", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="Colin Scott", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="David Neville", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single with Weekday Cart"),
                Player(name="Guest", ratePlan="Public"),
            ],
            audit=[AuditEntry(message="Imported from visible Chronogolf tee sheet for September 11, 2026.")],
        ),
        TeeBooking(
            id="b-sep11-nicalou",
            date="September 11, 2026",
            time="7:16 AM",
            dayIndex=4,
            span=1,
            color="gold",
            title="Nicalou, Chris",
            rate=58.41,
            cartCount=1,
            players=[
                Player(name="Chris Nicalou", type=PlayerType.EXISTING, ratePlan="Full Member - Single with 7 Day Cart"),
                Player(name="Triada Nicolou", type=PlayerType.EXISTING, ratePlan="Full Member - Single with 7 Day Cart"),
            ],
            audit=[AuditEntry(message="Imported from visible Chronogolf tee sheet for September 11, 2026.")],
        ),
        TeeBooking(
            id="b-sep11-kicul",
            date="September 11, 2026",
            time="7:25 AM",
            dayIndex=4,
            span=1,
            color="blue",
            title="Kicul, Marty",
            rate=58.41,
            players=[
                Player(name="Marty Kicul", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="Wayne Armstrong", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="David Kaufmann", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
            ],
            audit=[AuditEntry(message="Imported from visible Chronogolf tee sheet for September 11, 2026.")],
        ),
        TeeBooking(
            id="b-sep11-buckley",
            date="September 11, 2026",
            time="7:34 AM",
            dayIndex=4,
            span=1,
            color="gold",
            title="buckley, jami",
            rate=58.41,
            cartCount=2,
            players=[
                Player(name="Jami Buckley", type=PlayerType.EXISTING, ratePlan="Public"),
                Player(name="Guest", ratePlan="Public"),
                Player(name="Guest", ratePlan="Public"),
                Player(name="Guest", ratePlan="Public"),
            ],
            audit=[AuditEntry(message="Imported from visible Chronogolf tee sheet for September 11, 2026.")],
        ),
        TeeBooking(
            id="b-sep11-unrau",
            date="September 11, 2026",
            time="7:43 AM",
            dayIndex=4,
            span=1,
            color="blue",
            title="Unrau, Ruth",
            rate=58.41,
            cartCount=1,
            players=[
                Player(name="Ruth Unrau", type=PlayerType.EXISTING, ratePlan="Public Senior"),
                Player(name="Guest", ratePlan="Public Senior"),
            ],
            audit=[AuditEntry(message="Imported from visible Chronogolf tee sheet for September 11, 2026.")],
        ),
        TeeBooking(
            id="b-sep11-costea",
            date="September 11, 2026",
            time="8:10 AM",
            dayIndex=4,
            span=1,
            color="gold",
            title="Costea, Rick",
            rate=58.41,
            cartCount=2,
            players=[
                Player(name="Rick Costea", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="Rudy Videchak", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
                Player(name="Roger Denis", type=PlayerType.EXISTING, ratePlan="Weekday Member - Single"),
            ],
            audit=[AuditEntry(message="Imported from visible Chronogolf tee sheet for September 11, 2026.")],
        ),
    ]


bookings: list[TeeBooking] = _seed()


def _find(booking_id: str) -> TeeBooking:
    for booking in bookings:
        if booking.id == booking_id:
            return booking
    raise HTTPException(status_code=404, detail="Booking not found")


@router.get("/tee-sheet/bookings", response_model=list[TeeBooking])
def list_bookings() -> list[TeeBooking]:
    return bookings


@router.post("/tee-sheet/bookings", response_model=TeeBooking, status_code=201)
def create_booking(body: CreateBookingRequest) -> TeeBooking:
    booking = TeeBooking(
        time=body.time,
        date=body.date,
        dayIndex=body.dayIndex,
        title=body.title,
        players=body.players,
        holes=body.holes,
        rate=body.rate,
        cartCount=body.cartCount,
    )
    _audit(booking, "Reservation created.")
    bookings.insert(0, booking)
    return booking


@router.patch("/tee-sheet/bookings/{booking_id}", response_model=TeeBooking)
def patch_booking(booking_id: str, body: PatchBookingRequest) -> TeeBooking:
    booking = _find(booking_id)
    if body.holes is not None:
        booking.holes = body.holes
    if body.rate is not None:
        booking.rate = body.rate
    if body.cartCount is not None:
        booking.cartCount = body.cartCount
    if body.status is not None:
        booking.status = body.status
        if body.status == BookingStatus.CHECKED_IN:
            for player in booking.players:
                if not player.cancelled:
                    player.arrived = True
        if body.status == BookingStatus.PAID:
            for player in booking.players:
                if not player.cancelled:
                    player.arrived = True
                    player.paid = True
        if body.status == BookingStatus.CANCELLED:
            booking.cancelReason = body.cancelReason or "Cancelled by pro shop."
            for player in booking.players:
                player.cancelled = True
        _audit(booking, f"Reservation marked {body.status.value}.")
    return booking


@router.delete("/tee-sheet/bookings/{booking_id}", status_code=204)
def delete_booking(booking_id: str) -> None:
    booking = _find(booking_id)
    bookings.remove(booking)


@router.post("/tee-sheet/bookings/{booking_id}/players", response_model=TeeBooking)
def add_player(booking_id: str, body: AddPlayerRequest) -> TeeBooking:
    booking = _find(booking_id)
    if len(booking.players) >= 4:
        raise HTTPException(status_code=422, detail="A tee time can contain at most 4 players")
    booking.players.append(Player(**body.model_dump()))
    _audit(booking, f"Player added: {body.name}.")
    return booking


@router.patch("/tee-sheet/bookings/{booking_id}/players/{player_id}", response_model=TeeBooking)
def patch_player(booking_id: str, player_id: str, body: PatchPlayerRequest) -> TeeBooking:
    booking = _find(booking_id)
    for player in booking.players:
        if player.id == player_id:
            fields = body.model_dump(exclude_unset=True)
            for key, value in fields.items():
                setattr(player, key, value)
            _audit(booking, f"Player updated: {player.name}.")
            return booking
    raise HTTPException(status_code=404, detail="Player not found")


@router.delete("/tee-sheet/bookings/{booking_id}/players/{player_id}", response_model=TeeBooking)
def delete_player(booking_id: str, player_id: str) -> TeeBooking:
    booking = _find(booking_id)
    if len(booking.players) <= 1:
        raise HTTPException(status_code=422, detail="A reservation must keep at least one player")
    for player in booking.players:
        if player.id == player_id:
            booking.players.remove(player)
            _audit(booking, f"Player removed: {player.name}.")
            return booking
    raise HTTPException(status_code=404, detail="Player not found")


@router.post("/tee-sheet/worker/run")
def run_worker() -> dict[str, int]:
    attempted = 0
    booked = 0
    for booking in bookings:
        if booking.status != BookingStatus.RESERVED:
            continue
        attempted += 1
        if randint(0, 1) == 1:
            booking.status = BookingStatus.CHECKED_IN
            _audit(booking, "Worker found matching tee time and staged check-in.")
            booked += 1
        else:
            _audit(booking, "Worker attempted booking sync; no external change.")
    return {"attempted": attempted, "updated": booked}


# ===== 병렬 오케스트레이션 =====

class AsyncTaskResult(BaseModel):
    task_id: str
    status: str
    completed_at: Optional[datetime] = None
    result: Optional[dict] = None


async def process_send_confirmation_email(booking_id: str, email: str, name: str) -> dict:
    """이메일 발송 시뮬레이션"""
    try:
        await asyncio.sleep(0.5)  # 실제 이메일 API 호출 시뮬레이션
        logger.info(f"✉️ Email sent to {email} for booking {booking_id}")
        return {"status": "success", "recipient": email, "booking_id": booking_id}
    except Exception as e:
        logger.error(f"Email failed: {e}")
        return {"status": "failed", "error": str(e)}


async def process_update_availability(booking_id: str) -> dict:
    """가용성 업데이트"""
    try:
        await asyncio.sleep(0.3)
        logger.info(f"📊 Availability updated for booking {booking_id}")
        return {"status": "success", "booking_id": booking_id}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


async def process_send_reminder(booking_ids: list[str]) -> dict:
    """배치 리마인더 발송 (병렬)"""
    tasks = [
        process_send_confirmation_email(bid, f"player_{bid}@example.com", "Guest")
        for bid in booking_ids
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    sent = sum(1 for r in results if isinstance(r, dict) and r.get("status") == "success")
    failed = len(results) - sent

    return {
        "status": "completed",
        "sent": sent,
        "failed": failed,
        "total": len(booking_ids)
    }


async def generate_daily_report(date_str: str) -> dict:
    """일일 리포트 생성"""
    try:
        target_bookings = [b for b in bookings if b.date == date_str]

        total_slots = len(target_bookings) * 4  # 예상 슬롯
        booked_slots = sum(len(b.players) for b in target_bookings)
        total_revenue = sum(b.rate * len(b.players) for b in target_bookings)

        logger.info(f"📈 Daily report generated for {date_str}")

        return {
            "date": date_str,
            "total_tee_times": len(target_bookings),
            "total_slots": total_slots,
            "booked_slots": booked_slots,
            "available_slots": total_slots - booked_slots,
            "occupancy_rate": (booked_slots / total_slots * 100) if total_slots > 0 else 0,
            "total_revenue": total_revenue,
            "bookings": [
                {"id": b.id, "time": b.time, "players": len(b.players), "rate": b.rate}
                for b in target_bookings
            ]
        }
    except Exception as e:
        logger.error(f"Report generation failed: {e}")
        return {"status": "failed", "error": str(e)}


async def cleanup_expired_bookings() -> dict:
    """지난 예약 정리"""
    global bookings

    try:
        current_date = datetime.now(timezone.utc)
        initial_count = len(bookings)

        # 필터링 (실제로는 데이터베이스에서 삭제)
        # bookings = [b for b in bookings if datetime.strptime(b.date, "%B %d, %Y") > current_date]

        deleted_count = initial_count - len(bookings)
        logger.info(f"🗑️ Cleanup completed: {deleted_count} expired bookings removed")

        return {
            "status": "success",
            "deleted": deleted_count,
            "remaining": len(bookings),
            "timestamp": current_date.isoformat()
        }
    except Exception as e:
        logger.error(f"Cleanup failed: {e}")
        return {"status": "failed", "error": str(e)}


@router.post("/tee-sheet/orchestration/daily-batch")
async def orchestration_daily_batch(
    date: str = Query("September 11, 2026"),
    background_tasks: BackgroundTasks = None
) -> dict:
    """
    일일 배치 작업: 보고서, 이메일, 가용성 업데이트를 병렬로 처리
    """
    target_booking_ids = [b.id for b in bookings if b.date == date]

    # 백그라운드에서 병렬 실행
    if background_tasks:
        background_tasks.add_task(
            process_send_reminder,
            target_booking_ids[:3]  # 처음 3개만 처리
        )
        background_tasks.add_task(
            generate_daily_report,
            date
        )

    return {
        "status": "processing",
        "date": date,
        "bookings_count": len(target_booking_ids),
        "tasks": ["send_reminders", "generate_report"],
        "message": "Daily batch tasks started in background"
    }


@router.post("/tee-sheet/orchestration/send-reminders")
async def orchestration_send_reminders(
    date: str = Query("September 11, 2026"),
    background_tasks: BackgroundTasks = None
) -> dict:
    """
    리마인더 이메일 발송 (24시간 후 예약자들에게)
    """
    tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
    target_bookings = [b for b in bookings if b.date == date]
    booking_ids = [b.id for b in target_bookings[:5]]

    if background_tasks:
        background_tasks.add_task(
            process_send_reminder,
            booking_ids
        )

    return {
        "status": "reminders_scheduled",
        "target_date": date,
        "bookings": len(target_bookings),
        "scheduled_time": tomorrow.isoformat()
    }


@router.post("/tee-sheet/orchestration/cleanup")
async def orchestration_cleanup(background_tasks: BackgroundTasks = None) -> dict:
    """
    지난 예약 정리 및 데이터베이스 최적화
    """
    if background_tasks:
        background_tasks.add_task(cleanup_expired_bookings)

    return {
        "status": "cleanup_started",
        "message": "Database cleanup task started in background"
    }


@router.get("/tee-sheet/orchestration/status")
async def orchestration_status() -> dict:
    """오케스트레이션 상태 조회"""
    return {
        "status": "ready",
        "available_tasks": [
            {
                "name": "daily_batch",
                "description": "일일 배치: 리포트, 이메일, 가용성 업데이트",
                "endpoint": "POST /tee-sheet/orchestration/daily-batch"
            },
            {
                "name": "send_reminders",
                "description": "배치 리마인더 이메일 발송 (병렬)",
                "endpoint": "POST /tee-sheet/orchestration/send-reminders"
            },
            {
                "name": "cleanup",
                "description": "지난 예약 정리",
                "endpoint": "POST /tee-sheet/orchestration/cleanup"
            }
        ],
        "total_bookings": len(bookings),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@router.get("/tee-sheet/reports/daily")
async def get_daily_report(date: str = Query("September 11, 2026")) -> dict:
    """
    일일 리포트 조회
    """
    result = await generate_daily_report(date)
    return result


@router.get("/tee-sheet/reports/week")
async def get_week_report() -> dict:
    """
    주간 리포트 조회
    """
    dates = list(set(b.date for b in bookings))

    all_reports = []
    for date in sorted(dates):
        report = await generate_daily_report(date)
        all_reports.append(report)

    total_revenue = sum(r.get("total_revenue", 0) for r in all_reports)
    total_booked = sum(r.get("booked_slots", 0) for r in all_reports)

    return {
        "week": "September 10-12, 2026",
        "days": all_reports,
        "summary": {
            "total_days": len(all_reports),
            "total_booked_slots": total_booked,
            "total_revenue": total_revenue,
            "average_occupancy": (total_booked / (len(all_reports) * 24)) * 100 if all_reports else 0
        }
    }
