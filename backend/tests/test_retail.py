"""프로 샵 리테일(POS) 백엔드 통합 테스트.

실행: `cd E:\\PELHAMHILLS && python -m pytest backend/tests/test_retail.py -q`

모든 테스트는 `RETAIL_DATA_FILE` 를 tmp_path 로 돌려 실제 데이터 파일을 건드리지 않는다.
`test_simulator.py` / `test_tee_sheet.py` 와 같은 픽스처 구조다.

금액 기대값은 **손으로 계산해서 박아 둔다.** 라우터와 같은 공식을 테스트에서
다시 돌리면 아무것도 검증하지 않는 셈이 된다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.api.routes import retail as module  # noqa: E402
from backend.services import retail_store as store  # noqa: E402

API = "/api/v1"

DAY = "2026-09-08"
NEXT_DAY = "2026-09-09"

# 시드 상품 id (retail_store.seed_products 의 순서와 같다).
PRO_V1 = 1  # Balls, 8499, stock 48
QI10_DRIVER = 3  # Equipment, 69999, stock 4
GLOVE = 9  # Accessories, 2299, stock 40
GATORADE = 13  # Food & Beverage, 399, stock 72
CART_RENTAL = 15  # Rentals, 2500, stock None


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv(store.ENV_VAR, str(tmp_path / "retail.json"))
    # 이전 테스트의 캐시를 확실히 버린다 (경로 키가 다르면 자동 무효화되지만 명시적으로).
    store._cache = None
    store._cache_path = None

    app = FastAPI()
    app.include_router(module.router, prefix=API)
    with TestClient(app) as test_client:
        yield test_client

    store._cache = None
    store._cache_path = None


# ===== 헬퍼 ===========================================================


def make_product(client, **overrides):
    body = {
        "sku": "TEST-1",
        "name": "Test Widget",
        "category": "Accessories",
        "price": 1999,
        "cost": 900,
        "stock": 10,
        "reorder_point": 3,
    }
    body.update(overrides)
    response = client.post(f"{API}/retail/products", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def sell(client, lines, **overrides):
    body = {
        "lines": lines,
        "payment_method": "card",
        "business_date": DAY,
    }
    body.update(overrides)
    return client.post(f"{API}/retail/sales", json=body)


def product(client, product_id):
    matches = client.get(f"{API}/retail/products").json()
    return next(p for p in matches if p["id"] == product_id)


# ===== 시딩 ===========================================================


def test_products_are_seeded_without_a_database(client):
    products = client.get(f"{API}/retail/products").json()
    assert len(products) == 16
    assert {p["category"] for p in products} == {
        "Apparel",
        "Equipment",
        "Balls",
        "Accessories",
        "Food & Beverage",
        "Rentals",
    }
    # 금액은 전부 센트 정수. float 가 하나라도 섞이면 마감이 어긋난다.
    assert all(isinstance(p["price"], int) and isinstance(p["cost"], int) for p in products)


def test_rentals_have_no_stock(client):
    assert product(client, CART_RENTAL)["stock"] is None


def test_corrupt_data_file_falls_back_to_the_seed(client, tmp_path):
    (tmp_path / "retail.json").write_text("{ not json", encoding="utf-8")
    store._cache = None
    store._cache_path = None

    assert len(client.get(f"{API}/retail/products").json()) == 16


# ===== 상품 CRUD ======================================================


def test_create_and_read_a_product(client):
    created = make_product(client, sku="PH-NEW-1", name="Head Cover")
    assert created["id"] > 16
    assert created["is_active"] is True
    assert created["created_at"] and created["updated_at"]

    found = client.get(f"{API}/retail/products", params={"q": "head cov"}).json()
    assert [p["id"] for p in found] == [created["id"]]


def test_duplicate_sku_is_a_409(client):
    make_product(client, sku="DUPE-1")
    again = client.post(
        f"{API}/retail/products",
        json={"sku": "DUPE-1", "name": "Other", "category": "Apparel", "price": 100},
    )
    assert again.status_code == 409
    assert "DUPE-1" in again.json()["detail"]


def test_duplicate_sku_ignores_case(client):
    """`pv1-dz` 와 `PV1-DZ` 는 같은 물건이다."""
    response = client.post(
        f"{API}/retail/products",
        json={"sku": "pv1-dz", "name": "Sneaky", "category": "Balls", "price": 100},
    )
    assert response.status_code == 409


def test_patch_changes_only_what_was_sent(client):
    created = make_product(client, sku="PATCH-1", stock=7)
    patched = client.patch(
        f"{API}/retail/products/{created['id']}", json={"price": 2499}
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["price"] == 2499
    assert body["stock"] == 7  # 안 보낸 필드는 그대로
    assert body["name"] == created["name"]


def test_patch_can_null_the_stock_explicitly(client):
    """"안 보냄" 과 "null 로 보냄" 이 구분되어야 한다."""
    created = make_product(client, sku="PATCH-2", stock=7)
    patched = client.patch(f"{API}/retail/products/{created['id']}", json={"stock": None})
    assert patched.json()["stock"] is None


def test_patch_onto_an_existing_sku_is_a_409(client):
    make_product(client, sku="TAKEN-1")
    other = make_product(client, sku="FREE-1")
    response = client.patch(f"{API}/retail/products/{other['id']}", json={"sku": "TAKEN-1"})
    assert response.status_code == 409


def test_bad_category_is_a_422_not_a_400(client):
    """카테고리 검증은 Pydantic 이 한다 — 손으로 400 을 만들지 않는다."""
    response = client.post(
        f"{API}/retail/products",
        json={"sku": "X-1", "name": "X", "category": "Hovercraft", "price": 100},
    )
    assert response.status_code == 422


def test_delete_deactivates_and_does_not_remove(client):
    """과거 매출이 상품을 참조하므로 행을 지우지 않는다."""
    created = make_product(client, sku="GONE-1")
    response = client.delete(f"{API}/retail/products/{created['id']}")
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    still_there = product(client, created["id"])
    assert still_there["is_active"] is False

    active_only = client.get(f"{API}/retail/products", params={"active": True}).json()
    assert created["id"] not in [p["id"] for p in active_only]

    # 다시 켤 수 있다.
    revived = client.patch(f"{API}/retail/products/{created['id']}", json={"is_active": True})
    assert revived.json()["is_active"] is True


def test_products_filter_by_category_and_sku(client):
    balls = client.get(f"{API}/retail/products", params={"category": "Balls"}).json()
    assert len(balls) == 2
    assert all(p["category"] == "Balls" for p in balls)

    by_sku = client.get(f"{API}/retail/products", params={"q": "pv1"}).json()
    assert [p["id"] for p in by_sku] == [PRO_V1]


def test_unknown_product_patch_is_a_404(client):
    assert client.patch(f"{API}/retail/products/9999", json={"price": 1}).status_code == 404


# ===== 판매 계산 ======================================================


def test_sale_totals_are_exact_cents(client):
    """손 계산: 소계 4599, 주문 할인 500 → 과세 4099 × 0.13 = 532.87 → 세금 533, 합계 4632."""
    item = make_product(client, sku="CALC-1", price=4599, stock=5)
    response = sell(client, [{"product_id": item["id"], "quantity": 1}], discount=500)
    assert response.status_code == 201, response.text

    sale = response.json()
    assert sale["subtotal"] == 4599
    assert sale["discount"] == 500
    assert sale["tax"] == 533
    assert sale["total"] == 4632
    assert sale["lines"][0]["line_total"] == 4599


def test_line_discount_and_order_discount_stack(client):
    """손 계산:
    A: 2 × 1999 - 300 = 3698
    B: 1 ×  899 -   0 =  899
    소계 4597, 주문 할인 400 → 과세 4197 × 0.13 = 545.61 → 세금 546, 합계 4743.
    """
    a = make_product(client, sku="STACK-A", price=1999, stock=10)
    b = make_product(client, sku="STACK-B", price=899, stock=10)

    sale = sell(
        client,
        [
            {"product_id": a["id"], "quantity": 2, "discount": 300},
            {"product_id": b["id"], "quantity": 1},
        ],
        discount=400,
    ).json()

    assert [line["line_total"] for line in sale["lines"]] == [3698, 899]
    assert sale["subtotal"] == 4597
    assert sale["discount"] == 400
    assert sale["tax"] == 546
    assert sale["total"] == 4743
    # 계약상 항등식.
    assert sale["total"] == sale["subtotal"] - sale["discount"] + sale["tax"]


def test_line_copies_the_name_and_price_at_sale_time(client):
    """나중에 가격을 올려도 지난 영수증 금액은 그대로여야 한다."""
    item = make_product(client, sku="FROZEN-1", price=1000, name="Old Name", stock=5)
    sale = sell(client, [{"product_id": item["id"], "quantity": 1}]).json()

    client.patch(f"{API}/retail/products/{item['id']}", json={"price": 9999, "name": "New Name"})

    again = client.get(f"{API}/retail/sales/{sale['id']}").json()
    assert again["lines"][0]["unit_price"] == 1000
    assert again["lines"][0]["name"] == "Old Name"
    assert again["total"] == sale["total"]


def test_line_discount_larger_than_the_line_is_rejected(client):
    item = make_product(client, sku="OVER-1", price=1000, stock=5)
    response = sell(client, [{"product_id": item["id"], "quantity": 1, "discount": 1500}])
    assert response.status_code == 400


def test_order_discount_larger_than_the_subtotal_is_rejected(client):
    item = make_product(client, sku="OVER-2", price=1000, stock=5)
    response = sell(client, [{"product_id": item["id"], "quantity": 1}], discount=1500)
    assert response.status_code == 400


def test_tax_rounds_once_at_the_half_cent(client):
    """반올림 규칙을 못 박아 둔다.

    파이썬 `round()` 는 은행가 반올림이라 850 × 0.13 = 110.5 를 **110** 으로 내린다.
    JS `Math.round` 는 111 을 준다 — 프론트가 `TAX_RATE` 로 미리 보여 주는 값이
    `taxable % 200 == 50` 인 금액에서 1센트 어긋난다는 뜻이다. 진실은 서버 값이다.
    """
    item = make_product(client, sku="ROUND-1", price=850, stock=5)
    sale = sell(client, [{"product_id": item["id"], "quantity": 1}]).json()
    assert sale["tax"] == 110
    assert sale["total"] == 960


def test_business_date_defaults_to_today(client):
    """`types.ts`: "생략하면 서버의 오늘 날짜"."""
    from datetime import date

    sale = client.post(
        f"{API}/retail/sales",
        json={"lines": [{"product_id": GATORADE, "quantity": 1}], "payment_method": "cash"},
    ).json()
    today = date.today().isoformat()
    assert sale["business_date"] == today
    assert sale["receipt_no"] == f"PH-{today.replace('-', '')}-0001"


def test_empty_cashier_and_note_become_null(client):
    sale = sell(
        client, [{"product_id": GATORADE, "quantity": 1}], cashier="  ", note=""
    ).json()
    assert sale["cashier"] is None
    assert sale["note"] is None


def test_empty_sale_is_a_422(client):
    assert sell(client, []).status_code == 422


def test_bad_payment_method_is_a_422(client):
    response = sell(
        client, [{"product_id": GATORADE, "quantity": 1}], payment_method="bitcoin"
    )
    assert response.status_code == 422


# ===== 재고 ===========================================================


def test_stock_is_deducted(client):
    before = product(client, PRO_V1)["stock"]
    assert sell(client, [{"product_id": PRO_V1, "quantity": 3}]).status_code == 201
    assert product(client, PRO_V1)["stock"] == before - 3


def test_rentals_are_not_deducted(client):
    """`stock` 이 null 인 품목은 팔아도 재고가 생기지 않는다."""
    assert sell(client, [{"product_id": CART_RENTAL, "quantity": 4}]).status_code == 201
    assert product(client, CART_RENTAL)["stock"] is None


def test_insufficient_stock_is_a_400_that_names_the_product(client):
    response = sell(client, [{"product_id": QI10_DRIVER, "quantity": 5}])  # 재고 4
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "Qi10" in detail
    assert "short 1" in detail
    # 실패한 판매는 재고를 건드리지 않는다.
    assert product(client, QI10_DRIVER)["stock"] == 4


def test_same_product_twice_in_one_sale_is_summed_before_the_stock_check(client):
    """바코드를 두 번 찍으면 줄이 둘이 된다. 줄별로 검사하면 재고 4에 3+3 이 통과한다."""
    response = sell(
        client,
        [
            {"product_id": QI10_DRIVER, "quantity": 3},
            {"product_id": QI10_DRIVER, "quantity": 3},
        ],
    )
    assert response.status_code == 400
    assert "short 2" in response.json()["detail"]
    assert product(client, QI10_DRIVER)["stock"] == 4


def test_a_failed_line_rolls_back_the_whole_sale(client):
    """앞 줄이 통과해도 뒤 줄이 실패하면 아무것도 차감되지 않는다."""
    before = product(client, GLOVE)["stock"]
    response = sell(
        client,
        [
            {"product_id": GLOVE, "quantity": 2},
            {"product_id": QI10_DRIVER, "quantity": 99},
        ],
    )
    assert response.status_code == 400
    assert product(client, GLOVE)["stock"] == before
    assert client.get(f"{API}/retail/sales").json() == []


def test_selling_an_inactive_product_is_a_400(client):
    item = make_product(client, sku="DEAD-1", stock=5)
    client.delete(f"{API}/retail/products/{item['id']}")
    response = sell(client, [{"product_id": item["id"], "quantity": 1}])
    assert response.status_code == 400
    assert "DEAD-1" in response.json()["detail"]


def test_selling_an_unknown_product_is_a_400(client):
    response = sell(client, [{"product_id": 9999, "quantity": 1}])
    assert response.status_code == 400
    assert "9999" in response.json()["detail"]


# ===== 영수증 번호 ====================================================


def test_receipt_numbers_increment_within_a_business_date(client):
    numbers = [
        sell(client, [{"product_id": GATORADE, "quantity": 1}]).json()["receipt_no"]
        for _ in range(3)
    ]
    assert numbers == ["PH-20260908-0001", "PH-20260908-0002", "PH-20260908-0003"]


def test_receipt_numbers_restart_on_a_new_business_date(client):
    first = sell(client, [{"product_id": GATORADE, "quantity": 1}]).json()
    second = sell(
        client, [{"product_id": GATORADE, "quantity": 1}], business_date=NEXT_DAY
    ).json()
    third = sell(client, [{"product_id": GATORADE, "quantity": 1}]).json()

    assert first["receipt_no"] == "PH-20260908-0001"
    assert second["receipt_no"] == "PH-20260909-0001"
    # 날짜별로 따로 센다 — 소급 입력이 오늘 번호를 먹지 않는다.
    assert third["receipt_no"] == "PH-20260908-0002"


def test_business_date_is_normalised(client):
    """`2026-9-8` 을 그대로 저장하면 마감 리포트가 그 매출을 통째로 놓친다."""
    sale = sell(client, [{"product_id": GATORADE, "quantity": 1}], business_date="2026-9-8").json()
    assert sale["business_date"] == DAY
    assert sale["receipt_no"] == "PH-20260908-0001"


def test_bad_business_date_is_a_400(client):
    response = sell(client, [{"product_id": GATORADE, "quantity": 1}], business_date="08-09-2026")
    assert response.status_code == 400
    assert "YYYY-MM-DD" in response.json()["detail"]


# ===== 조회 / 영속화 ==================================================


def test_sales_list_is_newest_first_and_filters_by_date(client):
    a = sell(client, [{"product_id": GATORADE, "quantity": 1}]).json()
    b = sell(client, [{"product_id": GATORADE, "quantity": 1}]).json()
    c = sell(
        client, [{"product_id": GATORADE, "quantity": 1}], business_date=NEXT_DAY
    ).json()

    everything = client.get(f"{API}/retail/sales").json()
    assert [s["id"] for s in everything] == [c["id"], b["id"], a["id"]]

    one_day = client.get(f"{API}/retail/sales", params={"business_date": DAY}).json()
    assert [s["id"] for s in one_day] == [b["id"], a["id"]]

    ranged = client.get(f"{API}/retail/sales", params={"from": NEXT_DAY, "to": NEXT_DAY}).json()
    assert [s["id"] for s in ranged] == [c["id"]]


def test_unknown_sale_is_a_404(client):
    assert client.get(f"{API}/retail/sales/9999").status_code == 404


def test_sales_survive_a_cache_drop(client):
    """파일에 실제로 쓰였는지 — 캐시를 버리고 다시 읽어 확인한다."""
    sale = sell(client, [{"product_id": PRO_V1, "quantity": 2}]).json()

    store._cache = None
    store._cache_path = None

    again = client.get(f"{API}/retail/sales/{sale['id']}").json()
    assert again["receipt_no"] == sale["receipt_no"]
    assert product(client, PRO_V1)["stock"] == 46


# ===== 환불 ===========================================================


def test_refund_restores_stock_and_keeps_the_sale(client):
    before = product(client, PRO_V1)["stock"]
    sale = sell(client, [{"product_id": PRO_V1, "quantity": 2}]).json()
    assert product(client, PRO_V1)["stock"] == before - 2

    refunded = client.post(
        f"{API}/retail/sales/{sale['id']}/refund", json={"reason": "Wrong compression"}
    )
    assert refunded.status_code == 200
    body = refunded.json()
    assert body["refunded_at"]
    assert body["refund_reason"] == "Wrong compression"
    # 금액은 손대지 않는다 — 마감 대사가 원래 금액을 봐야 한다.
    assert body["total"] == sale["total"]

    assert product(client, PRO_V1)["stock"] == before

    # 매출 자체는 남아 있다.
    assert client.get(f"{API}/retail/sales/{sale['id']}").status_code == 200
    assert [s["id"] for s in client.get(f"{API}/retail/sales").json()] == [sale["id"]]


def test_double_refund_is_a_409(client):
    sale = sell(client, [{"product_id": GATORADE, "quantity": 1}]).json()
    assert client.post(
        f"{API}/retail/sales/{sale['id']}/refund", json={"reason": "first"}
    ).status_code == 200
    second = client.post(
        f"{API}/retail/sales/{sale['id']}/refund", json={"reason": "second"}
    )
    assert second.status_code == 409
    # 재고가 두 번 돌아오지 않는다.
    assert product(client, GATORADE)["stock"] == 72


def test_refunding_a_rental_does_not_invent_stock(client):
    sale = sell(client, [{"product_id": CART_RENTAL, "quantity": 2}]).json()
    client.post(f"{API}/retail/sales/{sale['id']}/refund", json={"reason": "rained out"})
    assert product(client, CART_RENTAL)["stock"] is None


def test_refunding_an_unknown_sale_is_a_404(client):
    assert client.post(
        f"{API}/retail/sales/9999/refund", json={"reason": "nope"}
    ).status_code == 404


def test_refund_needs_a_reason(client):
    sale = sell(client, [{"product_id": GATORADE, "quantity": 1}]).json()
    assert client.post(
        f"{API}/retail/sales/{sale['id']}/refund", json={"reason": ""}
    ).status_code == 422


# ===== 마감 리포트 ====================================================


def report(client, business_date=DAY):
    response = client.get(
        f"{API}/retail/reports/daily", params={"business_date": business_date}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_empty_day_reports_zeroes(client):
    data = report(client)
    assert data["business_date"] == DAY
    assert data == {
        "business_date": DAY,
        "sale_count": 0,
        "gross": 0,
        "discount": 0,
        "tax": 0,
        "net": 0,
        "refunded_count": 0,
        "refunded_total": 0,
        "by_payment": [],
        "by_category": [],
        "top_products": [],
    }


def test_daily_report_adds_up(client):
    """두 건 손 계산.

    1) Pro V1 8499 × 1, 할인 없음 → 세금 round(8499 × .13) = round(1104.87) = 1105,
       합계 9604. (card)
    2) Gatorade 399 × 2 = 798, 주문 할인 98 → 과세 700 × .13 = 91, 합계 791. (cash)

    gross 8499 + 798 = 9297, discount 98, tax 1105 + 91 = 1196, net 9604 + 791 = 10395.
    """
    first = sell(client, [{"product_id": PRO_V1, "quantity": 1}], payment_method="card").json()
    second = sell(
        client,
        [{"product_id": GATORADE, "quantity": 2}],
        discount=98,
        payment_method="cash",
    ).json()

    assert (first["tax"], first["total"]) == (1105, 9604)
    assert (second["tax"], second["total"]) == (91, 791)

    data = report(client)
    assert data["sale_count"] == 2
    assert data["gross"] == 9297
    assert data["discount"] == 98
    assert data["tax"] == 1196
    assert data["net"] == 10395
    # 계약 항등식: 화면이 그대로 검산할 수 있어야 한다.
    assert data["net"] == data["gross"] - data["discount"] + data["tax"]

    assert data["by_payment"] == [
        {"method": "cash", "count": 1, "total": 791},
        {"method": "card", "count": 1, "total": 9604},
    ]
    assert data["by_category"] == [
        {"category": "Balls", "quantity": 1, "total": 8499},
        {"category": "Food & Beverage", "quantity": 2, "total": 798},
    ]


def test_refunded_sales_leave_the_net_and_are_counted_separately(client):
    keep = sell(client, [{"product_id": PRO_V1, "quantity": 1}]).json()
    drop = sell(client, [{"product_id": GATORADE, "quantity": 2}], discount=98).json()

    client.post(f"{API}/retail/sales/{drop['id']}/refund", json={"reason": "flat"})

    data = report(client)
    assert data["sale_count"] == 1
    assert data["gross"] == 8499
    assert data["discount"] == 0
    assert data["tax"] == 1105
    assert data["net"] == keep["total"] == 9604
    assert data["refunded_count"] == 1
    assert data["refunded_total"] == 791  # net 과 같은 기준(세금 포함 total)
    # 환불 건은 카테고리/결제수단 집계에서도 빠진다.
    assert [row["category"] for row in data["by_category"]] == ["Balls"]
    assert [row["method"] for row in data["by_payment"]] == ["card"]
    assert [row["product_id"] for row in data["top_products"]] == [PRO_V1]


def test_report_only_sees_its_own_business_date(client):
    sell(client, [{"product_id": GATORADE, "quantity": 1}])
    sell(client, [{"product_id": GATORADE, "quantity": 1}], business_date=NEXT_DAY)

    assert report(client, DAY)["sale_count"] == 1
    assert report(client, NEXT_DAY)["sale_count"] == 1


def test_top_products_is_five_by_quantity(client):
    quantities = {PRO_V1: 1, GLOVE: 6, GATORADE: 9, CART_RENTAL: 4, 14: 7, 10: 2}
    for product_id, quantity in quantities.items():
        assert sell(client, [{"product_id": product_id, "quantity": quantity}]).status_code == 201

    top = report(client)["top_products"]
    assert len(top) == 5
    assert [row["product_id"] for row in top] == [GATORADE, 14, GLOVE, CART_RENTAL, 10]
    assert top[0]["quantity"] == 9
    assert top[0]["total"] == 9 * 399


def test_report_rejects_a_bad_date(client):
    response = client.get(f"{API}/retail/reports/daily", params={"business_date": "nope"})
    assert response.status_code == 400


# ===== 저재고 =========================================================


def test_low_stock_uses_the_reorder_point(client):
    """시드 상태에서 재고 <= reorder_point 인 것: Qi10 드라이버(4/2)? 아니다.

    시드는 일부러 아무것도 안 걸리게 해 뒀다. PATCH 로 재고를 떨어뜨려 확인한다.
    """
    assert client.get(f"{API}/retail/inventory/low-stock").json() == []

    client.patch(f"{API}/retail/products/{QI10_DRIVER}", json={"stock": 2})
    items = client.get(f"{API}/retail/inventory/low-stock").json()
    assert [item["product_id"] for item in items] == [QI10_DRIVER]
    assert items[0]["stock"] == 2
    assert items[0]["reorder_point"] == 2


def test_low_stock_threshold_wins_over_the_reorder_point(client):
    items = client.get(f"{API}/retail/inventory/low-stock", params={"threshold": 5}).json()
    ids = [item["product_id"] for item in items]
    # 시드 재고 5 이하: Qi10 드라이버(4), Scotty Cameron(2), 레인 재킷(5).
    assert ids == [5, 3, 8]
    assert all(item["stock"] <= 5 for item in items)


def test_low_stock_skips_rentals_and_inactive_products(client):
    """`stock` 이 null 인 렌탈은 "0개 남음" 이 아니다."""
    items = client.get(f"{API}/retail/inventory/low-stock", params={"threshold": 100}).json()
    ids = [item["product_id"] for item in items]
    assert CART_RENTAL not in ids
    assert len(ids) == 14  # 시드 16개 - 렌탈 2개

    client.delete(f"{API}/retail/products/{QI10_DRIVER}")
    after = client.get(f"{API}/retail/inventory/low-stock", params={"threshold": 100}).json()
    assert QI10_DRIVER not in [item["product_id"] for item in after]


def test_selling_can_push_a_product_onto_the_low_stock_list(client):
    assert client.get(f"{API}/retail/inventory/low-stock").json() == []
    sell(client, [{"product_id": QI10_DRIVER, "quantity": 2}])  # 4 -> 2, reorder_point 2
    assert [item["product_id"] for item in client.get(f"{API}/retail/inventory/low-stock").json()] == [
        QI10_DRIVER
    ]
