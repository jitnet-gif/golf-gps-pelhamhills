"""티 시트 예약 영속 저장소.

`backend/api/routes/tee_sheet.py` 가 쓰는 유일한 저장 계층이다.
JSON 파일 하나에 예약 목록을 통째로 보관한다 (레코드 수가 수백 단위라 충분하다).

설계 메모
- 데이터 파일 경로는 **호출 시점**에 `TEE_SHEET_DATA_FILE` 환경변수를 읽어 결정한다.
  모듈 임포트 시점에 굳혀 두면 테스트에서 monkeypatch 해도 먹지 않는다.
- 인메모리 캐시는 "해석된 경로"를 키로 잡는다. 경로가 바뀌면 캐시를 버린다.
- 모든 변경은 `threading.RLock` 으로 감싼다. FastAPI 의 sync 엔드포인트는
  스레드풀에서 돌기 때문에 동시 진입이 실제로 가능하다.
- 쓰기는 같은 디렉터리에 임시 파일을 만든 뒤 `os.replace` 로 원자 교체한다.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

__all__ = [
    "ENV_VAR",
    "data_file",
    "load_bookings",
    "save_bookings",
    "mutate",
    "reset",
    "seed_bookings",
    "split_name",
]

ENV_VAR = "TEE_SHEET_DATA_FILE"

# backend/services/tee_sheet_store.py -> backend/data/tee_sheet.json
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_DATA_FILE = _BACKEND_DIR / "data" / "tee_sheet.json"

_lock = threading.RLock()
_cache: list[dict[str, Any]] | None = None
_cache_path: Path | None = None


def data_file() -> Path:
    """현재 유효한 데이터 파일 경로. 환경변수를 매번 다시 읽는다."""
    override = os.environ.get(ENV_VAR)
    if override:
        return Path(override).expanduser().resolve()
    return _DEFAULT_DATA_FILE


# ===== 시드 데이터 =====================================================

_NOW_ISO = "2026-09-01T12:00:00+00:00"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def split_name(name: str) -> tuple[str, str]:
    """전체 이름을 (firstName, lastName) 으로 쪼갠다. **성은 마지막 토큰**이다.

    이름은 토큰이 두 개라는 보장이 없다. 마지막 공백을 기준으로 자른다.

        "Marie Predote"      -> ("Marie", "Predote")
        "Betty Lou DiMattio" -> ("Betty Lou", "DiMattio")   # 성은 "DiMattio"
        "Guest"              -> ("Guest", "")               # ("", "Guest") 가 아니다

    프론트는 셀을 `${lastName}, ${firstName}` 로 그린다. 여기서 틀리면
    시트에 "Lou DiMattio, Betty" 처럼 잘못된 성이 찍힌다.

    `backend/api/routes/tee_sheet.py` 의 `_split_name` 이 이 함수를 그대로 쓴다.
    시드와 API 가 서로 다르게 쪼개면 안 되므로 구현은 여기 하나뿐이다.
    """
    head, sep, tail = name.strip().rpartition(" ")
    if not sep:
        # 토큰이 하나뿐. rpartition 은 ("", "", "Guest") 를 돌려주므로
        # 그대로 쓰면 성/이름이 뒤집힌다.
        return name.strip(), ""
    return head.strip(), tail.strip()


def _player(name: str, rate_plan: str, existing: bool = True) -> dict[str, Any]:
    first, last = split_name(name)
    return {
        "id": str(uuid4()),
        "name": f"{first} {last}".strip(),
        "firstName": first,
        "lastName": last,
        "email": "",
        "phone": "",
        "type": "Existing Customer" if existing else "Guest",
        "ratePlan": rate_plan,
        "arrived": False,
        "paid": False,
        "cancelled": False,
        "no_show": False,
    }


def _guest(rate_plan: str) -> dict[str, Any]:
    return _player("Guest", rate_plan, existing=False)


def _booking(
    booking_id: str,
    date: str,
    time: str,
    color: str,
    title: str,
    rate: float,
    cart_count: int,
    players: list[dict[str, Any]],
    audit_message: str,
    holes: int = 18,
    notes: str = "",
) -> dict[str, Any]:
    return {
        "id": booking_id,
        "date": date,
        "time": time,
        "holes": holes,
        "rate": rate,
        "span": 1,
        "color": color,
        "title": title,
        "status": "reserved",
        "cartCount": cart_count,
        "notes": notes,
        "players": players,
        "audit": [{"id": str(uuid4()), "ts": _NOW_ISO, "message": audit_message}],
        "cancelReason": None,
        "createdAt": _NOW_ISO,
        "updatedAt": _NOW_ISO,
    }


_WEEKDAY_CART = "Weekday Member - Single with Weekday Cart"
_WEEKDAY_SINGLE = "Weekday Member - Single"
_FULL_7DAY = "Full Member - Single with 7 Day Cart"
_GOLFNOW = "GolfNow"

_SEP08 = "Imported from the Chronogolf tee sheet for September 8, 2026."

_SEED_DATE = "2026-09-08"          # 화요일
_SEED_RATE = 47.79                 # 평일 요금
_GOLFNOW_NOTE = "Booked through GolfNow — confirm payment at check-in."


def _stamp_booking_order(bookings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """예약 목록에 "만들어진 순서"를 1분 간격 createdAt 으로 찍는다.

    티 시트 격자는 한 티 타임 안에서 예약을 createdAt 순으로 왼쪽부터 앉힌다
    (`bySeatOrder`). 시드가 모든 예약에 같은 타임스탬프를 쓰면 그 정렬 키가 무의미해져
    id 알파벳순이라는 엉뚱한 기준이 자리를 정한다 — 실제로 7:43 AM 에서 b-carlsson 이
    b-unrau 앞에 앉아, 클론 대상 스크린샷과 좌우가 뒤집혔다.

    그래서 시드 리스트의 순서 = 예약이 들어온 순서로 보고 그대로 타임스탬프에 새긴다.
    """
    for index, booking in enumerate(bookings):
        stamped = _iso_at_offset(index)
        booking["createdAt"] = stamped
        booking["updatedAt"] = stamped
        for entry in booking["audit"]:
            entry["ts"] = stamped
    return bookings


def _iso_at_offset(minutes: int) -> str:
    """_NOW_ISO 로부터 `minutes` 분 뒤의 ISO 타임스탬프."""
    base = datetime.fromisoformat(_NOW_ISO)
    return (base + timedelta(minutes=minutes)).isoformat()


def seed_bookings() -> list[dict[str, Any]]:
    """최초 1회 파일에 심는 예약 목록.

    클론 대상 Chronogolf 스크린샷 그대로: 2026-09-08 (화) 하루치.
    7:43 AM 과 7:52 AM 은 예약이 **두 건씩** 있고 합계가 정확히 4명이다.
    (회원 예약 + GolfNow 온라인 예약이 같은 티 타임을 나눠 갖는 실제 케이스)
    """
    return _stamp_booking_order(
[
        _booking(
            "b-predote", _SEED_DATE, "6:58 AM", "gold", "Predote, Marie", _SEED_RATE, 2,
            [
                _player("Marie Predote", _WEEKDAY_CART),
                _player("Betty Lou DiMattio", _WEEKDAY_CART),
                _player("Roseann Norton", _WEEKDAY_CART),
                _player("Steve Murphy", _FULL_7DAY),
            ],
            _SEP08,
        ),
        _booking(
            "b-wheeland", _SEED_DATE, "7:07 AM", "gold", "Wheeland, Alf", _SEED_RATE, 0,
            [
                _player("Alf Wheeland", _WEEKDAY_CART),
                _player("Colin Scott", _WEEKDAY_SINGLE),
                _player("David Neville", _WEEKDAY_CART),
            ],
            _SEP08,
        ),
        _booking(
            "b-marshall", _SEED_DATE, "7:16 AM", "gold", "Marshall, Dan", _SEED_RATE, 0,
            [
                _player("Dan Marshall", _WEEKDAY_SINGLE),
                _player("Peter Catti", _WEEKDAY_SINGLE),
                _player("Joe Grdovich", _WEEKDAY_SINGLE),
                _player("Leslie Reid", _WEEKDAY_SINGLE),
            ],
            _SEP08,
        ),
        _booking(
            "b-nicalou", _SEED_DATE, "7:25 AM", "gold", "Nicalou, Chris", _SEED_RATE, 1,
            [
                _player("Chris Nicalou", _FULL_7DAY),
                _player("Triada Nicolou", _FULL_7DAY),
            ],
            _SEP08,
        ),
        _booking(
            "b-kicul", _SEED_DATE, "7:34 AM", "gold", "Kicul, Marty", _SEED_RATE, 0,
            [
                _player("Marty Kicul", _WEEKDAY_SINGLE),
                _player("David Kaufmann", _WEEKDAY_SINGLE),
                _player("Wayne Armstrong", _WEEKDAY_SINGLE),
                _guest(_WEEKDAY_SINGLE),
            ],
            _SEP08,
        ),
        # --- 7:43 AM: 회원 9홀 2인 + GolfNow 2인 = 4자리 ---
        _booking(
            "b-unrau", _SEED_DATE, "7:43 AM", "gold", "Unrau, Ruth", _SEED_RATE, 0,
            [
                _player("Ruth Unrau", "Public Senior"),
                _guest("Public Senior"),
            ],
            _SEP08,
            holes=9,
        ),
        _booking(
            "b-carlsson", _SEED_DATE, "7:43 AM", "blue", "Carlsson, James", _SEED_RATE, 0,
            [
                _player("James Carlsson", _GOLFNOW),
                _guest(_GOLFNOW),
            ],
            _SEP08,
            notes=_GOLFNOW_NOTE,
        ),
        # --- 7:52 AM: 회원 3인 + GolfNow 1인 = 4자리 ---
        _booking(
            "b-costea", _SEED_DATE, "7:52 AM", "gold", "Costea, Rick", _SEED_RATE, 2,
            [
                _player("Rick Costea", _WEEKDAY_SINGLE),
                _player("Rudy Videchak", _WEEKDAY_SINGLE),
                _player("Roger Denis", _WEEKDAY_SINGLE),
            ],
            _SEP08,
        ),
        _booking(
            "b-pattemore", _SEED_DATE, "7:52 AM", "blue", "Pattemore, Gregory", _SEED_RATE, 0,
            [
                _player("Gregory Pattemore", _GOLFNOW),
            ],
            _SEP08,
            notes=_GOLFNOW_NOTE,
        ),
        _booking(
            "b-hollingworth", _SEED_DATE, "8:01 AM", "gold", "hollingworth, Norm", _SEED_RATE, 0,
            [
                _player("Norm hollingworth", "Public"),
                _guest("Public"),
                _guest("Public"),
                _guest("Public"),
            ],
            _SEP08,
            holes=9,
        ),
        _booking(
            "b-allison", _SEED_DATE, "8:10 AM", "gold", "Allison, Glenn", _SEED_RATE, 0,
            [
                _player("Glenn Allison", _WEEKDAY_CART),
                _player("Wanda Allison", _WEEKDAY_CART),
                _player("Paul McLean", _WEEKDAY_SINGLE),
            ],
            _SEP08,
        ),
        ]
    )


# ===== 파일 I/O ========================================================


def _write_atomic(path: Path, payload: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _read_file(path: Path) -> list[dict[str, Any]] | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, OSError):
        # 손상된 파일은 시드로 되돌린다. 조용히 404 를 뿜는 것보다 낫다.
        return None
    if not isinstance(raw, list):
        return None
    return [item for item in raw if isinstance(item, dict)]


def _ensure_loaded() -> list[dict[str, Any]]:
    """캐시를 현재 경로에 맞게 채운다. 호출자는 반드시 _lock 을 잡고 있어야 한다."""
    global _cache, _cache_path

    path = data_file()
    if _cache is not None and _cache_path == path:
        return _cache

    data = _read_file(path)
    if data is None:
        data = seed_bookings()
        _write_atomic(path, data)

    _cache = data
    _cache_path = path
    return _cache


# ===== 공개 API ========================================================


def load_bookings() -> list[dict[str, Any]]:
    """예약 목록의 깊은 복사본을 돌려준다 (호출자가 캐시를 오염시키지 못하게)."""
    with _lock:
        return deepcopy(_ensure_loaded())


def save_bookings(bookings: list[dict[str, Any]]) -> None:
    """목록 전체를 원자적으로 덮어쓰고 캐시를 갱신한다."""
    global _cache, _cache_path
    with _lock:
        path = data_file()
        payload = deepcopy(list(bookings))
        _write_atomic(path, payload)
        _cache = payload
        _cache_path = path


@contextmanager
def mutate() -> Iterator[list[dict[str, Any]]]:
    """읽기-수정-쓰기를 락으로 감싼 컨텍스트 매니저.

        with mutate() as bookings:
            bookings.append(...)

    블록이 예외 없이 끝나면 저장한다. 예외가 나면 디스크는 그대로 둔다.
    주의: 이 블록 안에서 `await` 하지 말 것 (락을 잡은 채로 양보하게 된다).
    """
    with _lock:
        working = deepcopy(_ensure_loaded())
        yield working
        save_bookings(working)


def reset(*, seed: bool = True) -> list[dict[str, Any]]:
    """캐시와 파일을 초기화한다. 테스트/재시드 용."""
    global _cache, _cache_path
    with _lock:
        _cache = None
        _cache_path = None
        data = seed_bookings() if seed else []
        save_bookings(data)
        return deepcopy(data)
