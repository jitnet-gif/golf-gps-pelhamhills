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


def test_slot_label_accepts_evening_tees_up_to_the_last_grid_slot():
    """Chronogolf 는 6:58 PM 까지 판다. 6시에서 자르면 저녁 예약이 임포트에서 전부 튕긴다."""
    assert module.slot_label("06:04PM")[0] == "6:04 PM"
    assert module.slot_label("06:58PM")[0] == "6:58 PM"
    with pytest.raises(ValueError, match="Invalid slot"):
        module.slot_label("07:07PM")


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


def cancelled_group(size):
    return [row(**{"Round ID": str(i), "Round Player ID": f"90000{i}", "Player Name": f"Player {i}",
                   "Is Round Cancelled": "Yes", "Round Cancelled At": "2026-04-20",
                   "Cancelled By": "Staff Person"}) for i in range(1, size + 1)]


def test_oversize_fully_cancelled_reservation_is_skipped_not_fatal():
    """소스에 통째로 취소된 5·8인 예약이 있다. 예약은 최대 4명이라 담을 수 없고,
    살아 있는 자리가 없으니 버려도 시트에서 사라지는 게 없다."""
    assert module.convert(cancelled_group(5), "t.csv", include_cancelled=True) == []
    assert module.convert(cancelled_group(8), "t.csv", include_cancelled=True) == []


def test_more_than_four_active_seats_still_refuses():
    """살아 있는 자리가 5개면 진짜 충돌이다. 취소 예약처럼 조용히 버리면 안 된다."""
    rows = [row(**{"Round ID": str(i), "Round Player ID": f"90000{i}",
                   "Player Name": f"Player {i}"}) for i in range(1, 6)]
    with pytest.raises(ValueError, match="5 active seats"):
        module.convert(rows, "t.csv", include_cancelled=True)


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


def test_run_reports_oversize_cancelled_reservations_separately(tmp_path, monkeypatch):
    """버린 사실이 cancelledReservationsSkipped 에 섞여 안 보이면 다음 사례를 놓친다."""
    from backend.services import tee_sheet_store
    target = tmp_path / "tee_sheet.json"
    target.write_text("[]", encoding="utf-8")
    monkeypatch.setenv(tee_sheet_store.ENV_VAR, str(target))

    source = tmp_path / "export.csv"
    oversize = [dict(r, **{"Reservation ID": "600001"}) for r in cancelled_group(5)]
    write_csv(source, [row()] + oversize)

    report = module.run(source, include_cancelled=True)
    assert report["importedBookings"] == 1
    assert report["oversizeCancelledSkipped"] == 1
    assert module.run(source)["oversizeCancelledSkipped"] == 0, "취소 예약을 안 받으면 따로 셀 것도 없다"


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


def supabase_store(tmp_path, monkeypatch, docs):
    """컷오버 뒤 상태: JSON 파일은 없고 원격에 예약이 있다. 백업은 tmp 로."""
    from backend.services import tee_sheet_store
    from backend.tests.fake_postgrest import install
    fake = install(monkeypatch)
    fake.seed(docs)
    monkeypatch.setattr(module, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setenv(tee_sheet_store.ENV_VAR, str(tmp_path / "missing.json"))
    return fake


def test_supabase_backend_replaces_only_the_covered_dates(tmp_path, monkeypatch):
    """예전 경로(save_bookings = replace_all)는 merged 에 없는 원격 행을 전부 지웠다 —
    컷오버 뒤 API·음성으로 들어온 예약 전부. 이제는 export 가 책임지는 날짜만 읽고 바꾼다."""
    import copy
    live = [{"id": f"live-{i}", "date": "2026-09-09", "time": "7:43 AM"} for i in range(3)]
    # 4/23 은 export 가 책임지는 날. 스냅샷 임포터가 넣은 행(id 가 csv id 로 바뀐다) +
    # 예전 CSV 임포트 행(같은 id 로 다시 온다).
    old_snapshot = {"id": "chronogolf-19671-2026-04-23-481-0", "date": "2026-04-23",
                    "time": "8:01 AM", "notes": ""}
    old_csv = {"id": "chronogolf-csv-19671-500001", "date": "2026-04-23", "time": "8:01 AM",
               "notes": "stale"}
    fake = supabase_store(tmp_path, monkeypatch, live + [old_snapshot, old_csv])
    untouched = {i: copy.deepcopy(fake.rows[i]) for i in ("live-0", "live-1", "live-2")}
    source = tmp_path / "export.csv"
    write_csv(source, [row(), row(**{"Reservation ID": "500002", "Round ID": "2",
                                     "Round Player ID": "900002", "Player Name": "Bo Sampleton"})])

    dry = module.run(source)
    assert fake.writes() == [], "dry-run 은 쓰기 요청을 한 건도 보내지 않는다"
    assert (dry["importedBookings"], dry["replacedBookings"], dry["preservedBookings"]) == (2, 2, 3)
    assert dry["changed"] is True and "backup" not in dry
    assert not (tmp_path / "backups").exists()

    applied = module.run(source, apply=True)
    backup = Path(applied["backup"])
    assert backup.parent == tmp_path / "backups"
    assert sorted(b["id"] for b in json.loads(backup.read_text(encoding="utf-8"))) == sorted(
        [old_snapshot["id"], old_csv["id"]]), "바꾸기 직전 범위의 행을 남긴다"
    on_day = sorted(i for i, r in fake.rows.items() if r["booking_date"] == "2026-04-23")
    assert on_day == ["chronogolf-csv-19671-500001", "chronogolf-csv-19671-500002"], \
        "스냅샷 id 가 csv id 로 바뀌어도 그날 예약 수가 두 배가 되면 안 된다"
    assert fake.rows["chronogolf-csv-19671-500001"]["doc"]["notes"] != "stale"
    for booking_id, before in untouched.items():
        assert fake.rows[booking_id] == before, "범위 밖 행은 다시 쓰지도 않는다"
    assert fake.table_scans() == [], "테이블 전체를 읽지 않는다"
    assert not (tmp_path / "missing.json").exists()

    mark = len(fake.requests)
    assert module.run(source, apply=True)["changed"] is False
    assert fake.writes(mark) == [], "재실행이 값을 바꾸면 안 된다"


def test_supabase_backend_still_refuses_to_destroy_a_locally_created_booking(tmp_path, monkeypatch):
    """범위 안의 사람이 만든 예약을 막는 건 이제 merge 의 검사뿐이다."""
    walkup = {"id": "local-walkup", "date": "2026-04-23", "time": "8:10 AM", "notes": "", "audit": []}
    fake = supabase_store(tmp_path, monkeypatch, [walkup])
    source = tmp_path / "export.csv"
    write_csv(source, [row()])
    for apply in (False, True):
        with pytest.raises(ValueError, match="Locally created"):
            module.run(source, apply=apply)
    assert fake.writes() == [] and set(fake.rows) == {"local-walkup"}
    assert not (tmp_path / "backups").exists()


def test_refuses_a_reservation_already_stored_outside_the_export_dates(tmp_path, monkeypatch):
    """Chronogolf 에서 날짜가 바뀐 예약. 받아들이면 같은 id 가 두 줄이 되거나 말없이 옮겨진다."""
    from backend.services import tee_sheet_store
    target = tmp_path / "tee_sheet.json"
    original = json.dumps([{"id": "chronogolf-csv-19671-500001", "date": "2026-04-20",
                            "time": "8:01 AM", "notes": ""}])
    target.write_text(original, encoding="utf-8")
    monkeypatch.setenv(tee_sheet_store.ENV_VAR, str(target))
    source = tmp_path / "export.csv"
    write_csv(source, [row()])
    with pytest.raises(ValueError, match="outside this export's dates"):
        module.run(source, apply=True)
    assert target.read_text(encoding="utf-8") == original


def test_rejects_export_from_another_club(tmp_path):
    source = tmp_path / "other.csv"
    write_csv(source, [row(**{"Club Name": "Some Other Club"})])
    with pytest.raises(ValueError, match="Unexpected club"):
        module.run(source)
