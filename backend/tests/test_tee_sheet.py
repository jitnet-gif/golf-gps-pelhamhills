"""티 시트 백엔드 통합 테스트.

실행: `cd E:\\PELHAMHILLS && python -m pytest backend/tests/test_tee_sheet.py -q`

모든 테스트는 `TEE_SHEET_DATA_FILE` 를 tmp_path 로 돌려 실제 데이터 파일을 건드리지 않는다.
"""

from __future__ import annotations

import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.api.routes import tee_sheet as module  # noqa: E402
from backend.services import tee_sheet_store as store  # noqa: E402

API = "/api/v1"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv(store.ENV_VAR, str(tmp_path / "tee_sheet.json"))
    # 이전 테스트의 캐시를 확실히 버린다 (경로 키가 다르면 자동 무효화되지만 명시적으로).
    store._cache = None
    store._cache_path = None
    with module._task_lock:
        module._tasks.clear()

    app = FastAPI()
    app.include_router(module.router, prefix=API)
    with TestClient(app) as test_client:
        yield test_client

    store._cache = None
    store._cache_path = None


# ===== 헬퍼 ===========================================================

def slots_for(client, iso_date: str) -> dict:
    response = client.get(f"{API}/tee-sheet/slots", params={"date": iso_date})
    assert response.status_code == 200, response.text
    return response.json()


def wait_for_tasks(client, task_ids: list[str], timeout: float = 15.0) -> dict[str, dict]:
    deadline = time.time() + timeout
    last: dict[str, dict] = {}
    while time.time() < deadline:
        status = client.get(f"{API}/tee-sheet/orchestration/status").json()
        last = {t["id"]: t for t in status["tasks"]}
        if all(last.get(tid, {}).get("state") in ("success", "failed") for tid in task_ids):
            return last
        time.sleep(0.05)
    raise AssertionError(f"tasks did not reach a terminal state: {last}")


def create(client, **payload):
    return client.post(f"{API}/tee-sheet/bookings", json=payload)


# ===== 저장소 / 시드 ===================================================

def test_store_seeds_the_file_and_persists(client, tmp_path):
    data_file = tmp_path / "tee_sheet.json"
    bookings = client.get(f"{API}/tee-sheet/bookings").json()
    assert data_file.exists(), "store should seed the JSON file on first access"
    assert store.data_file() == data_file.resolve()
    assert len(bookings) == 13
    dates = sorted({b["date"] for b in bookings})
    assert dates == ["2026-09-10", "2026-09-11"]
    # dayIndex 는 와이어에서 사라져야 한다.
    assert all("dayIndex" not in b for b in bookings)
    assert all("span" in b for b in bookings)


def test_seed_names_round_trip(client):
    booking = client.get(f"{API}/tee-sheet/bookings/b-predote").json()
    names = [p["name"] for p in booking["players"]]
    assert names == ["Marie Predote", "Betty Lou DiMattio", "Roseann Norton", "Steve Murphy"]

    betty = booking["players"][1]
    assert betty["firstName"] == "Betty"
    assert betty["lastName"] == "Lou DiMattio"

    guest = client.get(f"{API}/tee-sheet/bookings/b-carlsson").json()["players"][1]
    assert (guest["name"], guest["firstName"], guest["lastName"]) == ("Guest", "Guest", "")


def test_every_seeded_time_is_a_real_slot(client):
    bookings = client.get(f"{API}/tee-sheet/bookings").json()
    cache: dict[str, set[str]] = {}
    for booking in bookings:
        if booking["date"] not in cache:
            cache[booking["date"]] = {s["time"] for s in slots_for(client, booking["date"])["slots"]}
        assert booking["time"] in cache[booking["date"]], (
            f"{booking['id']} at {booking['time']} is not a slot on {booking['date']}"
        )


# ===== 슬롯 ===========================================================

def test_slots_shape_and_rates(client):
    thursday = slots_for(client, "2026-09-10")          # 평일
    friday = slots_for(client, "2026-09-11")            # 평일이지만 오버라이드
    saturday = slots_for(client, "2026-09-12")          # 주말

    slots = thursday["slots"]
    assert thursday["date"] == "2026-09-10"
    assert slots[0] == {"time": "6:40 AM", "minutes": 400, "rate": 47.79, "cartsTotal": 4}
    assert slots[1]["time"] == "6:49 AM"
    assert slots[-1]["minutes"] <= 18 * 60
    assert slots[-1]["minutes"] + 9 > 18 * 60
    # 9분 간격이 끝까지 유지되는지
    assert all(b["minutes"] - a["minutes"] == 9 for a, b in zip(slots, slots[1:]))
    assert all(s["cartsTotal"] == 4 for s in slots)

    assert {s["rate"] for s in friday["slots"]} == {58.41}
    assert {s["rate"] for s in saturday["slots"]} == {58.41}
    assert len(friday["slots"]) == len(slots) == len(saturday["slots"])


def test_slots_rejects_bad_date(client):
    assert client.get(f"{API}/tee-sheet/slots", params={"date": "Sept 11"}).status_code == 422


# ===== 목록 / 필터 =====================================================

def test_list_filters_by_date_and_range(client):
    day = client.get(f"{API}/tee-sheet/bookings", params={"date": "2026-09-10"}).json()
    assert len(day) == 6
    assert all(b["date"] == "2026-09-10" for b in day)
    assert [b["time"] for b in day] == ["6:58 AM", "7:07 AM", "7:16 AM", "7:25 AM", "8:01 AM", "8:10 AM"]

    ranged = client.get(
        f"{API}/tee-sheet/bookings", params={"from": "2026-09-11", "to": "2026-09-30"}
    ).json()
    assert len(ranged) == 7
    assert all(b["date"] == "2026-09-11" for b in ranged)

    empty = client.get(
        f"{API}/tee-sheet/bookings", params={"from": "2026-01-01", "to": "2026-01-31"}
    ).json()
    assert empty == []

    everything = client.get(f"{API}/tee-sheet/bookings").json()
    assert len(everything) == 13
    keys = [(b["date"], b["time"]) for b in everything]
    assert keys == sorted(keys, key=lambda kv: (kv[0], module.label_to_minutes(kv[1])))


# ===== 생성 ===========================================================

def test_create_booking_defaults_rate_from_slot(client):
    response = create(client, date="2026-09-10", time="9:04 AM", title="Walk-in, Pat")
    assert response.status_code == 201, response.text
    booking = response.json()
    assert booking["rate"] == 47.79          # 평일 요금이 슬롯에서 흘러들어와야 한다
    assert booking["date"] == "2026-09-10"
    assert booking["status"] == "reserved"
    assert booking["span"] == 1
    assert booking["audit"][0]["message"] == "Reservation created for 2026-09-10 9:04 AM."

    weekend = create(client, date="2026-09-12", time="9:04 AM", title="Weekend, Sam").json()
    assert weekend["rate"] == 58.41


def test_create_rejects_unknown_slot_with_422(client):
    bad = create(client, date="2026-09-10", time="9:05 AM", title="Off grid")
    assert bad.status_code == 422
    assert "not a bookable tee time" in bad.json()["detail"]

    too_early = create(client, date="2026-09-10", time="6:00 AM", title="Too early")
    assert too_early.status_code == 422

    too_late = create(client, date="2026-09-10", time="7:00 PM", title="Too late")
    assert too_late.status_code == 422

    garbage = create(client, date="2026-09-10", time="nope", title="Garbage")
    assert garbage.status_code == 422


def test_create_rejects_double_booking_with_409(client):
    clash = create(client, date="2026-09-10", time="6:58 AM", title="Clash, Joe")
    assert clash.status_code == 409
    assert "already booked" in clash.json()["detail"]

    # 같은 시각이라도 날짜가 다르면 충돌이 아니다 (6:58 AM 은 두 날짜 모두에 존재).
    ok = create(client, date="2026-09-12", time="6:58 AM", title="Other day")
    assert ok.status_code == 201


def test_create_splits_supplied_names(client):
    response = create(
        client,
        date="2026-09-10",
        time="9:13 AM",
        title="Names, Test",
        players=[
            {"name": "Betty Lou DiMattio"},
            {"name": "Guest"},
            {"firstName": "Ada", "lastName": "Lovelace"},
        ],
    )
    assert response.status_code == 201, response.text
    players = response.json()["players"]
    assert (players[0]["firstName"], players[0]["lastName"]) == ("Betty", "Lou DiMattio")
    assert (players[1]["name"], players[1]["firstName"], players[1]["lastName"]) == ("Guest", "Guest", "")
    assert players[2]["name"] == "Ada Lovelace"


# ===== 조회 / 삭제 =====================================================

def test_get_booking_and_404(client):
    booking = client.get(f"{API}/tee-sheet/bookings/b-sep11-kicul")
    assert booking.status_code == 200
    assert booking.json()["title"] == "Kicul, Marty"
    assert client.get(f"{API}/tee-sheet/bookings/nope").status_code == 404


def test_delete_booking(client):
    assert client.delete(f"{API}/tee-sheet/bookings/b-wheeland").status_code == 204
    assert client.get(f"{API}/tee-sheet/bookings/b-wheeland").status_code == 404
    assert len(client.get(f"{API}/tee-sheet/bookings").json()) == 12
    assert client.delete(f"{API}/tee-sheet/bookings/b-wheeland").status_code == 404


# ===== PATCH ==========================================================

def test_patch_status_transitions_and_uncancel(client):
    url = f"{API}/tee-sheet/bookings/b-sep11-nicalou"

    checked_in = client.patch(url, json={"status": "checked_in"}).json()
    assert checked_in["status"] == "checked_in"
    assert all(p["arrived"] for p in checked_in["players"])
    assert checked_in["audit"][0]["message"] == "Reservation checked in."

    paid = client.patch(url, json={"status": "paid"}).json()
    assert all(p["paid"] and p["arrived"] for p in paid["players"])

    cancelled = client.patch(url, json={"status": "cancelled", "cancelReason": "Rain"}).json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["cancelReason"] == "Rain"
    assert all(p["cancelled"] for p in cancelled["players"])
    assert cancelled["audit"][0]["message"] == "Reservation cancelled: Rain"

    reserved = client.patch(url, json={"status": "reserved"}).json()
    assert reserved["status"] == "reserved"
    assert reserved["cancelReason"] is None
    assert not any(p["cancelled"] for p in reserved["players"])
    # 복구된 예약은 결제/체크인 상태까지 되돌아가야 한다. 그러지 않으면
    # collected_revenue 가 실제로 받지 않은 돈을 계상한다.
    assert not any(p["paid"] for p in reserved["players"])
    assert not any(p["arrived"] for p in reserved["players"])
    assert not any(p["no_show"] for p in reserved["players"])
    assert reserved["audit"][0]["message"] == "Reservation reinstated as reserved."

    report = client.get(f"{API}/tee-sheet/reports/daily", params={"date": "2026-09-11"}).json()
    assert report["collected_revenue"] == 0
    assert report["cancelled"] == 0 and report["checked_in"] == 0


def test_patch_writes_specific_audit_lines(client):
    url = f"{API}/tee-sheet/bookings/b-sep11-kicul"
    booking = client.patch(url, json={"cartCount": 2, "holes": 9, "rate": 30.0,
                                      "color": "gray", "title": "Kicul, Martin",
                                      "notes": "Back nine only"}).json()
    messages = [entry["message"] for entry in booking["audit"]]
    assert "Cart count set to 2." in messages
    assert "Holes set to 9." in messages
    assert "Rate set to $30.00." in messages
    assert "Color set to gray." in messages
    assert "Title changed to 'Kicul, Martin'." in messages
    assert "Notes updated." in messages
    assert booking["cartCount"] == 2 and booking["holes"] == 9 and booking["color"] == "gray"

    # 값이 바뀌지 않으면 감사 로그를 남기지 않는다.
    before = len(booking["audit"])
    again = client.patch(url, json={"cartCount": 2}).json()
    assert len(again["audit"]) == before


def test_patch_moves_booking_to_another_slot(client):
    url = f"{API}/tee-sheet/bookings/b-sep11-kicul"
    moved = client.patch(url, json={"date": "2026-09-12", "time": "7:25 AM"})
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert (body["date"], body["time"]) == ("2026-09-12", "7:25 AM")
    assert body["audit"][0]["message"] == "Moved to 2026-09-12 7:25 AM."
    assert client.get(f"{API}/tee-sheet/bookings", params={"date": "2026-09-11"}).json().__len__() == 6

    # 존재하지 않는 슬롯으로는 이동 불가
    assert client.patch(url, json={"time": "7:26 AM"}).status_code == 422
    # 이미 찬 슬롯으로도 이동 불가
    conflict = client.patch(url, json={"date": "2026-09-10", "time": "6:58 AM"})
    assert conflict.status_code == 409
    # 실패한 이동이 원본을 건드리지 않았는지
    assert client.get(url).json()["date"] == "2026-09-12"


def test_patch_to_its_own_slot_is_a_noop_not_a_conflict(client):
    url = f"{API}/tee-sheet/bookings/b-predote"
    response = client.patch(url, json={"date": "2026-09-10", "time": "6:58 AM"})
    assert response.status_code == 200
    assert response.json()["time"] == "6:58 AM"


# ===== 플레이어 =======================================================

def test_add_patch_remove_player(client):
    url = f"{API}/tee-sheet/bookings/b-sep11-nicalou"     # 2명

    added = client.post(f"{url}/players", json={"name": "Betty Lou DiMattio"})
    assert added.status_code == 200, added.text
    players = added.json()["players"]
    assert len(players) == 3
    new_player = players[-1]
    assert (new_player["firstName"], new_player["lastName"]) == ("Betty", "Lou DiMattio")
    assert added.json()["audit"][0]["message"] == "Player added: Betty Lou DiMattio."

    # firstName 만 패치하면 name 이 재계산된다
    patched = client.patch(f"{url}/players/{new_player['id']}", json={"firstName": "Elizabeth"}).json()
    updated = patched["players"][-1]
    assert updated["name"] == "Elizabeth Lou DiMattio"
    assert updated["lastName"] == "Lou DiMattio"

    # name 만 패치하면 다시 쪼개진다
    patched = client.patch(f"{url}/players/{new_player['id']}", json={"name": "Ada Lovelace"}).json()
    updated = patched["players"][-1]
    assert (updated["firstName"], updated["lastName"]) == ("Ada", "Lovelace")

    # 단일 토큰 이름
    patched = client.patch(f"{url}/players/{new_player['id']}", json={"name": "Guest"}).json()
    updated = patched["players"][-1]
    assert (updated["name"], updated["firstName"], updated["lastName"]) == ("Guest", "Guest", "")

    # 비이름 필드 패치는 이름을 건드리지 않는다
    patched = client.patch(f"{url}/players/{new_player['id']}", json={"paid": True}).json()
    assert patched["players"][-1]["name"] == "Guest"
    assert patched["players"][-1]["paid"] is True

    removed = client.delete(f"{url}/players/{new_player['id']}")
    assert removed.status_code == 200
    assert len(removed.json()["players"]) == 2
    assert client.delete(f"{url}/players/{new_player['id']}").status_code == 404


def test_player_guards(client):
    full = f"{API}/tee-sheet/bookings/b-predote"          # 이미 4명
    too_many = client.post(f"{full}/players", json={"name": "Fifth Wheel"})
    assert too_many.status_code == 422
    assert "at most 4 players" in too_many.json()["detail"]

    single = create(client, date="2026-09-10", time="9:22 AM", title="Solo, Han",
                    players=[{"name": "Han Solo"}]).json()
    player_id = single["players"][0]["id"]
    last_one = client.delete(f"{API}/tee-sheet/bookings/{single['id']}/players/{player_id}")
    assert last_one.status_code == 422
    assert "at least one player" in last_one.json()["detail"]


# ===== 리포트 =========================================================

def test_daily_report_numbers(client):
    slots = slots_for(client, "2026-09-10")["slots"]
    report = client.get(f"{API}/tee-sheet/reports/daily", params={"date": "2026-09-10"}).json()

    assert report["date"] == "2026-09-10"
    assert report["total_slots"] == len(slots) * 4          # len(bookings)*4 가 아니다
    assert report["total_tee_times"] == 6
    assert report["booked_slots"] == 20
    assert report["available_slots"] == report["total_slots"] - 20
    assert report["total_revenue"] == pytest.approx(20 * 47.79, abs=0.01)
    assert report["collected_revenue"] == 0
    assert report["outstanding_revenue"] == pytest.approx(report["total_revenue"], abs=0.01)
    assert report["carts"] == 6
    assert report["checked_in"] == 0 and report["cancelled"] == 0 and report["no_show"] == 0
    assert report["occupancy_rate"] == pytest.approx(20 / report["total_slots"] * 100, abs=0.01)
    line = report["bookings"][0]
    assert line["title"] == "Predote, Marie" and line["status"] == "reserved" and line["players"] == 4


def test_daily_report_revenue_reacts_to_paid_and_cancelled(client):
    client.patch(f"{API}/tee-sheet/bookings/b-nicalou", json={"status": "paid"})       # 2명 x 47.79
    client.patch(f"{API}/tee-sheet/bookings/b-carlsson", json={"status": "cancelled"})  # 3명 제외

    report = client.get(f"{API}/tee-sheet/reports/daily", params={"date": "2026-09-10"}).json()
    assert report["total_tee_times"] == 6           # 시트에는 여전히 6건
    assert report["cancelled"] == 1
    assert report["booked_slots"] == 17             # 취소된 3명 제외
    assert report["total_revenue"] == pytest.approx(17 * 47.79, abs=0.01)
    assert report["collected_revenue"] == pytest.approx(2 * 47.79, abs=0.01)
    assert report["outstanding_revenue"] == pytest.approx(15 * 47.79, abs=0.01)
    assert report["carts"] == 6 - 0                 # b-carlsson 은 카트 0대였다


def test_week_report_explicit_range(client):
    report = client.get(
        f"{API}/tee-sheet/reports/week", params={"from": "2026-09-07", "to": "2026-09-13"}
    ).json()

    assert report["from"] == "2026-09-07" and report["to"] == "2026-09-13"
    assert len(report["days"]) == 7
    assert [d["date"] for d in report["days"]][0] == "2026-09-07"
    assert report["summary"]["total_days"] == 7
    assert report["summary"]["total_tee_times"] == 13
    assert report["summary"]["total_booked_slots"] == 20 + 22
    assert report["summary"]["total_revenue"] == pytest.approx(20 * 47.79 + 22 * 58.41, abs=0.02)
    assert report["summary"]["collected_revenue"] == 0
    capacity = sum(d["total_slots"] for d in report["days"])
    assert report["summary"]["average_occupancy"] == pytest.approx(42 / capacity * 100, abs=0.01)


def test_week_report_defaults_to_current_iso_week(client):
    report = client.get(f"{API}/tee-sheet/reports/week").json()
    assert len(report["days"]) == 7
    monday = date.fromisoformat(report["from"])
    assert monday.weekday() == 0
    assert date.fromisoformat(report["to"]) - monday == timedelta(days=6)


def test_week_report_rejects_inverted_range(client):
    bad = client.get(f"{API}/tee-sheet/reports/week", params={"from": "2026-09-13", "to": "2026-09-07"})
    assert bad.status_code == 422


# ===== cleanup ========================================================

def test_cleanup_actually_deletes(client):
    ack = client.post(f"{API}/tee-sheet/orchestration/cleanup", params={"before": "2026-09-11"})
    assert ack.status_code == 200
    body = ack.json()
    assert body["accepted"] is True and len(body["tasks"]) == 1
    assert body["tasks"][0]["state"] == "queued"

    finished = wait_for_tasks(client, [body["tasks"][0]["id"]])[body["tasks"][0]["id"]]
    assert finished["state"] == "success", finished
    assert finished["result"]["deleted"] == 6
    assert finished["result"]["remaining"] == 7
    assert finished["duration_ms"] is not None

    survivors = client.get(f"{API}/tee-sheet/bookings").json()
    assert len(survivors) == 7
    assert {b["date"] for b in survivors} == {"2026-09-11"}


def test_cleanup_is_idempotent(client):
    for expected in (6, 0):
        ack = client.post(f"{API}/tee-sheet/orchestration/cleanup", params={"before": "2026-09-11"}).json()
        task_id = ack["tasks"][0]["id"]
        result = wait_for_tasks(client, [task_id])[task_id]["result"]
        assert result["deleted"] == expected


# ===== worker sync pass ===============================================

def test_worker_is_deterministic_and_never_random(client):
    # 카트 수가 인원보다 많은 예약을 하나 만들어 둔다 -> 안정적인 finding 소스
    client.patch(f"{API}/tee-sheet/bookings/b-sep11-nicalou", json={"cartCount": 4})

    runs = []
    for _ in range(3):
        ack = client.post(f"{API}/tee-sheet/worker/run", params={"date": "2026-09-11"}).json()
        task_id = ack["tasks"][0]["id"]
        runs.append(wait_for_tasks(client, [task_id])[task_id]["result"])

    assert runs[0] == runs[1] == runs[2], "sync pass must be deterministic"
    assert runs[0]["scanned"] == 7
    assert runs[0]["updated"] == 0           # 미래 날짜라 아무것도 바뀌면 안 된다
    issues = [f["issue"] for f in runs[0]["findings"]]
    assert issues == ["cart_count_exceeds_players"]

    # 예약 상태도 전혀 변하지 않았어야 한다
    statuses = {b["status"] for b in client.get(f"{API}/tee-sheet/bookings").json()}
    assert statuses == {"reserved"}


def test_worker_marks_stale_reservations_no_show_once(client):
    past = (date.today() - timedelta(days=400)).isoformat()
    stale = create(client, date=past, time="6:40 AM", title="Stale, Sam",
                   players=[{"name": "Sam Stale"}]).json()

    ack = client.post(f"{API}/tee-sheet/worker/run", params={"date": past}).json()
    first = wait_for_tasks(client, [ack["tasks"][0]["id"]])[ack["tasks"][0]["id"]]["result"]
    assert first["updated"] == 1
    assert first["findings"][0]["issue"] == "past_tee_time_still_reserved"
    assert first["findings"][0]["action"] == "marked_no_show"

    booking = client.get(f"{API}/tee-sheet/bookings/{stale['id']}").json()
    assert booking["status"] == "no_show"
    assert booking["players"][0]["no_show"] is True

    # 두 번째 호출은 더 이상 아무것도 바꾸지 않는다
    ack2 = client.post(f"{API}/tee-sheet/worker/run", params={"date": past}).json()
    second = wait_for_tasks(client, [ack2["tasks"][0]["id"]])[ack2["tasks"][0]["id"]]["result"]
    assert second["updated"] == 0
    assert second["findings"] == []
    assert client.get(f"{API}/tee-sheet/bookings/{stale['id']}").json()["status"] == "no_show"


# ===== 오케스트레이션 =================================================

def test_orchestration_status_shape(client):
    status = client.get(f"{API}/tee-sheet/orchestration/status").json()
    assert status["status"] == "ready"
    assert status["total_bookings"] == 13
    assert status["tasks"] == []
    names = {t["name"] for t in status["available_tasks"]}
    assert names == {"daily_batch", "send_reminders", "cleanup", "worker_sync"}
    assert all({"name", "description", "endpoint"} <= set(t) for t in status["available_tasks"])


def test_daily_batch_runs_subtasks_in_parallel(client):
    ack = client.post(f"{API}/tee-sheet/orchestration/daily-batch", params={"date": "2026-09-11"})
    assert ack.status_code == 200
    body = ack.json()
    assert body["accepted"] is True
    assert len(body["tasks"]) == 1
    task_id = body["tasks"][0]["id"]
    assert body["tasks"][0]["state"] == "queued"
    assert body["tasks"][0]["finished_at"] is None

    task = wait_for_tasks(client, [task_id])[task_id]
    assert task["state"] == "success", task
    assert task["started_at"] is not None and task["finished_at"] is not None
    assert task["error"] is None

    result = task["result"]
    assert result["failed_subtasks"] == 0
    subtasks = {s["task"]: s for s in result["subtasks"]}
    assert set(subtasks) == {"send_reminders", "generate_report", "refresh_availability"}
    assert all(s["status"] == "success" for s in subtasks.values())
    assert subtasks["generate_report"]["total_tee_times"] == 7
    assert subtasks["refresh_availability"]["taken_slots"] == 7

    # 진짜 병렬인지: 벽시계 시간이 각 파트 합보다 확연히 작아야 한다.
    parts = [s["duration_ms"] for s in result["subtasks"]]
    assert result["sequential_ms"] == sum(parts)
    assert result["duration_ms"] < result["sequential_ms"] * 0.75, result
    assert result["duration_ms"] < max(parts) + 200, result
    assert result["speedup"] > 1.3


def test_send_reminders_task_reaches_terminal_state(client):
    ack = client.post(f"{API}/tee-sheet/orchestration/send-reminders", params={"date": "2026-09-11"}).json()
    task_id = ack["tasks"][0]["id"]
    task = wait_for_tasks(client, [task_id])[task_id]
    assert task["state"] == "success"
    assert task["result"]["bookings"] == 7
    assert task["result"]["recipients"] == 22


def test_task_failure_is_recorded_not_crashed(client, monkeypatch):
    def boom(_iso_date):
        raise RuntimeError("mail gateway down")

    monkeypatch.setattr(module, "send_reminders", boom)
    ack = client.post(f"{API}/tee-sheet/orchestration/send-reminders", params={"date": "2026-09-11"}).json()
    task_id = ack["tasks"][0]["id"]
    task = wait_for_tasks(client, [task_id])[task_id]
    assert task["state"] == "failed"
    assert "mail gateway down" in task["error"]
    assert task["finished_at"] is not None
    # 서버는 살아 있어야 한다
    assert client.get(f"{API}/tee-sheet/bookings").status_code == 200


def test_task_registry_is_capped(client):
    ids = []
    for _ in range(module.MAX_TASKS + 5):
        ack = client.post(f"{API}/tee-sheet/orchestration/send-reminders",
                          params={"date": "2026-09-11"}).json()
        ids.append(ack["tasks"][0]["id"])
    wait_for_tasks(client, ids[-5:], timeout=30.0)
    tasks = client.get(f"{API}/tee-sheet/orchestration/status").json()["tasks"]
    assert len(tasks) == module.MAX_TASKS
    assert tasks[0]["id"] == ids[-1]        # 최신순


def test_orchestration_rejects_bad_date(client):
    assert client.post(f"{API}/tee-sheet/orchestration/daily-batch",
                       params={"date": "11/09/2026"}).status_code == 422
