"use client";

// 티 시트 그리드. 예약 막대는 절대 좌표(px)가 아니라 실제 CSS grid 자식으로
// `gridColumn` / `gridRow`에 배치된다 — 컬럼 폭이나 행 높이가 뷰포트에 따라
// 변해도 정렬이 구조적으로 유지된다. 매직 픽셀 오프셋은 하나도 없다.

import { Fragment, useMemo } from "react";
import type { CSSProperties } from "react";

import {
  columnLabel,
  dayIndexIn,
  isWeekend,
  longDate,
  money,
  timeToMinutes,
  toDate,
  todayIso,
} from "@/lib/teeSheet/dates";
import type {
  BookingColor,
  BookingStatus,
  TeeBooking,
  TeeSheetController,
  TeeSlot,
} from "@/lib/teeSheet/types";

export type WeekGridProps = {
  controller: TeeSheetController;
  onCreateAt: (date: string, time: string) => void;
};

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-09-11" -> "Sep 11" (aria-label 전용 짧은 형식). */
function shortDate(iso: string): string {
  const date = toDate(iso);
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

const STATUS_LABEL: Record<BookingStatus, string> = {
  reserved: "Reserved",
  checked_in: "Checked in",
  paid: "Paid",
  cancelled: "Cancelled",
  no_show: "No show",
  blocked: "Blocked",
};

const COLOR_CLASS: Record<BookingColor, string> = {
  blue: "bg-[#0034c9] text-white",
  gold: "bg-[#ffd400] text-[#1d232b]",
  gray: "bg-[#ececf0] text-[#4e5560]",
};

/** 취소선 처리된 대각 해칭 — blocked 예약 전용 배경. */
const HATCH_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, #d5d5dd 0px, #d5d5dd 4px, #ececf0 4px, #ececf0 9px)",
};

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#4533ff] focus-visible:ring-offset-0";

function bookingCapacity(booking: TeeBooking): number {
  return Math.max(4, booking.players.length);
}

/** 아직 결제되지 않은 플레이어 기준 미수금. */
function amountDue(booking: TeeBooking): number {
  if (booking.status === "cancelled" || booking.status === "blocked") return 0;
  const unpaid = booking.players.filter((player) => !player.paid && !player.cancelled);
  const heads = booking.players.length === 0 ? 1 : unpaid.length;
  return heads * booking.rate;
}

function isDead(booking: TeeBooking): boolean {
  return booking.status === "cancelled" || booking.status === "no_show";
}

export default function WeekGrid({ controller, onCreateAt }: WeekGridProps) {
  const { view, weekDates, focusedDate, weekStart, visibleBookings, slots, selectedId } = controller;
  const isDayView = view === "day";
  const today = todayIso();

  // ===== 컬럼: 실제 ISO 날짜. 하드코딩된 요일 배열은 쓰지 않는다. =====
  // useTeeSheet이 weekDates를 매 렌더 새로 만들 수도 있으므로 배열 identity가 아니라
  // 값(join)으로 의존한다 — 아래의 모든 useMemo 캐스케이드가 헛돌지 않게.
  const weekKey = weekDates.join(",");
  const columns = useMemo(
    () => (isDayView ? [focusedDate] : weekKey.split(",")),
    [isDayView, focusedDate, weekKey],
  );

  const colIndex = useMemo(() => {
    const map = new Map<string, number>();
    columns.forEach((iso, index) => map.set(iso, index));
    return map;
  }, [columns]);

  // ===== 행: 슬롯이 없으면 보이는 예약의 시각에서 파생시킨다 (예약이 사라지면 안 됨). =====
  const slotsLoading = slots.length === 0;

  const rows = useMemo<TeeSlot[]>(() => {
    if (slots.length > 0) {
      return [...slots].sort((a, b) => a.minutes - b.minutes);
    }
    const derived = new Map<string, TeeSlot>();
    for (const booking of visibleBookings) {
      if (derived.has(booking.time)) continue;
      const minutes = timeToMinutes(booking.time);
      derived.set(booking.time, {
        time: booking.time,
        minutes: Number.isFinite(minutes) ? minutes : Number.MAX_SAFE_INTEGER,
        rate: booking.rate,
        cartsTotal: 0,
      });
    }
    return [...derived.values()].sort((a, b) => a.minutes - b.minutes);
  }, [slots, visibleBookings]);

  const rowIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((slot, index) => map.set(slot.time, index));
    return map;
  }, [rows]);

  // ===== `${date}|${time}` 버킷. 같은 칸의 예약들은 한 grid 자식 안에서 나란히 놓인다. =====
  const buckets = useMemo(() => {
    const map = new Map<string, TeeBooking[]>();
    for (const booking of visibleBookings) {
      if (!colIndex.has(booking.date) || !rowIndex.has(booking.time)) continue;
      const key = `${booking.date}|${booking.time}`;
      const list = map.get(key);
      if (list) list.push(booking);
      else map.set(key, [booking]);
    }
    return map;
  }, [visibleBookings, colIndex, rowIndex]);

  // 그리드에 놓을 수 없는 예약들 — 조용히 사라지지 않도록 아래 스트립으로 뺀다.
  const offGrid = useMemo(() => {
    const noSlot: TeeBooking[] = [];
    const otherDays: TeeBooking[] = [];
    const outOfRange: TeeBooking[] = [];
    for (const booking of visibleBookings) {
      const hasRow = rowIndex.has(booking.time);
      const hasCol = colIndex.has(booking.date);
      if (hasRow && hasCol) continue;
      if (!hasRow) {
        noSlot.push(booking);
      } else if (isDayView && dayIndexIn(weekStart, booking.date) >= 0) {
        otherDays.push(booking);
      } else {
        outOfRange.push(booking);
      }
    }
    return { noSlot, otherDays, outOfRange };
  }, [visibleBookings, rowIndex, colIndex, isDayView, weekStart]);

  // 행별 카트 집계: 보이는 범위 전체에서 해당 슬롯에 잡힌 카트 수.
  const cartsByTime = useMemo(() => {
    const map = new Map<string, number>();
    for (const booking of visibleBookings) {
      if (!colIndex.has(booking.date) || isDead(booking)) continue;
      map.set(booking.time, (map.get(booking.time) ?? 0) + (booking.cartCount || 0));
    }
    return map;
  }, [visibleBookings, colIndex]);

  // 그리드 라인 좌표. 트랙: [Time, Rate, ...days, Cart]
  const dayColStart = 3;
  const cartCol = dayColStart + columns.length;
  const fullRowEnd = cartCol + 1; // 마지막 라인 (= 트랙 수 + 1)
  const bodyRowEnd = rows.length + 2;

  const gridTemplateColumns = isDayView
    ? "96px 64px minmax(280px, 1fr) 72px"
    : `86px 48px repeat(${columns.length}, minmax(120px, 1fr)) 64px`;

  const gridTemplateRows =
    rows.length > 0
      ? `auto repeat(${rows.length}, minmax(${isDayView ? 40 : 29}px, auto))`
      : "auto";

  const cellAlign = isDayView ? "items-start pt-2" : "items-center";

  // 예약이 차지한 칸에는 "빈 칸" 버튼을 그리지 않는다.
  const covered = useMemo(() => {
    const set = new Set<string>();
    for (const [key, list] of buckets) {
      const [date, time] = key.split("|");
      const row = rowIndex.get(time)!;
      const col = colIndex.get(date)!;
      const span = isDayView
        ? 1
        : Math.min(
            Math.max(1, ...list.map((booking) => Math.max(1, booking.span || 1))),
            columns.length - col,
          );
      for (let offset = 0; offset < span; offset += 1) set.add(`${row}|${col + offset}`);
    }
    return set;
  }, [buckets, rowIndex, colIndex, isDayView, columns.length]);

  // Time 열 폭 — Rate 열의 sticky left 오프셋 계산에 쓴다.
  const timeColWidth = isDayView ? 96 : 86;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* 스크롤 컨테이너는 반드시 하나. 가로·세로를 한 컨테이너가 잡아야
          헤더 행과 Time/Rate 열을 position:sticky 로 고정("프리즈")할 수 있다.
          페이지 본문은 여전히 가로로 밀리지 않는다. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded border border-[#d6d6dc] bg-white">
        <div className={isDayView ? "min-w-[560px]" : "min-w-[1050px]"}>
          <div className="grid text-xs" style={{ gridTemplateColumns, gridTemplateRows }}>
            {/* ---------- 헤더 행 (grid row 1) ---------- */}
            <div
              className="sticky top-0 left-0 z-40 border-b border-[#d6d6dc] bg-[#d7d5da] p-2 text-left font-bold"
              style={{ gridColumn: 1, gridRow: 1 }}
            >
              Time
            </div>
            <div
              className="sticky top-0 z-40 border-b border-[#d6d6dc] bg-[#d7d5da] p-2 text-center font-bold"
              style={{ gridColumn: 2, gridRow: 1, left: timeColWidth }}
            >
              Rate
            </div>

            {columns.map((iso, index) => {
              const isToday = iso === today;
              const weekend = isWeekend(iso);
              const isFocused = iso === focusedDate;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => controller.setFocusedDate(iso)}
                  aria-label={`Show ${longDate(iso)}`}
                  aria-pressed={isFocused}
                  title={longDate(iso)}
                  className={`sticky top-0 z-30 border-b border-[#d6d6dc] p-2 text-center font-bold ${FOCUS_RING} ${
                    isToday
                      ? "bg-[#4533ff] text-white"
                      : weekend
                        ? "bg-[#cdcbd2] text-[#1f2328]"
                        : "bg-[#d7d5da] text-[#1f2328]"
                  } ${isFocused && !isToday ? "underline decoration-[#4533ff] decoration-2 underline-offset-2" : ""}`}
                  style={{ gridColumn: dayColStart + index, gridRow: 1 }}
                >
                  {columnLabel(iso)}
                </button>
              );
            })}

            <div
              className="sticky top-0 z-30 border-b border-[#d6d6dc] bg-[#d7d5da] p-2 text-center font-bold"
              style={{ gridColumn: cartCol, gridRow: 1 }}
            >
              Cart
            </div>

            {/* ---------- 배경 레이어: 컬럼 세로줄 + 주말 틴트 (본문 전체 높이) ---------- */}
            {rows.length > 0 &&
              columns.map((iso, index) => (
                <div
                  key={`col-bg-${iso}`}
                  aria-hidden
                  className={`pointer-events-none border-l border-[#ececf0] ${
                    isWeekend(iso) ? "bg-[#f6f6fa]" : ""
                  }`}
                  style={{
                    gridColumn: dayColStart + index,
                    gridRow: `2 / ${bodyRowEnd}`,
                  }}
                />
              ))}
            {rows.length > 0 && (
              <div
                aria-hidden
                className="pointer-events-none border-l border-[#ececf0]"
                style={{ gridColumn: cartCol, gridRow: `2 / ${bodyRowEnd}` }}
              />
            )}

            {/* ---------- 배경 레이어: 행 구분선 ---------- */}
            {rows.map((slot, index) =>
              index === rows.length - 1 ? null : (
                <div
                  key={`row-bg-${slot.time}`}
                  aria-hidden
                  className="pointer-events-none border-b border-[#ececf0]"
                  style={{ gridColumn: `1 / ${fullRowEnd}`, gridRow: index + 2 }}
                />
              ),
            )}

            {/* ---------- Time / Rate / Cart 셀 ---------- */}
            {rows.map((slot, index) => {
              const booked = cartsByTime.get(slot.time) ?? 0;
              return (
                <Fragment key={`meta-${slot.time}`}>
                  <div
                    className={`sticky left-0 z-20 flex ${cellAlign} bg-white px-2 font-semibold ${
                      index === rows.length - 1 ? "" : "border-b border-[#ececf0]"
                    }`}
                    style={{ gridColumn: 1, gridRow: index + 2 }}
                  >
                    {slot.time}
                  </div>
                  <div
                    className={`sticky z-20 flex ${cellAlign} justify-center bg-white text-[#9aa0a6] ${
                      index === rows.length - 1 ? "" : "border-b border-[#ececf0]"
                    }`}
                    style={{ gridColumn: 2, gridRow: index + 2, left: timeColWidth }}
                  >
                    {money(slot.rate)}
                  </div>
                  <div
                    className={`relative flex ${cellAlign} justify-center gap-1 text-[#3f4650]`}
                    style={{ gridColumn: cartCol, gridRow: index + 2 }}
                    title={
                      slot.cartsTotal > 0
                        ? `${booked} cart(s) booked at ${slot.time} across ${columns.length} day(s) · ${slot.cartsTotal} available per day`
                        : `${booked} cart(s) booked at ${slot.time}`
                    }
                  >
                    <span aria-hidden>🚗</span>
                    <span className={booked > slot.cartsTotal && slot.cartsTotal > 0 ? "font-bold text-[#8a3f26]" : ""}>
                      {slot.cartsTotal > 0 ? `${booked}/${slot.cartsTotal}` : booked}
                    </span>
                  </div>
                </Fragment>
              );
            })}

            {/* ---------- 빈 칸 버튼 ---------- */}
            {rows.map((slot, rowIdx) =>
              columns.map((iso, colIdx) => {
                if (covered.has(`${rowIdx}|${colIdx}`)) return null;
                return (
                  <button
                    key={`empty-${iso}-${slot.time}`}
                    type="button"
                    onClick={() => onCreateAt(iso, slot.time)}
                    aria-label={`Create reservation on ${shortDate(iso)} at ${slot.time}`}
                    className={`group relative flex scroll-mt-10 items-center justify-center hover:bg-[#f0efff] ${FOCUS_RING}`}
                    style={{ gridColumn: dayColStart + colIdx, gridRow: rowIdx + 2 }}
                  >
                    <span
                      aria-hidden
                      className="text-[13px] leading-none font-bold text-[#b6b6c0] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    >
                      +
                    </span>
                  </button>
                );
              }),
            )}

            {/* ---------- 예약 막대 — 진짜 grid 자식 ---------- */}
            {[...buckets.entries()].map(([key, list]) => {
              const [date, time] = key.split("|");
              const rowIdx = rowIndex.get(time)!;
              const colIdx = colIndex.get(date)!;
              const span = isDayView
                ? 1
                : Math.min(
                    Math.max(1, ...list.map((booking) => Math.max(1, booking.span || 1))),
                    columns.length - colIdx,
                  );
              return (
                <div
                  key={`bucket-${key}`}
                  // scroll-mt: 고정된 헤더 행 뒤로 숨은 채 스크롤되지 않도록
                  // (키보드 포커스/프로그램 스크롤이 헤더 아래에 멈추게 한다).
                  className={`relative z-10 flex min-w-0 scroll-mt-10 gap-[2px] px-[3px] py-[4px] ${
                    isDayView ? "flex-col" : "items-center"
                  }`}
                  style={{
                    gridColumn: `${dayColStart + colIdx} / span ${span}`,
                    gridRow: rowIdx + 2,
                  }}
                >
                  {list.map((booking) =>
                    isDayView ? (
                      <DayBookingRow
                        key={booking.id}
                        booking={booking}
                        selected={booking.id === selectedId}
                        onSelect={controller.select}
                      />
                    ) : (
                      <BookingBar
                        key={booking.id}
                        booking={booking}
                        selected={booking.id === selectedId}
                        onSelect={controller.select}
                      />
                    ),
                  )}
                </div>
              );
            })}
          </div>

          {/* rows가 0이면 grid 본문 자체를 그리지 않는다 (repeat(0, …)는 무효 CSS). */}
          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-[#6b7280]">
              {controller.connection === "offline"
                ? "Offline — no tee times cached for this range yet."
                : "Loading tee times…"}
            </p>
          )}
        </div>
      </div>

      {/* 격자 아래 보조 영역: 화면 고정 레이아웃에서 자라지 않도록 상한을 두고
          자체 스크롤시킨다 (한 화면 규칙이 깨지면 안 된다). */}
      <div className="max-h-[22vh] shrink-0 overflow-y-auto">
        {slotsLoading && rows.length > 0 && (
          <p className="mt-2 text-[11px] text-[#6b7280]">
            {controller.connection === "offline"
              ? "Offline — showing only the tee times that already have reservations."
              : "Loading the full tee time list… showing times taken from existing reservations."}
          </p>
        )}

        <OffGridStrip
          title="Unscheduled / off-grid — no matching tee time"
          hint="These reservations have a time that is not on the current tee sheet. They are still open and editable."
          bookings={offGrid.noSlot}
          selectedId={selectedId}
          onSelect={controller.select}
        />
        <OffGridStrip
          title="Other days this week"
          hint="Outside the focused day. Switch to week view or pick the date to see them in the grid."
          bookings={offGrid.otherDays}
          selectedId={selectedId}
          onSelect={controller.select}
        />
        <OffGridStrip
          title="Outside the visible range"
          hint="These reservations fall outside the dates currently shown."
          bookings={offGrid.outOfRange}
          selectedId={selectedId}
          onSelect={controller.select}
        />
      </div>
    </div>
  );
}

// ===================== 하위 컴포넌트 =====================

type BookingButtonProps = {
  booking: TeeBooking;
  selected: boolean;
  onSelect: (bookingId: string | null) => void;
};

/** 주간 뷰의 압축 막대. */
function BookingBar({ booking, selected, onSelect }: BookingButtonProps) {
  const blocked = booking.status === "blocked";
  const cancelled = isDead(booking);
  return (
    <button
      type="button"
      onClick={() => onSelect(booking.id)}
      aria-pressed={selected}
      title={`${booking.title} · ${booking.time} · ${STATUS_LABEL[booking.status]}`}
      style={blocked ? HATCH_STYLE : undefined}
      className={`flex h-[19px] min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-sm px-1.5 text-left text-[11px] leading-none font-bold shadow-sm ${FOCUS_RING} ${
        blocked ? "text-[#4e5560]" : COLOR_CLASS[booking.color]
      } ${cancelled ? "line-through opacity-55" : ""} ${selected ? "ring-2 ring-[#111315]" : ""}`}
    >
      <span className="truncate">{blocked ? "Blocked" : booking.title}</span>
      {!blocked && (
        <span className="ml-auto shrink-0 rounded-sm bg-black/15 px-1 text-[10px] font-bold">
          {booking.players.length}/{bookingCapacity(booking)}
        </span>
      )}
    </button>
  );
}

/** 일간 뷰의 넓은 행 — 플레이어 이름 / 상태 / 카트 / 미수금을 모두 보여준다. */
function DayBookingRow({ booking, selected, onSelect }: BookingButtonProps) {
  const blocked = booking.status === "blocked";
  const cancelled = isDead(booking);
  const names = booking.players.map((player) => player.name || `${player.firstName} ${player.lastName}`.trim());
  const due = amountDue(booking);
  return (
    <button
      type="button"
      onClick={() => onSelect(booking.id)}
      aria-pressed={selected}
      style={blocked ? HATCH_STYLE : undefined}
      className={`w-full rounded-sm px-2 py-1.5 text-left text-[11px] shadow-sm ${FOCUS_RING} ${
        blocked ? "text-[#4e5560]" : COLOR_CLASS[booking.color]
      } ${cancelled ? "opacity-60" : ""} ${selected ? "ring-2 ring-[#111315]" : ""}`}
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`font-bold ${cancelled ? "line-through" : ""}`}>
          {blocked ? "Blocked" : booking.title}
        </span>
        <span className="rounded-sm bg-black/15 px-1 text-[10px] font-bold">
          {booking.players.length}/{bookingCapacity(booking)}
        </span>
        <span className="rounded-sm border border-current px-1 text-[10px] font-semibold opacity-80">
          {STATUS_LABEL[booking.status]}
        </span>
        <span className="text-[10px] opacity-90">{booking.holes} holes</span>
        <span className="text-[10px] opacity-90">🚗 {booking.cartCount}</span>
        <span className="ml-auto text-[10px] font-bold">
          {due > 0 ? `${money(due)} due` : "Settled"}
        </span>
      </span>
      {names.length > 0 && (
        <span className={`mt-1 block truncate text-[10px] opacity-85 ${cancelled ? "line-through" : ""}`}>
          {names.join(" · ")}
        </span>
      )}
      {cancelled && booking.cancelReason && (
        <span className="mt-1 block truncate text-[10px] font-semibold opacity-90">
          {booking.cancelReason}
        </span>
      )}
    </button>
  );
}

type OffGridStripProps = {
  title: string;
  hint: string;
  bookings: TeeBooking[];
  selectedId: string | null;
  onSelect: (bookingId: string | null) => void;
};

/** 그리드에 놓을 수 없는 예약을 드러내는 스트립. 절대 조용히 버리지 않는다. */
function OffGridStrip({ title, hint, bookings, selectedId, onSelect }: OffGridStripProps) {
  if (bookings.length === 0) return null;
  return (
    <section className="mt-3 rounded border border-[#d6d6dc] bg-white p-3 text-xs">
      <h3 className="flex items-center gap-2 font-bold text-[#1f2328]">
        <span className="rounded-sm bg-[#ffd400] px-1.5 py-0.5 text-[10px] text-[#1d232b]">
          {bookings.length}
        </span>
        {title}
      </h3>
      <p className="mt-1 text-[11px] text-[#6b7280]">{hint}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {bookings.map((booking) => (
          <li key={booking.id}>
            <button
              type="button"
              onClick={() => onSelect(booking.id)}
              aria-pressed={booking.id === selectedId}
              className={`flex items-center gap-2 rounded-sm border border-[#d6d6dc] px-2 py-1 text-left text-[11px] ${FOCUS_RING} ${
                COLOR_CLASS[booking.color]
              } ${isDead(booking) ? "line-through opacity-60" : ""} ${
                booking.id === selectedId ? "ring-2 ring-[#111315]" : ""
              }`}
            >
              <span className="font-bold">{booking.title}</span>
              <span className="opacity-90">
                {shortDate(booking.date)} · {booking.time}
              </span>
              <span className="rounded-sm bg-black/15 px-1 text-[10px] font-bold">
                {booking.players.length}/{bookingCapacity(booking)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
