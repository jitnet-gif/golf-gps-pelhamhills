"use client";

/**
 * 매출 내역과 마감. 하루가 끝나면 여기 숫자와 서랍 안의 현금이 맞아야 한다.
 *
 * 환불된 매출을 **목록에서 지우지 않는** 것이 이 화면의 핵심이다. 지우면 그 날
 * 합계가 갑자기 줄어들어서 대사(reconciliation)가 맞지 않고, 무엇이 사라졌는지
 * 아무도 모른다. 그래서 취소선 + 배지로 남기고 사유를 같이 보여 준다.
 */

import { useEffect, useMemo, useState } from "react";

import retailApi, { localBusinessDate, toRetailError } from "@/lib/retail/api";
import { printReceipt } from "@/lib/retail/printReceipt";
import { PAYMENT_LABELS, stationLabel } from "@/lib/retail/receipt";
import { formatMoney, type RetailDailyReport, type Sale } from "@/lib/retail/types";

import {
  Button,
  EmptyNote,
  ErrorNote,
  Field,
  Modal,
  Panel,
  SkeletonBar,
  SkeletonRows,
  StatCard,
  TextArea,
  TextInput,
} from "./ui";

type Props = {
  demo: boolean;
  /** 데모일 때 보여 줄 예시. 서버가 붙으면 무시된다. */
  demoSales?: Sale[];
  demoReport?: RetailDailyReport;
  demoDate?: string;
  /** 서버가 아예 없을 때(설정/네트워크). 요청을 시도하지 않는다. */
  offline: boolean;
};

export default function SalesTab({ demo, demoSales = [], demoReport, demoDate = "", offline }: Props) {
  const [date, setDate] = useState(() => (demo ? demoDate : localBusinessDate()));
  const [sales, setSales] = useState<Sale[]>([]);
  const [report, setReport] = useState<RetailDailyReport | null>(null);
  const [loading, setLoading] = useState(!offline);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Sale | null>(null);

  useEffect(() => {
    if (offline) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");

    // 두 요청 중 하나만 실패해도 나머지는 보여 준다. 리포트가 없다고 매출
    // 목록까지 감추면, 정작 대사에 필요한 원자료를 못 보게 된다.
    Promise.allSettled([retailApi.listSales(date), retailApi.getDailyReport(date)]).then(
      (results) => {
        if (cancelled) return;
        const [salesResult, reportResult] = results;
        if (salesResult.status === "fulfilled") setSales(salesResult.value);
        else setError(toRetailError(salesResult.reason).message);
        setReport(reportResult.status === "fulfilled" ? reportResult.value : null);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [date, offline]);

  const shownSales = demo ? demoSales : sales;
  const shownReport = demo ? (demoReport ?? null) : report;

  function applyRefund(updated: Sale) {
    setSales((current) => current.map((sale) => (sale.id === updated.id ? updated : sale)));
    setSelected(updated);
    // 리포트의 환불 건수·금액이 바뀌므로 다시 읽는다. 화면에서 손으로 더하면
    // 서버의 마감 숫자와 어긋난 값을 직원이 믿게 된다.
    if (!offline) {
      retailApi
        .getDailyReport(date)
        .then(setReport)
        .catch(() => setReport(null));
    }
  }

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid gap-2 sm:max-w-xs">
        <Field label="Business date">
          <TextInput
            disabled={demo}
            onChange={(event) => setDate(event.target.value)}
            type="date"
            value={demo ? demoDate : date}
          />
        </Field>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {loading && !demo ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonBar className="h-16 min-w-0" key={index} />
          ))}
        </div>
      ) : shownReport ? (
        <>
          {/* 각 칸의 의미는 계약(`types.ts` 의 리포트 주석)이 정해 둔 그대로 쓴다.
              여기서 다시 더하거나 빼지 않는다 — 특히 환불 건은 `gross`/`net` 에서
              서버가 **이미 빼 두었다.** 화면에서 또 빼면 이중 차감이 되고,
              그러면 마감 숫자가 서랍 속 현금과 영영 맞지 않는다. */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              hint="refunds excluded"
              label="Sales"
              value={String(shownReport.sale_count)}
            />
            <StatCard
              hint="before order discounts & tax"
              label="Gross"
              value={formatMoney(shownReport.gross)}
            />
            <StatCard
              hint="order-level only"
              label="Discounts"
              value={formatMoney(shownReport.discount)}
            />
            <StatCard label="Tax (HST)" value={formatMoney(shownReport.tax)} />
            <StatCard
              hint="gross − discounts + tax"
              label="Net"
              value={formatMoney(shownReport.net)}
            />
            <StatCard
              hint={`${shownReport.refunded_count} sale(s) · tax incl.`}
              label="Refunded"
              value={formatMoney(shownReport.refunded_total)}
            />
          </div>

          <div className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {/* 프로 샵·스낵바·티 시트·실내 베이 계산서가 한 장부라서, 어디서 팔렸는지는
                계산서를 연 자리(station)로만 나뉜다. 합이 위 Net 과 같다. */}
            <Panel title="By station">
              {!shownReport.by_station || shownReport.by_station.length === 0 ? (
                <EmptyNote>Nothing rung in yet.</EmptyNote>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {shownReport.by_station.map((row) => (
                    <li className="flex items-baseline justify-between gap-2" key={row.station}>
                      <span className="min-w-0 truncate">
                        {stationLabel(row.station)}{" "}
                        <span className="text-xs text-[#6b7280]">×{row.count}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMoney(row.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="By payment">
              {shownReport.by_payment.length === 0 ? (
                <EmptyNote>Nothing rung in yet.</EmptyNote>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {shownReport.by_payment.map((row) => (
                    <li className="flex items-baseline justify-between gap-2" key={row.method}>
                      <span className="min-w-0 truncate">
                        {PAYMENT_LABELS[row.method]}{" "}
                        <span className="text-xs text-[#6b7280]">×{row.count}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMoney(row.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="By category">
              {shownReport.by_category.length === 0 ? (
                <EmptyNote>Nothing rung in yet.</EmptyNote>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {shownReport.by_category.map((row) => (
                    <li className="flex items-baseline justify-between gap-2" key={row.category}>
                      <span className="min-w-0 truncate">
                        {row.category}{" "}
                        <span className="text-xs text-[#6b7280]">×{row.quantity}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMoney(row.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Top products">
              {shownReport.top_products.length === 0 ? (
                <EmptyNote>Nothing rung in yet.</EmptyNote>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {shownReport.top_products.map((row) => (
                    <li className="flex items-baseline justify-between gap-2" key={row.product_id}>
                      <span className="min-w-0 truncate">
                        {row.name} <span className="text-xs text-[#6b7280]">×{row.quantity}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMoney(row.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      ) : null}

      <Panel title={`Sales — ${demo ? demoDate : date}`}>
        {loading && !demo ? (
          <SkeletonRows count={5} />
        ) : shownSales.length === 0 ? (
          <EmptyNote>No sales recorded for this date.</EmptyNote>
        ) : (
          <ul className="grid gap-2">
            {shownSales.map((sale) => (
              <li key={sale.id}>
                <button
                  className="flex min-h-14 w-full items-center justify-between gap-3 border border-[#e4e4e8] px-3 py-2 text-left hover:border-[#4533ff]"
                  onClick={() => setSelected(sale)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-sm font-bold ${
                          sale.refunded_at ? "text-[#6b7280] line-through" : ""
                        }`}
                      >
                        {sale.receipt_no}
                      </span>
                      {sale.refunded_at ? (
                        <span className="bg-[#fdf0f0] px-1.5 py-0.5 text-[10px] font-bold text-[#8a1f1f]">
                          REFUNDED
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-[#6b7280]">
                      {sale.station ? `${stationLabel(sale.station)} · ` : ""}
                      {(sale.payment_method ? PAYMENT_LABELS[sale.payment_method] : "No charge")} · {sale.lines.length} line(s)
                      {sale.cashier ? ` · ${sale.cashier}` : ""}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-base font-bold tabular-nums ${
                      sale.refunded_at ? "text-[#6b7280] line-through" : ""
                    }`}
                  >
                    {formatMoney(sale.total)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {selected ? (
        <SaleDetail
          demo={demo}
          onClose={() => setSelected(null)}
          onRefunded={applyRefund}
          sale={selected}
        />
      ) : null}
    </div>
  );
}

// ===== 영수증 상세 + 환불 ===============================================

function SaleDetail({
  sale,
  demo,
  onClose,
  onRefunded,
}: {
  sale: Sale;
  demo: boolean;
  onClose: () => void;
  onRefunded: (updated: Sale) => void;
}) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const created = useMemo(() => {
    // 서버 시각은 ISO-8601 UTC 다. 매장 사람이 읽는 것은 현지 시각이므로 변환한다.
    const value = new Date(sale.created_at);
    return Number.isNaN(value.getTime()) ? sale.created_at : value.toLocaleString("en-CA");
  }, [sale.created_at]);

  async function refund() {
    if (demo || !reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      const updated = await retailApi.refundSale(sale.id, { reason: reason.trim() });
      // 서버가 갱신된 Sale 을 준다는 것은 계약에 명시돼 있지 않다. 형태가
      // 아니면 화면에서 만들어 내지 말고 원본을 그대로 두고 목록을 다시 읽게 한다.
      onRefunded(updated && typeof updated === "object" && "id" in updated ? updated : sale);
      setConfirming(false);
    } catch (cause) {
      setError(toRetailError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title={sale.receipt_no}>
      <div className="grid gap-3">
        <div>
          <p className="text-xs text-[#6b7280]">
            {sale.business_date} · {created}
          </p>
          <p className="text-xs text-[#6b7280]">
            {sale.payments && sale.payments.length > 1
              ? sale.payments.map((payment) => PAYMENT_LABELS[payment.method]).join(" + ")
              : (sale.payment_method ? PAYMENT_LABELS[sale.payment_method] : "No charge")}
            {sale.cashier ? ` · ${sale.cashier}` : ""}
          </p>
        </div>

        {sale.refunded_at ? (
          <div className="border border-[#e2a5a5] bg-[#fdf0f0] px-3 py-2 text-sm text-[#8a1f1f]">
            <p className="font-bold">Refunded</p>
            {sale.refund_reason ? <p>{sale.refund_reason}</p> : null}
          </div>
        ) : null}

        <ul className="grid gap-1 border-y border-[#d4d4d8] py-2 text-sm">
          {sale.lines.map((line, index) => (
            <li key={line.id ?? `${line.product_id}-${line.sku}-${index}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  {line.quantity}× {line.name}
                </span>
                <span className="shrink-0 tabular-nums">{formatMoney(line.line_total)}</span>
              </div>
              <p className="text-[11px] text-[#6b7280]">
                {line.kind === "tee_player"
                  ? `Green fee · tee time ${line.tee_date ?? ""}`
                  : line.kind === "sim_booking"
                    ? `Simulator · ${line.tee_date ?? ""} ${line.tee_time ?? ""}`
                    : line.sku} ·{" "}
                {formatMoney(line.unit_price)} each
                {line.discount > 0 ? ` · −${formatMoney(line.discount)}` : ""}
              </p>
            </li>
          ))}
        </ul>

        <dl className="grid gap-1 text-sm">
          <SummaryRow label="Subtotal" value={formatMoney(sale.subtotal)} />
          {sale.discount > 0 ? (
            <SummaryRow label="Order discount" value={`−${formatMoney(sale.discount)}`} />
          ) : null}
          <SummaryRow label="HST" value={formatMoney(sale.tax)} />
          <div className="flex items-baseline justify-between gap-2 border-t border-[#d4d4d8] pt-1.5">
            <dt className="font-bold">Total</dt>
            <dd className="text-lg font-bold tabular-nums">{formatMoney(sale.total)}</dd>
          </div>
        </dl>

        {sale.payments && sale.payments.length > 0 ? (
          <ul className="grid gap-1 text-sm">
            {sale.payments.map((payment, index) => (
              <li className="flex items-baseline justify-between gap-2" key={index}>
                <span className="min-w-0">
                  {PAYMENT_LABELS[payment.method]}
                  {payment.auth_code ? (
                    <span className="text-[11px] text-[#6b7280]">
                      {" "}
                      · Approval {payment.auth_code}
                      {payment.card_last4 ? ` · ****${payment.card_last4}` : ""}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums">{formatMoney(payment.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {sale.note ? <p className="text-xs text-[#6b7280]">{sale.note}</p> : null}

        {/* 다시 찍은 종이에는 REPRINT 가 찍힌다. 원본과 사본을 들고 두 번 환불받으러
            오는 것을 창구에서 가려낼 수 있어야 한다. 데모 매출은 예시라 찍지 않는다. */}
        <Button disabled={demo} full onClick={() => printReceipt(sale, { reprint: true })}>
          Reprint receipt
        </Button>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {sale.refunded_at ? null : confirming ? (
          <div className="grid gap-2 border border-[#e2a5a5] p-2">
            {sale.payments?.some((payment) => payment.method === "card" || payment.method === "debit") ? (
              <p className="bg-[#fff8e1] px-2 py-2 text-xs text-[#5b4708]">
                Refund the card or debit part on the Chase DX8000 first. This button only fixes the books: it puts
                stock back and marks any green fees on this bill unpaid again.
              </p>
            ) : null}
            <Field hint="Required — it goes on the day's reconciliation" label="Refund reason">
              <TextArea
                onChange={(event) => setReason(event.target.value)}
                placeholder="Wrong size, customer cancelled…"
                value={reason}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={demo || busy || !reason.trim()}
                onClick={refund}
                tone="danger"
              >
                {busy ? "Refunding…" : "Confirm refund"}
              </Button>
              <Button className="flex-1" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button disabled={demo} full onClick={() => setConfirming(true)} tone="danger">
            Refund this sale
          </Button>
        )}

        {demo ? (
          <p className="bg-[#fff8e1] px-2 py-2 text-xs text-[#5b4708]">
            예시 데이터입니다. 서버에 연결되기 전까지는 환불을 기록할 수 없습니다.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[#6b7280]">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
