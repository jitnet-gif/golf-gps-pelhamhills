"use client";

// 티시트 헤더 + 날짜 내비게이션 + 통계/연결 상태 + 토스트 스택.
// 이 파일은 토스트를 렌더링하는 유일한 곳이다 (다른 컴포넌트가 여기에 의존한다).

import { useMemo, useSyncExternalStore } from "react";

import { dayNumber, headerCaption, money, startOfWeek, toDate, todayIso } from "@/lib/teeSheet/dates";
import type { TeeSheetController, Toast } from "@/lib/teeSheet/types";

export type DateNavProps = { controller: TeeSheetController; onAdd: () => void };

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 7" — dates.ts는 MONTH_SHORT를 export하지 않고 columnLabel은 오늘을 "Today"로 바꾸므로 여기서 만든다. */
function shortDay(iso: string): string {
  const date = toDate(iso);
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
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

// 서버 렌더에서는 false, 하이드레이션 이후에는 true — "오늘"을 안전하게 읽기 위한 스위치.
const subscribeNever = () => () => {};
const getClient = () => true;
const getServer = () => false;

export default function DateNav({ controller, onAdd }: DateNavProps) {
  const { connection, focusedDate, message, stats, toasts, view, weekDates, weekStart } = controller;

  // todayIso()는 서버 렌더와 클라이언트에서 달라질 수 있어(타임존) 하이드레이션 후에만 읽는다.
  const mounted = useSyncExternalStore(subscribeNever, getClient, getServer);
  const today = mounted ? todayIso() : null;

  const rangeLabel = useMemo(() => weekRangeLabel(weekDates), [weekDates]);
  // goToToday가 아무것도 바꾸지 않을 때만 비활성화한다.
  const onToday = today !== null && weekStart === startOfWeek(today) && focusedDate === today;

  return (
    <>
      <header className="flex items-center justify-between border-b border-[#d4d4d8] bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <a className="text-sm font-bold" href="/admin">
            Tee Sheet
          </a>
        </div>
        <div className="flex items-center gap-2">
          <a className="border border-[#d7d7dc] px-3 py-1.5 text-xs font-bold" href="/booking">
            Booking
          </a>
          <button
            className="bg-[#4533ff] px-4 py-1.5 text-xs font-bold text-white"
            onClick={onAdd}
            type="button"
          >
            Add +
          </button>
        </div>
      </header>

      <section className="border-b border-[#d4d4d8] bg-white px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          {/* 주 이동 / 임의 날짜 점프 */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              aria-label="Previous week"
              className="border border-[#d7d7dc] bg-white px-3 py-1.5 font-bold hover:bg-[#f2f2f4]"
              onClick={controller.goToPreviousWeek}
              type="button"
            >
              ‹ Prev
            </button>
            <button
              className="border border-[#d7d7dc] bg-white px-3 py-1.5 font-bold hover:bg-[#f2f2f4] disabled:cursor-default disabled:opacity-40"
              disabled={onToday}
              onClick={controller.goToToday}
              type="button"
            >
              Today
            </button>
            <button
              aria-label="Next week"
              className="border border-[#d7d7dc] bg-white px-3 py-1.5 font-bold hover:bg-[#f2f2f4]"
              onClick={controller.goToNextWeek}
              type="button"
            >
              Next ›
            </button>
            <input
              aria-label="Jump to date"
              className="border border-[#d7d7dc] bg-white px-2 py-1.5 text-xs"
              onChange={(event) => {
                if (event.target.value) controller.setFocusedDate(event.target.value);
              }}
              type="date"
              value={focusedDate}
            />
            <span className="font-semibold text-[#4e5560]">{rangeLabel}</span>
          </div>

          {/* 포커스된 날짜 */}
          <div className="text-center">
            <p className="text-3xl font-semibold leading-none">{dayNumber(focusedDate)}</p>
            <p className="text-xs font-semibold">{headerCaption(focusedDate)}</p>
          </div>

          {/* Week / Day 토글 */}
          <div className="flex gap-2">
            <button
              aria-pressed={view === "week"}
              className={`border border-[#d7d7dc] px-3 py-1.5 text-xs font-bold ${
                view === "week" ? "bg-[#4533ff] text-white" : "bg-white"
              }`}
              onClick={() => controller.setView("week")}
              type="button"
            >
              Week
            </button>
            <button
              aria-pressed={view === "day"}
              className={`border border-[#d7d7dc] px-3 py-1.5 text-xs font-bold ${
                view === "day" ? "bg-[#4533ff] text-white" : "bg-white"
              }`}
              onClick={() => controller.setView("day")}
              type="button"
            >
              Day
            </button>
          </div>
        </div>

        {/* 보이는 범위(주/일)에 대한 통계 + 연결 상태 */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded bg-[#111315] px-2 py-1 text-white">{stats.reservations} Reservations</span>
          <span>{stats.players} Players</span>
          <span>{stats.arrived} Arrived</span>
          <span>{stats.paid} Paid</span>
          <span>{stats.carts} Carts</span>
          <span>{money(stats.revenue)} Revenue</span>
          <span>{money(stats.outstanding)} Outstanding</span>

          <span className={`rounded px-2 py-1 font-semibold ${CONNECTION_STYLE[connection]}`}>
            {CONNECTION_LABEL[connection]}
            {message ? ` · ${message}` : ""}
          </span>
          {connection === "offline" ? (
            <button
              className="border border-[#d7d7dc] bg-white px-2 py-1 font-bold hover:bg-[#f2f2f4] disabled:opacity-50"
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
      </section>

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
