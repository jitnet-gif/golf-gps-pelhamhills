"use client";

/**
 * 계산대. 리테일에서 **하루에 수백 번 열리는 유일한 화면**이라, 나머지 두 탭이
 * 조금 불편한 것보다 여기가 한 번 불편한 쪽이 훨씬 비싸다.
 *
 * 실사용 기기는 프로 샵 카운터의 태블릿/휴대폰이다. 그래서
 * - 상품 카드는 손가락 과녁(최소 44px, 실제로는 카드 전체가 과녁)이고,
 * - 390px 에서 장바구니는 옆이 아니라 **아래에서 올라오는 시트**이며,
 * - 담긴 것이 있으면 합계 줄이 화면 아래에 항상 붙어 있다.
 *
 * 담긴 것이 없을 때는 그 줄을 아예 그리지 않는다 — 어드민 껍데기의 하단 탭이
 * 문서 맨 아래에 있어서, 고정 줄이 늘 떠 있으면 다른 화면으로 갈 길을 덮는다.
 */

import { useMemo, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";

import {
  computeCartTotals,
  toRetailError,
  toSaleCreate,
  type CartLine,
} from "@/lib/retail/api";
import retailApi from "@/lib/retail/api";
import { printReceipt } from "@/lib/retail/printReceipt";
import { PAYMENT_LABELS } from "@/lib/retail/receipt";
import {
  PAYMENT_METHODS,
  RETAIL_CATEGORIES,
  formatMoney,
  parseMoney,
  type PaymentMethod,
  type Product,
  type RetailCategory,
  type Sale,
} from "@/lib/retail/types";

import {
  Button,
  Chip,
  EmptyNote,
  ErrorNote,
  Field,
  Select,
  SkeletonCards,
  TextArea,
  TextInput,
  useOverlayDismiss,
} from "./ui";

/**
 * "결제 뒤 영수증 자동 인쇄" 스위치. 카운터 PC 한 대의 습관이라 서버가 아니라 이
 * 브라우저에만 남긴다. 저장소가 막힌 브라우저(사생활 모드 등)에서는 꺼진 채로 시작할 뿐이다.
 */
const AUTO_PRINT_KEY = "pelham.retail.autoPrint";

// 저장소가 막힌 브라우저에서도 이 화면이 열려 있는 동안은 스위치가 동작하도록 메모리에도 둔다.
let autoPrintFallback = false;
const autoPrintListeners = new Set<() => void>();

function readAutoPrint(): boolean {
  try {
    return window.localStorage.getItem(AUTO_PRINT_KEY) === "on";
  } catch {
    return autoPrintFallback;
  }
}

function writeAutoPrint(on: boolean): void {
  autoPrintFallback = on;
  try {
    window.localStorage.setItem(AUTO_PRINT_KEY, on ? "on" : "off");
  } catch {
    // 위의 메모리 값으로 버틴다.
  }
  // `storage` 이벤트는 **다른** 탭에만 온다. 이 탭의 구독자는 직접 깨운다.
  autoPrintListeners.forEach((listener) => listener());
}

function subscribeAutoPrint(listener: () => void): () => void {
  autoPrintListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    autoPrintListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * 장바구니 한 줄의 **화면 상태**. 할인은 센트가 아니라 사용자가 친 문자열 그대로
 * 들고 있는다. 매 입력마다 센트로 갔다 오면 "19.9" 가 커서 아래에서 "19.90" 으로
 * 바뀌어 다음 글자를 칠 수 없게 된다. 센트 변환은 계산 직전에 한 번만 한다.
 */
type CartEntry = {
  product: Product;
  quantity: number;
  discountInput: string;
};

type Props = {
  products: Product[];
  loading: boolean;
  /** 서버가 없어서 예시 데이터를 보고 있는 상태. 결제를 막는다. */
  demo: boolean;
  /** 판매가 성사되면 상품 목록(재고)을 다시 읽게 한다. */
  onSold: () => void;
  /** 스캐너를 듣는가. 탭이 숨겨져 있을 때 꺼야 Products 탭에서 쏜 스캔이 장바구니로 새지 않는다. */
  scanEnabled?: boolean;
  /** 스낵바처럼 한 분류만 파는 계산대. 칩 줄을 감추고 그 분류만 보인다. */
  lockedCategory?: RetailCategory;
};

/** 리테일 영수증 번호(`PH-20260915-0001`). 상품이 아니라 영수증을 쏜 경우를 알아본다. */
const RECEIPT_NO = /^PH-\d{8}-\d+$/i;

export default function RegisterTab({
  products,
  loading,
  demo,
  onSold,
  scanEnabled = true,
  lockedCategory,
}: Props) {
  const [search, setSearch] = useState("");
  const [pickedCategory, setCategory] = useState<RetailCategory | "All">("All");
  const category = lockedCategory ?? pickedCategory;

  const [entries, setEntries] = useState<CartEntry[]>([]);
  const [orderDiscountInput, setOrderDiscountInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [cashier, setCashier] = useState("");
  const [note, setNote] = useState("");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // 스캔 실패 문구는 검색칸 바로 밑에 띄운다. 결제 오류 자리(장바구니 안)는 휴대폰에서
  // 접힌 시트 속이라, 스캐너를 쏜 직원 눈에 안 보인다.
  const [scanNote, setScanNote] = useState("");
  const [receipt, setReceipt] = useState<Sale | null>(null);
  // 미리 구운 정적 HTML 은 세 번째 인자(꺼짐)로 그리고, 브라우저에서 저장된 값으로
  // 바꾼다. 첫 렌더에서 localStorage 를 읽으면 체크 상태가 달라져 하이드레이션이 어긋난다.
  const autoPrint = useSyncExternalStore(subscribeAutoPrint, readAutoPrint, () => false);

  // 판매 화면에는 **활성 상품만** 올린다. 비활성 상품이 격자에 섞이면 이미
  // 안 파는 물건을 눌러 찍게 된다.
  //
  // 서버에는 `?active=true` 가 있지만 여기서는 클라이언트에서 거른다. 서버 구현이
  // `bool(is_active) is True` 라 아래 조건과 **결과가 완전히 같고**, 페이지가 이미
  // 상품 목록을 한 번 읽었기 때문이다(Products 탭은 재활성화를 위해 비활성 상품도
  // 봐야 해서 필터 없는 목록이 필요하다). 여기서 따로 한 번 더 읽으면 같은 자료를
  // 두 번 받는 데다, 계산대에서 팔린 재고가 두 목록에 다르게 반영되는 순간이 생긴다.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products
      .filter((item) => item.is_active)
      .filter((item) => (category === "All" ? true : item.category === category))
      .filter((item) =>
        needle
          ? item.name.toLowerCase().includes(needle) || item.sku.toLowerCase().includes(needle)
          : true,
      );
  }, [category, products, search]);

  const orderDiscount = parseMoney(orderDiscountInput);
  // 계산에 쓰는 모양(센트 정수)으로 한 번만 옮긴다.
  const lines: CartLine[] = useMemo(
    () =>
      entries.map((entry) => ({
        product: entry.product,
        quantity: entry.quantity,
        discount: parseMoney(entry.discountInput),
      })),
    [entries],
  );
  const totals = useMemo(
    () => computeCartTotals(lines, orderDiscount),
    [lines, orderDiscount],
  );
  const itemCount = entries.reduce((sum, entry) => sum + entry.quantity, 0);

  function addToCart(product: Product) {
    setError("");
    setReceipt(null);
    setEntries((current) => {
      // 같은 상품을 다시 누르면 줄을 하나 더 만들지 않고 수량을 올린다.
      // 같은 product_id 가 두 줄로 가면 서버에서 재고가 두 번 깎일 위험도 있다.
      const index = current.findIndex((entry) => entry.product.id === product.id);
      if (index === -1) return [...current, { product, quantity: 1, discountInput: "" }];
      const next = [...current];
      next[index] = { ...next[index], quantity: next[index].quantity + 1 };
      return next;
    });
  }

  /**
   * 스캔 = SKU **정확 일치**(대소문자 무시 — 백엔드 `_sku_key` 와 같은 규칙).
   * 부분 일치로 담으면 `PH-BALL` 을 쏘았는데 `PH-BALL-PV1` 이 담기는 식의 사고가 난다.
   * 공산품의 UPC 로 찾으려면 상품의 SKU 칸에 그 UPC 를 등록해 둬야 한다(Products 탭에서 스캔).
   */
  function addBySku(raw: string): boolean {
    const wanted = raw.trim().toLowerCase();
    const product = products.find(
      (item) =>
        item.is_active &&
        item.sku.trim().toLowerCase() === wanted &&
        (lockedCategory ? item.category === lockedCategory : true),
    );
    if (!product) return false;
    addToCart(product);
    return true;
  }

  function handleScan(code: string) {
    // 검색칸에서 쏜 스캔이면 칸에 글자(IME 가 한글이면 자모)가 남아 있다. 비운다.
    setSearch("");
    if (addBySku(code)) {
      setScanNote("");
      return;
    }
    setScanNote(
      RECEIPT_NO.test(code)
        ? `"${code}" is a receipt, not a product. Look it up on the Sales tab.`
        : `No product with barcode "${code}". Add it on the Products tab (scan into the SKU field).`,
    );
  }

  useBarcodeScanner(handleScan, { enabled: scanEnabled && !loading });

  /** 스캐너가 아닌 손으로 SKU 를 다 치고 Enter 를 눌러도 담는다. 스캔은 훅이 먼저 가로챈다. */
  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (search.trim() && addBySku(search)) {
      event.preventDefault();
      setSearch("");
      setScanNote("");
    }
  }

  function changeQuantity(productId: number, delta: number) {
    setEntries((current) =>
      current
        .map((entry) =>
          entry.product.id === productId
            ? { ...entry, quantity: entry.quantity + delta }
            : entry,
        )
        // 수량이 0 이 되면 줄을 지운다. 0개짜리 줄이 남아 있는 영수증은 없다.
        .filter((entry) => entry.quantity > 0),
    );
  }

  function setLineDiscount(productId: number, raw: string) {
    setEntries((current) =>
      current.map((entry) =>
        entry.product.id === productId ? { ...entry, discountInput: raw } : entry,
      ),
    );
  }

  function removeLine(productId: number) {
    setEntries((current) => current.filter((entry) => entry.product.id !== productId));
  }

  function resetSale() {
    setEntries([]);
    setOrderDiscountInput("");
    setNote("");
    setReceipt(null);
    setError("");
    setSheetOpen(false);
  }

  async function charge() {
    if (demo || lines.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const sale = await retailApi.createSale(
        toSaleCreate(lines, { orderDiscount, paymentMethod, cashier, note }),
      );
      // 영수증은 **서버 응답**으로 그린다. 화면 미리보기와 서버 계산이 어긋났다면
      // 그 사실이 영수증에 그대로 드러나야 한다 — 덮어 두면 마감 때 발견한다.
      setReceipt(sale);
      // 인쇄는 다음 틱으로 미룬다. `window.print()` 는 대화상자가 닫힐 때까지 스크립트를
      // 멈추므로, 여기서 바로 부르면 비워진 장바구니와 영수증 화면이 인쇄가 끝난 뒤에야 그려진다.
      if (autoPrint) window.setTimeout(() => printReceipt(sale), 0);
      setEntries([]);
      setOrderDiscountInput("");
      setNote("");
      onSold();
    } catch (cause) {
      setError(toRetailError(cause).message);
    } finally {
      setSubmitting(false);
    }
  }

  const cartBody = (
    <CartBody
      autoPrint={autoPrint}
      cashier={cashier}
      demo={demo}
      entries={entries}
      error={error}
      lineTotals={totals.lineTotals}
      note={note}
      onAutoPrint={writeAutoPrint}
      onCashier={setCashier}
      onCharge={charge}
      onLineDiscount={setLineDiscount}
      onNote={setNote}
      onOrderDiscount={setOrderDiscountInput}
      onPaymentMethod={setPaymentMethod}
      onQuantity={changeQuantity}
      onRemove={removeLine}
      onReset={resetSale}
      orderDiscountInput={orderDiscountInput}
      paymentMethod={paymentMethod}
      receipt={receipt}
      submitting={submitting}
      totals={totals}
    />
  );

  return (
    <>
      {/* 트랙을 minmax(0,1fr) 로 못박는다. auto 트랙은 max-content 로 부풀어서
          안쪽 격자가 좁은 화면을 통째로 가로로 밀어낸다. */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="grid gap-2">
            <TextInput
              aria-label="Search products by name or SKU"
              data-scan-target=""
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Scan a barcode, or search name or SKU…"
              type="search"
              value={search}
            />
            {scanNote ? <ErrorNote>{scanNote}</ErrorNote> : null}
            {/* 칩 줄은 자기 자신 안에서 가로 스크롤한다. 페이지를 밀면 안 된다. */}
            <div
              className={`-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 ${lockedCategory ? "hidden" : ""}`}
            >
              <Chip active={category === "All"} onClick={() => setCategory("All")}>
                All
              </Chip>
              {RETAIL_CATEGORIES.map((name) => (
                <Chip active={category === name} key={name} onClick={() => setCategory(name)}>
                  {name}
                </Chip>
              ))}
            </div>
          </div>

          <div className="mt-3 min-w-0">
            {loading ? (
              <SkeletonCards count={9} />
            ) : visible.length === 0 ? (
              <EmptyNote>No products match that search.</EmptyNote>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                {visible.map((product) => (
                  <ProductButton
                    key={product.id}
                    onAdd={() => addToCart(product)}
                    product={product}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 하단 고정 줄에 가리지 않도록 모바일에서만 여백을 둔다. */}
          {itemCount > 0 || receipt ? <div className="h-24 lg:hidden" /> : null}
        </div>

        {/* 데스크톱: 오른쪽에 붙는 장바구니. */}
        <aside className="hidden min-w-0 lg:block">
          <div className="sticky top-3 border border-[#d4d4d8] bg-white">{cartBody}</div>
        </aside>
      </div>

      {/* 모바일: 담긴 것이 있을 때만 합계 줄이 화면 아래에 붙는다.
          z-40 인 이유 — 어드민 서랍(z-50)이 열리면 그쪽이 이겨야 한다. */}
      {(itemCount > 0 || receipt) && !sheetOpen ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#d4d4d8] bg-white pb-safe lg:hidden">
          <button
            className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
            onClick={() => setSheetOpen(true)}
            type="button"
          >
            <span className="min-w-0">
              <span className="block text-xs font-bold text-[#6b7280]">
                {receipt ? `Receipt ${receipt.receipt_no}` : `${itemCount} item${itemCount === 1 ? "" : "s"}`}
              </span>
              <span className="block text-lg font-bold tabular-nums">
                {formatMoney(receipt ? receipt.total : totals.total)}
              </span>
            </span>
            <span className="shrink-0 bg-[#4533ff] px-4 py-2.5 text-sm font-bold text-white">
              {receipt ? "View" : "Review"}
            </span>
          </button>
        </div>
      ) : null}

      {sheetOpen ? (
        <CartSheet onClose={() => setSheetOpen(false)} title={receipt ? "Receipt" : "Cart"}>
          {cartBody}
        </CartSheet>
      ) : null}
    </>
  );
}

/**
 * 모바일 장바구니 시트. 별도 컴포넌트인 이유는 `useOverlayDismiss` 때문이다 —
 * 훅은 조건부로 호출할 수 없으므로, "열렸을 때만 존재하는" 컴포넌트로 감싸서
 * 마운트/언마운트에 Esc 처리와 body 스크롤 잠금을 태운다.
 */
function CartSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useOverlayDismiss(onClose);
  return (
    // z-40: 어드민 서랍(z-50)이 함께 열리면 그쪽이 이겨야 한다.
    <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
      <button
        aria-label="Close cart"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        type="button"
      />
      <div className="relative flex max-h-[88dvh] flex-col overflow-hidden bg-white">
        <header className="flex items-center justify-between border-b border-[#d4d4d8] px-3 py-2.5">
          <h2 className="text-sm font-bold">{title}</h2>
          <button
            aria-label="Close cart"
            className="tap-target -mr-2 flex items-center justify-center text-xl leading-none"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden>×</span>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto pb-safe">{children}</div>
      </div>
    </div>
  );
}

// ===== 상품 카드 ========================================================

function ProductButton({ product, onAdd }: { product: Product; onAdd: () => void }) {
  // 재고 개념이 없는 렌탈은 `stock: null` 이다. 0 과 구분하지 않으면 "품절" 로
  // 보여서 팔 수 있는 것을 못 팔게 된다.
  const out = product.stock !== null && product.stock <= 0;
  return (
    <button
      className={`flex min-h-[104px] min-w-0 flex-col justify-between gap-1 border p-2.5 text-left ${
        out
          ? "border-[#e2c4c4] bg-[#fdf6f6]"
          : "border-[#d4d4d8] bg-white hover:border-[#4533ff] active:bg-[#f2f2f4]"
      }`}
      onClick={onAdd}
      type="button"
    >
      <span className="line-clamp-3 text-sm leading-tight font-bold">{product.name}</span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] text-[#6b7280]">{product.sku}</span>
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-base font-bold tabular-nums">{formatMoney(product.price)}</span>
          <span className={`text-[11px] ${out ? "font-bold text-[#8a1f1f]" : "text-[#6b7280]"}`}>
            {product.stock === null ? "—" : out ? "Out" : `${product.stock} left`}
          </span>
        </span>
      </span>
    </button>
  );
}

// ===== 장바구니 본문 ====================================================
//
// 데스크톱 사이드바와 모바일 시트가 **같은 컴포넌트**를 쓴다. 두 벌로 만들면
// 한쪽에만 필드가 추가되어 "휴대폰에서는 메모를 못 남긴다" 같은 차이가 생긴다.

type CartBodyProps = {
  entries: CartEntry[];
  lineTotals: number[];
  totals: ReturnType<typeof computeCartTotals>;
  orderDiscountInput: string;
  paymentMethod: PaymentMethod;
  cashier: string;
  note: string;
  demo: boolean;
  submitting: boolean;
  error: string;
  receipt: Sale | null;
  onQuantity: (productId: number, delta: number) => void;
  onLineDiscount: (productId: number, raw: string) => void;
  onRemove: (productId: number) => void;
  onOrderDiscount: (raw: string) => void;
  onPaymentMethod: (method: PaymentMethod) => void;
  onCashier: (value: string) => void;
  onNote: (value: string) => void;
  onCharge: () => void;
  onReset: () => void;
  /** 결제가 끝나면 영수증을 바로 인쇄할지. 이 브라우저에만 저장된다. */
  autoPrint: boolean;
  onAutoPrint: (on: boolean) => void;
};

function CartBody(props: CartBodyProps) {
  const { receipt } = props;
  if (receipt) return <ReceiptBody onReset={props.onReset} sale={receipt} />;

  const {
    autoPrint,
    cashier,
    demo,
    entries,
    error,
    lineTotals,
    note,
    onAutoPrint,
    onCashier,
    onCharge,
    onLineDiscount,
    onNote,
    onOrderDiscount,
    onPaymentMethod,
    onQuantity,
    onRemove,
    orderDiscountInput,
    paymentMethod,
    submitting,
    totals,
  } = props;

  return (
    <div className="grid gap-3 p-3">
      <h2 className="hidden text-sm font-bold lg:block">Cart</h2>

      {entries.length === 0 ? (
        <EmptyNote>Tap a product to start a sale.</EmptyNote>
      ) : (
        <ul className="grid gap-2">
          {entries.map((entry, index) => (
            <li className="min-w-0 border border-[#e4e4e8] p-2" key={entry.product.id}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-sm leading-tight font-bold">
                    {entry.product.name}
                  </span>
                  <span className="block text-[11px] text-[#6b7280]">
                    {formatMoney(entry.product.price)} each
                  </span>
                </span>
                <button
                  aria-label={`Remove ${entry.product.name}`}
                  className="tap-target -mt-1 -mr-1 flex shrink-0 items-center justify-center text-lg leading-none text-[#8a1f1f]"
                  onClick={() => onRemove(entry.product.id)}
                  type="button"
                >
                  <span aria-hidden>×</span>
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center">
                  <button
                    aria-label={`Decrease ${entry.product.name}`}
                    className="tap-target flex items-center justify-center border border-[#d4d4d8] text-lg font-bold"
                    onClick={() => onQuantity(entry.product.id, -1)}
                    type="button"
                  >
                    <span aria-hidden>−</span>
                  </button>
                  <span className="min-w-11 px-1 text-center text-base font-bold tabular-nums">
                    {entry.quantity}
                  </span>
                  <button
                    aria-label={`Increase ${entry.product.name}`}
                    className="tap-target flex items-center justify-center border border-[#d4d4d8] text-lg font-bold"
                    onClick={() => onQuantity(entry.product.id, 1)}
                    type="button"
                  >
                    <span aria-hidden>+</span>
                  </button>
                </div>
                <span className="text-base font-bold tabular-nums">
                  {formatMoney(lineTotals[index] ?? 0)}
                </span>
              </div>

              <label className="mt-2 flex items-center gap-2 text-xs">
                <span className="shrink-0 font-bold text-[#6b7280]">Line discount</span>
                <TextInput
                  aria-label={`Discount on ${entry.product.name}`}
                  className="min-h-11 flex-1"
                  inputMode="decimal"
                  onChange={(event) => onLineDiscount(entry.product.id, event.target.value)}
                  placeholder="0.00"
                  value={entry.discountInput}
                />
              </label>
            </li>
          ))}
        </ul>
      )}

      <Field label="Order discount">
        <TextInput
          inputMode="decimal"
          onChange={(event) => onOrderDiscount(event.target.value)}
          placeholder="0.00"
          value={orderDiscountInput}
        />
      </Field>

      {/* 소계 → HST → 합계. 전부 센트 정수로 계산하고 여기서만 문자열로 바꾼다. */}
      <dl className="grid gap-1 border-t border-[#d4d4d8] pt-2 text-sm">
        <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
        {totals.discount > 0 ? (
          <Row label="Order discount" value={`−${formatMoney(totals.discount)}`} />
        ) : null}
        <Row label="HST (13%)" value={formatMoney(totals.tax)} />
        <div className="flex items-baseline justify-between gap-2 border-t border-[#d4d4d8] pt-1.5">
          <dt className="font-bold">Total</dt>
          <dd className="text-xl font-bold tabular-nums">{formatMoney(totals.total)}</dd>
        </div>
      </dl>

      <Field label="Payment method">
        <Select
          onChange={(event) => onPaymentMethod(event.target.value as PaymentMethod)}
          value={paymentMethod}
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {PAYMENT_LABELS[method]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Cashier">
        <TextInput
          autoComplete="off"
          onChange={(event) => onCashier(event.target.value)}
          placeholder="Who rang this in"
          value={cashier}
        />
      </Field>

      <Field label="Note">
        <TextArea
          onChange={(event) => onNote(event.target.value)}
          placeholder="Optional — member number, special order…"
          value={note}
        />
      </Field>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {demo ? (
        <p className="bg-[#fff8e1] px-2 py-2 text-xs text-[#5b4708]">
          예시 데이터입니다. 서버에 연결되기 전까지는 결제를 기록할 수 없습니다.
        </p>
      ) : null}

      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          checked={autoPrint}
          className="h-5 w-5 accent-[#4533ff]"
          onChange={(event) => onAutoPrint(event.target.checked)}
          type="checkbox"
        />
        Print receipt after charge
      </label>

      <Button
        className="min-h-14 text-base"
        disabled={demo || submitting || entries.length === 0}
        full
        onClick={onCharge}
        tone="primary"
      >
        {submitting ? "Charging…" : `Charge ${formatMoney(totals.total)}`}
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[#6b7280]">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

// ===== 영수증 ===========================================================

function ReceiptBody({ sale, onReset }: { sale: Sale; onReset: () => void }) {
  return (
    <div className="grid gap-3 p-3">
      <div>
        <p className="text-xs font-bold tracking-wide text-[#6b7280] uppercase">Sale complete</p>
        <p className="text-lg font-bold">{sale.receipt_no}</p>
        <p className="text-xs text-[#6b7280]">
          {sale.business_date} · {PAYMENT_LABELS[sale.payment_method]}
          {sale.cashier ? ` · ${sale.cashier}` : ""}
        </p>
      </div>

      <ul className="grid gap-1 border-y border-[#d4d4d8] py-2 text-sm">
        {sale.lines.map((line) => (
          <li className="flex items-baseline justify-between gap-2" key={line.product_id}>
            <span className="min-w-0 truncate">
              {line.quantity}× {line.name}
            </span>
            <span className="shrink-0 tabular-nums">{formatMoney(line.line_total)}</span>
          </li>
        ))}
      </ul>

      <dl className="grid gap-1 text-sm">
        <Row label="Subtotal" value={formatMoney(sale.subtotal)} />
        {sale.discount > 0 ? (
          <Row label="Order discount" value={`−${formatMoney(sale.discount)}`} />
        ) : null}
        <Row label="HST" value={formatMoney(sale.tax)} />
        <div className="flex items-baseline justify-between gap-2 border-t border-[#d4d4d8] pt-1.5">
          <dt className="font-bold">Total</dt>
          <dd className="text-xl font-bold tabular-nums">{formatMoney(sale.total)}</dd>
        </div>
      </dl>

      {sale.note ? <p className="text-xs text-[#6b7280]">{sale.note}</p> : null}

      <Button className="min-h-12" full onClick={() => printReceipt(sale)}>
        Print receipt
      </Button>
      <Button className="min-h-14 text-base" full onClick={onReset} tone="primary">
        New sale
      </Button>
    </div>
  );
}
