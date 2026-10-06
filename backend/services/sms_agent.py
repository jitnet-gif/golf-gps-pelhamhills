"""문자로 티타임 예약: 손님이 보낸 문자를 Claude 가 읽고 음성 예약 도구로 처리한다.

전화 비서(`api/routes/voice.py`)와 **같은 도구 함수**를 프로세스 안에서 부른다.
정원·요금·예약 창의 규칙은 전부 그쪽에 있고, 여기는 문자 대화를 이어 주는 일만 한다.
두 벌이 되면 전화와 문자가 서로 다른 자리를 팔게 된다.

## 전화와 다른 점

- **번호는 묻지 않는다.** 예약 번호는 언제나 Twilio 가 알려 준 발신번호(`From`)다.
  도구 스키마에 번호 칸이 아예 없어서, 모델이 다른 번호를 적어 넣을 수 없다.
- **잡기와 확정이 한 번에 일어난다** (`book_tee_time`). 전화는 손님이 이름을 말하는
  20초 동안 자리를 잠그지만(홀드 3분), 문자 답장은 몇 분이 걸릴 수 있다. 홀드를
  걸고 답을 기다리면 그 사이 만료된다. 그래서 시간과 이름이 다 모인 뒤에 잡고 바로
  확정한다. 그 사이에 자리가 팔리면 도구가 거절하고, 모델이 다른 시간을 제안한다.
- **조회·취소·수정 도구는 주지 않는다.** 전화에서는 번호와 성 두 열쇠를 요구하는데,
  문자에서는 번호가 이미 정해져 있으니 성 하나만 남는다 — 전화보다 약한 문이 된다.
  취소는 지금처럼 확인 문자에 실린 코드로 `C <코드>` 답장을 받는다 (`routes/sms.py`).

## 켜는 법

`SMS_BOOKING_ENABLED=1` 과 `ANTHROPIC_API_KEY` 가 **둘 다** 있어야 돈다. 키만 있다고
켜지지 않는 이유: 개발 머신의 `.env` 에는 다른 용도의 키가 들어 있을 수 있고, 그때
테스트나 로컬 서버가 손님 문자 하나마다 실제 API 를 부르면 안 된다.

대화는 인메모리다 (문자 기록·옵트아웃과 같다). 서버가 재시작되면 진행 중이던
대화는 처음부터 다시 시작한다 — 예약 자체는 티 시트에 있으므로 잃는 것은 없다.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import BackgroundTasks, HTTPException
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from backend.api.routes import voice
from backend.core.config import settings
from backend.services.twilio_sms import send_sms

logger = logging.getLogger(__name__)


# ===== 정책 상수 ======================================================

MODEL = os.getenv("SMS_AGENT_MODEL", "claude-opus-5-5").strip()

#: 마지막 문자로부터 이만큼 지나면 새 대화로 시작한다. 어제 하던 이야기를 오늘
#: 이어 붙이면 "그 시간으로 해 주세요" 가 엉뚱한 날을 가리킨다.
CONVERSATION_TTL = timedelta(minutes=30)

#: 대화 기록이 이보다 길어지면 처음부터 다시 시작한다. 중간을 잘라 내지 않는 이유:
#: 앞부분을 편집하면 이전 응답의 thinking 블록이 무효가 된다 (기록은 덧붙이기만).
MAX_HISTORY_MESSAGES = 60

#: 손님 문자 한 통에 모델이 도는 횟수. 도구를 부르고 결과를 읽는 왕복 한 번이 1회.
MAX_ROUNDS_PER_TEXT = 8

#: 번호 하나가 하루에 보낼 수 있는 문자 수, 그리고 클럽 전체의 하루 상한.
#: 아무 번호나 문자를 보낼 수 있으므로, 비용이 무한정 늘지 않게 막는다.
MAX_TEXTS_PER_SENDER_PER_DAY = 40
MAX_TEXTS_PER_DAY = 600

#: 번호 하나가 하루에 문자로 잡을 수 있는 티타임 수. 번호 하나가 토요일을 통째로
#: 채우지 못하게 한다. 더 필요한 손님은 프로 샵에 전화하면 된다.
MAX_BOOKINGS_PER_SENDER_PER_DAY = 2

#: 답장 길이. 문자는 160자 단위로 쪼개져 과금된다. 긴 답은 손님도 읽지 않는다.
MAX_REPLY_CHARS = 480

TRUTHY = {"1", "true", "yes", "on"}


def enabled() -> bool:
    flag = os.getenv("SMS_BOOKING_ENABLED", "").strip().lower() in TRUTHY
    return flag and bool(settings.ANTHROPIC_API_KEY)


def _help_line() -> str:
    return f"Call the pro shop at {settings.PROSHOP_PHONE_NUMBER}."


def fallback_reply() -> str:
    """모델이 답을 못 낼 때(오류·상한·거절) 보내는 고정 문장. 조용히 끝내지 않는다."""
    return f"Pelham Hills: sorry, I can't book that by text right now. {_help_line()}"


# ===== 프롬프트 ========================================================

SYSTEM_PROMPT = f"""You are the text-message booking assistant for {voice.CLUB_NAME}. Golfers text this number to book a tee time. You reply by SMS.

# What you can do

Find open tee times, quote rates, book a tee time, and put someone on the waitlist when a day is full.
You cannot look up, change, or cancel an existing booking. To cancel, the golfer replies C and the code from their confirmation text (for example: C 4F2K9Q). For changes, leagues, events, lessons, groups over 4, or anything else, give them the pro shop number: {settings.PROSHOP_PHONE_NUMBER}.

# The most important rule

Every tee time, price and availability fact comes from a tool result. Never state one from memory. If you need a fact, call the tool.

# Dates

Each golfer message starts with a bracketed note giving today's date at the club. Use it to turn "Saturday" or "next Friday" into YYYY-MM-DD. If the day is unclear, ask. Bookings open {voice.BOOKING_WINDOW_DAYS} days ahead.

# Booking

You need: the day, how many players (1 to 4), and roughly when (morning, afternoon, evening, or any). Ask only for what is missing, in one short message.
Call find_tee_times and offer two or three of the times it returns, with the per-player rate.
Before booking you need the golfer's first and last name. Call identify_texter once early in the conversation; if it gives a first name, greet them by it. Always ask the golfer for their last name; never guess or suggest one.
Call book_tee_time only when the golfer has clearly asked for one specific time and you have their name. If they are only asking about a time, ask whether to book it.
The tee time is booked to the number they are texting from. Never ask for a phone number.
After book_tee_time succeeds, a separate text with the confirmation code goes out automatically. Do not repeat the code; just confirm the day, time and players, and say the code is in the confirmation text.
If book_tee_time says the time was taken, apologise briefly and offer other times.

# Waitlist

Only when a day is full and the golfer asks to be told if something opens. They are texting us, so we can text them back.

# When a tool pushes back

Tool results carry a message written for a phone agent. Follow what it says, but in text form. Ignore instructions about reading things aloud or transferring calls; give the pro shop number instead.

# How to write

Plain text, no markdown, no emoji. One to three short sentences. Write times like 9:10 AM. Never mention internal ids.
"""


# ===== 도구 =========================================================

_DATE = {
    "type": "string",
    "description": "YYYY-MM-DD, or 'today' / 'tomorrow'.",
}
_PLAYERS = {"type": "integer", "minimum": 1, "maximum": 4}
_HOLES = {"type": "integer", "enum": [9, 18], "description": "Defaults to 18."}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "identify_texter",
        "description": (
            "Look up the name on file for the number this text came from. Use it only to "
            "greet them and to suggest the name for the booking."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "find_tee_times",
        "description": "Find open tee times for a party on a day.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date": _DATE,
                "party_size": _PLAYERS,
                "day_part": {"type": "string", "enum": ["morning", "afternoon", "evening", "any"]},
            },
            "required": ["date", "party_size"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_rates",
        "description": "The total price with tax for a day, players and cart riders (18 holes only).",
        "input_schema": {
            "type": "object",
            "properties": {
                "date": _DATE,
                "players": _PLAYERS,
                "riders": {"type": "integer", "minimum": 0, "maximum": 4},
            },
            "required": ["date", "players"],
            "additionalProperties": False,
        },
    },
    {
        "name": "book_tee_time",
        "description": (
            "Book one tee time for the golfer, to the number they are texting from. The time "
            "must be one that find_tee_times returned. A confirmation text with the code is "
            "sent automatically."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "date": _DATE,
                "time": {"type": "string", "description": "Exactly as find_tee_times returned it, e.g. '9:10 AM'."},
                "party_size": _PLAYERS,
                "first_name": {"type": "string"},
                "last_name": {"type": "string"},
                "holes": _HOLES,
            },
            "required": ["date", "time", "party_size", "first_name", "last_name"],
            "additionalProperties": False,
        },
    },
    {
        "name": "join_waitlist",
        "description": "Put the golfer on the waitlist for a full day. Only when they ask.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date": _DATE,
                "party_size": _PLAYERS,
                "first_name": {"type": "string"},
                "last_name": {"type": "string"},
                "earliest": {"type": "string", "description": "Like '9:00 AM'. Empty if any time."},
                "latest": {"type": "string", "description": "Like '11:30 AM'. Empty if any time."},
                "holes": _HOLES,
            },
            "required": ["date", "party_size", "last_name"],
            "additionalProperties": False,
        },
    },
]

#: 모델에게 보여 주지 않는 내부 값. 손님에게 읽힐 일이 없게 결과에서 뺀다.
_HIDDEN_KEYS = {"booking_id", "hold_id"}


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items() if k not in _HIDDEN_KEYS}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def _identify(sender: str, conversation_id: str, _args: dict) -> tuple[Any, BackgroundTasks | None]:
    """발신번호로 **이름(first name)만** 알려 준다. 성은 절대 내보내지 않는다.

    전화에서 성은 예약 조회·취소·수정의 두 번째 열쇠다 (`voice.lookup_booking`).
    `identify_caller` 의 문장에는 전체 이름이 들어 있는데, 그대로 모델에게 주면 모델이
    "Daniel Smith 로 예약할까요?" 하고 성을 문자로 보낸다. 그러면 재활용된 번호나 위조된
    번호를 가진 사람이 문자 한 통으로 열쇠를 얻고, 전화로 남의 예약을 지울 수 있다.
    """
    body = voice.IdentifyCallerRequest(conversation_id=conversation_id, caller_number=sender)
    found = voice.identify_caller(body)
    if not found.known:
        return _Plain({"known": False, "message": "No name on file. Ask for their first and last name."}), None
    return _Plain(
        {
            "known": True,
            "first_name": found.greeting_name,
            "message": (
                f"Their first name is probably {found.greeting_name}. Greet them by it, "
                "but still ask for their last name before booking."
            ),
        }
    ), None


class _Plain:
    """도구 결과를 응답 모델과 같은 꼴(`model_dump`)로 감싼다."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data

    def model_dump(self, mode: str = "python") -> dict[str, Any]:
        return self.data


def _find(_sender: str, conversation_id: str, args: dict) -> tuple[Any, BackgroundTasks | None]:
    body = voice.FindTeeTimesRequest(conversation_id=conversation_id, **args)
    return voice.find_tee_times(body), None


def _rates(_sender: str, conversation_id: str, args: dict) -> tuple[Any, BackgroundTasks | None]:
    body = voice.RatesRequest(conversation_id=conversation_id, **args)
    return voice.get_rates(body), None


def _book(sender: str, conversation_id: str, args: dict) -> tuple[Any, BackgroundTasks | None]:
    """잡고 바로 확정한다. 확정이 실패하면 잡은 자리를 즉시 돌려놓는다."""
    booked_key = f"{voice.today_iso()}|{sender}|booked"
    if _daily.get(booked_key, 0) >= MAX_BOOKINGS_PER_SENDER_PER_DAY:
        raise HTTPException(
            status_code=429,
            detail=(
                f"This number has already booked {MAX_BOOKINGS_PER_SENDER_PER_DAY} tee times by text "
                f"today. For more, the golfer should call the pro shop at {settings.PROSHOP_PHONE_NUMBER}."
            ),
        )
    hold = voice.hold_tee_time(
        voice.HoldRequest(
            conversation_id=conversation_id,
            date=args["date"],
            time=args["time"],
            party_size=args["party_size"],
        )
    )
    background = BackgroundTasks()
    try:
        confirmed = voice.confirm_booking(
            voice.ConfirmRequest(
                conversation_id=conversation_id,
                hold_id=hold.hold_id,
                first_name=args["first_name"],
                last_name=args["last_name"],
                holes=args.get("holes", 18),
                # 번호는 언제나 발신번호. `phone` 은 비워 두어 confirm_booking 이
                # caller_number 를 쓰게 한다.
                caller_number=sender,
            ),
            background,
        )
    except Exception:
        voice.release_hold(voice.ReleaseHoldRequest(conversation_id=conversation_id, hold_id=hold.hold_id))
        raise
    _daily[booked_key] = _daily.get(booked_key, 0) + 1
    return confirmed, background


def _waitlist(sender: str, conversation_id: str, args: dict) -> tuple[Any, BackgroundTasks | None]:
    body = voice.WaitlistRequest(conversation_id=conversation_id, caller_number=sender, **args)
    return voice.join_waitlist(body), None


_HANDLERS: dict[str, Callable[[str, str, dict], tuple[Any, BackgroundTasks | None]]] = {
    "identify_texter": _identify,
    "find_tee_times": _find,
    "get_rates": _rates,
    "book_tee_time": _book,
    "join_waitlist": _waitlist,
}


async def _run_tool(sender: str, conversation_id: str, name: str, args: Any) -> tuple[str, bool]:
    """도구 하나를 돌려 (tool_result 본문, is_error) 를 돌려준다. 예외는 모델이 읽을 문장으로."""
    handler = _HANDLERS.get(name)
    if handler is None:
        return f"Unknown tool {name}.", True
    if not isinstance(args, dict):
        return "Tool input must be an object.", True
    try:
        # 티 시트 저장소 호출은 동기다. 이벤트 루프를 막지 않게 스레드로 넘긴다.
        result, background = await run_in_threadpool(handler, sender, conversation_id, args)
    except HTTPException as exc:
        return str(exc.detail), True
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
        return f"Invalid input: {problems}", True
    except (KeyError, TypeError) as exc:
        return f"Missing or unexpected field: {exc}", True

    if background is not None:
        # 확인 문자. 모델의 답장보다 먼저 나가게 여기서 보낸다.
        await background()
    return json.dumps(_scrub(result.model_dump(mode="json"))), False


# ===== 대화 상태 =====================================================

@dataclass
class _Conversation:
    sender: str
    started: datetime
    last_seen: datetime
    messages: list[dict[str, Any]] = field(default_factory=list)

    @property
    def conversation_id(self) -> str:
        # `voice._touch_session` 이 이 id 로 호출 횟수를 센다. 시작 시각을 붙여서
        # 새 대화가 이전 대화의 세션을 이어받지 않게 한다.
        return f"sms:{self.sender}:{int(self.started.timestamp())}"


_conversations: dict[str, _Conversation] = {}
_locks: dict[str, asyncio.Lock] = {}
_daily: dict[str, int] = {}  # "날짜" 와 "날짜|번호" 를 키로 센다


def reset() -> None:
    """테스트용."""
    _conversations.clear()
    _locks.clear()
    _daily.clear()


def _conversation_for(sender: str, now: datetime) -> _Conversation:
    convo = _conversations.get(sender)
    expired = convo is None or now - convo.last_seen > CONVERSATION_TTL
    if expired or len(convo.messages) > MAX_HISTORY_MESSAGES:
        convo = _Conversation(sender=sender, started=now, last_seen=now)
        _conversations[sender] = convo
    convo.last_seen = now
    for stale in [k for k, v in _conversations.items() if now - v.last_seen > CONVERSATION_TTL]:
        del _conversations[stale]
    return convo


def _within_daily_caps(sender: str) -> bool:
    today = voice.today_iso()
    for stale in [k for k in _daily if not k.startswith(today)]:
        del _daily[stale]
    mine = f"{today}|{sender}"
    if _daily.get(today, 0) >= MAX_TEXTS_PER_DAY or _daily.get(mine, 0) >= MAX_TEXTS_PER_SENDER_PER_DAY:
        return False
    _daily[today] = _daily.get(today, 0) + 1
    _daily[mine] = _daily.get(mine, 0) + 1
    return True


def _date_note() -> str:
    now = voice.club_now()
    return f"[Today at the club is {now.strftime('%A')} {now.date().isoformat()}, {now.strftime('%I:%M %p').lstrip('0')}.]"


# ===== 모델 호출 =====================================================

def _make_client() -> Any:
    from anthropic import AsyncAnthropic

    return AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=60.0, max_retries=2)


_client: Any = None


def _get_client() -> Any:
    global _client
    if _client is None:
        _client = _make_client()
    return _client


async def _create(messages: list[dict[str, Any]]) -> Any:
    return await _get_client().beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM_PROMPT,
        tools=TOOLS,
        messages=messages,
        output_config={"effort": "low"},
        # 안전 분류기가 거절하면 서버가 권장 모델로 다시 돌린다.
        betas=["server-side-fallback-2026-07-01"],
        extra_body={"fallbacks": "default"},
    )


#: GSM-7 에 없는 글자가 하나라도 있으면 문자 전체가 UCS-2 로 가고, 한 통이 160자가
#: 아니라 70자 단위로 쪼개진다 (요금이 두 배 넘게 뛴다). 모델이 흔히 쓰는 것만 바꾼다.
_ASCII = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
                        "\u2013": "-", "\u2014": "-", "\u2026": "...", "\u00a0": " "})


def _reply_text(response: Any) -> str:
    text = " ".join(
        block.text.strip() for block in response.content if getattr(block, "type", "") == "text" and block.text.strip()
    ).translate(_ASCII)
    if len(text) > MAX_REPLY_CHARS:
        text = text[: MAX_REPLY_CHARS - 3].rsplit(" ", 1)[0] + "..."
    return text


async def _converse(convo: _Conversation, text: str) -> str | None:
    """손님 문자 한 통을 처리하고 답장 문장을 돌려준다. 답을 못 내면 None."""
    convo.messages.append({"role": "user", "content": f"{_date_note()}\n{text}"})

    for _ in range(MAX_ROUNDS_PER_TEXT):
        response = await _create(convo.messages)

        if response.stop_reason == "refusal":
            logger.warning("SMS 에이전트 거절: %s", getattr(response, "stop_details", None))
            return None

        convo.messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            return _reply_text(response) or None

        results = []
        for block in response.content:
            if getattr(block, "type", "") != "tool_use":
                continue
            content, is_error = await _run_tool(convo.sender, convo.conversation_id, block.name, block.input)
            results.append(
                {"type": "tool_result", "tool_use_id": block.id, "content": content, "is_error": is_error}
            )
        convo.messages.append({"role": "user", "content": results})

    logger.warning("SMS 에이전트가 %d 회 안에 끝내지 못함: %s", MAX_ROUNDS_PER_TEXT, convo.sender)
    return None


async def handle_text(sender: str, text: str) -> None:
    """`/sms/inbound` 가 응답을 돌려준 뒤 부른다. 답장은 Twilio REST 로 보낸다.

    웹훅 응답에 답장을 싣지 않는 이유: Twilio 는 15초 안에 응답이 없으면 끊는다.
    모델이 도구를 두세 번 부르면 그 시간을 넘길 수 있다.
    """
    lock = _locks.setdefault(sender, asyncio.Lock())
    # 연달아 온 문자가 서로 끼어들지 않게 번호마다 차례로 처리한다.
    async with lock:
        if not _within_daily_caps(sender):
            logger.warning("SMS 예약 하루 상한 도달: %s", sender)
            await send_sms(sender, fallback_reply(), template="assistant")
            return

        now = datetime.now(timezone.utc)
        convo = _conversation_for(sender, now)
        try:
            reply = await _converse(convo, text)
        except Exception as exc:
            logger.error("SMS 에이전트 실패 (%s): %s", sender, exc)
            reply = None

        if reply is None:
            # 대화가 꼬였을 수 있으니 다음 문자는 새로 시작한다.
            _conversations.pop(sender, None)
            reply = fallback_reply()
        await send_sms(sender, reply, template="assistant")
