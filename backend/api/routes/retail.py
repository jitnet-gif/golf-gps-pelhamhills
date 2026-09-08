"""프로 샵 리테일(POS) API.

와이어 계약: `frontend/lib/retail/types.ts` (frozen). 어드민 화면이 그 파일만
보고 이 라우터와 **동시에** 만들어지므로, 여기 나오는 키 이름은 곧 그쪽
타입의 필드 이름이다. 하나만 바꿔도 조용히 `undefined` 가 흐른다.

영속화는 `backend/services/retail_store.py` (JSON 파일 + RLock + 원자적 쓰기).
`simulator.py` / `tee_sheet.py` 와 같은 길이다.

금액 규약
--------
**모든 금액은 센트 단위 정수다.** 달러를 float 로 다루면 19.99 + 0.07 같은
계산이 0.01 씩 어긋나고, 하루치를 합산한 마감 리포트에서 그 오차가 눈에 보인다.
float 가 등장하는 유일한 지점은 세금 한 줄이고, 거기서 즉시 `round()` 로
정수로 되돌린다.

    line_total = quantity * unit_price - discount     (줄 할인)
    subtotal   = sum(line_total)
    tax        = round((subtotal - discount) * 0.13)  (주문 할인 후, 온타리오 HST)
    total      = subtotal - discount + tax

마감 리포트의 금액 정의 (`types.ts` 가 정하지 않은 부분 — 여기가 기준이다)
--------------------------------------------------------------------
환불되지 않은 그 날짜의 매출만 대상으로:

    gross = Σ subtotal        (줄 할인은 이미 반영, 주문 할인·세금 전)
    discount = Σ 주문 할인
    tax = Σ tax
    net = Σ total = gross - discount + tax   ← **세금 포함** 금액

`net` 이 세금 포함이므로 `refunded_total` 도 같은 기준(Σ total)이다.
다섯 금액 필드를 세전/세후로 섞지 않는 것이 핵심이다. 화면이 이 항등식
`net == gross - discount + tax` 를 그대로 검산할 수 있어야 한다.
"""

from __future__ import annotations

import logging
import re
from datetime import date as date_cls, datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from backend.services import retail_store as store

logger = logging.getLogger(__name__)
router = APIRouter()


# ===== 영업 규칙 / 열거형 =============================================

# `types.ts` 의 RETAIL_CATEGORIES 와 순서까지 같아야 한다 (리포트 정렬이 이걸 쓴다).
RETAIL_CATEGORIES = (
    "Apparel",
    "Equipment",
    "Balls",
    "Accessories",
    "Food & Beverage",
    "Rentals",
)
RetailCategory = Literal[
    "Apparel",
    "Equipment",
    "Balls",
    "Accessories",
    "Food & Beverage",
    "Rentals",
]

PAYMENT_METHODS = ("cash", "card", "member_account", "gift_card")
PaymentMethod = Literal["cash", "card", "member_account", "gift_card"]

# 온타리오 HST. `types.ts` 의 TAX_RATE 와 같은 값이어야 화면 미리보기와
# 영수증이 어긋나지 않는다.
TAX_RATE = 0.13

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TOP_PRODUCT_LIMIT = 5


# ===== 모델 ===========================================================


class ProductCreate(BaseModel):
    """상품 생성 입력. id/타임스탬프는 서버가 붙인다.

    `stock` 의 기본값은 `None`(재고 추적 안 함)이다. 0 을 기본으로 두면 새로
    등록한 상품이 전부 즉시 저재고 목록에 올라와 목록이 쓸모없어진다.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    category: RetailCategory
    price: int = Field(ge=0)
    cost: int = Field(default=0, ge=0)
    stock: Optional[int] = Field(default=None, ge=0)
    reorder_point: int = Field(default=0, ge=0)
    is_active: bool = True


class ProductUpdate(BaseModel):
    """부분 수정. **보낸 필드만** 바뀐다.

    `exclude_unset` 으로 "안 보냄" 과 "null 로 보냄" 을 구분한다. 이게 없으면
    가격만 고치려던 PATCH 가 `stock` 을 null 로 밀어버린다.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    sku: Optional[str] = Field(default=None, min_length=1, max_length=64)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[RetailCategory] = None
    price: Optional[int] = Field(default=None, ge=0)
    cost: Optional[int] = Field(default=None, ge=0)
    stock: Optional[int] = Field(default=None, ge=0)
    reorder_point: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class Product(BaseModel):
    id: int
    sku: str
    name: str
    category: RetailCategory
    price: int
    cost: int
    stock: Optional[int]
    reorder_point: int
    is_active: bool
    created_at: str
    updated_at: str


class SaleLineIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=1)
    discount: int = Field(default=0, ge=0)


class SaleCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    lines: list[SaleLineIn] = Field(min_length=1)
    discount: int = Field(default=0, ge=0)
    payment_method: PaymentMethod
    cashier: Optional[str] = None
    note: Optional[str] = None
    business_date: Optional[str] = None


class SaleLine(BaseModel):
    product_id: int
    sku: str
    name: str
    quantity: int
    unit_price: int
    discount: int
    line_total: int


class Sale(BaseModel):
    id: int
    receipt_no: str
    business_date: str
    lines: list[SaleLine]
    subtotal: int
    discount: int
    tax: int
    total: int
    payment_method: PaymentMethod
    cashier: Optional[str]
    note: Optional[str]
    refunded_at: Optional[str]
    refund_reason: Optional[str]
    created_at: str


class RefundRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    reason: str = Field(min_length=1, max_length=500)


class PaymentBreakdown(BaseModel):
    method: PaymentMethod
    count: int
    total: int


class CategoryBreakdown(BaseModel):
    category: RetailCategory
    quantity: int
    total: int


class TopProduct(BaseModel):
    product_id: int
    name: str
    quantity: int
    total: int


class RetailDailyReport(BaseModel):
    business_date: str
    sale_count: int
    gross: int
    discount: int
    tax: int
    net: int
    refunded_count: int
    refunded_total: int
    by_payment: list[PaymentBreakdown]
    by_category: list[CategoryBreakdown]
    top_products: list[TopProduct]


class LowStockItem(BaseModel):
    product_id: int
    sku: str
    name: str
    category: RetailCategory
    stock: int
    reorder_point: int


# ===== 작은 헬퍼 ======================================================


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    """매장 현지 날짜. 타임스탬프는 UTC 지만 `business_date` 는 현지 날짜다 —
    밤 9시에 판 물건이 다음 날 마감에 잡히면 대사가 맞지 않는다."""
    return date_cls.today().isoformat()


def _parse_business_date(value: str, field: str = "business_date") -> str:
    """`YYYY-MM-DD` 를 검증하고 정규화한다.

    `strptime` 은 `2026-9-8` 처럼 0 이 안 붙은 날짜도 받아준다. 원본 문자열을
    그대로 저장하면 `2026-09-08` 로 조회하는 마감 리포트가 그 매출을 통째로
    놓친다 (시뮬레이터에서 실제로 겪은 함정과 같은 것).
    """
    try:
        parsed = datetime.strptime(str(value), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400, detail=f"Invalid {field}. Use YYYY-MM-DD"
        )
    return parsed.isoformat()


def _find_product(products: list[dict[str, Any]], product_id: int) -> Optional[dict[str, Any]]:
    return next((p for p in products if int(p.get("id", 0)) == product_id), None)


def _sku_key(sku: str) -> str:
    """SKU 중복 판정은 대소문자를 무시한다. `pv1-dz` 와 `PV1-DZ` 는 같은 물건이다."""
    return str(sku).strip().casefold()


def _next_receipt_no(sales: list[dict[str, Any]], business_date: str) -> str:
    """`PH-YYYYMMDD-NNNN`. 날짜 부분은 `created_at` 이 아니라 `business_date` 다.

    소급 입력한 매출이 오늘 날짜 접두사를 달면 영수증 번호로 그 날 장부를
    찾을 수 없게 된다. 일련번호도 "그 날 매출 개수 + 1" 이 아니라 "그 날 최대
    번호 + 1" 이다 — 개수로 세면 매출을 하나라도 지웠을 때 번호가 충돌한다.
    """
    prefix = f"PH-{business_date.replace('-', '')}-"
    highest = 0
    for sale in sales:
        receipt_no = str(sale.get("receipt_no", ""))
        if not receipt_no.startswith(prefix):
            continue
        suffix = receipt_no[len(prefix):]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"{prefix}{highest + 1:04d}"


# ===== 상품 ===========================================================


@router.get("/retail/products", response_model=list[Product])
def list_products(
    category: Optional[RetailCategory] = Query(None),
    q: Optional[str] = Query(None, description="이름/SKU 부분일치 (대소문자 무시)"),
    active: Optional[bool] = Query(None),
):
    """상품 목록. 필터가 없으면 비활성 상품까지 전부 돌려준다.

    기본을 "활성만" 으로 두지 않는 이유: 어드민 상품 관리 화면이 비활성 상품을
    다시 켜려면 목록에서 볼 수 있어야 한다. 판매 화면은 `active=true` 를 붙인다.
    """
    products = store.load()["products"]

    if category is not None:
        products = [p for p in products if p.get("category") == category]
    if active is not None:
        products = [p for p in products if bool(p.get("is_active", True)) is active]
    if q:
        needle = q.strip().casefold()
        products = [
            p
            for p in products
            if needle in str(p.get("name", "")).casefold()
            or needle in str(p.get("sku", "")).casefold()
        ]

    return sorted(products, key=lambda p: int(p.get("id", 0)))


@router.post("/retail/products", response_model=Product, status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductCreate):
    """상품 등록. SKU 가 이미 있으면 409."""
    with store.mutate() as data:
        wanted = _sku_key(payload.sku)
        if any(_sku_key(p.get("sku", "")) == wanted for p in data["products"]):
            raise HTTPException(
                status_code=409, detail=f"SKU already exists: {payload.sku}"
            )

        now = _iso_now()
        record = {
            "id": store.next_product_id(data["products"]),
            "sku": payload.sku,
            "name": payload.name,
            "category": payload.category,
            "price": payload.price,
            "cost": payload.cost,
            "stock": payload.stock,
            "reorder_point": payload.reorder_point,
            "is_active": payload.is_active,
            "created_at": now,
            "updated_at": now,
        }
        data["products"].append(record)

    return record


@router.patch("/retail/products/{product_id}", response_model=Product)
def update_product(product_id: int, payload: ProductUpdate):
    """부분 수정. 보낸 필드만 바뀐다."""
    changes = payload.model_dump(exclude_unset=True)

    with store.mutate() as data:
        record = _find_product(data["products"], product_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Product not found")

        if "sku" in changes:
            wanted = _sku_key(changes["sku"])
            clash = any(
                _sku_key(p.get("sku", "")) == wanted and int(p.get("id", 0)) != product_id
                for p in data["products"]
            )
            if clash:
                raise HTTPException(
                    status_code=409, detail=f"SKU already exists: {changes['sku']}"
                )

        record.update(changes)
        record["updated_at"] = _iso_now()
        updated = dict(record)

    return updated


@router.delete("/retail/products/{product_id}", response_model=Product)
def deactivate_product(product_id: int):
    """상품 "삭제".

    **레코드를 실제로 지우지 않는다.** 지난 매출의 각 줄이 `product_id` 로 이
    상품을 가리키고 있어서, 행을 지우면 지난달 영수증을 다시 열 때 카테고리
    집계와 저재고 목록이 사라진 id 를 참조하게 된다 (마감 리포트의
    `by_category` 가 조용히 비는 형태로 나타난다). 그래서 `is_active=false`
    로만 내린다 — `types.ts` 의 `is_active` 주석이 말하는 그 규칙이다.
    되살리려면 `PATCH {"is_active": true}`.

    200 + 비활성화된 상품을 돌려준다. 204(빈 본문)로 하지 않은 이유는 화면이
    "무슨 일이 일어났는지" 를 응답만 보고 알 수 있어야 하기 때문이다.
    """
    with store.mutate() as data:
        record = _find_product(data["products"], product_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Product not found")
        record["is_active"] = False
        record["updated_at"] = _iso_now()
        updated = dict(record)

    return updated


# ===== 판매 ===========================================================


@router.post("/retail/sales", response_model=Sale, status_code=status.HTTP_201_CREATED)
def create_sale(payload: SaleCreate):
    """계산. 금액 계산과 재고 차감은 **전부 서버가** 한다.

    프론트가 보낸 금액은 쓰지 않는다 (계산기 화면이 보여준 값과 영수증이
    어긋나면 안 되므로, 진실은 한 곳에만 둔다).

    재고 확인 → 차감 → 채번 → 기록을 한 락 안에서 끝낸다. `mutate()` 는 예외가
    나면 저장하지 않으므로, 세 번째 줄에서 재고가 모자라면 앞의 두 줄도
    차감되지 않는다.
    """
    business_date = (
        _parse_business_date(payload.business_date)
        if payload.business_date
        else _today()
    )

    with store.mutate() as data:
        products = data["products"]

        # 1) 없는 상품 / 비활성 상품. 한 줄씩 400 을 뱉지 않고 전부 모아서 알려준다.
        missing: list[int] = []
        inactive: list[str] = []
        for line in payload.lines:
            product = _find_product(products, line.product_id)
            if product is None:
                if line.product_id not in missing:
                    missing.append(line.product_id)
            elif not product.get("is_active", True):
                label = f"{product.get('sku')} ({product.get('name')})"
                if label not in inactive:
                    inactive.append(label)
        if missing:
            raise HTTPException(
                status_code=400,
                detail="Unknown product(s): " + ", ".join(str(pid) for pid in missing),
            )
        if inactive:
            raise HTTPException(
                status_code=400,
                detail="Product(s) not available for sale: " + ", ".join(inactive),
            )

        # 2) 줄 만들기 + 줄 할인 검증.
        lines: list[dict[str, Any]] = []
        for line in payload.lines:
            product = _find_product(products, line.product_id)
            assert product is not None  # 1) 에서 걸러졌다
            unit_price = int(product["price"])
            gross_line = line.quantity * unit_price
            if line.discount > gross_line:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Line discount exceeds the line total for {product['name']}: "
                        f"{line.discount} > {gross_line}"
                    ),
                )
            lines.append(
                {
                    "product_id": int(product["id"]),
                    # 이름/단가는 **판매 시점 값을 복사**한다. product_id 만 두면
                    # 나중에 가격을 올렸을 때 지난달 영수증 금액까지 같이 바뀐다.
                    "sku": product["sku"],
                    "name": product["name"],
                    "quantity": line.quantity,
                    "unit_price": unit_price,
                    "discount": line.discount,
                    "line_total": gross_line - line.discount,
                }
            )

        # 3) 재고. 같은 상품이 여러 줄에 나눠 담길 수 있으므로(바코드를 두 번 찍는
        #    경우) 줄별로 보지 말고 **상품별로 합산한 뒤** 확인한다. 줄마다
        #    검사하면 재고 5개에 3+3 이 통과해 버린다.
        needed: dict[int, int] = {}
        for line in lines:
            needed[line["product_id"]] = needed.get(line["product_id"], 0) + line["quantity"]

        shortages: list[str] = []
        for product_id, quantity in needed.items():
            product = _find_product(products, product_id)
            assert product is not None
            stock = product.get("stock")
            if stock is None:
                continue  # 렌탈 등 재고 개념이 없는 품목은 차감하지 않는다.
            if int(stock) < quantity:
                shortages.append(
                    f"{product['name']} (need {quantity}, {int(stock)} on hand, "
                    f"short {quantity - int(stock)})"
                )
        if shortages:
            raise HTTPException(
                status_code=400, detail="Not enough stock: " + "; ".join(shortages)
            )

        # 4) 금액. 전부 정수. float 는 세금 한 줄에서만 나타났다 사라진다.
        subtotal = sum(line["line_total"] for line in lines)
        if payload.discount > subtotal:
            raise HTTPException(
                status_code=400,
                detail=f"Order discount exceeds the subtotal: {payload.discount} > {subtotal}",
            )
        taxable = subtotal - payload.discount
        # 반올림은 여기 **한 번뿐**이다. 줄마다 세금을 매겨 더하면 하루치에서
        # 몇 센트가 샌다.
        # 주의(프론트가 맞춰야 함): 파이썬 `round()` 는 은행가 반올림이고
        # JS `Math.round` 는 half-up 이다. `taxable % 200 == 50` 인 금액
        # (50, 250, 450, ... 센트)에서 두 값이 1센트 어긋난다.
        # 예) taxable 850 → 파이썬 110, Math.round 111.
        # 진실은 서버가 돌려준 `tax`/`total` 이다.
        tax = round(taxable * TAX_RATE)
        total = taxable + tax

        # 5) 차감 + 기록.
        for product_id, quantity in needed.items():
            product = _find_product(products, product_id)
            assert product is not None
            if product.get("stock") is not None:
                product["stock"] = int(product["stock"]) - quantity
                product["updated_at"] = _iso_now()

        record = {
            "id": store.next_sale_id(data["sales"]),
            "receipt_no": _next_receipt_no(data["sales"], business_date),
            "business_date": business_date,
            "lines": lines,
            "subtotal": subtotal,
            "discount": payload.discount,
            "tax": tax,
            "total": total,
            "payment_method": payload.payment_method,
            "cashier": payload.cashier or None,
            "note": payload.note or None,
            "refunded_at": None,
            "refund_reason": None,
            "created_at": _iso_now(),
        }
        data["sales"].append(record)

    return record


@router.get("/retail/sales", response_model=list[Sale])
def list_sales(
    business_date: Optional[str] = Query(None),
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
):
    """매출 목록. 최신순.

    `business_date` 하루치, 또는 `from`/`to` 범위 (양끝 포함). 둘 다 없으면 전부.
    `from` 은 파이썬 예약어라 파라미터 이름은 `from_`, 와이어 이름은 alias 로
    `from` 을 유지한다.
    """
    sales = store.load()["sales"]

    if business_date:
        wanted = _parse_business_date(business_date)
        sales = [s for s in sales if s.get("business_date") == wanted]
    else:
        if from_:
            start = _parse_business_date(from_, "from")
            sales = [s for s in sales if str(s.get("business_date", "")) >= start]
        if to:
            end = _parse_business_date(to, "to")
            sales = [s for s in sales if str(s.get("business_date", "")) <= end]

    # ISO 날짜는 문자열 정렬이 곧 날짜 정렬이다. id 는 단조 증가하므로 같은
    # 날짜 안에서는 나중에 들어온 매출이 먼저 온다.
    return sorted(
        sales,
        key=lambda s: (str(s.get("business_date", "")), int(s.get("id", 0))),
        reverse=True,
    )


@router.get("/retail/sales/{sale_id}", response_model=Sale)
def get_sale(sale_id: int):
    sale = next(
        (s for s in store.load()["sales"] if int(s.get("id", 0)) == sale_id), None
    )
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale not found")
    return sale


@router.post("/retail/sales/{sale_id}/refund", response_model=Sale)
def refund_sale(sale_id: int, payload: RefundRequest):
    """환불.

    **매출을 지우지 않는다.** `refunded_at` / `refund_reason` 만 채운다 —
    지워 버리면 영수증 번호에 구멍이 생기고, 그 날 마감 대사가 "왜 3번이
    없지" 로 끝난다. 리포트는 이 표시를 보고 `net` 에서 뺀다.

    재고는 되돌린다. 판매 당시 `stock` 이 null 이었더라도 **지금** null 이 아닌
    상품은 되돌려 놓는다 — `SaleLine` 은 계약상 판매 당시 재고 여부를 담지
    않으므로, 현재 재고 장부 기준으로 맞추는 쪽이 실물과 덜 어긋난다.
    (알려진 엣지: 판매 뒤에 재고 추적을 켠 상품은 팔지 않은 1개를 얻는다.)
    """
    with store.mutate() as data:
        sale = next((s for s in data["sales"] if int(s.get("id", 0)) == sale_id), None)
        if sale is None:
            raise HTTPException(status_code=404, detail="Sale not found")
        if sale.get("refunded_at"):
            raise HTTPException(
                status_code=409,
                detail=f"Sale {sale.get('receipt_no')} was already refunded",
            )

        now = _iso_now()
        for line in sale.get("lines", []):
            product = _find_product(data["products"], int(line.get("product_id", 0)))
            if product is None or product.get("stock") is None:
                continue
            product["stock"] = int(product["stock"]) + int(line.get("quantity", 0))
            product["updated_at"] = now

        sale["refunded_at"] = now
        sale["refund_reason"] = payload.reason
        refunded = dict(sale)

    return refunded


# ===== 리포트 / 재고 ==================================================


@router.get("/retail/reports/daily", response_model=RetailDailyReport)
def daily_report(business_date: str = Query(...)):
    """일 마감 리포트.

    환불된 매출은 `gross`/`discount`/`tax`/`net` 과 `by_payment`/`by_category`/
    `top_products` 에서 **전부 제외**하고 `refunded_count`/`refunded_total` 로만
    센다. 세워 둔 항등식: `net == gross - discount + tax` (모듈 docstring 참고).
    """
    wanted = _parse_business_date(business_date)
    data = store.load()
    category_by_product = {
        int(p.get("id", 0)): p.get("category") for p in data["products"]
    }

    day = [s for s in data["sales"] if s.get("business_date") == wanted]
    live = [s for s in day if not s.get("refunded_at")]
    refunded = [s for s in day if s.get("refunded_at")]

    gross = sum(int(s.get("subtotal", 0)) for s in live)
    discount = sum(int(s.get("discount", 0)) for s in live)
    tax = sum(int(s.get("tax", 0)) for s in live)
    net = sum(int(s.get("total", 0)) for s in live)

    payments: dict[str, dict[str, int]] = {}
    for sale in live:
        method = str(sale.get("payment_method", ""))
        bucket = payments.setdefault(method, {"count": 0, "total": 0})
        bucket["count"] += 1
        bucket["total"] += int(sale.get("total", 0))

    categories: dict[str, dict[str, int]] = {}
    products: dict[int, dict[str, Any]] = {}
    for sale in live:
        for line in sale.get("lines", []):
            product_id = int(line.get("product_id", 0))
            quantity = int(line.get("quantity", 0))
            line_total = int(line.get("line_total", 0))

            category = category_by_product.get(product_id)
            # 상품 레코드는 지우지 않으므로(위 DELETE 주석 참고) 보통은 항상 찾힌다.
            # 손으로 파일을 건드린 경우에만 None 이 되고, 그때는 카테고리 집계에서만 빠진다.
            if category is not None:
                bucket = categories.setdefault(category, {"quantity": 0, "total": 0})
                bucket["quantity"] += quantity
                bucket["total"] += line_total

            entry = products.setdefault(
                product_id,
                {"product_id": product_id, "name": line.get("name", ""), "quantity": 0, "total": 0},
            )
            entry["quantity"] += quantity
            entry["total"] += line_total

    return {
        "business_date": wanted,
        "sale_count": len(live),
        "gross": gross,
        "discount": discount,
        "tax": tax,
        "net": net,
        "refunded_count": len(refunded),
        "refunded_total": sum(int(s.get("total", 0)) for s in refunded),
        # 실제로 쓰인 결제수단만, `types.ts` 의 선언 순서대로.
        "by_payment": [
            {"method": method, "count": payments[method]["count"], "total": payments[method]["total"]}
            for method in PAYMENT_METHODS
            if method in payments
        ],
        "by_category": [
            {
                "category": category,
                "quantity": categories[category]["quantity"],
                "total": categories[category]["total"],
            }
            for category in RETAIL_CATEGORIES
            if category in categories
        ],
        # 수량 기준 상위 5개. 동점이면 매출액이 큰 쪽, 그래도 같으면 id 순 —
        # 정렬이 흔들리면 화면이 새로고침할 때마다 순서가 바뀐다.
        "top_products": sorted(
            products.values(),
            key=lambda item: (-item["quantity"], -item["total"], item["product_id"]),
        )[:TOP_PRODUCT_LIMIT],
    }


@router.get("/retail/inventory/low-stock", response_model=list[LowStockItem])
def low_stock(threshold: Optional[int] = Query(None, ge=0)):
    """발주가 필요한 품목.

    기본 기준은 상품별 `reorder_point` 이고, `threshold` 가 오면 그 값이 우선한다
    ("일단 5개 이하만 보여줘").

    `stock` 이 null 인 품목(렌탈)은 제외한다 — 재고 개념이 없는 것을 "0개 남음"
    으로 보여주면 목록이 매일 렌탈로 도배된다.
    비활성 상품도 제외한다. 팔지 않는 물건을 발주할 이유가 없다.
    """
    items = []
    for product in store.load()["products"]:
        stock = product.get("stock")
        if stock is None or not product.get("is_active", True):
            continue
        limit = threshold if threshold is not None else int(product.get("reorder_point", 0))
        if int(stock) <= limit:
            items.append(
                {
                    "product_id": int(product["id"]),
                    "sku": product["sku"],
                    "name": product["name"],
                    "category": product["category"],
                    "stock": int(stock),
                    "reorder_point": int(product.get("reorder_point", 0)),
                }
            )

    # 가장 급한 것부터. 같은 수량이면 id 순으로 안정 정렬.
    return sorted(items, key=lambda item: (item["stock"], item["product_id"]))
