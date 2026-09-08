"""프로 샵 리테일(POS) 영속 저장소.

`backend/api/routes/retail.py` 가 쓰는 유일한 저장 계층이다.
`backend/services/simulator_store.py` 와 **같은 규칙**을 따른다 — JSON 파일 하나,
프로세스 내 캐시, `RLock`, 임시파일 + `os.replace` 원자 교체. 프로 샵 한 곳,
하루 수십~수백 건 규모라 이걸로 충분하다.

페이로드는 두 컬렉션을 담은 dict 다:

    {"products": [...], "sales": [...]}

설계 메모 (시뮬레이터/티 시트 저장소와 동일)
- 데이터 파일 경로는 **호출 시점**에 `RETAIL_DATA_FILE` 을 읽어 결정한다.
  모듈 임포트 시점에 굳혀 두면 테스트에서 monkeypatch 해도 먹지 않는다.
- 인메모리 캐시는 "해석된 경로"를 키로 잡는다. 경로가 바뀌면 캐시를 버린다.
- 모든 변경은 `threading.RLock` 으로 감싼다. FastAPI 의 sync 엔드포인트는
  스레드풀에서 돌기 때문에 동시 진입이 실제로 가능하다.
- 쓰기는 같은 디렉터리에 임시 파일을 만든 뒤 `os.replace` 로 원자 교체한다.

금액 규약: **전부 센트 단위 정수**. 이 파일은 계산을 하지 않지만, 시드 가격도
정수로만 적는다. 달러를 float 로 들이면 하루치를 합산한 마감 리포트에서
1센트씩 어긋난다.
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
    "seed_products",
    "next_product_id",
    "next_sale_id",
]

ENV_VAR = "RETAIL_DATA_FILE"

# backend/services/retail_store.py -> backend/data/retail.json
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_DATA_FILE = _BACKEND_DIR / "data" / "retail.json"

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
# 펠럼 힐스 프로 샵에 실제로 있을 법한 16개 품목을 6개 카테고리에 걸쳐 심는다.
# 가격은 캐나다 프로 샵 현실 가격대의 센트 정수 (8499 === $84.99).
#
# 렌탈(Rentals)은 `stock: None` 이다 — 파워카트는 "몇 개 남았나" 로 세지 않는다.
# 이 null 이 판매 시 재고 차감을 건너뛰는 유일한 신호다.


def seed_products() -> list[dict[str, Any]]:
    """최초 1회 파일에 심는 상품 목록."""
    now = _iso_now()
    rows: list[dict[str, Any]] = [
        # --- Balls ---
        ("PV1-DZ", "Titleist Pro V1 (Dozen)", "Balls", 8499, 5900, 48, 12),
        ("CHRM-DZ", "Callaway Chrome Soft (Dozen)", "Balls", 7999, 5500, 36, 12),
        # --- Equipment ---
        ("TM-QI10-D", "TaylorMade Qi10 Driver", "Equipment", 69999, 52000, 4, 2),
        ("VKY-SM10-56", "Titleist Vokey SM10 Wedge 56", "Equipment", 24999, 17500, 6, 2),
        ("SC-NP2-34", 'Scotty Cameron Newport 2 Putter (34")', "Equipment", 64999, 48000, 2, 1),
        # --- Apparel ---
        ("FJ-POLO-M", "FootJoy ProDry Polo (M)", "Apparel", 8999, 4800, 14, 6),
        ("PH-CAP-ADJ", "Pelham Hills Adjustable Cap", "Apparel", 3499, 1400, 30, 10),
        ("SM-RAIN-L", "Sun Mountain Rain Jacket (L)", "Apparel", 19999, 12000, 5, 3),
        # --- Accessories ---
        ("FJ-GLV-ML", "FootJoy WeatherSof Glove (ML)", "Accessories", 2299, 1150, 40, 12),
        ("TEE-BMB-50", 'Bamboo Tees 2.75" (50 pack)', "Accessories", 999, 380, 60, 20),
        ("PH-TWL-TRI", "Pelham Hills Tri-Fold Towel", "Accessories", 2999, 1300, 18, 6),
        ("DVT-MRK-SET", "Divot Tool & Ball Marker Set", "Accessories", 1499, 620, 25, 10),
        # --- Food & Beverage ---
        ("GTR-591", "Gatorade 591 mL", "Food & Beverage", 399, 145, 72, 24),
        ("CLIF-BAR", "Clif Bar", "Food & Beverage", 349, 160, 45, 15),
        # --- Rentals (재고 개념 없음) ---
        ("CART-18", "Power Cart Rental (18 holes)", "Rentals", 2500, 0, None, 0),
        ("CLUBS-18", "Rental Clubs (18 holes)", "Rentals", 4500, 0, None, 0),
    ]
    return [
        {
            "id": index,
            "sku": sku,
            "name": name,
            "category": category,
            "price": price,
            "cost": cost,
            "stock": stock,
            "reorder_point": reorder_point,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        }
        for index, (sku, name, category, price, cost, stock, reorder_point) in enumerate(
            rows, start=1
        )
    ]


def _seed_payload() -> dict[str, list[dict[str, Any]]]:
    return {"products": seed_products(), "sales": []}


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
    products = raw.get("products")
    sales = raw.get("sales")
    if not isinstance(products, list) or not isinstance(sales, list):
        return None
    return {
        "products": [item for item in products if isinstance(item, dict)],
        "sales": [item for item in sales if isinstance(item, dict)],
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
    elif not data["products"]:
        # 상품이 하나도 없으면 판매 화면이 통째로 죽는다. 빈 파일은 다시 심는다.
        # 매출은 그대로 둔다 — 과거 기록을 시드가 덮어써서는 안 된다.
        data["products"] = seed_products()
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
            "products": deepcopy(list(payload.get("products", []))),
            "sales": deepcopy(list(payload.get("sales", []))),
        }
        _write_atomic(path, snapshot)
        _cache = snapshot
        _cache_path = path


@contextmanager
def mutate() -> Iterator[dict[str, list[dict[str, Any]]]]:
    """읽기-수정-쓰기를 락으로 감싼 컨텍스트 매니저.

        with mutate() as data:
            data["sales"].append(...)

    블록이 예외 없이 끝나면 저장한다. 예외가 나면 디스크는 그대로 둔다 —
    재고 부족으로 400 을 던지면 이미 차감한 다른 줄도 함께 되돌아간다.
    판매의 "재고 확인 → 차감 → 영수증 번호 채번 → 기록" 은 반드시 이 한 블록
    안에서 끝내야 한다. 그래야 두 계산대가 같은 영수증 번호를 뽑거나 마지막
    재고 한 개를 동시에 팔지 못한다.
    주의: 이 블록 안에서 `await` 하지 말 것 (락을 잡은 채로 양보하게 된다).
    """
    with _lock:
        working = deepcopy(_ensure_loaded())
        yield working
        save(working)


def _next_id(rows: list[dict[str, Any]]) -> int:
    """단조 증가하는 id. 삭제가 있어도 재사용하지 않는다."""
    highest = 0
    for item in rows:
        try:
            highest = max(highest, int(item.get("id", 0)))
        except (TypeError, ValueError):
            continue
    return highest + 1


def next_product_id(products: list[dict[str, Any]]) -> int:
    return _next_id(products)


def next_sale_id(sales: list[dict[str, Any]]) -> int:
    return _next_id(sales)


def reset(*, seed: bool = True) -> dict[str, list[dict[str, Any]]]:
    """캐시와 파일을 초기화한다. 테스트/재시드 용."""
    global _cache, _cache_path
    with _lock:
        _cache = None
        _cache_path = None
        data = _seed_payload() if seed else {"products": [], "sales": []}
        save(data)
        return deepcopy(data)
