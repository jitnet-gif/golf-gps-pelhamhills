"""찾은 분실물 → 손님 문자 (`backend/services/lost_item_notices.py`).

실행: `cd E:\\PELHAMHILLS && python -m pytest backend/tests/test_lost_item_notices.py -q`

분실물 표(Supabase)는 메모리 가짜로 바꾼다.
"""

from __future__ import annotations

import asyncio
from datetime import datetime

import pytest

from backend.api.routes import voice
from backend.services import lost_item_notices as notices
from backend.services import lost_items
from backend.services.twilio_sms import SmsMessage

MORNING = datetime(2026, 10, 6, 10, 0, tzinfo=voice.CLUB_TIMEZONE)
NIGHT = datetime(2026, 10, 6, 22, 30, tzinfo=voice.CLUB_TIMEZONE)


class FakeTable:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def add(self, rid, status="found", phone="905-555-0101", notified_at=None):
        self.rows.append({
            "id": rid, "ticket": f"LF-0{rid}", "item": "rangefinder", "caller_name": "Ann",
            "caller_phone": phone, "status": status, "notified_at": notified_at,
            "notify_status": None, "notify_error": None,
        })

    def row(self, rid):
        return next(r for r in self.rows if r["id"] == rid)

    def pending(self, limit=20):
        return [dict(r) for r in self.rows if r["status"] == "found" and r["notified_at"] is None][:limit]

    def claim(self, rid, at):
        row = self.row(rid)
        if row["status"] != "found" or row["notified_at"] is not None:
            return False
        row["notified_at"] = at
        return True

    def record(self, rid, status, error=None):
        self.row(rid).update(notify_status=status, notify_error=error)


@pytest.fixture
def table(monkeypatch):
    fake = FakeTable()
    monkeypatch.setattr(lost_items, "pending_found_notices", fake.pending)
    monkeypatch.setattr(lost_items, "claim_notice", fake.claim)
    monkeypatch.setattr(lost_items, "record_notice", fake.record)
    monkeypatch.setattr(notices.settings, "TWILIO_ACCOUNT_SID", "AC_test")
    monkeypatch.setattr(notices.settings, "TWILIO_AUTH_TOKEN", "token")
    monkeypatch.setattr(notices.settings, "TWILIO_PHONE_NUMBER", "+15550000000")
    monkeypatch.setattr(voice, "club_now", lambda: MORNING)
    return fake


@pytest.fixture
def sent(monkeypatch):
    outbox: list[tuple[str, str]] = []

    async def fake_send(to, body, template=None, booking_ref=None):
        outbox.append((to, body))
        return SmsMessage(direction="out", to_e164=to, from_e164="+1", body=body, template=template)

    monkeypatch.setattr(notices, "send_sms", fake_send)
    return outbox


def run():
    asyncio.run(notices.run())


def test_found_item_is_texted_once(table, sent):
    table.add("1")
    run()
    run()
    assert len(sent) == 1
    phone, body = sent[0]
    assert phone == "+19055550101"
    assert "LF-01" in body and "rangefinder" in body
    assert table.row("1")["notified_at"] is not None
    assert table.row("1")["notify_status"] in ("queued", "sent")


def test_searching_and_already_notified_are_left_alone(table, sent):
    table.add("1", status="searching")
    table.add("2", notified_at="2026-10-05T12:00:00+00:00")
    run()
    assert sent == []


def test_no_phone_is_skipped_without_claiming(table, sent):
    table.add("1", phone="")
    run()
    assert sent == []
    assert table.row("1")["notified_at"] is None


def test_no_texts_at_night(table, sent, monkeypatch):
    monkeypatch.setattr(voice, "club_now", lambda: NIGHT)
    table.add("1")
    run()
    assert sent == []
    assert table.row("1")["notified_at"] is None


def test_without_twilio_nothing_is_claimed(table, sent, monkeypatch):
    monkeypatch.setattr(notices.settings, "TWILIO_AUTH_TOKEN", "")
    table.add("1")
    run()
    assert sent == []
    assert table.row("1")["notified_at"] is None


def test_failed_send_is_recorded_and_not_retried(table, monkeypatch):
    calls = []

    async def failing_send(to, body, template=None, booking_ref=None):
        calls.append(to)
        msg = SmsMessage(direction="out", to_e164=to, from_e164="+1", body=body)
        msg.status, msg.error = "failed", "21211: invalid number"
        return msg

    monkeypatch.setattr(notices, "send_sms", failing_send)
    table.add("1")
    run()
    run()
    assert len(calls) == 1
    assert table.row("1")["notify_status"] == "failed"
    assert "21211" in table.row("1")["notify_error"]
