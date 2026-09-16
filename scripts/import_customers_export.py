"""Lightspeed/Chronogolf `Customers > Export` CSV 를 Supabase `pelham_customers` 로 올린다.
`--apply` 를 붙이기 전에는 dry-run 이다.

⚠️ 실제 고객 개인정보를 다룬다. 출력에 레코드 내용을 찍지 않는다 — **건수와
customer_ref 만** 남긴다 (`backend/services/customer_store.py` 와 같은 규칙).

`scripts/import_teesheet_customers.py` 와 무엇이 다른가
------------------------------------------------------
둘 다 고객을 만들지만 **소스도 id 공간도 다르다.**

  티시트 export : 라운드-플레이어 한 명당 한 행. id 는 `Round Player ID`.
                  플레이 이력은 있지만 이메일·주소·회원번호가 없다.
  고객 export   : 고객 한 명당 한 행. id 는 `Customer Reference`.
                  연락처와 회원 정보는 있지만 라운드별 이력이 없다.

그래서 이 스크립트는 티시트 임포터를 대체하지 않고 **비어 있던 칸을 채운다.**
두 명부는 id 로 join 되지 않으므로(`chronogolf:10094871` vs `EFAE-Q2R1`),
`--reconcile` 은 `customer_store.find_customer` 의 순서(이메일 → 전화 → 이름)로
겹치는 사람을 찾아 **보고만 한다.** 자동으로 합치지 않는다.

정규화는 다시 구현하지 않는다. `customer_store` 의 `normalize_email` /
`normalize_phone` / `normalize_zip` / `clean_display_name` 을 그대로 쓴다 —
두 벌이 되는 순간 같은 사람이 저장소마다 다른 키를 갖는다.

쓰기 경로
---------
PostgREST 로 직접 upsert 한다 (`on_conflict=customer_ref`). service_role 키가
필요하다 — RLS 가 켜져 있어 anon 키로는 한 행도 쓰지 못한다.

    SUPABASE_URL=https://<ref>.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=... \
    python scripts/import_customers_export.py <csv> --apply
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.services import customer_store as store
from backend.services.tee_sheet_store import split_name

SOURCE = "lightspeed_customers_export"

#: 이 계정들은 프로 샵/직원이다. 명부에는 넣되 회원 통계에서 빼기 위해 표시한다.
#: (`import_teesheet_customers.py` 의 STAFF_BOOKER_IDS 와 같은 의도)
STAFF_EMAIL_DOMAINS = {"pelhamhills.ca"}

#: 소스 CSV 에서 **일부러 읽지 않는** 컬럼. 이유는 0001_customers.sql 에 적혀 있다.
DROPPED_COLUMNS = {
    "Bag Number",
    "Bank Account on File? (Yes / No)",
    "Bank Account Last 4",
    "ACH Status",
    "Bank Account Last Updated At",
    "Credit Card Last 4",
    "Credit Card Expiry",
}


def yes(raw: str) -> bool:
    return (raw or "").strip().casefold() in {"yes", "true"}


def as_date(raw: str) -> str | None:
    """`YYYY-MM-DD` 만 받는다. 파싱 안 되면 None — 추측하지 않는다."""
    value = (raw or "").strip()
    if not value:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        return None


def as_number(raw: str) -> float | None:
    value = (raw or "").strip()
    try:
        return float(value) if value else None
    except ValueError:
        return None


def as_int(raw: str) -> int:
    digits = re.sub(r"\D", "", (raw or "").strip())
    return int(digits) if digits else 0


def build(rows: list[dict], source_name: str) -> list[dict]:
    """CSV 행 -> 레코드 목록. 순수 변환 — I/O 도 네트워크도 없다."""
    # 실행 시각을 여기 넣지 않는다. provenance 는 행 내용의 일부라, 매번 바뀌는
    # 값이 들어가면 같은 CSV 를 다시 올려도 500행 전부가 "변경됨"이 되고
    # updated_at 트리거가 무의미해진다. 처음 들어온 시각은 created_at 이 갖는다.
    provenance_base = {
        "source": "Lightspeed Customers Export",
        "file": source_name,
        "rowCount": len(rows),
        "droppedColumns": sorted(DROPPED_COLUMNS),
    }

    records: list[dict] = []
    for row in rows:
        ref = (row.get("Customer Reference") or "").strip()
        if not ref:
            continue  # 자연키가 없으면 레코드로 만들 수 없다.

        reasons: list[str] = []

        first_raw = (row.get("First Name") or "").strip()
        last_raw = (row.get("Last Name") or "").strip()
        display_raw = " ".join(p for p in (first_raw, last_raw) if p)
        cleaned, tags, nickname = store.clean_display_name(display_raw)
        # 성/이름 분해는 tee_sheet_store.split_name 이 유일한 구현이다.
        # 소스가 이미 나눠 놨으므로 **둘 다 비어 있을 때만** 쪼갠다.
        #
        # 한쪽만 비었을 때 쪼개면 안 된다: 소스에 성만 있고 이름이 빈 행이 셋 있는데,
        # `split_name("Pasche")` 는 `("Pasche", "")` 를 돌려준다. 이걸 폴백으로 쓰면
        # 성이 이름 칸에 복사되고, 두 칸이 다 채워지니 needs_review 도 서지 않는다.
        # 없는 이름은 지어내지 않고 비워 둔 채 사람에게 넘긴다.
        if not first_raw and not last_raw:
            first, last = split_name(cleaned)
        else:
            first, last = first_raw, last_raw
        if not first:
            reasons.append("first_name_missing")
        if not last:
            reasons.append("last_name_missing")

        email_raw = (row.get("Email") or "").strip()
        email = store.normalize_email(email_raw)
        if email_raw and not email:
            reasons.append("email_unparsed")

        phone_raw = (row.get("Phone Number") or "").strip()
        phone = store.normalize_phone(phone_raw)
        if phone_raw and not phone:
            reasons.append("phone_unparsed")

        zip_raw = (row.get("Postcode/Zip Code") or "").strip()
        postal = store.normalize_zip(zip_raw)
        if zip_raw and not postal:
            reasons.append("postal_unparsed")

        role = (row.get("Player Roles") or "").strip()
        dob = as_date(row.get("Date of Birth", ""))
        if (row.get("Date of Birth") or "").strip() and not dob:
            reasons.append("dob_unparsed")

        records.append(
            {
                "customer_ref": ref,
                "first_name": first or None,
                "last_name": last or None,
                "display_name": cleaned or None,
                "nickname": nickname or None,
                "source_tags": tags,
                "email": email or None,
                "email_raw": email_raw or None,
                "phone": phone or None,
                "phone_raw": phone_raw or None,
                "gender": (row.get("Gender") or "").strip() or None,
                "date_of_birth": dob,
                "player_role": role or None,
                # `Player Roles` 가 Member 면 회원. 티시트 export 와 달리 이 CSV 는
                # 고객당 한 행이라 "한 번이라도 회원" 규칙이 필요 없다.
                "is_member": role.casefold() == "member",
                "player_type": (row.get("Player Types") or "").strip() or None,
                "member_number": (row.get("Member Number") or "").strip() or None,
                "scoring_factor": as_number(row.get("Latest Scoring Factor", "")),
                "address_line1": (row.get("Address Line 1") or "").strip() or None,
                "city": (row.get("City") or "").strip() or None,
                "state_code": (row.get("State Code") or "").strip() or None,
                "country_code": (row.get("Country Code") or "").strip() or None,
                "postal_code": postal or None,
                "postal_code_raw": zip_raw or None,
                "activation_state": (row.get("Activation State") or "").strip() or None,
                "has_credit_card": yes(row.get("Credit Card on File? (Yes / No)", "")),
                "prefers_mailed_statements": yes(row.get("Prefers Mailed Statements?", "")),
                "hidden_from_tee_sheet": yes(row.get("Is Hidden From Tee Sheet?", "")),
                "hidden_from_directory": yes(row.get("Is Hidden from Directory?", "")),
                "rounds_booked_played": as_int(row.get("Rounds Booked & Played", "")),
                "user_created_on": as_date(row.get("User Creation Date", "")),
                "needs_review": bool(reasons),
                "review_reasons": reasons,
                "possible_duplicate_of": [],
                "source": SOURCE,
                "provenance": provenance_base,
            }
        )

    flag_duplicates(records)
    return records


def flag_duplicates(records: list[dict]) -> None:
    """같은 사람이 두 번 등록된 것으로 **의심되는** 행을 표시한다. 합치지 않는다.

    전화번호가 같다는 것만으로는 부족하다 — 소스에 한 집에서 유선 하나를 같이
    쓰는 부부가 있다 (`customer_store.find_customer` 의 docstring 이 같은 이유로
    전화를 이메일보다 뒤에 둔다). 그래서 **전화가 같고 성도 비슷한** 경우만
    의심으로 올린다. 성 비교는 오타를 견디도록 앞 4글자로 자른다 — 소스에
    같은 사람이 성 철자만 다르게 두 번 들어간 행이 실제로 있다.
    """
    by_phone: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        if rec["phone"]:
            by_phone[rec["phone"]].append(rec)

    for group in by_phone.values():
        if len(group) < 2:
            continue
        for i, a in enumerate(group):
            for b in group[i + 1 :]:
                if similar_last_name(a["last_name"], b["last_name"]):
                    for one, other in ((a, b), (b, a)):
                        one["possible_duplicate_of"].append(other["customer_ref"])
                        one["needs_review"] = True
                        if "possible_duplicate" not in one["review_reasons"]:
                            one["review_reasons"].append("possible_duplicate")


def similar_last_name(a: str | None, b: str | None) -> bool:
    left = re.sub(r"[^a-z]", "", (a or "").casefold())
    right = re.sub(r"[^a-z]", "", (b or "").casefold())
    if not left or not right:
        return False
    return left[:4] == right[:4]


def reconcile(records: list[dict]) -> dict:
    """기존 `customers.json` 명부와 겹치는 사람을 **세기만** 한다.

    두 소스는 id 공간이 달라 join 되지 않는다. `find_customer` 의 순서
    (이메일 → 전화 → 이름) 를 그대로 빌려 쓴다.
    """
    existing = store.load_customers()
    matched, unmatched = 0, 0
    for rec in records:
        hit = store.find_customer(
            existing,
            email=rec["email"],
            phone=rec["phone"],
            name=rec["display_name"],
        )
        if hit:
            matched += 1
        else:
            unmatched += 1
    return {"local_records": len(existing), "matched": matched, "csv_only": unmatched}


def push(records: list[dict], url: str, key: str, chunk: int = 100) -> int:
    """PostgREST 로 upsert. service_role 키가 필요하다 (RLS 우회)."""
    import httpx

    endpoint = f"{url.rstrip('/')}/rest/v1/pelham_customers?on_conflict=customer_ref"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    written = 0
    with httpx.Client(timeout=30.0) as client:
        for start in range(0, len(records), chunk):
            batch = records[start : start + chunk]
            res = client.post(endpoint, headers=headers, json=batch)
            if res.status_code >= 400:
                # 본문에 고객 데이터가 섞여 나올 수 있으므로 상태코드와 건수만 남긴다.
                raise SystemExit(
                    f"업로드 실패: HTTP {res.status_code} "
                    f"(행 {start}..{start + len(batch)}). 응답 본문은 PII 가 섞일 수 있어 찍지 않는다."
                )
            written += len(batch)
            print(f"  upsert {written}/{len(records)}")
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="customers_export.csv 경로")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Supabase 에 실제로 쓴다")
    mode.add_argument("--dry-run", action="store_true", help="기본값")
    parser.add_argument("--out", type=Path, help="변환 결과를 JSON 으로 저장 (검토용)")
    parser.add_argument("--reconcile", action="store_true", help="기존 customers.json 과 겹침 보고")
    args = parser.parse_args()

    with args.source.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    records = build(rows, args.source.name)

    members = sum(1 for r in records if r["is_member"])
    review = [r for r in records if r["needs_review"]]
    dupes = sorted({r["customer_ref"] for r in records if r["possible_duplicate_of"]})
    reason_counts = Counter(reason for r in records for reason in r["review_reasons"])

    print(f"CSV 행         : {len(rows)}")
    print(f"레코드         : {len(records)}  (회원 {members} / 퍼블릭 {len(records) - members})")
    print(f"검토 필요      : {len(review)}")
    for reason, count in reason_counts.most_common():
        print(f"  - {reason:24s} {count}")
    print(f"중복 의심 ref  : {len(dupes)}" + (f" -> {', '.join(dupes)}" if dupes else ""))

    if args.reconcile:
        print(f"기존 명부 대조 : {reconcile(records)}")

    if args.out:
        args.out.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"저장           : {args.out}  (⚠️ PII — 커밋하지 말 것)")

    if not args.apply:
        print("\ndry-run 이다. 실제로 쓰려면 --apply 를 붙인다.")
        return

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise SystemExit("SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요하다.")
    written = push(records, url, key)
    print(f"\n완료: {written}행 upsert.")


if __name__ == "__main__":
    main()
