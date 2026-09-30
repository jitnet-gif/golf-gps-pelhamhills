"use client";

/**
 * 합산 계산서 한 장. 리테일 계산대·스낵바·티 시트가 **같은 컴포넌트**를 쓴다 — 두 벌이면
 * 한쪽에만 결제 규칙이 추가된다.
 *
 * 결제 순서(단말기가 앱과 연동되기 전, "keyed")
 * 1. 계산서가 다 차면 결제 줄을 하나씩 더한다. 카드·체크카드 줄을 더하는 순간 서버에서 합계를
 *    다시 읽는다 — 직원이 DX8000 에 치는 금액이 곧 그 값이다.
 * 2. 직원이 DX8000 에서 그 금액을 받고, 단말기 전표의 승인번호를 여기 적는다.
 * 3. 남은 금액이 0 이 되면 Charge. 서버는 한 트랜잭션에서 재고·티 시트 paid·영수증 번호를 처리한다.
 *
 * 현금은 받은 돈을 적으면 거스름돈을 보여 주고, 서버에는 **계산서에 들어간 몫**만 보낸다
 * (서버는 결제 합이 합계와 정확히 같아야 받는다).
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { newCheckoutId, TERMINAL_METHODS, type Bill, type BillStation, type PaymentInput } from "@/lib/pos/api";
import { billActions, useCurrentBill } from "@/lib/pos/currentBill";
import { printReceipt } from "@/lib/retail/printReceipt";
import { PAYMENT_LABELS } from "@/lib/retail/receipt";
import { PAYMENT_METHODS, formatMoney, parseMoney, type PaymentMethod, type Sale } from "@/lib/retail/types";

import { Button, EmptyNote, ErrorNote, Field, Select, TextInput } from "@/components/retail/ui";

// ===== 자동 인쇄 스위치 (이 브라우저에만) ==============================

const AUTO_PRINT_KEY = "pelham.retail.autoPrint";
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
    // 메모리 값으로 버틴다.
  }
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

// ===== 본체 ============================================================

type PendingPayment = PaymentInput & { key: number; cashReceived?: number };

/** 서버에 보내는 모양. 화면용 key·받은 현금은 뺀다. */
function toPaymentInput(payment: PendingPayment): PaymentInput {
  return {
    method: payment.method,
    amount: payment.amount,
    ...(payment.tip ? { tip: payment.tip } : {}),
    ...(payment.auth_code ? { auth_code: payment.auth_code } : {}),
    ...(payment.card_last4 ? { card_last4: payment.card_last4 } : {}),
  };
}

type Props = {
  station: BillStation;
  /** 서버 없이 예시 데이터를 보는 중. 계산서를 만들지 않는다. */
  demo?: boolean;
  /** 결제가 끝났을 때(재고를 다시 읽는 등). */
  onPaid?: (bill: Bill) => void;
  /** 값이 (0 이 아닌 값으로) 바뀌면 결제 칸으로 스크롤한다. 계산대에서 스캔으로 담았을 때. */
  revealPayments?: number;
};

export default function BillPanel({ station, demo = false, onPaid, revealPayments = 0 }: Props) {
  const current = useCurrentBill();
  const { bill, openBills, busy, error, missing } = current;
  const autoPrint = useSyncExternalStore(subscribeAutoPrint, readAutoPrint, () => false);

  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [charging, setCharging] = useState(false);

  // 결제 한 번 = checkout_id 하나. 계산서나 결제 줄이 바뀌면 새로 만든다. 연결이 끊겨 다시
  // 누르는 경우에만 같은 값을 쓴다 — 서버가 같은 결제를 두 번 받지 않는다.
  const checkoutRef = useRef<string>("");
  const paymentsKey = JSON.stringify(payments.map(toPaymentInput));
  useEffect(() => {
    checkoutRef.current = "";
  }, [bill?.id, bill?.total, paymentsKey]);

  // 다른 계산서로 옮겨 타면 적어 둔 결제 줄은 버린다(그 계산서의 돈이 아니다).
  const billId = bill?.id ?? null;
  const [paymentsFor, setPaymentsFor] = useState<number | null>(billId);
  if (paymentsFor !== billId) {
    setPaymentsFor(billId);
    setPayments([]);
  }

  const paymentsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!revealPayments) return;
    // 숨겨진 쪽(데스크톱의 모바일 시트, 휴대폰의 옆 계산서)은 크기가 없어 아무 일도 안 한다.
    paymentsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [revealPayments]);

  const total = bill?.total ?? 0;
  const paidSoFar = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const remaining = Math.max(total - paidSoFar, 0);
  const lines = bill?.lines ?? [];

  // 전액 할인(컴프·GolfNow 선결제 등)이면 받을 돈이 없다. 결제 줄 없이 닫는다.
  const noCharge = Boolean(bill) && lines.length > 0 && total === 0;
  const canCharge = remaining === 0 && (payments.length > 0 || noCharge);

  async function charge() {
    if (!bill || !canCharge || charging) return;
    setCharging(true);
    if (!checkoutRef.current) checkoutRef.current = newCheckoutId();
    const paid = await billActions.pay(checkoutRef.current, payments.map(toPaymentInput));
    setCharging(false);
    if (!paid) return;
    setReceipt(paid);
    setPayments([]);
    onPaid?.(paid);
    // 인쇄는 다음 틱으로. `window.print()` 가 스크립트를 멈추면 비워진 화면이 인쇄 뒤에야 그려진다.
    if (autoPrint) window.setTimeout(() => printReceipt(paid), 0);
  }

  if (receipt) {
    return <PaidReceipt onDone={() => setReceipt(null)} sale={receipt} />;
  }

  return (
    <div className="grid gap-3 p-3">
      <BillHeader bill={bill} busy={busy} demo={demo} openBills={openBills} />

      {missing ? <ErrorNote>{error}</ErrorNote> : null}

      {lines.length === 0 ? (
        <EmptyNote>
          {station === "tee_sheet"
            ? "Pick a reservation and press Add to bill. Products scanned at the register land on the same bill."
            : station === "simulator"
              ? "Pick a bay booking and press Pay. Products scanned at the register land on the same bill."
              : "Scan or tap a product to start. Green fees and simulator bays added on their sheets show up here too."}
        </EmptyNote>
      ) : (
        <ul className="grid gap-2">
          {lines.map((line) => (
            <BillLineRow key={line.id} line={line} station={station} />
          ))}
        </ul>
      )}

      {bill && lines.length > 0 ? (
        <>
          <MoneyField
            key={`discount-${bill.id}-${bill.discount}`}
            initial={bill.discount}
            label="Bill discount"
            onCommit={(cents) => billActions.update({ discount: cents }, station)}
          />

          <dl className="grid gap-1 border-t border-[#d4d4d8] pt-2 text-sm">
            <Row label="Subtotal" value={formatMoney(bill.subtotal)} />
            {bill.discount > 0 ? <Row label="Discount" value={`−${formatMoney(bill.discount)}`} /> : null}
            <Row label="HST (13%)" value={formatMoney(bill.tax)} />
            <div className="flex items-baseline justify-between gap-2 border-t border-[#d4d4d8] pt-1.5">
              <dt className="font-bold">Total</dt>
              <dd className="text-xl font-bold tabular-nums">{formatMoney(bill.total)}</dd>
            </div>
          </dl>

          <div ref={paymentsRef}>
            <PaymentsEditor
              payments={payments}
              remaining={remaining}
              setPayments={setPayments}
            />
          </div>

          <TextField
            key={`cashier-${bill.id}`}
            initial={bill.cashier ?? ""}
            label="Cashier"
            onCommit={(value) => billActions.update({ cashier: value }, station)}
            placeholder="Who rang this in"
          />
        </>
      ) : null}

      {error && !missing ? <ErrorNote>{error}</ErrorNote> : null}

      {demo ? (
        <p className="bg-[#fff8e1] px-2 py-2 text-xs text-[#5b4708]">
          예시 데이터입니다. 서버에 연결되기 전까지는 계산서를 만들 수 없습니다.
        </p>
      ) : null}

      {bill && lines.length > 0 ? (
        <>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              checked={autoPrint}
              className="h-5 w-5 accent-[#4533ff]"
              onChange={(event) => writeAutoPrint(event.target.checked)}
              type="checkbox"
            />
            Print receipt after charge
          </label>
          <Button
            className="min-h-14 text-base"
            disabled={demo || charging || busy || !canCharge}
            full
            onClick={() => void charge()}
            tone="primary"
          >
            {charging
              ? "Charging…"
              : noCharge
                ? "Close bill — no charge"
                : canCharge
                  ? `Charge ${formatMoney(total)}`
                  : `Add payments — ${formatMoney(remaining)} left`}
          </Button>
        </>
      ) : null}
    </div>
  );
}

// ===== 머리: 열린 계산서 목록 ===========================================

function BillHeader({
  bill,
  openBills,
  busy,
  demo,
}: {
  bill: Bill | null;
  openBills: Bill[];
  busy: boolean;
  demo: boolean;
}) {
  const others = openBills.filter((item) => item.id !== bill?.id);
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">
          {bill ? `Bill #${bill.id}` : "New bill"}
          {busy ? <span className="ml-2 text-xs font-normal text-[#6b7280]">saving…</span> : null}
        </h2>
        {bill ? (
          <div className="flex gap-1.5">
            <Button className="min-h-9 px-2 text-xs" onClick={() => billActions.park()} title="Keep this bill open and start another">
              Hold
            </Button>
            <Button
              className="min-h-9 px-2 text-xs"
              onClick={() => void billActions.voidBill(bill.id)}
              title="Throw this bill away. Nothing was charged."
              tone="danger"
            >
              Void
            </Button>
          </div>
        ) : null}
      </div>
      {others.length > 0 && !demo ? (
        <Select
          aria-label="Switch to another open bill"
          onChange={(event) => {
            const id = Number(event.target.value);
            if (id) void billActions.select(id);
          }}
          value=""
        >
          <option value="">{`${others.length} other open bill${others.length === 1 ? "" : "s"} — switch…`}</option>
          {others.map((item) => (
            <option key={item.id} value={item.id}>
              {`#${item.id} · ${formatMoney(item.total)} · ${item.lines.length} line${item.lines.length === 1 ? "" : "s"}${
                item.label ? ` · ${item.label}` : ""
              }`}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}

// ===== 줄 ==============================================================

function BillLineRow({ line, station }: { line: Bill["lines"][number]; station: BillStation }) {
  // 그린피·베이 줄은 예약 하나 = 한 줄. 수량을 바꿀 수 없다.
  const isTee = line.kind === "tee_player";
  const isSim = line.kind === "sim_booking";
  return (
    <li className="min-w-0 border border-[#e4e4e8] p-2">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm leading-tight font-bold">{line.name}</span>
          <span className="block text-[11px] text-[#6b7280]">
            {isTee
              ? `Tee sheet · ${line.tee_date ?? ""}`
              : isSim
                ? `Bay Sheet · ${line.tee_date ?? ""}`
                : `${line.sku} · ${formatMoney(line.unit_price)} each`}
          </span>
        </span>
        <button
          aria-label={`Remove ${line.name}`}
          className="tap-target -mt-1 -mr-1 flex shrink-0 items-center justify-center text-lg leading-none text-[#8a1f1f]"
          onClick={() => void billActions.setQuantity(line.id, 0, station)}
          type="button"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {isTee || isSim ? (
          <span className="text-xs text-[#6b7280]">{isTee ? "1 player" : "1 booking"}</span>
        ) : (
          <div className="flex items-center">
            <button
              aria-label={`Decrease ${line.name}`}
              className="tap-target flex items-center justify-center border border-[#d4d4d8] text-lg font-bold"
              onClick={() => void billActions.setQuantity(line.id, line.quantity - 1, station)}
              type="button"
            >
              <span aria-hidden>−</span>
            </button>
            <span className="min-w-11 px-1 text-center text-base font-bold tabular-nums">{line.quantity}</span>
            <button
              aria-label={`Increase ${line.name}`}
              className="tap-target flex items-center justify-center border border-[#d4d4d8] text-lg font-bold"
              onClick={() => void billActions.setQuantity(line.id, line.quantity + 1, station)}
              type="button"
            >
              <span aria-hidden>+</span>
            </button>
          </div>
        )}
        <span className="text-base font-bold tabular-nums">{formatMoney(line.line_total)}</span>
      </div>
      <MoneyField
        compact
        key={`d-${line.id}-${line.discount}`}
        initial={line.discount}
        label="Line discount"
        onCommit={(cents) => billActions.setLineDiscount(line.id, cents, station)}
      />
    </li>
  );
}

// ===== 결제 줄 ==========================================================

function PaymentsEditor({
  payments,
  remaining,
  setPayments,
}: {
  payments: PendingPayment[];
  remaining: number;
  setPayments: (update: (current: PendingPayment[]) => PendingPayment[]) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [amountInput, setAmountInput] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [last4, setLast4] = useState("");
  const [formError, setFormError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const keyRef = useRef(1);

  const needsTerminal = TERMINAL_METHODS.includes(method);
  const typed = amountInput.trim() ? parseMoney(amountInput) : remaining;

  const change = method === "cash" && typed > remaining ? typed - remaining : 0;

  async function add() {
    setFormError("");
    if (needsTerminal) {
      // 단말기에 칠 금액은 서버의 합계다. 더하기 직전에 다시 읽는다.
      setPreparing(true);
      const fresh = await billActions.reload();
      setPreparing(false);
      if (!fresh) return;
      const freshRemaining = Math.max(fresh.total - payments.reduce((sum, p) => sum + p.amount, 0), 0);
      if (typed > freshRemaining) {
        setFormError(`Only ${formatMoney(freshRemaining)} is left on the bill. Check the amount on the terminal.`);
        return;
      }
      if (!authCode.trim()) {
        setFormError("Enter the approval code printed by the Chase terminal.");
        return;
      }
      if (last4 && !/^\d{4}$/.test(last4)) {
        setFormError("Last 4 must be four digits.");
        return;
      }
    }
    if (typed <= 0) {
      setFormError("Enter an amount above $0.00.");
      return;
    }
    // 현금은 받은 돈이 남은 금액보다 많아도 된다(거스름돈). 계산서에는 남은 금액만큼만 들어간다.
    const applied = method === "cash" ? Math.min(typed, remaining) : typed;
    if (applied > remaining) {
      setFormError(`Only ${formatMoney(remaining)} is left on the bill.`);
      return;
    }
    const key = keyRef.current++;
    setPayments((current) => [
      ...current,
      {
        key,
        method,
        amount: applied,
        ...(method === "cash" ? { cashReceived: typed } : {}),
        ...(needsTerminal ? { auth_code: authCode.trim(), ...(last4 ? { card_last4: last4 } : {}) } : {}),
      },
    ]);
    setAmountInput("");
    setAuthCode("");
    setLast4("");
  }

  return (
    <div className="grid gap-2 border-t border-[#d4d4d8] pt-2">
      <h3 className="text-xs font-bold tracking-wide text-[#6b7280] uppercase">Payments</h3>
      {payments.length > 0 ? (
        <ul className="grid gap-1 text-sm">
          {payments.map((payment) => (
            <li className="flex items-baseline justify-between gap-2" key={payment.key}>
              <span className="min-w-0">
                {PAYMENT_LABELS[payment.method]}
                {payment.auth_code ? (
                  <span className="block text-[11px] text-[#6b7280]">
                    Approval {payment.auth_code}
                    {payment.card_last4 ? ` · ****${payment.card_last4}` : ""}
                  </span>
                ) : null}
                {payment.cashReceived && payment.cashReceived > payment.amount ? (
                  <span className="block text-[11px] font-bold text-[#1f6b3a]">
                    Change {formatMoney(payment.cashReceived - payment.amount)}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums">
                {formatMoney(payment.amount)}
                <button
                  aria-label={`Remove ${PAYMENT_LABELS[payment.method]} payment`}
                  className="text-[#8a1f1f]"
                  onClick={() => setPayments((current) => current.filter((item) => item.key !== payment.key))}
                  type="button"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {remaining > 0 ? (
        <div className="grid gap-2 bg-[#f6f6f8] p-2">
          <p className="text-sm font-bold">Left to pay: {formatMoney(remaining)}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Method">
              <Select onChange={(event) => setMethod(event.target.value as PaymentMethod)} value={method}>
                {PAYMENT_METHODS.map((item) => (
                  <option key={item} value={item}>
                    {PAYMENT_LABELS[item]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={method === "cash" ? "Cash received" : "Amount"}>
              <TextInput
                inputMode="decimal"
                onChange={(event) => setAmountInput(event.target.value)}
                placeholder={(remaining / 100).toFixed(2)}
                value={amountInput}
              />
            </Field>
          </div>
          {needsTerminal ? (
            <>
              <p className="text-xs text-[#5b4708]">
                Key <b>{formatMoney(typed)}</b> on the Chase DX8000. When it approves, copy the approval code from the
                terminal slip.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Approval code">
                  <TextInput
                    autoComplete="off"
                    onChange={(event) => setAuthCode(event.target.value)}
                    placeholder="e.g. 083412"
                    value={authCode}
                  />
                </Field>
                <Field label="Card last 4 (optional)">
                  <TextInput
                    autoComplete="off"
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => setLast4(event.target.value.replace(/\D/g, ""))}
                    placeholder="4242"
                    value={last4}
                  />
                </Field>
              </div>
            </>
          ) : null}
          {change > 0 ? (
            <p className="text-sm font-bold text-[#1f6b3a]">Change due: {formatMoney(change)}</p>
          ) : null}
          {formError ? <ErrorNote>{formError}</ErrorNote> : null}
          <Button disabled={preparing} full onClick={() => void add()}>
            {preparing ? "Checking total…" : `Add ${PAYMENT_LABELS[method]} payment`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ===== 작은 입력 ========================================================

/** 달러 입력칸. 치는 동안에는 문자열로 두고, 칸을 떠날 때 한 번만 서버에 보낸다. */
function MoneyField({
  initial,
  label,
  onCommit,
  compact = false,
}: {
  initial: number;
  label: string;
  onCommit: (cents: number) => void;
  compact?: boolean;
}) {
  const [value, setValue] = useState(initial > 0 ? (initial / 100).toFixed(2) : "");
  const commit = () => {
    const cents = value.trim() ? parseMoney(value) : 0;
    if (cents !== initial) onCommit(Math.max(cents, 0));
  };
  const input = (
    <TextInput
      aria-label={label}
      className={compact ? "min-h-11 flex-1" : undefined}
      inputMode="decimal"
      onBlur={commit}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      placeholder="0.00"
      value={value}
    />
  );
  if (compact) {
    return (
      <label className="mt-2 flex items-center gap-2 text-xs">
        <span className="shrink-0 font-bold text-[#6b7280]">{label}</span>
        {input}
      </label>
    );
  }
  return <Field label={label}>{input}</Field>;
}

function TextField({
  initial,
  label,
  placeholder,
  onCommit,
}: {
  initial: string;
  label: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Field label={label}>
      <TextInput
        autoComplete="off"
        onBlur={() => {
          if (value.trim() !== initial.trim()) onCommit(value);
        }}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </Field>
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

// ===== 결제 끝 ==========================================================

function PaidReceipt({ sale, onDone }: { sale: Sale; onDone: () => void }) {
  const methods = useMemo(
    () =>
      (sale.payments ?? []).map((payment, index) => (
        <li className="flex items-baseline justify-between gap-2" key={index}>
          <span>
            {PAYMENT_LABELS[payment.method]}
            {payment.auth_code ? <span className="text-[11px] text-[#6b7280]"> · {payment.auth_code}</span> : null}
          </span>
          <span className="tabular-nums">{formatMoney(payment.amount)}</span>
        </li>
      )),
    [sale.payments],
  );
  return (
    <div className="grid gap-3 p-3">
      <div>
        <p className="text-xs font-bold tracking-wide text-[#6b7280] uppercase">Paid</p>
        <p className="text-lg font-bold">{sale.receipt_no}</p>
        <p className="text-xs text-[#6b7280]">
          {sale.business_date}
          {sale.cashier ? ` · ${sale.cashier}` : ""}
        </p>
      </div>
      <ul className="grid gap-1 border-y border-[#d4d4d8] py-2 text-sm">
        {sale.lines.map((line, index) => (
          <li className="flex items-baseline justify-between gap-2" key={line.id ?? index}>
            <span className="min-w-0 truncate">
              {line.quantity}× {line.name}
            </span>
            <span className="shrink-0 tabular-nums">{formatMoney(line.line_total)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid gap-1 text-sm">
        <Row label="Subtotal" value={formatMoney(sale.subtotal)} />
        {sale.discount > 0 ? <Row label="Discount" value={`−${formatMoney(sale.discount)}`} /> : null}
        <Row label="HST" value={formatMoney(sale.tax)} />
        <div className="flex items-baseline justify-between gap-2 border-t border-[#d4d4d8] pt-1.5">
          <dt className="font-bold">Total</dt>
          <dd className="text-xl font-bold tabular-nums">{formatMoney(sale.total)}</dd>
        </div>
      </dl>
      <ul className="grid gap-1 text-sm">{methods}</ul>
      <Button className="min-h-12" full onClick={() => printReceipt(sale)}>
        Print receipt
      </Button>
      <Button className="min-h-14 text-base" full onClick={onDone} tone="primary">
        New bill
      </Button>
    </div>
  );
}
