"""Twilio 문자 웹훅: 손님 답장, 전달 상태, 그리고 티타임 리마인더.

  POST /sms/inbound   손님 답장 — STOP/START, "C <코드>" 로 취소
  POST /sms/status    Twilio 전달 상태 콜백
  GET  /sms/messages  최근 발송·수신 기록 (Calls & SMS 화면용)

확인 문자는 음성 예약이 확정될 때 `voice.py` 가 보낸다. 여기서는 그 뒤의 일을 한다.

## 왜 답장 취소에 코드를 요구하나

음성 도구의 취소는 "전화번호 **와** 성" 두 열쇠를 요구한다 (`voice.cancel_booking`).
문자의 발신 번호는 하나의 열쇠일 뿐이고 위조도 가능하므로, 확인 문자에 실어 보낸
6자리 코드를 두 번째 열쇠로 받는다. 번호만으로 취소되면 번호를 아는 누구나 남의
라운드를 지울 수 있다. 티오프 직전 취소 금지(`CANCEL_CUTOFF_MINUTES`)도 전화와 같다.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl
from xml.sax.saxutils import escape

import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from backend.api.routes import tee_sheet as ts
from backend.api.routes import voice
from backend.core.config import settings
from backend.services.tee_sheet_store import Scope
from backend.services.twilio_sms import (
    SmsMessage,
    normalize_phone,
    opted_out,
    send_sms,
    sms_messages,
    update_status,
    validate_twilio_signature,
)

logger = logging.getLogger(__name__)
router = APIRouter()

STOP_WORDS = {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"}
START_WORDS = {"START", "UNSTOP", "YES", "OPTIN"}

#: 리마인더 두 번. (감사 로그 표시, 보낼 시각을 티타임으로부터 구하는 함수, 문구)
#: 감사 로그에 남기는 이유: 서버가 재시작돼도 같은 문자를 두 번 보내지 않는다.
REMINDER_DAY_BEFORE = "Reminder text sent (day before)."
REMINDER_TWO_HOURS = "Reminder text sent (2 hours before)."


async def _twilio_params(request: Request) -> dict[str, str]:
    raw = (await request.body()).decode()
    params = dict(parse_qsl(raw, keep_blank_values=True))
    path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    if not validate_twilio_signature(path, params, request.headers.get("X-Twilio-Signature")):
        raise HTTPException(status_code=403, detail="invalid Twilio signature")
    return params


def _twiml(message: str | None = None) -> Response:
    inner = f"<Message>{escape(message)}</Message>" if message else ""
    return Response(
        content=f'<?xml version="1.0" encoding="UTF-8"?><Response>{inner}</Response>',
        media_type="application/xml",
    )


def _live(booking: ts.TeeBooking, now: datetime) -> bool:
    """손님 입장에서 "아직 살아 있는 예약" 인가. 홀드·취소·막아 둔 칸은 아니다."""
    if booking.status in (ts.BookingStatus.CANCELLED, ts.BookingStatus.BLOCKED, ts.BookingStatus.NO_SHOW):
        return False
    return booking.source != ts.BookingSource.VOICE_HOLD and not ts.hold_expired(booking, now)


def cancel_by_reply(sender: str, code: str) -> str:
    """"C <코드>" 답장 처리. 손님에게 돌려줄 문장을 반환한다."""
    wanted_phone = voice.normalize_phone(sender)
    code = code.strip().upper()
    help_line = f"Call {settings.PROSHOP_PHONE_NUMBER} for help."
    if not code:
        return f"Pelham Hills: reply C and the code from your confirmation text, e.g. C 4F2K9Q. {help_line}"

    today = voice.today_iso()
    now = datetime.now(timezone.utc)
    candidates = [
        booking.id
        for booking in ts.read_bookings(Scope(date_from=today))
        if booking.date >= today
        and _live(booking, now)
        and voice._confirmation_code(booking.id) == code
        and any(not p.cancelled and voice.normalize_phone(p.phone) == wanted_phone for p in booking.players)
    ]
    if not candidates:
        return f"Pelham Hills: no upcoming booking matches code {code} for this number. {help_line}"

    with ts.bookings_tx(Scope(ids=set(candidates))) as bookings:
        booking = next((b for b in bookings if b.id in candidates and _live(b, now)), None)
        if booking is None:
            return f"Pelham Hills: that booking is already cancelled. {help_line}"
        at = voice.slot_datetime(booking.date, booking.time)
        if at is not None and (at - voice.club_now()).total_seconds() / 60 < voice.CANCEL_CUTOFF_MINUTES:
            return (
                f"Pelham Hills: your tee time is less than {voice.CANCEL_CUTOFF_MINUTES // 60} hours away, "
                f"so the pro shop has to cancel it. {help_line}"
            )
        message = ts._apply_status(booking, ts.BookingStatus.CANCELLED, "Cancelled by text reply")
        ts._audit(booking, message)
        when = f"{voice.spoken_date(booking.date)} at {booking.time}"

    return f"Pelham Hills: cancelled your tee time, {when}. Hope to see you soon."


@router.post("/sms/inbound")
async def inbound(request: Request) -> Response:
    params = await _twilio_params(request)
    sender = normalize_phone(params.get("From")) or params.get("From", "")
    body = (params.get("Body") or "").strip()
    sms_messages.insert(
        0,
        SmsMessage(
            direction="in",
            to_e164=params.get("To", ""),
            from_e164=sender,
            body=body,
            status="received",
            twilio_sid=params.get("MessageSid"),
        ),
    )

    words = body.upper().split()
    keyword = words[0] if words else ""

    if keyword in STOP_WORDS:
        opted_out.add(sender)
        return _twiml()
    if keyword in START_WORDS:
        opted_out.discard(sender)
        return _twiml()
    if keyword == "C":
        # 저장소 호출은 동기다. 이벤트 루프를 막지 않게 스레드로 넘긴다.
        from starlette.concurrency import run_in_threadpool

        return _twiml(await run_in_threadpool(cancel_by_reply, sender, "".join(words[1:])))

    return _twiml(
        f"Pelham Hills: reply C and your code to cancel. For anything else call {settings.PROSHOP_PHONE_NUMBER}."
    )


@router.post("/sms/status")
async def status(request: Request) -> Response:
    params = await _twilio_params(request)
    sid = params.get("MessageSid") or params.get("SmsSid")
    if sid:
        update_status(sid, params.get("MessageStatus") or params.get("SmsStatus") or "unknown", params.get("ErrorCode"))
    return Response(status_code=204)


def hide_on_public_surface() -> None:
    """공개 배포(`PUBLIC_SURFACE=voice`)에서는 이 경로를 없는 것처럼 둔다.

    이 목록에는 손님 전화번호와 문자 본문이 그대로 들어 있는데 인증이 없다.
    Twilio 가 부르는 것은 `/sms/inbound` 와 `/sms/status` 둘뿐이고, 기록 조회는
    어드민 화면(Calls & SMS) 용이다. 403 이 아니라 404 를 주는 이유는, 403 이면
    "거기 뭔가 있다" 는 사실을 알려 주기 때문이다.
    """
    if os.getenv("PUBLIC_SURFACE", "all").strip().lower() == "voice":
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/sms/messages", dependencies=[Depends(hide_on_public_surface)])
def list_messages(booking_ref: str | None = None, limit: int = 100) -> list[dict]:
    rows = [m for m in sms_messages if not booking_ref or m.booking_ref == booking_ref]
    return [
        {
            "id": m.id,
            "direction": m.direction,
            "to": m.to_e164,
            "from": m.from_e164,
            "body": m.body,
            "template": m.template,
            "booking_ref": m.booking_ref,
            "status": m.status,
            "error": m.error,
            "created_at": m.created_at.isoformat(),
        }
        for m in rows[:limit]
    ]


# ===== 리마인더 ========================================================

def _due_reminders() -> list[tuple[str, str]]:
    """지금 보내야 할 리마인더를 골라 감사 로그에 먼저 표시하고 (전화번호, 문구) 를 돌려준다.

    표시를 먼저 하는 이유: 발송은 트랜잭션 밖(`await`)에서 한다. 보낸 뒤에 표시하면
    그 사이 서버가 죽었을 때 다음 패스가 같은 문자를 또 보낸다. 한 통 빠지는 쪽이
    두 통 가는 쪽보다 낫다.

    확인 문자를 받은 손님(음성 예약)에게만 보낸다 — 문자를 받겠다고 한 적 없는
    웹·직원 예약 손님에게 갑자기 문자가 가면 안 된다.
    """
    now_local = voice.club_now()
    now_utc = datetime.now(timezone.utc)
    today = now_local.date().isoformat()
    tomorrow = (now_local.date() + timedelta(days=1)).isoformat()
    due: list[tuple[str, str]] = []

    with ts.bookings_tx(Scope(date_from=today, date_to=tomorrow)) as bookings:
        for booking in bookings:
            if booking.source != ts.BookingSource.VOICE or not _live(booking, now_utc):
                continue
            if booking.status != ts.BookingStatus.RESERVED:
                continue
            phone = next((p.phone for p in booking.players if p.phone and not p.cancelled), "")
            tee_at = voice.slot_datetime(booking.date, booking.time)
            if not phone or tee_at is None:
                continue
            sent = {entry.message for entry in booking.audit}
            created = booking.createdAt.astimezone(voice.CLUB_TIMEZONE)

            day_before = (tee_at - timedelta(days=1)).replace(hour=18, minute=0)
            if (
                REMINDER_DAY_BEFORE not in sent
                and created < day_before <= now_local < tee_at - timedelta(hours=3)
            ):
                ts._audit(booking, REMINDER_DAY_BEFORE)
                due.append((phone, f"Pelham Hills: see you tomorrow at {booking.time}! "
                                   f"Reply C {voice._confirmation_code(booking.id)} to cancel."))

            two_hours = tee_at - timedelta(hours=2)
            if REMINDER_TWO_HOURS not in sent and created < two_hours <= now_local < tee_at:
                ts._audit(booking, REMINDER_TWO_HOURS)
                due.append((phone, f"Pelham Hills: your tee time is at {booking.time}. "
                                   "Please check in at the pro shop 15 minutes early."))
    return due


async def run_reminders() -> None:
    """1분마다 `main.py` 가 부른다. Twilio 가 설정돼 있을 때만 돈다."""
    from starlette.concurrency import run_in_threadpool

    for phone, text in await run_in_threadpool(_due_reminders):
        await send_sms(phone, text, template="reminder")
