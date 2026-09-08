// 상세 패널이 "한 화면" 규칙을 지키는지 보는 회귀 확인.
//
// 확인하는 것: 예약을 고른 뒤 패널 **맨 아래 줄**이 화면 안에 들어오는가.
// 여기가 깨지면 프로 샵은 받을 돈을 보려고 매번 스크롤해야 한다.
//
// 예전에는 예약 단위 합계 줄("Reservation total")을 봤지만, 상세 패널이 플레이어
// 단위로 다시 그려지면서 그 줄이 사라졌다. 지금 맨 아래 금액 줄은 카드마다 하나씩
// 있는 "Subtotal Due" 다 — 그래서 **마지막** 카드의 것을 본다.
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 750 } });
await page.goto("http://localhost:3000/admin", { waitUntil: "networkidle" });

await page.locator("button").filter({ hasText: "Predote, Marie" }).first().click();
const anchor = page.getByText("Subtotal Due", { exact: false }).last();
await anchor.waitFor();

console.log(
  await anchor.evaluate((el) => {
    const chain = [];
    for (let node = el; node; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      chain.push({
        tag: node.tagName,
        cls: node.className,
        top: rect.top,
        height: rect.height,
        client: node.clientHeight,
        scroll: node.scrollHeight,
        overflow: style.overflowY,
        rows: style.gridTemplateRows,
      });
    }
    return chain;
  }),
);

// 패널 안쪽을 끝까지 굴렸을 때 마지막 금액 줄이 실제로 보여야 한다.
await anchor.evaluate((el) => {
  el.closest("section").parentElement.scrollTop = 10000;
});
console.log(
  "Footer visible:",
  await anchor.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  }),
);

await browser.close();
