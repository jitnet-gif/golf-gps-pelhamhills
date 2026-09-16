"""`pelham_tee_bookings` 용 인메모리 PostgREST 대역.

테스트에서 실제 Supabase 로 나가는 요청이 한 건도 없게 하려고 쓴다
(공유 프로젝트라 다른 앱의 데이터가 같은 DB 에 있다).

    from backend.tests.fake_postgrest import install

    def test_something(monkeypatch):
        fake = install(monkeypatch)      # env + 전송 계층 주입, 테스트 끝나면 원복
        ...
        assert fake.requests[-1][0] == "DELETE"

일부러 **엄격하게** 만든다. 실제 PostgREST 가 거절하는 요청(필터 없는 DELETE,
키 집합이 다른 대량 upsert, 한 문장에 같은 id 두 번 등)은 여기서도 거절해야
저장 계층의 버그가 테스트에서 드러난다. 오류 응답의 `details` 에는 실제 Postgres
처럼 실패한 행 내용을 그대로 싣는다 — 저장 계층이 응답 본문을 예외 메시지로
흘리는지 검사하려면 본문에 흘릴 거리가 있어야 한다.
"""

from __future__ import annotations

import json
import operator
import sys
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import tee_sheet_supabase as sb  # noqa: E402

__all__ = ["FAKE_URL", "FAKE_KEY", "COLUMNS", "FakePostgrest", "install", "parse_in_list"]

FAKE_URL = "https://fake.supabase.test"
FAKE_KEY = "test-service-key"

# supabase/migrations/0002_tee_bookings.sql 의 컬럼 순서 그대로.
COLUMNS = (
    "id",
    "booking_date",
    "tee_time",
    "status",
    "source",
    "title",
    "hold_expires_at",
    "created_at",
    "updated_at",
    "doc",
    "synced_at",
)
_NOT_NULL = ("id", "booking_date", "doc", "synced_at")
_TIMESTAMPS = ("hold_expires_at", "created_at", "updated_at", "synced_at")
# 필터가 아닌 예약 쿼리 파라미터.
_RESERVED_PARAMS = {"select", "order", "limit", "offset", "on_conflict", "columns"}
_COMPARE = {"gt": operator.gt, "gte": operator.ge, "lt": operator.lt, "lte": operator.le}


class _Reject(Exception):
    """핸들러 안에서 PostgREST 오류 응답으로 바뀌는 예외."""

    def __init__(self, status: int, code: str, message: str, details: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def parse_in_list(text: str) -> list[str]:
    """PostgREST `in.(...)` 의 괄호 부분을 값 목록으로.

    `("a,b","c\\"d",e)` -> ['a,b', 'c"d', 'e']. 따옴표 안에서는 `\\` 가 다음 한
    글자를 그대로 넣는다. 따옴표 없는 값에 `" ( )` 가 섞이면 실제 PostgREST 처럼 거절한다.
    """
    if len(text) < 2 or text[0] != "(" or text[-1] != ")":
        raise ValueError("in-list must be wrapped in parentheses")
    inner = text[1:-1]
    if not inner:
        raise ValueError("empty in-list")
    values: list[str] = []
    i, n = 0, len(inner)
    while True:
        if i < n and inner[i] == '"':
            i += 1
            buf: list[str] = []
            while True:
                if i >= n:
                    raise ValueError("unterminated quoted value")
                ch = inner[i]
                if ch == "\\" and i + 1 < n:
                    buf.append(inner[i + 1])
                    i += 2
                    continue
                if ch == '"':
                    i += 1
                    break
                buf.append(ch)
                i += 1
            values.append("".join(buf))
        else:
            end = inner.find(",", i)
            end = n if end == -1 else end
            token = inner[i:end]
            if any(ch in token for ch in '"()'):
                raise ValueError("reserved character in unquoted value")
            values.append(token)
            i = end
        if i == n:
            return values
        if inner[i] != ",":
            raise ValueError("expected comma between values")
        i += 1
        if i == n:
            raise ValueError("trailing comma")


class FakePostgrest:
    """`/rest/v1/pelham_tee_bookings` 하나만 아는 PostgREST.

    - `.rows`: id -> 저장된 행 dict (보낸 행 그대로 + 빠진 컬럼은 None, synced_at 기본값)
    - `.requests`: (method, path, params) 목록. params 는 디코딩된 dict. 같은 이름이
      두 번 이상 오면(`booking_date=gte.X&booking_date=lte.Y`) 그 값은 순서대로 담은 list.
    - `.raw_requests`: httpx.Request 목록 (호스트·헤더까지 봐야 할 때)
    - `.content_range`: False 로 두면 count=exact 에도 Content-Range 를 안 보낸다 (GET·DELETE)
    - `.fail_next(status, code)`: 다음 요청 한 번을 그 오류로 실패시킨다
    """

    def __init__(self, table: str = sb.TABLE) -> None:
        self.table = table
        self.rows: dict[str, dict[str, Any]] = {}
        self.requests: list[tuple[str, str, dict[str, str]]] = []
        self.raw_requests: list[httpx.Request] = []
        self.content_range = True
        self._failures: list[tuple[int, str, str | None]] = []
        self.transport = httpx.MockTransport(self._handle)

    # ----- 테스트 편의 ------------------------------------------------

    def fail_next(self, status: int, code: str = "XX000", *, text: str | None = None) -> None:
        """다음 요청을 `status` 로 실패시킨다. `text` 를 주면 JSON 대신 그 본문을 보낸다
        (게이트웨이 HTML 같은 비 JSON 오류 흉내)."""
        self._failures.append((status, code, text))

    def seed(self, docs: list[dict[str, Any]]) -> None:
        """HTTP 를 거치지 않고 행을 심는다."""
        for doc in docs:
            row = sb.to_row(deepcopy(doc))
            self.rows[row["id"]] = row

    def docs(self) -> list[dict[str, Any]]:
        """저장된 doc 들을 fetch_all 과 같은 순서로."""
        ordered = self._order(list(self.rows.values()), "booking_date.asc,created_at.asc,id.asc")
        return [deepcopy(row["doc"]) for row in ordered]

    def calls(self, method: str) -> list[tuple[str, str, dict[str, str]]]:
        return [entry for entry in self.requests if entry[0] == method]

    def writes(self, since: int = 0) -> list[tuple[str, str, dict[str, Any]]]:
        """`since` 번째 요청 이후의 쓰기 요청 (POST/PATCH/DELETE)."""
        return [entry for entry in self.requests[since:] if entry[0] in ("POST", "PATCH", "DELETE")]

    def table_scans(self, since: int = 0) -> list[dict[str, Any]]:
        """`since` 이후 **필터 없이** 행을 읽은 GET 들의 파라미터.

        키셋 페이징의 `id=gt.<last>` 만 있는 GET 도 스캔이다 (테이블 전체를 훑는다).
        `limit=0` 인 count 는 행을 내려받지 않으므로 뺀다. "범위로 읽는다" 와 "범위로
        읽는 것처럼 보인다" 를 가르는 건 결국 이 요청 모양뿐이다.
        """
        scans: list[dict[str, Any]] = []
        for method, _, params in self.requests[since:]:
            if method != "GET" or params.get("limit") == "0":
                continue
            filters = {k: v for k, v in params.items() if k not in _RESERVED_PARAMS}
            keyset_only = set(filters) == {"id"} and isinstance(filters["id"], str) and filters["id"].startswith("gt.")
            if not filters or keyset_only:
                scans.append(params)
        return scans

    # ----- 핸들러 -----------------------------------------------------

    def _handle(self, request: httpx.Request) -> httpx.Response:
        # 필터는 (이름, 값) 쌍 목록으로 다룬다. dict 로 접으면 같은 컬럼에 건 두 번째
        # 필터가 앞의 것을 지워, 실제 PostgREST(반복 필터 = AND)보다 **느슨한** 가짜가 된다.
        items = list(request.url.params.multi_items())
        self.requests.append((request.method, request.url.path, _log_params(items)))
        self.raw_requests.append(request)
        # 예약 파라미터(select/limit/...)는 한 번만 의미가 있다. 반복되면 뒤의 것.
        params = dict(items)

        if self._failures:
            status, code, text = self._failures.pop(0)
            if text is not None:
                return httpx.Response(status, text=text)
            body = request.content.decode("utf-8", "replace")
            return _error(status, code, "injected failure", f"Failing row contains ({body}).")

        if not request.headers.get("apikey") or not request.headers.get("authorization"):
            return httpx.Response(
                401,
                json={
                    "message": "No API key found in request",
                    "hint": "No `apikey` request header or url param was found.",
                },
            )

        prefix = "/rest/v1/"
        path = request.url.path
        table = path[len(prefix):] if path.startswith(prefix) else path
        if table != self.table:
            return _error(404, "42P01", f'relation "public.{table}" does not exist')

        try:
            if request.method == "GET":
                return self._get(request, params, items)
            if request.method == "POST":
                return self._post(request, params)
            if request.method == "DELETE":
                return self._delete(request, params, items)
            return _error(405, "PGRST117", f"Unsupported HTTP method: {request.method}")
        except _Reject as reject:
            return _error(reject.status, reject.code, reject.message, reject.details)

    def _get(
        self, request: httpx.Request, params: dict[str, str], items: list[tuple[str, str]]
    ) -> httpx.Response:
        rows = self._filter(list(self.rows.values()), items)
        total = len(rows)  # count=exact 는 limit/offset 을 적용하기 **전** 의 수다
        rows = self._order(rows, params.get("order", ""))
        offset = _int_param(params, "offset", 0)
        limit = _int_param(params, "limit", None)
        rows = rows[offset:] if limit is None else rows[offset:offset + limit]
        columns = self._select(params.get("select", "*"))
        body = [{col: deepcopy(row.get(col)) for col in columns} for row in rows]
        counted = "count=exact" in _prefer(request)
        suffix = str(total) if counted else "*"
        headers = {"Content-Range": f"{offset}-{offset + len(body) - 1}/{suffix}" if body else f"*/{suffix}"}
        if counted and not self.content_range:
            headers = {}
        # 실제 PostgREST 는 총계를 알고 일부만 돌려줄 때 206 을 쓴다.
        status = 206 if counted and len(body) < total else 200
        return httpx.Response(status, json=body, headers=headers)

    def _post(self, request: httpx.Request, params: dict[str, str]) -> httpx.Response:
        try:
            payload = json.loads(request.content or b"null")
        except ValueError:
            raise _Reject(400, "PGRST102", "Empty or invalid json") from None
        rows = [payload] if isinstance(payload, dict) else payload
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
            raise _Reject(400, "PGRST102", "Empty or invalid json")
        if len({frozenset(r) for r in rows}) > 1:
            raise _Reject(400, "PGRST102", "All object keys must match")

        conflict = params.get("on_conflict")
        if conflict is not None and conflict != "id":
            raise _Reject(
                400,
                "42P10",
                "there is no unique or exclusion constraint matching the ON CONFLICT specification",
            )
        prefer = _prefer(request)
        merge = "resolution=merge-duplicates" in prefer
        ignore = "resolution=ignore-duplicates" in prefer

        # 먼저 전부 검증하고, 통과해야 쓴다 (한 요청 = 한 트랜잭션).
        now = datetime.now(timezone.utc).isoformat()
        staged: list[dict[str, Any]] = []
        seen: set[str] = set()
        for sent in rows:
            unknown = [col for col in sent if col not in COLUMNS]
            if unknown:
                raise _Reject(
                    400,
                    "PGRST204",
                    f"Could not find the '{unknown[0]}' column of '{self.table}' in the schema cache",
                )
            row = {col: None for col in COLUMNS}
            row["synced_at"] = now
            row.update(deepcopy(sent))
            _validate(row)
            row_id = str(row["id"])
            if row_id in seen:
                if merge:
                    raise _Reject(
                        400,
                        "21000",
                        "ON CONFLICT DO UPDATE command cannot affect row a second time",
                        _failing_row(row),
                    )
                raise _Reject(409, "23505", _pkey_message(self.table), f"Key (id)=({row_id}) already exists.")
            seen.add(row_id)
            if row_id in self.rows and not (merge or ignore):
                raise _Reject(409, "23505", _pkey_message(self.table), f"Key (id)=({row_id}) already exists.")
            staged.append(row)

        written: list[dict[str, Any]] = []
        for row in staged:
            row_id = str(row["id"])
            if row_id in self.rows:
                if ignore:
                    continue
                # merge-duplicates 는 보낸 컬럼만 덮어쓴다.
                merged = self.rows[row_id]
                merged.update({col: row[col] for col in rows[0]})
                if "synced_at" not in rows[0]:
                    merged["synced_at"] = now
                written.append(merged)
            else:
                self.rows[row_id] = row
                written.append(row)

        if "return=representation" in prefer:
            return httpx.Response(201, json=deepcopy(written))
        return httpx.Response(201)

    def _delete(
        self, request: httpx.Request, params: dict[str, str], items: list[tuple[str, str]]
    ) -> httpx.Response:
        if not any(key not in _RESERVED_PARAMS for key in params):
            # Supabase 는 pg-safeupdate 를 켜 두어서 WHERE 없는 DELETE 를 거절한다.
            raise _Reject(400, "21000", "DELETE requires a WHERE clause")
        doomed = self._filter(list(self.rows.values()), items)
        for row in doomed:
            del self.rows[str(row["id"])]
        prefer = _prefer(request)
        headers = {}
        if "count=exact" in prefer and self.content_range:
            headers["Content-Range"] = f"*/{len(doomed)}"
        if "return=representation" in prefer:
            return httpx.Response(200, json=deepcopy(doomed), headers=headers)
        return httpx.Response(204, headers=headers)

    # ----- PostgREST 문법 --------------------------------------------

    def _select(self, select: str) -> list[str]:
        if select.strip() == "*":
            return list(COLUMNS)
        columns = [col.strip() for col in select.split(",") if col.strip()]
        for col in columns:
            if col not in COLUMNS:
                raise _Reject(400, "42703", f"column {self.table}.{col} does not exist")
        return columns

    def _filter(
        self, rows: list[dict[str, Any]], items: list[tuple[str, str]]
    ) -> list[dict[str, Any]]:
        # 반복된 필터는 차례로 걸러 AND 가 된다 (실제 PostgREST 와 같다).
        for key, raw in items:
            if key in _RESERVED_PARAMS:
                continue
            if key not in COLUMNS:
                raise _Reject(400, "42703", f"column {self.table}.{key} does not exist")
            negate = raw.startswith("not.")
            expr = raw[4:] if negate else raw
            op, _, arg = expr.partition(".")
            test = _predicate(op, arg)
            rows = [row for row in rows if test(row.get(key)) != negate]
        return rows

    def _order(self, rows: list[dict[str, Any]], order: str) -> list[dict[str, Any]]:
        terms = [term.strip() for term in order.split(",") if term.strip()]
        # 뒤 키부터 안정 정렬을 겹쳐 쌓으면 다중 키 정렬이 된다.
        for term in reversed(terms):
            col, *mods = term.split(".")
            if col not in COLUMNS:
                raise _Reject(400, "42703", f"column {self.table}.{col} does not exist")
            desc = "desc" in mods
            nulls_first = "nullsfirst" in mods or (desc and "nullslast" not in mods)
            present = [row for row in rows if row.get(col) is not None]
            missing = [row for row in rows if row.get(col) is None]
            present.sort(key=lambda row: _sort_value(col, row[col]), reverse=desc)
            rows = missing + present if nulls_first else present + missing
        return rows


# ===== 도우미 ==========================================================


def _error(status: int, code: str, message: str, details: str | None = None) -> httpx.Response:
    return httpx.Response(
        status, json={"code": code, "details": details, "hint": None, "message": message}
    )


def _log_params(items: list[tuple[str, str]]) -> dict[str, Any]:
    """`.requests` 에 남길 파라미터. 한 번 온 이름은 str, 반복된 이름은 순서대로 list."""
    logged: dict[str, Any] = {}
    for key, value in items:
        if key not in logged:
            logged[key] = value
        elif isinstance(logged[key], list):
            logged[key].append(value)
        else:
            logged[key] = [logged[key], value]
    return logged


def _prefer(request: httpx.Request) -> set[str]:
    raw = ",".join(request.headers.get_list("prefer"))
    return {token.strip() for token in raw.split(",") if token.strip()}


def _int_param(params: dict[str, str], name: str, default: int | None) -> int | None:
    if name not in params:
        return default
    try:
        value = int(params[name])
    except ValueError:
        raise _Reject(400, "PGRST100", f"invalid {name}") from None
    if value < 0:
        raise _Reject(400, "PGRST100", f"invalid {name}")
    return value


def _predicate(op: str, arg: str):
    if op == "eq":
        return lambda value: value is not None and str(value) == arg
    if op == "neq":
        return lambda value: value is not None and str(value) != arg
    if op == "is":
        if arg == "null":
            return lambda value: value is None
        if arg in ("true", "false"):
            return lambda value: value is (arg == "true")
    if op in _COMPARE:
        # 키셋 페이징(`id=gt.<마지막 id>`)용. `_sort_value` 가 id 같은 비시각 컬럼을
        # str 로 정렬하므로 비교도 str 로 해야 order 와 필터가 어긋나지 않는다.
        compare = _COMPARE[op]
        return lambda value: value is not None and compare(str(value), arg)
    if op == "in":
        try:
            wanted = set(parse_in_list(arg))
        except ValueError as exc:
            raise _Reject(400, "PGRST100", f"failed to parse filter in.{arg}", str(exc)) from None
        return lambda value: value is not None and str(value) in wanted
    raise _Reject(400, "PGRST100", f"failed to parse filter {op}.{arg}")


def _sort_value(col: str, value: Any) -> Any:
    if col in _TIMESTAMPS:
        # 시각대 없는 값은 UTC 로 본다 (세션 TZ 가 UTC 인 Postgres 와 같다).
        # 섞여 있으면 aware/naive 비교가 TypeError 로 핸들러를 죽인다.
        stamp = datetime.fromisoformat(str(value))
        return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)
    return str(value)


def _failing_row(row: dict[str, Any]) -> str:
    # 실제 Postgres 처럼 행의 값을 그대로 늘어놓는다 (PII 가 여기 섞인다).
    return "Failing row contains (" + ", ".join(json.dumps(row.get(c), ensure_ascii=False) for c in COLUMNS) + ")."


def _pkey_message(table: str) -> str:
    return f'duplicate key value violates unique constraint "{table}_pkey"'


def _validate(row: dict[str, Any]) -> None:
    for col in _NOT_NULL:
        if row.get(col) is None:
            raise _Reject(
                400,
                "23502",
                f'null value in column "{col}" of relation "{sb.TABLE}" violates not-null constraint',
                _failing_row(row),
            )
    if not isinstance(row["id"], str):
        raise _Reject(400, "22P02", "invalid input syntax for type text")
    try:
        date.fromisoformat(str(row["booking_date"]))
    except ValueError:
        raise _Reject(
            400, "22007", f'invalid input syntax for type date: "{row["booking_date"]}"'
        ) from None
    for col in _TIMESTAMPS:
        value = row.get(col)
        if value is None:
            continue
        try:
            datetime.fromisoformat(str(value))
        except ValueError:
            raise _Reject(
                400, "22007", f'invalid input syntax for type timestamp with time zone: "{value}"'
            ) from None


def install(monkeypatch) -> FakePostgrest:
    """가짜 PostgREST 를 깔고 supabase 백엔드로 전환한다. 테스트가 끝나면 원복된다.

    env 를 전부 채워 두므로 `tee_sheet_supabase` 는 `backend.core.config` 의 settings
    (= 실제 `.env`) 로 넘어가지 않는다.
    """
    fake = FakePostgrest()
    monkeypatch.setenv("SUPABASE_URL", FAKE_URL)
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", FAKE_URL)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", FAKE_KEY)
    monkeypatch.setenv("TEE_SHEET_BACKEND", "supabase")
    # monkeypatch 에는 임의 finalizer 를 거는 API 가 없다. `_transport` 를 먼저
    # monkeypatch 로 잡아 두면 undo 때 원래 값(평소 None)으로 돌아간다
    # → 테스트 끝에 set_transport(None) 한 것과 같다.
    monkeypatch.setattr(sb, "_transport", None)
    sb.set_transport(fake.transport)
    return fake
