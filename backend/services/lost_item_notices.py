"""분실물을 찾았을 때 손님에게 가는 문자.

프로 샵 화면(`/admin/lost-items`)은 정적 사이트라 Twilio 키를 들 수 없다. 그래서 직원은
상태만 "found" 로 바꾸고(0015 의 `pelham_staff_lost_item_update`), 문자는 이 서버의
1분 루프(`main._reminder_loop`)가 보낸다. 직원이 바꾸고 1분 안에 간다.

- 한 줄에 한 번만 보낸다: 보내기 전에 `notified_at` 을 채워 그 줄을 집는다
  (`lost_items.claim_notice`). 실패해도 다시 집지 않는다 — 다시 보낼지는 화면의
  "Resend text" 가 정한다. 1분마다 같은 실패 문자를 쏘지 않기 위해서다.
- 밤에는 보내지 않는다(`SEND_HOURS`). 저녁 늦게 찾은 물건은 아침 첫 패스가 알린다.
- 전화번호가 없는 접수는 건너뛴다. 화면이 "번호 없음 — 직접 연락" 으로 보여 준다.
- 문자에는 "찾았다" 가 아니라 "맞는 물건이 있다" 고 쓴다. 손님 것인지는 손님이 와서
  확인할 때 정해진다.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from backend.api.routes import voice
from backend.core.config import settings
from backend.services import lost_items, supabase_rest
from backend.services.twilio_sms import normalize_phone, send_sms

logger = logging.getLogger(__name__)

#: 문자를 보내는 시각(클럽 현지 시각, 시작 포함·끝 제외). 급한 소식이 아니라서
#: 대기자 제안(7시~)보다 한 시간 늦게 시작한다.
SEND_HOURS = (8, 21)

_lock = asyncio.Lock()


def notice_text(row: dict) -> str:
    item = (row.get("item") or "item").strip()
    ticket = row.get("ticket") or ""
    return (
        f"Pelham Hills: we have a {item} that may match your lost item report {ticket}. "
        f"Please bring photo ID to the pro shop to pick it up. "
        f"Questions? Call {settings.PROSHOP_PHONE_NUMBER}."
    )


def _within_hours(now_local: datetime) -> bool:
    start, end = SEND_HOURS
    return start <= now_local.hour < end


def sweep() -> list[tuple[str, str, str]]:
    """보낼 줄을 집어 (id, 번호, 본문) 목록으로 돌려준다. 동기 함수 — 스레드에서 돈다."""
    if not _within_hours(voice.club_now()):
        return []
    outbox: list[tuple[str, str, str]] = []
    now = datetime.now(timezone.utc).isoformat()
    for row in lost_items.pending_found_notices():
        phone = normalize_phone(row.get("caller_phone"))
        if not phone:
            continue
        if lost_items.claim_notice(row["id"], now):
            outbox.append((row["id"], phone, notice_text(row)))
    return outbox


async def run() -> None:
    """한 패스. 오류는 삼킨다 — 리마인더 루프를 망치면 안 된다.

    Twilio 가 없으면 줄을 집지 않는다. 집어 두면 키를 넣은 뒤에도 다시 가지 않는다.
    """
    if not settings.TWILIO_ENABLED:
        return
    from starlette.concurrency import run_in_threadpool

    async with _lock:
        try:
            outbox = await run_in_threadpool(sweep)
        except supabase_rest.SupabaseUnavailable:
            return
        except Exception as exc:
            logger.error("분실물 문자 패스 실패: %s", exc)
            return
        for item_id, phone, text in outbox:
            msg = await send_sms(phone, text, template="lost_item_found")
            status = "sent" if msg.status not in ("failed", "skipped") else msg.status
            try:
                await run_in_threadpool(lost_items.record_notice, item_id, status, msg.error)
            except supabase_rest.SupabaseUnavailable:
                logger.warning("분실물 문자 결과를 적지 못함 (%s)", status)
