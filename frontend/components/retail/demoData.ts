/**
 * 리테일 서버가 없을 때 보여 주는 **읽기 전용 예시 데이터**.
 *
 * 왜 필요한가: 백엔드가 아직 없거나 꺼져 있을 때 화면이 텅 비면 직원은
 * "앱이 고장났다" 고 판단하고 닫는다. 무엇을 보게 될 화면인지는 보여 주되,
 * 배너로 "예시" 라고 못박고 Charge·저장 버튼을 전부 비활성화한다 —
 * 저장된 줄 알았는데 아무 데도 안 남는 것이 빈 화면보다 훨씬 나쁘다.
 *
 * 계약 타입(`Product`/`Sale`/`RetailDailyReport`)을 그대로 붙여 둔다.
 * 그래야 계약이 바뀌었을 때 tsc 가 여기서 먼저 걸어 준다.
 */

import type {
  LowStockItem,
  Product,
  RetailDailyReport,
  Sale,
} from "@/lib/retail/types";

const NOW = "2026-09-08T14:20:00Z";
const DEMO_DATE = "2026-09-08";

function product(
  id: number,
  sku: string,
  name: string,
  category: Product["category"],
  price: number,
  cost: number,
  stock: number | null,
  reorder_point = 4,
  is_active = true,
): Product {
  return {
    id,
    sku,
    name,
    category,
    price,
    cost,
    stock,
    reorder_point,
    is_active,
    created_at: NOW,
    updated_at: NOW,
  };
}

export const demoProducts: Product[] = [
  product(1, "PH-BALL-PV1", "Titleist Pro V1 (dozen)", "Balls", 8499, 5400, 18),
  product(2, "PH-BALL-CHR", "Callaway Chrome Soft (dozen)", "Balls", 7499, 4800, 3),
  product(3, "PH-BALL-RNG", "Range balls (bucket of 60)", "Balls", 1200, 300, 120, 30),
  product(4, "PH-POLO-M", "Pelham Hills crest polo", "Apparel", 6900, 3100, 11),
  product(5, "PH-CAP-NAV", "Club cap — navy", "Apparel", 3200, 1150, 26, 10),
  product(6, "PH-VEST-W", "Ladies' quarter-zip vest", "Apparel", 8900, 4200, 2),
  product(7, "PH-GLV-L", "Cabretta glove — left", "Accessories", 2799, 1250, 34, 12),
  product(8, "PH-TEE-BMB", "Bamboo tees (100 ct)", "Accessories", 999, 320, 61, 20),
  product(9, "PH-MARK-BR", "Brass ball marker", "Accessories", 1499, 500, 7),
  product(10, "PH-WEDG-56", "Vokey SM10 wedge 56°", "Equipment", 22900, 15600, 4, 2),
  product(11, "PH-PUTT-B2", "Blade putter — 34\"", "Equipment", 19900, 12800, 1, 2),
  product(12, "PH-BEER-DFT", "Draught pint", "Food & Beverage", 800, 240, 200, 48),
  product(13, "PH-HOTDOG", "Turn dog", "Food & Beverage", 650, 190, 40, 24),
  product(14, "PH-WATER", "Bottled water", "Food & Beverage", 300, 60, 180, 60),
  // 렌탈은 재고 개념이 없어서 `stock: null` 이다. 이 한 줄이 화면 곳곳의
  // null 처리를 실제로 밟게 해 준다 — 없으면 배포하고 나서야 터진다.
  product(15, "PH-RENT-CART", "Power cart — 18 holes", "Rentals", 3800, 0, null, 0),
  product(16, "PH-RENT-CLUB", "Rental clubs — full set", "Rentals", 4500, 0, null, 0),
  product(17, "PH-BALL-OLD", "Discontinued 2024 logo balls", "Balls", 4900, 3900, 0, 0, false),
];

export const demoLowStock: LowStockItem[] = [
  {
    product_id: 11,
    sku: "PH-PUTT-B2",
    name: 'Blade putter — 34"',
    category: "Equipment",
    stock: 1,
    reorder_point: 2,
  },
  {
    product_id: 6,
    sku: "PH-VEST-W",
    name: "Ladies' quarter-zip vest",
    category: "Apparel",
    stock: 2,
    reorder_point: 4,
  },
  {
    product_id: 2,
    sku: "PH-BALL-CHR",
    name: "Callaway Chrome Soft (dozen)",
    category: "Balls",
    stock: 3,
    reorder_point: 4,
  },
];

export const demoBusinessDate = DEMO_DATE;

export const demoSales: Sale[] = [
  {
    id: 4101,
    receipt_no: "PH-20260908-0007",
    business_date: DEMO_DATE,
    lines: [
      {
        product_id: 1,
        sku: "PH-BALL-PV1",
        name: "Titleist Pro V1 (dozen)",
        quantity: 1,
        unit_price: 8499,
        discount: 0,
        line_total: 8499,
      },
      {
        product_id: 7,
        sku: "PH-GLV-L",
        name: "Cabretta glove — left",
        quantity: 2,
        unit_price: 2799,
        discount: 500,
        line_total: 5098,
      },
    ],
    subtotal: 13597,
    discount: 0,
    tax: 1768,
    total: 15365,
    payment_method: "card",
    cashier: "Marie",
    note: null,
    refunded_at: null,
    refund_reason: null,
    created_at: "2026-09-08T13:41:00Z",
  },
  {
    id: 4100,
    receipt_no: "PH-20260908-0006",
    business_date: DEMO_DATE,
    lines: [
      {
        product_id: 15,
        sku: "PH-RENT-CART",
        name: "Power cart — 18 holes",
        quantity: 2,
        unit_price: 3800,
        discount: 0,
        line_total: 7600,
      },
      {
        product_id: 3,
        sku: "PH-BALL-RNG",
        name: "Range balls (bucket of 60)",
        quantity: 2,
        unit_price: 1200,
        discount: 0,
        line_total: 2400,
      },
    ],
    subtotal: 10000,
    discount: 1000,
    tax: 1170,
    total: 10170,
    payment_method: "member_account",
    cashier: "Dev",
    note: "Member 1183 — charged to account",
    refunded_at: null,
    refund_reason: null,
    created_at: "2026-09-08T12:05:00Z",
  },
  {
    // 환불된 매출. 목록에서 사라지지 않고 배지·취소선으로 남는 경로를
    // 서버 없이도 눈으로 확인할 수 있게 하나 넣어 둔다.
    id: 4099,
    receipt_no: "PH-20260908-0005",
    business_date: DEMO_DATE,
    lines: [
      {
        product_id: 11,
        sku: "PH-PUTT-B2",
        name: 'Blade putter — 34"',
        quantity: 1,
        unit_price: 19900,
        discount: 0,
        line_total: 19900,
      },
    ],
    subtotal: 19900,
    discount: 0,
    tax: 2587,
    total: 22487,
    payment_method: "card",
    cashier: "Marie",
    note: null,
    refunded_at: "2026-09-08T11:20:00Z",
    refund_reason: "Wrong length — customer swapped for the 35\" next week",
    created_at: "2026-09-08T10:12:00Z",
  },
  {
    id: 4098,
    receipt_no: "PH-20260908-0004",
    business_date: DEMO_DATE,
    lines: [
      {
        product_id: 12,
        sku: "PH-BEER-DFT",
        name: "Draught pint",
        quantity: 4,
        unit_price: 800,
        discount: 0,
        line_total: 3200,
      },
      {
        product_id: 13,
        sku: "PH-HOTDOG",
        name: "Turn dog",
        quantity: 4,
        unit_price: 650,
        discount: 0,
        line_total: 2600,
      },
    ],
    subtotal: 5800,
    discount: 0,
    tax: 754,
    total: 6554,
    payment_method: "cash",
    cashier: "Dev",
    note: null,
    refunded_at: null,
    refund_reason: null,
    created_at: "2026-09-08T11:58:00Z",
  },
];

/**
 * 위 `demoSales` 에서 **서버와 같은 규칙으로** 뽑은 값. 손으로 지어낸 숫자를 넣으면
 * 안 되는 이유: 화면이 이 값들을 그대로 믿고 그리므로, 여기가 앞뒤가 안 맞으면
 * "리포트 화면이 이상하다" 는 착시가 생기고 진짜 버그를 찾을 때 방해가 된다.
 *
 * 서버 규칙(`backend/api/routes/retail.py` 의 `daily_report`):
 * - 환불 건(4099)은 `gross`/`discount`/`tax`/`net` 과 세 집계에서 **전부 빠지고**
 *   `refunded_count`/`refunded_total` 로만 센다. 그래서 `sale_count` 는 4 가 아니라 3.
 * - `gross` 는 소계의 합(주문 할인 전, 세금 전), `net` 은 합계의 합(세금 포함).
 * - 항등식: `net === gross - discount + tax` → 29397 - 1000 + 3692 = 32089 ✓
 * - `by_payment`/`by_category` 는 **실제로 쓰인 것만** 담긴 희소 배열이고,
 *   순서는 `PAYMENT_METHODS`/`RETAIL_CATEGORIES` 의 선언 순서를 따른다.
 * - `top_products` 는 수량 내림차순 → 매출액 내림차순 → id 오름차순, 상위 5개.
 */
export const demoReport: RetailDailyReport = {
  business_date: DEMO_DATE,
  sale_count: 3,
  gross: 29397,
  discount: 1000,
  tax: 3692,
  net: 32089,
  refunded_count: 1,
  refunded_total: 22487,
  by_payment: [
    { method: "cash", count: 1, total: 6554 },
    { method: "card", count: 1, total: 15365 },
    { method: "member_account", count: 1, total: 10170 },
  ],
  by_category: [
    { category: "Balls", quantity: 3, total: 10899 },
    { category: "Accessories", quantity: 2, total: 5098 },
    { category: "Food & Beverage", quantity: 8, total: 5800 },
    { category: "Rentals", quantity: 2, total: 7600 },
  ],
  top_products: [
    { product_id: 12, name: "Draught pint", quantity: 4, total: 3200 },
    { product_id: 13, name: "Turn dog", quantity: 4, total: 2600 },
    { product_id: 15, name: "Power cart — 18 holes", quantity: 2, total: 7600 },
    { product_id: 7, name: "Cabretta glove — left", quantity: 2, total: 5098 },
    { product_id: 3, name: "Range balls (bucket of 60)", quantity: 2, total: 2400 },
  ],
};
