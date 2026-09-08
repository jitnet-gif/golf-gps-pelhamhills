"""고객(플레이어) 영속 저장소.

⚠️ 이 파일이 다루는 데이터는 **실제 고객의 개인정보**다 — 이름, 전화번호,
이메일, 우편번호, 그리고 플레이 이력. 커밋하지 말 것. 이슈/로그에 레코드
내용을 붙이지 말 것. 로그에는 **건수와 id 만** 남긴다.

`backend/services/tee_sheet_store.py` / `retail_store.py` / `simulator_store.py`
와 **같은 규칙**을 따른다 — JSON 파일 하나, 프로세스 내 캐시, `RLock`,
임시파일 + `os.replace` 원자 교체.

- 데이터 파일 경로는 **호출 시점**에 `CUSTOMER_DATA_FILE` 을 읽어 결정한다.
  모듈 임포트 시점에 굳혀 두면 테스트에서 monkeypatch 해도 먹지 않는다.
- 인메모리 캐시는 "해석된 경로"를 키로 잡는다. 경로가 바뀌면 캐시를 버린다.
- 모든 변경은 `threading.RLock` 으로 감싼다.

형제 저장소와 **의도적으로 다른 두 가지**, 둘 다 개인정보이기 때문이다:

1. `seed_customers()` 는 빈 리스트를 돌려주고 `reset()` 의 기본값은
   `seed=False` 다. 베이와 상품은 *설정*이라 시드해도 되지만 고객은 개인정보다.
   사람을 지어내서 PII 저장소에 심는 건 옳지 않다. 그래서 형제들의
   "파일이 깨지면 시드로 복구" 규칙이 여기서는 **빈 저장소**로 복구된다.
2. `split_name` 을 여기서 다시 구현하지 않는다. `tee_sheet_store.split_name`
   이 유일한 구현이고 (그 docstring 이 못박아 뒀다) `clean_display_name` 은
   그 **앞단 전처리**일 뿐이다.

금액 규약: **전부 센트 단위 정수**. 이 저장소의 존재 이유가 합산이라 float
달러를 들이면 어긋난다 (`retail_store` 와 같은 규약).
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from backend.services.tee_sheet_store import split_name

__all__ = [
    "ENV_VAR",
    "data_file",
    "load_customers",
    "save_customers",
    "mutate",
    "reset",
    "seed_customers",
    "clean_display_name",
    "normalize_email",
    "normalize_phone",
    "normalize_zip",
    "customer_key",
    "find_customer",
    "upsert_customer",
]

ENV_VAR = "CUSTOMER_DATA_FILE"

# backend/services/customer_store.py -> backend/data/customers.json
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_DATA_FILE = _BACKEND_DIR / "data" / "customers.json"

_lock = threading.RLock()
_cache: list[dict[str, Any]] | None = None
_cache_path: Path | None = None


def data_file() -> Path:
    """현재 유효한 데이터 파일 경로. 환경변수를 매번 다시 읽는다."""
    override = os.environ.get(ENV_VAR)
    if override:
        return Path(override).expanduser().resolve()
    return _DEFAULT_DATA_FILE


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ===== 정규화 (순수 함수, I/O 없음) ====================================

# Chronogolf 소스 이름에 섞여 들어오는 내부 리그/조 태그. 네 가지 모양이 실제로 있다:
#   "Alijha Greenwood Ws5"  "Jack Devries - Ws6"  "Doug Fur (Ws5)"  "Lake Mccardle(Ws6)"
# 마지막 형태는 공백이 없어서 성 안쪽에 태그가 박힌다. 넷 다 잡아야 한다.
_WS_TAG = re.compile(r"\s*[-(]?\s*(Ws\s*\d+)\s*\)?\s*$", re.IGNORECASE)
_NICKNAME = re.compile(r"\s*\(([^)]+)\)\s*")

# `split_name` 은 마지막 토큰을 성으로 잡는다. 두 단어 성은 그 규칙으로 못 쪼갠다.
# 지금 소스에 있는 건 "St Louis" 하나뿐이지만, 재발하는 데이터 모양이라 표로 둔다.
MULTIWORD_SURNAMES = ("St Louis",)


def clean_display_name(raw: str) -> tuple[str, list[str], str]:
    """소스 이름에서 내부 태그와 별명을 떼어낸다.

    반환은 `(정리된 이름, 태그 목록, 별명)`. 호출자는 정리된 이름을
    `tee_sheet_store.split_name` 에 넘긴다 — 여기서 성/이름을 쪼개지 않는다.

        "Doug Fur (Ws5)"        -> ("Doug Fur", ["Ws5"], "")
        "Lake Mccardle(Ws6)"    -> ("Lake Mccardle", ["Ws6"], "")
        "Robert (Bob) Machulla" -> ("Robert Machulla", [], "Bob")
    """
    name = (raw or "").strip()
    tags: list[str] = []
    while True:
        match = _WS_TAG.search(name)
        if not match:
            break
        tags.insert(0, re.sub(r"\s+", "", match.group(1)))
        name = name[: match.start()].strip()

    nickname = ""
    found = _NICKNAME.search(name)
    if found:
        nickname = found.group(1).strip()
        name = _NICKNAME.sub(" ", name)

    # 태그를 떼면 "Trevor Purchase  Ws4" 같은 이중 공백이 남는다.
    return re.sub(r"\s+", " ", name).strip(), tags, nickname


def split_display_name(clean: str) -> tuple[str, str]:
    """정리된 이름을 (firstName, lastName) 으로. 두 단어 성만 예외 처리한다."""
    for surname in MULTIWORD_SURNAMES:
        if clean.lower().endswith(" " + surname.lower()):
            return clean[: -len(surname)].strip(), clean[-len(surname):]
    return split_name(clean)


# 요금제 이름이 곧 회원 등급이다. `Member Number` 가 소스에 전부 비어 있어서
# 등급을 알 수 있는 경로는 이것뿐이다. 두 소스(4월 CSV, 9/8 스냅샷)에서 관찰된
# 12 + 10 개 값이 모두 아래 접두어로 갈린다.
_MEMBER_TIERS = ("Full", "Weekday", "Twilight", "Intermediate", "Junior", "9 Hole")
_PUBLIC_SEGMENTS = {"public junior": "Junior", "public senior": "Senior",
                    "public": "Standard", "golfnow": "GolfNow"}


def classify_rate_plan(plan: str) -> dict[str, Any]:
    """요금제 이름 하나를 등급 정보로 쪼갠다.

        "Weekday Member - Single with Weekday Cart"
            -> tier "Weekday", category "Single", cartPlan "Weekday", isMember True
        "Public Senior"
            -> tier None, publicSegment "Senior", isMember False

    등급 **서열은 매기지 않는다**. "Intermediate Member II" 와 "Junior Member" 는
    나이 구분이고 "Full/Weekday/Twilight" 는 이용 시간 구분이라, 클럽이 정해주지
    않은 우열을 여기서 지어내면 틀린 순위가 리포트에 박힌다.
    """
    text = (plan or "").strip()
    low = text.casefold()

    tier = None
    if "member" in low:
        for name in _MEMBER_TIERS:
            if low.startswith(name.casefold()):
                tier = name
                break
        else:
            tier = "Other"

    category = None
    if "spousal" in low:
        category = "Spousal"
    elif "single" in low:
        category = "Single"

    cart_plan = None
    if "7 day cart" in low:
        cart_plan = "7 Day"
    elif "weekday cart" in low:
        cart_plan = "Weekday"

    return dict(ratePlan=text, isMember=tier is not None, tier=tier, category=category,
                cartPlan=cart_plan,
                publicSegment=None if tier else _PUBLIC_SEGMENTS.get(low, "Standard" if text else None))


def normalize_email(raw: str) -> str:
    """소문자 + 공백 제거. `@` 가 없으면 빈 문자열."""
    value = (raw or "").strip().casefold()
    return value if "@" in value else ""


def normalize_phone(raw: str) -> str:
    """북미 10자리로 정규화. 정규화가 안 되면 빈 문자열을 돌려준다.

    소스에 9자리(오타)와 11~12자리(국가번호/선행 0)가 섞여 있다. 앞의 `1` 이나
    `0` 을 떼서 10자리가 되면 받아들이고, 그래도 안 되면 **추측하지 않는다**.
    호출자는 원본을 `phoneRaw` 에 남기고 `needsReview` 를 세운다.
    """
    digits = re.sub(r"\D", "", raw or "")
    while len(digits) > 10 and digits[0] in "01":
        digits = digits[1:]
    return digits if len(digits) == 10 else ""


def normalize_zip(raw: str) -> str:
    """캐나다 우편번호를 `A1A 1A1` 형태로. 파싱 실패 시 빈 문자열."""
    value = re.sub(r"\s+", "", (raw or "")).upper()
    if re.fullmatch(r"[A-Z]\d[A-Z]\d[A-Z]\d", value):
        return f"{value[:3]} {value[3:]}"
    return ""


# ===== 신원 ============================================================


def customer_key(source: str, source_id: str) -> str:
    """`chronogolf:19947850` 형태의 네임스페이스 키.

    소스를 앞에 붙여 두면 나중에 다른 경로(보이스 예약, 웹 폼)에서 들어온
    id 와 숫자가 겹쳐도 충돌하지 않는다.
    """
    return f"{source}:{source_id}"


def find_customer(
    customers: list[dict[str, Any]],
    *,
    id: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    name: str | None = None,
) -> dict[str, Any] | None:
    """id → 이메일 → 전화 → 이름 순으로 찾는다. 먼저 걸리는 것이 이긴다.

    **전화가 이메일보다 뒤인 이유**: 한 집에서 유선 하나를 같이 쓴다.
    소스에 Sue Hagar 와 Jim Hagar 가 같은 번호로 들어 있다 — 전화로 먼저
    매칭하면 부부가 한 사람으로 합쳐진다.

    이름 매칭은 최후 수단이고, 호출자가 판단하도록 후보만 돌려준다.
    이 함수는 아무 상태도 바꾸지 않는다.
    """
    if id:
        for row in customers:
            if row.get("id") == id:
                return row
    if email:
        target = normalize_email(email)
        if target:
            for row in customers:
                if normalize_email(row.get("email", "")) == target:
                    return row
    if phone:
        target = normalize_phone(phone)
        if target:
            for row in customers:
                if normalize_phone(row.get("phone", "")) == target:
                    return row
    if name:
        target = re.sub(r"[^a-z]", "", name.casefold())
        if target:
            for row in customers:
                if re.sub(r"[^a-z]", "", row.get("name", "").casefold()) == target:
                    return row
    return None


def upsert_customer(
    customers: list[dict[str, Any]], record: dict[str, Any]
) -> dict[str, Any]:
    """id 로 찾아 병합하거나 새로 넣는다. 목록을 제자리에서 고친다.

    병합 규칙 (소스에서 실제로 관찰한 것에 근거한다):

    - 연락처(email/phone/zip): **채워진 값이 이긴다**. 같은 id 안에서 이 세
      필드가 서로 어긋나는 경우는 소스 500행에 하나도 없었다. 그래서 "가장
      풍부한 레코드"가 모호하지 않고, 비어 있는 행에서 잃을 데이터를 되찾는다.
    - `isMember`: **회원이 한 번이라도 나오면 회원**. `Player Role` 은 프로필
      속성이 아니라 그 예약의 요금 맥락이다 (한 회원이 퍼블릭 요금으로 한 번
      예약하면 그 행만 Public 으로 찍힌다). 최신값 우선은 틀린 규칙이다.
    - `ratePlansSeen` / `rolesSeen` / `sourceTags`: 합집합.
    - `firstSeen` / `lastSeen`: 최소 / 최대.
    - 카운터와 `totalSpendCents`: **누적이 아니라 교체**. 겹치는 CSV 를 다시
      임포트해도 값이 부풀지 않아야 한다 (멱등성).
    - `createdAt` 은 처음 값을 지키고, `updatedAt` 은 **내용이 실제로 달라졌을 때만**
      움직인다. 매번 벽시계를 찍으면 같은 파일을 다시 임포트해도 저장소가
      "변경됨"으로 잡혀서 임포터의 dry-run 비교와 `.bak` 백업이 무의미해진다.
    """
    existing = find_customer(customers, id=record["id"])
    if existing is None:
        customers.append(deepcopy(record))
        return customers[-1]

    before = deepcopy(existing)

    for field in ("email", "phone", "phoneRaw", "zip", "nickname"):
        if not existing.get(field) and record.get(field):
            existing[field] = record[field]

    for field in ("rolesSeen", "ratePlansSeen", "sourceTags", "reviewReasons",
                  "possibleDuplicateOf", "memberTiersSeen", "cartPlansSeen"):
        existing[field] = sorted(set(existing.get(field, [])) | set(record.get(field, [])))

    existing["isMember"] = bool(existing.get("isMember")) or bool(record.get("isMember"))
    existing["role"] = "Member" if existing["isMember"] else record.get("role", "Public")

    for field, pick in (("firstSeen", min), ("lastSeen", max)):
        values = [v for v in (existing.get(field), record.get(field)) if v]
        if values:
            existing[field] = pick(values)

    for field in ("roundsBooked", "roundsArrived", "roundsCancelled", "noShows",
                  "totalSpendCents"):
        existing[field] = record.get(field, existing.get(field, 0))

    # provenance 는 "이 값들이 어느 export 에서 나왔는지"라서 최신 임포트 것으로 바꾼다.
    # 같은 파일을 다시 넣으면 같은 값이 나오므로 멱등성은 깨지지 않는다.
    if record.get("provenance"):
        existing["provenance"] = deepcopy(record["provenance"])
    for field in ("name", "firstName", "lastName", "sourceName", "currency"):
        if record.get(field):
            existing[field] = record[field]

    # 대표 등급은 "가장 최근 회원 행"이라 최신 임포트 것이 이긴다. 다만 회원이었던
    # 사람이 퍼블릭 요금으로 한 번 쳤다고 등급이 사라지면 안 되므로, 새 값이
    # 비어 있으면 기존 등급을 지킨다 (`memberTiersSeen` 이 이력을 들고 있다).
    for field in ("memberTier", "memberCategory", "cartPlan", "publicSegment"):
        if record.get(field) or not existing.get(field):
            existing[field] = record.get(field)

    existing["needsReview"] = bool(existing["reviewReasons"])
    # createdAt 은 처음 본 시점이다. 재임포트가 덮어쓰면 안 된다.
    existing["createdAt"] = before.get("createdAt", record.get("createdAt"))

    settled = {k: v for k, v in existing.items() if k != "updatedAt"}
    if settled != {k: v for k, v in before.items() if k != "updatedAt"}:
        existing["updatedAt"] = record.get("updatedAt") or _iso_now()
    else:
        existing["updatedAt"] = before.get("updatedAt", existing["updatedAt"])
    return existing


# ===== 영속화 ==========================================================


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
        # 형제 저장소는 여기서 시드로 되돌리지만, 여기 시드는 빈 목록이다.
        return None
    if not isinstance(raw, list):
        return None
    return [item for item in raw if isinstance(item, dict)]


def seed_customers() -> list[dict[str, Any]]:
    """항상 빈 목록. 고객은 지어내지 않는다 (모듈 docstring 참고)."""
    return []


def _ensure_loaded() -> list[dict[str, Any]]:
    """캐시를 현재 경로에 맞게 채운다. 호출자는 반드시 _lock 을 잡고 있어야 한다."""
    global _cache, _cache_path

    path = data_file()
    if _cache is not None and _cache_path == path:
        return _cache

    data = _read_file(path)
    if data is None:
        data = seed_customers()
        _write_atomic(path, data)

    _cache = data
    _cache_path = path
    return _cache


# ===== 공개 API ========================================================


def load_customers() -> list[dict[str, Any]]:
    """고객 목록의 깊은 복사본을 돌려준다 (호출자가 캐시를 오염시키지 못하게)."""
    with _lock:
        return deepcopy(_ensure_loaded())


def save_customers(customers: list[dict[str, Any]]) -> None:
    """목록 전체를 원자적으로 덮어쓰고 캐시를 갱신한다."""
    global _cache, _cache_path
    with _lock:
        path = data_file()
        payload = deepcopy(list(customers))
        _write_atomic(path, payload)
        _cache = payload
        _cache_path = path


@contextmanager
def mutate() -> Iterator[list[dict[str, Any]]]:
    """읽기-수정-쓰기를 락으로 감싼 컨텍스트 매니저.

    블록이 예외 없이 끝나면 저장한다. 예외가 나면 디스크는 그대로 둔다.
    주의: 이 블록 안에서 `await` 하지 말 것 (락을 잡은 채로 양보하게 된다).
    """
    with _lock:
        working = deepcopy(_ensure_loaded())
        yield working
        save_customers(working)


def reset(*, seed: bool = False) -> list[dict[str, Any]]:
    """캐시와 파일을 초기화한다. 기본값이 `seed=False` 인 이유는 docstring 참고."""
    global _cache, _cache_path
    with _lock:
        _cache = None
        _cache_path = None
        data = seed_customers() if seed else []
        save_customers(data)
        return deepcopy(data)
