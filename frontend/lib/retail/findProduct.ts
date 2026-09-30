import type { Product, RetailCategory } from "./types";

/**
 * 스캔한 코드로 팔 수 있는 상품을 찾는다. 제조사 바코드를 먼저, 없으면 클럽 SKU.
 * 둘 다 **정확 일치**(대소문자 무시 — 서버의 중복 규칙과 같다). 부분 일치로 담으면
 * `PH-BALL` 을 쏘았는데 `PH-BALL-PV1` 이 담기는 식의 사고가 난다.
 */
export function findProductByCode(
  products: Product[],
  raw: string,
  category?: RetailCategory,
): Product | null {
  const wanted = raw.trim().toLowerCase();
  const sellable = (item: Product) => item.is_active && (category ? item.category === category : true);
  return (
    products.find((item) => sellable(item) && (item.barcode ?? "").trim().toLowerCase() === wanted) ??
    products.find((item) => sellable(item) && item.sku.trim().toLowerCase() === wanted) ??
    null
  );
}
