"""
Twilio Messaging 웹훅.

- POST /sms/inbound : 고객 답장 (C = 예약 취소, STOP/START = 수신 거부/재동의)
- POST /sms/status  : 발송 상태 콜백 (queued → sent → delivered/failed)
- GET  /sms/messages: 어드민 문자 수발신함

STOP·START 등 표준 키워드에는 Twilio가 직접 자동응답하므로 여기서는 상태만 기록합니다.
Twilio 표준 수신거부 키워드에 CANCEL 이 포함되어 있어, 취소 안내는 "C" 한 글자로 받습니다.
"""
from __future__ import annotations

import logging
from urllib.parse import parse_qsl
from xml.sax.saxutils import escape

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response

from backend.core.config import settings
from backend.services import voice_booking as vb
from backend.services.twilio_sms import (
    SmsMessage,
    normalize_phone,
    opted_out,
    sms_messages,
    update_status,
    validate_twilio_signature,
)

logger = logging.getLogger(__name__)
router = APIRouter()

STOP_WORDS = {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"}
START_WORDS = {"START", "UNSTOP", "YES", "OPTIN"}


async def _twilio_params(request: Request) -> dict[str, str]:
    raw = (await request.body()).decode()
    params = dict(parse_qsl(raw, keep_blank_values=True))
    path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    if not validate_twilio_signature(path, params, request.headers.get("X-Twilio-Signature")):
        raise HTTPException(status_code=403, detail="invalid Twilio signature")
    return params


def _twiml(message: str | None = None) -> Response:
    inner = f"<Message>{escape(message)}</Message>" if message else ""
    return Response(content=f'<?xml version="1.0" encoding="UTF-8"?><Response>{inner}</Response>', media_type="application/xml")


@router.post("/sms/inbound")
async def inbound(request: Request, background: BackgroundTasks) -> Response:
    params = await _twilio_params(request)
    sender = normalize_phone(params.get("From")) or params.get("From", "")
    body = (params.get("Body") or "").strip()
    sms_messages.insert(0, SmsMessage(
        direction="in",
        to_e164=params.get("To", ""),
        from_e164=sender,
        body=body,
        status="received",
        twilio_sid=params.get("MessageSid"),
    ))

    words = body.upper().split()
    keyword = words[0] if words else ""

    if keyword in STOP_WORDS:
        opted_out.add(sender)
        return _twiml()
    if keyword in START_WORDS:
        opted_out.discard(sender)
        return _twiml()

    if keyword == "C":
        upcoming = vb.find_bookings(sender, None)
        if len(words) > 1:
            ref = vb.norm_ref(" ".join(words[1:]))
            upcoming = [u for u in upcoming if u["ref"] == ref]
        if not upcoming:
            return _twiml(f"Pelham Hills: no upcoming booking found for this number. Call {settings.PROSHOP_PHONE_NUMBER} for help.")
        if len(upcoming) > 1:
            refs = ", ".join(f"{u['ref']} ({u['weekday'][:3]} {u['tee_time']})" for u in upcoming[:4])
            return _twiml(f"Pelham Hills: you have several bookings: {refs}. Reply C and the number, e.g. C {upcoming[0]['ref'][3:]}.")
        try:
            booking = vb.cancel_booking(upcoming[0]["ref"], sender, "Cancelled by SMS reply")
        except vb.BookingError as err:
            return _twiml(f"Pelham Hills: {err.message}")
        # 확인 문자는 TwiML 응답으로 보내고, 대기자 알림만 백그라운드로 처리
        background.add_task(vb.notify_waitlist, booking)
        return _twiml(f"Pelham Hills: cancelled {booking.ref} ({booking.date}, {booking.time}). Hope to see you soon.")

    return _twiml(f"Pelham Hills: reply C to cancel your tee time. For anything else call {settings.PROSHOP_PHONE_NUMBER}.")


@router.post("/sms/status")
async def status(request: Request) -> Response:
    params = await _twilio_params(request)
    sid = params.get("MessageSid") or params.get("SmsSid")
    if sid:
        update_status(sid, params.get("MessageStatus") or params.get("SmsStatus") or "unknown", params.get("ErrorCode"))
    return Response(status_code=204)


@router.get("/sms/messages")
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
