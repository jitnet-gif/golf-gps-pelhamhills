"""티 시트 저장소의 범위(`Scope`) 읽기·쓰기 테스트.

실행: `cd E:\\PELHAMHILLS && python -m pytest backend/tests/test_tee_sheet_scoped_store.py -q`

과거 예약 수천 건을 들여온 뒤에도 요청마다 테이블 전체를 읽지 않는지, 그리고 범위를
좁힌 탓에 정원 검사가 모자란 목록을 세지 않는지를 본다.
- `env` 픽스처는 json / supabase 두 엔진에서 한 번씩 돈다 (supabase 는 인메모리 가짜).
- "범위로 읽는다" 와 "범위로 읽는 것처럼 보인다" 는 supabase 요청 모양으로만 가려진다.
  그래서 라우트별로 `booking_date=...` / `id=in.(...)` / `hold_expires_at=not.is.null`
  필터가 실제로 나갔는지, 필터 없는 스캔이 한 번도 없었는지를 센다.
- ⚠️ 실패 메시지에 예약 내용을 싣지 않는다 (id·날짜·건수만).
"""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import tee_sheet as ts
from backend.api.routes import voice
from backend.services import tee_sheet_store as store
from backend.services import tee_sheet_supabase as sb
from backend.services.tee_sheet_store import Scope
from backend.tests.fake_postgrest import FakePostgrest, install

API = "/api/v1"
BACKENDS = ("json", "supabase")
SEED_DATE = "2026-09-08"
SEED_COUNT = 11
TOMORROW = "2026-09-09"
NEW_DATE = "2026-09-10"
MOVED_DATE = "2026-09-11"
# 음성 도구는 "지나간 티타임은 팔지 않는다" 라서 시계를 시드 날 아침 6시로 고정한다.
FIXED_NOW = datetime(2026, 9, 8, 6, 0, tzinfo=voice.CLUB_TIMEZONE)


@dataclass
class Env:
    kind: str
    client: TestClient
    fake: FakePostgrest | None
    data_file: Path


@contextmanager
def open_backend(kind: str, mp: pytest.MonkeyPatch, data_dir: Path) -> Iterator[Env]:
    data_file = data_dir / "tee_sheet.json"
    # supabase 모드에서도 데이터 파일을 tmp 로 돌린다 (엔진 판정을 놓친 경로가 실제 파일을 덮지 않게).
    mp.setenv(store.ENV_VAR, str(data_file))
    mp.setenv(store.BACKEND_ENV_VAR, "json")
    mp.setenv("VOICE_TOOL_SECRET", "")
    mp.setenv("ELEVENLABS_AGENT_ID", "")
    mp.setenv("ELEVENLABS_WEBHOOK_SECRET", "")
    mp.setattr(voice, "club_now", lambda: FIXED_NOW)
    store.drop_cache()
    with ts._task_lock:
        ts._tasks.clear()
    with voice._sessions_lock:
        voice._sessions.clear()
    with voice._session_rate_lock:
        voice._session_hits.clear()

    fake = install(mp) if kind == "supabase" else None
    store.reset()

    app = FastAPI()
    app.include_router(voice.router, prefix=API)
    app.include_router(ts.router, prefix=API)
    try:
        with TestClient(app) as client:
            yield Env(kind, client, fake, data_file)
    finally:
        store.drop_cache()


@pytest.fixture(params=BACKENDS)
def env(request, tmp_path, monkeypatch) -> Iterator[Env]:
    with open_backend(request.param, monkeypatch, tmp_path) as opened:
        yield opened


@pytest.fixture()
def supa(tmp_path, monkeypatch) -> Iterator[Env]:
    with open_backend("supabase", monkeypatch, tmp_path) as opened:
        yield opened


def booking_doc(booking_id: str, day: str, **extra: Any) -> dict[str, Any]:
    stamp = "2026-09-01T12:00:00+00:00"
    doc = {"id": booking_id, "date": day, "time": "9:04 AM", "title": "Test, Booking",
           "players": [], "createdAt": stamp, "updatedAt": stamp}
    doc.update(extra)
    return doc


def add(doc: dict[str, Any]) -> None:
    """범위 트랜잭션으로 한 건 넣는다 (새 id 라 읽히는 것은 없다)."""
    with store.mutate(Scope(ids={doc["id"]})) as working:
        working.append(doc)


def in_(*values: str) -> str:
    return "in.(" + ",".join(f'"{value}"' for value in values) + ")"


def has_filter(params: dict[str, Any], column: str, value: Any) -> bool:
    got = params.get(column)
    return got == value or (isinstance(got, list) and value in got)


def assert_scoped(fake: FakePostgrest, since: int, name: str, expected: tuple[tuple[str, Any], ...]) -> None:
    gets = [params for method, _, params in fake.requests[since:] if method == "GET"]
    assert gets, f"{name}: no read at all"
    assert fake.table_scans(since) == [], f"{name}: {len(fake.table_scans(since))} unfiltered scan(s)"
    for column, value in expected:
        assert any(has_filter(g, column, value) for g in gets), f"{name}: missing {column} filter"


# ===== Scope ===========================================================


def test_scope_refuses_a_bare_string():
    # frozenset("2026-09-12") 는 글자 집합이다. 그대로 두면 아무 예약도 안 읽힌다.
    with pytest.raises(TypeError):
        Scope(dates="2026-09-12")
    with pytest.raises(TypeError):
        Scope(ids="b-elm")


def test_scope_covers_dates_only_through_dates_or_the_range():
    scope = Scope(dates={"2026-09-12"}, ids={"b-x"}, holds=True)
    assert scope.covers_date("2026-09-12")
    assert not scope.covers_date("2026-09-13"), "ids·holds 는 날짜를 '다 읽었다' 고 말하지 않는다"
    assert Scope(date_from="2026-09-10").covers_date("2099-01-01")
    assert not Scope(date_from="2026-09-10").covers_date("2026-09-09")
    assert Scope(date_to="2026-09-10").covers_date("2026-09-10")
    assert not Scope().covers_date("2026-09-10")


def test_scope_matches_is_a_union():
    scope = Scope(dates={"2026-09-12"}, ids={"b-x"}, holds=True)
    assert scope.matches({"id": "a", "date": "2026-09-12"})
    assert scope.matches({"id": "b-x", "date": "2026-01-01"})
    assert scope.matches({"id": "h", "date": "2026-01-01", "holdExpiresAt": "2026-01-01T10:00:00+00:00"})
    assert not scope.matches({"id": "h", "date": "2026-01-01", "holdExpiresAt": ""})
    assert not scope.matches({"id": "z", "date": "2026-09-13"})


# ===== 저장소 계약 (두 엔진) ==========================================


def test_scoped_mutate_leaves_rows_outside_the_scope_alone(env: Env):
    add(booking_doc("x-0909", TOMORROW))
    seed_before = store.load_bookings(Scope(dates={SEED_DATE}))
    stamps = {i: row["synced_at"] for i, row in env.fake.rows.items()} if env.fake else {}
    mark = len(env.fake.requests) if env.fake else 0

    with store.mutate(Scope(dates={TOMORROW})) as working:
        assert [d["id"] for d in working] == ["x-0909"]
        working.clear()

    assert store.load_bookings(Scope(dates={SEED_DATE})) == seed_before
    assert store.count_bookings() == SEED_COUNT
    if env.fake is not None:
        assert set(env.fake.rows) == set(stamps) - {"x-0909"}
        # 범위 밖 행은 다시 쓰지도 않았다 (쓰면 synced_at 이 바뀐다).
        assert all(env.fake.rows[i]["synced_at"] == stamps[i] for i in env.fake.rows)
        assert [(m, p) for m, _, p in env.fake.writes(mark)] == [("DELETE", {"id": in_("x-0909")})]

    # 아무것도 읽지 못한 범위를 비워도 아무것도 지워지지 않는다.
    with store.mutate(Scope(dates={NEW_DATE})) as working:
        assert working == []
        working.clear()
    assert store.count_bookings() == SEED_COUNT


def test_booking_moved_out_of_the_loaded_date_is_upserted_not_deleted(env: Env):
    add(booking_doc("mover", "2026-09-12"))
    mark = len(env.fake.requests) if env.fake else 0

    with store.mutate(Scope(dates={"2026-09-12"})) as working:
        [moving] = working
        moving["date"] = "2026-09-13"   # 쓸 때 범위를 다시 계산하면 이게 "사라진 행" 이 된다

    assert [d["date"] for d in store.load_bookings(Scope(ids={"mover"}))] == ["2026-09-13"]
    assert store.load_bookings(Scope(dates={"2026-09-12"})) == []
    assert store.count_bookings() == SEED_COUNT + 1
    if env.fake is not None:
        assert env.fake.rows["mover"]["booking_date"] == "2026-09-13"
        assert [m for m, _, _ in env.fake.writes(mark)] == ["POST"]


def test_scoped_mutate_exception_writes_nothing(env: Env):
    before = store.load_bookings()
    mark = len(env.fake.requests) if env.fake else 0
    file_before = env.data_file.read_bytes() if env.fake is None else None

    with pytest.raises(RuntimeError):
        with store.mutate(Scope(dates={SEED_DATE})) as working:
            working.clear()
            raise RuntimeError("abort")

    assert store.load_bookings() == before
    if env.fake is not None:
        assert env.fake.writes(mark) == []
    else:
        assert env.data_file.read_bytes() == file_before


def test_cleanup_that_empties_the_sheet_reports_zero_remaining(env: Env):
    # remaining 은 커밋 뒤 count 로 센다. JSON 모드에서 그 count 가 빈 파일을 "없는 파일" 로
    # 보고 시드를 다시 심으면 빈 시트에 11 이 찍힌다. 캐시를 버린 뒤에도 0 이어야 한다.
    result = ts.cleanup_expired_bookings("2026-09-09")
    assert (result["deleted"], result["remaining"]) == (SEED_COUNT, 0)
    store.drop_cache()
    assert store.count_bookings() == 0
    assert store.load_bookings() == []


def test_count_bookings(env: Env):
    assert store.count_bookings() == SEED_COUNT
    add(booking_doc("x-count", TOMORROW))
    assert store.count_bookings() == SEED_COUNT + 1
    if env.fake is not None:
        mark = len(env.fake.requests)
        store.count_bookings()
        [(method, _, params)] = env.fake.requests[mark:]
        assert (method, params) == ("GET", {"select": "id", "limit": "0"})
        assert env.fake.raw_requests[-1].headers["prefer"] == "count=exact"


def test_scoped_load_is_the_same_union_in_both_backends(env: Env):
    for doc in (
        booking_doc("h-live", "2026-09-20", holdExpiresAt="2026-09-20T10:00:00+00:00"),
        # "" 는 홀드가 아니다. supabase 는 to_row 가 NULL 로 적어 not.is.null 에 안 걸린다.
        booking_doc("h-empty", "2026-09-21", holdExpiresAt=""),
        booking_doc("r-1", "2026-09-14"),
        booking_doc("r-2", "2026-09-16"),
        booking_doc("r-3", "2026-09-18"),
    ):
        add(doc)

    def ids(scope: Scope) -> list[str]:
        return sorted(d["id"] for d in store.load_bookings(scope))

    assert ids(Scope(holds=True)) == ["h-live"]
    assert ids(Scope(date_from="2026-09-15", date_to="2026-09-18")) == ["r-2", "r-3"]
    assert ids(Scope(date_from="2026-09-17")) == ["h-empty", "h-live", "r-3"]
    assert "r-1" in ids(Scope(date_to="2026-09-14")) and len(ids(Scope(date_to="2026-09-14"))) == SEED_COUNT + 1
    assert ids(Scope(dates={"2026-09-14"}, ids={"r-3"}, holds=True)) == ["h-live", "r-1", "r-3"]
    assert ids(Scope()) == []


# ===== 정원 검사는 읽지 않은 날짜를 세지 않는다 ========================


def test_capacity_check_refuses_a_list_that_did_not_load_the_date(env: Env):
    # 7:43 AM 은 b-willow 2명 + b-cedar 2명 = 4명.
    day = ts.read_bookings(Scope(dates={SEED_DATE}))
    assert ts.tee_time_players(day, SEED_DATE, "7:43 AM") == 4
    with pytest.raises(ts.ScopeNotLoaded):
        ts.tee_time_players(day, TOMORROW, "7:43 AM")
    with pytest.raises(ts.ScopeNotLoaded):
        ts.require_tee_time_capacity(day, TOMORROW, "7:43 AM", incoming=1)

    # 예약 자체는 그 날짜에 있지만, 같은 티 타임의 이웃(b-cedar)은 안 읽혔다.
    # 조용히 세면 2 가 나와 "2자리 남음" → 초과 예약이다.
    only_one = ts.read_bookings(Scope(ids={"b-willow"}))
    assert [b.date for b in only_one] == [SEED_DATE]
    with pytest.raises(ts.ScopeNotLoaded):
        ts.tee_time_players(only_one, SEED_DATE, "7:43 AM")
    with pytest.raises(ts.ScopeNotLoaded):
        ts.tee_time_players(ts.read_bookings(Scope(holds=True)), SEED_DATE, "7:43 AM")
    # 범위를 모르는 평범한 list 도 거절한다 (리팩터링으로 범위가 떨어지면 크게 터지게).
    with pytest.raises(ts.ScopeNotLoaded):
        ts.tee_time_players(list(ts.read_bookings()), SEED_DATE, "7:43 AM")

    assert ts.tee_time_players(ts.read_bookings(), SEED_DATE, "7:43 AM") == 4
    assert ts.tee_time_players(ts.read_bookings(Scope(date_to=SEED_DATE)), SEED_DATE, "7:43 AM") == 4


def test_capacity_check_inside_an_unscoped_tx_writes_nothing(env: Env):
    mark = len(env.fake.requests) if env.fake else 0
    before = store.load_bookings()
    with pytest.raises(ts.ScopeNotLoaded):
        with ts.bookings_tx(Scope(ids={"b-willow"})) as bookings:
            ts.require_tee_time_capacity(bookings, SEED_DATE, "7:43 AM", incoming=2)
    assert store.load_bookings() == before
    if env.fake is not None:
        assert env.fake.writes(mark) == []


# ===== 미리 읽은 뒤 다른 요청이 예약을 옮기면 409 =====================


def race_move(monkeypatch, booking_id: str, to_date: str, to_time: str) -> list[bool]:
    """라우트가 id 로 미리 읽은 **뒤**, 트랜잭션을 열기 직전에 다른 writer 가 예약을 옮긴다.

    처음 불리는 `store.mutate` 에서 한 번 끼어든다. 돌려준 목록이 비어 있지 않은지
    테스트가 확인한다 — 라우트가 트랜잭션을 두 번 열게 바뀌면 끼어드는 자리가 달라져
    409 를 조용히 안 시험하게 되기 때문이다.
    """
    real = store.mutate
    fired: list[bool] = []

    def mutate(scope: Scope | None = None):
        if not fired:
            fired.append(True)
            with real(Scope(ids={booking_id})) as other:
                other[0]["date"] = to_date
                other[0]["time"] = to_time
        return real(scope)

    monkeypatch.setattr(store, "mutate", mutate)
    return fired


def stored(booking_id: str) -> dict[str, Any]:
    [doc] = store.load_bookings(Scope(ids={booking_id}))
    return doc


def test_revive_after_a_concurrent_move_is_409(env: Env, monkeypatch):
    url = f"{API}/tee-sheet/bookings/b-ridge"
    assert env.client.patch(url, json={"status": "cancelled"}).status_code == 200
    fired = race_move(monkeypatch, "b-ridge", NEW_DATE, "7:25 AM")

    # 9/08 로 범위를 잡았는데 예약은 9/10 에 있다. 9/10 은 안 읽었으니 정원을 셀 수 없다.
    response = env.client.patch(url, json={"status": "reserved"})
    assert fired, "the concurrent move must happen between the pre-read and the transaction"
    assert response.status_code == 409, response.status_code
    doc = stored("b-ridge")
    assert (doc["date"], doc["status"]) == (NEW_DATE, "cancelled"), "실패한 트랜잭션은 아무것도 쓰지 않는다"

    # 다시 시도하면 새 날짜로 범위를 잡아 통과한다.
    assert env.client.patch(url, json={"status": "reserved"}).status_code == 200


def test_add_player_after_a_concurrent_move_is_409(env: Env, monkeypatch):
    fired = race_move(monkeypatch, "b-ridge", NEW_DATE, "7:25 AM")
    response = env.client.post(f"{API}/tee-sheet/bookings/b-ridge/players", json={"name": "Third Wheel"})
    assert fired
    assert response.status_code == 409, response.status_code
    assert len(stored("b-ridge")["players"]) == 2


def test_time_only_move_after_a_concurrent_move_is_409(env: Env, monkeypatch):
    # 시간만 바꾸면 목적지는 예약의 **지금** 날짜(9/10)다. 미리 읽은 날짜(9/08)가 아니다.
    fired = race_move(monkeypatch, "b-ridge", NEW_DATE, "7:25 AM")
    response = env.client.patch(f"{API}/tee-sheet/bookings/b-ridge", json={"time": "7:34 AM"})
    assert fired
    assert response.status_code == 409, response.status_code
    assert (stored("b-ridge")["date"], stored("b-ridge")["time"]) == (NEW_DATE, "7:25 AM")


# ===== 요청 모양: 필터가 실제로 나가는가 (supabase) ====================


def test_tee_sheet_routes_issue_filtered_queries_only(supa: Env):
    client, fake = supa.client, supa.fake

    def step(name: str, call, *expected: tuple[str, Any], status: int = 200):
        mark = len(fake.requests)
        response = call()
        assert response.status_code == status, (name, response.status_code)
        assert_scoped(fake, mark, name, expected)
        return response

    made = step("create", lambda: client.post(f"{API}/tee-sheet/bookings", json={
        "date": NEW_DATE, "time": "9:04 AM", "title": "Quackenbush, Zebulon",
        "players": [{"name": "Zebulon Quackenbush"}]}), ("booking_date", in_(NEW_DATE)), status=201).json()
    url = f"{API}/tee-sheet/bookings/{made['id']}"
    by_id = ("id", in_(made["id"]))

    step("get", lambda: client.get(url), by_id)
    step("patch", lambda: client.patch(url, json={"notes": "warm"}), by_id, ("booking_date", in_(NEW_DATE)))
    step("move", lambda: client.patch(url, json={"date": MOVED_DATE, "time": "10:07 AM"}),
         by_id, ("booking_date", in_(NEW_DATE, MOVED_DATE)))
    added = step("add-player", lambda: client.post(f"{url}/players", json={"name": "Philippa Oddbody"}),
                 by_id, ("booking_date", in_(MOVED_DATE))).json()
    player = f"{url}/players/{added['players'][-1]['id']}"
    step("patch-player", lambda: client.patch(player, json={"paid": True}), by_id)
    step("delete-player", lambda: client.delete(player), by_id)
    step("list-by-date", lambda: client.get(f"{API}/tee-sheet/bookings", params={"date": SEED_DATE}),
         ("booking_date", in_(SEED_DATE)))
    step("list-range", lambda: client.get(f"{API}/tee-sheet/bookings",
                                          params={"from": SEED_DATE, "to": MOVED_DATE}),
         ("booking_date", [f"gte.{SEED_DATE}", f"lte.{MOVED_DATE}"]))
    step("daily-report", lambda: client.get(f"{API}/tee-sheet/reports/daily", params={"date": SEED_DATE}),
         ("booking_date", in_(SEED_DATE)))
    step("week-report", lambda: client.get(f"{API}/tee-sheet/reports/week",
                                           params={"from": SEED_DATE, "to": MOVED_DATE}),
         ("booking_date", [f"gte.{SEED_DATE}", f"lte.{MOVED_DATE}"]))
    step("delete", lambda: client.delete(url), by_id, status=204)

    # 오케스트레이션 상태는 건수만 쓴다: 행을 내려받지 않는 count 한 번.
    mark = len(fake.requests)
    assert client.get(f"{API}/tee-sheet/orchestration/status").json()["total_bookings"] == SEED_COUNT
    assert fake.table_scans(mark) == []
    assert [p.get("limit") for m, _, p in fake.requests[mark:] if m == "GET"] == ["0"]


def test_orchestration_tasks_issue_filtered_queries_only(supa: Env):
    fake = supa.fake
    hold = ("hold_expires_at", "not.is.null")

    mark = len(fake.requests)
    assert ts.run_sync_pass(SEED_DATE)["scanned"] == SEED_COUNT
    assert_scoped(fake, mark, "worker", (("booking_date", in_(SEED_DATE)), hold))

    mark = len(fake.requests)
    result = ts.cleanup_expired_bookings("2026-09-01")
    assert (result["deleted"], result["remaining"]) == (0, SEED_COUNT)
    # "엄격히 이전" = before 의 전날까지.
    assert_scoped(fake, mark, "cleanup", (("booking_date", "lte.2026-08-31"), hold))

    mark = len(fake.requests)
    assert asyncio.run(ts.run_daily_batch(SEED_DATE))["failed_subtasks"] == 0
    assert_scoped(fake, mark, "daily-batch", (("booking_date", in_(SEED_DATE)),))


def test_voice_tools_issue_filtered_queries_only(supa: Env):
    client, fake = supa.client, supa.fake
    hold_filter = ("hold_expires_at", "not.is.null")
    call = {"conversation_id": "c-shape"}

    def step(name: str, path: str, body: dict, *expected: tuple[str, Any]):
        mark = len(fake.requests)
        response = client.post(f"{API}/voice/{path}", json={**call, **body})
        assert response.status_code == 200, (name, response.status_code)
        assert_scoped(fake, mark, name, expected)
        return response.json()

    step("find", "tools/find-tee-times", {"date": TOMORROW, "party_size": 2},
         ("booking_date", in_(TOMORROW)))
    first = step("hold", "tools/hold-tee-time", {"date": TOMORROW, "time": "8:01 AM", "party_size": 2},
                 ("booking_date", in_(TOMORROW)), hold_filter)
    step("release", "tools/release-hold", {"hold_id": first["hold_id"]},
         ("id", in_(first["hold_id"])), hold_filter)
    second = step("hold-again", "tools/hold-tee-time", {"date": TOMORROW, "time": "8:01 AM", "party_size": 2},
                  ("booking_date", in_(TOMORROW)), hold_filter)
    booked = step("confirm", "tools/confirm-booking", {
        "hold_id": second["hold_id"], "first_name": "Jin", "last_name": "Nakamura", "phone": "905-892-1234",
    }, ("id", in_(second["hold_id"])))["booking"]
    step("lookup", "tools/lookup-booking", {"phone": "905-892-1234", "last_name": "Nakamura"},
         ("booking_date", "gte.2026-09-08"))
    step("cancel", "tools/cancel-booking", {"booking_id": booked["booking_id"], "last_name": "Nakamura"},
         ("id", in_(booked["booking_id"])))
    step("post-call", "post-call", {"data": {"conversation_id": "c-shape"}},
         ("id", in_(booked["booking_id"])))


# ===== supabase 저장 계층: fetch / count ==============================


@pytest.fixture()
def fake(monkeypatch) -> FakePostgrest:
    return install(monkeypatch)


def test_fetch_sends_one_filtered_query_per_criterion(fake):
    fake.seed([booking_doc("d-1", "2026-09-12"), booking_doc("r-1", "2026-09-20"),
               booking_doc("i-1", "2026-01-01"),
               booking_doc("h-1", "2026-02-02", holdExpiresAt="2026-02-02T10:00:00+00:00"),
               booking_doc("out", "2026-12-25")])

    docs = sb.fetch(Scope(dates={"2026-09-12"}, date_from="2026-09-15", date_to="2026-09-30",
                          ids={"i-1"}, holds=True))

    assert sorted(d["id"] for d in docs) == ["d-1", "h-1", "i-1", "r-1"]
    filters = [{k: v for k, v in p.items() if k not in ("select", "order", "limit")}
               for _, _, p in fake.calls("GET")]
    # 기준마다 [데이터 페이지, 빈 페이지]. 두 번째 GET 은 키셋 id=gt 가 더해진다.
    assert filters[0] == {"booking_date": in_("2026-09-12")}
    assert filters[2] == {"booking_date": ["gte.2026-09-15", "lte.2026-09-30"]}
    assert filters[4] == {"id": in_("i-1")}
    assert filters[5] == {"id": [in_("i-1"), "gt.i-1"]}
    assert filters[6] == {"hold_expires_at": "not.is.null"}
    assert len(filters) == 8 and fake.table_scans() == []


def test_fetch_chunks_long_lists_and_keeps_fetch_all_order(fake, monkeypatch):
    monkeypatch.setattr(sb, "DELETE_CHUNK", 2)
    monkeypatch.setattr(sb, "PAGE_SIZE", 2)
    fake.seed([booking_doc(f"b-{i}", f"2026-09-1{i}", createdAt=f"2026-09-01T12:0{i}:00+00:00")
               for i in range(5)])

    by_date = sb.fetch(Scope(dates={f"2026-09-1{i}" for i in range(5)}))
    by_id = sb.fetch(Scope(ids={f"b-{i}" for i in range(5)}))

    assert [d["id"] for d in by_date] == [d["id"] for d in sb.fetch_all()] == [f"b-{i}" for i in range(5)]
    assert by_id == by_date
    lists = [p["id"] for _, _, p in fake.calls("GET") if "id" in p and not str(p["id"]).startswith("gt.")]
    firsts = [v if isinstance(v, str) else v[0] for v in lists]
    assert set(firsts) == {in_("b-0", "b-1"), in_("b-2", "b-3"), in_("b-4")}


def test_fake_ands_repeated_filters_like_postgrest(fake):
    # 가짜가 반복 필터 중 하나를 버리면(dict 로 접으면) 범위 밖 행이 새어 들어온다.
    fake.seed([booking_doc(f"b-{i}", f"2026-09-1{i}") for i in range(5)])
    assert [d["id"] for d in sb.fetch(Scope(date_from="2026-09-11", date_to="2026-09-13"))] == ["b-1", "b-2", "b-3"]
    assert sb.fetch(Scope()) == [] and fake.requests[-1][2].get("booking_date") == ["gte.2026-09-11", "lte.2026-09-13"]


def test_count_reads_the_exact_total_without_rows(fake):
    fake.seed([booking_doc(f"b-{i}", "2026-09-12") for i in range(7)])
    assert sb.count() == 7
    fake.content_range = False
    with pytest.raises(sb.SupabaseStoreError):
        sb.count()
