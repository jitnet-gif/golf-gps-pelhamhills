import base64
import hashlib
import hmac
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4

import httpx

from backend.core.config import settings

logger = logging.getLogger(__name__)

TWILIO_API = "https://api.twilio.com/2010-04-01"


def normalize_phone(raw: str | None) -> str | None:
    """북미 번호를 E.164(+1XXXXXXXXXX)로 정규화합니다. 판별 불가면 None."""
    if not raw:
        return None
    raw = raw.strip()
    digits = re.sub(r"\D", "", raw)
    if raw.startswith("+") and 8 <= len(digits) <= 15:
        return f"+{digits}"
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


@dataclass
class SmsMessage:
    direction: str  # in / out
    to_e164: str
    from_e164: str
    body: str
    template: str | None = None
    booking_ref: str | None = None
    status: str = "queued"  # queued·sent·delivered·failed·skipped·received
    twilio_sid: str | None = None
    error: str | None = None
    id: str = field(default_factory=lambda: str(uuid4()))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# 인메모리 기록 (티시트와 동일하게 서버 재시작 시 초기화)
sms_messages: list[SmsMessage] = []
opted_out: set[str] = set()


def _by_sid(sid: str) -> SmsMessage | None:
    for msg in sms_messages:
        if msg.twilio_sid == sid:
            return msg
    return None


async def send_sms(to: str, body: str, template: str | None = None, booking_ref: str | None = None) -> SmsMessage:
    to_e164 = normalize_phone(to) or to
    msg = SmsMessage(
        direction="out",
        to_e164=to_e164,
        from_e164=settings.TWILIO_PHONE_NUMBER,
        body=body,
        template=template,
        booking_ref=booking_ref,
    )
    sms_messages.insert(0, msg)
    del sms_messages[1000:]

    if to_e164 in opted_out:
        msg.status = "skipped"
        msg.error = "recipient opted out (STOP)"
        return msg
    if not settings.TWILIO_ENABLED:
        msg.status = "skipped"
        msg.error = "Twilio not configured"
        logger.warning("Twilio 미설정 — SMS 미발송: %s %s", to_e164, template)
        return msg

    data = {
        "To": to_e164,
        "Body": body,
        "StatusCallback": f"{settings.PUBLIC_BASE_URL.rstrip('/')}{settings.API_V1_STR}/sms/status",
    }
    if settings.TWILIO_MESSAGING_SERVICE_SID:
        data["MessagingServiceSid"] = settings.TWILIO_MESSAGING_SERVICE_SID
    else:
        data["From"] = settings.TWILIO_PHONE_NUMBER

    url = f"{TWILIO_API}/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, data=data, auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN))
        payload = res.json()
        if res.status_code >= 400:
            msg.status = "failed"
            msg.error = f"{payload.get('code')}: {payload.get('message')}"
            logger.error("Twilio SMS 실패 (%s): %s", res.status_code, msg.error)
        else:
            msg.twilio_sid = payload.get("sid")
            msg.status = payload.get("status", "queued")
    except Exception as exc:
        msg.status = "failed"
        msg.error = str(exc)
        logger.error("Twilio SMS 예외: %s", exc)
    return msg


def update_status(sid: str, status: str, error_code: str | None = None) -> None:
    msg = _by_sid(sid)
    if msg:
        msg.status = status
        if error_code:
            msg.error = error_code


def validate_twilio_signature(path_with_query: str, params: dict[str, str], signature: str | None) -> bool:
    """X-Twilio-Signature 검증. URL은 Twilio 콘솔에 등록한 공개 주소 기준으로 재구성합니다."""
    if not settings.TWILIO_AUTH_TOKEN:
        # 로컬 개발 시에만 통과. 운영에서는 반드시 토큰을 설정해야 합니다.
        logger.warning("TWILIO_AUTH_TOKEN 미설정 — Twilio 서명 검증 생략")
        return True
    if not signature:
        return False
    url = f"{settings.PUBLIC_BASE_URL.rstrip('/')}{path_with_query}"
    payload = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    digest = hmac.new(settings.TWILIO_AUTH_TOKEN.encode(), payload.encode(), hashlib.sha1).digest()
    expected = base64.b64encode(digest).decode()
    return hmac.compare_digest(expected, signature)
