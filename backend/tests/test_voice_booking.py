"""음성 예약 도구 계층 통합 테스트.

실행: `cd E:\\PELHAMHILLS && python -m pytest backend/tests/test_voice_booking.py -q`

시간을 고정하는 이유: 이 도구들은 "지나간 티타임은 팔지 않는다", "티오프 2시간 전
이후에는 취소하지 않는다" 처럼 **지금 몇 시인가** 에 따라 답이 달라진다. 실제 시계로
돌리면 밤에 실행할 때와 아침에 실행할 때 결과가 달라진다. 그래서 `club_now` 를
시드 날짜(2026-09-08) 아침 6시로 고정한다 — 그날 슬롯(6:40~18:00)이 전부 미래다.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.api.routes import tee_sheet as ts  # noqa: E402
from backend.api.routes import voice  # noqa: E402
from backend.services import tee_sheet_store as store  # noqa: E402

API = "/api/v1"

TODAY = "2026-09-08"      # 시드 데이터가 들어 있는 화요일
TOMORROW = "2026-09-09"   # 예약이 하나도 없는 날
FIXED_NOW = datetime(2026, 9, 8, 6, 0, tzinfo=voice.CLUB_TIMEZONE)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv(store.ENV_VAR, str(tmp_path / "tee_sheet.json"))
    monkeypatch.setenv("VOICE_TOOL_SECRET", "")
    # 개발 머신의 셸에 agent id 가 export 돼 있어도 테스트 결과가 흔들리지 않게 한다.
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "")
    monkeypatch.setattr(voice, "club_now", lambda: FIXED_NOW)

    store._cache = None
    store._cache_path = None
    with voice._sessions_lock:
        voice._sessions.clear()
    with voice._session_rate_lock:
        voice._session_hits.clear()

    app = FastAPI()
    app.include_router(voice.router, prefix=API)
    app.include_router(ts.router, prefix=API)
    with TestClient(app) as test_client:
        yield test_client

    store._cache = None
    store._cache_path = None


# ===== 헬퍼 ============================================================

def find(client, date=TOMORROW, party=2, day_part="any", conversation="c-test"):
    return client.post(
        f"{API}/voice/tools/find-tee-times",
        json={"date": date, "party_size": party, "day_part": day_part,
              "conversation_id": conversation},
    )


def hold(client, date=TOMORROW, time="8:01 AM", party=2, conversation="c-test"):
    return client.post(
        f"{API}/voice/tools/hold-tee-time",
        json={"date": date, "time": time, "party_size": party,
              "conversation_id": conversation},
    )


def confirm(client, hold_id, last="Nakamura", phone="905-892-1234", conversation="c-test"):
    return client.post(
        f"{API}/voice/tools/confirm-booking",
        json={"hold_id": hold_id, "first_name": "Jin", "last_name": last,
              "phone": phone, "conversation_id": conversation},
    )


def open_count(client, date=TOMORROW, party=4):
    """그 인원이 실제로 살 수 있는 티타임 개수.

    `options` 로 자리 반납을 검증하면 안 된다 — 그 목록은 `_spread` 가 하루치에서
    다섯 개만 균등 추출한 것이라, 자리가 돌아와도 표본에 안 뽑힐 수 있다.
    총 개수가 우리가 실제로 확인하려는 값이다.
    """
    return find(client, date=date, party=party).json()["total_open"]


def book(client, **kwargs):
    """찾기 → 잡기 → 확정 전체를 한 번에. 확정된 예약 요약을 돌려준다."""
    conversation = kwargs.pop("conversation", "c-test")
    held = hold(client, conversation=conversation, **kwargs)
    assert held.status_code == 200, held.text
    done = confirm(client, held.json()["hold_id"], conversation=conversation)
    assert done.status_code == 200, done.text
    return done.json()["booking"]


# ===== 빈 시간 찾기 ====================================================

def test_find_returns_open_times_with_a_spoken_message(client):
    body = find(client).json()

    assert body["ok"] is True
    assert body["date"] == TOMORROW
    assert body["spoken_date"] == "Wednesday, September 9"
    assert 0 < len(body["options"]) <= voice.MAX_OPTIONS
    assert all(option["seats_open"] >= 2 for option in body["options"])
    # 에이전트는 이 문장을 그대로 읽는다. 요금이 빠지면 손님이 가격을 못 듣는다.
    assert "$" in body["message"]


def test_find_hides_tee_times_that_already_passed_today(client):
    """오늘 06:00 기준. 6:40 은 아직 살 수 있고, 그 이전 시각은 애초에 없다."""
    times = [option["time"] for option in find(client, date=TODAY, party=1).json()["options"]]
    assert times, "오늘도 살 수 있는 시간이 있어야 한다"

    for label in times:
        assert ts.label_to_minutes(label) > 6 * 60, f"{label} 은 이미 지난 시각이다"


def test_find_respects_the_booking_window(client):
    far = (FIXED_NOW.date() + timedelta(days=voice.BOOKING_WINDOW_DAYS + 1)).isoformat()
    response = find(client, date=far)

    assert response.status_code == 422
    assert "14 days out" in response.json()["detail"]


def test_find_rejects_natural_language_dates(client):
    """"next Tuesday" 를 서버가 추측하면 손님이 엉뚱한 날에 온다. 되물어야 한다."""
    response = find(client, date="next Tuesday")

    assert response.status_code == 422
    assert TODAY in response.json()["detail"]


def test_find_accepts_today_and_tomorrow(client):
    assert find(client, date="tomorrow").json()["date"] == TOMORROW
    assert find(client, date="today").json()["date"] == TODAY


def test_a_full_tee_time_is_not_sold_again(client):
    """7:16 AM 은 시드에서 이미 4명이 다 찼다."""
    response = hold(client, date=TODAY, time="7:16 AM", party=1)
    assert response.status_code == 409
    assert "4 are already taken" in response.json()["detail"]


# ===== 홀드 ============================================================

def test_a_hold_takes_the_seats_off_the_sheet(client):
    before = open_count(client)

    assert hold(client, time="8:01 AM", party=4).status_code == 200

    assert open_count(client) == before - 1, "홀드한 자리가 아직도 팔리고 있다"


def test_a_hold_blocks_the_website_too(client):
    """웹 손님과 전화 손님이 같은 자리를 사면 안 된다 — 정원 검사는 한 곳뿐이다."""
    held = hold(client, time="8:01 AM", party=4)
    assert held.status_code == 200

    web = client.post(
        f"{API}/tee-sheet/bookings",
        json={"date": TOMORROW, "time": "8:01 AM", "title": "Web, Walk-in",
              "players": [{"name": "Web Walkin"}]},
    )
    assert web.status_code == 409


def test_an_expired_hold_gives_the_seats_back_immediately(client, monkeypatch):
    """정리 패스를 기다리지 않는다. 만료된 순간 정원 계산에서 빠져야 한다."""
    monkeypatch.setattr(ts, "HOLD_TTL_SECONDS", -1)  # 만들자마자 만료

    before = open_count(client)
    assert hold(client, time="8:01 AM", party=4).status_code == 200

    assert open_count(client) == before, "만료된 홀드가 아직 자리를 붙들고 있다"


def test_holding_more_than_the_tee_time_holds_fails(client):
    assert hold(client, time="8:01 AM", party=3).status_code == 200

    second = hold(client, time="8:01 AM", party=3)
    assert second.status_code == 409
    assert "4 players" in second.json()["detail"]


def test_release_hold_puts_the_seats_back(client):
    before = open_count(client)
    held = hold(client, time="8:01 AM", party=4).json()
    assert open_count(client) == before - 1

    released = client.post(
        f"{API}/voice/tools/release-hold",
        json={"hold_id": held["hold_id"], "conversation_id": "c-test"},
    )
    assert released.json()["released"] is True
    assert open_count(client) == before


def test_a_hold_cannot_be_placed_on_a_time_that_passed(client):
    """오늘 06:00 기준으로 6:40 이전 슬롯은 없지만, 어제 날짜는 아예 막힌다."""
    response = hold(client, date="2026-09-07", time="8:01 AM")
    assert response.status_code == 422
    assert "in the past" in response.json()["detail"]


# ===== 확정 ============================================================

def test_confirm_turns_a_hold_into_a_real_reservation(client):
    booking = book(client, time="8:01 AM", party=2)

    assert booking["status"] == "reserved"
    assert booking["party_size"] == 2
    assert booking["name"] == "Jin Nakamura"
    assert len(booking["confirmation_code"]) == 6

    stored = client.get(f"{API}/tee-sheet/bookings/{booking['booking_id']}").json()
    assert stored["source"] == "voice"
    assert stored["holdExpiresAt"] is None
    assert stored["title"] == "Nakamura, Jin"
    # 이름을 아는 사람은 전화한 손님 하나. 나머지 자리는 프로 샵이 체크인 때 채운다.
    assert stored["players"][0]["phone"] == "905-892-1234"
    assert stored["players"][1]["name"] == "Guest"


def test_confirming_an_expired_hold_fails_and_cleans_up(client, monkeypatch):
    held = hold(client, time="8:01 AM", party=2).json()
    monkeypatch.setattr(ts, "HOLD_TTL_SECONDS", -1)

    # 홀드를 강제로 만료시킨다 (통화가 길어져 3분을 넘긴 상황).
    with ts.bookings_tx() as bookings:
        for booking in bookings:
            if booking.id == held["hold_id"]:
                booking.holdExpiresAt = datetime.now(timezone.utc) - timedelta(seconds=1)

    response = confirm(client, held["hold_id"])
    assert response.status_code == 409
    assert "expired" in response.json()["detail"]

    # 유령 레코드가 남으면 안 된다.
    assert all(b["id"] != held["hold_id"] for b in client.get(f"{API}/tee-sheet/bookings").json())


def test_confirm_rejects_an_unusable_phone_number(client):
    held = hold(client, time="8:01 AM", party=1).json()
    response = confirm(client, held["hold_id"], phone="not a phone")
    assert response.status_code == 422


# ===== 조회 ============================================================

def test_lookup_needs_both_the_phone_and_the_last_name(client):
    book(client, time="8:01 AM", party=2)

    def lookup(phone, last):
        return client.post(
            f"{API}/voice/tools/lookup-booking",
            json={"phone": phone, "last_name": last, "conversation_id": "c-lookup"},
        ).json()

    assert lookup("905-892-1234", "Nakamura")["found"] == 1
    assert lookup("905-892-1234", "Wrongname")["found"] == 0
    assert lookup("905-000-0000", "Nakamura")["found"] == 0


def test_lookup_accepts_any_way_the_caller_says_the_number(client):
    book(client, time="8:01 AM", party=1)

    for spoken in ["(905) 892 1234", "+1 905 892 1234", "9058921234"]:
        found = client.post(
            f"{API}/voice/tools/lookup-booking",
            json={"phone": spoken, "last_name": "nakamura", "conversation_id": "c-phone"},
        ).json()
        assert found["found"] == 1, spoken


def test_lookup_never_returns_a_live_hold(client):
    hold(client, time="8:01 AM", party=2)
    found = client.post(
        f"{API}/voice/tools/lookup-booking",
        json={"phone": "905-892-1234", "last_name": "Nakamura", "conversation_id": "c-h"},
    ).json()
    assert found["found"] == 0


# ===== 취소 ============================================================

def cancel(client, booking_id, last="Nakamura", conversation="c-cancel"):
    return client.post(
        f"{API}/voice/tools/cancel-booking",
        json={"booking_id": booking_id, "last_name": last, "conversation_id": conversation},
    )


def lookup_first(client, conversation, phone="905-892-1234", last="Nakamura"):
    return client.post(
        f"{API}/voice/tools/lookup-booking",
        json={"phone": phone, "last_name": last, "conversation_id": conversation},
    )


def test_cancel_needs_a_lookup_on_the_same_call(client):
    booking = book(client, time="8:01 AM", party=2, conversation="c-booked")

    # 조회를 거치지 않은 다른 통화에서는 취소할 수 없다.
    denied = cancel(client, booking["booking_id"], conversation="c-stranger")
    assert denied.status_code == 403
    assert "Look the reservation up first" in denied.json()["detail"]

    lookup_first(client, "c-stranger")
    assert cancel(client, booking["booking_id"], conversation="c-stranger").status_code == 200


def test_cancel_without_a_conversation_is_refused(client):
    """`conversation_id` 를 빼는 것만으로 조회 게이트를 통과할 수 있으면 안 된다.

    그 값이 없으면 "이 통화에서 확인된 예약" 이라는 개념 자체가 성립하지 않는다.
    남는 검사는 성 하나뿐인데, 그건 두 열쇠 중 약한 쪽이다.
    """
    booking = book(client, time="8:01 AM", party=2, conversation="c-nogate")
    lookup_first(client, "c-nogate")

    denied = client.post(
        f"{API}/voice/tools/cancel-booking",
        json={"booking_id": booking["booking_id"], "last_name": "Nakamura"},
    )
    assert denied.status_code == 403
    assert "Look the reservation up first" in denied.json()["detail"]


def test_cancel_rejects_a_last_name_that_does_not_match(client):
    booking = book(client, time="8:01 AM", party=2, conversation="c-a")
    lookup_first(client, "c-a")

    denied = cancel(client, booking["booking_id"], last="Somebody", conversation="c-a")
    assert denied.status_code == 403
    assert "does not match" in denied.json()["detail"]


def test_cancel_gives_the_seats_back(client):
    before = open_count(client)
    booking = book(client, time="8:01 AM", party=4, conversation="c-b")
    assert open_count(client) == before - 1

    lookup_first(client, "c-b")
    assert cancel(client, booking["booking_id"], conversation="c-b").status_code == 200

    assert open_count(client) == before


def test_cancel_marks_the_booking_rather_than_deleting_it(client):
    """잘못 취소돼도 프로 샵이 티 시트에서 되돌릴 수 있어야 한다."""
    booking = book(client, time="8:01 AM", party=2, conversation="c-c")
    lookup_first(client, "c-c")
    cancel(client, booking["booking_id"], conversation="c-c")

    stored = client.get(f"{API}/tee-sheet/bookings/{booking['booking_id']}").json()
    assert stored["status"] == "cancelled"
    assert "phone assistant" in stored["cancelReason"]
    assert any("phone assistant" in entry["message"].lower() for entry in stored["audit"])


def test_cancel_within_two_hours_goes_to_the_pro_shop(client):
    """지금이 06:00, 티오프가 6:49 — 49분 뒤다. 사람이 판단할 구간이다."""
    booking = book(client, date=TODAY, time="6:49 AM", party=1, conversation="c-d")
    lookup_first(client, "c-d")

    denied = cancel(client, booking["booking_id"], conversation="c-d")
    assert denied.status_code == 409
    assert "pro shop" in denied.json()["detail"]


def test_cancel_outside_the_cutoff_is_allowed(client):
    """08:10 은 지금(06:00)으로부터 130분 뒤 — 문턱을 넘었다."""
    booking = book(client, date=TODAY, time="8:19 AM", party=1, conversation="c-e")
    lookup_first(client, "c-e")

    assert cancel(client, booking["booking_id"], conversation="c-e").status_code == 200


def test_cancelling_twice_is_harmless(client):
    booking = book(client, time="8:01 AM", party=1, conversation="c-f")
    lookup_first(client, "c-f")

    assert cancel(client, booking["booking_id"], conversation="c-f").status_code == 200
    again = cancel(client, booking["booking_id"], conversation="c-f")
    assert again.status_code == 200
    assert "already cancelled" in again.json()["message"]


# ===== 인증 ============================================================

def test_the_tool_secret_is_enforced_when_it_is_set(client, monkeypatch):
    monkeypatch.setenv("VOICE_TOOL_SECRET", "shhh")

    assert find(client).status_code == 401

    allowed = client.post(
        f"{API}/voice/tools/find-tee-times",
        json={"date": TOMORROW, "party_size": 2},
        headers={"X-Voice-Tool-Secret": "shhh"},
    )
    assert allowed.status_code == 200


def test_the_browser_endpoints_are_not_behind_the_tool_secret(client, monkeypatch):
    """브라우저와 ElevenLabs 웹훅은 그 시크릿을 가질 수 없다.

    `/voice/session` 을 도구와 같은 라우터에 두면, 시크릿을 켠 배포에서 웹 위젯이
    401 로 조용히 죽는다 — 손님에게는 그냥 "지금은 안 됩니다" 로만 보인다.
    post-call 웹훅도 마찬가지로 자기 서명(HMAC)을 쓰지 우리 헤더를 보내지 않는다.
    """
    monkeypatch.setenv("VOICE_TOOL_SECRET", "shhh")

    # 에이전트가 설정돼 있지 않아 503 이 맞다. 중요한 것은 **401 이 아니라는** 것.
    session = client.post(f"{API}/voice/session")
    assert session.status_code == 503, session.text

    webhook = client.post(f"{API}/voice/post-call", json={"data": {"conversation_id": "x"}})
    assert webhook.status_code == 200


def test_voice_sessions_are_rate_limited(client):
    """이 엔드포인트는 시크릿 없이 열려 있고, 한 번 부를 때마다 대화 크레딧을
    태울 수 있는 티켓이 나온다. 통화별 상한은 여기에 닿지 않는다."""
    for _ in range(voice.SESSION_RATE_LIMIT):
        assert client.post(f"{API}/voice/session").status_code == 503

    assert client.post(f"{API}/voice/session").status_code == 429
