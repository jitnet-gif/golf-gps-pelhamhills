"""시뮬레이터 베이/예약 영속 저장소.

`backend/api/routes/simulator.py` 가 쓰는 유일한 저장 계층이다.
`backend/services/tee_sheet_store.py` 와 같은 규칙을 따른다 — JSON 파일 하나,
프로세스 내 캐시, `RLock`, 원자적 교체. 베이 5개 / 하루 수십 건 규모라 충분하다.

티 시트와 다른 점은 페이로드가 리스트가 아니라 **두 컬렉션을 담은 dict** 라는 것뿐이다:

    {"bays": [...], "reservations": [...]}

설계 메모 (티 시트 저장소와 동일)
- 데이터 파일 경로는 **호출 시점**에 `SIMULATOR_DATA_FILE` 을 읽어 결정한다.
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

__all__ = [
    "ENV_VAR",
    "data_file",
    "load",
    "save",
    "mutate",
    "reset",
    "seed_bays",
    "next_reservation_id",
]

ENV_VAR = "SIMULATOR_DATA_FILE"

# backend/services/simulator_store.py -> backend/data/simulator.json
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_DATA_FILE = _BACKEND_DIR / "data" / "simulator.json"

_lock = threading.RLock()
_cache: dict[str, list[dict[str, Any]]] | None = None
_cache_path: Path | None = None


def data_file() -> Path:
    """현재 유효한 데이터 파일 경로. 환경변수를 매번 다시 읽는다."""
    override = os.environ.get(ENV_VAR)
    if override:
        return Path(override).expanduser().resolve()
    return _DEFAULT_DATA_FILE


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ===== 시드 데이터 =====================================================
#
# PH Indoor Golf 실제 구성: 우타 베이 3, 좌우 겸용 베이 1, VIP 베이 1.
# 예전 `POST /simulator/admin/init-bays` 가 DB 에 넣던 것과 같은 목록이다.


def seed_bays() -> list[dict[str, Any]]:
    """최초 1회 파일에 심는 베이 목록."""
    return [
        {"id": 1, "bay_number": 1, "bay_type": "right_handed", "hourly_rate": 20.0, "is_active": True},
        {"id": 2, "bay_number": 2, "bay_type": "right_handed", "hourly_rate": 20.0, "is_active": True},
        {"id": 3, "bay_number": 3, "bay_type": "right_handed", "hourly_rate": 20.0, "is_active": True},
        {"id": 4, "bay_number": 4, "bay_type": "left_right", "hourly_rate": 20.0, "is_active": True},
        {"id": 5, "bay_number": 5, "bay_type": "vip", "hourly_rate": 25.0, "is_active": True},
    ]


def _seed_payload() -> dict[str, list[dict[str, Any]]]:
    return {"bays": seed_bays(), "reservations": []}


# ===== 파일 I/O ========================================================


def _write_atomic(path: Path, payload: dict[str, list[dict[str, Any]]]) -> None:
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


def _coerce(raw: Any) -> dict[str, list[dict[str, Any]]] | None:
    """디스크에서 읽은 값을 정규화한다. 모양이 틀리면 None (→ 시드로 복구)."""
    if not isinstance(raw, dict):
        return None
    bays = raw.get("bays")
    reservations = raw.get("reservations")
    if not isinstance(bays, list) or not isinstance(reservations, list):
        return None
    return {
        "bays": [item for item in bays if isinstance(item, dict)],
        "reservations": [item for item in reservations if isinstance(item, dict)],
    }


def _read_file(path: Path) -> dict[str, list[dict[str, Any]]] | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, OSError):
        # 손상된 파일은 시드로 되돌린다. 조용히 500 을 뿜는 것보다 낫다.
        return None
    return _coerce(raw)


def _ensure_loaded() -> dict[str, list[dict[str, Any]]]:
    """캐시를 현재 경로에 맞게 채운다. 호출자는 반드시 _lock 을 잡고 있어야 한다."""
    global _cache, _cache_path

    path = data_file()
    if _cache is not None and _cache_path == path:
        return _cache

    data = _read_file(path)
    if data is None:
        data = _seed_payload()
        _write_atomic(path, data)
    elif not data["bays"]:
        # 베이가 하나도 없으면 예약 화면이 통째로 죽는다. 빈 파일은 다시 심는다.
        data["bays"] = seed_bays()
        _write_atomic(path, data)

    _cache = data
    _cache_path = path
    return _cache


# ===== 공개 API ========================================================


def load() -> dict[str, list[dict[str, Any]]]:
    """전체 페이로드의 깊은 복사본 (호출자가 캐시를 오염시키지 못하게)."""
    with _lock:
        return deepcopy(_ensure_loaded())


def save(payload: dict[str, list[dict[str, Any]]]) -> None:
    """페이로드 전체를 원자적으로 덮어쓰고 캐시를 갱신한다."""
    global _cache, _cache_path
    with _lock:
        path = data_file()
        snapshot = {
            "bays": deepcopy(list(payload.get("bays", []))),
            "reservations": deepcopy(list(payload.get("reservations", []))),
        }
        _write_atomic(path, snapshot)
        _cache = snapshot
        _cache_path = path


@contextmanager
def mutate() -> Iterator[dict[str, list[dict[str, Any]]]]:
    """읽기-수정-쓰기를 락으로 감싼 컨텍스트 매니저.

        with mutate() as data:
            data["reservations"].append(...)

    블록이 예외 없이 끝나면 저장한다. 예외가 나면 디스크는 그대로 둔다.
    예약 생성의 "빈 베이 확인 → 기록" 을 이 안에서 처리해야 두 요청이 같은
    베이를 동시에 잡는 일이 없다.
    주의: 이 블록 안에서 `await` 하지 말 것 (락을 잡은 채로 양보하게 된다).
    """
    with _lock:
        working = deepcopy(_ensure_loaded())
        yield working
        save(working)


def next_reservation_id(reservations: list[dict[str, Any]]) -> int:
    """단조 증가하는 예약 id. 삭제가 있어도 재사용하지 않는다."""
    highest = 0
    for item in reservations:
        try:
            highest = max(highest, int(item.get("id", 0)))
        except (TypeError, ValueError):
            continue
    return highest + 1


def reset(*, seed: bool = True) -> dict[str, list[dict[str, Any]]]:
    """캐시와 파일을 초기화한다. 테스트/재시드 용."""
    global _cache, _cache_path
    with _lock:
        _cache = None
        _cache_path = None
        data = _seed_payload() if seed else {"bays": [], "reservations": []}
        save(data)
        return deepcopy(data)
