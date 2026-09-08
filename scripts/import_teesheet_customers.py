"""Chronogolf 대시보드 티시트 CSV export 에서 고객 명부를 뽑는다; --apply 전엔 dry-run.

⚠️ 실제 고객 개인정보를 다룬다. 출력에 레코드 내용을 찍지 않는다 (건수만).

소스는 `Chronogolf 대시보드 > 티시트 export` CSV 로, **라운드-플레이어 한 명당 한 행**이다.
이름이 있는 행만 고객이 된다. 이름이 빈 행은 익명 좌석이라 명부에 넣지 않는다.

이 export 가 말해주지 않는 것 — 임포트된 값을 권위 있는 것으로 읽지 않도록 각
레코드의 `provenance` 에 그대로 적어 둔다:

- `Member Number` 가 모든 행에서 비어 있다. 회원 번호는 이 export 로 안 나온다.
  `isMember` 는 `Player Role` 에서 유도한 것이다.
- 회원 행은 그린피/카트피가 항상 0.00 이다. 회원 회비는 이 export 에 없다.
  그래서 `totalSpendCents` 는 회원에게 항상 0 이고, **매출 지표가 아니다**.
- export 는 500행에서 잘린다. 명부는 그 창에서 플레이한 사람만 담는다.
"""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.services import customer_store as store

SOURCE = "chronogolf"
CLUB_ID = 19671

# 이 두 계정은 프로 샵 직원이다. 예약자로만 등장하고 플레이어 행이 없어서
# 이름 있는 행만 훑는 이 스크립트에는 애초에 잡히지 않지만, 나중에 예약자까지
# 훑도록 넓힐 때 실수로 고객이 되지 않도록 명시해 둔다.
STAFF_BOOKER_IDS = {"18500599", "9048677"}


def cents(raw):
    """달러 문자열 -> 센트 정수. float 로 합산하면 하루치에서 1센트씩 어긋난다."""
    value = (raw or "").strip()
    return int(round(float(value) * 100)) if value else 0


def normalize_name_key(name):
    return re.sub(r"[^a-z]", "", (name or "").casefold())


def build(rows, source_name):
    """CSV 행들을 고객 레코드 목록으로. 순수 변환 — I/O 도 저장도 하지 않는다."""
    grouped = defaultdict(list)
    for row in rows:
        display = (row.get("Player Name") or "").strip()
        source_id = (row.get("Round Player ID") or "").strip()
        if not display or not source_id:
            continue  # 익명 좌석. 명부에 넣지 않는다.
        if source_id in STAFF_BOOKER_IDS:
            continue
        grouped[source_id].append(row)

    dates = [r["Start Date"] for r in rows if r.get("Start Date")]
    coverage = f"{min(dates)}..{max(dates)}" if dates else "unknown"
    now = datetime.now(timezone.utc).isoformat()

    customers = []
    for source_id, player_rows in grouped.items():
        # 행마다 이름이 미세하게 다를 수 있으니 가장 최근 행의 표기를 쓴다.
        player_rows.sort(key=lambda r: (r.get("Start Date", ""), r.get("Start Time", "")))
        clean, tags, nickname = store.clean_display_name(player_rows[-1]["Player Name"])
        first, last = store.split_display_name(clean)

        def newest(field):
            """가장 최근 행부터 훑어 처음 채워진 값. (연락처는 채워진 값이 이긴다)"""
            for row in reversed(player_rows):
                value = (row.get(field) or "").strip()
                if value:
                    return value
            return ""

        phone_raw = newest("Player Phone")
        phone = store.normalize_phone(phone_raw)
        roles = {(r.get("Player Role") or "").strip() for r in player_rows} - {""}
        plans = {(r.get("Player Type") or "").strip() for r in player_rows} - {""}
        is_member = "Member" in roles

        # 등급은 요금제 이름에서만 나온다 (`Member Number` 가 소스에 전부 비어 있다).
        # 대표 등급은 **가장 최근 회원 행**의 것을 쓴다. 등급 간 우열을 지어내서
        # "가장 높은 등급"을 고르지 않는다 — 클럽이 정해준 서열이 없다.
        classified = [store.classify_rate_plan(p) for p in sorted(plans)]
        member_plans = [r for r in reversed(player_rows)
                        if store.classify_rate_plan((r.get("Player Type") or "")).get("tier")]
        latest = (store.classify_rate_plan(member_plans[0].get("Player Type"))
                  if member_plans else store.classify_rate_plan(
                      player_rows[-1].get("Player Type")))

        def cancelled(row):
            return (row.get("Is Round Cancelled") or "").strip().casefold() == "yes"

        arrived = [r for r in player_rows
                   if (r.get("Round State") or "").strip() == "Arrived" and not cancelled(r)]

        reasons = []
        if phone_raw and not phone:
            reasons.append("phone did not normalize to 10 digits; stored verbatim")
        if not last:
            reasons.append("single-token name; surname unknown")
        if tags:
            reasons.append(f"internal tag stripped from source name: {','.join(tags)}")

        customers.append(dict(
            id=store.customer_key(SOURCE, source_id), source=SOURCE, sourceId=source_id,
            name=f"{first} {last}".strip(), firstName=first, lastName=last,
            nickname=nickname, sourceName=player_rows[-1]["Player Name"], sourceTags=tags,
            email=store.normalize_email(newest("Player Email")),
            phone=phone, phoneRaw=phone_raw, zip=store.normalize_zip(newest("Player ZIP Code")),
            role="Member" if is_member else "Public",
            rolesSeen=sorted(roles), isMember=is_member, memberNumber=None,
            ratePlansSeen=sorted(plans),
            memberTier=latest["tier"], memberCategory=latest["category"],
            cartPlan=latest["cartPlan"], publicSegment=latest["publicSegment"],
            memberTiersSeen=sorted({c["tier"] for c in classified if c["tier"]}),
            cartPlansSeen=sorted({c["cartPlan"] for c in classified if c["cartPlan"]}),
            firstSeen=player_rows[0]["Start Date"], lastSeen=player_rows[-1]["Start Date"],
            roundsBooked=len(player_rows),
            roundsArrived=len(arrived),
            roundsCancelled=sum(1 for r in player_rows if cancelled(r)),
            noShows=sum(1 for r in player_rows if (r.get("Round State") or "").strip() == "Noshow"),
            totalSpendCents=sum(cents(r.get("Green Fees")) + cents(r.get("Cart Fees"))
                                for r in arrived),
            currency=(player_rows[-1].get("Club Currency Code") or "CAD").strip(),
            needsReview=bool(reasons), reviewReasons=reasons, possibleDuplicateOf=[],
            createdAt=now, updatedAt=now,
            provenance=dict(
                source="Chronogolf dashboard tee-sheet CSV export", clubId=CLUB_ID,
                sourceFile=source_name, sourceRange=coverage, sourceRows=len(player_rows),
                identity="Round Player ID is the Chronogolf user id; Round ID is the per-round key",
                membership="Member Number empty in source; isMember derived from Player Role",
                tier="derived from the rate plan name (the only membership signal in the export); "
                     "memberTier is the most recent member plan seen — tiers are NOT ranked",
                money="integer cents; summed over Round State == Arrived AND not cancelled",
                limits="member rows carry 0.00 fees — dues are absent from this export, "
                       "so totalSpendCents is NOT a revenue figure for members")))

    _flag_possible_duplicates(customers)
    return sorted(customers, key=lambda c: c["id"])


def _flag_possible_duplicates(customers):
    """서로 다른 id 인데 같은 사람일 수 있는 쌍을 표시한다. **합치지는 않는다.**

    같은 전화/우편번호는 한 집안일 뿐 같은 사람이 아니다 (소스의 Hagar 부부).
    자동 병합은 부부를 한 사람으로 만든다. 그래서 사람이 볼 수 있게 표시만 한다.
    """
    by_name = defaultdict(list)
    by_contact = defaultdict(list)
    for row in customers:
        by_name[normalize_name_key(row["name"])].append(row)
        for value in (row["email"], row["phone"]):
            if value:
                by_contact[value].append(row)

    for group in by_name.values():
        if len(group) > 1:
            for row in group:
                row["possibleDuplicateOf"] = sorted(
                    {c["id"] for c in group} - {row["id"]} | set(row["possibleDuplicateOf"]))
                row["reviewReasons"].append("same display name under multiple source ids")

    for value, group in by_contact.items():
        if len(group) > 1:
            for row in group:
                row["reviewReasons"].append(
                    "shares a phone/email with another customer (household — do not merge)")

    for row in customers:
        row["reviewReasons"] = sorted(set(row["reviewReasons"]))
        row["needsReview"] = bool(row["reviewReasons"])


def run(source, apply=False):
    path = Path(source)
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError("Empty export")
    clubs = {(r.get("Club Name") or "").strip() for r in rows}
    if clubs != {"Pelham Hills Golf Club"}:
        raise ValueError(f"Unexpected club(s) in export: {sorted(clubs)}")

    incoming = build(rows, path.name)
    target = store.data_file()
    existing = store.load_customers() if target.exists() else []

    merged = [dict(c) for c in existing]
    for record in incoming:
        store.upsert_customer(merged, record)

    report = dict(
        mode="apply" if apply else "dry-run", sourceRows=len(rows),
        namedRows=sum(1 for r in rows if (r.get("Player Name") or "").strip()),
        sourceRange=incoming[0]["provenance"]["sourceRange"] if incoming else None,
        customersInSource=len(incoming),
        newCustomers=len({c["id"] for c in incoming} - {c["id"] for c in existing}),
        updatedCustomers=len({c["id"] for c in incoming} & {c["id"] for c in existing}),
        untouchedCustomers=len({c["id"] for c in existing} - {c["id"] for c in incoming}),
        members=sum(1 for c in incoming if c["isMember"]),
        byMemberTier={tier: sum(1 for c in incoming if c["memberTier"] == tier)
                      for tier in sorted({c["memberTier"] for c in incoming if c["memberTier"]})},
        byPublicSegment={seg: sum(1 for c in incoming if c["publicSegment"] == seg)
                         for seg in sorted({c["publicSegment"] for c in incoming
                                            if c["publicSegment"]})},
        byCartPlan={plan: sum(1 for c in incoming if c["cartPlan"] == plan)
                    for plan in sorted({c["cartPlan"] for c in incoming if c["cartPlan"]})},
        withEmail=sum(1 for c in incoming if c["email"]),
        withPhone=sum(1 for c in incoming if c["phone"]),
        needsReview=sum(1 for c in incoming if c["needsReview"]),
        totalSpendCents=sum(c["totalSpendCents"] for c in incoming),
        target=str(target), changed=merged != existing,
        sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest())

    if apply and merged != existing:
        if target.exists():
            backup = target.with_name(
                target.name + "." + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".bak")
            shutil.copy2(target, backup)
            report["backup"] = str(backup)
        store.save_customers(merged)
        if json.loads(target.read_text(encoding="utf-8")) != merged:
            raise RuntimeError("Readback verification failed")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.apply), indent=2))
