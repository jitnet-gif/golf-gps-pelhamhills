"""티 시트 JSON 파일을 Supabase `pelham_tee_bookings` 로 한 번 옮긴다.
`--apply` 를 붙이기 전에는 dry-run 이다 — 로컬 파일만 읽고 네트워크를 전혀 쓰지 않는다.

⚠️ 예약에는 실제 플레이어 이름·전화·이메일이 들어 있다. 출력은 **건수와 필드 이름만**
남긴다. id 도 기본으로는 찍지 않는다 — 시드 id 는 `b-xeric` 처럼 성을 품고 있다
(`--show-ids` 를 붙여야 나온다).

언제 돌리나
-----------
`supabase/migrations/0002_tee_bookings.sql` 을 적용해 테이블을 만든 뒤, 저장 엔진을
`TEE_SHEET_BACKEND=supabase` 로 바꾸기 **직전에** 한 번. 권장 순서:

    1. python scripts/migrate_tee_sheet_to_supabase.py            # dry-run: 건수·날짜 범위·상태별
    2. python scripts/migrate_tee_sheet_to_supabase.py --apply    # upsert 후 자동 검증
    3. TEE_SHEET_BACKEND=supabase 설정
    4. API 재시작

로컬 API 는 이관하는 동안 멈춰 둔다. JSON 저장소는 인메모리 캐시를 쥐고 디스크를
감시하지 않는다 — 돌고 있는 API 가 도중에 쓰면 그 변경은 파일에만 남고 원격에는
빠진 채로 엔진이 넘어간다 (운이 좋으면 검증이 불일치로 잡는다).

무엇을 올리나
-------------
파일의 원소를 **그대로** 올린다. `TeeBooking` 검증은 통과 여부만 가르고 결과는 버린다.
`doc` 은 JSON 저장소의 한 원소와 같아야 하고 (0002 주석), 정규화한 값을 올리면
검증의 정확한 비교가 성립하지 않는다. 정규화는 첫 쓰기 때 API 가 알아서 한다.

원본은 `json.load` 로 직접 읽는다. `tee_sheet_store.load_bookings()` 는 파일이 없으면
시드를 심는다 — 이관이 데이터를 지어내면 안 된다.

모드
----
  (기본)    dry-run. 네트워크 0회.
  --verify  원격을 읽어 id 별로 비교만 한다 (누락 / doc 불일치 / 원격에만 있는 행).
  --apply   upsert 한 뒤 --verify 와 같은 검증. **지우지 않는다.**
  --prune   --apply 와 함께만. 원본 파일에 없는 원격 id 를 지운다. 지우기 전에 건수를 찍는다.

종료 코드: 0 정상 (원격에만 있는 행은 보고만 하고 0) / 1 검증에서 누락 또는 불일치 /
2 입력·설정 오류 (원본 없음·손상, 무효·중복 레코드, Supabase 설정·HTTP 오류).

접속 정보는 환경변수가 우선이고, 없으면 backend 설정에서 읽는다
(`tee_sheet_supabase` 가 정한다). service_role 키가 필요하다 — RLS 가 켜져 있다.

    SUPABASE_URL=https://<ref>.supabase.co \\
    SUPABASE_SERVICE_ROLE_KEY=... \\
    python scripts/migrate_tee_sheet_to_supabase.py --apply
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any, Iterable

import httpx
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.api.routes.tee_sheet import TeeBooking
from backend.services import tee_sheet_store as store
from backend.services import tee_sheet_supabase as sb

EXIT_OK = 0
EXIT_VERIFY_FAILED = 1
EXIT_INPUT_ERROR = 2

#: doc 에서 timestamptz 컬럼으로 복사되는 필드. pydantic 은 유닉스 초(int)도 datetime
#: 으로 받아 주지만, 원본을 그대로 올리면 그 int 가 컬럼으로 가서 청크 전체가 실패한다.
_TIMESTAMP_FIELDS = ("holdExpiresAt", "createdAt", "updatedAt")


class SourceError(Exception):
    """원본 파일을 쓸 수 없다. 메시지에 파일 내용을 넣지 않는다."""


def load_source(path: Path) -> list[Any]:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            raw = json.load(handle)
    except FileNotFoundError:
        raise SourceError(f"원본 파일이 없다: {path}") from None
    except json.JSONDecodeError as exc:
        # 위치만 남긴다. exc.doc 에는 파일 전체가 들어 있다.
        raise SourceError(f"원본 JSON 이 손상됐다: {path} (줄 {exc.lineno}, 칸 {exc.colno})") from None
    except (OSError, UnicodeDecodeError) as exc:
        raise SourceError(f"원본 파일을 읽을 수 없다: {path} ({type(exc).__name__})") from None
    if not isinstance(raw, list):
        raise SourceError(f"원본 최상위가 배열이 아니다: {path} ({type(raw).__name__})")
    return raw


def problems(item: Any) -> list[tuple[str, str]]:
    """레코드 하나의 문제를 (필드 위치, 오류 종류) 로 돌려준다. 값은 절대 담지 않는다.

    pydantic 오류의 `input` 과 `msg` 는 버린다 — 이름·전화가 그대로 들어 있을 수 있다.
    """
    if not isinstance(item, dict):
        return [("record", "not_object")]

    found: list[tuple[str, str]] = []
    record_id = item.get("id")
    if not isinstance(record_id, str) or not record_id.strip():
        # TeeBooking.id 는 default_factory 가 있어 검증은 통과한다. 하지만 원본을 그대로
        # 올리므로 doc["id"] 가 없으면 기본키가 없다.
        found.append(("id", "missing"))

    try:
        TeeBooking.model_validate(item)
    except ValidationError as exc:
        for err in exc.errors():
            found.append((".".join(str(part) for part in err["loc"]) or "record", err["type"]))

    # 패턴은 `2026-02-30` 도 통과시킨다. booking_date 는 date 컬럼이라 거기서 터진다.
    raw_date = item.get("date")
    if isinstance(raw_date, str) and not any(loc == "date" for loc, _ in found):
        try:
            date.fromisoformat(raw_date)
        except ValueError:
            found.append(("date", "invalid_calendar_date"))

    for field in _TIMESTAMP_FIELDS:
        value = item.get(field)
        if value is not None and not isinstance(value, str):
            found.append((field, "not_iso_string"))
    return found


def inspect(raw: list[Any]) -> dict[str, Any]:
    """원본을 유효 / 무효 / 중복으로 가른다. 순수 함수 — I/O 도 네트워크도 없다."""
    id_counts = Counter(
        item["id"] for item in raw if isinstance(item, dict) and isinstance(item.get("id"), str)
    )
    duplicate_ids = {record_id for record_id, count in id_counts.items() if count > 1}

    valid: list[dict[str, Any]] = []
    invalid_ids: list[str] = []
    invalid = 0
    duplicate_records = 0
    reasons: Counter[tuple[str, str]] = Counter()
    for item in raw:
        found = problems(item)
        if found:
            invalid += 1
            reasons.update(set(found))
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                invalid_ids.append(item["id"])
        elif item["id"] in duplicate_ids:
            # 같은 id 의 사본은 **전부** 뺀다. 어느 쪽이 맞는지 알 수 없고, 한 요청에
            # 같은 id 가 두 번 실리면 PostgREST upsert 가 "ON CONFLICT DO UPDATE
            # cannot affect row a second time" 으로 청크째 거부한다.
            duplicate_records += 1
        else:
            valid.append(item)

    return {
        "total": len(raw),
        "valid": valid,
        "invalid": invalid,
        "invalid_ids": invalid_ids,
        "reasons": reasons,
        "duplicate_ids": duplicate_ids,
        "duplicate_records": duplicate_records,
        # prune 이 지우면 안 되는 id. 무효·중복으로 이번에 빠진 레코드도 원본에는 있다 —
        # 원격에 이미 있다면 그건 지울 대상이 아니라 사람이 고칠 대상이다.
        "source_ids": set(id_counts),
    }


def _ids(ids: Iterable[str], show: bool) -> str:
    listed = sorted(ids)
    if not show or not listed:
        return ""
    return " -> " + ", ".join(listed)


def print_summary(path: Path, report: dict[str, Any], show_ids: bool) -> None:
    valid = report["valid"]
    dates = sorted(doc["date"] for doc in valid)
    statuses = Counter(doc.get("status") or "(없음)" for doc in valid)

    print(f"원본            : {path}")
    print(f"레코드          : {report['total']}")
    print(f"유효            : {len(valid)}")
    print(f"날짜 범위       : {dates[0]} .. {dates[-1]}" if dates else "날짜 범위       : (없음)")
    for status, count in sorted(statuses.items()):
        print(f"  - {status:22s} {count}")
    print(f"무효            : {report['invalid']}" + _ids(report["invalid_ids"], show_ids))
    for (loc, kind), count in sorted(report["reasons"].items()):
        print(f"  - {loc + ': ' + kind:40s} {count}")
    print(
        f"중복 id         : {len(report['duplicate_ids'])}"
        f" (레코드 {report['duplicate_records']})" + _ids(report["duplicate_ids"], show_ids)
    )


def verify(expected: list[dict[str, Any]], source_ids: set[str], show_ids: bool) -> int:
    """원격 전체를 읽어 id 별로 비교한다. 누락·불일치가 있으면 1.

    비교는 dict 동등성이다. jsonb 는 키 순서를 바꾸지만 dict `==` 는 순서를 보지 않는다.
    """
    remote = {doc.get("id"): doc for doc in sb.fetch_all()}
    wanted = {doc["id"]: doc for doc in expected}

    missing = [i for i in wanted if i not in remote]
    mismatch = [i for i in wanted if i in remote and remote[i] != wanted[i]]
    extra = [i for i in remote if i not in wanted]
    extra_skipped = [i for i in extra if i in source_ids]

    print(f"\n검증 ({sb.TABLE})")
    print(f"  원격 행          : {len(remote)}")
    print(f"  원격에 없음      : {len(missing)}" + _ids(missing, show_ids))
    print(f"  doc 불일치       : {len(mismatch)}" + _ids(mismatch, show_ids))
    print(f"  원격에만 있음    : {len(extra)}" + _ids(extra, show_ids))
    if extra_skipped:
        print(f"    그중 원본에서 제외(무효·중복)된 id : {len(extra_skipped)}")

    if missing or mismatch:
        print("검증 실패.")
        return EXIT_VERIFY_FAILED
    # 제외된 id 는 prune 도 지우지 않으므로, 그것만 남았을 때 prune 을 권하면 헛걸음이다.
    prunable = len(extra) - len(extra_skipped)
    print("검증 통과." + (f" (원격에만 있는 {prunable}행은 --apply --prune 으로 지운다)" if prunable else ""))
    return EXIT_OK


def apply(report: dict[str, Any], prune: bool, show_ids: bool) -> int:
    """upsert → (prune) → 검증.

    `sb.replace_all` 은 쓰지 않는다. 그건 원본에 없는 행을 **지우므로** "--apply 는
    지우지 않는다" 는 약속을 깬다. 지우는 건 --prune 이 명시적으로 할 때뿐이다.
    """
    docs = report["valid"]
    print(f"\nupsert {len(docs)}건 -> {sb.TABLE}")
    sent = sb.upsert(docs) if docs else 0
    print(f"  보냄 {sent}")

    if prune:
        # upsert 를 먼저 끝낸 뒤 지운다. 둘은 원자적이지 않다 — 지우기 전에 멈추면
        # 남는 건 "지웠어야 할 행" 이지 "잃어버린 행" 이 아니다.
        remote_ids = [doc.get("id") for doc in sb.fetch_all()]
        doomed = [i for i in remote_ids if i not in report["source_ids"]]
        print(f"\nprune: 원본에 없는 원격 행 {len(doomed)}건을 지운다." + _ids(doomed, show_ids))
        if doomed:
            print(f"  삭제 요청 {sb.delete_ids(doomed)}")

    return verify(docs, report["source_ids"], show_ids)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    # 기본값을 여기서 굳히지 않는다. TEE_SHEET_DATA_FILE 은 호출 시점에 읽어야 한다.
    parser.add_argument("--source", type=Path, default=None, help="기본: tee_sheet_store.data_file()")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Supabase 에 upsert 한 뒤 검증한다")
    mode.add_argument("--dry-run", action="store_true", help="기본값. 네트워크를 쓰지 않는다")
    parser.add_argument("--verify", action="store_true", help="원격과 비교만 한다 (--apply 는 자동 포함)")
    parser.add_argument("--prune", action="store_true", help="--apply 와 함께: 원본에 없는 원격 행을 지운다")
    parser.add_argument("--skip-invalid", action="store_true", help="무효·중복 레코드를 빼고 진행한다")
    parser.add_argument("--show-ids", action="store_true", help="id 를 출력한다 (성이 들어 있을 수 있다)")
    return parser


def _fail(message: str) -> int:
    print(message, file=sys.stderr)
    return EXIT_INPUT_ERROR


def main(argv: list[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
    except SystemExit as exc:  # 테스트가 main() 의 반환값으로 받게 한다
        return exc.code if isinstance(exc.code, int) else EXIT_INPUT_ERROR

    if args.prune and not args.apply:
        return _fail("--prune 은 --apply 와 함께만 쓴다.")
    if args.dry_run and args.verify:
        return _fail("--dry-run 은 네트워크를 쓰지 않는다. --verify 와 함께 쓸 수 없다.")

    path = args.source or store.data_file()
    try:
        raw = load_source(path)
    except SourceError as exc:
        return _fail(str(exc))

    report = inspect(raw)
    print_summary(path, report, args.show_ids)

    if report["invalid"] or report["duplicate_ids"]:
        if not args.skip_invalid:
            return _fail(
                "\n무효 또는 중복 레코드가 있어 멈춘다. 원본을 고치거나 --skip-invalid 로 빼고 진행한다."
            )
        print(f"\n--skip-invalid: {report['invalid'] + report['duplicate_records']}건을 빼고 진행한다.")

    if not (args.apply or args.verify):
        print("\ndry-run 이다 (네트워크 호출 없음). 실제로 쓰려면 --apply 를 붙인다.")
        return EXIT_OK

    if args.prune and not report["valid"]:
        # 스펙에 없는 안전장치. 유효 레코드 0건으로 prune 하면 테이블이 통째로 비는데,
        # 그건 거의 항상 엉뚱한 --source 를 준 실수다.
        return _fail("안전상 거부: 유효 레코드가 0건인 원본으로는 --prune 하지 않는다.")

    try:
        if args.apply:
            return apply(report, args.prune, args.show_ids)
        return verify(report["valid"], report["source_ids"], args.show_ids)
    except sb.SupabaseStoreError as exc:
        # 메시지에는 메서드·테이블·HTTP 상태·PostgREST 코드만 있다 (tee_sheet_supabase 계약).
        hint = " 0002_tee_bookings.sql 을 적용했는지 확인한다." if exc.status == 404 else ""
        return _fail(f"Supabase 오류: {exc}.{hint}")
    except httpx.HTTPError as exc:
        # str(exc) 는 찍지 않는다. 요청 URL 이 들어 있고, 삭제 URL 에는 id(=성)가 실린다.
        return _fail(f"Supabase 네트워크 오류: {type(exc).__name__}")


if __name__ == "__main__":
    raise SystemExit(main())
