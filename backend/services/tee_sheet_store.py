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
from datetime import datetime, timezone
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


def _player(name: str, rate_plan: str, existing: bool = True) -> dict[str, Any]:
    first, _, last = name.partition(" ")
    first, last = first.strip(), last.strip()
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
) -> dict[str, Any]:
    return {
        "id": booking_id,
        "date": date,
        "time": time,
        "holes": 18,
        "rate": rate,
        "span": 1,
        "color": color,
        "title": title,
        "status": "reserved",
        "cartCount": cart_count,
        "notes": "",
        "players": players,
        "audit": [{"id": str(uuid4()), "ts": _NOW_ISO, "message": audit_message}],
        "cancelReason": None,
        "createdAt": _NOW_ISO,
        "updatedAt": _NOW_ISO,
    }


_WEEKDAY_CART = "Weekday Member - Single with Weekday Cart"
_WEEKDAY_SINGLE = "Weekday Member - Single"
_FULL_7DAY = "Full Member - Single with 7 Day Cart"

_SEP10 = "Imported from Chronogolf tee sheet for September 10, 2026."
_SEP11 = "Imported from visible Chronogolf tee sheet for September 11, 2026."


def seed_bookings() -> list[dict[str, Any]]:
    """최초 1회 파일에 심는 예약 목록 (Chronogolf 실측 데이터)."""
    return [
        _booking(
            "b-predote", "2026-09-10", "6:58 AM", "gold", "Predote, Marie", 47.79, 2,
            [
                _player("Marie Predote", _WEEKDAY_CART),
                _player("Betty Lou DiMattio", _WEEKDAY_CART),
                _player("Roseann Norton", _WEEKDAY_CART),
                _player("Steve Murphy", _FULL_7DAY),
            ],
            _SEP10,
        ),
        _booking(
            "b-wheeland", "2026-09-10", "7:07 AM", "blue", "Wheeland, Bryan", 47.79, 0,
            [
                _player("Bryan Wheeland", _WEEKDAY_SINGLE),
                _player("Alf Wheeland", _WEEKDAY_CART),
                _player("Colin Scott", _WEEKDAY_SINGLE),
                _player("David Neville", _WEEKDAY_CART),
            ],
            _SEP10,
        ),
        _booking(
            "b-marshall", "2026-09-10", "7:16 AM", "gold", "Marshall, Dan", 47.79, 1,
            [
                _player("Dan Marshall", _WEEKDAY_SINGLE),
                _player("Leslie Reid", _WEEKDAY_SINGLE),
                _player("Joe Grdovich", _WEEKDAY_SINGLE),
                _player("Peter Catti", _WEEKDAY_SINGLE),
            ],
            _SEP10,
        ),
        _booking(
            "b-nicalou", "2026-09-10", "7:25 AM", "blue", "Nicalou, Chris", 47.79, 1,
            [
                _player("Chris Nicalou", _FULL_7DAY),
                _player("Triada Nicolou", _FULL_7DAY),
            ],
            _SEP10,
        ),
        _booking(
            "b-carlsson", "2026-09-10", "8:01 AM", "gold", "Carlsson, James", 47.79, 0,
            [
                _player("James Carlsson", "GolfNow"),
                _guest("GolfNow"),
                _guest("GolfNow"),
            ],
            _SEP10,
        ),
        _booking(
            "b-costea", "2026-09-10", "8:10 AM", "blue", "Costea, Rick", 47.79, 2,
            [
                _player("Rick Costea", _WEEKDAY_SINGLE),
                _player("Rudy Videchak", _WEEKDAY_SINGLE),
                _player("Roger Denis", _WEEKDAY_SINGLE),
            ],
            _SEP10,
        ),
        _booking(
            "b-sep11-predote", "2026-09-11", "6:58 AM", "gold", "Predote, Marie", 58.41, 2,
            [
                _player("Marie Predote", _WEEKDAY_CART),
                _player("Roseann Norton", _WEEKDAY_CART),
                _player("Betty Lou DiMattio", _WEEKDAY_CART),
                _player("Steve Murphy", _FULL_7DAY),
            ],
            _SEP11,
        ),
        _booking(
            "b-sep11-marshall", "2026-09-11", "7:07 AM", "blue", "Marshall, Dan", 58.41, 1,
            [
                _player("Dan Marshall", _WEEKDAY_SINGLE),
                _player("Colin Scott", _WEEKDAY_SINGLE),
                _player("David Neville", _WEEKDAY_CART),
                _guest("Public"),
            ],
            _SEP11,
        ),
        _booking(
            "b-sep11-nicalou", "2026-09-11", "7:16 AM", "gold", "Nicalou, Chris", 58.41, 1,
            [
                _player("Chris Nicalou", _FULL_7DAY),
                _player("Triada Nicolou", _FULL_7DAY),
            ],
            _SEP11,
        ),
        _booking(
            "b-sep11-kicul", "2026-09-11", "7:25 AM", "blue", "Kicul, Marty", 58.41, 0,
            [
                _player("Marty Kicul", _WEEKDAY_SINGLE),
                _player("Wayne Armstrong", _WEEKDAY_SINGLE),
                _player("David Kaufmann", _WEEKDAY_SINGLE),
            ],
            _SEP11,
        ),
        _booking(
            "b-sep11-buckley", "2026-09-11", "7:34 AM", "gold", "buckley, jami", 58.41, 2,
            [
                _player("Jami Buckley", "Public"),
                _guest("Public"),
                _guest("Public"),
                _guest("Public"),
            ],
            _SEP11,
        ),
        _booking(
            "b-sep11-unrau", "2026-09-11", "7:43 AM", "blue", "Unrau, Ruth", 58.41, 1,
            [
                _player("Ruth Unrau", "Public Senior"),
                _guest("Public Senior"),
            ],
            _SEP11,
        ),
        _booking(
            "b-sep11-costea", "2026-09-11", "8:10 AM", "gold", "Costea, Rick", 58.41, 2,
            [
                _player("Rick Costea", _WEEKDAY_SINGLE),
                _player("Rudy Videchak", _WEEKDAY_SINGLE),
                _player("Roger Denis", _WEEKDAY_SINGLE),
            ],
            _SEP11,
        ),
    ]


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
