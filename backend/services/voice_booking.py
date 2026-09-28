"""
AI 전화 예약 엔진.

tee_sheet 라우터의 인메모리 bookings 목록을 그대로 원천 데이터로 사용합니다.
ElevenLabs 도구, SMS 인바운드, 어드민이 모두 이 모듈을 거치므로 규칙은 여기 한 곳에만 둡니다.
단일 프로세스 기준이므로 슬롯 잠금은 threading.Lock 으로 처리합니다
(Supabase 이전 시 teesheet.hold_slot FOR UPDATE 함수로 교체).
"""
from __future__ import annotations

import itertools
import logging
import re
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from uuid import uuid4

from backend.api.routes import tee_sheet
from backend.api.routes.tee_sheet import BookingStatus, Player, PlayerType, TeeBooking
from backend.core.config import settings
from backend.services.twilio_sms import normalize_phone, send_sms

logger = logging.getLogger(__name__)

try:
    from zoneinfo import ZoneInfo

    COURSE_TZ = ZoneInfo(settings.COURSE_TIMEZONE)
except Exception:  # Windows에서 tzdata 미설치 시
    logger.warning("tzdata 없음 — EDT(UTC-4) 고정 오프셋 사용. `pip install tzdata` 권장")
    COURSE_TZ = timezone(timedelta(hours=-4))

FIRST_TEE = time(6, 40)
LAST_TEE = time(18, 58)
INTERVAL_MIN = 9
CAPACITY = 4
HOLD_TTL = timedelta(minutes=5)
HST = 0.13

# 1인 그린피(세전). Tee Times & Pricing 화면 기준값 — 요금 변경 시 함께 수정하세요.
# 9홀 요금이 없으면 AI는 예약하지 않고 프로샵으로 연결합니다.
GREEN_FEES: dict[tuple[int, str], float] = {
    (18, "weekday"): 47.79,
    (18, "weekend"): 58.41,
}


class BookingError(Exception):
    """AI가 고객에게 그대로 읽어줄 수 있는 사유를 담은 예외"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Hold:
    date: date
    tee_time: time
    players: int
    holes: int
    carts: int
    caller_e164: str | None
    conversation_id: str | None
    expires_at: datetime
    id: str = field(default_factory=lambda: f"H-{uuid4().hex[:6].upper()}")
    status: str = "active"  # active·confirmed·expired·released


@dataclass
class WaitlistEntry:
    date: date
    earliest: time
    latest: time
    players: int
    phone_e164: str
    name: str
    id: str = field(default_factory=lambda: f"W-{uuid4().hex[:5].upper()}")
    notified_at: datetime | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class VoiceCall:
    conversation_id: str
    caller_e164: str | None = None
    call_sid: str | None = None
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    outcome: str = "in_progress"  # booked·cancelled·transferred·abandoned·info·in_progress
    booking_refs: list[str] = field(default_factory=list)
    summary: str | None = None
    duration_s: int | None = None
    transcript: list[dict] = field(default_factory=list)


_lock = threading.Lock()
holds: dict[str, Hold] = {}
waitlist: list[WaitlistEntry] = []
voice_calls: dict[str, VoiceCall] = {}
_ref_counter = itertools.count(10392)
_reminders_sent: set[tuple[str, str]] = set()


# ---------- 시간·형식 도우미 ----------

def now_local() -> datetime:
    return datetime.now(COURSE_TZ)


def sheet_date(d: date) -> str:
    return f"{d:%B} {d.day}, {d.year}"


def sheet_time(t: time) -> str:
    h12 = t.hour % 12 or 12
    return f"{h12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def parse_sheet_date(value: str) -> date | None:
    try:
        return datetime.strptime(value, "%B %d, %Y").date()
    except ValueError:
        return None


def parse_sheet_time(value: str) -> time | None:
    try:
        return datetime.strptime(value, "%I:%M %p").time()
    except ValueError:
        return None


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise BookingError("BAD_DATE", "I couldn't understand that date. Please use a specific day.")


def parse_hhmm(value: str | None, default: time) -> time:
    if not value:
        return default
    for fmt in ("%H:%M", "%I:%M %p", "%I:%M%p", "%I %p"):
        try:
            return datetime.strptime(value.strip().upper(), fmt).time()
        except ValueError:
            continue
    raise BookingError("BAD_TIME", "I couldn't understand that time.")


def tee_times() -> list[time]:
    out, cur = [], datetime.combine(date.min, FIRST_TEE)
    end = datetime.combine(date.min, LAST_TEE)
    while cur <= end:
        out.append(cur.time())
        cur += timedelta(minutes=INTERVAL_MIN)
    return out


def day_type(d: date) -> str:
    return "weekend" if d.weekday() >= 5 else "weekday"


def green_fee(d: date, holes: int) -> float | None:
    return GREEN_FEES.get((holes, day_type(d)))


def price_quote(d: date, holes: int, players: int) -> dict:
    fee = green_fee(d, holes)
    if fee is None:
        raise BookingError("RATE_UNAVAILABLE", f"I don't have {holes}-hole pricing for that day. Let me connect you to the pro shop.")
    subtotal = round(fee * players, 2)
    tax = round(subtotal * HST, 2)
    return {
        "green_fee_per_player": fee,
        "subtotal": subtotal,
        "hst": tax,
        "total_incl_tax": round(subtotal + tax, 2),
        "note": "Green fees only. Cart fees are added at the pro shop.",
    }


# ---------- 점유 계산 ----------

def _expire_holds() -> None:
    cutoff = datetime.now(timezone.utc)
    for h in holds.values():
        if h.status == "active" and h.expires_at <= cutoff:
            h.status = "expired"


def _booked_players(d: date, t: time) -> int:
    ds, ts = sheet_date(d), sheet_time(t)
    total = 0
    for b in tee_sheet.bookings:
        if b.date != ds or b.time != ts or b.status == BookingStatus.CANCELLED:
            continue
        if b.status == BookingStatus.BLOCKED:
            return CAPACITY
        total += sum(1 for p in b.players if not p.cancelled) or 1
    return total


def _held_players(d: date, t: time, exclude: str | None = None) -> int:
    return sum(
        h.players
        for h in holds.values()
        if h.status == "active" and h.date == d and h.tee_time == t and h.id != exclude
    )


def spots_left(d: date, t: time) -> int:
    return CAPACITY - _booked_players(d, t) - _held_players(d, t)


# ---------- 도구 동작 ----------

def identify_caller(phone: str | None) -> dict:
    e164 = normalize_phone(phone)
    if not e164:
        return {"known": False}
    latest: tuple[TeeBooking, Player] | None = None
    for b in tee_sheet.bookings:
        for p in b.players:
            if normalize_phone(p.phone) == e164:
                if latest is None or b.updated_at > latest[0].updated_at:
                    latest = (b, p)
    if not latest:
        return {"known": False, "phone": e164}
    b, p = latest
    return {
        "known": True,
        "phone": e164,
        "name": p.name,
        "first_name": p.name.split(" ")[0],
        "is_member": "member" in p.ratePlan.lower(),
        "rate_plan": p.ratePlan,
        "upcoming": [_booking_summary(x) for x in _upcoming_for_phone(e164)][:3],
    }


def check_availability(
    date_str: str,
    earliest: str | None,
    latest: str | None,
    players: int,
    holes: int,
) -> dict:
    if not 1 <= players <= CAPACITY:
        raise BookingError("BAD_PLAYERS", "We can book 1 to 4 players per tee time. For larger groups I'll connect you to the pro shop.")
    d = parse_date(date_str)
    today = now_local().date()
    if d < today:
        raise BookingError("PAST_DATE", "That date has already passed.")
    lo = parse_hhmm(earliest, FIRST_TEE)
    hi = parse_hhmm(latest, LAST_TEE)
    min_start = (now_local() + timedelta(minutes=15)).time() if d == today else time.min
    quote = price_quote(d, holes, players)

    with _lock:
        _expire_holds()
        options = [
            t for t in tee_times()
            if lo <= t <= hi and t >= min_start and spots_left(d, t) >= players
        ]
    picks = options[:3]
    return {
        "date": d.isoformat(),
        "weekday": f"{d:%A}",
        "options": [{"tee_time": sheet_time(t), "tee_time_id": f"{d.isoformat()}T{t:%H:%M}"} for t in picks],
        "more_available": max(0, len(options) - len(picks)),
        "players": players,
        "holes": holes,
        "price": quote,
    }


def hold_slot(tee_time_id: str, players: int, holes: int, carts: int, caller: str | None, conversation_id: str | None) -> Hold:
    try:
        dt = datetime.fromisoformat(tee_time_id)
    except ValueError:
        raise BookingError("BAD_TEE_TIME", "That tee time isn't valid. Please check availability again.")
    d, t = dt.date(), dt.time()
    if t not in tee_times():
        raise BookingError("BAD_TEE_TIME", "That isn't one of our tee times.")
    price_quote(d, holes, players)

    with _lock:
        _expire_holds()
        # 같은 통화에서 이전에 잡아둔 hold는 풀어준다 (고객이 시간을 바꾼 경우)
        if conversation_id:
            for h in holds.values():
                if h.status == "active" and h.conversation_id == conversation_id:
                    h.status = "released"
        if spots_left(d, t) < players:
            raise BookingError("SLOT_FULL", "Sorry, that tee time was just taken. Let me find another.")
        hold = Hold(
            date=d,
            tee_time=t,
            players=players,
            holes=holes,
            carts=carts,
            caller_e164=normalize_phone(caller),
            conversation_id=conversation_id,
            expires_at=datetime.now(timezone.utc) + HOLD_TTL,
        )
        holds[hold.id] = hold
    return hold


def confirm_booking(hold_id: str, first_name: str, last_name: str, phone: str | None, conversation_id: str | None) -> TeeBooking:
    with _lock:
        _expire_holds()
        hold = holds.get(hold_id)
        if not hold or hold.status != "active":
            raise BookingError("HOLD_EXPIRED", "The hold on that tee time expired. Let me check it again.")
        e164 = normalize_phone(phone) or hold.caller_e164
        if not e164:
            raise BookingError("PHONE_REQUIRED", "I need a mobile number to send your confirmation.")

        first, last = first_name.strip().title(), last_name.strip().title()
        fee = green_fee(hold.date, hold.holes)
        players = [
            Player(name=f"{first} {last}", phone=e164, type=PlayerType.EXISTING, ratePlan="Public")
        ] + [Player(name="Guest", ratePlan="Public") for _ in range(hold.players - 1)]
        booking = TeeBooking(
            date=sheet_date(hold.date),
            time=sheet_time(hold.tee_time),
            dayIndex=hold.date.weekday(),
            title=f"{last}, {first}",
            holes=hold.holes,
            rate=fee,
            cartCount=hold.carts,
            players=players,
            color="gold",
            source="voice_ai",
            ref=f"PH-{next(_ref_counter)}",
            voiceCallId=conversation_id,
        )
        tee_sheet._audit(booking, f"Booked by AI phone agent (hold {hold.id}).")
        tee_sheet.bookings.insert(0, booking)
        hold.status = "confirmed"

    if conversation_id:
        call = voice_calls.setdefault(conversation_id, VoiceCall(conversation_id=conversation_id, caller_e164=e164))
        call.booking_refs.append(booking.ref)
    return booking


def _upcoming_for_phone(e164: str) -> list[TeeBooking]:
    today = now_local().date()
    out = []
    for b in tee_sheet.bookings:
        d = parse_sheet_date(b.date)
        if b.status == BookingStatus.CANCELLED or not d or d < today:
            continue
        if any(normalize_phone(p.phone) == e164 for p in b.players):
            out.append(b)
    return sorted(out, key=lambda b: (parse_sheet_date(b.date), parse_sheet_time(b.time) or time.min))


def norm_ref(ref: str) -> str:
    """'PH 10392', '10392', 'ph-10392' → 'PH-10392'"""
    digits = re.sub(r"\D", "", ref)
    return f"PH-{digits}"


def _booking_summary(b: TeeBooking) -> dict:
    d = parse_sheet_date(b.date)
    return {
        "ref": b.ref or b.id,
        "date": d.isoformat() if d else b.date,
        "weekday": f"{d:%A}" if d else "",
        "tee_time": b.time,
        "players": sum(1 for p in b.players if not p.cancelled),
        "holes": b.holes,
        "carts": b.cartCount,
        "name": b.title,
        "status": b.status.value,
    }


def find_bookings(phone: str | None, ref: str | None) -> list[dict]:
    if ref:
        ref_norm = norm_ref(ref)
        return [_booking_summary(b) for b in tee_sheet.bookings if b.ref == ref_norm]
    e164 = normalize_phone(phone)
    return [_booking_summary(b) for b in _upcoming_for_phone(e164)] if e164 else []


def cancel_booking(ref: str, phone: str | None, reason: str) -> TeeBooking:
    """예약번호 + 예약자 전화번호가 모두 맞아야 취소합니다 (발신번호 위장 대비)."""
    e164 = normalize_phone(phone)
    with _lock:
        target = next((b for b in tee_sheet.bookings if b.ref == norm_ref(ref)), None)
        if not target:
            raise BookingError("NOT_FOUND", "I couldn't find a booking with that confirmation number.")
        if not e164 or not any(normalize_phone(p.phone) == e164 for p in target.players):
            raise BookingError("PHONE_MISMATCH", "That booking isn't under this phone number. I'll connect you to the pro shop.")
        if target.status == BookingStatus.CANCELLED:
            raise BookingError("ALREADY_CANCELLED", "That booking is already cancelled.")
        target.status = BookingStatus.CANCELLED
        target.cancelReason = reason
        for p in target.players:
            p.cancelled = True
        tee_sheet._audit(target, f"Cancelled by customer ({reason}).")
    return target


def join_waitlist(date_str: str, earliest: str | None, latest: str | None, players: int, phone: str | None, name: str) -> WaitlistEntry:
    e164 = normalize_phone(phone)
    if not e164:
        raise BookingError("PHONE_REQUIRED", "I need a mobile number so we can text you when a spot opens.")
    entry = WaitlistEntry(
        date=parse_date(date_str),
        earliest=parse_hhmm(earliest, FIRST_TEE),
        latest=parse_hhmm(latest, LAST_TEE),
        players=players,
        phone_e164=e164,
        name=name,
    )
    waitlist.append(entry)
    return entry


# ---------- 문자 ----------

def _fmt_when(b: TeeBooking) -> str:
    d = parse_sheet_date(b.date)
    return f"{d:%a %b} {d.day}, {b.time}" if d else f"{b.date}, {b.time}"


def _primary_phone(b: TeeBooking) -> str | None:
    return next((normalize_phone(p.phone) for p in b.players if normalize_phone(p.phone)), None)


async def send_confirmation(b: TeeBooking) -> None:
    phone = _primary_phone(b)
    if not phone:
        return
    d = parse_sheet_date(b.date)
    quote = price_quote(d, b.holes, len(b.players)) if d and green_fee(d, b.holes) else None
    carts = f" · {b.cartCount} cart{'s' if b.cartCount != 1 else ''}" if b.cartCount else ""
    total = f" Green fees ${quote['total_incl_tax']:.2f} incl. HST, paid at check-in." if quote else ""
    body = (
        f"Pelham Hills: {_fmt_when(b)} · {len(b.players)} players · {b.holes} holes{carts}. "
        f"Ref {b.ref}.{total} Reply C to cancel."
    )
    await send_sms(phone, body, template="confirm", booking_ref=b.ref)


async def send_cancellation(b: TeeBooking) -> None:
    phone = _primary_phone(b)
    if phone:
        await send_sms(phone, f"Pelham Hills: cancelled {b.ref} ({_fmt_when(b)}). Hope to see you soon.", template="cancel", booking_ref=b.ref)
    await notify_waitlist(b)


async def notify_waitlist(freed: TeeBooking) -> None:
    d, t = parse_sheet_date(freed.date), parse_sheet_time(freed.time)
    if not d or not t:
        return
    left = spots_left(d, t)
    for entry in waitlist:
        if entry.notified_at or entry.date != d or not (entry.earliest <= t <= entry.latest) or entry.players > left:
            continue
        entry.notified_at = datetime.now(timezone.utc)
        await send_sms(
            entry.phone_e164,
            f"Pelham Hills: a {freed.time} spot for {entry.players} opened on {d:%a %b} {d.day}! "
            f"Call us or book online to grab it — first come, first served.",
            template="waitlist",
        )
        break


async def run_reminders() -> None:
    """전날 18:00 이후, 티타임 2시간 전 리마인더. 1분마다 호출됩니다."""
    with _lock:
        _expire_holds()
    now = now_local()
    for b in list(tee_sheet.bookings):
        if not b.ref or b.status == BookingStatus.CANCELLED:
            continue
        d, t = parse_sheet_date(b.date), parse_sheet_time(b.time)
        phone = _primary_phone(b)
        if not d or not t or not phone:
            continue
        tee_at = datetime.combine(d, t, tzinfo=COURSE_TZ)
        booked_at = b.audit[-1].ts if b.audit else b.updated_at

        d1_at = datetime.combine(d - timedelta(days=1), time(18, 0), tzinfo=COURSE_TZ)
        if (b.ref, "remind_d1") not in _reminders_sent and d1_at <= now < tee_at - timedelta(hours=3) and booked_at < d1_at:
            _reminders_sent.add((b.ref, "remind_d1"))
            await send_sms(phone, f"Pelham Hills: see you tomorrow at {b.time}! Ref {b.ref}. Reply C to cancel.", template="remind_d1", booking_ref=b.ref)

        h2_at = tee_at - timedelta(hours=2)
        if (b.ref, "remind_2h") not in _reminders_sent and h2_at <= now < tee_at and booked_at < h2_at:
            _reminders_sent.add((b.ref, "remind_2h"))
            await send_sms(phone, f"Pelham Hills: your tee time is at {b.time}. Please check in at the pro shop 15 min early.", template="remind_2h", booking_ref=b.ref)
