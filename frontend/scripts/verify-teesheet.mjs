// 티 시트 기능 검증. UI 를 실제로 클릭한 뒤 백엔드 API 로 반영 여부를 확인한다.
//   전제: uvicorn 이 :8000, next dev 가 :3000 에서 떠 있어야 한다.
//   실행: node frontend/scripts/verify-teesheet.mjs
//
//   경고: resetBaseline() 은 모든 예약의 상태/연락처/카트 수를 시드 값으로 되돌린다.
//   실제 고객 데이터에 절대 돌리지 말 것. 백엔드를 스크래치 파일로 띄운 뒤 실행한다:
//     TEE_SHEET_DATA_FILE=/tmp/teesheet-test.json python -m uvicorn backend.main:app --port 8000
import { chromium } from "playwright";

const WEB = process.env.VERIFY_WEB ?? "http://127.0.0.1:3000";
const API = process.env.VERIFY_API ?? "http://127.0.0.1:8000/api/v1";

const failures = [];
const passes = [];
let step = "startup";

const check = (ok, label) => (ok ? passes.push(label) : failures.push(`${step}: ${label}`));

async function api(path, init) {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const bookingById = (id) => api(`/tee-sheet/bookings/${id}`);
const listBookings = () => api("/tee-sheet/bookings");

// UI 가 낙관적 갱신 후 서버 응답을 반영할 때까지 짧게 재시도한다.
async function eventually(fn, label, tries = 25) {
  for (let i = 0; i < tries; i += 1) {
    try {
      if (await fn()) {
        passes.push(label);
        return true;
      }
    } catch {
      // 서버가 아직 반영 전일 수 있다.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  failures.push(`${step}: ${label}`);
  return false;
}

// 반복 실행 가능하도록, UI 를 열기 전에 서버 데이터를 알려진 상태로 되돌린다.
async function resetBaseline() {
  const all = await listBookings();
  for (const b of all) {
    if (b.title === "E2E, Verify") {
      await api(`/tee-sheet/bookings/${b.id}`, { method: "DELETE" });
      continue;
    }
    if (b.status !== "reserved") {
      await api(`/tee-sheet/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "reserved" }),
      });
    }
    for (const p of b.players) {
      if (p.phone) {
        await api(`/tee-sheet/bookings/${b.id}/players/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: "" }),
        });
      }
    }
  }
  // 카트 수는 시드 값(2)으로 되돌려 Save 검증이 항상 같은 델타를 보게 한다.
  const xeric = (await listBookings()).find(
    (b) => b.date === "2026-09-11" && b.title === "Xeric, Micah",
  );
  if (xeric && xeric.cartCount !== 2) {
    await api(`/tee-sheet/bookings/${xeric.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cartCount: 2 }),
    });
  }
}

await resetBaseline();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

let created = null;

try {
  // ---------- 1. 로드 & 연결 ----------
  step = "load";
  await page.goto(`${WEB}/teesheet`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const offline = await page.getByRole("button", { name: "Retry" }).isVisible().catch(() => false);
  check(!offline, "API 에 연결됨 (오프라인 폴백 아님)");

  const seeded = await listBookings();
  const sep11 = seeded.filter((b) => b.date === "2026-09-11");
  check(sep11.length > 0, "시드 예약이 서버에 존재");

  // 격자에 렌더된 예약 막대 수 == 이번 주 예약 수 (조용히 사라지는 예약 없음)
  step = "grid";
  const inWeek = seeded.filter((b) => b.date >= "2026-09-07" && b.date <= "2026-09-13");
  const barCount = await page
    .locator("button")
    .evaluateAll((els) => els.filter((e) => /\d\/4$/.test((e.innerText || "").trim())).length);
  check(
    barCount === inWeek.length,
    `이번 주 예약 ${inWeek.length}건이 모두 격자에 표시됨 (표시 ${barCount}건)`,
  );

  // ---------- 2. 예약 선택 ----------
  step = "select";
  const target = sep11.find((b) => b.title === "Xeric, Micah");
  await page.getByRole("button", { name: /Xeric, Micah/ }).last().click();
  await page.waitForTimeout(600);
  check(
    await page.getByRole("button", { name: "Check In All" }).isVisible(),
    "예약 클릭 시 상세 패널이 열림",
  );

  // ---------- 3. 전체 체크인 ----------
  step = "check-in-all";
  await page.getByRole("button", { name: "Check In All" }).click();
  await eventually(
    async () => (await bookingById(target.id)).status === "checked_in",
    "Check In All 이 서버에 checked_in 으로 반영됨",
  );
  await eventually(
    async () => (await bookingById(target.id)).players.every((p) => p.arrived),
    "모든 플레이어가 arrived 로 표시됨",
  );

  // ---------- 4. 플레이어 연락처 편집 (이전에는 readOnly) ----------
  step = "edit-player";
  const phone = "905-555-0142";
  const phoneInput = page.getByPlaceholder("Phone").first();
  await phoneInput.fill(phone);
  await phoneInput.blur();
  await eventually(
    async () => (await bookingById(target.id)).players.some((p) => p.phone === phone),
    "플레이어 전화번호 편집이 서버에 저장됨",
  );

  // ---------- 5. 카트 수 + Save ----------
  step = "cart-and-save";
  const cartsBefore = (await bookingById(target.id)).cartCount;
  await page.getByRole("button", { name: "Fewer carts" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await eventually(
    async () => (await bookingById(target.id)).cartCount === cartsBefore - 1,
    `Save 가 카트 수를 ${cartsBefore} -> ${cartsBefore - 1} 로 반영 (이전에는 무동작 버튼)`,
  );

  // ---------- 6. 플레이어 추가 / 삭제 ----------
  step = "player-add-remove";
  const two = sep11.find((b) => b.players.length === 2);
  await page.getByRole("button", { name: new RegExp(two.title) }).last().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "+", exact: true }).last().click();
  await eventually(
    async () => (await bookingById(two.id)).players.length === 3,
    "플레이어 추가가 서버에 반영됨",
  );
  await page.getByRole("button", { name: "×", exact: true }).last().click();
  await eventually(
    async () => (await bookingById(two.id)).players.length === 2,
    "플레이어 삭제가 서버에 반영됨",
  );

  // ---------- 7. 빈 슬롯 클릭 -> 신규 예약 (기존에는 생성 수단 자체가 없었음) ----------
  step = "create";
  await page.getByRole("button", { name: "Create reservation on Sep 9 at 8:19 AM" }).click();
  await page.waitForTimeout(600);
  const dialog = page.getByRole("dialog");
  check(await dialog.isVisible(), "빈 슬롯 클릭 시 신규 예약 다이얼로그가 열림");
  await dialog.getByLabel("Player 1 first name").fill("Verify");
  await dialog.getByLabel("Player 1 last name").fill("E2E");
  await dialog.getByPlaceholder("Last, First").fill("E2E, Verify");
  await dialog.getByRole("button", { name: /Create|Book|Save/i }).last().click();
  await eventually(async () => {
    created = (await listBookings()).find((b) => b.title === "E2E, Verify");
    return Boolean(created);
  }, "신규 예약이 서버에 생성됨");
  if (created) {
    check(
      created.date === "2026-09-09" && created.time === "8:19 AM",
      `생성된 예약이 클릭한 슬롯에 배치됨 (${created.date} ${created.time})`,
    );
  }

  // ---------- 8. 주간 이동 / Day 뷰 ----------
  step = "navigation";
  const bodyBefore = await page.locator("body").innerText();
  await page.getByRole("button", { name: "Next week" }).click();
  await page.waitForTimeout(1000);
  const bodyAfter = await page.locator("body").innerText();
  check(bodyBefore !== bodyAfter, "다음 주 이동이 화면을 갱신함");
  await page.getByRole("button", { name: "Today" }).click();
  await page.waitForTimeout(1000);
  check(
    await page.getByRole("button", { name: /Xeric, Micah/ }).first().isVisible(),
    "Today 버튼이 이번 주로 복귀함",
  );

  // 예약이 있는 날짜로 이동해야 Day 뷰 검증이 공허하게 통과하지 않는다.
  // (오늘 9/7 은 예약 0건이라 "컬럼 1개" 조건이 저절로 충족된다.)
  await page.getByRole("button", { name: "Show September 11, 2026" }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await page.waitForTimeout(900);
  const dayColumns = await page.getByRole("button", { name: /^Show September/ }).count();
  check(
    dayColumns <= 1,
    `Day 뷰가 단일 날짜만 표시 (컬럼 ${dayColumns}개, 이전에는 토글이 무동작)`,
  );
  // Elm, Noel 는 9/11 에만 있다 -> 초점 날짜의 예약이 실제로 렌더되는가
  check(
    await page.getByRole("button", { name: /Elm, Noel/ }).first().isVisible().catch(() => false),
    "Day 뷰가 해당 날짜의 예약을 실제로 표시",
  );
  // Day 뷰는 초점 날짜만 보여주는 것이 정상이다. 중요한 건 "돌아오면 전부 복구되는가".
  const dayBars = await page
    .locator("button")
    .evaluateAll((els) => els.filter((e) => /\d\/4/.test((e.innerText || "").trim())).length);
  check(
    dayBars === sep11.length,
    `Day 뷰가 9/11 예약 ${sep11.length}건을 모두 표시 (표시 ${dayBars}건)`,
  );
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.waitForTimeout(900);
  const backToWeek = await page
    .locator("button")
    .evaluateAll((els) => els.filter((e) => /\d\/4$/.test((e.innerText || "").trim())).length);
  // 이 시점에는 위에서 만든 "E2E, Verify" 예약이 아직 남아 있다.
  const expectedInWeek = inWeek.length + (created ? 1 : 0);
  check(
    backToWeek === expectedInWeek,
    `Week 뷰 복귀 시 ${expectedInWeek}건이 모두 되돌아옴 (표시 ${backToWeek}건) — Day 뷰 전환이 데이터를 잃지 않음`,
  );

  // ---------- 9. 오케스트레이션 병렬 배치 ----------
  step = "orchestration";
  await page.getByRole("button", { name: /Operations/ }).click();
  await page.waitForTimeout(700);
  await page.getByRole("tab", { name: /Tasks/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Daily Batch/i }).last().click();
  const batchOk = await eventually(
    async () => {
      const s = await api("/tee-sheet/orchestration/status");
      return s.tasks.some((t) => /daily/i.test(t.name) && t.state === "success");
    },
    "Daily Batch 작업이 success 로 종료됨",
    50,
  );
  if (batchOk) {
    const s = await api("/tee-sheet/orchestration/status");
    const t = s.tasks.find((x) => /daily/i.test(x.name) && x.state === "success");
    const r = t.result ?? {};
    const wall = r.wall_clock_ms ?? t.duration_ms;
    const serial = r.sequential_ms;
    check(
      typeof serial === "number" && typeof wall === "number" && wall < serial,
      `병렬 팬아웃이 실제로 동시 실행됨 (wall ${wall}ms < serial ${serial}ms)`,
    );
  }

  step = "reports";
  await page.getByRole("tab", { name: /Reports/i }).click();
  await page.waitForTimeout(1200);
  const daily = await api("/tee-sheet/reports/daily?date=2026-09-11");
  check(
    await page.getByText(/occupancy/i).first().isVisible().catch(() => false),
    "리포트 탭이 점유율을 표시",
  );
  check(daily.total_revenue > 0 && daily.total_slots > 0, "일일 리포트 수치가 실데이터 기반");

  // ---------- 10. 취소 (window.prompt 제거) 후 삭제 ----------
  step = "cancel-delete";
  if (created) {
    await page.getByRole("button", { name: /E2E, Verify/ }).first().click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Cancel Reservation" }).click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder(/Reason shown on the reservation/).fill("E2E cancellation");
    await page.getByRole("button", { name: /^Confirm/i }).click();
    await eventually(async () => {
      const b = await bookingById(created.id);
      return b.status === "cancelled" && b.cancelReason === "E2E cancellation";
    }, "인라인 취소 폼이 사유와 함께 저장됨 (window.prompt 없음)");

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /Delete/i }).last().click();
    await eventually(async () => {
      const all = await listBookings();
      return !all.some((b) => b.id === created.id);
    }, "예약 삭제가 서버에 반영됨");
  }

  // ---------- 11. 감사 로그 펼치기 ----------
  step = "history";
  await page.getByRole("button", { name: /Xeric, Micah/ }).last().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^History/ }).click();
  await page.waitForTimeout(400);
  check(
    await page.getByText(/ago|Imported|Reservation|Player/i).last().isVisible().catch(() => false),
    "감사 로그(History)가 펼쳐지고 항목을 표시 (백엔드가 계속 기록만 하고 UI 는 없었음)",
  );

  // ---------- 12. Worker Sync (기존에는 randint 로 예약을 뒤집던 자리) ----------
  step = "worker";
  await page.getByRole("tab", { name: /Tasks/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Worker Sync/i }).last().click();
  await eventually(
    async () => {
      const s = await api("/tee-sheet/orchestration/status");
      return s.tasks.some((t) => /worker/i.test(t.name) && t.state === "success");
    },
    "Worker Sync 가 success 로 종료됨 (결정적 동작)",
    40,
  );

  // ---------- 13. 서버 거부가 토스트로 노출되는가 (기존: 무시된 Promise rejection 으로 UI 가 죽은 듯 보였음) ----------
  // 다이얼로그의 중복 슬롯은 클라이언트 가드가 먼저 막으므로, 가드가 개입할 수 없는 경로를 쓴다:
  // UI 뒤에서 예약을 서버에서 지운 뒤 그 예약을 변경 시도 -> 404.
  step = "error-toast";
  const errorsBeforeDeliberate = consoleErrors.length;
  {
    const ghost = await api("/tee-sheet/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-09",
        time: "9:04 AM",
        title: "Ghost, Booking",
        players: [{ firstName: "Ghost", lastName: "Booking" }],
      }),
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /Ghost, Booking/ }).first().click();
    await page.waitForTimeout(500);

    await api(`/tee-sheet/bookings/${ghost.id}`, { method: "DELETE" }); // UI 몰래 삭제

    await page.getByRole("button", { name: "Check In All" }).click();
    const toastShown = await eventually(
      async () => page.getByText(/not found|없|404|failed|실패/i).first().isVisible(),
      "서버 거부(404)가 사용자에게 오류 메시지로 노출됨 (조용히 삼키지 않음)",
      25,
    );
    if (!toastShown) {
      console.log("  (참고) 화면 텍스트:", (await page.locator("body").innerText()).slice(0, 500));
    }
    check(
      await page.getByRole("button", { name: "Add +" }).isEnabled(),
      "실패 후에도 UI 가 잠기지 않고 계속 조작 가능",
    );
  }

  // ---------- 14. 여러 뷰포트에서 정렬 유지 (기존 하드코딩 픽셀 버그의 재발 방지) ----------
  step = "viewports";
  for (const vp of [
    { width: 1600, height: 1000 },
    { width: 1100, height: 900 },
    { width: 900, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(overflow <= 1, `${vp.width}px: 페이지 본문이 가로 스크롤되지 않음 (초과 ${overflow}px)`);

    // 한 화면 규칙: 페이지 자체는 세로로도 스크롤되지 않는다.
    const vOverflow = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    check(vOverflow <= 1, `${vp.width}px: 페이지가 세로로 스크롤되지 않음 (초과 ${vOverflow}px)`);

    const aligned = await page.evaluate(() => {
      const header = [...document.querySelectorAll("button")].find((e) =>
        /^Show September 11/.test(e.getAttribute("aria-label") || ""),
      );
      // Elm, Noel 는 9/11 에만 있으므로 요일 컬럼이 모호하지 않다.
      const bar = [...document.querySelectorAll("button")].find((e) =>
        /^Elm, Noel/.test((e.innerText || "").trim()),
      );
      if (!header || !bar) return null;
      return Math.abs(header.getBoundingClientRect().left - bar.getBoundingClientRect().left);
    });
    if (aligned !== null) {
      check(aligned <= 8, `${vp.width}px: 예약 막대가 요일 컬럼과 정렬됨 (오차 ${Math.round(aligned)}px)`);
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });

  // ---------- 15. 한 화면 + 프리즈 ----------
  step = "one-screen-freeze";
  {
    // 고정 헤더가 예약을 가릴 수 있으므로 클릭 전에 격자를 맨 위로 되돌린다.
    await page.evaluate(() => {
      const pane = document.querySelector("main section section .overflow-auto");
      if (pane) pane.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    // 선택 전: 상세 패널이 없고 티 시트가 화면 전체를 쓴다.
    // 앞 단계에서 펼쳐둔 Operations 는 접어서 기본 상태로 되돌린다.
    await page.getByRole("button", { name: /^Close/ }).click().catch(() => {});
    await page.waitForTimeout(400);
    const opsToggle = page.getByRole("button", { name: /Operations/ });
    if ((await opsToggle.getAttribute("aria-expanded")) === "true") {
      await opsToggle.click();
      await page.waitForTimeout(500);
    }
    const measure = () =>
      page.evaluate(() => {
        const pane = document.querySelector("main section section .overflow-auto");
        const detail = [...document.querySelectorAll("section")].find((e) =>
          e.className.includes("bg-[#dedee2]"),
        );
        return {
          grid: pane ? Math.round(pane.getBoundingClientRect().height) : 0,
          hasDetail: Boolean(detail),
        };
      });
    const unselected = await measure();
    check(!unselected.hasDetail, "예약 선택 전에는 상세 패널이 렌더되지 않음");

    await page.getByRole("button", { name: /Xeric, Micah/ }).last().click();
    await page.waitForTimeout(700);
    const selectedLayout = await measure();
    check(
      unselected.grid > selectedLayout.grid,
      `선택 전 티 시트가 더 크게 확장됨 (${unselected.grid}px -> ${selectedLayout.grid}px)`,
    );
    check(
      selectedLayout.grid >= unselected.grid * 0.4,
      `선택 후에도 티 시트가 절반 가까이 유지됨 (${selectedLayout.grid}px)`,
    );

    const layout = await page.evaluate(() => {
      const pane = document.querySelector("main section section .overflow-auto");
      const detail = [...document.querySelectorAll("section")].find((el) =>
        el.className.includes("bg-[#dedee2]"),
      );
      const seen = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
      };
      return {
        gridVisible: seen(pane),
        detailVisible: seen(detail),
        gridScrolls: pane ? pane.scrollHeight > pane.clientHeight : false,
      };
    });
    check(
      layout.gridVisible && layout.detailVisible,
      "예약 클릭 시 티 시트와 상세 패널이 동시에 한 화면에 보임",
    );
    check(layout.gridScrolls, "티 시트가 페이지가 아니라 자기 영역 안에서만 스크롤됨");

    // 닫으면 다시 티 시트가 화면 전체로 돌아온다.
    await page.getByRole("button", { name: /^Close/ }).click();
    await page.waitForTimeout(700);
    const reclosed = await measure();
    check(
      !reclosed.hasDetail && reclosed.grid === unselected.grid,
      `Close 로 상세를 닫으면 티 시트가 다시 전체 화면으로 확장됨 (${reclosed.grid}px)`,
    );
    await page.getByRole("button", { name: /Xeric, Micah/ }).last().click();
    await page.waitForTimeout(600);

    // 격자를 스크롤해도 헤더 행과 Time 열이 고정("프리즈")되는가
    const freeze = await page.evaluate(async () => {
      const pane = document.querySelector("main section section .overflow-auto");
      const headerOf = () =>
        [...document.querySelectorAll("button")].find((e) =>
          /^Show September 11/.test(e.getAttribute("aria-label") || ""),
        );
      const before = headerOf().getBoundingClientRect().top;
      pane.scrollTop = pane.scrollHeight;
      await new Promise((r) => setTimeout(r, 400));
      return { before: Math.round(before), after: Math.round(headerOf().getBoundingClientRect().top) };
    });
    check(
      Math.abs(freeze.after - freeze.before) <= 1,
      `격자를 끝까지 스크롤해도 요일 헤더가 고정됨 (${freeze.before}px -> ${freeze.after}px)`,
    );
  }

  // ---------- 16. /admin 별칭 라우트 ----------
  step = "admin-route";
  await page.goto(`${WEB}/admin`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  check(
    await page.getByRole("button", { name: /Xeric, Micah/ }).first().isVisible().catch(() => false),
    "/admin 별칭 라우트도 데이터와 함께 렌더됨",
  );

  step = "console";
  const ignorable = /Download the React DevTools|Fast Refresh/i;
  const real = consoleErrors.filter((e, i) => {
    if (ignorable.test(e)) return false;
    // error-toast 단계에서 일부러 삭제한 예약을 건드려 발생시킨 404 는 기대된 결과다.
    if (i >= errorsBeforeDeliberate && /404|Not Found/i.test(e)) return false;
    return true;
  });
  check(real.length === 0, `콘솔 에러 없음 (발견 ${real.length}건${real.length ? ": " + real.join(" | ") : ""})`);
} catch (error) {
  failures.push(`${step}: 예외 발생 — ${error.message}`);
} finally {
  await page.screenshot({ path: "frontend/scripts/teesheet-verify.png" }).catch(() => {});
  await browser.close();
}

console.log(`\n통과 ${passes.length}건`);
for (const p of passes) console.log(`  PASS  ${p}`);
if (failures.length) {
  console.log(`\n실패 ${failures.length}건`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
console.log("\n모든 티 시트 기능 검증 통과");
