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
