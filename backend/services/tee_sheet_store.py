"""티 시트 예약 영속 저장소.

`backend/api/routes/tee_sheet.py` 와 스크립트들이 쓰는 저장 계층의 **입구**다.
저장 엔진은 `TEE_SHEET_BACKEND` 환경변수로 고른다.
- `json` (기본값): JSON 파일 하나에 예약 목록을 통째로 보관한다 (레코드 수가 수백 단위라 충분하다).
- `supabase`: `pelham_tee_bookings` 테이블. 실제 REST 호출은 `tee_sheet_supabase.py` 가 한다.
공개 API 는 둘 다 같다. 호출자는 어느 엔진인지 몰라도 된다.

설계 메모
- 엔진과 데이터 파일 경로 모두 **호출 시점**에 환경변수를 읽어 결정한다.
  모듈 임포트 시점에 굳혀 두면 테스트에서 monkeypatch 해도 먹지 않는다.
- 인메모리 캐시는 JSON 모드에만 있고 "해석된 경로"를 키로 잡는다. 경로가 바뀌면 캐시를 버린다.
  supabase 모드는 캐시하지 않는다 — 스크립트와 음성 웹훅 등 다른 프로세스도 같은 테이블에 쓴다.
- 모든 변경은 `threading.RLock` 으로 감싼다. FastAPI 의 sync 엔드포인트는
  스레드풀에서 돌기 때문에 동시 진입이 실제로 가능하다.
- JSON 쓰기는 같은 디렉터리에 임시 파일을 만든 뒤 `os.replace` 로 원자 교체한다.
- 읽기·쓰기는 `Scope` 로 **필요한 날짜/id 만** 다룬다. 과거 예약 8,400여 건(~20 MB)을
  들여오면 요청마다 테이블 전체를 읽는 방식은 쓸 수 없다. `scope=None` 은 예전 그대로
  전체를 다룬다 (스크립트와 기존 테스트가 기댄다).
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator
from uuid import uuid4

__all__ = [
    "ENV_VAR",
    "BACKEND_ENV_VAR",
    "Scope",
    "backend",
    "data_file",
    "load_bookings",
    "save_bookings",
    "mutate",
    "count_bookings",
    "drop_cache",
    "reset",
    "seed_bookings",
    "split_name",
]

ENV_VAR = "TEE_SHEET_DATA_FILE"
BACKEND_ENV_VAR = "TEE_SHEET_BACKEND"
_BACKENDS = ("json", "supabase")

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


def backend() -> str:
    """현재 저장 엔진 이름 (`json` | `supabase`). 환경변수를 매번 다시 읽는다.

    모르는 값은 조용히 json 으로 떨어뜨리지 않고 터뜨린다. 오타 하나로 운영 서버가
    로컬 JSON 파일에 예약을 쌓기 시작하면, 티 시트가 두 벌로 갈라진 걸 한참 뒤에야 안다.
    """
    name = os.environ.get(BACKEND_ENV_VAR, "").strip().lower() or "json"
    if name not in _BACKENDS:
        raise ValueError(
            f"{BACKEND_ENV_VAR}={name!r} is not supported; use one of {', '.join(_BACKENDS)}"
        )
    return name


def _sb():
    """supabase 저장 계층을 늦게 임포트한다.

    JSON 모드는 httpx 도, 그 모듈 파일도 없이 돌아야 한다. 그리고 저쪽이 이 모듈을
    임포트하지 않으므로 순환도 생기지 않는다.
    """
    from backend.services import tee_sheet_supabase

    return tee_sheet_supabase


# ===== 읽기 범위 =======================================================


def _frozen(values: Iterable[str], name: str) -> frozenset[str]:
    # 문자열 하나를 그대로 넘기면 frozenset("2026-09-12") 가 글자 집합이 되어
    # 아무 예약도 안 읽힌다 — 정원 검사가 빈 목록으로 "자리 있음" 을 낸다. 막는다.
    if isinstance(values, str):
        raise TypeError(f"Scope.{name} takes a collection of strings, not one string")
    return frozenset(str(value) for value in values)


@dataclass(frozen=True)
class Scope:
    """저장소에서 읽을 예약의 범위. 기준들은 **합집합(OR)** 이다.

    - `dates`: 개별 ISO 날짜들
    - `date_from` / `date_to`: 경계 포함 날짜 구간 하나. 한쪽을 비우면 그쪽은 열려 있다.
    - `ids`: 예약 id 들
    - `holds`: `holdExpiresAt` 이 있는 예약 전부 (날짜 무관)

    `covers_date` 는 `dates` 나 구간으로만 참이 된다. ids·holds 로 읽은 행은 그 날짜의
    **일부**일 뿐이라, 그걸로 날짜를 "다 읽었다" 고 치면 정원 검사가 모자란 목록을 센다.
    """

    dates: frozenset[str] = field(default_factory=frozenset)
    date_from: str | None = None
    date_to: str | None = None
    ids: frozenset[str] = field(default_factory=frozenset)
    holds: bool = False

    def __post_init__(self) -> None:
        # set·list 로 넘겨도 되게 한다. frozen 이라 object.__setattr__ 로 정규화한다.
        object.__setattr__(self, "dates", _frozen(self.dates, "dates"))
        object.__setattr__(self, "ids", _frozen(self.ids, "ids"))

    @property
    def has_range(self) -> bool:
        return self.date_from is not None or self.date_to is not None

    def covers_date(self, iso_date: str) -> bool:
        """이 날짜의 예약을 **전부** 읽었다고 보장하는가."""
        if iso_date in self.dates:
            return True
        if not self.has_range:
            return False
        # ISO 날짜는 문자열 비교가 곧 날짜 비교다 (Postgres 의 date 비교와 같은 결과).
        return (self.date_from is None or iso_date >= self.date_from) and (
            self.date_to is None or iso_date <= self.date_to
        )

    def matches(self, doc: dict[str, Any]) -> bool:
        day = doc.get("date")
        if isinstance(day, str) and self.covers_date(day):
            return True
        if self.ids and str(doc.get("id")) in self.ids:
            return True
        # `is not None` 이 아니라 참거짓으로 본다. to_row 가 "" 를 NULL 로 적으므로
        # supabase 의 `hold_expires_at=not.is.null` 과 같은 행을 고르려면 "" 도 빠져야 한다.
        return self.holds and bool(doc.get("holdExpiresAt"))


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


def _store_json(payload: list[dict[str, Any]]) -> None:
    """이미 이 모듈 소유인 목록을 원자적으로 쓰고 캐시로 삼는다. 호출자는 _lock 을 잡고 있어야 한다."""
    global _cache, _cache_path
    path = data_file()
    _write_atomic(path, payload)
    _cache = payload
    _cache_path = path


def _replace_subset(
    full: list[dict[str, Any]], loaded_ids: set[str], working: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """전체 목록 안에서 "읽었던 부분" 만 working 으로 갈아 끼운다 (JSON 모드의 apply_diff).

    - working 에 있는 id → 원래 자리에 새 값 (자리를 지켜야 같은 티 타임 안의 좌석 순서,
      즉 파일 순서가 흔들리지 않는다)
    - 읽었는데 working 에서 빠진 id → 삭제
    - 읽지 않은 행 → 그대로. 범위를 다시 계산하지 않는다: 9/12 로 읽고 9/13 으로 옮긴
      예약은 working 에 있으니 남는다.
    - working 에만 있는 새 id → 끝에 붙인다.
    working 의 id 가 범위 밖 기존 행과 겹치면 그 행을 덮어쓴다 — supabase upsert 와 같은
    기본키 의미다. 같은 id 두 줄은 절대 만들지 않는다.
    """
    pending: dict[str, dict[str, Any]] = {}
    for doc in working:
        pending[str(doc["id"])] = doc  # 같은 id 가 두 번이면 뒤의 것 (supabase _by_id 와 같다)
    out: list[dict[str, Any]] = []
    for doc in full:
        doc_id = str(doc.get("id"))
        if doc_id in pending:
            out.append(pending.pop(doc_id))
        elif doc_id not in loaded_ids:
            out.append(doc)
    out.extend(pending.values())
    return out


# ===== 공개 API ========================================================


def load_bookings(scope: Scope | None = None) -> list[dict[str, Any]]:
    """예약 목록의 깊은 복사본을 돌려준다 (호출자가 캐시를 오염시키지 못하게).

    `scope` 를 주면 그 범위의 예약만. None 이면 전체.
    """
    if backend() == "supabase":
        # 락을 잡지 않는다. 다른 프로세스도 테이블에 쓰므로 프로세스 안의 락으로는
        # 일관된 읽기를 살 수 없고, 잡으면 일일 배치의 동시 읽기 셋이 한 줄로 늘어선다.
        sb = _sb()
        return deepcopy(sb.fetch_all() if scope is None else sb.fetch(scope))
    with _lock:
        data = _ensure_loaded()
        if scope is None:
            return deepcopy(data)
        # 복사는 고른 것만 한다. 전체를 깊은 복사하면 대량 임포트 뒤에는 그것만으로 느리다.
        return deepcopy([doc for doc in data if scope.matches(doc)])


def count_bookings() -> int:
    """저장된 예약 수. 행을 읽지 않고 센다 (supabase 는 count=exact 한 번)."""
    if backend() == "supabase":
        return _sb().count()
    with _lock:
        return len(_ensure_loaded())


def drop_cache() -> None:
    """JSON 캐시를 버린다. 다음 읽기는 디스크에서 다시 읽는다.

    임포터용이다. 예전 임포터는 파일을 직접 읽었고, 저장소를 거치게 된 지금도
    "디스크에 있는 것" 을 기준으로 해야 한다. 같은 프로세스에서 누가 파일을 저장소
    몰래 바꿨다면, 낡은 캐시를 기준으로 합친 결과가 그 변경을 지운다.
    """
    global _cache, _cache_path
    with _lock:
        _cache = None
        _cache_path = None


def save_bookings(bookings: list[dict[str, Any]]) -> None:
    """목록 전체를 원자적으로 덮어쓰고 캐시를 갱신한다."""
    if backend() == "supabase":
        # JSON 은 파일을 통째로 덮어쓰니 목록에서 빠진 예약이 저절로 사라진다.
        # 테이블은 그렇지 않으므로 replace_all 이 "없는 행 삭제" 까지 해야 같은 의미다.
        with _lock:
            _sb().replace_all(list(bookings))
        return
    with _lock:
        _store_json(deepcopy(list(bookings)))


@contextmanager
def mutate(scope: Scope | None = None) -> Iterator[list[dict[str, Any]]]:
    """읽기-수정-쓰기를 락으로 감싼 컨텍스트 매니저.

        with mutate(Scope(dates={"2026-09-12"})) as bookings:
            bookings.append(...)

    블록이 예외 없이 끝나면 저장한다. 예외가 나면 저장소는 그대로 둔다.
    주의: 이 블록 안에서 `await` 하지 말 것 (락을 잡은 채로 양보하게 된다).

    `scope` 를 주면 그 범위만 읽어 working 으로 넘기고, 끝나면 **읽었던 것** 과의
    차이만 쓴다: 새/바뀐 doc 은 upsert, 읽었는데 working 에서 사라진 id 는 삭제.
    쓸 때 범위를 다시 계산하지 않는다 — 9/12 범위에서 9/13 으로 옮긴 예약은
    working 에 그대로 있으니 upsert 되지, 범위 밖이라고 지워지지 않는다. 읽지 않은
    행은 지우지도 덮지도 않는다. 단, working 에 **추가한** id 가 범위 밖에 이미
    있으면 기본키 upsert 라 두 엔진 모두 그 행을 덮는다. 신경 쓰이면 그 id 도
    범위에 넣어 읽을 것 (새 예약은 uuid 라 겹칠 일이 없다).
    `scope=None` 은 예전처럼 전체를 읽고 전체와 비교한다.
    """
    if backend() == "supabase":
        sb = _sb()
        with _lock:
            # diff 기준은 여기서 읽은 before 다 — save_bookings 로 다시 읽어 비교하지 않는다.
            # 그래야 블록이 실제로 바꾼 행만 쓰고, 그사이 다른 프로세스가 고친 다른 행은
            # 건드리지 않는다. 같은 행을 동시에 고치면 나중 쓰기가 이긴다 (락은 프로세스 안뿐).
            # apply_diff 가 이미 "읽은 것 중 사라진 id 만 삭제" 라서 범위가 있어도 그대로 쓴다.
            before = sb.fetch_all() if scope is None else sb.fetch(scope)
            working = deepcopy(before)
            yield working
            sb.apply_diff(before, working)
        return
    with _lock:
        if scope is None:
            working = deepcopy(_ensure_loaded())
            yield working
            save_bookings(working)
            return
        full = _ensure_loaded()
        loaded = [doc for doc in full if scope.matches(doc)]
        loaded_ids = {str(doc.get("id")) for doc in loaded}
        working = deepcopy(loaded)
        yield working
        # working 만 복사한다. 범위 밖 행은 캐시가 이미 가진 객체라 그대로 옮겨 담아도 된다.
        _store_json(_replace_subset(full, loaded_ids, deepcopy(working)))


def reset(*, seed: bool = True) -> list[dict[str, Any]]:
    """캐시와 저장소를 초기화한다. 테스트/재시드 용."""
    global _cache, _cache_path
    if backend() == "supabase":
        sb = _sb()
        with _lock:
            data = seed_bookings() if seed else []
            # 재시드는 "지금 테이블에 뭐가 있든" 이 목록과 같게 만드는 게 목적이라
            # 먼저 읽어 diff 를 낼 이유가 없다. 비우고 다시 심는다.
            sb.delete_all()
            sb.upsert(data)
            return deepcopy(data)
    with _lock:
        _cache = None
        _cache_path = None
        data = seed_bookings() if seed else []
        save_bookings(data)
        return deepcopy(data)
