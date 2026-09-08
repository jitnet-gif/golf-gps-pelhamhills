/**
 * 프로 샵 리테일(POS) 의 **유일한** fetch 래퍼. 다른 곳에 두 번째 래퍼를 만들지 마라.
 *
 * 주소 해석은 `lib/apiHost.ts` 가 맡는다 — 배포된 사이트에 개발용 localhost 가
 * 굳어 나간 사고가 실제로 있었고, 그걸 한 자리에서 막는 장치다. 여기서
 * `process.env` 를 직접 읽으면 그 장치를 우회하게 된다.
 *
 * 티 시트 래퍼(`lib/teeSheet/api.ts`)와 같은 결로 쓰되 두 가지가 다르다.
 *
 * 1. 티 시트는 "주소가 없다" 와 "네트워크가 끊겼다" 를 둘 다 `status 0` 으로
 *    뭉쳤다. 리테일 화면은 그 둘에 다른 문장을 보여야 해서(설정 문제 vs 연결 문제)
 *    `kind` 로 구분한다.
 * 2. 티 시트는 네트워크 실패 시 `cause.message` 를 그대로 올린다. 런타임에 따라
 *    그 문장 안에 요청 URL 이 들어 있어서 화면에 서버 주소가 새어 나간다.
 *    그래서 네트워크 분기는 **고정 문장**을 쓴다. HTTP 오류의 `detail` 은
 *    서버가 직접 쓴 사람용 문구라 그대로 살린다.
 */

import { apiBaseUrl } from "@/lib/apiHost";

import {
  RETAIL_ROUTES,
  computeTax,
  type Cents,
  type LowStockItem,
  type Product,
  type ProductCreate,
  type ProductUpdate,
  type RefundRequest,
  type RetailDailyReport,
  type Sale,
  type SaleCreate,
} from "./types";

export { apiBaseUrl };

/**
 * 리테일 서버가 없을 때 화면에 쓰는 문구. `NO_API_MESSAGE` 를 재사용하지 않는 이유:
 * 그쪽은 "전화로 예약하세요" 라는 **고객용** 문장이다. 계산대 앞의 직원에게
 * 클럽 전화번호를 안내해 봐야 아무 소용이 없다.
 *
 * 주소는 넣지 않는다 — `lib/apiHost.ts` 의 docstring 참고.
 */
export const NO_RETAIL_API_MESSAGE = "리테일 서버에 연결할 수 없습니다.";

/** 요청이 왜 실패했는가. 화면이 배너 문구를 고르는 데 쓴다. */
export type RetailErrorKind = "unconfigured" | "network" | "http";

export class RetailApiError extends Error {
  readonly kind: RetailErrorKind;
  /** HTTP 오류일 때만 의미가 있다. 그 외에는 0. */
  readonly status: number;

  constructor(kind: RetailErrorKind, status: number, message: string) {
    super(message);
    this.name = "RetailApiError";
    this.kind = kind;
    this.status = status;
  }

  /** 서버가 없어서 실패한 것인가(= 데모 데이터로 착지해야 하는가). */
  get offline(): boolean {
    return this.kind !== "http";
  }
}

/** 알 수 없는 throw 값을 화면이 다룰 수 있는 형태로. */
export function toRetailError(cause: unknown): RetailApiError {
  if (cause instanceof RetailApiError) return cause;
  return new RetailApiError("network", 0, NO_RETAIL_API_MESSAGE);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = apiBaseUrl();
  // 주소가 없으면 요청을 흉내내지 않는다. 없는 주소로 fetch 하면 콘솔에
  // 빨간 오류만 남고 사용자에게는 아무 설명도 가지 않는다.
  if (!base) {
    throw new RetailApiError("unconfigured", 0, NO_RETAIL_API_MESSAGE);
  }

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // 여기서 잡히는 것은 대부분 fetch 의 TypeError(연결 실패/CORS) 다.
    // `cause.message` 를 올리지 않는다 — 런타임에 따라 요청 URL 이 문장 안에
    // 들어 있고, 그러면 화면에 서버 주소가 그대로 찍힌다.
    throw new RetailApiError("network", 0, NO_RETAIL_API_MESSAGE);
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`.trim();
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "detail" in body) {
        const value = (body as { detail: unknown }).detail;
        detail = typeof value === "string" ? value : JSON.stringify(value);
      }
    } catch {
      // JSON 이 아닌 오류 본문. 상태 줄을 그대로 쓴다.
    }
    throw new RetailApiError("http", response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

export const retailApi = {
  // ===== 상품 =====
  /**
   * 필터를 주지 않으면 서버는 **비활성 상품까지 포함해** 돌려준다(재활성화용).
   * 판매 화면은 반드시 `active: true` 를 줘야 한다 — 이미 안 파는 물건을
   * 격자에서 눌러 찍는 사고가 난다.
   *
   * 파라미터 이름은 서버(`backend/api/routes/retail.py`)와 글자 그대로 맞춘다.
   * 틀려도 타입 검사도 빌드도 잡아 주지 않고, 런타임에 "필터가 없는 것처럼
   * 전부 나온다" 로만 조용히 나타난다.
   */
  listProducts: (filters?: { category?: string; q?: string; active?: boolean }) =>
    request<Product[]>(
      `${RETAIL_ROUTES.products}${query({
        category: filters?.category,
        q: filters?.q,
        active: filters?.active === undefined ? undefined : String(filters.active),
      })}`,
    ),

  createProduct: (input: ProductCreate) =>
    request<Product>(RETAIL_ROUTES.products, { method: "POST", body: JSON.stringify(input) }),

  updateProduct: (id: number, patch: ProductUpdate) =>
    request<Product>(RETAIL_ROUTES.product(id), { method: "PATCH", body: JSON.stringify(patch) }),

  /**
   * 서버는 소프트 삭제한다(`is_active = false`). 과거 매출이 상품을 참조하므로
   * 진짜로 지울 수 없기 때문이다 — 화면에서도 "Deactivate" 라고 부른다.
   * 204 를 돌려줄지 갱신된 상품을 돌려줄지 계약에 없어서 둘 다 받아들인다.
   */
  deactivateProduct: (id: number) =>
    request<Product | void>(RETAIL_ROUTES.product(id), { method: "DELETE" }),

  // ===== 판매 =====
  listSales: (businessDate?: string) =>
    request<Sale[]>(`${RETAIL_ROUTES.sales}${query({ business_date: businessDate })}`),

  getSale: (id: number) => request<Sale>(RETAIL_ROUTES.sale(id)),

  createSale: (input: SaleCreate) =>
    request<Sale>(RETAIL_ROUTES.sales, { method: "POST", body: JSON.stringify(input) }),

  refundSale: (id: number, body: RefundRequest) =>
    request<Sale>(RETAIL_ROUTES.refund(id), { method: "POST", body: JSON.stringify(body) }),

  // ===== 리포트 =====
  getDailyReport: (businessDate: string) =>
    request<RetailDailyReport>(
      `${RETAIL_ROUTES.dailyReport}${query({ business_date: businessDate })}`,
    ),

  listLowStock: () => request<LowStockItem[]>(RETAIL_ROUTES.lowStock),
};

export default retailApi;

// ===== 금액 계산 ========================================================
//
// 금액과 재고는 **서버가 정답**이다(`SaleCreate` 는 합계를 아예 보내지 않는다).
// 그래도 계산대 화면은 "Charge" 를 누르기 전에 합계를 보여 줘야 하므로 같은
// 산술이 두 저장소에 존재한다. 프론트 쪽 사본을 여기 한 함수로 모아 둔다 —
// 나중에 서버와 어긋났을 때 고칠 자리가 한 곳이도록.

export type CartLine = {
  product: Product;
  quantity: number;
  /** 이 줄에 걸린 할인(센트). 단가가 아니라 줄 합계에서 뺀다. */
  discount: Cents;
};

export type CartTotals = {
  subtotal: Cents;
  discount: Cents;
  tax: Cents;
  total: Cents;
  /** 줄 단위 합계. 화면에 그대로 찍는다. */
  lineTotals: Cents[];
};

/** 0 이상 정수로 자른다. 음수 수량·소수점 수량이 서버로 새어 나가지 않게. */
function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 장바구니 합계. 전부 센트 정수다 — 달러 실수로 계산하면 하루치를 합산한
 * 마감 리포트에서 1센트씩 어긋난 게 눈에 보인다.
 *
 * 세금은 **할인 뒤 금액**에 매기고, 반올림은 계약의 `computeTax` 에 맡긴다.
 * `Math.round` 를 쓰면 서버(파이썬 `round()`, 은행가 반올림)와 1센트 어긋난다 —
 * 0..200000 센트 전 구간을 두 런타임으로 비교해 1000개가 어긋나는 것을 확인했다.
 *
 * 이 값은 **결제 전 미리보기 전용**이다. 결제 후에는 서버가 돌려준 `tax`/`total`
 * 을 그대로 표시한다.
 */
export function computeCartTotals(lines: CartLine[], orderDiscount: Cents): CartTotals {
  const lineTotals: Cents[] = [];
  let subtotal = 0;

  for (const line of lines) {
    const quantity = clampInt(line.quantity, 0, 9999);
    const gross = quantity * line.product.price;
    // 줄 할인이 줄 합계를 넘으면 음수 줄이 생긴다. 그런 영수증은 존재할 수 없다.
    const discount = clampInt(line.discount, 0, gross);
    const lineTotal = gross - discount;
    lineTotals.push(lineTotal);
    subtotal += lineTotal;
  }

  const discount = clampInt(orderDiscount, 0, subtotal);
  const taxable = subtotal - discount;
  const tax = computeTax(taxable);

  return { subtotal, discount, tax, total: taxable + tax, lineTotals };
}

/** 장바구니를 `POST /retail/sales` 가 받는 모양으로. 서버가 금액을 다시 계산한다. */
export function toSaleCreate(
  lines: CartLine[],
  fields: {
    orderDiscount: Cents;
    paymentMethod: SaleCreate["payment_method"];
    cashier?: string | null;
    note?: string | null;
    businessDate?: string;
  },
): SaleCreate {
  // 서버는 줄 할인 > 줄 합계, 주문 할인 > 소계를 400 으로 거절한다. 거절에
  // 기대지 않고 여기서 잘라 둔다 — 화면에는 이미 잘린 합계가 찍혀 있으므로,
  // 그대로 보내면 "화면과 다른 이유로" 결제가 실패한 것처럼 보인다.
  const totals = computeCartTotals(lines, fields.orderDiscount);

  return {
    lines: lines.map((line) => ({
      product_id: line.product.id,
      quantity: clampInt(line.quantity, 1, 9999),
      discount: clampInt(line.discount, 0, clampInt(line.quantity, 1, 9999) * line.product.price),
    })),
    // `computeCartTotals` 가 소계로 잘라 준 값. 소계를 넘는 주문 할인은 없다.
    discount: totals.discount,
    payment_method: fields.paymentMethod,
    cashier: fields.cashier?.trim() || null,
    note: fields.note?.trim() || null,
    ...(fields.businessDate ? { business_date: fields.businessDate } : {}),
  };
}

/** 매장 현지 날짜 `YYYY-MM-DD`. `toISOString()` 은 UTC 라 저녁에 하루가 밀린다. */
export function localBusinessDate(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
