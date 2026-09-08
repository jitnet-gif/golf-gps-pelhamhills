"""Chronogolf 대시보드 티시트 CSV export 를 티 시트에 반영한다; --apply 전엔 dry-run.

적용 전에 로컬 API 를 내릴 것: `tee_sheet_store` 는 스토어를 프로세스에 캐시하고
파일을 감시하지 않는다. 서버가 떠 있으면 다음 저장 때 임포트를 덮어쓴다.

DOM 스냅샷 임포터(`import_chronogolf_snapshot.py`)보다 이 경로가 낫다. 진짜
`Reservation ID` 와 예약 시각, 도착/결제/취소 상태, 그린피·카트피가 다 들어 있어서
스냅샷이 합성해야 했던 id 와 시간이 여기서는 실제 값이다.

**소스가 말해주지 않는 것** (각 예약의 notes provenance 에 그대로 적는다):

- 9홀/18홀 구분이 export 에 없다. 요금으로도 유추할 수 없다 — 트와일라잇·주니어
  요금이 9홀 요금대와 겹친다. 전부 18홀로 두고 그 사실을 provenance 에 남긴다.
- 카트는 6/187 예약에서만 항목화되어 있다. `cartCount` 가 대부분 0인 건
  임포터 버그가 아니라 소스의 공백이다.
- `Member Number` 와 `Pace of Play` 는 전 행이 비어 있다.

**취소 행은 기본적으로 버린다.** 취향이 아니라 강제다: `TeeBooking.players` 가
최대 4명인데 취소 행을 남기면 5명짜리 예약이 생겨 Pydantic 검증에서 터지고,
`tee_time_players` 가 `player.cancelled` 를 거르지 않고 세기 때문에 그 슬롯의
남은 자리를 영구히 못 팔게 된다.
"""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.services import tee_sheet_store as store

CLUB_ID = 19671
IMPORT_MARKER = "Chronogolf dashboard CSV export"
ROW_CAP = 500  # export 한 번에 내려오는 행 상한. 이 수치면 잘렸다고 본다.

# 스토어/프론트가 받아들이는 유일한 시각 표기. "06:58 AM" 처럼 0이 붙으면
# merge 의 슬롯 비교가 어긋나 같은 날을 통째로 이중 등록한다 — 조용히 틀리는
# 유일한 경로라 방출 직전에 정규식으로 다시 막는다.
SLOT_TIME_RE = re.compile(r"^\d{1,2}:\d{2} (AM|PM)$")


def slot_label(raw):
    """`06:40AM` -> `6:40 AM`. 스냅샷 임포터와 같은 격자 규칙을 강제한다."""
    stamp = datetime.strptime(raw.strip(), "%I:%M%p")
    label = stamp.strftime("%I:%M %p").lstrip("0")
    if not SLOT_TIME_RE.match(label):
        raise ValueError(f"Bad slot label: {label!r}")
    minutes = stamp.hour * 60 + stamp.minute
    if not 400 <= minutes <= 1080 or (minutes - 400) % 9:
        raise ValueError(f"Invalid slot: {raw}")
    return label, minutes


def cancelled(row):
    return (row.get("Is Round Cancelled") or "").strip().casefold() == "yes"


def money(raw):
    value = (raw or "").strip()
    return float(value) if value else 0.0


def convert(rows, source_name, include_cancelled=False):
    """CSV 행들을 예약 레코드로. 순수 변환 — I/O 도 저장도 하지 않는다."""
    reservations = defaultdict(list)
    for row in rows:
        hole = (row.get("Start Hole") or "").strip()
        if hole not in ("", "1"):
            # 백나인/샷건 출발. 스토어에 출발 홀 필드가 없어서 앞나인으로 눕히면
            # 서로 다른 두 팀이 같은 칸에 겹친다. 눕히느니 멈춘다.
            raise ValueError(f"Start Hole {hole} is not supported; store has no start-hole field")
        reservations[(row.get("Reservation ID") or "").strip()].append(row)

    output = []
    for reservation_id, group in sorted(reservations.items()):
        group.sort(key=lambda r: r.get("Round ID", ""))
        active = [r for r in group if not cancelled(r)]
        if not active and not include_cancelled:
            continue
        seats = active or group
        if len(seats) > 4:
            raise ValueError(f"Reservation {reservation_id} has {len(seats)} active seats")

        head = seats[0]
        date = head["Start Date"].strip()
        datetime.strptime(date, "%Y-%m-%d")
        label, _ = slot_label(head["Start Time"])
        booking_id = f"chronogolf-csv-{CLUB_ID}-{reservation_id}"

        players = []
        for row in seats:
            display = (row.get("Player Name") or "").strip()
            first, last = store.split_name(display) if display else ("Guest", "")
            state = (row.get("Round State") or "").strip()
            players.append(dict(
                # Round ID 가 행마다 고유하다. Round Player ID 는 사람 id 라
                # 같은 사람이 두 자리에 앉으면 겹친다 — 플레이어 키로 쓰면 안 된다.
                id=f"{booking_id}-r{(row.get('Round ID') or '').strip()}",
                name=f"{first} {last}".strip(), firstName=first, lastName=last,
                email="", phone="",
                type="Existing Customer" if display else "Guest",
                ratePlan=(row.get("Player Type") or "").strip(),
                paid=(row.get("Paid State") or "").strip() == "Paid",
                arrived=state == "Arrived", no_show=state == "Noshow",
                cancelled=cancelled(row)))

        # 요금은 예약 안 살아있는 플레이어들의 그린피 최댓값. 슬롯 단위 최댓값은
        # 같은 티타임을 나눠 쓴 남의 퍼블릭 요금을 회원 팀에 물리게 된다.
        rate = max((money(r.get("Green Fees")) for r in seats), default=0.0)
        riders = sum(1 for r in seats if money(r.get("Cart Fees")) > 0)
        cart_count = max(0, min(4, math.ceil(riders / 2)))

        named = next((p for p in players if p["type"] == "Existing Customer"), None)
        title = f"{named['lastName']}, {named['firstName']}".strip(", ") if named else "Guest"

        states = {(r.get("Round State") or "").strip() for r in seats}
        paid_all = all((r.get("Paid State") or "").strip() == "Paid" for r in seats)
        if not active:
            status = "cancelled"
        elif states == {"Noshow"}:
            status = "no_show"
        elif "Arrived" in states and paid_all:
            status = "paid"
        elif "Arrived" in states:
            status = "checked_in"
        else:
            status = "reserved"

        stamp = (head.get("Reservation date") or date).strip()
        created = datetime.fromisoformat(f"{stamp}T00:00:00+00:00").isoformat()
        note = (head.get("Reservation Note (player)") or "").strip()
        provenance = dict(
            source=IMPORT_MARKER, clubId=CLUB_ID, sourceFile=source_name,
            reservationId=reservation_id,
            bookingReference=(head.get("Booking Reference") or "").strip(),
            reservationDate=stamp, reservedBy=(head.get("Reserved By") or "").strip(),
            reservationType=(head.get("Reservation Type") or "").strip(),
            reservationSource=(head.get("Reservation Source") or "").strip(),
            reservationMedium=(head.get("Reservation Medium") or "").strip(),
            currency=(head.get("Club Currency Code") or "CAD").strip(), startHole=1,
            holesSource="not present in export; defaulted to 18",
            cartCount="derived from per-player Cart Fees; source itemizes carts on few reservations",
            rateSource="max green fee across the reservation's active players",
            droppedCancelledRounds=[
                dict(roundId=(r.get("Round ID") or "").strip(),
                     name=(r.get("Player Name") or "").strip(),
                     cancelledAt=(r.get("Round Cancelled At") or "").strip(),
                     cancelledBy=(r.get("Cancelled By") or "").strip())
                for r in group if cancelled(r) and active],
            playerFees=[dict(roundId=(r.get("Round ID") or "").strip(),
                             name=(r.get("Player Name") or "").strip(),
                             greenFee=money(r.get("Green Fees")), cartFee=money(r.get("Cart Fees")),
                             playerType=(r.get("Player Type") or "").strip(),
                             roundState=(r.get("Round State") or "").strip(),
                             paidState=(r.get("Paid State") or "").strip()) for r in seats])

        cancel_reason = None
        if not active:
            cancel_reason = (f"Cancelled {(head.get('Round Cancelled At') or '').strip()} "
                             f"by {(head.get('Cancelled By') or '').strip() or 'player'}.").strip()

        output.append(dict(
            id=booking_id, date=date, time=label, holes=18, rate=rate, span=1,
            color="blue" if (head.get("Reservation Type") or "").strip() == "Online" else "gold",
            title=title, status=status, cartCount=cart_count,
            notes=(note + "\n" if note else "") + "Import provenance: "
                  + json.dumps(provenance, ensure_ascii=False),
            players=players,
            audit=[dict(id=f"{booking_id}-import", ts=created,
                        message=f"Imported from {IMPORT_MARKER} (reservation {reservation_id}).")],
            cancelReason=cancel_reason, createdAt=created, updatedAt=created))
    return output


def covered_dates(rows, incoming, include_truncated=False):
    """임포트가 책임지는 날짜 집합. **min..max 범위로 유추하면 안 된다.**

    export 는 연속 구간이 아니다 — 4월 창에서 27일 중 14일만 들어 있다. 범위로
    잡으면 소스에 없는 날의 예약을 전부 지운다. 그리고 행 수가 상한과 같으면
    마지막 날은 하루 중간에 잘린 것이므로 기본적으로 책임 범위에서 뺀다. 안 그러면
    그날 오후를 오전만 있는 시트로 덮어써서 지운다.

    `include_truncated` 는 그 마지막 날도 넣는다. 스토어에 그날 예약이 **하나도
    없을 때만** 안전하다 (덮어쓸 오후가 애초에 없으므로 순수 추가). 호출자가
    그 조건을 확인한다.
    """
    dates = {b["date"] for b in incoming}
    truncated = max(dates) if (len(rows) == ROW_CAP and dates) else None
    dropped = truncated if (truncated and not include_truncated) else None
    return (dates - {dropped}) if dropped else dates, truncated, dropped


def merge(existing, incoming, dates):
    """책임 범위 안의 날짜를 통째로 교체한다. 사람이 만든 예약이 있으면 멈춘다.

    스냅샷 임포터의 merge 를 재사용하지 않는 이유: 그쪽은 한 슬롯에 예약이 하나라고
    가정하고 성으로 짝을 맞춘다. 이 CSV 에는 한 슬롯에 예약이 최대 4건까지 있어서
    그 가정이 성립하지 않는다.
    """
    kept, replaced = [], 0
    for old in existing:
        if old["date"] not in dates:
            kept.append(old)
            continue
        superseded = (old["id"].startswith("chronogolf-")
                      or IMPORT_MARKER in old.get("notes", "")
                      or (old["id"].startswith("b-") and any(
                          "Imported from the Chronogolf tee sheet" in entry.get("message", "")
                          for entry in old.get("audit", []))))
        if not superseded:
            raise ValueError(f"Locally created booking {old['id']} on {old['date']} "
                             f"would be destroyed; resolve it manually first")
        replaced += 1
    return kept + [b for b in incoming if b["date"] in dates], replaced


def run(source, apply=False, include_cancelled=False, include_truncated=False):
    path = Path(source)
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError("Empty export")
    clubs = {(r.get("Club Name") or "").strip() for r in rows}
    if clubs != {"Pelham Hills Golf Club"}:
        raise ValueError(f"Unexpected club(s) in export: {sorted(clubs)}")

    converted = convert(rows, path.name, include_cancelled)
    dates, truncated, dropped = covered_dates(rows, converted, include_truncated)
    incoming = [b for b in converted if b["date"] in dates]

    target = store.data_file()
    existing = json.loads(target.read_text(encoding="utf-8-sig")) if target.exists() else []

    if truncated and not dropped:
        # 잘린 날을 넣기로 했다. 그날 예약이 이미 있으면 오전만 있는 시트로
        # 오후를 덮어써 지우게 된다. 순수 추가일 때만 허용한다.
        clash = [b["id"] for b in existing if b["date"] == truncated]
        if clash:
            raise ValueError(
                f"{truncated} is truncated mid-day by the {ROW_CAP}-row cap and the store "
                f"already holds {len(clash)} booking(s) on it; importing would erase that "
                f"day's afternoon. Re-export {truncated} on its own instead.")

    merged, replaced = merge(existing, incoming, dates)

    report = dict(
        mode="apply" if apply else "dry-run", sourceRows=len(rows),
        coveredDates=len(dates), firstDate=min(dates) if dates else None,
        lastDate=max(dates) if dates else None,
        truncated=bool(truncated), truncatedDate=truncated, droppedDate=dropped,
        importedBookings=len(incoming),
        cancelledBookings=sum(1 for b in incoming if b["status"] == "cancelled"),
        importedPlayers=sum(len(b["players"]) for b in incoming),
        cancelledReservationsSkipped=len(
            {(r.get("Reservation ID") or "").strip() for r in rows}) - len(converted),
        bookingsWithCart=sum(1 for b in incoming if b["cartCount"]),
        replacedBookings=replaced, preservedBookings=len(merged) - len(incoming),
        target=str(target), changed=merged != existing,
        sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest())
    if dropped:
        report["warning"] = (f"Source hit the {ROW_CAP}-row cap; {dropped} is truncated "
                             f"mid-day and was left untouched. Re-export it on its own.")
    elif truncated:
        report["warning"] = (f"Source hit the {ROW_CAP}-row cap; {truncated} was imported "
                             f"anyway (--include-truncated-date) and holds that day's morning "
                             f"only. Re-export it on its own to complete the day.")

    if apply and merged != existing:
        if target.exists():
            backup = target.with_name(
                target.name + "." + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".bak")
            shutil.copy2(target, backup)
            report["backup"] = str(backup)
        store.save_bookings(merged)
        if json.loads(target.read_text(encoding="utf-8")) != merged:
            raise RuntimeError("Readback verification failed")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--include-cancelled", action="store_true",
                        help="import fully cancelled reservations as cancelled bookings")
    parser.add_argument("--include-truncated-date", action="store_true",
                        help="also import the last day even though the row cap cut it mid-day "
                             "(refused if the store already holds bookings on that day)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.apply, args.include_cancelled,
                         args.include_truncated_date), indent=2))
