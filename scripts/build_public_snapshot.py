"""배포용 **비식별화** 티 시트 스냅샷을 만든다 -> frontend/public/data/teesheet-public.json

배포 사이트는 Next 정적 export 라 미들웨어도 라우트 핸들러도 없다. 즉 `/teesheet`
같은 경로에 **인증을 걸 수 없다** — URL 만 알면 누구나 열린다. 그래서 이 파일에
들어가는 것은 "공개해도 되는 것"뿐이다.

내보내는 것 : 티타임, 요금, 홀 수, 카트 수, 좌석 점유/잔여, 예약 상태, 등급별 집계
빼는 것     : 이름, 이메일, 전화, 우편번호, 회원 개인 식별자, provenance 원문

**빼는 쪽이 기본이다.** 예약 레코드의 `notes` 에는 임포트 provenance JSON 이 들어
있고 그 안에 `playerFees[].name` 과 `droppedCancelledRounds[].name` 으로 실명이
박혀 있다. 통째로 버린다. `cancelReason` 에도 취소한 직원 이름이 들어가므로
일반 문구로 바꾼다. 필드를 하나씩 지우지 않고 **허용 목록으로 새 레코드를 짓는**
이유가 이것이다 — 나중에 스토어에 필드가 추가돼도 자동으로 새 나가지 않는다.

요금제 이름(`Weekday Member - Single` 등)은 남긴다. 사람이 아니라 가격 카테고리다.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.services import customer_store, tee_sheet_store

DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "frontend/public/data/teesheet-public.json"

# 공개 레코드에 실릴 필드. 이 목록에 없는 것은 나가지 않는다.
PUBLIC_BOOKING_FIELDS = ("id", "date", "time", "holes", "rate", "span", "color",
                         "status", "cartCount")


def anonymize(booking, index):
    """예약 하나를 공개 가능한 형태로 다시 짓는다. 원본에서 복사하지 않는다."""
    public = {field: booking.get(field) for field in PUBLIC_BOOKING_FIELDS}
    public["id"] = f"public-{index}"
    players = booking.get("players", [])
    public["title"] = "Booked" if players else "Available"
    public["players"] = [
        dict(id=f"public-{index}-p{seat}", name=f"Golfer {seat + 1}",
             firstName="Golfer", lastName=str(seat + 1), email="", phone="",
             # 요금제는 가격 카테고리라 남긴다. 손님/기존고객 구분도 개인 식별이 아니다.
             type=player.get("type", "Guest"), ratePlan=player.get("ratePlan", ""),
             paid=bool(player.get("paid")), arrived=bool(player.get("arrived")),
             cancelled=bool(player.get("cancelled")), no_show=bool(player.get("no_show")))
        for seat, player in enumerate(players)]
    # notes 에는 provenance JSON 이 통째로 들어 있고 그 안에 실명이 있다. 버린다.
    public["notes"] = ""
    # 취소 사유에는 취소한 직원 이름이 들어간다. 일반 문구로 바꾼다.
    public["cancelReason"] = "Cancelled." if booking.get("status") == "cancelled" else None
    public["audit"] = []
    public["source"] = "staff"
    public["holdExpiresAt"] = None
    public["createdAt"] = f"{booking.get('date')}T00:00:00+00:00"
    public["updatedAt"] = public["createdAt"]
    return public


def summarize(bookings, customers):
    """공개해도 되는 집계만. 개인 단위 값은 하나도 넣지 않는다."""
    active = [b for b in bookings if b.get("status") != "cancelled"]
    return dict(
        dates=sorted({b["date"] for b in bookings}),
        bookings=len(bookings), activeBookings=len(active),
        seatsBooked=sum(len(b.get("players", [])) for b in active),
        cartsBooked=sum(b.get("cartCount", 0) for b in active),
        byStatus=dict(sorted(Counter(b.get("status") for b in bookings).items())),
        byMemberTier=dict(sorted(Counter(
            c["memberTier"] for c in customers if c.get("memberTier")).items())),
        byPublicSegment=dict(sorted(Counter(
            c["publicSegment"] for c in customers if c.get("publicSegment")).items())),
        # 인원 **수**만. 명단은 어떤 형태로도 내보내지 않는다.
        customers=len(customers), members=sum(1 for c in customers if c.get("isMember")))


def assert_clean(payload, customers, bookings):
    """실명이 한 글자도 안 새는지 직렬화된 결과에서 직접 확인한다.

    허용 목록으로 지었더라도 마지막에 한 번 더 본다 — 이 파일은 공개 인터넷에
    나가고, 한 번 나가면 되돌릴 수 없다.
    """
    blob = json.dumps(payload, ensure_ascii=False).casefold()
    # 사람을 가리키지 않는 자리표시자. 소스에서도 이 값들은 익명 좌석을 뜻한다.
    placeholders = {"guest", "booked", "available"}

    def leaks(value):
        text = str(value or "").strip()
        return bool(text) and len(text) > 3 and text.casefold() not in placeholders \
            and not text.startswith("Golfer") and text.casefold() in blob

    leaked = []
    for source in (customers, bookings):
        for record in source:
            leaked += [str(v) for v in (record.get("name"), record.get("email"),
                                        record.get("phone"), record.get("zip"),
                                        record.get("phoneRaw"), record.get("title"))
                       if leaks(v)]
            leaked += [p["name"] for p in record.get("players", []) if leaks(p.get("name"))]
    if leaked:
        raise RuntimeError(f"Refusing to write: {len(set(leaked))} identifier(s) "
                           f"would leak, e.g. {sorted(set(leaked))[:3]}")


def build():
    bookings = tee_sheet_store.load_bookings()
    customers = customer_store.load_customers()
    public = [anonymize(b, i) for i, b in enumerate(
        sorted(bookings, key=lambda b: (b["date"], b.get("createdAt", ""))))]
    payload = dict(
        generatedAt=datetime.now(timezone.utc).isoformat(),
        notice=("De-identified snapshot for the public static site. Names, emails, phones "
                "and postal codes are removed; only schedule, pricing and aggregate counts "
                "are published."),
        summary=summarize(bookings, customers), bookings=public)
    assert_clean(payload, customers, bookings)
    return payload


def run(output=DEFAULT_OUTPUT, apply=False):
    payload = build()
    path = Path(output)
    existing = path.read_text(encoding="utf-8") if path.exists() else None
    # generatedAt 을 빼고 비교한다. 안 그러면 실행할 때마다 "변경됨"이 된다.
    def stable(text):
        try:
            data = json.loads(text)
        except (TypeError, json.JSONDecodeError):
            return None
        data.pop("generatedAt", None)
        return json.dumps(data, sort_keys=True, ensure_ascii=False)

    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    changed = stable(rendered) != stable(existing) if existing is not None else True

    report = dict(mode="apply" if apply else "dry-run", output=str(path),
                  publishedBookings=len(payload["bookings"]), changed=changed,
                  summary=payload["summary"])
    if apply and changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered, encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.output, args.apply), indent=2, ensure_ascii=False))
