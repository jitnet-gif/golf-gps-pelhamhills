"""티 시트 예약의 Supabase(PostgREST) 저장 계층.

`tee_sheet_store` 가 `TEE_SHEET_BACKEND=supabase` 일 때 이 모듈로 위임한다.
테이블은 `supabase/migrations/0002_tee_bookings.sql` 의 `pelham_tee_bookings`.

설계 메모
- 읽기는 `doc` 만 돌려준다. 나머지 컬럼은 `doc` 에서 뽑아 적는 사본이라
  둘이 어긋나면 `doc` 이 맞다 (마이그레이션 주석과 같은 규칙).
- 설정(URL·키)은 **호출 시점**에 읽는다. 저장소 쪽 `data_file()` 과 같은 이유 —
  임포트 때 굳히면 테스트의 monkeypatch 가 먹지 않는다.
- 클라이언트를 캐시하지 않는다. 호출마다 새로 연다. `set_transport` 로 바꾼
  전송 계층이 이미 만들어 둔 클라이언트에 남아 다음 테스트를 오염시키지 않게.
- 이 모듈은 `tee_sheet_store` 를 임포트하지 않는다 (저장소가 이쪽을 지연 임포트한다).
- ⚠️ 예약 doc 에는 플레이어 이름·전화·이메일이 들어 있고, 시드 예약 id 조차 성이다
  (`b-xeric`). 그래서 예외 메시지에는 메서드·테이블·HTTP 상태·PostgREST 코드만
  싣는다. 응답 본문(Postgres 는 "Failing row contains (...)" 로 행 값을 그대로
  돌려준다)이나 요청 URL(DELETE 쿼리에 id 가 들어간다)은 절대 싣지 않는다.
"""

from __future__ import annotations

import logging
import os
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator

import httpx

__all__ = [
    "TABLE",
    "PAGE_SIZE",
    "UPSERT_CHUNK",
    "DELETE_CHUNK",
    "SupabaseStoreError",
    "configured",
    "set_transport",
    "to_row",
    "fetch_all",
    "fetch",
    "count",
    "upsert",
    "delete_ids",
    "delete_all",
    "apply_diff",
    "replace_all",
]

TABLE = "pelham_tee_bookings"

# Supabase 의 PostgREST 기본 max-rows 가 1000 이다. 프로젝트가 이보다 작게 잡혀 있어도
# 행을 잃지 않는다 — 페이징은 "짧은 페이지" 가 아니라 "빈 페이지" 에서 멈춘다.
PAGE_SIZE = 1000
UPSERT_CHUNK = 500
# DELETE 는 id 목록이 URL 쿼리에 들어간다. 게이트웨이의 URL 길이 제한에 걸리지 않게 작게.
DELETE_CHUNK = 100

_PATH = f"/rest/v1/{TABLE}"
_TIMEOUT = 10.0

# PostgREST/Postgres 오류 코드 모양만 통과시킨다 (예: 23505, 42P01, PGRST204).
# 이 필드마저 서버가 이상한 값을 넣어 보내면 메시지에 섞이지 않게 버린다.
_ERROR_CODE_RE = re.compile(r"^[A-Z0-9]{1,12}$")

_transport: httpx.BaseTransport | None = None

_URL_ENV = ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY"
# `backend.core.config` 첫 임포트가 `.env` 로 덮어쓸 수 있는 이름 중 이 계층이 기대는 것들.
_GUARDED_ENV = (*_URL_ENV, _KEY_ENV, "TEE_SHEET_BACKEND")


class _DropTableRequestLogs(logging.Filter):
    """httpx 의 INFO 로그 "HTTP Request: DELETE <url>" 중 이 테이블 것만 버린다.

    backend/main.py 가 루트 로깅을 INFO 로 켜서, 그대로 두면 DELETE 의 id 목록
    (시드 id 는 성이다)이 요청마다 stdout 에 찍힌다. httpx 로거 레벨을 올리면 같은
    프로세스의 다른 httpx 사용처 로그까지 사라지므로 이 테이블 경로만 거른다.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            return _PATH not in record.getMessage()
        except Exception:
            return True


_httpx_logger = logging.getLogger("httpx")
# 모듈을 다시 임포트하면 클래스 객체가 새로 생겨 isinstance 로는 중복을 못 잡는다.
if not any(type(f).__name__ == _DropTableRequestLogs.__name__ for f in _httpx_logger.filters):
    _httpx_logger.addFilter(_DropTableRequestLogs())


class SupabaseStoreError(RuntimeError):
    """Supabase 호출 실패. `.status` 는 HTTP 상태 (설정 누락·네트워크 오류면 None)."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


# ===== 설정 ============================================================


def _settings() -> Any:
    # 지연 임포트: `backend.core.config` 는 임포트할 때 `.env` 를
    # `load_dotenv(override=True)` 로 os.environ 에 덮어쓴다. 환경변수로 이미 설정이
    # 끝난 경우(테스트, 배포)에는 아예 건드리지 않도록 필요할 때만 불러온다.
    from backend.core.config import settings

    return settings


def _config() -> tuple[str, str]:
    """(url, key). 환경변수가 항상 settings 보다 우선하고, 둘은 반드시 같은 출처에서 온다."""
    url = next((os.environ[n] for n in _URL_ENV if os.environ.get(n)), "")
    key = os.environ.get(_KEY_ENV) or ""
    if url or key:
        # 환경변수에 하나라도 있으면 둘 다 환경변수에서만 받는다. 모자란 쪽을 settings 로
        # 채우면 `.env` 의 공유 프로젝트 service_role 키가 셸의 SUPABASE_URL 이 가리키는
        # 엉뚱한 호스트로 간다. 하나가 비면 그대로 돌려주고 `_client` 가 설정 누락으로 거절한다.
        return url.rstrip("/"), key
    snapshot = {name: os.environ.get(name) for name in _GUARDED_ENV}
    try:
        settings = _settings()
    finally:
        # `backend.core.config` 는 첫 임포트 때 `.env` 를 override=True 로 os.environ 에
        # 붓는다. 되돌리지 않으면 이 프로세스의 다음 호출(예: migrate 의 prune DELETE)과
        # TEE_SHEET_BACKEND 판정이 조용히 `.env` 쪽으로 넘어간다. 두 번째부터는
        # sys.modules 캐시라 부작용이 없지만, 되돌리는 비용이 0 이라 매번 한다.
        for name, value in snapshot.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
    url = getattr(settings, "NEXT_PUBLIC_SUPABASE_URL", "") or ""
    key = getattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "") or ""
    return url.rstrip("/"), key


def configured() -> bool:
    try:
        url, key = _config()
    except Exception:
        return False
    return bool(url and key)


def set_transport(transport: httpx.BaseTransport | None) -> None:
    """테스트용 전송 계층 주입. None 이면 실제 네트워크로 돌아간다."""
    global _transport
    _transport = transport


@contextmanager
def _client() -> Iterator[httpx.Client]:
    url, key = _config()
    if not url or not key:
        raise SupabaseStoreError(
            f"Supabase is not configured for {TABLE}: "
            "set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
            status=None,
        )
    with httpx.Client(
        base_url=url,
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=_TIMEOUT,
        transport=_transport,
    ) as client:
        yield client


def _request(client: httpx.Client, method: str, **kwargs: Any) -> httpx.Response:
    # `params` 는 dict 또는 (이름, 값) 튜플 목록. 같은 컬럼에 필터를 두 번 걸 때
    # (`booking_date=gte.X&booking_date=lte.Y`, `id=in.(...)&id=gt.<last>`) 는 dict 로는
    # 한쪽이 사라지므로 목록으로 보낸다. PostgREST 는 반복된 필터를 AND 로 묶는다.
    try:
        response = client.request(method, _PATH, **kwargs)
    except httpx.HTTPError as exc:
        # httpx 예외 문자열에는 요청 URL(= DELETE 의 id 목록)이 들어갈 수 있다.
        # 클래스 이름만 남기고 `from None` 으로 원인 체인도 끊는다.
        raise SupabaseStoreError(
            f"{method} {TABLE} failed: {type(exc).__name__}", status=None
        ) from None
    # >= 400 만 보면 3xx 가 성공으로 통과한다. httpx 는 리다이렉트를 따라가지 않으므로
    # (예: http:// URL → https 로 301) 아무것도 쓰지 않고 "커밋 완료" 가 된다.
    if not response.is_success:
        raise SupabaseStoreError(
            f"{method} {TABLE} failed: HTTP {response.status_code}"
            f" (code {_error_code(response)})",
            status=response.status_code,
        )
    return response


def _error_code(response: httpx.Response) -> str:
    """응답 본문에서 PostgREST `code` 만 뽑는다. 본문이 JSON 이 아니어도 죽지 않는다."""
    try:
        body = response.json()
    except Exception:
        return "unknown"
    code = body.get("code") if isinstance(body, dict) else None
    if isinstance(code, str) and _ERROR_CODE_RE.match(code):
        return code
    return "unknown"


# ===== 행 변환 =========================================================


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _timestamp(value: Any) -> Any:
    # "" 를 timestamptz 에 넣으면 22007 로 **청크 전체**가 거절된다. 빈 값은 NULL 로.
    return value or None


def to_row(doc: dict[str, Any], *, synced_at: str | None = None) -> dict[str, Any]:
    """doc 한 건 -> 테이블 행. 모든 행이 같은 키 집합을 가져야 한다
    (PostgREST 대량 upsert 는 키 집합이 다르면 400 으로 거절한다)."""
    return {
        "id": doc["id"],
        "booking_date": doc["date"],
        "tee_time": doc.get("time"),
        "status": doc.get("status"),
        "source": doc.get("source"),
        "title": doc.get("title"),
        "hold_expires_at": _timestamp(doc.get("holdExpiresAt")),
        "created_at": _timestamp(doc.get("createdAt")),
        "updated_at": _timestamp(doc.get("updatedAt")),
        "doc": doc,
        "synced_at": synced_at or _iso_now(),
    }


def _by_id(docs: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    # 같은 id 가 한 upsert 문에 두 번 들어가면 Postgres 가 21000
    # ("cannot affect row a second time") 으로 청크 전체를 거절한다. 뒤의 것이 이긴다.
    return {doc["id"]: doc for doc in docs}


def _chunks(items: list[Any], size: int) -> Iterator[list[Any]]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


def _quote(value: str) -> str:
    # PostgREST in.(...) 목록의 따옴표 규칙: 값 전체를 "..." 로 감싸고 안쪽의 \ 와 "
    # 를 역슬래시로 이스케이프한다. 감싸지 않으면 쉼표·괄호가 든 id 가 쪼개진다.
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


# ===== 공개 API (클라이언트를 받는 내부 구현 + 얇은 래퍼) ===============


def _page(response: httpx.Response) -> list[dict[str, Any]]:
    # 2xx 인데 본문이 배열이 아니면(게이트웨이 HTML 등) JSONDecodeError 가 그대로
    # 새지 않게 같은 예외로 바꾼다. 본문은 싣지 않는다.
    try:
        body = response.json()
    except ValueError:
        body = None
    if not isinstance(body, list):
        raise SupabaseStoreError(
            f"GET {TABLE} failed: HTTP {response.status_code} (unexpected body)",
            status=response.status_code,
        )
    return body


def _parse_stamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None  # to_row 가 "" 를 NULL 로 적으므로 여기서도 null 로 본다
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError:
        return None
    # 시각대 없는 값은 UTC 로 본다 (세션 TZ 가 UTC 인 Postgres 와 같다).
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _fetch_order(doc: dict[str, Any]) -> tuple[Any, ...]:
    # 예전 서버 정렬 `booking_date, created_at, id` 를 그대로 흉내 낸다.
    # created_at 이 NULL 이면 Postgres asc 처럼 그 날짜의 맨 뒤로.
    stamp = _parse_stamp(doc.get("createdAt"))
    return (str(doc.get("date") or ""), stamp is None, stamp or _EPOCH, str(doc.get("id")))


def _fetch_rows(
    client: httpx.Client, filters: list[tuple[str, str]]
) -> list[dict[str, Any]]:
    """`filters` 에 맞는 행({id, doc})을 전부. 순서는 id 순 (정렬은 호출자가 한다)."""
    # 키셋 페이징: 바뀌지 않는 기본키 순으로 "마지막 id 다음" 을 묻는다. 예전의
    # limit/offset + 날짜 정렬은 페이지 사이에 다른 프로세스가 행을 지우거나 예약을 앞
    # 날짜로 옮기면 오프셋이 밀려, 내내 있던 행이 조용히 빠졌다. 그러면 mutate 의 before
    # 에서 그 예약이 사라져 정원(4명) 검사가 틀리고 초과 예약이 된다. 키셋이면 스캔 내내
    # 있던 행은 빠지지도 겹치지도 않는다.
    page_size = PAGE_SIZE  # 호출 시점의 모듈 값 (테스트가 작게 바꾼다)
    rows: list[dict[str, Any]] = []
    last_id: str | None = None
    while True:
        params = [("select", "id,doc"), ("order", "id.asc"), ("limit", str(page_size)), *filters]
        if last_id is not None:
            # in.(...) 과 달리 최상위 필터 값은 파라미터 끝까지가 한 값이다. 따옴표로
            # 감싸면 따옴표까지 값이 될 수 있으니 _quote 를 쓰지 않는다.
            # filters 에 `id=in.(...)` 가 있어도 따로 붙인다 — 둘은 AND 로 묶인다.
            params.append(("id", f"gt.{last_id}"))
        page = _page(_request(client, "GET", params=params))
        # 짧은 페이지가 아니라 빈 페이지에서 멈춘다. max-rows 가 PAGE_SIZE 보다 작으면
        # 서버가 자른 페이지도 짧아 보이기 때문이다. 대가는 읽기마다 GET 한 번 더.
        if not page:
            break
        rows.extend(page)
        last_id = str(page[-1]["id"])
    return rows


def _fetch_all(client: httpx.Client) -> list[dict[str, Any]]:
    docs = [row["doc"] for row in _fetch_rows(client, [])]
    docs.sort(key=_fetch_order)
    return docs


def _in_list(values: Iterable[str]) -> str:
    return "in.(" + ",".join(_quote(value) for value in values) + ")"


def _scope_queries(scope: Any) -> list[list[tuple[str, str]]]:
    """Scope 의 기준 하나당 필터 묶음 하나. 결과는 호출자가 id 로 합친다.

    OR 를 서버에 `or=(...)` 하나로 보내지 않는 이유: 기준마다 쓰는 인덱스가 다르다
    (booking_date / 기본키 / hold_expires_at 부분 인덱스). 따로 물으면 각각 인덱스를 탄다.
    """
    queries: list[list[tuple[str, str]]] = []
    # 날짜·id 목록은 URL 쿼리에 들어간다. 게이트웨이 URL 길이 제한 때문에 DELETE 와 같은
    # 크기로 자른다 (임포터는 날짜를 백 단위로 넘긴다).
    for chunk in _chunks(sorted(scope.dates), DELETE_CHUNK):
        queries.append([("booking_date", _in_list(chunk))])
    bounds: list[tuple[str, str]] = []
    if scope.date_from is not None:
        bounds.append(("booking_date", f"gte.{scope.date_from}"))
    if scope.date_to is not None:
        bounds.append(("booking_date", f"lte.{scope.date_to}"))
    if bounds:
        queries.append(bounds)
    for chunk in _chunks(sorted(scope.ids), DELETE_CHUNK):
        queries.append([("id", _in_list(chunk))])
    if scope.holds:
        # `hold_expires_at is not null` 부분 인덱스가 있다. 홀드는 늘 몇 건뿐이다.
        queries.append([("hold_expires_at", "not.is.null")])
    return queries


def _upsert(client: httpx.Client, docs: list[dict[str, Any]]) -> int:
    unique = list(_by_id(docs).values())
    if not unique:
        return 0
    synced_at = _iso_now()  # 한 번의 호출 = 한 시각
    rows = [to_row(doc, synced_at=synced_at) for doc in unique]
    for chunk in _chunks(rows, UPSERT_CHUNK):
        _request(
            client,
            "POST",
            params={"on_conflict": "id"},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=chunk,
        )
    return len(rows)


def _delete_ids(client: httpx.Client, ids: Iterable[str]) -> int:
    unique = list(dict.fromkeys(str(i) for i in ids))
    # 빈 목록으로 `id=in.()` 을 보내면 PostgREST 가 문법 오류를 낸다. 아예 부르지 않는다.
    for chunk in _chunks(unique, DELETE_CHUNK):
        _request(
            client,
            "DELETE",
            params={"id": "in.(" + ",".join(_quote(i) for i in chunk) + ")"},
            headers={"Prefer": "return=minimal"},
        )
    return len(unique)


def _apply_diff(
    client: httpx.Client, before: list[dict[str, Any]], after: list[dict[str, Any]]
) -> dict[str, int]:
    old = _by_id(before)
    new = _by_id(after)
    # 행이 아니라 doc 을 비교한다. 행에는 매번 달라지는 synced_at 이 있어서
    # 행끼리 비교하면 아무것도 안 바뀌어도 전부 다시 쓰게 된다.
    changed = [doc for doc_id, doc in new.items() if old.get(doc_id) != doc]
    removed = [doc_id for doc_id in old if doc_id not in new]
    # ⚠️ REST 로는 upsert 와 delete 가 한 트랜잭션이 아니다. 둘 사이에서 실패하면
    # 지워졌어야 할 행이 남는다 (다음 save/mutate 의 diff 가 다시 지운다).
    # 행 수백 개 규모에 2단계 커밋까지는 두지 않는다.
    upserted = _upsert(client, changed)
    deleted = _delete_ids(client, removed)
    return {"upserted": upserted, "deleted": deleted}


def fetch_all() -> list[dict[str, Any]]:
    """모든 예약 doc. 날짜 → 생성 시각 → id 순."""
    with _client() as client:
        return _fetch_all(client)


def fetch(scope: Any) -> list[dict[str, Any]]:
    """`tee_sheet_store.Scope` 에 드는 예약 doc. 순서는 fetch_all 과 같다.

    scope 는 dates / date_from / date_to / ids / holds 속성만 본다 (이 모듈은
    tee_sheet_store 를 임포트하지 않는다 — 순환을 만들지 않으려고).
    """
    queries = _scope_queries(scope)
    if not queries:
        return []  # 빈 범위. 요청을 보낼 것도, 설정을 확인할 것도 없다.
    found: dict[str, dict[str, Any]] = {}
    with _client() as client:
        for filters in queries:
            for row in _fetch_rows(client, filters):
                # 두 기준에 다 걸린 행(예: 그날의 홀드)은 한 번만. 기준 사이에 다른
                # writer 가 고쳤다면 나중에 읽은 쪽이 이긴다.
                found[str(row["id"])] = row["doc"]
    docs = list(found.values())
    docs.sort(key=_fetch_order)
    return docs


def count() -> int:
    """테이블의 행 수. 행을 내려받지 않는다 (`limit=0` + `count=exact`)."""
    with _client() as client:
        response = _request(
            client,
            "GET",
            params={"select": "id", "limit": "0"},
            headers={"Prefer": "count=exact"},
        )
    # "*/8412" 또는 "0-24/8412". 총계가 없으면 모른다고 터뜨린다 — 0 이나 -1 로
    # 대신하면 운영 화면의 예약 수가 조용히 틀린다.
    total = response.headers.get("content-range", "").rpartition("/")[2]
    if not total.isdigit():
        raise SupabaseStoreError(
            f"GET {TABLE} count failed: HTTP {response.status_code} (no exact count)",
            status=response.status_code,
        )
    return int(total)


def upsert(docs: list[dict[str, Any]]) -> int:
    """id 기준 upsert. 보낸 행 수를 돌려준다 (같은 id 는 한 번만 센다)."""
    with _client() as client:
        return _upsert(client, list(docs))


def delete_ids(ids: Iterable[str]) -> int:
    """주어진 id 들을 지운다. 요청한 (중복 제거된) id 수를 돌려준다."""
    with _client() as client:
        return _delete_ids(client, ids)


def delete_all() -> int:
    """테이블을 비운다. 지운 행 수를 알 수 없으면 -1."""
    with _client() as client:
        # PostgREST(+Supabase 의 pg-safeupdate)는 필터 없는 DELETE 를 거절한다.
        # id 는 primary key 라 never null → "모든 행" 과 같은 필터.
        response = _request(
            client,
            "DELETE",
            params={"id": "not.is.null"},
            headers={"Prefer": "return=minimal,count=exact"},
        )
    # count=exact 이면 Content-Range 가 "*/12" 또는 "0-11/12" 로 온다.
    total = response.headers.get("content-range", "").rpartition("/")[2]
    return int(total) if total.isdigit() else -1


def apply_diff(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> dict[str, int]:
    """before → after 로 가는 최소 쓰기. 새/바뀐 doc 을 upsert 하고, 사라진 id 를 지운다."""
    with _client() as client:
        return _apply_diff(client, list(before), list(after))


def replace_all(docs: list[dict[str, Any]]) -> dict[str, int]:
    """테이블을 `docs` 와 똑같이 만든다. `docs` 에 없는 행은 지운다."""
    with _client() as client:
        return _apply_diff(client, _fetch_all(client), list(docs))
