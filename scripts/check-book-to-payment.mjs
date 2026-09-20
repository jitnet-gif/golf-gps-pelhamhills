// 예약 생성 → 이름 입력 → 결제까지, 프로 샵 화면을 실제 브라우저로 한 번 통과시키는 확인.
//
// ## 무엇이 진짜이고 무엇이 가짜인가
// **진짜**: Next 개발 서버가 내려준 실제 화면과 그 안의 React 코드 전부 —
// WeekGrid 의 빈 칸 버튼, `app/teesheet/page.tsx` 의 createAt, ReservationDetail 의
// 자동 저장·제목 동기화·결제, useTeeSheet 의 낙관적 갱신, 영수증 생성.
//
// **가짜**: Supabase. 이 저장소는 클럽의 운영 DB(`yxpiwwgquyaxjubovzmi`)에 접근할
// 권한이 없고, 있다 해도 실제 티 시트에 시험용 예약을 꽂을 일은 아니다. 그래서
// `/rest/v1/rpc/*` 를 가로채 `supabase/migrations/0004_staff_tee_sheet.sql` 을 읽고
// 옮겨 적은 최소 구현으로 답한다. 즉 이 스크립트가 보증하는 것은 **화면 쪽 흐름**이고,
// Postgres 함수 자체가 아니다.
//
// 스텁이 흉내 내는 서버 규칙은 셋뿐이다 (전부 SQL 에 근거가 있다):
//   1) `pelham_tee_name` — 이름이 비면 firstName 을 "Guest" 로 채운다.
//   2) `title` 은 필수값이고, 서버는 그것을 자동으로 이름에 맞춰 주지 않는다.
//   3) `paid: true` 일 때 `paidAt` 은 **서버만** 찍는다 (없으면 화면이 영수증을 거부한다).
//
// 실행:  node scripts/check-book-to-payment.mjs      (미리 `npm run dev` 로 :3000)
import { chromium } from "playwright";

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const DATE = process.env.CHECK_DATE ?? new Date().toISOString().slice(0, 10);
const RATE = 47.79;
const TAX = 0.13;

// ===== 가짜 Supabase ======================================================

/** 0004 의 `pelham_tee_name`: 성·이름이 모두 비면 "Guest". */
function teeName(p) {
  const first = String(p.firstName ?? "").trim();
  const last = String(p.lastName ?? "").trim();
  if (first !== "" || last !== "") return { firstName: first, lastName: last, name: `${first} ${last}`.trim() };
  return { firstName: "Guest", lastName: "", name: "Guest" };
}

function teePlayer(p, id) {
  const names = teeName(p);
  return {
    id,
    ...names,
    email: p.email ?? "",
    phone: p.phone ?? "",
    // 0004: `coalesce(p->>'type', 'Guest')` — 화면이 type 을 안 보내면 Guest 다.
    type: p.type ?? "Guest",
    ratePlan: p.ratePlan ?? "Public",
    arrived: p.arrived ?? false,
    paid: p.paid ?? false,
    cancelled: p.cancelled ?? false,
    no_show: p.no_show ?? false,
    cart: p.cart ?? false,
    cartFee: p.cart ? 19 : 0,
    paidAt: p.paidAt ?? null,
  };
}

/** 6:58 AM 부터 9분 간격 — 0004 의 격자 상수와 같은 규칙, 앞쪽 몇 칸만. */
function slotsFor() {
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    const minutes = 418 + i * 9;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const label = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
    out.push({ time: label, minutes, rate: RATE, cartsTotal: 4 });
  }
  return out;
}

function makeServer() {
  const bookings = new Map();
  let seq = 0;
  const nextId = (p) => `${p}-${(seq += 1)}`;
  const nowIso = () => new Date().toISOString();
  const calls = [];

  function handle(fn, args) {
    calls.push({ fn, args });
    switch (fn) {
      case "pelham_staff_slots":
        // SlotsResponse 는 배열이 아니라 {date, slots[]} 다. 모양이 틀리면 로그인 문이
        // "직원 아님" 으로 떨어져서 엉뚱한 층을 디버깅하게 된다.
        return { date: args.p_date, slots: slotsFor() };

      case "pelham_staff_bookings":
        return [...bookings.values()].filter((b) => b.date >= args.p_from && b.date <= args.p_to);

      case "pelham_staff_booking":
        return bookings.get(args.p_id) ?? null;

      case "pelham_staff_booking_create": {
        const p = args.p;
        if (!p.title) throw new Error("'title' is required");
        const doc = {
          id: nextId("b"),
          date: p.date,
          time: p.time,
          holes: p.holes ?? 18,
          rate: p.rate ?? RATE,
          span: 1,
          color: p.color ?? "gold",
          title: p.title,
          status: "reserved",
          cartCount: p.cartCount ?? 0,
          notes: p.notes ?? "",
          players: (p.players ?? []).map((pl) => teePlayer(pl, nextId("p"))),
          audit: [{ id: nextId("a"), ts: nowIso(), message: `Reservation created for ${p.date} ${p.time}.` }],
          cancelReason: null,
          source: "staff",
          holdExpiresAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        bookings.set(doc.id, doc);
        return doc;
      }

      case "pelham_staff_booking_patch": {
        const doc = bookings.get(args.p_id);
        if (!doc) throw new Error("Booking not found");
        const next = { ...doc, ...args.p, updatedAt: nowIso() };
        bookings.set(next.id, next);
        return next;
      }

      case "pelham_staff_player_add": {
        const doc = bookings.get(args.p_id);
        if (!doc) throw new Error("Booking not found");
        if (doc.players.length >= 4) throw new Error("A tee time can contain at most 4 players");
        const next = {
          ...doc,
          players: [...doc.players, teePlayer(args.p ?? {}, nextId("p"))],
          updatedAt: nowIso(),
        };
        bookings.set(next.id, next);
        return next;
      }

      case "pelham_staff_player_patch": {
        const doc = bookings.get(args.p_id);
        if (!doc) throw new Error("Booking not found");
        const players = doc.players.map((player) => {
          if (player.id !== args.p_player) return player;
          const merged = { ...player, ...args.p };
          const next = teePlayer(merged, player.id);
          // 결제 시각은 서버만 찍는다. 화면은 이 값이 없으면 영수증을 내지 않는다.
          next.paidAt = next.paid ? player.paidAt ?? nowIso() : null;
          next.cartFee = merged.cartFee ?? next.cartFee;
          return next;
        });
        const next = { ...doc, players, updatedAt: nowIso() };
        bookings.set(next.id, next);
        return next;
      }

      default:
        throw new Error(`stub has no ${fn}`);
    }
  }

  return { handle, calls, bookings };
}

// ===== 실행 ===============================================================

const server = makeServer();
// 화면 폭은 바꿔 가며 볼 수 있어야 한다 — 프로 샵은 데스크톱, 사장님은 휴대폰이다.
const WIDTH = Number(process.env.CHECK_WIDTH ?? 1600);
const HEIGHT = Number(process.env.CHECK_HEIGHT ?? 900);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });

// 세션은 문서가 열리기 **전에** 심는다. session.ts 가 첫 읽기에서 모듈 캐시를
// 채우고, 로그인 문은 그 직후에 읽는다. 만료는 넉넉히 뒤로 — 1분 안쪽이면
// accessToken() 이 GoTrue 로 갱신 요청을 보내고, 그건 rpc 라우트에 안 걸린다.
await context.addInitScript(
  ([key, session]) => {
    window.localStorage.setItem(key, JSON.stringify(session));
    // 영수증은 `printReceiptDoc` 이 #receipt-print-root 에 HTML 을 꽂고 window.print()
    // 를 부르는 방식이다(새 창이 아니다). 헤드리스에서 인쇄 대화상자로 멈추지 않도록
    // 막고, 부르는 순간의 그 노드 내용을 붙잡아 무엇이 찍혔는지 확인한다.
    window.__printed = [];
    window.print = () => {
      const root = document.getElementById("receipt-print-root");
      window.__printed.push(root ? root.innerHTML : "");
    };
  },
  [
    "pelham.staff.session",
    {
      accessToken: "stub-access-token",
      refreshToken: "stub-refresh-token",
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      email: "prosho@pelhamhills.test",
      userId: "stub-user",
    },
  ],
);

// 순서 주의: Playwright 는 **나중에 등록한** 라우트를 먼저 본다. 넓은 그물을 먼저
// 깔고 rpc 핸들러를 나중에 등록해야 한다 — 반대로 하면 rpc 요청까지 abort 된다.
// 이 그물은 스텁에 없는 Supabase 호출(GoTrue 토큰 갱신 등)이 조용히 진짜
// 네트워크로 새는 것을 잡아낸다.
const leaked = [];
await context.route("**/*.supabase.co/**", (route) => {
  leaked.push(route.request().url());
  return route.abort();
});

await context.route("**/rest/v1/rpc/**", async (route) => {
  const fn = new URL(route.request().url()).pathname.split("/").pop();
  let args = {};
  try {
    args = JSON.parse(route.request().postData() ?? "{}");
  } catch {
    args = {};
  }
  try {
    const body = server.handle(fn, args);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  } catch (error) {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "PT400", message: String(error.message ?? error) }),
    });
  }
});


const page = await context.newPage();
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });

// 로그인 문이 열렸는가(= 스텁의 slots 응답을 직원 확인이 받아들였는가).
const gateOpen = await page.getByRole("button", { name: /^Add/ }).isVisible().catch(() => false);
record("로그인 문 통과 — 티 시트가 마운트됨", gateOpen);
if (!gateOpen) {
  console.log(await page.locator("body").innerText());
  await browser.close();
  process.exit(1);
}

// 오늘로 맞춘다(스크립트를 언제 돌려도 같은 날을 본다).
await page.getByRole("button", { name: "Today" }).first().click().catch(() => {});
await page.waitForTimeout(300);

// ----- 0. 상단바 Add 버튼도 창을 띄우지 않는다 -----
// 격자의 빈 칸과 같은 결과여야 한다. 누른 자리가 없으므로 그 날의 첫 빈 타임에 만든다.
const addButton = page.getByRole("button", { name: /^Add/ }).first();
await addButton.click();
await page.waitForTimeout(1200);
const addDialogs = await page.locator('[role="dialog"]').count();
record("Add 버튼에 모달이 뜨지 않음", addDialogs === 0, `role=dialog ${addDialogs}개`);

const fromAdd = [...server.bookings.values()][0];
record(
  "Add 가 첫 빈 타임에 예약을 만듦",
  Boolean(fromAdd),
  fromAdd ? `${fromAdd.time} · title="${fromAdd.title}"` : "없음",
);
// 이 예약은 아래 시나리오와 섞이면 안 되므로 지우고 시작한다.
server.bookings.clear();
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);

// ----- 1. 빈 칸 클릭 → 창이 뜨지 않고 상세 패널이 열린다 -----
const emptyCell = page.getByRole("button", { name: /^Create reservation on/ }).first();
await emptyCell.waitFor({ timeout: 10_000 });
await emptyCell.click();

await page.waitForTimeout(800);
const dialogCount = await page.locator('[role="dialog"]').count();
record("빈 칸 클릭에 모달이 뜨지 않음", dialogCount === 0, `role=dialog ${dialogCount}개`);

const detailOpen = await page
  .getByText("Subtotal Due", { exact: false })
  .first()
  .isVisible()
  .catch(() => false);
record("상세 패널이 바로 열림", detailOpen);

// "바로 나온다" 는 렌더됐다는 뜻이 아니라 **스크롤 없이 보인다**는 뜻이다.
// 좁은 화면에서는 격자가 높이를 다 먹고 패널이 화면 밖으로 밀릴 수 있다.
const panelBox = await page
  .getByText("Subtotal Due", { exact: false })
  .first()
  .evaluate((el) => {
    const card = el.closest("article") ?? el;
    const r = card.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
  })
  .catch(() => null);
record(
  `상세 패널이 스크롤 없이 화면 안에 보임 (${WIDTH}x${HEIGHT})`,
  Boolean(panelBox && panelBox.top < panelBox.vh && panelBox.bottom > 0),
  panelBox ? `패널 top=${Math.round(panelBox.top)} / 화면높이 ${panelBox.vh}` : "패널 못 찾음",
);

// ----- 2. 이름이 없으면 Guest -----
const created = [...server.bookings.values()][0];
record(
  "서버에 예약 1건 생성됨",
  Boolean(created),
  created ? `${created.date} ${created.time} · title="${created.title}"` : "없음",
);
record(
  "생성 시 플레이어 이름 기본값이 Guest",
  created?.players?.[0]?.firstName === "Guest",
  `firstName="${created?.players?.[0]?.firstName}" type="${created?.players?.[0]?.type}"`,
);
record("생성 시 예약 제목 기본값이 Guest", created?.title === "Guest", `title="${created?.title}"`);

// 서버 값만 보면 화면이 실제로 무엇을 보여주는지 모른다. 격자에서 **선택된** 예약
// 칸(aria-pressed=true)의 글자를 직접 읽는다 — 프로 샵 직원이 보는 그 줄이다.
// aria-label 에 "N of 4 players" 가 들어가는 버튼 = 일 시트의 예약 세그먼트.
// 그냥 aria-pressed 로 잡으면 툴바의 "Today" 토글이 먼저 걸린다.
const gridCell = page.locator('button[aria-pressed="true"][aria-label*="players"]').first();
const gridBefore = (await gridCell.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
record("격자 칸이 Guest 로 보임", gridBefore.includes("Guest"), `칸 글자 "${gridBefore}"`);

// ----- 3. 이름을 적으면 제목이 따라간다 -----
const firstNameBox = page.locator('input[placeholder="First Name"]').first();
const lastNameBox = page.locator('input[placeholder="Last Name"]').first();
const hasNameBoxes = (await firstNameBox.count()) > 0 && (await lastNameBox.count()) > 0;
record("상세 패널에 이름 입력칸이 있음", hasNameBoxes);

if (hasNameBoxes) {
  await lastNameBox.fill("LEE");
  await firstNameBox.fill("HANSOI");
  await firstNameBox.blur();
  // 자동 저장 디바운스 700ms + 이름 패치 + 제목 패치.
  await page.waitForTimeout(2500);

  const after = server.bookings.get(created.id);
  record(
    "이름이 서버에 저장됨",
    after?.players?.[0]?.lastName === "LEE" && after?.players?.[0]?.firstName === "HANSOI",
    `"${after?.players?.[0]?.lastName}, ${after?.players?.[0]?.firstName}"`,
  );
  record("예약 제목이 이름을 따라감", after?.title === "LEE, HANSOI", `title="${after?.title}"`);

  const gridAfter = (await gridCell.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  record(
    "격자 칸이 입력한 이름으로 바뀜",
    gridAfter.includes("LEE, HANSOI"),
    `칸 글자 "${gridAfter}"`,
  );
}

// ----- 4. 결제 -----
const payButton = page.getByRole("button", { name: /Pay all/ }).first();
const hasPay = (await payButton.count()) > 0;
record("결제 버튼이 보임", hasPay);

if (hasPay) {
  await payButton.click();
  await page.waitForTimeout(500);
  // Payment 는 영수증 미리보기를 연다. 거기서 실제 결제 버튼을 누른다.
  const confirm = page.getByRole("button", { name: /^Pay \$.* & print$/ }).first();
  if ((await confirm.count()) > 0) {
    await confirm.click();
  } else {
    // 미리보기 안의 버튼 이름이 다르면 그 창의 버튼을 전부 찍어 둔다(원인 파악용).
    console.log("  미리보기 버튼 목록:", await page.locator('[role="dialog"] button').allInnerTexts());
  }
  await page.waitForTimeout(2000);

  const paidDoc = server.bookings.get(created.id);
  const paidPlayer = paidDoc?.players?.[0];
  record(
    "서버에 결제가 기록됨",
    Boolean(paidPlayer?.paid && paidPlayer?.paidAt),
    `paid=${paidPlayer?.paid} paidAt=${paidPlayer?.paidAt ?? "null"}`,
  );

  const printed = await page.evaluate(() => window.__printed ?? []);
  const receipt = printed.find((html) => typeof html === "string" && html.length > 0);
  record("영수증이 출력됨", Boolean(receipt), `출력 호출 ${printed.length}건`);

  const expected = (RATE * (1 + TAX)).toFixed(2);
  record(
    `영수증 합계가 그린피+세금과 맞음 ($${expected})`,
    Boolean(receipt && receipt.includes(expected)),
    receipt ? `기대 $${expected}` : "영수증 없음",
  );

  const note = await page
    .getByText("Payment not saved to the server", { exact: false })
    .count()
    .catch(() => 0);
  record("결제 실패 경고가 없음", note === 0);
}

// ----- 5. 기존 예약에 사람을 더 붙이는 길 (상세 패널의 점선 + 버튼) -----
// 격자의 + 와는 다른 경로다. useTeeSheet.addPlayer 는 type: "Guest" 를 보낸다.
//
// 여기가 한 번 깨졌던 자리다: addPlayer 가 type: "Guest" 를 보내던 시절에는
// 이름을 적어 저장해도 격자가 끝까지 "Guest" 였다. 그래서 이름이 실제로 칸에
// 나타나는지까지 본다.
// 이 버튼의 접근 이름은 글자 "+" 라 title 로는 못 찾는다. 속성으로 직접 고른다.
const addSeat = page.locator('button[title="Add a player to this reservation"]').first();
if ((await addSeat.count()) > 0) {
  await addSeat.click();
  await page.waitForTimeout(900);

  const two = server.bookings.get(created.id);
  record("두 번째 플레이어가 붙음", two?.players?.length === 2, `${two?.players?.length}명`);
  record(
    "두 번째 플레이어 기본 이름이 Guest",
    two?.players?.[1]?.firstName === "Guest",
    `firstName="${two?.players?.[1]?.firstName}" type="${two?.players?.[1]?.type}"`,
  );

  // 그 사람 이름을 적는다 — 두 번째 카드의 입력칸.
  const last2 = page.locator('input[placeholder="Last Name"]').nth(1);
  const first2 = page.locator('input[placeholder="First Name"]').nth(1);
  if ((await last2.count()) > 0) {
    await last2.fill("KIM");
    await first2.fill("MINJI");
    await first2.blur();
    await page.waitForTimeout(2500);

    const named = server.bookings.get(created.id);
    record(
      "두 번째 플레이어 이름이 저장됨",
      named?.players?.[1]?.lastName === "KIM",
      `"${named?.players?.[1]?.lastName}, ${named?.players?.[1]?.firstName}" type="${named?.players?.[1]?.type}"`,
    );

    const cell2 = (await gridCell.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    record(
      "격자 칸에 두 번째 플레이어 이름이 보임",
      cell2.includes("KIM, MINJI"),
      `칸 글자 "${cell2}"`,
    );
  }
}

await page.screenshot({ path: "shots/check-book-to-payment.png", fullPage: false });

console.log("\n--- RPC 호출 순서 ---");
if (leaked.length > 0) console.log("LEAKED Supabase calls:", leaked);
for (const call of server.calls) console.log(` ${call.fn}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
