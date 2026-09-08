"use client";

// 티시트 헤더 + 상태 스트립 + 요일 탭 + 통계/연결 상태 + 토스트 스택.
// 이 파일은 토스트를 렌더링하는 유일한 곳이다 (다른 컴포넌트가 여기에 의존한다).
// 레이아웃은 Chronogolf 관리자 티시트를 따른다: (a) 얇은 상태 스트립, (b) 요일 탭 스트립.

import { useMemo, useSyncExternalStore } from "react";

import {
  columnLabel,
  dayNumber,
  headerCaption,
  longDate,
  minutesToTime,
  money,
  startOfWeek,
  toDate,
  todayIso,
} from "@/lib/teeSheet/dates";
import type { TeeSheetController, Toast } from "@/lib/teeSheet/types";

export type DateNavProps = { controller: TeeSheetController; onAdd: () => void };

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sep 7" — dates.ts는 MONTH_SHORT를 export하지 않고 columnLabel은 오늘을 "Today"로 바꾸므로 여기서 만든다. */
function shortDay(iso: string): string {
  const date = toDate(iso);
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** "Wed 9" — columnLabel()의 "오늘이 아닐 때" 형태. 하이드레이션 전 라벨로만 쓴다(아래 주석 참고). */
function weekdayLabel(iso: string): string {
  const date = toDate(iso);
  return `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()}`;
}

/** "Sep 7 – Sep 13, 2026", 연도가 걸치면 "Dec 28, 2025 – Jan 3, 2026". */
function weekRangeLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const first = dates[0];
  const last = dates[dates.length - 1];
  const firstYear = toDate(first).getFullYear();
  const lastYear = toDate(last).getFullYear();
  const left = firstYear === lastYear ? shortDay(first) : `${shortDay(first)}, ${firstYear}`;
  return `${left} – ${shortDay(last)}, ${lastYear}`;
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

const CONNECTION_STYLE: Record<TeeSheetController["connection"], string> = {
  connecting: "bg-[#ececf0] text-[#4e5560]",
  online: "bg-[#dbf5e3] text-[#126c31]",
  offline: "bg-[#fff3cd] text-[#8a5b00]",
};

const CONNECTION_LABEL: Record<TeeSheetController["connection"], string> = {
  connecting: "Connecting…",
  online: "Online",
  offline: "Offline",
};

const TOAST_STYLE: Record<Toast["kind"], string> = {
  info: "border-[#d4d4d8] bg-white text-[#1f2328]",
  success: "border-[#bde5ca] bg-[#dbf5e3] text-[#126c31]",
  error: "border-[#e7c3b6] bg-[#fbe9e2] text-[#8a3f26]",
};

// 상태 스트립 글리프 — 순수 장식이라 aria-hidden, 의미는 감싸는 요소의 title이 전달한다.
const ICON = "h-3.5 w-3.5 shrink-0";

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

// 서버 렌더에서는 false, 하이드레이션 이후에는 true — "오늘"을 안전하게 읽기 위한 스위치.
const subscribeNever = () => () => {};
const getClient = () => true;
const getServer = () => false;

export default function DateNav({ controller, onAdd }: DateNavProps) {
  const { connection, focusedDate, message, stats, toasts, view, visibleBookings, weekDates, weekStart } = controller;

  // todayIso()는 서버 렌더와 클라이언트에서 달라질 수 있어(타임존) 하이드레이션 후에만 읽는다.
  const mounted = useSyncExternalStore(subscribeNever, getClient, getServer);
  const today = mounted ? todayIso() : null;

  const rangeLabel = useMemo(() => weekRangeLabel(weekDates), [weekDates]);
  // goToToday가 아무것도 바꾸지 않을 때만 비활성화한다.
  const onToday = today !== null && weekStart === startOfWeek(today) && focusedDate === today;

  // stats.reservations는 "예약 수"라서 한 티타임에 두 예약이 붙으면 2로 센다.
  // 상태 스트립의 첫 카운터는 "예약이 하나라도 있는 티타임 수"라 날짜+시각으로 중복을 제거한다.
  const teeTimeCount = useMemo(
    () => new Set(visibleBookings.map((booking) => `${booking.date} ${booking.time}`)).size,
    [visibleBookings],
  );

  const sun = useMemo(() => sunMinutes(focusedDate), [focusedDate]);

  return (
    <>
      <header className="flex items-center justify-between border-b border-[#d4d4d8] bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <a className="flex min-h-11 items-center text-sm font-bold lg:min-h-0" href="/admin">
            Tee Sheet
          </a>
        </div>
        <div className="flex items-center gap-2">
          <a className="flex min-h-11 items-center border border-[#d7d7dc] px-3 text-xs font-bold lg:min-h-0 lg:py-1" href="/booking">
            Booking
          </a>
          <button
            className="inline-flex min-h-11 items-center bg-[#4533ff] px-4 text-xs font-bold text-white lg:min-h-0 lg:py-1.5"
            onClick={onAdd}
            type="button"
          >
            Add +
          </button>
        </div>
      </header>

      {/* (a) 상태 스트립 — 일출/일몰 · 카운터 · 집계 · 연결 상태를 한 줄에 담고, 오른쪽에 큰 날짜.
          Lightspeed 관리자 화면과 같은 "한 줄" 구조다. 예전에는 이 줄과 집계 줄이 따로 있어
          날짜 · Players · Carts 가 두 번 나오고 세로로 40px 을 더 먹었다 — 티 시트가 그만큼 짧아진다.
          날씨(13°)는 실제 피드가 없어서 일부러 뺐다: 가짜 숫자를 띄우지 않는다.

          바깥은 줄바꿈 없는 2단 flex 다. 왼쪽(집계)만 `flex-wrap` 으로 접히고 오른쪽(날짜)은
          `shrink-0` 이라, 좁은 화면에서 집계가 몇 줄로 늘어나도 큰 날짜는 항상 오른쪽 위에 남는다.
          왼쪽을 `overflow-x-auto` 로 하면 대신 Retry 버튼이 스크롤 밖으로 숨어 버린다. */}
      <div className="flex items-center gap-3 border-b border-[#d4d4d8] bg-white px-4 py-1.5 text-xs text-[#4e5560]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex shrink-0 items-center gap-1.5" title="Sunrise at the club">
            <SunIcon up />
            {clockOrDash(sun.sunrise)}
          </span>
          <span className="flex shrink-0 items-center gap-1.5" title="Sunset at the club">
            <SunIcon up={false} />
            {clockOrDash(sun.sunset)}
          </span>

          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-[#d4d4d8]" />

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

          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-[#d4d4d8]" />

          {/* 일 뷰의 날짜는 오른쪽 큰 날짜와 겹치므로 주간 범위일 때만 낸다. */}
          {view === "week" ? <span className="shrink-0 font-semibold">{rangeLabel}</span> : null}
          <span className="shrink-0 rounded bg-[#111315] px-2 py-0.5 text-white">
            {stats.reservations} Reservations
          </span>
          <span className="shrink-0">{stats.arrived} Arrived</span>
          <span className="shrink-0">{stats.paid} Paid</span>
          <span className="shrink-0">{money(stats.revenue)} Revenue</span>
          <span className="shrink-0">{money(stats.outstanding)} Outstanding</span>

          {/* 상태 문구는 길어질 수 있다 ("Loaded 11 reservation(s) for the week of …").
              한 줄 스트립을 통째로 두 줄로 밀어내지 않도록 폭을 묶고 잘라 낸다 —
              전문은 title 툴팁과, 같은 내용을 띄우는 토스트에 남는다. */}
          <span
            className={`max-w-[24ch] truncate rounded px-2 py-0.5 font-semibold ${CONNECTION_STYLE[connection]}`}
            title={message ? `${CONNECTION_LABEL[connection]} · ${message}` : CONNECTION_LABEL[connection]}
          >
            {CONNECTION_LABEL[connection]}
            {message ? ` · ${message}` : ""}
          </span>
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

        <div className="ml-auto flex shrink-0 items-center gap-2 text-[#111315]">
          <span className="text-2xl leading-none font-semibold">{dayNumber(focusedDate)}</span>
          <span className="text-xs leading-tight font-semibold">{headerCaption(focusedDate)}</span>
          {/* 캐럿과 노트 글리프는 장식이다 — 캐럿의 실제 조작은 아래 줄의 date input이고,
              하루 단위 노트 API는 아직 없어서 동작하지 않는 버튼을 만들지 않았다. */}
          <span aria-hidden="true" className="text-[10px] leading-none text-[#4e5560]">
            ▾
          </span>
          <span aria-hidden="true" className="pl-2 text-[#4e5560]">
            <NoteIcon />
          </span>
        </div>
      </div>

      {/* (b) 요일 탭 스트립 + 주 이동 / 날짜 점프 / Week·Day 토글.
          한 화면 고정 레이아웃이라 페이지가 가로로 늘어나면 안 된다 → 탭만 내부에서 스크롤시킨다.

          `flex-wrap` 이 반드시 있어야 한다: 이 줄은 한 줄로 펴면 ~484px 를 요구하는데
          바깥 <main> 은 `overflow-hidden` 이라 넘치는 부분을 **잘라 버린다**(스크롤이 아니다).
          래핑이 없으면 390px(iPhone 14)에서 날짜 입력과 Week/Day 토글이 화면 밖으로
          잘려 나가 주간 뷰로 돌아갈 방법이 사라진다. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[#d4d4d8] bg-white px-4 py-1.5 text-xs">
        <button
          aria-label="Previous week"
          className="inline-flex min-h-11 shrink-0 items-center border border-[#d7d7dc] bg-white px-3 font-bold hover:bg-[#f2f2f4] lg:min-h-0 lg:py-1"
          onClick={controller.goToPreviousWeek}
          type="button"
        >
          ‹ Prev
        </button>
        <button
          className="inline-flex min-h-11 shrink-0 items-center border border-[#d7d7dc] bg-white px-3 font-bold hover:bg-[#f2f2f4] disabled:cursor-default disabled:opacity-40 lg:min-h-0 lg:py-1"
          disabled={onToday}
          onClick={controller.goToToday}
          type="button"
        >
          Today
        </button>
        <button
          aria-label="Next week"
          className="inline-flex min-h-11 shrink-0 items-center border border-[#d7d7dc] bg-white px-3 font-bold hover:bg-[#f2f2f4] lg:min-h-0 lg:py-1"
          onClick={controller.goToNextWeek}
          type="button"
        >
          Next ›
        </button>

        {/* 좁은 화면에서는 `basis-full` 로 탭 줄을 통째로 자기 줄에 내린다.
            `flex-1`(= basis 0%) 만 두면 flex 가 줄바꿈 판단에서 이 항목을 0px 로 보고
            같은 줄에 밀어 넣은 뒤 남는 폭만 나눠 줘서, 탭 스트립이 몇십 px 로 눌린다.
            sm 이상에서는 원래의 한 줄 레이아웃(basis 0 + grow)으로 돌아간다.
            어느 쪽이든 탭은 자기 컨테이너 안에서만 가로 스크롤한다. */}
        <div className="min-w-0 basis-full overflow-x-auto sm:flex-1 sm:basis-0">
          <div className="flex w-max gap-1">
            {weekDates.map((iso) => {
              // columnLabel()은 내부에서 todayIso()를 부른다 → 서버 타임존 기준 "Today"가 섞이면
              // 하이드레이션이 깨진다. 마운트 전에는 요일 라벨만 쓰고, 이후에만 columnLabel을 믿는다.
              const label = mounted ? columnLabel(iso) : weekdayLabel(iso);
              const active = iso === focusedDate;
              return (
                <button
                  aria-pressed={active}
                  className={`inline-flex min-h-11 items-center border px-3 font-bold whitespace-nowrap lg:min-h-0 lg:py-1 ${
                    active
                      ? "border-[#4533ff] bg-[#4533ff] text-white"
                      : "border-[#d7d7dc] bg-white hover:bg-[#f2f2f4]"
                  }`}
                  key={iso}
                  onClick={() => controller.setFocusedDate(iso)}
                  title={longDate(iso)}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <input
          aria-label="Jump to date"
          className="shrink-0 border border-[#d7d7dc] bg-white px-2 py-1 text-xs"
          onChange={(event) => {
            if (event.target.value) controller.setFocusedDate(event.target.value);
          }}
          type="date"
          value={focusedDate}
        />
        <div className="flex shrink-0 gap-1">
          <button
            aria-pressed={view === "week"}
            className={`inline-flex min-h-11 items-center border border-[#d7d7dc] px-3 font-bold lg:min-h-0 lg:py-1 ${
              view === "week" ? "bg-[#4533ff] text-white" : "bg-white"
            }`}
            onClick={() => controller.setView("week")}
            type="button"
          >
            Week
          </button>
          <button
            aria-pressed={view === "day"}
            className={`inline-flex min-h-11 items-center border border-[#d7d7dc] px-3 font-bold lg:min-h-0 lg:py-1 ${
              view === "day" ? "bg-[#4533ff] text-white" : "bg-white"
            }`}
            onClick={() => controller.setView("day")}
            type="button"
          >
            Day
          </button>
        </div>
      </div>

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
