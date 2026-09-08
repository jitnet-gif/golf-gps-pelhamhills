"""공개 스냅샷 빌더 테스트 — 개인정보가 새지 않는지가 요점이다.

이 스냅샷은 인증을 걸 수 없는 정적 사이트로 나간다. 한 번 나가면 되돌릴 수 없으므로
"안 새는 것"을 사후 확인이 아니라 테스트로 못박는다.
"""
import importlib.util
import json
from pathlib import Path

import pytest

from backend.services import customer_store, tee_sheet_store

spec = importlib.util.spec_from_file_location(
    "public_snapshot", Path(__file__).resolve().parents[2] / "scripts/build_public_snapshot.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def booking(**overrides):
    base = dict(
        id="chronogolf-csv-19671-500001", date="2026-04-23", time="8:01 AM", holes=18,
        rate=47.79, span=1, color="gold", status="paid", cartCount=1, title="Testerly, Alba",
        notes='Import provenance: {"playerFees": [{"name": "Alba Testerly"}]}',
        players=[dict(id="p1", name="Alba Testerly", firstName="Alba", lastName="Testerly",
                      email="alba@example.test", phone="5550100000", type="Existing Customer",
                      ratePlan="Weekday Member - Single", paid=True, arrived=True,
                      cancelled=False, no_show=False)],
        audit=[dict(id="a1", ts="2026-04-01T00:00:00+00:00",
                    message="Imported reservation for Alba Testerly.")],
        cancelReason=None, createdAt="2026-04-01T00:00:00+00:00",
        updatedAt="2026-04-01T00:00:00+00:00")
    base.update(overrides)
    return base


def customer(**overrides):
    base = dict(id="chronogolf:900001", name="Alba Testerly", email="alba@example.test",
                phone="5550100000", zip="L0S 1C0", isMember=True, memberTier="Weekday",
                publicSegment=None)
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def isolated_stores(tmp_path, monkeypatch):
    monkeypatch.setenv(tee_sheet_store.ENV_VAR, str(tmp_path / "tee_sheet.json"))
    monkeypatch.setenv(customer_store.ENV_VAR, str(tmp_path / "customers.json"))
    tee_sheet_store.reset(seed=False)
    customer_store.reset()
    yield


def test_snapshot_carries_schedule_and_pricing_but_no_identity():
    tee_sheet_store.save_bookings([booking()])
    customer_store.save_customers([customer()])
    payload = module.build()
    row = payload["bookings"][0]

    # 남아야 하는 것: 일정과 가격
    assert (row["time"], row["rate"], row["holes"], row["cartCount"]) == ("8:01 AM", 47.79, 18, 1)
    assert row["status"] == "paid"
    assert row["players"][0]["ratePlan"] == "Weekday Member - Single"

    # 사라져야 하는 것: 신원
    assert row["title"] == "Booked"
    assert row["players"][0]["name"] == "Golfer 1"
    assert row["players"][0]["email"] == "" and row["players"][0]["phone"] == ""
    assert row["notes"] == "", "notes 의 provenance 에는 실명이 들어 있다"
    assert row["audit"] == []


def test_no_identifier_survives_serialization():
    tee_sheet_store.save_bookings([booking()])
    customer_store.save_customers([customer()])
    blob = json.dumps(module.build(), ensure_ascii=False)
    for secret in ("Alba", "Testerly", "alba@example.test", "5550100000", "L0S 1C0"):
        assert secret not in blob, f"{secret} leaked into the public snapshot"


def test_scrub_guard_refuses_to_write_when_a_name_would_leak(monkeypatch):
    """허용 목록을 우회해 이름이 남는 경우, 조용히 내보내지 말고 멈춰야 한다."""
    tee_sheet_store.save_bookings([booking()])
    customer_store.save_customers([customer()])
    monkeypatch.setattr(module, "anonymize", lambda b, i: dict(b, id=f"public-{i}"))
    with pytest.raises(RuntimeError, match="Refusing to write"):
        module.build()


def test_guest_and_placeholder_titles_are_not_treated_as_identifiers():
    """'Guest' 는 익명 좌석을 뜻한다. 이것 때문에 가드가 오탐하면 안 된다."""
    tee_sheet_store.save_bookings([booking(
        title="Guest",
        players=[dict(id="p1", name="Guest", firstName="Guest", lastName="", email="", phone="",
                      type="Guest", ratePlan="Public", paid=False, arrived=False,
                      cancelled=False, no_show=False)],
        notes="", audit=[])])
    customer_store.save_customers([])
    assert module.build()["bookings"][0]["title"] == "Booked"


def test_summary_publishes_counts_only():
    tee_sheet_store.save_bookings([booking(), booking(id="b2", status="cancelled")])
    customer_store.save_customers([customer(), customer(
        id="chronogolf:900002", name="Bo Sampleton", email="", phone="",
        isMember=False, memberTier=None, publicSegment="Standard")])
    summary = module.build()["summary"]
    assert summary["bookings"] == 2 and summary["activeBookings"] == 1
    assert summary["byMemberTier"] == {"Weekday": 1}
    assert summary["byPublicSegment"] == {"Standard": 1}
    assert summary["customers"] == 2 and summary["members"] == 1
    # 명단은 어떤 키로도 나가지 않는다.
    assert not any(isinstance(v, list) and v and isinstance(v[0], dict)
                   for v in summary.values())


def test_dry_run_writes_nothing_and_rerun_is_stable(tmp_path):
    tee_sheet_store.save_bookings([booking()])
    customer_store.save_customers([customer()])
    out = tmp_path / "snapshot.json"

    assert module.run(out)["changed"] is True
    assert not out.exists(), "dry-run 은 쓰면 안 된다"

    module.run(out, apply=True)
    assert out.exists()
    # generatedAt 만 달라지는 재실행은 "변경 없음"이어야 한다.
    assert module.run(out, apply=True)["changed"] is False