/**
 * 영수증을 **브라우저 인쇄**로 찍는다. 프로 샵 PC 에 Epson TM-m30III 드라이버가 깔려
 * 있으면 그대로 감열 프린터로 나간다. 설치 절차: `docs/pro-shop-receipt-printing-2026-09-12.md`.
 *
 * React 포털이 아니라 `body` 바로 아래의 **컨테이너 하나**를 직접 채운다. 계산대의
 * 장바구니 본문은 데스크톱 사이드바와 모바일 시트에 두 번 그려지고, 매출 탭도 켜진 채로
 * 숨어 있다 — 컴포넌트마다 인쇄 영역을 두면 한 번의 인쇄에 영수증이 두 장 찍힌다.
 * 인쇄할 때만 채우고 끝나면 비운다. 비어 있는 동안에는 인쇄 CSS 가 아무것도 숨기지
 * 않으므로(`globals.css` 의 `:not(:empty)`), 다른 어드민 화면의 Ctrl+P 는 평소대로 찍힌다.
 *
 * 내용과 모양은 `receipt.ts` 가 정한다(블록 → HTML). 여기는 클럽 정보를 채워 운반만 한다.
 */

import { CLUB } from "@/lib/nav";

import { receiptDocBlocks, receiptHtml, saleReceipt, type ReceiptDoc } from "./receipt";
import type { Sale } from "./types";

const ROOT_ID = "receipt-print-root";

/**
 * 계산대 이름. 클럽이 쓰던 Lightspeed 영수증의 표기(`Register:Pro Shop Counter`) 그대로다.
 * 지금은 계산대가 하나뿐이다. 스낵바 계산대가 생기면 기기별 설정으로 옮긴다.
 */
const REGISTER_NAME = "Pro Shop Counter";

export function printReceipt(sale: Sale, options: { reprint?: boolean } = {}): void {
  printReceiptDoc(saleReceipt(sale), options);
}

/**
 * 영수증 한 장의 HTML. **화면 미리보기와 종이가 같은 HTML 이다** — 결제 전에 보여 주는 창이
 * 이것을 그대로 그리므로, 본 대로 찍힌다. 모양은 `globals.css` 의 `.rc-sheet` 규칙.
 * 사람이 입력한 글자(상품명·메모·이름)는 receiptHtml 이 전부 이스케이프한다.
 */
export function receiptSheetHtml(
  doc: ReceiptDoc,
  options: { reprint?: boolean; copyLabel?: string } = {},
): string {
  return receiptHtml(
    receiptDocBlocks(doc, {
      header: { name: CLUB.name, addressLines: CLUB.mailingAddress, phone: CLUB.phone },
      register: REGISTER_NAME,
      reprint: options.reprint,
      copyLabel: options.copyLabel,
    }),
  );
}

/**
 * 한 번 인쇄에 나가는 장수와 각 장의 표시. 손님 것 한 장, 프로 샵 보관용 한 장 —
 * 클럽이 쓰던 Lightspeed 영수증도 두 장이었다. 장 사이에서 페이지가 끊기므로
 * 감열 프린터가 사이를 자른다(`globals.css` 의 `.rc-copy`).
 */
const COPY_LABELS = ["CUSTOMER COPY", "MERCHANT COPY"];

/** 판매가 아닌 결제(티 시트 카드의 Payment)도 같은 모양의 영수증으로 찍는다. */
export function printReceiptDoc(doc: ReceiptDoc, options: { reprint?: boolean } = {}): void {
  if (typeof window === "undefined") return;

  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }
  root.className = "rc-sheet";
  root.innerHTML = COPY_LABELS.map(
    (copyLabel) => `<div class="rc-copy">${receiptSheetHtml(doc, { ...options, copyLabel })}</div>`,
  ).join("");

  const container = root;
  const clear = () => {
    container.replaceChildren();
    window.removeEventListener("afterprint", clear);
  };
  window.addEventListener("afterprint", clear);
  window.print();
}
