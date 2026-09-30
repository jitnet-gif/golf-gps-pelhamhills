/**
 * 프로 샵 리테일(POS) 의 **API 계약**. 백엔드(`backend/api/routes/retail.py`)와
 * 어드민 화면(`app/admin/retail/`)이 이 파일 하나를 보고 서로를 기다리지 않고
 * 동시에 만들어진다. 그래서 여기 있는 필드 이름은 곧 JSON 의 키 이름이다 —
 * 한쪽만 바꾸면 조용히 `undefined` 가 흐른다.
 *
 * 통화 단위: **센트 정수**. 달러를 실수로 다루면 19.99 + 0.07 같은 계산이
 * 0.01 씩 어긋나고, 하루치를 합산한 마감 리포트에서 그 오차가 눈에 보인다.
 * 화면에 찍기 직전에만 `formatMoney` 로 바꾼다.
 *
 * 날짜: 매장 현지 날짜 기준 `YYYY-MM-DD`. 시각은 ISO-8601 UTC.
 */

/** 센트 단위 정수 금액. 1999 === $19.99 */
export type Cents = number;

export const RETAIL_CATEGORIES = [
  "Apparel",
  "Equipment",
  "Balls",
  "Accessories",
  "Food & Beverage",
  "Rentals",
] as const;

export type RetailCategory = (typeof RETAIL_CATEGORIES)[number];

// `debit` = Interac 체크카드. 카드처럼 Chase 단말기 승인번호가 있어야 기록된다.
export const PAYMENT_METHODS = ["cash", "card", "debit", "member_account", "gift_card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ===== 상품 =============================================================

export type Product = {
  id: number;
  sku: string;
  /** 제조사 바코드(UPC/EAN 등). 스캐너가 읽는 값. 없으면 null(0006 이전 응답엔 키가 없다). */
  barcode?: string | null;
  name: string;
  category: RetailCategory;
  /** 판매가(센트). */
  price: Cents;
  /** 원가(센트). 마진 계산용이라 고객 화면에는 절대 내보내지 않는다. */
  cost: Cents;
  /** 현재 재고 수량. 렌탈 품목은 `null`(재고 개념 없음). */
  stock: number | null;
  /** 이 수량 이하로 떨어지면 저재고 목록에 오른다. */
  reorder_point: number;
  /** false 면 판매 화면에 뜨지 않는다. 지우는 대신 이걸 쓴다 — 과거 매출이 상품을 참조하기 때문. */
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** 상품 생성 입력. `id`/타임스탬프는 서버가 붙인다. */
export type ProductCreate = {
  sku: string;
  /** 빈 문자열이나 null 이면 바코드 없음. */
  barcode?: string | null;
  name: string;
  category: RetailCategory;
  price: Cents;
  cost?: Cents;
  stock?: number | null;
  reorder_point?: number;
  is_active?: boolean;
};

/** 부분 수정. 보낸 필드만 바뀐다. */
export type ProductUpdate = Partial<ProductCreate>;

// ===== 판매 =============================================================

/**
 * 매출 한 줄. 상품명·단가를 **매출 시점 값으로 복사해 둔다.** `product_id` 만
 * 저장하면 나중에 가격을 올렸을 때 지난달 영수증 금액까지 같이 바뀐다.
 */
export type SaleLine = {
  /** 계산서 줄 id. Supabase 계산서(0005)에서만 온다. */
  id?: number;
  /** product = 상품, tee_player = 티 시트 플레이어의 그린피, sim_booking = 실내 골프 베이. 없으면 product. */
  kind?: "product" | "tee_player" | "sim_booking";
  /** 그린피 줄은 null. */
  product_id: number | null;
  /** 그린피 줄만: 티 타임 날짜(YYYY-MM-DD)와 시각 라벨. */
  tee_date?: string | null;
  tee_time?: string | null;
  sku: string;
  name: string;
  quantity: number;
  /** 판매 당시 단가(센트). */
  unit_price: Cents;
  /** 이 줄에 적용한 할인(센트). 단가가 아니라 줄 합계에서 뺀다. */
  discount: Cents;
  /** quantity * unit_price - discount. 서버가 계산해 채운다. */
  line_total: Cents;
};

export type Sale = {
  id: number;
  /** 영수증에 찍히는 사람이 읽는 번호. 예: `PH-20260908-0007` */
  receipt_no: string;
  /** 매장 현지 날짜 `YYYY-MM-DD`. 마감 리포트가 이 값으로 묶는다. */
  business_date: string;
  lines: SaleLine[];
  subtotal: Cents;
  /** 주문 전체에 걸린 할인(줄 단위 할인과 별개). */
  discount: Cents;
  /** 온타리오 HST 13%. 서버가 계산한다. */
  tax: Cents;
  total: Cents;
  /** 결제 줄이 없는 계산서(전액 할인)는 null. */
  payment_method: PaymentMethod | null;
  /** 결제 한 줄 한 줄(분할 결제). Supabase 계산서(0005)에서만 온다. */
  payments?: SalePayment[];
  /** 팁 합계(센트). total 밖이다. */
  tip?: Cents;
  status?: "open" | "paid" | "refunded" | "void";
  /** 판매 담당 직원 이름. 지금은 자유 입력. */
  cashier: string | null;
  note: string | null;
  /** 환불된 매출은 지우지 않고 이 값을 채운다 — 마감 대사가 맞아야 하기 때문. */
  refunded_at: string | null;
  refund_reason: string | null;
  created_at: string;
};

/**
 * 결제 한 줄. 카드·체크카드는 Chase 단말기(DX8000)가 찍어 준 승인번호가 있다.
 * `entry: "keyed"` = 직원이 단말기에 금액을 직접 쳤다(아직 앱과 연동 전).
 */
export type SalePayment = {
  method: PaymentMethod;
  amount: Cents;
  tip: Cents;
  entry: "keyed" | "integrated" | "none";
  auth_code: string | null;
  card_last4: string | null;
  terminal: string | null;
};

/** 계산 입력. 금액 계산과 재고 차감은 전부 서버가 한다. */
export type SaleCreate = {
  lines: Array<{ product_id: number; quantity: number; discount?: Cents }>;
  discount?: Cents;
  payment_method: PaymentMethod;
  cashier?: string | null;
  note?: string | null;
  /** 생략하면 서버의 오늘 날짜. */
  business_date?: string;
};

export type RefundRequest = {
  reason: string;
};

// ===== 리포트 ===========================================================

export type RetailDailyReport = {
  business_date: string;
  sale_count: number;
  gross: Cents;
  discount: Cents;
  tax: Cents;
  net: Cents;
  refunded_count: number;
  refunded_total: Cents;
  by_payment: Array<{ method: PaymentMethod; count: number; total: Cents }>;
  /** 합산 계산서라 그린피가 'Green Fees', 베이 요금이 'Simulator' 로 함께 잡힌다. */
  by_category: Array<{ category: RetailCategory | "Green Fees" | "Simulator"; quantity: number; total: Cents }>;
  /** 어디서 연 계산서인가(Supabase 계산서에서만). */
  by_station?: Array<{ station: string; count: number; total: Cents }>;
  tips?: Cents;
  top_products: Array<{ product_id: number; name: string; quantity: number; total: Cents }>;
};

export type LowStockItem = {
  product_id: number;
  sku: string;
  name: string;
  category: RetailCategory;
  stock: number;
  reorder_point: number;
};

// ===== 엔드포인트 목록 ==================================================
//
// `apiBaseUrl()` (= `.../api/v1`) 뒤에 그대로 이어 붙이는 경로.
// 백엔드 라우터의 경로와 **글자 그대로** 일치해야 한다.

export const RETAIL_ROUTES = {
  products: "/retail/products",
  product: (id: number) => `/retail/products/${id}`,
  sales: "/retail/sales",
  sale: (id: number) => `/retail/sales/${id}`,
  refund: (id: number) => `/retail/sales/${id}/refund`,
  dailyReport: "/retail/reports/daily",
  lowStock: "/retail/inventory/low-stock",
} as const;

// ===== 표시 헬퍼 ========================================================

/** 센트 정수를 화면용 문자열로. 계산에는 절대 쓰지 않는다. */
export function formatMoney(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-CA")}.${String(abs % 100).padStart(2, "0")}`;
}

/** 화면 입력("19.99")을 센트로. 빈 값과 쓰레기 입력은 0 으로 떨어진다. */
export function parseMoney(input: string): Cents {
  const value = Number.parseFloat(input.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** 온타리오 HST. */
export const TAX_RATE = 0.13;

/**
 * 세액 계산. **`Math.round` 를 쓰지 마라.**
 *
 * 서버는 파이썬 `round()` 로 반올림하는데 그건 "은행가 반올림"(정확히 0.5 면
 * 짝수 쪽으로)이고, JS `Math.round` 는 무조건 위로 올린다. 과세 대상 금액이
 * 50, 250, 450, 850… 센트일 때(= `taxable % 200 === 50`) 둘의 결과가 1센트 어긋난다.
 * 실제로 확인한 값:
 *
 *     taxable  850 → 850*0.13 = 110.5 → 파이썬 110, Math.round 111
 *
 * 대략 200건에 1건꼴이다. 화면 미리보기가 111 이라고 해 놓고 영수증에 110 이
 * 찍히면, 직원은 우리 계산을 믿지 않게 된다. 그래서 여기서 서버와 같은 규칙을 쓴다.
 *
 * 그래도 **최종 금액은 언제나 서버가 돌려준 `tax`/`total` 을 표시해라.**
 * 이 함수는 결제 전 미리보기 전용이다.
 */
export function computeTax(taxable: Cents): Cents {
  const exact = taxable * TAX_RATE;
  const floor = Math.floor(exact);
  const remainder = exact - floor;
  if (remainder > 0.5) return floor + 1;
  if (remainder < 0.5) return floor;
  // 정확히 0.5 — 짝수 쪽으로 (파이썬 round() 와 동일)
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * 마감 리포트 금액 필드의 정의. 백엔드가 실제로 채우는 의미이며,
 * 화면이 다르게 가정하면 모든 줄이 틀린다.
 *
 * - `gross`  — 줄 할인까지 반영한 소계의 합. **주문 할인 이전, 세금 이전**
 * - `discount` — 주문 단위 할인의 합 (줄 할인은 이미 `gross` 에 반영됨)
 * - `tax`    — 세액의 합
 * - `net`    — 합계의 합. **세금 포함** (`net === gross - discount + tax`)
 * - `refunded_total` — 환불 건의 `total` 합 (역시 세금 포함).
 *   환불 건은 `gross`/`net` 에서 **빠져 있다** — 이중으로 세면 안 된다.
 *
 * 또한 `by_payment` / `by_category` 는 **실제로 발생한 것만** 담긴다.
 * `PAYMENT_METHODS` 를 순회하며 인덱싱하면 `undefined` 가 나온다 — 응답 배열 쪽을
 * 순회하거나, 없는 항목을 0 으로 채운 뒤 써라.
 */
export const REPORT_MONEY_NOTE = "net is tax-inclusive; refunded sales are excluded from gross/net";
