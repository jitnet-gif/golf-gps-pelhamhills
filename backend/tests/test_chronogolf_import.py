import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("chronogolf_import", Path(__file__).resolve().parents[2] / "scripts/import_chronogolf_snapshot.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def snapshot():
    return {"date":"2026-09-08", "clubId":19671, "rates":["Public"],
        "rows":[["7:43 AM",47.79,2,[[False,9,"",[["Example, One",0,False,False]]],
            [True,18,"",[["Sample, Two",0,False,True]]]]]]}


def test_dry_run_backup_preservation_and_idempotence(tmp_path, monkeypatch):
    target = tmp_path / "bookings.json"
    source = tmp_path / "source.json"
    unrelated = {"id":"local", "date":"2026-09-09", "time":"7:43 AM"}
    original = json.dumps([unrelated])
    target.write_text(original)
    source.write_text(json.dumps(snapshot()))
    monkeypatch.setenv("TEE_SHEET_DATA_FILE", str(target))
    assert module.run(source)["importedPlayers"] == 2
    assert target.read_text() == original
    report = module.run(source, True)
    assert Path(report["backup"]).read_text() == original
    assert json.loads(target.read_text())[0] == unrelated
    assert not module.run(source, True)["changed"]
    assert len(list(tmp_path.glob("*.bak"))) == 1


def test_supabase_backend_replaces_only_the_snapshot_date(tmp_path, monkeypatch):
    # 컷오버 뒤 상태: JSON 파일은 없고 원격에 예약이 있다. 예전에는 save_bookings
    # (= replace_all) 가 merged 에 없는 원격 행을 전부 지웠다. 이제는 스냅샷 날짜만 바꾼다.
    import copy
    from backend.tests.fake_postgrest import install
    fake = install(monkeypatch)
    live = [{"id": f"live-{i}", "date": "2026-09-09", "time": "7:43 AM"} for i in range(3)]
    # 9/08 7:43 AM 의 옛 시드 예약은 스냅샷 id 로 바뀐다 (그날 수가 두 배가 되면 안 된다).
    seed_row = {"id": "b-example", "date": "2026-09-08", "time": "7:43 AM", "title": "Example, One",
                "audit": [{"message": "Imported from the Chronogolf tee sheet for September 8, 2026."}]}
    other_slot = {"id": "b-other", "date": "2026-09-08", "time": "6:58 AM", "title": "Other, Slot"}
    fake.seed(live + [seed_row, other_slot])
    untouched = {i: copy.deepcopy(fake.rows[i]) for i in ("live-0", "live-1", "live-2", "b-other")}
    monkeypatch.setattr(module, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setenv("TEE_SHEET_DATA_FILE", str(tmp_path / "missing.json"))
    source = tmp_path / "source.json"
    source.write_text(json.dumps(snapshot()))

    dry = module.run(source)
    assert fake.writes() == [], "dry-run sends no write request"
    assert (dry["replacedBookings"], dry["preservedBookings"], dry["changed"]) == (1, 4, True)
    assert not (tmp_path / "backups").exists()

    applied = module.run(source, True)
    backup = Path(applied["backup"])
    assert backup.parent == tmp_path / "backups"
    assert sorted(b["id"] for b in json.loads(backup.read_text(encoding="utf-8"))) == ["b-example", "b-other"]
    on_day = sorted(i for i, r in fake.rows.items() if r["booking_date"] == "2026-09-08")
    assert on_day == ["b-other", "chronogolf-19671-2026-09-08-463-0", "chronogolf-19671-2026-09-08-463-1"]
    for booking_id, before in untouched.items():
        assert fake.rows[booking_id] == before
    assert fake.table_scans() == []
    assert not (tmp_path / "missing.json").exists()

    mark = len(fake.requests)
    assert not module.run(source, True)["changed"]
    assert fake.writes(mark) == []


def test_collision_rejected_and_seed_recognized():
    incoming = module.convert(snapshot())
    old = dict(incoming[0], id="local")
    with pytest.raises(ValueError, match="conflicts"):
        module.merge([old], incoming)
    old.update(id="b-example", audit=[{"message":"Imported from the Chronogolf tee sheet for September 8, 2026."}])
    merged, replaced = module.merge([old], incoming)
    assert replaced == 1 and len(merged) == 2


def test_source_capacity_and_slot_validation():
    source = snapshot()
    source["rows"][0][0] = "7:44 AM"
    with pytest.raises(ValueError, match="Invalid slot"):
        module.convert(source)
    source = snapshot()
    source["rows"][0][3][0][3] *= 4
    with pytest.raises(ValueError, match="capacity"):
        module.convert(source)


def test_provenance_and_split_cart_totals():
    rows = module.convert(snapshot())
    assert sum(b["cartCount"] for b in rows) == 2
    assert rows[0]["createdAt"] < rows[1]["createdAt"]
    assert "synthetic" in rows[0]["notes"]
    assert "inferred" in rows[1]["notes"]
    assert rows[1]["players"][0]["paid"] is True
