"use client";

// 티시트 상태 스트립 + 요일 탭 + 토스트 스택.
// 이 파일은 토스트를 렌더링하는 유일한 곳이다 (다른 컴포넌트가 여기에 의존한다).
//
// 레이아웃은 pelhamhills 관리자 티시트를 그대로 따른다:
//   (a) 얇은 상태 스트립 — 왼쪽 기온/일출·일몰/카운터, **가운데** 큰 날짜, 오른쪽 노트 글리프
//   (b) 요일 탭 스트립  — 오늘부터 7일, 폭을 꽉 채운 파란 띠
//
// 화면 제목("Tee Sheet")과 Add 버튼은 여기 있었지만 `AdminShell` 의 상단바로 옮겼다.
// 레퍼런스 화면에는 상단바가 하나뿐인데 우리는 두 줄이었다 — 클럽 이름 줄과
// 티시트 자체 헤더 줄이 겹쳐서 세로로 40px 을 헛되이 먹고 있었다.

import { useEffect, useMemo, useState } from "react";

import DayTabs from "@/components/admin/DayTabs";
import { dayNumber, longDate, minutesToTime, toDate } from "@/lib/teeSheet/dates";
import type { TeeSheetController, Toast } from "@/lib/teeSheet/types";

export type DateNavProps = { controller: TeeSheetController };

const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * 큰 날짜 블록의 아랫줄. dates.ts 의 `headerCaption` 은 "Tuesday · Sep 2026" 한 줄이라
 * 레퍼런스의 2행 배치(요일 / 월·연도)에 그대로 쓸 수 없다.
 */
function monthYear(iso: string): string {
  const date = toDate(iso);
  return `${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

// ===== 일출 / 일몰 =====
// Pelham Hills Golf Club, Fonthill ON. 시간대를 고정 상수로 두는 이유: 서버(UTC일 수 있음)와
// 브라우저가 서로 다른 TZ여도 같은 문자열이 나와야 하이드레이션이 깨지지 않는다.
const CLUB_LAT = 43.03;
const CLUB_LON = -79.29;
const CLUB_TZ = "America/Toronto";
const CLUB_CLOCK = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: CLUB_TZ,
});

/** UTC 자정 기준 분 → 클럽 현지(America/Toronto) 자정 기준 분. */
function toClubMinutes(iso: string, utcMinutes: number): number {
  if (!Number.isFinite(utcMinutes)) return Number.NaN;
  const [y, m, d] = iso.split("-").map(Number);
  const instant = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1) + utcMinutes * 60_000);
  const [hh, mm] = CLUB_CLOCK.format(instant).split(":").map(Number);
  return hh * 60 + mm;
}

/**
 * NOAA General Solar Position Calculations (태양 천정각 90.833°)의 축약 구현.
 * 결과는 "클럽 현지 시각" 기준 자정부터의 분이며, 해가 뜨지 않는 위도에서는 acos가 NaN을 낸다.
 */
function sunMinutes(iso: string): { sunrise: number; sunset: number } {
  const date = toDate(iso);
  const dayOfYear = Math.round((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1); // fractional year, 정오 기준
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const lat = (CLUB_LAT * Math.PI) / 180;
  const cosHa = Math.cos((90.833 * Math.PI) / 180) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  const ha = (Math.acos(cosHa) * 180) / Math.PI; // |cosHa| > 1 → NaN (백야/극야)
  const solarNoonUtc = 720 - 4 * CLUB_LON - eqTime; // UTC 자정부터의 분
  return {
    sunrise: toClubMinutes(iso, solarNoonUtc - 4 * ha),
    sunset: toClubMinutes(iso, solarNoonUtc + 4 * ha),
  };
}

function clockOrDash(minutes: number): string {
  return Number.isFinite(minutes) ? minutesToTime(minutes) : "—";
}

// ===== 기온 =====
//
// 예전에는 이 자리를 비워 뒀다 — "실제 피드가 없으니 가짜 숫자를 띄우지 않는다".
// 그 원칙은 그대로 두고, 대신 **진짜 값**을 가져온다. Open-Meteo 는 키가 필요 없는
// 공개 API 라서 정적 export 인 이 앱에서도 브라우저에서 바로 부를 수 있다.
//
// 실패하면 아무것도 그리지 않는다 (`null`). 프로 샵 화면이 날씨 API 때문에
// 깨지거나 "—" 같은 잔해를 남기면 안 된다.
const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${CLUB_LAT}&longitude=${CLUB_LON}` +
  `&current=temperature_2m&timezone=${encodeURIComponent(CLUB_TZ)}`;

function useClubTemperature(): number | null {
  const [celsius, setCelsius] = useState<number | null>(null);

  useEffect(() => {
    // 마운트 후에만 부른다 — 서버 렌더 HTML 에 기온이 박히면 정적 export 된 페이지가
    // 빌드 시점의 날씨를 보여 주고, 하이드레이션도 어긋난다.
    const abort = new AbortController();
    fetch(WEATHER_URL, { signal: abort.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const value = data?.current?.temperature_2m;
        if (typeof value === "number" && Number.isFinite(value)) setCelsius(Math.round(value));
      })
      .catch(() => {
        // 오프라인 · 차단 · rate limit — 전부 "기온을 안 그린다" 로 수렴한다.
      });
    return () => abort.abort();
  }, []);

  return celsius;
}

const TOAST_STYLE: Record<Toast["kind"], string> = {
  info: "border-[#d4d4d8] bg-white text-[#1f2328]",
  success: "border-[#bde5ca] bg-[#dbf5e3] text-[#126c31]",
  error: "border-[#e7c3b6] bg-[#fbe9e2] text-[#8a3f26]",
};

// 상태 스트립 글리프 — 순수 장식이라 aria-hidden, 의미는 감싸는 요소의 title이 전달한다.
const ICON = "h-3.5 w-3.5 shrink-0";

function ThermometerIcon() {
  return (
    <svg aria-hidden="true" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16">
      <path d="M6.4 9.2V3.4a1.6 1.6 0 0 1 3.2 0v5.8" />
      <circle cx="8" cy="11.4" r="2.6" />
    </svg>
  );
}

function SunIcon({ up }: { up: boolean }) {
  return (
    <svg aria-hidden="true" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16">
      <circle cx="8" cy="9.5" r="2.6" />
      <path d="M1 13.5h14" />
      {up ? <path d="M8 1.5v2.4M4 3l1.2 1.6M12 3l-1.2 1.6" /> : <path d="M8 4.5v-2.4M6.2 3.6 8 5.4l1.8-1.8" />}
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg aria-hidden="true" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.5" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg aria-hidden="true" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16">
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.6 13.4c0-2.4 2-4 4.4-4s4.4 1.6 4.4 4M11 3.4a2.3 2.3 0 0 1 0 4.4M12.2 9.8c1.4.5 2.3 1.8 2.3 3.6" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg aria-hidden="true" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16">
      <path d="M2 4.5h6.5v5H2zM8.5 6.5H12l2 3v0h-5.5z" />
      <circle cx="4.5" cy="12" r="1.4" />
      <circle cx="11.5" cy="12" r="1.4" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg aria-hidden="true" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 16 16">
      <path d="M3.5 1.8h9v12.4h-9zM5.8 5h4.4M5.8 8h4.4M5.8 11h2.6" />
    </svg>
  );
}

export default function DateNav({ controller }: DateNavProps) {
  const { connection, focusedDate, stats, toasts, visibleBookings } = controller;

  // stats.reservations는 "예약 수"라서 한 티타임에 두 예약이 붙으면 2로 센다.
  // 상태 스트립의 첫 카운터는 "예약이 하나라도 있는 티타임 수"라 날짜+시각으로 중복을 제거한다.
  const teeTimeCount = useMemo(
    () => new Set(visibleBookings.map((booking) => `${booking.date} ${booking.time}`)).size,
    [visibleBookings],
  );

  const sun = useMemo(() => sunMinutes(focusedDate), [focusedDate]);
  const celsius = useClubTemperature();

  return (
    <>
      {/* (a) 상태 스트립 — 왼쪽 기온·일출·일몰·카운터 / 가운데 큰 날짜 / 오른쪽 노트 글리프.
          3열 그리드다: 가운데 칸이 **화면 기준으로** 가운데여야 하므로 좌우를 같은
          `1fr` 로 잡는다. flex + ml-auto 로는 왼쪽 카운터 자릿수에 따라 날짜가 흔들린다.

          예전에 여기 붙어 있던 집계 칩(Reservations · Arrived · Paid · Revenue ·
          Outstanding)과 연결 상태 배지는 레퍼런스에 없어서 뺐다. 같은 정보를
          Reports 화면과 토스트가 이미 말해 준다. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-[#d4d4d8] bg-white px-4 py-1.5 text-xs text-[#4e5560]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {/* 기온은 도착하면 그때 나타난다 (실패하면 영영 안 나온다). */}
          {celsius !== null ? (
            <span className="flex shrink-0 items-center gap-1.5" title="Current temperature at the club">
              <ThermometerIcon />
              {celsius}°
            </span>
          ) : null}
          <span className="flex shrink-0 items-center gap-1.5" title="Sunrise at the club">
            <SunIcon up />
            {clockOrDash(sun.sunrise)}
          </span>
          <span className="flex shrink-0 items-center gap-1.5" title="Sunset at the club">
            <SunIcon up={false} />
            {clockOrDash(sun.sunset)}
          </span>

          <span
            className="flex shrink-0 items-center gap-1.5 font-semibold text-[#111315]"
            title="Tee times with at least one reservation"
          >
            <CircleIcon />
            {teeTimeCount}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 font-semibold text-[#111315]" title="Players booked">
            <PeopleIcon />
            {stats.players}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 font-semibold text-[#111315]" title="Carts booked">
            <CartIcon />
            {stats.carts}
          </span>

          {/* 오프라인 복구 버튼은 레퍼런스에 없지만 남긴다 — 스크린샷은 정상 상태이고
              오류 상태에 대해서는 아무 말도 하지 않는다. 이걸 빼면 연결이 끊겼을 때
              다시 시도할 방법이 (날짜를 바꿔 보는 것 말고는) 사라진다. */}
          {connection === "offline" ? (
            <button
              className="shrink-0 border border-[#d7d7dc] bg-white px-2 py-0.5 font-bold hover:bg-[#f2f2f4] disabled:opacity-50"
              disabled={controller.busy}
              onClick={() => {
                void controller.refresh();
              }}
              type="button"
            >
              Retry
            </button>
          ) : null}
        </div>

        {/* 가운데: 큰 날짜. 블록 전체가 날짜 선택기다 — Week/Day 토글과 별도의 date
            입력칸을 없앴으므로(레퍼런스에 없다) 임의의 날짜로 가는 길이 여기 하나뿐이다.
            네이티브 <input type="date"> 를 투명하게 겹쳐 두고, 그 위를 누르면
            `showPicker()` 를 부른다. **투명하게 겹쳐 두는 것만으로는 부족하다** —
            크롬에서 날짜 입력칸의 글자 부분을 누르면 세그먼트에 포커스만 갈 뿐이고,
            달력은 오른쪽 끝 달력 아이콘에서만 열린다. 그 아이콘이 투명하니
            사용자에게는 "눌러도 아무 일이 없는 날짜" 가 된다.
            `showPicker()` 가 없는 브라우저에서는 입력칸이 그냥 포커스를 받고,
            키보드(숫자 입력 · 화살표)로 여전히 날짜를 바꿀 수 있다. */}
        <div className="relative flex shrink-0 items-center gap-2 text-[#111315]">
          <span className="text-2xl leading-none font-semibold">{dayNumber(focusedDate)}</span>
          <span className="text-[11px] leading-tight font-semibold">
            {WEEKDAY_FULL[toDate(focusedDate).getDay()]}
            <br />
            {monthYear(focusedDate)}
          </span>
          <span aria-hidden="true" className="text-[10px] leading-none text-[#4e5560]">
            ▾
          </span>
          <input
            aria-label="Jump to date"
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(event) => {
              if (event.target.value) controller.setFocusedDate(event.target.value);
            }}
            onClick={(event) => {
              // 자기 click 핸들러 안이라 사용자 제스처로 인정된다.
              event.currentTarget.showPicker?.();
            }}
            title={longDate(focusedDate)}
            type="date"
            value={focusedDate}
          />
        </div>

        {/* 하루 단위 노트 API 가 아직 없어서 동작하지 않는 버튼을 만들지 않았다 — 표시로만 둔다. */}
        <span aria-hidden="true" className="flex justify-end text-[#4e5560]">
          <NoteIcon />
        </span>
      </div>

      {/* (b) 요일 탭 스트립 — 오늘부터 7일. 요금 화면과 **같은 컴포넌트**를 쓴다
          (components/admin/DayTabs.tsx). 클래스를 베껴 두면 한쪽만 색이 바뀐다. */}
      <DayTabs onChange={controller.setFocusedDate} value={focusedDate} />

      {/* 토스트 스택 — BookingDialog(z-50) 위에 떠야 하므로 z-[60]. */}
      <div aria-live="polite" className="pointer-events-none fixed right-4 top-4 z-[60] flex w-72 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            className={`pointer-events-auto flex items-start gap-2 rounded border px-3 py-2 text-xs shadow-sm ${TOAST_STYLE[toast.kind]}`}
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            <span className="flex-1 leading-4">{toast.text}</span>
            <button
              aria-label="Dismiss notification"
              className="shrink-0 font-bold opacity-60 hover:opacity-100"
              onClick={() => controller.dismissToast(toast.id)}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
