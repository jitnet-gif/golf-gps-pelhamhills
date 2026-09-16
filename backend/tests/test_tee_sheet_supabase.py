"""`backend/services/tee_sheet_supabase.py` 단위 테스트.

실행: `cd E:\\PELHAMHILLS && python -m pytest backend/tests/test_tee_sheet_supabase.py -q`

모든 요청은 `fake_postgrest.FakePostgrest` 의 MockTransport 로 간다. 실제 Supabase 는
공유 프로젝트라 테스트가 한 건이라도 나가면 안 된다. settings 가 필요한 테스트는
`backend.core.config` 를 가짜 모듈로 바꿔 끼운다 — 진짜를 임포트하면 `.env` 가
os.environ 에 덮어써진다.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import tee_sheet_supabase as sb  # noqa: E402
from backend.tests.fake_postgrest import (  # noqa: E402
    COLUMNS,
    FAKE_KEY,
    FakePostgrest,
    install,
    parse_in_list,
)

PATH = f"/rest/v1/{sb.TABLE}"
BASE = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)

# 누출 검사용으로 지어낸 값. 시드에 있는 실제 이름을 쓰지 않는다.
SECRET_NAME = "Zebulon Quackenbush"
SECRET_PHONE = "555-0199-4242"
SECRET_ID = "b-quackenbush"


@pytest.fixture()
def fake(monkeypatch) -> FakePostgrest:
    return install(monkeypatch)


def make_doc(booking_id: str, *, day: str = "2026-09-08", minute: int = 0, **extra) -> dict:
    stamp = (BASE + timedelta(minutes=minute)).isoformat()
    doc = {
        "id": booking_id,
        "date": day,
        "time": "7:43 AM",
        "status": "reserved",
        "source": "staff",
        "title": "Test, Booking",
        "players": [{"id": f"p-{booking_id}", "name": "Test Booking", "phone": ""}],
        "createdAt": stamp,
        "updatedAt": stamp,
    }
    doc.update(extra)
    return doc


def secret_doc() -> dict:
    return make_doc(
        SECRET_ID,
        title="Quackenbush, Zebulon",
        players=[{"id": "p-secret", "name": SECRET_NAME, "phone": SECRET_PHONE}],
    )


def stub_settings(monkeypatch, *, url: str = "", key: str = "") -> None:
    module = types.ModuleType("backend.core.config")
    module.settings = types.SimpleNamespace(
        NEXT_PUBLIC_SUPABASE_URL=url, SUPABASE_SERVICE_ROLE_KEY=key
    )
    monkeypatch.setitem(sys.modules, "backend.core.config", module)


def assert_no_leak(err: sb.SupabaseStoreError, *secrets: str) -> None:
    # str 만 보면 속성이나 원인 체인에 숨긴 본문을 놓친다. 예외의 겉면 전체를 본다.
    surface = " ".join([str(err), repr(err), repr(err.args), repr(vars(err))])
    for secret in secrets:
        assert secret not in surface
    assert err.__cause__ is None
    assert err.__context__ is None or err.__suppress_context__


def posted_ids(fake: FakePostgrest) -> list[str]:
    ids: list[str] = []
    for request in fake.raw_requests:
        if request.method == "POST":
            ids.extend(row["id"] for row in json.loads(request.content))
    return ids


# ===== to_row ==========================================================


def test_to_row_derives_every_column_from_doc():
    doc = make_doc("b-1", holdExpiresAt="2026-09-08T11:05:00+00:00", source="voice_hold")
    row = sb.to_row(doc)

    assert set(row) == set(COLUMNS)
    assert row["id"] == "b-1"
    assert row["booking_date"] == "2026-09-08"
    assert row["tee_time"] == "7:43 AM"
    assert row["status"] == "reserved"
    assert row["source"] == "voice_hold"
    assert row["title"] == "Test, Booking"
    assert row["hold_expires_at"] == "2026-09-08T11:05:00+00:00"
    assert row["created_at"] == doc["createdAt"]
    assert row["updated_at"] == doc["updatedAt"]
    assert row["doc"] == doc
    synced = datetime.fromisoformat(row["synced_at"])
    assert synced.utcoffset() == timedelta(0)


def test_to_row_key_set_is_fixed_when_optional_fields_are_missing():
    bare = {"id": "b-bare", "date": "2026-09-08"}
    row = sb.to_row(bare)
    assert set(row) == set(sb.to_row(make_doc("b-full", holdExpiresAt=BASE.isoformat())))
    assert row["tee_time"] is None and row["hold_expires_at"] is None and row["created_at"] is None


def test_to_row_maps_empty_timestamps_to_null():
    row = sb.to_row(make_doc("b-1", createdAt="", holdExpiresAt=""))
    assert row["created_at"] is None
    assert row["hold_expires_at"] is None


# ===== fetch_all =======================================================


def keyset_filters(fake: FakePostgrest) -> list[str | None]:
    return [g[2].get("id") for g in fake.calls("GET")]


def test_fetch_all_pages_past_1000_rows(fake):
    fake.seed([make_doc(f"b-{i:04d}", minute=i) for i in range(1001)])

    docs = sb.fetch_all()

    assert [d["id"] for d in docs] == [f"b-{i:04d}" for i in range(1001)]
    # 빈 페이지를 받아야 멈춘다 → GET 3번.
    assert keyset_filters(fake) == [None, "gt.b-0999", "gt.b-1000"]
    for _, path, params in fake.calls("GET"):
        assert path == PATH
        assert params["select"] == "id,doc"
        assert params["order"] == "id.asc"
        assert params["limit"] == "1000"
        assert "offset" not in params


def test_fetch_all_small_pages_and_ordering(fake, monkeypatch):
    monkeypatch.setattr(sb, "PAGE_SIZE", 3)
    # 날짜 → createdAt → id 순서가 입력 순서와 다르게 섞이도록 심는다.
    fake.seed(
        [
            make_doc("b-z", day="2026-09-09", minute=0),
            make_doc("b-b", day="2026-09-08", minute=5),
            make_doc("b-a", day="2026-09-08", minute=5),
            make_doc("b-c", day="2026-09-08", minute=1),
            make_doc("b-y", day="2026-09-07", minute=9),
            make_doc("b-x", day="2026-09-10", minute=0),
            make_doc("b-w", day="2026-09-10", minute=0),
        ]
    )

    docs = sb.fetch_all()

    assert [d["id"] for d in docs] == ["b-y", "b-c", "b-a", "b-b", "b-z", "b-w", "b-x"]
    # 페이지는 id 순 (a b c | w x y | z | 빈 페이지). 날짜 순서는 받은 뒤 맞춘다.
    assert keyset_filters(fake) == [None, "gt.b-c", "gt.b-y", "gt.b-z"]


def test_fetch_all_stops_after_empty_page_on_exact_multiple(fake, monkeypatch):
    monkeypatch.setattr(sb, "PAGE_SIZE", 3)
    fake.seed([make_doc(f"b-{i}", minute=i) for i in range(6)])

    assert len(sb.fetch_all()) == 6
    assert keyset_filters(fake) == [None, "gt.b-2", "gt.b-5"]


def test_fetch_all_client_order_matches_the_server_order(fake):
    # 예전엔 서버가 booking_date, created_at(NULL 은 뒤), id 로 정렬했다. 받은 뒤 정렬이
    # 그 순서와 같아야 한다 — 빈 createdAt 은 to_row 가 NULL 로 적으므로 맨 뒤로 가야 한다.
    fake.seed(
        [
            make_doc("b-empty", createdAt=""),
            make_doc("b-none", createdAt=None),
            make_doc("b-late", createdAt="2026-09-01T12:05:00+00:00"),
            make_doc("b-naive", createdAt="2026-09-01T12:01:00"),
            make_doc("b-offset", createdAt="2026-09-01T08:00:00-04:00"),
            make_doc("b-early-day", day="2026-09-07", createdAt=""),
        ]
    )
    fetched = [d["id"] for d in sb.fetch_all()]
    assert fetched == [d["id"] for d in fake.docs()]
    assert fetched == ["b-early-day", "b-offset", "b-naive", "b-late", "b-empty", "b-none"]


class _AfterFirstGet:
    """첫 GET 응답을 만든 **뒤** `action` 을 한 번 돌린다 = 페이지 사이에 끼어든 다른 writer."""

    def __init__(self, fake: FakePostgrest, action) -> None:
        self.fake = fake
        self.action = action
        self.done = False
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        response = self.fake._handle(request)
        if request.method == "GET" and not self.done:
            self.done = True
            self.action()
        return response


def test_fetch_all_never_skips_rows_when_another_writer_deletes_or_moves(fake, monkeypatch):
    monkeypatch.setattr(sb, "PAGE_SIZE", 2)
    fake.seed([make_doc(f"b-{i}", day="2026-09-09", minute=i) for i in range(5)])

    def other_writer() -> None:
        # 오프셋 페이징이면 둘 다 뒤 페이지를 한 칸씩 밀어 내내 있던 행을 빠뜨렸다.
        del fake.rows["b-0"]
        moved = fake.rows["b-4"]
        moved["booking_date"] = "2026-09-01"
        moved["doc"]["date"] = "2026-09-01"

    sb.set_transport(_AfterFirstGet(fake, other_writer).transport)  # install() 이 원복한다

    fetched = [d["id"] for d in sb.fetch_all()]

    assert {"b-1", "b-2", "b-3", "b-4"} <= set(fetched)
    assert len(fetched) == len(set(fetched))
    assert fetched[0] == "b-4"  # 옮겨 간 날짜 순서도 반영된다


def test_fetch_all_does_not_stop_on_a_page_clamped_by_server_max_rows(fake):
    # 프로젝트 max-rows 가 PAGE_SIZE 보다 작으면 서버가 페이지를 자른다. 짧은 페이지에서
    # 멈추면 나머지를 조용히 잃는다.
    fake.seed([make_doc(f"b-{i}", minute=i) for i in range(5)])

    def clamp(request: httpx.Request) -> httpx.Response:
        response = fake._handle(request)
        if request.method != "GET":
            return response
        return httpx.Response(200, json=response.json()[:2])

    sb.set_transport(httpx.MockTransport(clamp))

    assert [d["id"] for d in sb.fetch_all()] == [f"b-{i}" for i in range(5)]


def test_fetch_all_non_json_success_body_is_a_store_error(fake):
    sb.set_transport(httpx.MockTransport(lambda r: httpx.Response(200, text=f"<html>{SECRET_NAME}</html>")))

    with pytest.raises(sb.SupabaseStoreError) as info:
        sb.fetch_all()

    assert info.value.status == 200
    assert_no_leak(info.value, SECRET_NAME)


def test_fetch_all_returns_only_docs(fake):
    doc = make_doc("b-1")
    fake.seed([doc])
    assert sb.fetch_all() == [doc]


# ===== upsert ==========================================================


def test_upsert_chunks_and_uses_merge_duplicates(fake, monkeypatch):
    monkeypatch.setattr(sb, "UPSERT_CHUNK", 2)
    docs = [make_doc(f"b-{i}", minute=i) for i in range(5)]

    assert sb.upsert(docs) == 5

    posts = [r for r in fake.raw_requests if r.method == "POST"]
    assert [len(json.loads(r.content)) for r in posts] == [2, 2, 1]
    for request in posts:
        assert request.url.path == PATH
        assert request.url.params["on_conflict"] == "id"
        prefer = {p.strip() for p in request.headers["prefer"].split(",")}
        assert {"resolution=merge-duplicates", "return=minimal"} <= prefer
    assert {i: row["doc"] for i, row in fake.rows.items()} == {d["id"]: d for d in docs}


def test_upsert_overwrites_existing_row(fake):
    fake.seed([make_doc("b-1", status="reserved")])
    sb.upsert([make_doc("b-1", status="checked_in")])
    assert fake.rows["b-1"]["status"] == "checked_in"
    assert fake.rows["b-1"]["doc"]["status"] == "checked_in"


def test_upsert_mixed_optional_fields_in_one_chunk(fake):
    # 한쪽만 holdExpiresAt 이 있어도 행 키 집합은 같아야 한다 (가짜는 다르면 400).
    held = make_doc("b-hold", source="voice_hold", holdExpiresAt="2026-09-08T11:05:00+00:00")
    plain = {"id": "b-plain", "date": "2026-09-08"}
    assert sb.upsert([held, plain]) == 2
    assert fake.rows["b-hold"]["hold_expires_at"] == "2026-09-08T11:05:00+00:00"
    assert fake.rows["b-plain"]["hold_expires_at"] is None


def test_upsert_collapses_duplicate_ids_last_wins(fake):
    # 같은 id 가 한 문장에 두 번이면 Postgres 가 21000 으로 거절한다 (가짜도 그렇다).
    assert sb.upsert([make_doc("b-1", status="reserved"), make_doc("b-1", status="paid")]) == 1
    assert fake.rows["b-1"]["status"] == "paid"


def test_empty_inputs_issue_no_http(fake):
    assert sb.upsert([]) == 0
    assert sb.delete_ids([]) == 0
    assert sb.apply_diff([], []) == {"upserted": 0, "deleted": 0}
    assert fake.requests == []


# ===== apply_diff / replace_all =======================================


def test_apply_diff_upserts_only_new_or_changed_and_deletes_missing(fake):
    before = [make_doc("b-same", minute=0), make_doc("b-edit", minute=1), make_doc("b-gone", minute=2)]
    fake.seed(before)
    after = [
        make_doc("b-same", minute=0),
        make_doc("b-edit", minute=1, status="checked_in"),
        make_doc("b-new", minute=3),
    ]

    result = sb.apply_diff(before, after)

    assert result == {"upserted": 2, "deleted": 1}
    assert sorted(posted_ids(fake)) == ["b-edit", "b-new"]
    assert "b-gone" not in fake.rows
    assert set(fake.rows) == {"b-same", "b-edit", "b-new"}
    assert fake.rows["b-edit"]["doc"]["status"] == "checked_in"
    # upsert 가 먼저, delete 가 나중.
    assert [m for m, _, _ in fake.requests] == ["POST", "DELETE"]
    assert fake.requests[-1][2] == {"id": 'in.("b-gone")'}


def test_apply_diff_of_fetched_state_is_a_noop(fake):
    # 저장된 상태를 두 번 읽어 diff 하면 아무것도 쓰지 않아야 한다. to_row 나 doc
    # 비교가 값을 조금이라도 바꾸면(예: 행끼리 비교해 synced_at 이 달라짐) 여기서 걸린다.
    fake.seed([make_doc(f"b-{i}", minute=i, rate=47.79, holes=18) for i in range(4)])
    before = sb.fetch_all()
    after = sb.fetch_all()

    assert sb.apply_diff(before, after) == {"upserted": 0, "deleted": 0}
    assert fake.calls("POST") == [] and fake.calls("DELETE") == []


def test_replace_all_deletes_rows_not_in_docs(fake):
    fake.seed([make_doc("b-keep", minute=0), make_doc("b-extra1", minute=1), make_doc("b-extra2", minute=2)])

    result = sb.replace_all([make_doc("b-keep", minute=0), make_doc("b-add", minute=3)])

    assert result == {"upserted": 1, "deleted": 2}
    assert set(fake.rows) == {"b-keep", "b-add"}
    assert posted_ids(fake) == ["b-add"]


def test_replace_all_with_empty_list_empties_table(fake):
    fake.seed([make_doc("b-1"), make_doc("b-2")])
    assert sb.replace_all([]) == {"upserted": 0, "deleted": 2}
    assert fake.rows == {}


# ===== delete ==========================================================


def test_delete_ids_quotes_reserved_characters(fake):
    awkward = ["a,b", 'c"d', "(e)", "back\\slash", "plain", 'mix,"(x)"\\']
    fake.seed([make_doc(i, minute=n) for n, i in enumerate(awkward)] + [make_doc("keep", minute=99)])

    assert sb.delete_ids(awkward) == len(awkward)

    assert set(fake.rows) == {"keep"}


def test_delete_ids_literal_query_string(fake):
    # 왕복만 보면 인코더와 파서가 같은 식으로 틀려도 통과한다. 손으로 쓴 기대값도 본다.
    sb.delete_ids(["a,b", 'c"d', "back\\slash"])
    assert fake.requests[-1] == ("DELETE", PATH, {"id": 'in.("a,b","c\\"d","back\\\\slash")'})
    assert parse_in_list('("a,b","c\\"d","back\\\\slash")') == ["a,b", 'c"d', "back\\slash"]


def test_delete_ids_chunks_and_dedupes(fake, monkeypatch):
    monkeypatch.setattr(sb, "DELETE_CHUNK", 2)
    fake.seed([make_doc(f"b-{i}", minute=i) for i in range(6)])

    assert sb.delete_ids(["b-0", "b-1", "b-2", "b-3", "b-4", "b-0"]) == 5

    assert len(fake.calls("DELETE")) == 3
    assert set(fake.rows) == {"b-5"}


def test_delete_all_empties_table_and_counts(fake):
    fake.seed([make_doc(f"b-{i}", minute=i) for i in range(4)])

    assert sb.delete_all() == 4

    assert fake.rows == {}
    assert fake.requests[-1] == ("DELETE", PATH, {"id": "not.is.null"})


def test_delete_all_without_content_range_returns_minus_one(fake):
    fake.content_range = False
    fake.seed([make_doc("b-1")])
    assert sb.delete_all() == -1
    assert fake.rows == {}


# ===== 오류 경로 =======================================================


def test_post_error_carries_status_and_code_but_no_doc_values(fake):
    fake.fail_next(500, "XX000")

    with pytest.raises(sb.SupabaseStoreError) as info:
        sb.upsert([secret_doc()])

    err = info.value
    assert err.status == 500
    message = str(err)
    assert "POST" in message and sb.TABLE in message and "500" in message and "XX000" in message
    assert_no_leak(err, SECRET_NAME, SECRET_PHONE, SECRET_ID, "Quackenbush")


def test_delete_error_does_not_leak_ids_from_the_query(fake):
    fake.seed([secret_doc()])
    fake.fail_next(503, "PGRST000")

    with pytest.raises(sb.SupabaseStoreError) as info:
        sb.delete_ids([SECRET_ID])

    assert info.value.status == 503
    assert "DELETE" in str(info.value) and "PGRST000" in str(info.value)
    assert_no_leak(info.value, SECRET_ID, "quackenbush")
    assert SECRET_ID in fake.rows


def test_real_postgres_error_echo_is_not_forwarded(fake):
    # 가짜가 실제 Postgres 처럼 잘못된 값을 오류 메시지에 되돌려 보내는 경로.
    bad = secret_doc()
    bad["date"] = "Quackenbush-day"

    with pytest.raises(sb.SupabaseStoreError) as info:
        sb.upsert([bad])

    assert info.value.status == 400
    assert "22007" in str(info.value)
    assert_no_leak(info.value, "Quackenbush", SECRET_NAME, SECRET_ID)


def test_non_json_error_body_still_raises_cleanly(fake):
    fake.fail_next(502, text=f"<html>Bad gateway for {SECRET_NAME}</html>")

    with pytest.raises(sb.SupabaseStoreError) as info:
        sb.fetch_all()

    assert info.value.status == 502
    assert "GET" in str(info.value) and "unknown" in str(info.value)
    assert_no_leak(info.value, SECRET_NAME)


def test_transport_error_becomes_store_error_without_url(fake):
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {request.url}", request=request)

    sb.set_transport(httpx.MockTransport(boom))  # install() 이 테스트 끝에 원복한다

    with pytest.raises(sb.SupabaseStoreError) as info:
        sb.delete_ids([SECRET_ID])

    assert info.value.status is None
    assert "ConnectError" in str(info.value)
    assert_no_leak(info.value, SECRET_ID, "quackenbush", "fake.supabase.test")


def test_redirect_is_not_success(fake):
    # httpx 는 리다이렉트를 따라가지 않는다. 3xx 를 성공으로 치면 아무것도 안 쓰고
    # upsert/delete 가 건수를 돌려줘 mutate 가 "커밋 완료" 가 된다.
    sb.set_transport(
        httpx.MockTransport(lambda r: httpx.Response(301, headers={"Location": "https://elsewhere.test/"}))
    )
    calls = [
        lambda: sb.upsert([make_doc("b-1")]),
        lambda: sb.delete_ids(["b-1"]),
        lambda: sb.apply_diff([], [make_doc("b-1")]),
        sb.fetch_all,
        sb.delete_all,
    ]
    for call in calls:
        with pytest.raises(sb.SupabaseStoreError) as info:
            call()
        assert info.value.status == 301


def test_httpx_request_log_for_this_table_is_dropped(fake, caplog):
    # backend/main.py 가 루트를 INFO 로 켠다. httpx 의 "HTTP Request: DELETE <url>" 에는
    # id 목록(시드 id 는 성)이 실린다. 루트 레벨로만 켜서, httpx 로거 레벨에 기대는
    # 수정은 이 테스트를 통과하지 못하게 한다.
    fake.seed([secret_doc()])
    caplog.set_level(logging.INFO)

    sb.delete_ids([SECRET_ID])
    sb.fetch_all()
    logging.getLogger("httpx").info("HTTP Request: GET %s", "https://other.example.test/rest/v1/other")

    text = " ".join(record.getMessage() for record in caplog.records)
    assert SECRET_ID not in text and sb.TABLE not in text
    assert "other.example.test" in text  # 다른 httpx 사용처 로그는 그대로 남는다


def test_missing_config_raises_with_no_status(fake, monkeypatch):
    # install() 을 먼저 해 두어 버그로 클라이언트가 만들어져도 네트워크엔 못 나간다.
    for name in ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(name, raising=False)
    stub_settings(monkeypatch)

    assert sb.configured() is False
    with pytest.raises(sb.SupabaseStoreError) as info:
        sb.fetch_all()
    assert info.value.status is None
    assert fake.requests == []


def test_missing_key_alone_is_missing_config(fake, monkeypatch):
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    stub_settings(monkeypatch, url="https://settings.supabase.test")

    assert sb.configured() is False
    with pytest.raises(sb.SupabaseStoreError) as info:
        sb.upsert([make_doc("b-1")])
    assert info.value.status is None
    assert fake.requests == []


# ===== 설정 우선순위 ===================================================


def test_env_beats_settings(fake, monkeypatch):
    stub_settings(monkeypatch, url="https://settings.supabase.test", key="settings-key")

    assert sb.configured() is True
    sb.fetch_all()

    request = fake.raw_requests[-1]
    assert request.url.host == "fake.supabase.test"
    assert request.headers["apikey"] == FAKE_KEY
    assert request.headers["authorization"] == f"Bearer {FAKE_KEY}"


def test_settings_used_when_env_missing(fake, monkeypatch):
    for name in ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(name)
    stub_settings(monkeypatch, url="https://settings.supabase.test/", key="settings-key")

    sb.fetch_all()

    request = fake.raw_requests[-1]
    assert request.url.host == "settings.supabase.test"
    assert request.url.path == PATH  # 끝의 / 가 경로를 // 로 만들지 않는다
    assert request.headers["apikey"] == "settings-key"


def test_next_public_url_is_a_fallback_for_supabase_url(fake, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://public.supabase.test")
    stub_settings(monkeypatch, url="https://settings.supabase.test", key="settings-key")

    sb.fetch_all()

    assert fake.raw_requests[-1].url.host == "public.supabase.test"
    assert fake.raw_requests[-1].headers["apikey"] == FAKE_KEY


def test_env_and_settings_are_never_mixed(fake, monkeypatch):
    # 셸에 URL 만 있고 키는 .env(settings) 에만 있는 경우. 모자란 쪽을 settings 로 채우면
    # 공유 프로젝트의 service_role 키가 셸이 가리키는 호스트로 간다. 반대도 마찬가지.
    consulted: list[int] = []

    def settings():
        consulted.append(1)
        return types.SimpleNamespace(
            NEXT_PUBLIC_SUPABASE_URL="https://live.supabase.test", SUPABASE_SERVICE_ROLE_KEY="live-key"
        )

    monkeypatch.setattr(sb, "_settings", settings)

    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    monkeypatch.setenv("SUPABASE_URL", "https://staging.supabase.test")
    assert sb.configured() is False
    with pytest.raises(sb.SupabaseStoreError) as info:
        sb.fetch_all()
    assert info.value.status is None

    monkeypatch.delenv("SUPABASE_URL")
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_URL")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "staging-key")
    assert sb.configured() is False
    with pytest.raises(sb.SupabaseStoreError):
        sb.upsert([make_doc("b-1")])

    assert fake.requests == [] and consulted == []


def test_settings_import_side_effect_on_environ_is_undone(fake, monkeypatch):
    for name in ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(name)

    def dotenv_import():
        # backend.core.config 첫 임포트의 load_dotenv(override=True) 흉내.
        os.environ["SUPABASE_URL"] = "https://dotenv.supabase.test"
        os.environ["NEXT_PUBLIC_SUPABASE_URL"] = "https://dotenv.supabase.test"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "dotenv-key"
        os.environ["TEE_SHEET_BACKEND"] = "json"
        return types.SimpleNamespace(
            NEXT_PUBLIC_SUPABASE_URL="https://settings.supabase.test", SUPABASE_SERVICE_ROLE_KEY="settings-key"
        )

    monkeypatch.setattr(sb, "_settings", dotenv_import)

    sb.fetch_all()
    sb.fetch_all()  # 되돌리지 않았다면 두 번째 호출은 dotenv 호스트로 간다

    assert {request.url.host for request in fake.raw_requests} == {"settings.supabase.test"}
    for name in ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        assert name not in os.environ
    assert os.environ["TEE_SHEET_BACKEND"] == "supabase"


def test_install_restores_transport_on_undo():
    before = sb._transport
    patch = pytest.MonkeyPatch()
    try:
        fake = install(patch)
        assert sb._transport is fake.transport
    finally:
        patch.undo()
    assert sb._transport is before


# ===== 가짜 자체 (다른 테스트들이 기대는 동작) ========================


def _raw_client(fake: FakePostgrest, *, auth: bool = True) -> httpx.Client:
    headers = {"apikey": FAKE_KEY, "Authorization": f"Bearer {FAKE_KEY}"} if auth else {}
    return httpx.Client(base_url="https://fake.supabase.test", headers=headers, transport=fake.transport)


def test_fake_rejects_unfiltered_delete_and_unknown_table_and_no_key():
    fake = FakePostgrest()
    fake.seed([make_doc("b-1")])
    with _raw_client(fake) as client:
        unfiltered = client.delete(PATH)
        assert unfiltered.status_code == 400
        missing = client.get("/rest/v1/nope")
        assert missing.status_code == 404 and missing.json()["code"] == "42P01"
    with _raw_client(fake, auth=False) as client:
        assert client.get(PATH).status_code == 401
    assert set(fake.rows) == {"b-1"}


def test_fake_rejects_bulk_rows_with_different_key_sets():
    fake = FakePostgrest()
    rows = [sb.to_row(make_doc("b-1")), sb.to_row(make_doc("b-2"))]
    del rows[1]["title"]
    with _raw_client(fake) as client:
        response = client.post(
            PATH,
            params={"on_conflict": "id"},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=rows,
        )
    assert response.status_code == 400
    assert fake.rows == {}


def test_fake_orders_mixed_naive_and_aware_timestamps(fake):
    fake.seed(
        [
            make_doc("b-late", createdAt="2026-09-01T12:05:00+00:00"),
            make_doc("b-naive", createdAt="2026-09-01T12:01:00"),
            make_doc("b-offset", createdAt="2026-09-01T08:00:00-04:00"),  # = 12:00 UTC
        ]
    )
    assert [d["id"] for d in sb.fetch_all()] == ["b-offset", "b-naive", "b-late"]


def test_fake_select_star_and_fail_next_is_one_shot():
    fake = FakePostgrest()
    fake.seed([make_doc("b-1")])
    fake.fail_next(418, "P0001")
    with _raw_client(fake) as client:
        assert client.get(PATH).status_code == 418
        response = client.get(PATH, params={"select": "*"})
    assert response.status_code == 200
    assert set(response.json()[0]) == set(COLUMNS)
