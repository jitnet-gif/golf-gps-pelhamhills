"""`scripts/migrate_tee_sheet_to_supabase.py` 테스트.

실행: `cd E:\\PELHAMHILLS && python -m pytest backend/tests/test_migrate_tee_sheet_to_supabase.py -q`

모든 요청은 `fake_postgrest` 의 MockTransport 로 간다. 원본은 tmp_path 의 지어낸
예약들이고, 기본 경로를 쓰는 테스트도 `TEE_SHEET_DATA_FILE` 을 tmp 로 돌린다 —
그러지 않으면 실제 `backend/data/tee_sheet.json` 을 읽고 그 요약을 찍는다.

`run()` 헬퍼는 매 호출의 stdout+stderr 에 플레이어 이름·전화·이메일·id 가 없는지
검사한다. 스크립트의 "건수와 필드 이름만" 약속을 모든 모드에서 본다.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from backend.api.routes.tee_sheet import TeeBooking
from backend.services import tee_sheet_store as store
from backend.tests.fake_postgrest import FakePostgrest, install

spec = importlib.util.spec_from_file_location(
    "migrate_tee_sheet_to_supabase",
    Path(__file__).resolve().parents[2] / "scripts/migrate_tee_sheet_to_supabase.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

# 지어낸 사람들. 이름·연락처·id(성 포함)가 출력 어디에도 나오면 안 된다.
PEOPLE = [
    ("Zebulon", "Quackenbush", "reserved", "2026-09-08"),
    ("Philippa", "Oddbody", "checked_in", "2026-09-08"),
    ("Octavius", "Wobblesworth", "paid", "2026-09-09"),
    ("Henrietta", "Fumblewick", "cancelled", "2026-09-10"),
]


def make_doc(first: str, last: str, status: str, day: str) -> dict:
    return TeeBooking(
        id=f"b-{last.lower()}",
        date=day,
        time="7:43 AM",
        title=f"{last}, {first}",
        status=status,
        players=[{
            "firstName": first,
            "lastName": last,
            "phone": f"555-01{len(last):02d}-7731",
            "email": f"{first.lower()}.{last.lower()}@example.test",
        }],
    ).model_dump(mode="json")


DOCS = [make_doc(*person) for person in PEOPLE]
EXTRA = make_doc("Barnaby", "Snodgrass", "reserved", "2026-09-12")

SECRETS = sorted({
    token
    for doc in DOCS + [EXTRA]
    for player in doc["players"]
    for token in (player["firstName"], player["lastName"], player["email"], player["phone"])
} | {doc["id"] for doc in DOCS + [EXTRA]} | {doc["title"] for doc in DOCS + [EXTRA]})


@pytest.fixture()
def fake(monkeypatch, tmp_path) -> FakePostgrest:
    # 기본 원본 경로도 tmp 로. 실수로 인자를 빠뜨려도 실제 데이터 파일을 읽지 않는다.
    monkeypatch.setenv(store.ENV_VAR, str(tmp_path / "default" / "tee_sheet.json"))
    return install(monkeypatch)


def write_source(tmp_path: Path, docs: list) -> Path:
    path = tmp_path / "source.json"
    path.write_text(json.dumps(docs, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def run(capsys, *argv: str) -> tuple[int, str]:
    code = module.main(list(argv))
    captured = capsys.readouterr()
    output = captured.out + captured.err
    leaked = [secret for secret in SECRETS if secret.lower() in output.lower()]
    # 무엇이 샜는지는 개수만 알린다 — 메시지 자체가 누출 경로가 되면 안 된다.
    assert not leaked, f"{len(leaked)} PII token(s) leaked into the script output"
    return code, output


def remote_docs(fake: FakePostgrest) -> dict[str, dict]:
    return {row_id: row["doc"] for row_id, row in fake.rows.items()}


# ===== dry-run =========================================================


@pytest.mark.parametrize("flags", [(), ("--dry-run",)])
def test_dry_run_makes_no_requests(fake, tmp_path, capsys, flags):
    source = write_source(tmp_path, DOCS)
    code, output = run(capsys, "--source", str(source), *flags)
    assert code == module.EXIT_OK
    assert fake.requests == []
    assert fake.rows == {}
    assert "4" in output  # 건수는 찍는다


def test_dry_run_with_verify_is_rejected_without_requests(fake, tmp_path, capsys):
    source = write_source(tmp_path, DOCS)
    code, _ = run(capsys, "--source", str(source), "--dry-run", "--verify")
    assert code == module.EXIT_INPUT_ERROR
    assert fake.requests == []


# ===== apply / verify =================================================


def test_apply_upserts_everything_and_verify_passes(fake, tmp_path, capsys):
    source = write_source(tmp_path, DOCS)
    code, _ = run(capsys, "--source", str(source), "--apply")
    assert code == module.EXIT_OK
    assert remote_docs(fake) == {doc["id"]: doc for doc in DOCS}
    assert fake.calls("DELETE") == []
    # 파생 컬럼도 doc 에서 제대로 뽑혔는가.
    assert {row["id"]: row["status"] for row in fake.rows.values()} == {
        doc["id"]: doc["status"] for doc in DOCS
    }

    fake.requests.clear()
    code, _ = run(capsys, "--source", str(source), "--verify")
    assert code == module.EXIT_OK
    assert {method for method, _, _ in fake.requests} == {"GET"}


def test_apply_is_idempotent(fake, tmp_path, capsys):
    source = write_source(tmp_path, DOCS)
    assert run(capsys, "--source", str(source), "--apply")[0] == module.EXIT_OK
    assert run(capsys, "--source", str(source), "--apply")[0] == module.EXIT_OK
    assert remote_docs(fake) == {doc["id"]: doc for doc in DOCS}


def test_verify_detects_tampered_remote_doc(fake, tmp_path, capsys):
    source = write_source(tmp_path, DOCS)
    assert run(capsys, "--source", str(source), "--apply")[0] == module.EXIT_OK

    fake.rows[DOCS[1]["id"]]["doc"]["notes"] = "edited behind our back"
    code, _ = run(capsys, "--source", str(source), "--verify")
    assert code == module.EXIT_VERIFY_FAILED


def test_verify_detects_missing_remote_row(fake, tmp_path, capsys):
    source = write_source(tmp_path, DOCS)
    assert run(capsys, "--source", str(source), "--apply")[0] == module.EXIT_OK

    del fake.rows[DOCS[0]["id"]]
    code, _ = run(capsys, "--source", str(source), "--verify")
    assert code == module.EXIT_VERIFY_FAILED


def test_verify_against_empty_remote_fails(fake, tmp_path, capsys):
    source = write_source(tmp_path, DOCS)
    code, _ = run(capsys, "--source", str(source), "--verify")
    assert code == module.EXIT_VERIFY_FAILED
    assert fake.rows == {}


# ===== prune ===========================================================


def test_apply_without_prune_keeps_extra_remote_rows(fake, tmp_path, capsys):
    fake.seed([EXTRA])
    source = write_source(tmp_path, DOCS)
    code, _ = run(capsys, "--source", str(source), "--apply")
    assert code == module.EXIT_OK          # 원격에만 있는 행은 보고만 한다
    assert EXTRA["id"] in fake.rows
    assert fake.calls("DELETE") == []


def test_prune_deletes_extras_and_keeps_source(fake, tmp_path, capsys):
    fake.seed([EXTRA])
    source = write_source(tmp_path, DOCS)
    code, _ = run(capsys, "--source", str(source), "--apply", "--prune")
    assert code == module.EXIT_OK
    assert remote_docs(fake) == {doc["id"]: doc for doc in DOCS}
    assert len(fake.calls("DELETE")) == 1


def test_prune_requires_apply(fake, tmp_path, capsys):
    fake.seed([EXTRA])
    source = write_source(tmp_path, DOCS)
    code, _ = run(capsys, "--source", str(source), "--prune")
    assert code == module.EXIT_INPUT_ERROR
    assert fake.requests == []
    assert EXTRA["id"] in fake.rows


def test_prune_keeps_ids_that_were_skipped_as_invalid(fake, tmp_path, capsys):
    broken = dict(DOCS[2], date="2026-02-30")   # 형식은 맞지만 없는 날짜
    fake.seed([DOCS[2], EXTRA])
    source = write_source(tmp_path, [DOCS[0], DOCS[1], broken])
    code, _ = run(capsys, "--source", str(source), "--apply", "--prune", "--skip-invalid")
    assert code == module.EXIT_OK
    assert set(fake.rows) == {DOCS[0]["id"], DOCS[1]["id"], DOCS[2]["id"]}


# ===== 입력 오류 =======================================================


def test_missing_source_exits_2_and_creates_nothing(fake, tmp_path, capsys):
    missing = tmp_path / "nowhere" / "tee_sheet.json"
    for flags in ((), ("--apply",), ("--verify",)):
        code, _ = run(capsys, "--source", str(missing), *flags)
        assert code == module.EXIT_INPUT_ERROR
    assert not missing.exists()
    assert not missing.parent.exists()
    assert fake.requests == []


def test_missing_default_source_does_not_seed(fake, tmp_path, capsys):
    # --source 없이. store.load_bookings() 였다면 여기서 시드 파일이 생겼을 것이다.
    default = store.data_file()
    assert default.is_relative_to(tmp_path.resolve())
    for flags in ((), ("--apply",)):
        code, _ = run(capsys, *flags)
        assert code == module.EXIT_INPUT_ERROR
    assert not default.exists()
    assert not default.parent.exists()
    assert fake.requests == []


def test_default_source_follows_env(fake, tmp_path, capsys):
    default = store.data_file()
    default.parent.mkdir(parents=True)
    default.write_text(json.dumps(DOCS), encoding="utf-8")
    code, _ = run(capsys, "--apply")
    assert code == module.EXIT_OK
    assert set(fake.rows) == {doc["id"] for doc in DOCS}


def test_corrupt_source_exits_2(fake, tmp_path, capsys):
    source = tmp_path / "source.json"
    # 파일 조각이 오류 메시지에 섞이지 않는지도 본다 (JSONDecodeError.doc 은 파일 전체다).
    source.write_text('[{"id": "b-quackenbush", "title": "Quackenbush, Zebulon",', encoding="utf-8")
    code, _ = run(capsys, "--source", str(source), "--apply")
    assert code == module.EXIT_INPUT_ERROR
    assert fake.requests == []


@pytest.mark.parametrize("breakage", [
    {"date": "2026-02-30"},                  # 달력에 없는 날짜 (date 컬럼이 거절)
    {"time": "7:44 AM", "holes": 27},        # 모델 검증 실패
    {"id": ""},                              # 기본키 없음
    {"createdAt": 1756728000},               # timestamptz 로 못 가는 값
])
def test_invalid_record_exits_2_unless_skip_invalid(fake, tmp_path, capsys, breakage):
    broken = dict(DOCS[3], **breakage)
    source = write_source(tmp_path, DOCS[:3] + [broken])

    for flags in ((), ("--apply",)):
        code, _ = run(capsys, "--source", str(source), *flags)
        assert code == module.EXIT_INPUT_ERROR
    assert fake.requests == []

    code, _ = run(capsys, "--source", str(source), "--apply", "--skip-invalid")
    assert code == module.EXIT_OK
    assert remote_docs(fake) == {doc["id"]: doc for doc in DOCS[:3]}


def test_duplicate_ids_are_all_skipped(fake, tmp_path, capsys):
    twin = dict(DOCS[0], notes="second copy")
    source = write_source(tmp_path, DOCS + [twin])
    assert run(capsys, "--source", str(source), "--apply")[0] == module.EXIT_INPUT_ERROR
    assert fake.requests == []

    code, _ = run(capsys, "--source", str(source), "--apply", "--skip-invalid")
    assert code == module.EXIT_OK
    assert set(fake.rows) == {doc["id"] for doc in DOCS[1:]}


# ===== Supabase 오류 ===================================================


@pytest.mark.parametrize("status, code", [(500, "XX000"), (409, "23505"), (404, "42P01")])
def test_supabase_error_exits_2_without_leaking(fake, tmp_path, capsys, status, code):
    # 가짜 서버의 오류 본문은 실제 Postgres 처럼 실패한 행(= 이름·전화)을 그대로 담는다.
    # run() 이 그것이 출력에 새지 않는지 본다.
    fake.fail_next(status, code)
    source = write_source(tmp_path, DOCS)
    exit_code, output = run(capsys, "--source", str(source), "--apply")
    assert exit_code == module.EXIT_INPUT_ERROR
    assert str(status) in output
    assert fake.rows == {}


def test_leak_detector_actually_fires(fake, tmp_path, capsys):
    # run() 의 검사가 헛돌지 않는다는 증거. --show-ids 는 성이 든 id 를 일부러 찍는다.
    source = write_source(tmp_path, DOCS)
    with pytest.raises(AssertionError, match="PII token"):
        run(capsys, "--source", str(source), "--verify", "--show-ids")


def test_show_ids_is_the_only_way_to_print_ids(fake, tmp_path, capsys):
    source = write_source(tmp_path, DOCS)
    module.main(["--source", str(source), "--verify", "--show-ids"])
    output = capsys.readouterr().out
    assert DOCS[0]["id"] in output
    # id 는 나와도 이름·연락처는 여전히 나오지 않는다.
    player = DOCS[0]["players"][0]
    assert player["firstName"] not in output
    assert player["email"] not in output and player["phone"] not in output
