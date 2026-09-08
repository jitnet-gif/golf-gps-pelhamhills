"""Chronogolf 대시보드 CSV -> 티 시트 임포터 테스트.

픽스처는 합성 데이터다. 소스에서 관찰된 *모양*만 재현한다 — 한 슬롯에 여러 예약,
취소 행이 섞인 예약, 500행 상한에 잘린 마지막 날.
"""
import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "teesheet_csv", Path(__file__).resolve().parents[2] / "scripts/import_teesheet_csv.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def row(**overrides):
    base = {
        "Club Name": "Pelham Hills Golf Club", "Start Date": "2026-04-23",
        "Start Time": "08:01AM", "Start Hole": "1", "Reservation ID": "500001",
        "Booking Reference": "AAAA-1111", "Reservation date": "2026-04-01",
        "Reserved By": "Staff Person", "Reservation Type": "Offline",
        "Reservation Source": "Club", "Reservation Medium": "Pro Shop",
        "Round ID": "1", "Round State": "Arrived", "Paid State": "Paid",
        "Round Player ID": "900001", "Player Name": "Alba Testerly",
        "Player Role": "Public", "Player Type": "Public",
        "Is Round Cancelled": "No", "Round Cancelled At": "", "Cancelled By": "",
        "Reservation Note (player)": "", "Club Currency Code": "CAD",
        "Green Fees": "47.79", "Cart Fees": "0.00",
    }
    base.update(overrides)
    return base


# ===== 슬롯 라벨 =======================================================


def test_slot_label_strips_leading_zero():
    """`06:58 AM` 로 새면 merge 의 슬롯 비교가 어긋나 하루가 통째로 이중 등록된다."""
    assert module.slot_label("06:40AM")[0] == "6:40 AM"
    assert module.slot_label("01:07PM")[0] == "1:07 PM"


def test_slot_label_rejects_off_grid_times():
    with pytest.raises(ValueError, match="Invalid slot"):
        module.slot_label("07:44AM")


# ===== 변환 ============================================================


def test_groups_by_reservation_not_by_slot():
    """한 티타임을 두 팀이 나눠 쓴다. 슬롯으로 묶으면 남남이 한 예약이 된다."""
    rows = [row(), row(**{"Reservation ID": "500002", "Round ID": "2",
                          "Round Player ID": "900002", "Player Name": "Bo Sampleton"})]
    built = module.convert(rows, "t.csv")
    assert len(built) == 2
    assert {b["time"] for b in built} == {"8:01 AM"}
    assert {b["id"] for b in built} == {
        "chronogolf-csv-19671-500001", "chronogolf-csv-19671-500002"}


def test_cancelled_rounds_are_dropped_so_groups_stay_within_four_seats():
    """소스에 5인 예약이 있다. 취소 행을 남기면 모델 검증(최대 4명)에서 터진다."""
    rows = [row(**{"Round ID": str(i), "Round Player ID": f"90000{i}",
                   "Player Name": f"Player {i}"}) for i in range(1, 5)]
    rows.append(row(**{"Round ID": "5", "Round Player ID": "900005",
                       "Player Name": "Cancelled Person", "Is Round Cancelled": "Yes",
                       "Round Cancelled At": "2026-04-20", "Cancelled By": "Staff Person"}))
    built = module.convert(rows, "t.csv")[0]
    assert len(built["players"]) == 4
    assert "Cancelled Person" not in [p["name"] for p in built["players"]]
    dropped = json.loads(built["notes"].split("Import provenance: ")[1])["droppedCancelledRounds"]
    assert dropped[0]["name"] == "Cancelled Person", "버려도 흔적은 남긴다"


def test_fully_cancelled_reservation_skipped_unless_opted_in():
    rows = [row(**{"Is Round Cancelled": "Yes", "Round Cancelled At": "2026-04-20",
                   "Cancelled By": "Staff Person"})]
    assert module.convert(rows, "t.csv") == []
    kept = module.convert(rows, "t.csv", include_cancelled=True)[0]
    assert kept["status"] == "cancelled" and "Cancelled 2026-04-20" in kept["cancelReason"]


def test_rate_is_max_green_fee_over_active_players():
    """슬롯 단위 최댓값이면, 티타임을 나눠 쓴 남의 퍼블릭 요금이 회원 팀에 붙는다."""
    rows = [row(**{"Green Fees": "0.00", "Player Role": "Member"}),
            row(**{"Round ID": "2", "Round Player ID": "900002",
                   "Player Name": "Bo Sampleton", "Green Fees": "46.02"}),
            row(**{"Round ID": "3", "Round Player ID": "900003",
                   "Player Name": "Cy Sampleton", "Green Fees": "99.00",
                   "Is Round Cancelled": "Yes"})]
    assert module.convert(rows, "t.csv")[0]["rate"] == 46.02


def test_cart_count_is_per_two_riders():
    rows = [row(**{"Round ID": str(i), "Round Player ID": f"90000{i}",
                   "Player Name": f"Player {i}", "Cart Fees": "19.47"})
            for i in range(1, 5)]
    assert module.convert(rows, "t.csv")[0]["cartCount"] == 2
    single = module.convert([row(**{"Cart Fees": "19.47"})], "t.csv")[0]
    assert single["cartCount"] == 1, "홀수여도 0으로 내려가면 안 된다"


def test_unnamed_seats_become_guests_and_title_falls_back():
    rows = [row(**{"Player Name": "", "Round Player ID": ""}),
            row(**{"Round ID": "2", "Player Name": "", "Round Player ID": ""})]
    built = module.convert(rows, "t.csv")[0]
    assert built["title"] == "Guest"
    assert [p["type"] for p in built["players"]] == ["Guest", "Guest"]
    assert built["players"][0]["firstName"] == "Guest"


def test_title_uses_a_player_not_the_staff_booker():
    """`Reserved By` 는 프로 샵 직원이다. 제목에 쓰면 시트 절반이 직원 이름이 된다."""
    assert module.convert([row()], "t.csv")[0]["title"] == "Testerly, Alba"


def test_player_ids_come_from_round_id_not_the_person_id():
    """Round Player ID 는 사람 id 라 한 사람이 두 자리에 앉으면 겹친다."""
    rows = [row(), row(**{"Round ID": "2", "Player Name": "Alba Testerly"})]
    ids = [p["id"] for p in module.convert(rows, "t.csv")[0]["players"]]
    assert ids == ["chronogolf-csv-19671-500001-r1", "chronogolf-csv-19671-500001-r2"]
    assert len(set(ids)) == 2


def test_status_and_player_flags_map_from_source_states():
    assert module.convert([row()], "t.csv")[0]["status"] == "paid"
    assert module.convert([row(**{"Paid State": "Unpaid"})], "t.csv")[0]["status"] == "checked_in"
    assert module.convert([row(**{"Round State": "Reserved",
                                  "Paid State": "Unpaid"})], "t.csv")[0]["status"] == "reserved"
    noshow = module.convert([row(**{"Round State": "Noshow"})], "t.csv")[0]
    assert noshow["status"] == "no_show" and noshow["players"][0]["no_show"] is True


def test_back_nine_start_is_refused_rather_than_flattened():
    with pytest.raises(ValueError, match="Start Hole"):
        module.convert([row(**{"Start Hole": "10"})], "t.csv")


def test_holes_default_is_recorded_as_a_default_not_as_observed_data():
    built = module.convert([row()], "t.csv")[0]
    assert built["holes"] == 18
    assert "not present in export" in built["notes"]


# ===== 책임 날짜 범위 ==================================================


def test_covered_dates_uses_present_dates_only_and_drops_truncated_last_day():
    rows = [row(**{"Start Date": "2026-04-23"})] * module.ROW_CAP
    incoming = [dict(date="2026-04-23"), dict(date="2026-04-26"), dict(date="2026-04-27")]
    dates, truncated, dropped = module.covered_dates(rows, incoming)
    assert dropped == truncated == "2026-04-27", "행 상한에 걸린 마지막 날은 하루 중간에 잘렸다"
    assert dates == {"2026-04-23", "2026-04-26"}
    assert "2026-04-24" not in dates, "소스에 없는 날을 범위로 채우면 그날 예약이 지워진다"


def test_covered_dates_keeps_last_day_when_export_is_not_capped():
    rows = [row()] * 10
    dates, truncated, dropped = module.covered_dates(rows, [dict(date="2026-04-26")])
    assert truncated is None and dropped is None and dates == {"2026-04-26"}


def test_covered_dates_can_opt_into_the_truncated_day():
    rows = [row()] * module.ROW_CAP
    incoming = [dict(date="2026-04-26"), dict(date="2026-04-27")]
    dates, truncated, dropped = module.covered_dates(rows, incoming, include_truncated=True)
    assert dates == {"2026-04-26", "2026-04-27"}
    assert truncated == "2026-04-27" and dropped is None, "넣더라도 잘렸다는 사실은 보고한다"


def test_absent_dates_are_never_superseded_on_real_converted_output():
    """소스에 없는 날은 책임 범위 밖이다. 범위로 유추하면 그날 예약이 지워진다."""
    rows = [row(**{"Start Date": "2026-04-23", "Reservation ID": "1", "Round ID": "1"}),
            row(**{"Start Date": "2026-04-26", "Reservation ID": "2", "Round ID": "2"})]
    dates, _, _ = module.covered_dates(rows, module.convert(rows, "t.csv"))
    assert dates == {"2026-04-23", "2026-04-26"}

    existing = [dict(id="chronogolf-19671-2026-04-24-400-0", date="2026-04-24", notes="")]
    merged, replaced = module.merge(existing, [], dates)
    assert replaced == 0 and [b["id"] for b in merged] == [existing[0]["id"]]


def test_run_refuses_truncated_day_when_the_store_already_has_that_day(tmp_path, monkeypatch):
    from backend.services import tee_sheet_store
    target = tmp_path / "tee_sheet.json"
    target.write_text(json.dumps(
        [{"id": "chronogolf-csv-19671-1", "date": "2026-04-23", "notes": ""}]), encoding="utf-8")
    monkeypatch.setenv(tee_sheet_store.ENV_VAR, str(target))

    source = tmp_path / "export.csv"
    write_csv(source, [row(**{"Reservation ID": str(i), "Round ID": str(i)})
                       for i in range(module.ROW_CAP)])
    with pytest.raises(ValueError, match="would erase that day"):
        module.run(source, include_truncated=True)


# ===== merge ===========================================================


def test_merge_replaces_chronogolf_rows_and_leaves_other_dates_alone():
    existing = [dict(id="chronogolf-19671-2026-04-23-400-0", date="2026-04-23", notes=""),
                dict(id="b-other", date="2026-09-08", notes="")]
    incoming = [dict(id="chronogolf-csv-19671-500001", date="2026-04-23")]
    merged, replaced = module.merge(existing, incoming, {"2026-04-23"})
    assert replaced == 1
    assert [b["id"] for b in merged] == ["b-other", "chronogolf-csv-19671-500001"]


def test_merge_refuses_to_destroy_a_locally_created_booking():
    existing = [dict(id="local-walkup", date="2026-04-23", notes="", audit=[])]
    with pytest.raises(ValueError, match="Locally created"):
        module.merge(existing, [], {"2026-04-23"})


# ===== 실행 ============================================================


def write_csv(path, rows):
    header = list(row().keys())
    lines = [",".join(header)] + [",".join(r[k] for k in header) for r in rows]
    path.write_text("\n".join(lines), encoding="utf-8")


def test_dry_run_leaves_file_untouched_then_apply_backs_up_and_is_idempotent(
        tmp_path, monkeypatch):
    from backend.services import tee_sheet_store
    target = tmp_path / "tee_sheet.json"
    original = json.dumps([{"id": "b-keep", "date": "2026-09-08", "time": "6:58 AM"}])
    target.write_text(original, encoding="utf-8")
    monkeypatch.setenv(tee_sheet_store.ENV_VAR, str(target))
    tee_sheet_store.reset(seed=False)
    target.write_text(original, encoding="utf-8")

    source = tmp_path / "export.csv"
    write_csv(source, [row()])

    assert module.run(source)["importedBookings"] == 1
    assert target.read_text(encoding="utf-8") == original, "dry-run 은 쓰면 안 된다"

    applied = module.run(source, apply=True)
    assert applied["changed"] is True
    assert Path(applied["backup"]).read_text(encoding="utf-8") == original
    stored = json.loads(target.read_text(encoding="utf-8"))
    assert [b["id"] for b in stored] == ["b-keep", "chronogolf-csv-19671-500001"]

    assert module.run(source, apply=True)["changed"] is False, "재실행이 값을 바꾸면 안 된다"


def test_rejects_export_from_another_club(tmp_path):
    source = tmp_path / "other.csv"
    write_csv(source, [row(**{"Club Name": "Some Other Club"})])
    with pytest.raises(ValueError, match="Unexpected club"):
        module.run(source)
