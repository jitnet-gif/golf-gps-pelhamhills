"""ElevenLabs 음성 에이전트가 티 시트를 쓰기 위한 도구 계층.

에이전트에게 `/tee-sheet/*` 를 그대로 주지 않는 이유는 세 가지다.

1. **권한.** 통화로 들어온 손님이 리포트를 뽑거나 남의 예약을 지울 수 있으면 안 된다.
   여기 있는 도구는 "빈 시간 찾기 / 잡기 / 반납 / 확정 / 조회 / 취소" 여섯 가지뿐이다.
2. **경합.** 손님이 "3시요" 라고 말하고 이름을 부르는 20초 사이에 웹 손님이 같은
   자리를 살 수 있다. 그래서 확정 전에 `hold` 로 자리를 잠근다.
3. **말투.** LLM 이 읽어 줄 응답은 격자가 아니라 문장이어야 한다. 모든 도구는
   `message` 에 그대로 읽어도 되는 한 문장을 함께 돌려준다.

정원·슬롯·상태 전이의 진실은 전부 `tee_sheet.py` 에 있다. 이 파일은 그 함수들을
부를 뿐 규칙을 다시 구현하지 않는다 — 두 벌이 되는 순간 전화와 웹이 어긋난다.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import re
import secrets
import threading
from datetime import date as date_cls, datetime, timedelta, timezone
from time import monotonic
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from backend.api.routes import tee_sheet as ts
from backend.services import voice_agent
from backend.services.tee_sheet_store import Scope
from backend.services.twilio_sms import send_sms

logger = logging.getLogger(__name__)


# ===== 정책 상수 ======================================================
# 여기 있는 숫자는 전부 "프로 샵이 바꾸고 싶어할 값" 이다. 코드 곳곳에 흩어
# 놓지 않고 한군데 모아 둔다.

#: 손님이 예약할 수 있는 범위. 고객 웹(`/book/tee-time` 의 `DAYS_AHEAD`)과 같은 값.
BOOKING_WINDOW_DAYS = 14

#: 티오프까지 이보다 적게 남았으면 에이전트는 취소하지 못하고 프로 샵으로 넘긴다.
#: 카트 배정과 환불이 걸려 있어 사람이 판단할 구간이다.
CANCEL_CUTOFF_MINUTES = 120

#: 한 번에 읽어 줄 티타임 개수. 전화로 다섯 개 넘게 불러 주면 손님이 못 따라온다.
MAX_OPTIONS = 5

#: 통화 한 건이 부를 수 있는 도구 호출 총량. 폭주한 에이전트가 티 시트를 두드리는
#: 것을 막는 최후의 방어선이다.
MAX_CALLS_PER_CONVERSATION = 80

#: 통화 세션을 기억해 두는 시간. 통화가 끝나고도 한동안 남겨 post-call 웹훅이
#: 같은 세션을 찾을 수 있게 한다.
SESSION_TTL_SECONDS = 2 * 60 * 60

#: 골프장 현지 시간대. "이 티타임이 이미 지났나" 는 UTC 로 판단하면 안 된다 —
#: 온타리오 저녁 8시는 UTC 로 이미 다음 날이다.
CLUB_TIMEZONE = ZoneInfo(os.getenv("CLUB_TIMEZONE", "America/Toronto"))

CLUB_NAME = os.getenv("CLUB_NAME", "Pelham Hills Golf Club")

DayPart = Literal["morning", "afternoon", "evening", "any"]


# ===== 인증 ===========================================================

def _tool_secret() -> str:
    return os.getenv("VOICE_TOOL_SECRET", "").strip()


def require_tool_secret(x_voice_tool_secret: Optional[str] = Header(None)) -> None:
    """에이전트의 웹훅 도구 호출임을 확인한다.

    `VOICE_TOOL_SECRET` 이 비어 있으면 검사를 건너뛴다. 로컬 개발에서 터널을 띄우기
    전에 curl 로 도구를 두드려 볼 수 있어야 하기 때문이다. **배포에서는 반드시
    채울 것** — 이 엔드포인트들은 인증 없이 예약을 만들고 취소할 수 있다.
    """
    expected = _tool_secret()
    if not expected:
        return
    if not x_voice_tool_secret or not secrets.compare_digest(x_voice_tool_secret, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing voice tool secret")


# 라우터가 둘인 이유: 이 파일의 엔드포인트는 **인증 방식이 서로 다르다.**
#
#   tools_router  — 에이전트가 부른다. 공유 시크릿 헤더로 막는다.
#   router        — 브라우저와 ElevenLabs 웹훅이 부른다. 시크릿을 가질 수 없다.
#
# 한 라우터에 시크릿 검사를 걸면 `/voice/session` 도 같이 막힌다. 브라우저는 그
# 시크릿을 알 수 없으므로(알면 시크릿이 아니다) 배포에서 위젯이 조용히 죽는다.
# post-call 웹훅도 마찬가지다 — 그쪽은 `ElevenLabs-Signature` HMAC 으로 검증하지,
# 우리 헤더를 보내지 않는다.
#
# 도구는 tools_router 에만 단다. 검사를 라우터 레벨에 걸어 두면 나중에 도구를
# 추가하면서 인증을 빠뜨릴 수 없다.
tools_router = APIRouter(dependencies=[Depends(require_tool_secret)])
router = APIRouter()


# ===== 웹 세션 발급 제한 ==============================================
#
# `/voice/session` 은 시크릿 없이 열려 있어야 하고(브라우저가 시크릿을 가질 수
# 없다), 호출 한 번이 ElevenLabs 대화 크레딧을 태울 수 있는 티켓을 만든다.
# 통화별 도구 호출 상한(`MAX_CALLS_PER_CONVERSATION`)은 여기에 닿지 않으므로,
# 이 엔드포인트만 따로 막는다.

SESSION_RATE_LIMIT = 10
SESSION_RATE_WINDOW_SECONDS = 60

_session_hits: dict[str, list[float]] = {}
_session_rate_lock = threading.Lock()


def _check_session_rate(caller: str) -> None:
    now = monotonic()
    cutoff = now - SESSION_RATE_WINDOW_SECONDS

    with _session_rate_lock:
        for key in [k for k, hits in _session_hits.items() if not hits or hits[-1] < cutoff]:
            del _session_hits[key]

        hits = [hit for hit in _session_hits.get(caller, []) if hit >= cutoff]
        hits.append(now)
        _session_hits[caller] = hits
        over_limit = len(hits) > SESSION_RATE_LIMIT

    if over_limit:
        raise HTTPException(
            status_code=429,
            detail="Too many voice sessions from here. Please wait a minute and try again.",
        )


# ===== 통화 세션 ======================================================
#
# 왜 필요한가: `cancel_booking` 이 booking_id 만 믿으면, 에이전트가 (혹은 이
# 엔드포인트를 직접 두드리는 누군가가) 아무 id 나 넣어 남의 예약을 취소할 수 있다.
# 그래서 "이 통화에서 조회로 확인된 예약" 만 취소 대상이 되게 묶어 둔다.

class _Session:
    __slots__ = ("conversation_id", "created_at", "last_seen", "revealed", "holds", "calls")

    def __init__(self, conversation_id: str) -> None:
        now = datetime.now(timezone.utc)
        self.conversation_id = conversation_id
        self.created_at = now
        self.last_seen = now
        self.revealed: set[str] = set()   # 조회로 손님에게 확인된 booking_id
        self.holds: set[str] = set()      # 이 통화가 잡은 홀드 id
        self.calls = 0


_sessions: dict[str, _Session] = {}
_sessions_lock = threading.Lock()


def _touch_session(conversation_id: str | None) -> _Session | None:
    """세션을 찾거나 만들고 호출 횟수를 센다. conversation_id 가 없으면 None."""
    if not conversation_id:
        return None

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)

    with _sessions_lock:
        for stale in [k for k, v in _sessions.items() if v.last_seen < cutoff]:
            del _sessions[stale]

        session = _sessions.get(conversation_id)
        if session is None:
            session = _Session(conversation_id)
            _sessions[conversation_id] = session

        session.last_seen = now
        session.calls += 1
        if session.calls > MAX_CALLS_PER_CONVERSATION:
            raise HTTPException(
                status_code=429,
                detail="This call has made too many booking requests. Transfer to the pro shop.",
            )
        return session


# ===== 날짜 · 시간 헬퍼 ================================================

def club_now() -> datetime:
    return datetime.now(CLUB_TIMEZONE)


def today_iso() -> str:
    return club_now().date().isoformat()


_RELATIVE_DATES = {
    "today": 0,
    "tonight": 0,
    "tomorrow": 1,
}


def resolve_date(value: str) -> str:
    """에이전트가 준 날짜를 ISO 로 확정한다.

    LLM 은 오늘 날짜를 모르면 지어낸다. 프롬프트에 `today_iso` 를 dynamic variable
    로 주입하지만, 그래도 "tomorrow" 를 그대로 흘려보내는 경우가 있어 여기서 한 번
    더 받아 준다. 그 외의 자연어는 거절하고 **에이전트가 다시 물어보게** 한다 —
    "next Tuesday" 를 서버가 추측했다가 틀리면 손님이 엉뚱한 날에 온다.
    """
    text = (value or "").strip().lower()
    if not text:
        raise HTTPException(status_code=422, detail="A date is required, as YYYY-MM-DD.")

    if text in _RELATIVE_DATES:
        return (club_now().date() + timedelta(days=_RELATIVE_DATES[text])).isoformat()

    if not ts.ISO_DATE_RE.match(text):
        raise HTTPException(
            status_code=422,
            detail=(
                "Ask the caller for the date again and send it as YYYY-MM-DD "
                f"(today is {today_iso()})."
            ),
        )
    try:
        date_cls.fromisoformat(text)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{value} is not a real date.") from None
    return text


def spoken_date(iso_date: str) -> str:
    """2026-09-10 -> "Thursday, September 10". 에이전트가 그대로 읽는다."""
    day = date_cls.fromisoformat(iso_date)
    return f"{day.strftime('%A')}, {day.strftime('%B')} {day.day}"


def require_bookable_date(iso_date: str) -> None:
    """예약 가능한 창(오늘 ~ +14일) 안인지. 밖이면 에이전트가 읽을 문장으로 거절한다."""
    today = club_now().date()
    day = date_cls.fromisoformat(iso_date)
    if day < today:
        raise HTTPException(status_code=422, detail=f"{spoken_date(iso_date)} is in the past.")

    furthest = today + timedelta(days=BOOKING_WINDOW_DAYS)
    if day > furthest:
        raise HTTPException(
            status_code=422,
            detail=(
                f"We only take bookings {BOOKING_WINDOW_DAYS} days out. The furthest date "
                f"available is {spoken_date(furthest.isoformat())}."
            ),
        )


def day_part_of(minutes: int) -> str:
    """`components/booking/availability.ts` 의 `dayPartOf` 와 같은 경계."""
    if minutes < 12 * 60:
        return "morning"
    if minutes < 16 * 60:
        return "afternoon"
    return "evening"


def slot_datetime(iso_date: str, time_label: str) -> datetime | None:
    """슬롯의 골프장 현지 시각. 파싱 실패면 None."""
    minutes = ts.label_to_minutes(time_label)
    if minutes is None:
        return None
    day = date_cls.fromisoformat(iso_date)
    # 자정에 timedelta 를 더하지 않는다. aware datetime 의 덧셈은 벽시계 기준이라
    # 결과의 UTC 오프셋이 자정 것으로 남고, 서머타임이 바뀌는 이틀 동안 한 시간
    # 어긋난다. 시/분으로 직접 만들면 zoneinfo 가 그날의 오프셋을 제대로 고른다.
    hour, minute = divmod(minutes, 60)
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=CLUB_TIMEZONE)


def normalize_phone(value: str) -> str:
    """비교용 정규화: 숫자만 남기고 뒤에서 10자리.

    손님은 "905-892-1234", "(905) 892 1234", "+1 905 892 1234" 를 다 말한다.
    저장은 손님이 말한 그대로 하되 대조는 이 값으로 한다.
    """
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else digits


# ===== 요청 · 응답 모델 ================================================

class _VoiceRequest(BaseModel):
    """모든 도구가 공유하는 필드. ElevenLabs 가 통화마다 값을 채워 보낸다."""

    conversation_id: str | None = Field(
        default=None,
        description="ElevenLabs conversation id. 취소 권한을 이 통화에 묶는 데 쓴다.",
    )


class FindTeeTimesRequest(_VoiceRequest):
    date: str = Field(..., description="ISO date (YYYY-MM-DD), or 'today' / 'tomorrow'.")
    party_size: int = Field(..., ge=1, le=ts.PLAYERS_PER_TEE_TIME)
    day_part: DayPart = "any"


class TeeTimeOption(BaseModel):
    time: str
    day_part: str
    seats_open: int
    rate: float


class FindTeeTimesResponse(BaseModel):
    ok: bool
    date: str
    spoken_date: str
    party_size: int
    total_open: int
    options: list[TeeTimeOption]
    message: str


class HoldRequest(_VoiceRequest):
    date: str
    time: str = Field(..., description="Exactly one of the time labels find_tee_times returned.")
    party_size: int = Field(..., ge=1, le=ts.PLAYERS_PER_TEE_TIME)


class HoldResponse(BaseModel):
    ok: bool
    hold_id: str
    date: str
    spoken_date: str
    time: str
    party_size: int
    rate: float
    expires_in_seconds: int
    message: str


class ReleaseHoldRequest(_VoiceRequest):
    hold_id: str


class ReleaseHoldResponse(BaseModel):
    ok: bool
    released: bool
    message: str


class ConfirmRequest(_VoiceRequest):
    hold_id: str
    first_name: str = Field(..., min_length=1, max_length=60)
    last_name: str = Field(..., min_length=1, max_length=60)
    phone: str = Field(..., min_length=7, max_length=40)
    holes: Literal[9, 18] = 18


class BookingSummary(BaseModel):
    booking_id: str
    confirmation_code: str
    date: str
    spoken_date: str
    time: str
    party_size: int
    holes: int
    rate: float
    name: str
    status: str


class ConfirmResponse(BaseModel):
    ok: bool
    booking: BookingSummary
    message: str


class LookupRequest(_VoiceRequest):
    phone: str = Field(..., min_length=7, max_length=40)
    last_name: str = Field(..., min_length=1, max_length=60)


class LookupResponse(BaseModel):
    ok: bool
    found: int
    bookings: list[BookingSummary]
    message: str


class CancelRequest(_VoiceRequest):
    booking_id: str
    last_name: str = Field(..., min_length=1, max_length=60)
    reason: str = Field(default="Caller asked to cancel.", max_length=200)


class CancelResponse(BaseModel):
    ok: bool
    booking_id: str
    date: str
    spoken_date: str
    time: str
    message: str


# ===== 공용 내부 헬퍼 ==================================================

def _confirmation_code(booking_id: str) -> str:
    """손님에게 불러 줄 짧은 코드. id 에서 결정론적으로 뽑는다 (따로 저장하지 않는다)."""
    return re.sub(r"[^A-Z0-9]", "", booking_id.upper())[-6:].rjust(6, "0")


def _summary(booking: ts.TeeBooking) -> BookingSummary:
    active = [p for p in booking.players if not p.cancelled] or booking.players
    return BookingSummary(
        booking_id=booking.id,
        confirmation_code=_confirmation_code(booking.id),
        date=booking.date,
        spoken_date=spoken_date(booking.date),
        time=booking.time,
        party_size=len(booking.players),
        holes=booking.holes,
        rate=booking.rate,
        name=active[0].name if active else booking.title,
        status=booking.status.value,
    )


def _blocked_times(bookings: list[ts.TeeBooking], iso_date: str) -> set[str]:
    """대회·정비로 막아 둔 티타임.

    서버는 `blocked` 예약이 걸린 슬롯에도 POST 를 허용한다 (플레이어가 0명이라
    정원이 비어 보인다). 고객 웹이 이걸 숨기고 있으므로 전화도 똑같이 숨긴다.
    """
    return {
        b.time for b in bookings
        if b.date == iso_date and b.status == ts.BookingStatus.BLOCKED
    }


def _spread(options: list[TeeTimeOption], count: int) -> list[TeeTimeOption]:
    """열려 있는 티타임이 많을 때 하루에 고르게 퍼진 몇 개만 고른다.

    앞에서부터 자르면 6:40, 6:49, 6:58 … 처럼 9분 간격 연속 슬롯만 읽어 주게 되어
    손님에게는 사실상 선택지가 하나다. 첫 번째와 마지막을 포함해 균등 추출한다.
    """
    if len(options) <= count:
        return options
    step = (len(options) - 1) / (count - 1)
    return [options[round(index * step)] for index in range(count)]


def _require_open_slot(
    bookings: list[ts.TeeBooking], iso_date: str, time_label: str, party_size: int
) -> ts.TeeSlot:
    """손님에게 팔아도 되는 슬롯인지 전부 검사하고 슬롯을 돌려준다.

    `require_tee_time_capacity` 가 보지 않는 두 가지(막힌 슬롯 / 지나간 시각)를
    여기서 추가로 막는다. 규칙은 고객 웹(`buildOpenTeeTimes`)과 같아야 한다.
    """
    slot = ts.require_slot(iso_date, time_label)

    if time_label in _blocked_times(bookings, iso_date):
        raise HTTPException(
            status_code=409,
            detail=f"{time_label} on {spoken_date(iso_date)} is closed for an event.",
        )

    at = slot_datetime(iso_date, time_label)
    if at is not None and at <= club_now():
        raise HTTPException(status_code=409, detail=f"{time_label} has already passed today.")

    ts.require_tee_time_capacity(bookings, iso_date, time_label, incoming=party_size)
    return slot


# ===== 도구 1: 빈 티타임 찾기 ==========================================

@tools_router.post("/voice/tools/find-tee-times", response_model=FindTeeTimesResponse)
def find_tee_times(body: FindTeeTimesRequest) -> FindTeeTimesResponse:
    _touch_session(body.conversation_id)
    iso_date = resolve_date(body.date)
    require_bookable_date(iso_date)

    now = club_now()
    utc_now = datetime.now(timezone.utc)
    # 그날만 읽는다. 컴프리헨션으로 다시 거르지 않는다 — 평범한 list 가 되면 읽은
    # 범위가 떨어져 `tee_time_players` 가 받지 않는다.
    bookings = ts.read_bookings(Scope(dates={iso_date}))
    blocked = _blocked_times(bookings, iso_date)

    options: list[TeeTimeOption] = []
    for slot in ts.generate_slots(iso_date):
        if slot.time in blocked:
            continue

        at = slot_datetime(iso_date, slot.time)
        if at is not None and at <= now:
            continue

        part = day_part_of(slot.minutes)
        if body.day_part != "any" and part != body.day_part:
            continue

        seats = ts.PLAYERS_PER_TEE_TIME - ts.tee_time_players(
            bookings, iso_date, slot.time, now=utc_now
        )
        if seats < body.party_size:
            continue

        options.append(
            TeeTimeOption(time=slot.time, day_part=part, seats_open=seats, rate=slot.rate)
        )

    if not options:
        window = "" if body.day_part == "any" else f" in the {body.day_part}"
        return FindTeeTimesResponse(
            ok=False,
            date=iso_date,
            spoken_date=spoken_date(iso_date),
            party_size=body.party_size,
            total_open=0,
            options=[],
            message=(
                f"Nothing is open for {body.party_size} on {spoken_date(iso_date)}{window}. "
                "Offer the caller a different day or a different part of the day."
            ),
        )

    picked = _spread(options, MAX_OPTIONS)
    times = ", ".join(option.time for option in picked)
    return FindTeeTimesResponse(
        ok=True,
        date=iso_date,
        spoken_date=spoken_date(iso_date),
        party_size=body.party_size,
        total_open=len(options),
        options=picked,
        message=(
            f"{len(options)} tee times are open for {body.party_size} on "
            f"{spoken_date(iso_date)}. Read a few of these to the caller: {times}. "
            f"The rate is ${picked[0].rate:.2f} per player."
        ),
    )


# ===== 도구 2: 자리 잡기 (홀드) ========================================

@tools_router.post("/voice/tools/hold-tee-time", response_model=HoldResponse)
def hold_tee_time(body: HoldRequest) -> HoldResponse:
    session = _touch_session(body.conversation_id)
    iso_date = resolve_date(body.date)
    require_bookable_date(iso_date)
    time_label = body.time.strip()

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ts.HOLD_TTL_SECONDS)

    # 그날(정원 검사) + 날짜 무관 홀드(아래 purge 가 예전처럼 전부 걷는다).
    with ts.bookings_tx(Scope(dates={iso_date}, holds=True)) as bookings:
        ts.purge_expired_holds(bookings)
        slot = _require_open_slot(bookings, iso_date, time_label, body.party_size)

        # 홀드는 **진짜 예약 레코드**다. 그래야 `tee_time_players` 가 이 자리를
        # 찬 것으로 세고, 웹 손님에게 같은 자리가 보이지 않는다.
        hold = ts.TeeBooking(
            date=iso_date,
            time=time_label,
            title="Phone hold",
            rate=slot.rate,
            color="gray",
            status=ts.BookingStatus.RESERVED,
            source=ts.BookingSource.VOICE_HOLD,
            holdExpiresAt=expires_at,
            notes="Held by the phone assistant while the caller gives their name.",
            players=[ts.Player(name="Guest", ratePlan="Public") for _ in range(body.party_size)],
        )
        ts._audit(hold, f"Phone assistant held {body.party_size} seats at {time_label}.")
        bookings.append(hold)

        hold_id = hold.id
        rate = hold.rate

    if session is not None:
        session.holds.add(hold_id)

    return HoldResponse(
        ok=True,
        hold_id=hold_id,
        date=iso_date,
        spoken_date=spoken_date(iso_date),
        time=time_label,
        party_size=body.party_size,
        rate=rate,
        expires_in_seconds=ts.HOLD_TTL_SECONDS,
        message=(
            f"{time_label} on {spoken_date(iso_date)} is held for {body.party_size}. "
            "Get the caller's first name, last name, and phone number, then confirm within "
            f"{ts.HOLD_TTL_SECONDS // 60} minutes."
        ),
    )


# ===== 도구 3: 홀드 반납 ===============================================

@tools_router.post("/voice/tools/release-hold", response_model=ReleaseHoldResponse)
def release_hold(body: ReleaseHoldRequest) -> ReleaseHoldResponse:
    """손님이 마음을 바꾸면 즉시 자리를 돌려놓는다.

    TTL 을 기다려도 결과는 같지만, 그동안 그 자리는 아무도 못 산다. 통화 중에
    "역시 다른 날로 할게요" 는 흔한 전개라 명시적으로 반납한다.
    """
    _touch_session(body.conversation_id)

    with ts.bookings_tx(Scope(ids={body.hold_id}, holds=True)) as bookings:
        ts.purge_expired_holds(bookings)
        before = len(bookings)
        bookings[:] = [
            b for b in bookings
            if not (b.id == body.hold_id and b.source == ts.BookingSource.VOICE_HOLD)
        ]
        released = len(bookings) != before

    return ReleaseHoldResponse(
        ok=True,
        released=released,
        message=(
            "The tee time is back on the sheet."
            if released
            else "That hold was already gone; there is nothing to release."
        ),
    )


# ===== 도구 4: 예약 확정 ===============================================

@tools_router.post("/voice/tools/confirm-booking", response_model=ConfirmResponse)
def confirm_booking(body: ConfirmRequest, background: BackgroundTasks) -> ConfirmResponse:
    session = _touch_session(body.conversation_id)

    first = body.first_name.strip()
    last = body.last_name.strip()
    phone = body.phone.strip()

    if not normalize_phone(phone):
        raise HTTPException(
            status_code=422,
            detail="That phone number did not come through. Ask the caller to repeat it.",
        )

    # 인원을 늘리지 않는다 (홀드가 이미 자리를 잡고 있다) → 그 홀드 하나만 읽는다.
    with ts.bookings_tx(Scope(ids={body.hold_id})) as bookings:
        hold = next((b for b in bookings if b.id == body.hold_id), None)

        if hold is None or hold.source != ts.BookingSource.VOICE_HOLD:
            raise HTTPException(
                status_code=404,
                detail="That hold no longer exists. Search for open tee times again.",
            )

        if ts.hold_expired(hold, datetime.now(timezone.utc)):
            # 자리는 이미 정원 계산에서 빠져 있다. 레코드만 치우고 다시 잡게 한다.
            bookings[:] = [b for b in bookings if b.id != hold.id]
            raise HTTPException(
                status_code=409,
                detail=(
                    "The hold expired. Tell the caller you need to check again, then search "
                    "and hold the tee time once more."
                ),
            )

        party_size = len(hold.players)

        # 첫 자리는 전화한 손님. 나머지는 이름을 모르는 동반자라 Guest 로 둔다 —
        # 프로 샵이 체크인 때 채운다.
        hold.players = [
            ts.Player(
                firstName=first, lastName=last, phone=phone,
                type=ts.PlayerType.EXISTING, ratePlan="Public",
            ),
            *[ts.Player(name="Guest", ratePlan="Public") for _ in range(party_size - 1)],
        ]
        hold.title = f"{last}, {first}".strip(", ")
        hold.holes = body.holes
        hold.color = "blue"
        hold.source = ts.BookingSource.VOICE
        hold.holdExpiresAt = None
        hold.notes = "Booked by phone with the voice assistant."
        ts._audit(
            hold, f"Phone assistant confirmed {party_size} players for {first} {last} ({phone})."
        )
        summary = _summary(hold)

    if session is not None:
        session.holds.discard(body.hold_id)
        # 방금 만든 예약은 같은 통화에서 취소할 수 있어야 한다 (손님이 말을 바꾸는 경우).
        session.revealed.add(summary.booking_id)

    players_word = "player" if summary.party_size == 1 else "players"
    # 확인 문자. 응답이 나간 뒤에 보낸다 — Twilio 가 느려도 에이전트가 기다리지 않게.
    # 취소 답장에 코드를 요구하는 이유는 `routes/sms.py` 참고.
    background.add_task(
        send_sms,
        phone,
        (
            f"{CLUB_NAME}: booked {summary.party_size} {players_word}, {summary.spoken_date} at "
            f"{summary.time}. Code {summary.confirmation_code}. "
            f"Reply C {summary.confirmation_code} to cancel."
        ),
        template="confirm",
        booking_ref=summary.confirmation_code,
    )
    return ConfirmResponse(
        ok=True,
        booking=summary,
        message=(
            f"Booked. {first} {last}, {summary.party_size} {players_word} at {summary.time} on "
            f"{summary.spoken_date}. Read back the confirmation code "
            f"{summary.confirmation_code} one character at a time."
        ),
    )


# ===== 도구 5: 예약 조회 ===============================================

@tools_router.post("/voice/tools/lookup-booking", response_model=LookupResponse)
def lookup_booking(body: LookupRequest) -> LookupResponse:
    """전화번호 **와** 성이 둘 다 맞아야 예약을 보여준다.

    열쇠를 두 개 요구하는 것이 취소 안전장치의 첫 단계다. 전화번호 하나만으로
    조회가 되면, 번호를 아는 누구나 남의 라운드를 취소할 수 있다.
    """
    session = _touch_session(body.conversation_id)

    wanted_phone = normalize_phone(body.phone)
    wanted_last = body.last_name.strip().casefold()
    if not wanted_phone:
        raise HTTPException(
            status_code=422,
            detail="That phone number did not come through. Ask the caller to repeat it.",
        )

    today = today_iso()
    now = datetime.now(timezone.utc)

    matches: list[ts.TeeBooking] = []
    # 지난 날짜는 어차피 버린다. 과거 예약 수천 건을 읽지 않게 오늘부터만.
    for booking in ts.read_bookings(Scope(date_from=today)):
        if booking.date < today:
            continue
        if booking.status in (ts.BookingStatus.CANCELLED, ts.BookingStatus.BLOCKED):
            continue
        if booking.source == ts.BookingSource.VOICE_HOLD or ts.hold_expired(booking, now):
            continue
        for player in booking.players:
            if player.cancelled:
                continue
            if normalize_phone(player.phone) != wanted_phone:
                continue
            if player.lastName.strip().casefold() != wanted_last:
                continue
            matches.append(booking)
            break

    if session is not None:
        session.revealed.update(booking.id for booking in matches)

    summaries = [_summary(booking) for booking in matches]

    if not summaries:
        return LookupResponse(
            ok=False,
            found=0,
            bookings=[],
            message=(
                "No upcoming reservation matches that phone number and last name. Offer to "
                "transfer the caller to the pro shop rather than guessing."
            ),
        )

    spoken = "; ".join(
        f"{s.spoken_date} at {s.time} for {s.party_size}" for s in summaries
    )
    word = "reservation" if len(summaries) == 1 else "reservations"
    return LookupResponse(
        ok=True,
        found=len(summaries),
        bookings=summaries,
        message=(
            f"Found {len(summaries)} upcoming {word}: {spoken}. Read the details back and ask "
            "the caller to confirm before changing anything."
        ),
    )


# ===== 도구 6: 예약 취소 ===============================================

@tools_router.post("/voice/tools/cancel-booking", response_model=CancelResponse)
def cancel_booking(body: CancelRequest, background: BackgroundTasks) -> CancelResponse:
    """조회로 확인된 예약만, 티오프 2시간 전까지만 취소한다.

    취소는 되돌리기 어려운 쪽의 동작이라 문을 셋 세워 둔다.
      1. 이 통화에서 `lookup_booking`(또는 `confirm_booking`)이 확인해 준 id 인가.
      2. 손님이 말한 성이 예약에 실제로 있는가.
      3. 티오프까지 `CANCEL_CUTOFF_MINUTES` 이상 남았는가.
    그리고 레코드를 지우지 않는다 — `status=cancelled` 로만 바꾼다. 잘못돼도
    프로 샵이 티 시트에서 되돌릴 수 있어야 한다.
    """
    # 통화를 특정할 수 없으면 취소하지 않는다. `_touch_session(None)` 은 None 을
    # 돌려주므로, "세션이 있으면 검사" 로 쓰면 conversation_id 를 빼는 것만으로
    # 이 문을 통과할 수 있다 — 이 파일에서 가장 중요한 검사가 fail-open 하는 셈이다.
    # 다른 도구들은 세션이 없어도 안전하지만(자리를 찾고 잡는 일뿐이다) 취소는 아니다.
    NEEDS_LOOKUP = (
        "Look the reservation up first with the caller's phone number and last name. "
        "Only a reservation confirmed on this call can be cancelled."
    )

    session = _touch_session(body.conversation_id)
    if session is None or body.booking_id not in session.revealed:
        raise HTTPException(status_code=403, detail=NEEDS_LOOKUP)

    wanted_last = body.last_name.strip().casefold()

    # 취소는 자리를 돌려줄 뿐이라 정원을 셀 필요가 없다 → 그 예약 하나만.
    with ts.bookings_tx(Scope(ids={body.booking_id})) as bookings:
        booking = next((b for b in bookings if b.id == body.booking_id), None)
        if booking is None or booking.source == ts.BookingSource.VOICE_HOLD:
            raise HTTPException(status_code=404, detail="That reservation is not on the sheet.")

        if booking.status == ts.BookingStatus.CANCELLED:
            return CancelResponse(
                ok=True,
                booking_id=booking.id,
                date=booking.date,
                spoken_date=spoken_date(booking.date),
                time=booking.time,
                message="That reservation was already cancelled. There is nothing else to do.",
            )

        caller = next(
            (p for p in booking.players if p.lastName.strip().casefold() == wanted_last), None
        )
        if caller is None:
            raise HTTPException(
                status_code=403,
                detail=(
                    "That last name does not match the reservation. Do not cancel it. Offer to "
                    "transfer the caller to the pro shop."
                ),
            )

        at = slot_datetime(booking.date, booking.time)
        if at is not None and (at - club_now()).total_seconds() / 60 < CANCEL_CUTOFF_MINUTES:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"That tee time is less than {CANCEL_CUTOFF_MINUTES // 60} hours away, so "
                    "the pro shop has to cancel it. Transfer the caller."
                ),
            )

        message = ts._apply_status(
            booking, ts.BookingStatus.CANCELLED, f"{body.reason.strip()} (phone assistant)"
        )
        ts._audit(booking, message)
        iso_date, time_label = booking.date, booking.time

    if caller.phone:
        background.add_task(
            send_sms,
            caller.phone,
            f"{CLUB_NAME}: cancelled your tee time, {spoken_date(iso_date)} at {time_label}.",
            template="cancel",
            booking_ref=_confirmation_code(body.booking_id),
        )

    return CancelResponse(
        ok=True,
        booking_id=body.booking_id,
        date=iso_date,
        spoken_date=spoken_date(iso_date),
        time=time_label,
        message=(
            f"Cancelled: {spoken_date(iso_date)} at {time_label}. Tell the caller it is done "
            "and that the seats are back on the sheet."
        ),
    )


# 도구 라우터를 합친다. `include_router` 는 tools_router 의 의존성(시크릿 검사)을
# 그대로 들고 오므로, `main.py` 는 지금처럼 `voice.router` 하나만 달면 된다.
router.include_router(tools_router)


# ===== 웹 위젯 세션 ====================================================

class SessionResponse(BaseModel):
    signed_url: str
    agent_id: str


@router.post("/voice/session", response_model=SessionResponse)
async def create_voice_session(request: Request) -> SessionResponse:
    """브라우저가 마이크를 열 때 쓸 signed URL 을 발급한다.

    프론트엔드는 `output: "export"` 정적 사이트라 route handler 가 없다. 이 값을
    만들 수 있는 서버는 여기뿐이고, 그래서 ElevenLabs API 키는 이 프로세스 밖으로
    나가지 않는다.
    """
    _check_session_rate(request.client.host if request.client else "unknown")

    agent = voice_agent.agent_id()
    if not agent:
        raise HTTPException(
            status_code=503,
            detail="No voice agent is configured. Run scripts/elevenlabs_sync_agent.py first.",
        )
    try:
        url = await voice_agent.signed_url(agent)
    except voice_agent.VoiceAgentError as exc:
        # ElevenLabs 가 거절했다 (키 만료 / 잘못된 agent_id / 한도 초과).
        # 브라우저에는 원문을 흘리지 않는다 — 응답 본문에 계정 정보가 섞일 수 있다.
        logger.error("음성 세션 발급 실패: %s", exc)
        raise HTTPException(
            status_code=503, detail="The voice assistant is unavailable right now."
        ) from exc
    return SessionResponse(signed_url=url, agent_id=agent)


# ===== post-call 웹훅 ==================================================

def _verify_webhook(raw: bytes, signature_header: str | None) -> None:
    """ElevenLabs post-call 웹훅 서명 검증 (`t=<ts>,v0=<hex hmac>`).

    시크릿이 설정돼 있지 않으면 검증을 건너뛴다. 이 웹훅은 예약을 만들지 않고
    감사 로그만 남기므로, 검증 없이 받는 최악은 "가짜 메모가 붙는다" 다.
    """
    secret = os.getenv("ELEVENLABS_WEBHOOK_SECRET", "").strip()
    if not secret:
        return
    if not signature_header:
        raise HTTPException(status_code=401, detail="Missing webhook signature")

    parts = dict(
        piece.split("=", 1) for piece in signature_header.split(",") if "=" in piece
    )
    timestamp, provided = parts.get("t"), parts.get("v0")
    if not timestamp or not provided:
        raise HTTPException(status_code=401, detail="Malformed webhook signature")

    expected = hmac.new(
        secret.encode("utf-8"), f"{timestamp}.".encode("utf-8") + raw, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, provided):
        raise HTTPException(status_code=401, detail="Bad webhook signature")


@router.post("/voice/post-call")
async def post_call(
    request: Request, elevenlabs_signature: Optional[str] = Header(None)
) -> dict[str, Any]:
    """통화가 끝나면 그 사실을 예약의 감사 로그에 남긴다.

    프로 샵이 티 시트에서 "이 예약은 8시 12분 전화로 들어왔고, 통화는 이만큼
    걸렸다" 를 볼 수 있어야 나중에 분쟁이 났을 때 되짚을 수 있다.
    """
    raw = await request.body()
    _verify_webhook(raw, elevenlabs_signature)

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body was not JSON") from None

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body was not a JSON object")

    data = payload.get("data")
    data = data if isinstance(data, dict) else payload

    conversation_id = str(data.get("conversation_id") or "")
    metadata = data.get("metadata")
    duration = metadata.get("call_duration_secs") if isinstance(metadata, dict) else None

    with _sessions_lock:
        session = _sessions.get(conversation_id)
        booking_ids = set(session.revealed) if session else set()

    if not booking_ids:
        return {"ok": True, "annotated": 0}

    note = f"Phone call {conversation_id} ended"
    if isinstance(duration, (int, float)):
        note += f" after {int(duration)} seconds"
    note += "."

    def annotate() -> int:
        annotated = 0
        with ts.bookings_tx(Scope(ids=booking_ids)) as bookings:
            for booking in bookings:
                if booking.id in booking_ids:
                    ts._audit(booking, note)
                    annotated += 1
        return annotated

    # 저장소가 Supabase 면 이 트랜잭션은 네트워크 왕복이다. async 핸들러에서 그대로
    # 돌리면 그동안 이벤트 루프 전체(다른 통화의 웹훅, 음성 세션 발급)가 멈춘다.
    annotated = await asyncio.to_thread(annotate)
    return {"ok": True, "annotated": annotated}
