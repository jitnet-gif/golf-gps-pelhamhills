/**
 * 새 바코드의 상품군을 **이미 등록된 상품에서** 추측한다.
 *
 * 왜 추측인가: 제조사 바코드(UPC/EAN)에는 상품군 칸이 없다. 앞자리는 GS1 이 회사에 판
 * 회사 번호라 브랜드까지만 알려 준다. 그래도 한 프로샵이 같은 회사에서 받는 물건은 대개
 * 한 종류라(음료 회사 → Food & Beverage, 공 회사 → Balls) 앞자리가 긴 상품끼리는 상품군도
 * 같을 때가 많다. 그래서 **제안**만 하고, 확정은 직원이 한다.
 *
 * 방법: 바코드를 14자리(GTIN-14)로 맞춘 뒤, 앞자리가 가장 길게 겹치는 상품들을 모아
 * 과반인 상품군을 고른다. 회사 번호는 가장 짧아야 UPC 6자리(= GTIN-14 로 8자리)라
 * 그보다 덜 겹치면 다른 회사로 보고 버린다. 과반이 없으면 제안하지 않는다.
 */

import type { Product, RetailCategory } from "./types";

/** GTIN-14 에서 이만큼은 겹쳐야 같은 회사로 본다(UPC 회사 번호 최소 6자리 + 앞의 0 둘). */
const MIN_SHARED = 8;

export type CategoryGuess = {
  category: RetailCategory;
  /** 그 상품군인 상품 수. */
  matches: number;
  /** 같은 앞자리를 가진 상품 수 전체. */
  of: number;
  /** 겹친 앞자리. 화면에 보여 준다(원래 바코드 길이 기준). */
  prefix: string;
};

/** UPC-A(12)·EAN-13·EAN-8·GTIN-14 → 앞을 0 으로 채운 14자리. 숫자 바코드가 아니면 null. */
function gtin14(code: string): string | null {
  const digits = code.trim();
  return /^(\d{8}|\d{12,14})$/.test(digits) ? digits.padStart(14, "0") : null;
}

function sharedLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && a[n] === b[n]) n += 1;
  return n;
}

export function guessCategory(
  barcode: string,
  products: readonly Product[],
  excludeId?: number,
): CategoryGuess | null {
  const target = gtin14(barcode);
  if (!target) return null;

  let best = 0;
  let group: Product[] = [];
  for (const product of products) {
    if (product.id === excludeId || !product.barcode) continue;
    const other = gtin14(product.barcode);
    // 같은 바코드는 저장할 때 409 로 막힌다. 추측에 쓰지 않는다.
    if (!other || other === target) continue;
    const shared = sharedLength(target, other);
    if (shared < MIN_SHARED || shared < best) continue;
    if (shared > best) {
      best = shared;
      group = [];
    }
    group.push(product);
  }
  if (group.length === 0) return null;

  const counts = new Map<RetailCategory, number>();
  for (const product of group) counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  const [category, matches] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (matches * 2 <= group.length) return null;

  const padding = 14 - barcode.trim().length;
  return { category, matches, of: group.length, prefix: barcode.trim().slice(0, best - padding) };
}
