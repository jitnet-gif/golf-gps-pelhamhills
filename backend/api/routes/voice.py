"""
ElevenLabs 음성 에이전트 연동 엔드포인트.

- POST /voice/init            : Twilio 수신 통화 시작 시 ElevenLabs가 호출 (발신번호 → 고객 정보 주입)
- POST /voice/availability    : check_availability 도구
- POST /voice/hold            : hold_slot 도구 (5분 임시확보)
- POST /voice/confirm         : confirm_booking 도구 (+ 확정 SMS)
- POST /voice/booking/find    : find_booking 도구
- POST /voice/booking/cancel  : cancel_booking 도구 (+ 취소 SMS, 대기자 알림)
- POST /voice/waitlist        : join_waitlist 도구
- POST /voice/post-call       : 통화 종료 웹훅 (HMAC 서명 검증)
- GET  /voice/stats, /voice/calls, /voice/holds : 어드민 조회

도구 오류는 HTTP 200 + {"ok": false, "message"} 로 돌려 AI가 사유를 그대로 읽게 합니다.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time as _time
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from backend.core.config import settings
from backend.services import voice_booking as vb
from backend.services.twilio_sms import normalize_phone, sms_messages

logger = logging.getLogger(__name__)
router = APIRouter()

SIGNATURE_TOLERANCE_S = 30 * 60


def require_tool_secret(x_voice_tool_secret: str | None = Header(default=None)) -> None:
    if not settings.VOICE_TOOL_SECRET:
        logger.warning("VOICE_TOOL_SECRET 미설정 — 음성 도구 인증 생략 (로컬 개발 전용)")
        return
    if not x_voice_tool_secret or not hmac.compare_digest(x_voice_tool_secret, settings.VOICE_TOOL_SECRET):
        raise HTTPException(status_code=401, detail="invalid tool secret")


def _fail(err: vb.BookingError) -> dict:
    return {"ok": False, "error_code": err.code, "message": err.message}


# ---------- 통화 시작 ----------

class InitRequest(BaseModel):
    caller_id: str | None = None
    agent_id: str | None = None
    called_number: str | None = None
    call_sid: str | None = None
    conversation_id: str | None = None


@router.post("/voice/init", dependencies=[Depends(require_tool_secret)])
def conversation_init(body: InitRequest) -> dict:
    caller = vb.identify_caller(body.caller_id)
    now = vb.now_local()
    if body.conversation_id:
        vb.voice_calls[body.conversation_id] = vb.VoiceCall(
            conversation_id=body.conversation_id,
            caller_e164=normalize_phone(body.caller_id),
            call_sid=body.call_sid,
        )
    upcoming = caller.get("upcoming") or []
    return {
        "type": "conversation_initiation_client_data",
        "dynamic_variables": {
            # ElevenLabs 동적 변수는 문자열·숫자·불리언만 허용
            "caller_name": caller.get("name", ""),
            "caller_first_name": caller.get("first_name", ""),
            "is_known_caller": bool(caller.get("known")),
            "is_member": bool(caller.get("is_member")),
            "caller_phone": caller.get("phone", body.caller_id or ""),
            "upcoming_bookings": "; ".join(
                f"{u['ref']} {u['weekday']} {u['date']} {u['tee_time']} for {u['players']}" for u in upcoming
            ) or "none",
            "today_date": now.date().isoformat(),
            "today_weekday": f"{now:%A}",
            "now_time": vb.sheet_time(now.time()),
        },
    }


# ---------- 도구 ----------

class AvailabilityRequest(BaseModel):
    date: str = Field(..., description="YYYY-MM-DD")
    earliest_time: str | None = None
    latest_time: str | None = None
    players: int = 4
    holes: int = 18


@router.post("/voice/availability", dependencies=[Depends(require_tool_secret)])
def availability(body: AvailabilityRequest) -> dict:
    try:
        result = vb.check_availability(body.date, body.earliest_time, body.latest_time, body.players, body.holes)
    except vb.BookingError as err:
        return _fail(err)
    if not result["options"]:
        result["message"] = "No tee times match. Offer a different time window or the waitlist."
    return {"ok": True, **result}


class HoldRequest(BaseModel):
    tee_time_id: str
    players: int
    holes: int = 18
    carts: int = 0
    caller_id: str | None = None
    conversation_id: str | None = None


@router.post("/voice/hold", dependencies=[Depends(require_tool_secret)])
def hold(body: HoldRequest) -> dict:
    try:
        h = vb.hold_slot(body.tee_time_id, body.players, body.holes, min(max(body.carts, 0), 4), body.caller_id, body.conversation_id)
        quote = vb.price_quote(h.date, h.holes, h.players)
    except vb.BookingError as err:
        return _fail(err)
    return {
        "ok": True,
        "hold_id": h.id,
        "tee_time": vb.sheet_time(h.tee_time),
        "date": h.date.isoformat(),
        "expires_in_seconds": int(vb.HOLD_TTL.total_seconds()),
        "price": quote,
    }


class ConfirmRequest(BaseModel):
    hold_id: str
    first_name: str
    last_name: str
    phone: str | None = Field(default=None, description="다른 번호로 문자를 원할 때만. 없으면 발신번호 사용")
    caller_id: str | None = None
    conversation_id: str | None = None


@router.post("/voice/confirm", dependencies=[Depends(require_tool_secret)])
def confirm(body: ConfirmRequest, background: BackgroundTasks) -> dict:
    try:
        booking = vb.confirm_booking(body.hold_id, body.first_name, body.last_name, body.phone or body.caller_id, body.conversation_id)
    except vb.BookingError as err:
        return _fail(err)
    background.add_task(vb.send_confirmation, booking)
    summary = vb._booking_summary(booking)
    return {"ok": True, "confirmation_number": booking.ref, "sms_sent_to": vb._primary_phone(booking), **summary}


class FindRequest(BaseModel):
    ref: str | None = None
    phone: str | None = None
    caller_id: str | None = None


@router.post("/voice/booking/find", dependencies=[Depends(require_tool_secret)])
def find(body: FindRequest) -> dict:
    found = vb.find_bookings(body.phone or body.caller_id, body.ref)
    return {"ok": True, "bookings": found, "count": len(found)}


class CancelRequest(BaseModel):
    ref: str
    phone: str | None = None
    caller_id: str | None = None
    reason: str = "Cancelled by phone"
    conversation_id: str | None = None


@router.post("/voice/booking/cancel", dependencies=[Depends(require_tool_secret)])
def cancel(body: CancelRequest, background: BackgroundTasks) -> dict:
    try:
        booking = vb.cancel_booking(body.ref, body.phone or body.caller_id, body.reason)
    except vb.BookingError as err:
        return _fail(err)
    background.add_task(vb.send_cancellation, booking)
    if body.conversation_id and body.conversation_id in vb.voice_calls:
        vb.voice_calls[body.conversation_id].outcome = "cancelled"
    return {"ok": True, "cancelled": booking.ref, "message": "Cancelled. A confirmation text is on its way."}


class WaitlistRequest(BaseModel):
    date: str
    earliest_time: str | None = None
    latest_time: str | None = None
    players: int = 4
    name: str = ""
    phone: str | None = None
    caller_id: str | None = None


@router.post("/voice/waitlist", dependencies=[Depends(require_tool_secret)])
def waitlist(body: WaitlistRequest) -> dict:
    try:
        entry = vb.join_waitlist(body.date, body.earliest_time, body.latest_time, body.players, body.phone or body.caller_id, body.name)
    except vb.BookingError as err:
        return _fail(err)
    return {"ok": True, "waitlist_id": entry.id, "message": "Added to the waitlist. We'll text if a spot opens."}


# ---------- 통화 종료 웹훅 ----------

def verify_elevenlabs_signature(raw: bytes, header: str | None) -> bool:
    """elevenlabs-signature: t=<unix>,v0=<hex hmac_sha256(secret, f"{t}.{body}")>"""
    if not settings.ELEVENLABS_WEBHOOK_SECRET:
        logger.warning("ELEVENLABS_WEBHOOK_SECRET 미설정 — post-call 서명 검증 생략 (로컬 개발 전용)")
        return True
    if not header:
        return False
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    ts, sig = parts.get("t"), parts.get("v0")
    if not ts or not sig or not ts.isdigit():
        return False
    if abs(_time.time() - int(ts)) > SIGNATURE_TOLERANCE_S:
        return False
    expected = hmac.new(settings.ELEVENLABS_WEBHOOK_SECRET.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


TRANSFER_TOOLS = {"transfer_to_number", "transfer_to_agent"}


@router.post("/voice/post-call")
async def post_call(request: Request) -> dict:
    raw = await request.body()
    if not verify_elevenlabs_signature(raw, request.headers.get("elevenlabs-signature")):
        raise HTTPException(status_code=401, detail="invalid signature")
    event = json.loads(raw)
    if event.get("type") != "post_call_transcription":
        return {"ok": True, "ignored": event.get("type")}

    data = event.get("data") or {}
    conv_id = data.get("conversation_id")
    if not conv_id:
        return {"ok": True, "ignored": "no conversation_id"}
    meta = data.get("metadata") or {}
    analysis = data.get("analysis") or {}
    dyn = (data.get("conversation_initiation_client_data") or {}).get("dynamic_variables") or {}
    transcript = data.get("transcript") or []

    call = vb.voice_calls.setdefault(conv_id, vb.VoiceCall(conversation_id=conv_id))
    call.caller_e164 = call.caller_e164 or normalize_phone(
        dyn.get("system__caller_id") or (meta.get("phone_call") or {}).get("external_number")
    )
    call.duration_s = meta.get("call_duration_secs")
    call.summary = analysis.get("transcript_summary")
    call.transcript = [{"role": t.get("role"), "message": t.get("message")} for t in transcript if t.get("message")]
    if meta.get("start_time_unix_secs"):
        call.started_at = datetime.fromtimestamp(meta["start_time_unix_secs"], tz=timezone.utc)

    transferred = any(
        (tc or {}).get("tool_name") in TRANSFER_TOOLS
        for turn in transcript
        for tc in (turn.get("tool_calls") or [])
    )
    if call.booking_refs:
        call.outcome = "booked"
    elif call.outcome == "cancelled":
        pass
    elif transferred:
        call.outcome = "transferred"
    elif analysis.get("call_successful") == "success":
        call.outcome = "info"
    else:
        call.outcome = "abandoned"
    return {"ok": True}


# ---------- 어드민 조회 ----------

def _call_row(c: vb.VoiceCall) -> dict:
    return {
        "conversation_id": c.conversation_id,
        "caller": c.caller_e164,
        "started_at": c.started_at.isoformat(),
        "duration_s": c.duration_s,
        "outcome": c.outcome,
        "booking_refs": c.booking_refs,
        "summary": c.summary,
    }


@router.get("/voice/stats")
def stats(date: str | None = None) -> dict:
    day = date or vb.now_local().date().isoformat()
    calls = [c for c in vb.voice_calls.values() if c.started_at.astimezone(vb.COURSE_TZ).date().isoformat() == day]
    return {
        "date": day,
        "calls": len(calls),
        "booked": sum(1 for c in calls if c.outcome == "booked"),
        "transferred": sum(1 for c in calls if c.outcome == "transferred"),
        "sms_sent": sum(1 for m in sms_messages if m.direction == "out" and m.created_at.astimezone(vb.COURSE_TZ).date().isoformat() == day),
    }


@router.get("/voice/calls")
def list_calls(booking_ref: str | None = None) -> list[dict]:
    calls = sorted(vb.voice_calls.values(), key=lambda c: c.started_at, reverse=True)
    if booking_ref:
        calls = [c for c in calls if booking_ref in c.booking_refs]
    return [_call_row(c) for c in calls[:200]]


@router.get("/voice/calls/{conversation_id}")
def get_call(conversation_id: str) -> dict:
    call = vb.voice_calls.get(conversation_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return {**_call_row(call), "transcript": call.transcript}


@router.get("/voice/holds")
def active_holds() -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        {
            "hold_id": h.id,
            "date": h.date.isoformat(),
            "tee_time": vb.sheet_time(h.tee_time),
            "players": h.players,
            "caller": h.caller_e164,
            "seconds_left": int((h.expires_at - now).total_seconds()),
        }
        for h in vb.holds.values()
        if h.status == "active" and h.expires_at > now
    ]
