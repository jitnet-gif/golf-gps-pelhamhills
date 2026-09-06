from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from random import randint
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

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
