"""시뮬레이터 베이 예약 백엔드 통합 테스트.

실행: `cd E:\\PELHAMHILLS && python -m pytest backend/tests/test_simulator.py -q`

모든 테스트는 `SIMULATOR_DATA_FILE` 를 tmp_path 로 돌려 실제 데이터 파일을 건드리지 않는다.
`test_tee_sheet.py` 와 같은 픽스처 구조다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.api.routes import simulator as module  # noqa: E402
from backend.services import simulator_store as store  # noqa: E402

API = "/api/v1"

# 2026-09-10 = 목요일(영업), 2026-09-07 = 월요일(휴무), 2026-09-08 = 화요일(휴무).
OPEN_DAY = "2026-09-10"
CLOSED_MONDAY = "2026-09-07"
CLOSED_TUESDAY = "2026-09-08"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv(store.ENV_VAR, str(tmp_path / "simulator.json"))
    # 이전 테스트의 캐시를 확실히 버린다 (경로 키가 다르면 자동 무효화되지만 명시적으로).
    store._cache = None
    store._cache_path = None

    app = FastAPI()
    app.include_router(module.router, prefix=API)
    with TestClient(app) as test_client:
        yield test_client

    store._cache = None
    store._cache_path = None


# ===== 헬퍼 ===========================================================


def availability(client, *, date=OPEN_DAY, bay_type="right_handed", duration=1) -> dict:
    response = client.get(
        f"{API}/simulator/availability",
        params={"date": date, "bay_type": bay_type, "duration_hours": duration},
    )
    assert response.status_code == 200, response.text
    return response.json()


def booking_body(**overrides) -> dict:
    body = {
        "date": OPEN_DAY,
        "start_time": "14:00",
        "duration_hours": 2,
        "player_count": 2,
        "customer_name": "Ada Lovelace",
        "customer_email": "ada@example.com",
        "bay_type": "right_handed",
    }
    body.update(overrides)
    return body


def book(client, **overrides):
    return client.post(f"{API}/simulator/reservations", json=booking_body(**overrides))


# ===== 저장소 시딩 ====================================================


def test_bays_are_seeded_without_a_database(client):
    """예약 화면이 뜨는 데 Postgres 가 필요하지 않다 — 이 회귀가 이 파일의 존재 이유."""
    bays = client.get(f"{API}/simulator/bays").json()
    assert [bay["bay_number"] for bay in bays] == [1, 2, 3, 4, 5]
    assert {bay["bay_type"] for bay in bays} == {"right_handed", "left_right", "vip"}


def test_bays_filter_by_type(client):
    bays = client.get(f"{API}/simulator/bays", params={"bay_type": "left_right"}).json()
    assert len(bays) == 1
    assert bays[0]["bay_type"] == "left_right"


def test_unknown_bay_type_is_an_empty_list_not_a_404(client):
    response = client.get(f"{API}/simulator/bays", params={"bay_type": "hovercraft"})
    assert response.status_code == 200
    assert response.json() == []


# ===== 가용 슬롯 ======================================================


def test_availability_covers_operating_hours(client):
    data = availability(client, duration=1)
    times = [slot["time"] for slot in data["available_slots"]]
    assert data["is_closed"] is False
    assert data["reason"] is None
    # 14:00 부터 15분 간격, 마지막 1시간 슬롯은 21:00 (22:00 마감).
    assert times[0] == "14:00"
    assert times[-1] == "21:00"
    assert len(times) == 29  # 14:00~21:00, 15분 간격 (7h × 4 + 1)
    assert all(slot["total_bays"] == 3 for slot in data["available_slots"])


def test_availability_leaves_room_for_the_full_duration(client):
    """3시간 예약의 마지막 슬롯은 19:00 이다 — 마감을 넘겨 시작할 수 없다."""
    data = availability(client, duration=3)
    assert data["available_slots"][-1]["time"] == "19:00"


@pytest.mark.parametrize("closed_date", [CLOSED_MONDAY, CLOSED_TUESDAY])
def test_closed_days_say_so(client, closed_date):
    data = availability(client, date=closed_date)
    assert data["is_closed"] is True
    assert data["available_slots"] == []
    assert "closed" in data["reason"].lower()


def test_bay_type_without_bays_explains_itself(client):
    """예전에는 404 였고, 프론트에서는 네트워크 장애와 구분되지 않았다."""
    data = availability(client, bay_type="hovercraft")
    assert data["is_closed"] is False
    assert data["available_slots"] == []
    assert "No bays are configured" in data["reason"]


def test_invalid_date_is_a_400(client):
    response = client.get(
        f"{API}/simulator/availability", params={"date": "10-09-2026"}
    )
    assert response.status_code == 400
    assert "YYYY-MM-DD" in response.json()["detail"]


# ===== 예약 생성 ======================================================


def test_booking_fills_every_bay_before_refusing(client):
    """우타 베이가 3개면 같은 시간에 3건이 들어가야 한다.

    예전 프론트는 `/bays` 목록의 첫 번째 id 를 무조건 보냈기 때문에 2번째 예약부터
    409 였다. 이제 베이는 서버가 고른다.
    """
    numbers = []
    for _ in range(3):
        response = book(client)
        assert response.status_code == 200, response.text
        numbers.append(response.json()["bay_number"])

    assert sorted(numbers) == [1, 2, 3]
    assert book(client).status_code == 409


def test_booking_removes_the_slot_from_availability(client):
    assert book(client, bay_type="vip").status_code == 200

    data = availability(client, bay_type="vip", duration=2)
    times = [slot["time"] for slot in data["available_slots"]]
    # 14:00-16:00 을 잡았으니 그 구간과 겹치는 시작 시각이 모두 사라진다.
    assert "14:00" not in times
    assert "15:45" not in times
    assert "16:00" in times
    assert "12:15" not in times


def test_non_overlapping_times_still_book(client):
    assert book(client, start_time="14:00", duration_hours=2).status_code == 200
    assert book(client, start_time="16:00", duration_hours=2).status_code == 200


def test_price_follows_the_bay_hourly_rate(client):
    standard = book(client, bay_type="right_handed").json()
    vip = book(client, bay_type="vip").json()
    assert standard["total_price"] == 40.0  # 20/h × 2h
    assert vip["total_price"] == 50.0  # 25/h × 2h


def test_booking_outside_operating_hours_is_rejected(client):
    response = book(client, start_time="21:00", duration_hours=2)  # 23:00 종료
    assert response.status_code == 400
    assert "operating hours" in response.json()["detail"]

    early = book(client, start_time="13:45", duration_hours=1)
    assert early.status_code == 400


def test_booking_on_a_closed_day_is_rejected(client):
    response = book(client, date=CLOSED_MONDAY)
    assert response.status_code == 400
    assert "closed" in response.json()["detail"].lower()


def test_explicit_bay_id_is_honoured(client):
    response = book(client, bay_id=4, bay_type=None)
    assert response.status_code == 200
    assert response.json()["bay_number"] == 4
    # 같은 베이 같은 시간은 두 번 못 잡는다.
    assert book(client, bay_id=4, bay_type=None).status_code == 409


def test_unknown_bay_id_is_a_404(client):
    response = book(client, bay_id=999, bay_type=None)
    assert response.status_code == 404


def test_neither_bay_type_nor_bay_id_is_rejected(client):
    """둘 다 없으면 타입 필터가 사라져 아무 베이나 잡히던 구멍."""
    assert book(client, bay_type=None).status_code == 400


def test_unknown_bay_type_on_booking_is_rejected(client):
    assert book(client, bay_type="hovercraft").status_code == 400


def test_dates_are_normalised_before_they_are_stored(client):
    """`strptime` 은 `2026-9-10` 도 받는다.

    원본 문자열을 그대로 저장하면 `2026-09-10` 로 조회할 때 겹침 검사가 빗나가
    같은 베이가 두 번 예약된다.
    """
    created = book(client, date="2026-9-10", bay_type="vip")
    assert created.status_code == 200
    assert created.json()["date"] == OPEN_DAY

    # 0 이 붙은 표기로 조회해도 그 예약이 보여야 한다.
    times = [
        slot["time"]
        for slot in availability(client, date=OPEN_DAY, bay_type="vip", duration=2)[
            "available_slots"
        ]
    ]
    assert "14:00" not in times

    # 그리고 같은 베이를 다시 잡을 수 없어야 한다.
    assert book(client, date=OPEN_DAY, bay_type="vip").status_code == 409


def test_availability_echoes_a_normalised_date(client):
    assert availability(client, date="2026-9-10")["date"] == OPEN_DAY


def test_missing_name_is_rejected(client):
    assert book(client, customer_name="   ").status_code == 400


def test_duration_out_of_range_is_rejected(client):
    assert book(client, duration_hours=9).status_code == 422


# ===== 조회 / 영속화 ==================================================


def test_reservation_lookup_is_case_insensitive(client):
    code = book(client).json()["confirmation_code"]
    found = client.get(f"{API}/simulator/reservations/{code.lower()}")
    assert found.status_code == 200
    assert found.json()["confirmation_code"] == code
    assert found.json()["status"] == "confirmed"


def test_unknown_confirmation_code_is_a_404(client):
    assert client.get(f"{API}/simulator/reservations/NOPE12345").status_code == 404


def test_reservations_survive_a_cache_drop(client):
    """파일에 실제로 쓰였는지 — 캐시를 버리고 다시 읽어 확인한다."""
    code = book(client).json()["confirmation_code"]

    store._cache = None
    store._cache_path = None

    assert client.get(f"{API}/simulator/reservations/{code}").status_code == 200


def test_corrupt_data_file_falls_back_to_the_seed(client, tmp_path):
    path = tmp_path / "simulator.json"
    path.write_text("{ not json", encoding="utf-8")
    store._cache = None
    store._cache_path = None

    bays = client.get(f"{API}/simulator/bays").json()
    assert len(bays) == 5


def test_init_bays_is_idempotent(client):
    response = client.post(f"{API}/simulator/admin/init-bays")
    assert response.json()["bays_created"] == 0
