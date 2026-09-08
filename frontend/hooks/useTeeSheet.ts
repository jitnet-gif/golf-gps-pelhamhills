"use client";

// 티 시트 상태 훅 (tee sheet state hook).
//
// 설계 원칙 (design rules this file exists to enforce):
//  1. 모든 날짜는 실제 ISO 날짜로부터 파생된다 — `dayIndex` 하드코딩 없음.
//  2. 모든 액션은 내부에서 await 되고 절대 reject 하지 않는다. 실패는 `null` / `false`
//     + 에러 토스트로 표면화된다. 그래야 호출부가 `void controller.setStatus(...)`를
//     안전하게 쓸 수 있다.
//  3. 네트워크 장애(ApiError status 0)는 영구적인 사망 선고가 아니다 — 로컬 사본으로
//     내려앉았다가 주기적으로 재시도해서 복구한다.
//  4. 낙관적 업데이트는 실패 시 반드시 롤백되고, 늦게 도착한 응답은 최신 상태를
//     덮어쓰지 못한다(예약별 시퀀스 번호).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, teeSheetApi } from "@/lib/teeSheet/api";
import {
  addDays,
  longDate,
  startOfWeek,
  timeToMinutes,
  todayIso,
  weekDates as weekDatesFor,
} from "@/lib/teeSheet/dates";
import type {
  AddPlayerInput,
  BookingStatus,
  ConnectionState,
  CreateBookingInput,
  PatchBookingInput,
  PatchPlayerInput,
  Player,
  TeeBooking,
  TeeSheetController,
  TeeSlot,
  Toast,
  ViewMode,
} from "@/lib/teeSheet/types";

// ===== Constants =====

/** 서버 가드와 동일한 클라이언트 가드 (mirrors the backend rule). */
const MAX_PLAYERS_PER_TEE_TIME = 4;
const MIN_PLAYERS_PER_BOOKING = 1;
const TOAST_TTL_MS = 5000;
const RETRY_INTERVAL_MS = 15000;

// ===== Local id helper =====

let localIdCounter = 0;

function localId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}-${localIdCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===== Fallback data (bundled seed used only when the API is unreachable) =====
//
// 별도 데이터 파일을 만들지 않는다 — 이 훅이 소유한 유일한 시드.
// 날짜는 모듈 로드 시점의 "이번 주"에서 파생하므로, 오프라인이어도 기본 뷰가 비지 않는다.

const FALLBACK_SLOT_TIMES = [
  "6:40 AM", "6:49 AM", "6:58 AM", "7:07 AM", "7:16 AM", "7:25 AM", "7:34 AM",
  "7:43 AM", "7:52 AM", "8:01 AM", "8:10 AM", "9:00 AM", "10:00 AM", "11:00 AM",
  "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM",
];

const FALLBACK_RATE = 47.79;

const FALLBACK_SLOTS: TeeSlot[] = FALLBACK_SLOT_TIMES.map((time) => ({
  time,
  minutes: timeToMinutes(time),
  rate: FALLBACK_RATE,
  cartsTotal: MAX_PLAYERS_PER_TEE_TIME,
}));

function makePlayer(input: Partial<Player> = {}): Player {
  const first = (input.firstName ?? "").trim();
  const last = (input.lastName ?? "").trim();
  const combined = `${first} ${last}`.trim();
  const name = (input.name ?? "").trim() || combined || "Guest";
  const parts = name.split(/\s+/);
  const derivedFirst = parts[0] ?? "";
  const derivedLast = parts.slice(1).join(" ");

  return {
    // 로컬에서 만든 플레이어도 반드시 실제 id 를 갖는다. 예전 코드는 id 가 undefined 인
    // 플레이어의 서버 수정을 조용히 건너뛰어 상세 패널이 죽은 것처럼 보였다.
    id: localId("lp"),
    name,
    firstName: first || derivedFirst,
    lastName: last || derivedLast,
    email: input.email ?? "",
    phone: input.phone ?? "",
    type: input.type ?? "Guest",
    ratePlan: input.ratePlan ?? "",
    arrived: input.arrived ?? false,
    paid: input.paid ?? false,
    cancelled: input.cancelled ?? false,
    no_show: input.no_show ?? false,
  };
}

function makeFallbackBooking(seed: {
  date: string;
  time: string;
  title: string;
  color: TeeBooking["color"];
  cartCount: number;
  players: Array<Partial<Player>>;
}): TeeBooking {
  const now = new Date().toISOString();
  return {
    id: localId("fb"),
    date: seed.date,
    time: seed.time,
    holes: 18,
    rate: FALLBACK_RATE,
    span: 1,
    color: seed.color,
    title: seed.title,
    status: "reserved",
    cartCount: seed.cartCount,
    notes: "",
    players: seed.players.map((player) => makePlayer(player)),
    audit: [{ id: localId("fa"), ts: now, message: "Local sample record (offline seed)." }],
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

const FALLBACK_WEEK = weekDatesFor(todayIso());
const FALLBACK_TODAY = todayIso();
const FALLBACK_OTHER_DAY = FALLBACK_WEEK[2] ?? FALLBACK_TODAY;

/** 마지막 성공 응답이 없을 때 사용하는 번들 시드. */
const FALLBACK_BOOKINGS: TeeBooking[] = [
  makeFallbackBooking({
    date: FALLBACK_TODAY,
    time: "6:58 AM",
    title: "Predote, Marie",
    color: "gold",
    cartCount: 2,
    players: [
      { name: "Marie Predote", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart" },
      { name: "Roseann Norton", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart" },
      { name: "Steve Murphy", type: "Existing Customer", ratePlan: "Full Member - Single with 7 Day Cart" },
    ],
  }),
  makeFallbackBooking({
    date: FALLBACK_TODAY,
    time: "7:07 AM",
    title: "Wheeland, Bryan",
    color: "blue",
    cartCount: 0,
    players: [
      { name: "Bryan Wheeland", type: "Existing Customer", ratePlan: "Weekday Member - Single" },
      { name: "Colin Scott", type: "Existing Customer", ratePlan: "Weekday Member - Single" },
    ],
  }),
  makeFallbackBooking({
    date: FALLBACK_TODAY,
    time: "7:25 AM",
    title: "Nicalou, Chris",
    color: "gold",
    cartCount: 1,
    players: [
      { name: "Chris Nicalou", type: "Existing Customer", ratePlan: "Full Member - Single with 7 Day Cart" },
      { name: "Triada Nicolou", type: "Existing Customer", ratePlan: "Full Member - Single with 7 Day Cart" },
    ],
  }),
  makeFallbackBooking({
    date: FALLBACK_OTHER_DAY,
    time: "7:16 AM",
    title: "Marshall, Dan",
    color: "blue",
    cartCount: 1,
    players: [
      { name: "Dan Marshall", type: "Existing Customer", ratePlan: "Weekday Member - Single" },
      { name: "Leslie Reid", type: "Existing Customer", ratePlan: "Weekday Member - Single" },
      { name: "Joe Grdovich", type: "Existing Customer", ratePlan: "Weekday Member - Single" },
    ],
  }),
  makeFallbackBooking({
    date: FALLBACK_OTHER_DAY,
    time: "8:01 AM",
    title: "Carlsson, James",
    color: "gold",
    cartCount: 0,
    players: [
      { name: "James Carlsson", type: "Existing Customer", ratePlan: "GolfNow" },
      { name: "Guest", type: "Guest", ratePlan: "GolfNow" },
    ],
  }),
];

// ===== Pure helpers =====

function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

function errorDetail(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

function sortBookings(list: TeeBooking[]): TeeBooking[] {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    // 알 수 없는 시간 라벨이라도 절대 버리지 않는다 — 맨 뒤로 정렬만 한다.
    const aMinutes = timeToMinutes(a.time);
    const bMinutes = timeToMinutes(b.time);
    const left = Number.isNaN(aMinutes) ? Number.MAX_SAFE_INTEGER : aMinutes;
    const right = Number.isNaN(bMinutes) ? Number.MAX_SAFE_INTEGER : bMinutes;
    if (left !== right) return left - right;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out as Partial<T>;
}

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function touch(booking: TeeBooking): TeeBooking {
  return { ...booking, updatedAt: new Date().toISOString() };
}

function mergePlayer(player: Player, patch: PatchPlayerInput): Player {
  const next: Player = { ...player, ...stripUndefined(patch), id: player.id };
  if (patch.firstName !== undefined || patch.lastName !== undefined) {
    next.name = `${next.firstName} ${next.lastName}`.trim() || next.name;
  } else if (patch.name !== undefined) {
    const parts = next.name.trim().split(/\s+/);
    next.firstName = parts[0] ?? "";
    next.lastName = parts.slice(1).join(" ");
  }
  return next;
}

/** 상태 변경이 플레이어에 미치는 로컬 파급효과 (서버 응답이 오면 덮어쓰여진다). */
function applyStatusLocally(booking: TeeBooking, status: BookingStatus, cancelReason?: string): TeeBooking {
  return {
    ...booking,
    status,
    cancelReason: status === "cancelled" ? cancelReason ?? booking.cancelReason ?? null : booking.cancelReason,
    players: booking.players.map((player) => ({
      ...player,
      arrived: status === "checked_in" || status === "paid" ? true : player.arrived,
      paid: status === "paid" ? true : player.paid,
      cancelled: status === "cancelled" ? true : player.cancelled,
      no_show: status === "no_show" ? true : player.no_show,
    })),
  };
}

// ===== The hook =====

export function useTeeSheet(): TeeSheetController {
  // --- state ---
  const [bookings, setBookings] = useState<TeeBooking[]>([]);
  const [slots, setSlots] = useState<TeeSlot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setViewState] = useState<ViewMode>("week");
  const [focusedDate, setFocusedDateState] = useState<string>(() => todayIso());
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [message, setMessage] = useState<string>("Connecting to the tee sheet service…");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyCount, setBusyCount] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  // --- refs (stale closure 방지용) ---
  const mountedRef = useRef(true);
  const bookingsRef = useRef<TeeBooking[]>([]);
  const slotsRef = useRef<TeeSlot[]>([]);
  const connectionRef = useRef<ConnectionState>("connecting");
  const focusedDateRef = useRef<string>(focusedDate);
  const weekStartRef = useRef<string>(startOfWeek(focusedDate));
  const lastGoodRef = useRef<TeeBooking[] | null>(null);
  /** 예약별 요청 시퀀스 — 늦게 도착한 응답이 최신 상태를 덮어쓰지 못하게 한다. */
  const seqRef = useRef<Map<string, number>>(new Map());
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const weekLoadRef = useRef(0);
  const slotLoadRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --- derived dates ---
  const weekStart = useMemo(() => startOfWeek(focusedDate), [focusedDate]);
  const weekDateList = useMemo(() => weekDatesFor(focusedDate), [focusedDate]);

  useEffect(() => {
    focusedDateRef.current = focusedDate;
    weekStartRef.current = weekStart;
  }, [focusedDate, weekStart]);

  // --- toasts ---
  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((kind: Toast["kind"], text: string): string => {
    const id = localId("toast");
    setToasts((current) => [...current, { id, kind, text }]);
    const timer = setTimeout(() => {
      toastTimersRef.current.delete(id);
      if (mountedRef.current) setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_TTL_MS);
    toastTimersRef.current.set(id, timer);
    return id;
  }, []);

  // 언마운트 시 타이머 정리.
  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // --- synchronous state writers (ref + state 동시 갱신) ---
  const commitBookings = useCallback((updater: (current: TeeBooking[]) => TeeBooking[]) => {
    const next = sortBookings(updater(bookingsRef.current));
    bookingsRef.current = next;
    setBookings(next);
  }, []);

  const commitSlots = useCallback((next: TeeSlot[]) => {
    slotsRef.current = next;
    setSlots(next);
  }, []);

  const commitConnection = useCallback((next: ConnectionState) => {
    connectionRef.current = next;
    setConnection(next);
  }, []);

  const beginBusy = useCallback(() => setBusyCount((count) => count + 1), []);
  const endBusy = useCallback(() => setBusyCount((count) => Math.max(0, count - 1)), []);

  const replaceBooking = useCallback(
    (next: TeeBooking) => {
      commitBookings((current) =>
        current.some((booking) => booking.id === next.id)
          ? current.map((booking) => (booking.id === next.id ? next : booking))
          : [...current, next],
      );
    },
    [commitBookings],
  );

  const dropBooking = useCallback(
    (bookingId: string) => {
      commitBookings((current) => current.filter((booking) => booking.id !== bookingId));
      // 선택된 예약이 사라지면 dangling 하지 않도록 선택 해제.
      setSelectedId((current) => (current === bookingId ? null : current));
    },
    [commitBookings],
  );

  const reconcileSelection = useCallback((data: TeeBooking[]) => {
    setSelectedId((current) => (current && data.some((booking) => booking.id === current) ? current : null));
  }, []);

  const nextSeq = useCallback((bookingId: string): number => {
    const next = (seqRef.current.get(bookingId) ?? 0) + 1;
    seqRef.current.set(bookingId, next);
    return next;
  }, []);

  const isCurrentSeq = useCallback(
    (bookingId: string, seq: number): boolean => seqRef.current.get(bookingId) === seq,
    [],
  );

  // --- offline handling ---
  const enterOffline = useCallback(
    (detail: string, reseed: boolean) => {
      const wasOffline = connectionRef.current === "offline";
      if (wasOffline) return;

      commitConnection("offline");
      if (reseed) {
        // 마지막으로 성공한 응답을 우선 사용하고, 없으면 번들 시드를 쓴다.
        commitBookings(() => lastGoodRef.current ?? FALLBACK_BOOKINGS);
        reconcileSelection(lastGoodRef.current ?? FALLBACK_BOOKINGS);
        if (slotsRef.current.length === 0) commitSlots(FALLBACK_SLOTS);
      }
      pushToast("error", `Server unreachable — working offline. ${detail}`);
      setMessage(
        "서버에 연결할 수 없습니다 — 로컬 사본으로 계속 작업합니다. Offline: local changes are not saved and will be replaced when the server comes back.",
      );
    },
    [commitBookings, commitConnection, commitSlots, pushToast, reconcileSelection],
  );

  // --- loaders ---
  const loadBookings = useCallback(
    async (anchorWeekStart: string, isStale: () => boolean): Promise<void> => {
      try {
        const data = await teeSheetApi.listBookings({
          from: anchorWeekStart,
          to: addDays(anchorWeekStart, 6),
        });
        if (isStale() || !mountedRef.current) return;
        const wasOffline = connectionRef.current === "offline";
        lastGoodRef.current = data;
        commitBookings(() => data);
        reconcileSelection(data);
        commitConnection("online");
        // 최초 로드("connecting" -> "online")에는 재연결 토스트를 띄우지 않는다.
        if (wasOffline) pushToast("success", "Reconnected to the tee sheet service.");
        setMessage(`Loaded ${data.length} reservation(s) for the week of ${longDate(anchorWeekStart)}.`);
      } catch (error) {
        if (isStale() || !mountedRef.current) return;
        const detail = errorDetail(error);
        if (isNetworkError(error)) {
          enterOffline(detail, true);
          return;
        }
        // 서버는 살아 있다 — 온라인을 유지하고 에러만 표면화한다.
        if (connectionRef.current === "connecting") commitConnection("online");
        pushToast("error", detail);
        setMessage(`예약을 불러오지 못했습니다 — could not load bookings: ${detail}`);
      }
    },
    [commitBookings, commitConnection, enterOffline, pushToast, reconcileSelection],
  );

  const loadSlots = useCallback(
    async (date: string, isStale: () => boolean): Promise<void> => {
      try {
        const response = await teeSheetApi.getSlots(date);
        if (isStale() || !mountedRef.current) return;
        commitSlots(response.slots);
      } catch (error) {
        if (isStale() || !mountedRef.current) return;
        const detail = errorDetail(error);
        if (isNetworkError(error)) {
          enterOffline(detail, true);
          if (slotsRef.current.length === 0) commitSlots(FALLBACK_SLOTS);
          return;
        }
        pushToast("error", detail);
        setMessage(`티 타임 슬롯을 불러오지 못했습니다 — could not load slots: ${detail}`);
      }
    },
    [commitSlots, enterOffline, pushToast],
  );

  // 주(week)가 바뀔 때만 예약을 다시 불러온다. cleanup 으로 늦은 응답을 무시한다.
  useEffect(() => {
    void reloadNonce; // refresh()/재연결 시 강제 재실행 트리거
    let cancelled = false;
    const generation = weekLoadRef.current + 1;
    weekLoadRef.current = generation;
    const isStale = () => cancelled || weekLoadRef.current !== generation;
    void loadBookings(weekStart, isStale);
    return () => {
      cancelled = true;
    };
  }, [weekStart, reloadNonce, loadBookings]);

  // 슬롯은 포커스된 하루 기준.
  useEffect(() => {
    void reloadNonce;
    let cancelled = false;
    const generation = slotLoadRef.current + 1;
    slotLoadRef.current = generation;
    const isStale = () => cancelled || slotLoadRef.current !== generation;
    void loadSlots(focusedDate, isStale);
    return () => {
      cancelled = true;
    };
  }, [focusedDate, reloadNonce, loadSlots]);

  // 오프라인이면 주기적으로 + `online` 이벤트에서 재시도한다.
  useEffect(() => {
    const probe = async () => {
      if (!mountedRef.current || connectionRef.current !== "offline") return;
      try {
        await teeSheetApi.getSlots(focusedDateRef.current);
      } catch (error) {
        // 네트워크 자체가 죽었으면 계속 오프라인. 그 외 응답은 "서버 살아있음"으로 본다.
        if (isNetworkError(error)) return;
      }
      if (!mountedRef.current || connectionRef.current !== "offline") return;
      commitConnection("online");
      pushToast("success", "Connection restored — reloading from the server.");
      setMessage("서버 연결이 복구되었습니다 — reloading the tee sheet from the server.");
      setReloadNonce((nonce) => nonce + 1);
    };

    const interval = setInterval(() => {
      void probe();
    }, RETRY_INTERVAL_MS);
    const onOnline = () => {
      void probe();
    };
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
    };
  }, [commitConnection, pushToast]);

  // --- shared booking mutation runner ---
  const runBookingMutation = useCallback(
    async (params: {
      bookingId: string;
      /** 낙관적(온라인) / 로컬(오프라인) 결과를 모두 만드는 순수 변환. */
      apply: (booking: TeeBooking) => TeeBooking;
      call: () => Promise<TeeBooking>;
      statusText: string;
      successToast?: string;
      failText: string;
    }): Promise<TeeBooking | null> => {
      const before = bookingsRef.current.find((booking) => booking.id === params.bookingId);
      if (!before) {
        pushToast("error", "예약을 찾을 수 없습니다 — that reservation no longer exists.");
        setMessage("Reservation not found — it may have been removed.");
        return null;
      }

      const seq = nextSeq(params.bookingId);
      const optimistic = touch(params.apply(before));
      replaceBooking(optimistic);

      if (connectionRef.current === "offline") {
        setMessage(`${params.statusText} (오프라인 로컬 사본 — not saved to the server yet.)`);
        if (params.successToast) pushToast("info", `${params.successToast} — saved locally only (offline).`);
        return optimistic;
      }

      beginBusy();
      try {
        const server = await params.call();
        if (!mountedRef.current) return server;
        if (!isCurrentSeq(params.bookingId, seq)) return server; // 늦은 응답 — 최신 상태 보존
        replaceBooking(server);
        setMessage(params.statusText);
        if (params.successToast) pushToast("success", params.successToast);
        return server;
      } catch (error) {
        if (!mountedRef.current) return null;
        const detail = errorDetail(error);
        if (isNetworkError(error)) {
          // 연결이 끊긴 것뿐이므로 낙관적 변경을 유지하고 오프라인으로 전환한다.
          enterOffline(detail, false);
          setMessage(`${params.statusText} — 로컬에만 적용됨 (server unreachable).`);
          return isCurrentSeq(params.bookingId, seq) ? optimistic : null;
        }
        // 실패는 언제나 표면화한다 — 같은 예약에 더 최신 요청이 있어도 에러를 삼키지 않는다.
        pushToast("error", detail);
        setMessage(`${params.failText}: ${detail}`);
        // 롤백은 이 요청이 여전히 최신일 때만 (오래된 응답이 새 상태를 덮어쓰지 않도록).
        if (isCurrentSeq(params.bookingId, seq)) replaceBooking(before);
        return null;
      } finally {
        endBusy();
      }
    },
    [beginBusy, endBusy, enterOffline, isCurrentSeq, nextSeq, pushToast, replaceBooking],
  );

  // --- booking actions ---
  const createBooking = useCallback(
    async (input: CreateBookingInput): Promise<TeeBooking | null> => {
      const requested = input.players ?? [];
      if (requested.length > MAX_PLAYERS_PER_TEE_TIME) {
        pushToast("error", `한 티 타임에는 최대 ${MAX_PLAYERS_PER_TEE_TIME}명까지 — max ${MAX_PLAYERS_PER_TEE_TIME} players per tee time.`);
        setMessage(`A tee time can hold at most ${MAX_PLAYERS_PER_TEE_TIME} players.`);
        return null;
      }
      if (!input.date || !input.time) {
        pushToast("error", "날짜와 티 타임을 선택하세요 — a date and tee time are required.");
        setMessage("A date and tee time are required to create a reservation.");
        return null;
      }

      const buildLocal = (): TeeBooking => {
        const now = new Date().toISOString();
        const slotRate = slotsRef.current.find((slot) => slot.time === input.time)?.rate;
        return {
          id: localId("lb"),
          date: input.date,
          time: input.time,
          holes: input.holes ?? 18,
          rate: input.rate ?? slotRate ?? FALLBACK_RATE,
          span: 1,
          color: input.color ?? "blue",
          title: input.title || "New reservation",
          status: "reserved",
          cartCount: input.cartCount ?? 0,
          notes: input.notes ?? "",
          players: requested.map((player) => makePlayer(player as Partial<Player>)),
          audit: [{ id: localId("la"), ts: now, message: "Created offline (local copy)." }],
          cancelReason: null,
          createdAt: now,
          updatedAt: now,
        };
      };

      if (connectionRef.current === "offline") {
        const local = buildLocal();
        commitBookings((current) => [...current, local]);
        setSelectedId(local.id);
        pushToast("info", `Created "${local.title}" locally — offline, not saved to the server.`);
        setMessage(`오프라인 로컬 예약 생성 — created "${local.title}" at ${local.time} on this device only.`);
        return local;
      }

      beginBusy();
      try {
        const created = await teeSheetApi.createBooking(input);
        if (!mountedRef.current) return created;
        replaceBooking(created);
        setSelectedId(created.id);
        pushToast("success", `Reservation created for ${created.time}.`);
        setMessage(`예약 생성 완료 — created "${created.title}" at ${created.time} on ${longDate(created.date)}.`);
        return created;
      } catch (error) {
        if (!mountedRef.current) return null;
        const detail = errorDetail(error);
        if (isNetworkError(error)) {
          enterOffline(detail, false);
          const local = buildLocal();
          commitBookings((current) => [...current, local]);
          setSelectedId(local.id);
          setMessage(`서버 연결 없음 — created "${local.title}" locally only.`);
          return local;
        }
        pushToast("error", detail);
        setMessage(`예약 생성 실패 — could not create the reservation: ${detail}`);
        return null;
      } finally {
        endBusy();
      }
    },
    [beginBusy, commitBookings, endBusy, enterOffline, pushToast, replaceBooking],
  );

  const patchBookingWith = useCallback(
    (bookingId: string, patch: PatchBookingInput, statusText: string, failText: string, successToast?: string) =>
      runBookingMutation({
        bookingId,
        apply: (booking) => ({ ...booking, ...stripUndefined(patch) }),
        call: () => teeSheetApi.patchBooking(bookingId, patch),
        statusText,
        failText,
        successToast,
      }),
    [runBookingMutation],
  );

  const patchBooking = useCallback(
    (bookingId: string, patch: PatchBookingInput): Promise<TeeBooking | null> => {
      if (patch.cartCount !== undefined && patch.cartCount < 0) {
        pushToast("error", "카트 수는 0보다 작을 수 없습니다 — cart count cannot be negative.");
        setMessage("Cart count cannot be negative.");
        return Promise.resolve(null);
      }
      return patchBookingWith(bookingId, patch, "Reservation updated.", "예약 수정 실패 — could not update the reservation");
    },
    [patchBookingWith, pushToast],
  );

  const moveBooking = useCallback(
    (bookingId: string, date: string, time: string): Promise<TeeBooking | null> => {
      if (!date || !time) {
        pushToast("error", "이동할 날짜/시간이 올바르지 않습니다 — invalid target date or tee time.");
        setMessage("A valid target date and tee time are required to move a reservation.");
        return Promise.resolve(null);
      }
      return patchBookingWith(
        bookingId,
        { date, time },
        `Reservation moved to ${time} on ${longDate(date)}.`,
        "예약 이동 실패 — could not move the reservation",
      );
    },
    [patchBookingWith, pushToast],
  );

  const setStatus = useCallback(
    (bookingId: string, status: BookingStatus, cancelReason?: string): Promise<TeeBooking | null> => {
      const patch: PatchBookingInput = { status };
      if (cancelReason !== undefined) patch.cancelReason = cancelReason;
      else if (status === "cancelled") patch.cancelReason = null;

      const destructive = status === "cancelled" || status === "no_show";
      return runBookingMutation({
        bookingId,
        apply: (booking) => applyStatusLocally(booking, status, cancelReason),
        call: () => teeSheetApi.patchBooking(bookingId, patch),
        statusText: `Status set to ${status.replace("_", " ")}.`,
        successToast: destructive ? `Reservation marked ${status.replace("_", " ")}.` : undefined,
        failText: "상태 변경 실패 — could not change the status",
      });
    },
    [runBookingMutation],
  );

  const deleteBooking = useCallback(
    async (bookingId: string): Promise<boolean> => {
      const before = bookingsRef.current.find((booking) => booking.id === bookingId);
      if (!before) {
        pushToast("error", "삭제할 예약을 찾을 수 없습니다 — that reservation no longer exists.");
        setMessage("Reservation not found — it may already have been deleted.");
        return false;
      }

      const seq = nextSeq(bookingId);

      if (connectionRef.current === "offline") {
        dropBooking(bookingId);
        pushToast("info", `Deleted "${before.title}" locally — offline, not saved to the server.`);
        setMessage(`오프라인 로컬 삭제 — removed "${before.title}" on this device only.`);
        return true;
      }

      beginBusy();
      try {
        await teeSheetApi.deleteBooking(bookingId);
        if (!mountedRef.current) return true;
        // 204 는 종결 상태다 — 보호할 더 새로운 상태가 없으므로 무조건 제거한다.
        dropBooking(bookingId);
        pushToast("success", `Reservation "${before.title}" deleted.`);
        setMessage(`예약 삭제 완료 — deleted "${before.title}".`);
        return true;
      } catch (error) {
        if (!mountedRef.current) return false;
        const detail = errorDetail(error);
        if (isNetworkError(error)) {
          enterOffline(detail, false);
          if (isCurrentSeq(bookingId, seq)) dropBooking(bookingId);
          setMessage(`서버 연결 없음 — removed "${before.title}" locally only.`);
          return true;
        }
        pushToast("error", detail);
        setMessage(`예약 삭제 실패 — could not delete the reservation: ${detail}`);
        return false;
      } finally {
        endBusy();
      }
    },
    [beginBusy, dropBooking, endBusy, enterOffline, isCurrentSeq, nextSeq, pushToast],
  );

  // --- player actions ---
  const addPlayer = useCallback(
    (bookingId: string, input?: AddPlayerInput): Promise<TeeBooking | null> => {
      const booking = bookingsRef.current.find((item) => item.id === bookingId);
      if (!booking) {
        pushToast("error", "예약을 찾을 수 없습니다 — that reservation no longer exists.");
        setMessage("Reservation not found — it may have been removed.");
        return Promise.resolve(null);
      }
      if (booking.players.length >= MAX_PLAYERS_PER_TEE_TIME) {
        pushToast("error", `한 티 타임에는 최대 ${MAX_PLAYERS_PER_TEE_TIME}명까지 — this tee time is already full.`);
        setMessage(`A tee time can hold at most ${MAX_PLAYERS_PER_TEE_TIME} players.`);
        return Promise.resolve(null);
      }

      const payload: AddPlayerInput = {
        name: "Guest",
        firstName: "Guest",
        lastName: "",
        type: "Guest",
        ...stripUndefined<AddPlayerInput>(input ?? {}),
      };
      // 로컬 낙관적 플레이어도 실제 id 를 갖는다 (상세 패널의 수정 액션이 살아 있도록).
      const localPlayer = makePlayer(payload as Partial<Player>);

      return runBookingMutation({
        bookingId,
        apply: (current) => ({ ...current, players: [...current.players, localPlayer] }),
        call: () => teeSheetApi.addPlayer(bookingId, payload),
        statusText: `${localPlayer.name} added to the reservation.`,
        successToast: `${localPlayer.name} added.`,
        failText: "플레이어 추가 실패 — could not add the player",
      });
    },
    [pushToast, runBookingMutation],
  );

  const patchPlayer = useCallback(
    (bookingId: string, playerId: string, patch: PatchPlayerInput): Promise<TeeBooking | null> => {
      const booking = bookingsRef.current.find((item) => item.id === bookingId);
      const player = booking?.players.find((item) => item.id === playerId);
      if (!booking || !player) {
        pushToast("error", "플레이어를 찾을 수 없습니다 — that player no longer exists.");
        setMessage("Player not found — the reservation may have changed.");
        return Promise.resolve(null);
      }

      return runBookingMutation({
        bookingId,
        apply: (current) => ({
          ...current,
          players: current.players.map((item) => (item.id === playerId ? mergePlayer(item, patch) : item)),
        }),
        call: () => teeSheetApi.patchPlayer(bookingId, playerId, patch),
        statusText: `${player.name || "Player"} updated.`,
        failText: "플레이어 수정 실패 — could not update the player",
      });
    },
    [pushToast, runBookingMutation],
  );

  const removePlayer = useCallback(
    (bookingId: string, playerId: string): Promise<TeeBooking | null> => {
      const booking = bookingsRef.current.find((item) => item.id === bookingId);
      const player = booking?.players.find((item) => item.id === playerId);
      if (!booking || !player) {
        pushToast("error", "플레이어를 찾을 수 없습니다 — that player no longer exists.");
        setMessage("Player not found — the reservation may have changed.");
        return Promise.resolve(null);
      }
      if (booking.players.length <= MIN_PLAYERS_PER_BOOKING) {
        pushToast("error", "예약에는 최소 1명이 남아 있어야 합니다 — a reservation must keep at least one player.");
        setMessage("A reservation must keep at least one player.");
        return Promise.resolve(null);
      }

      return runBookingMutation({
        bookingId,
        apply: (current) => ({ ...current, players: current.players.filter((item) => item.id !== playerId) }),
        call: () => teeSheetApi.removePlayer(bookingId, playerId),
        statusText: `${player.name || "Player"} removed from the reservation.`,
        successToast: `${player.name || "Player"} removed.`,
        failText: "플레이어 삭제 실패 — could not remove the player",
      });
    },
    [pushToast, runBookingMutation],
  );

  // --- misc actions ---
  const refresh = useCallback(async (): Promise<void> => {
    beginBusy();
    try {
      const anchor = weekStartRef.current;
      const [bookingsData, slotsData] = await Promise.all([
        teeSheetApi.listBookings({ from: anchor, to: addDays(anchor, 6) }),
        teeSheetApi.getSlots(focusedDateRef.current),
      ]);
      if (!mountedRef.current) return;
      lastGoodRef.current = bookingsData;
      commitBookings(() => bookingsData);
      reconcileSelection(bookingsData);
      commitSlots(slotsData.slots);
      if (connectionRef.current !== "online") {
        commitConnection("online");
        pushToast("success", "Reconnected to the tee sheet service.");
      }
      setMessage(`Refreshed — ${bookingsData.length} reservation(s) for the week of ${longDate(anchor)}.`);
    } catch (error) {
      if (!mountedRef.current) return;
      const detail = errorDetail(error);
      if (isNetworkError(error)) {
        if (connectionRef.current === "offline") {
          // 이미 오프라인이면 enterOffline 이 조용히 빠져나가므로 여기서 직접 알린다.
          pushToast("error", `Still offline — ${detail}`);
          setMessage("여전히 서버에 연결할 수 없습니다 — still offline; showing the local copy.");
        } else {
          enterOffline(detail, true);
        }
        return;
      }
      pushToast("error", detail);
      setMessage(`새로고침 실패 — could not refresh: ${detail}`);
    } finally {
      endBusy();
    }
  }, [beginBusy, commitBookings, commitConnection, commitSlots, endBusy, enterOffline, pushToast, reconcileSelection]);

  const setView = useCallback((next: ViewMode) => setViewState(next), []);
  const setFocusedDate = useCallback((isoDate: string) => {
    if (!isoDate) return;
    setFocusedDateState(isoDate);
  }, []);
  const goToPreviousWeek = useCallback(() => setFocusedDateState((current) => addDays(current, -7)), []);
  const goToNextWeek = useCallback(() => setFocusedDateState((current) => addDays(current, 7)), []);
  const goToToday = useCallback(() => setFocusedDateState(todayIso()), []);
  const select = useCallback((bookingId: string | null) => setSelectedId(bookingId), []);

  // --- derived view models ---
  const visibleBookings = useMemo(() => {
    if (view === "day") return bookings.filter((booking) => booking.date === focusedDate);
    const inWeek = new Set(weekDateList);
    return bookings.filter((booking) => inWeek.has(booking.date));
  }, [bookings, focusedDate, view, weekDateList]);

  const selected = useMemo(
    () => bookings.find((booking) => booking.id === selectedId) ?? null,
    [bookings, selectedId],
  );

  // 통계는 보이는 범위(주/일)에 한정된다 — 예전 페이지처럼 전체 예약을 합산하지 않는다.
  const stats = useMemo(() => {
    let players = 0;
    let arrived = 0;
    let paid = 0;
    let carts = 0;
    let revenue = 0;
    let outstanding = 0;

    for (const booking of visibleBookings) {
      players += booking.players.length;
      arrived += booking.players.filter((player) => player.arrived).length;
      paid += booking.players.filter((player) => player.paid).length;
      carts += booking.cartCount;

      if (booking.status === "cancelled") continue; // 취소 예약은 매출에서 제외
      const billable = booking.players.filter((player) => !player.cancelled);
      revenue += booking.rate * billable.length;
      outstanding += booking.rate * billable.filter((player) => !player.paid).length;
    }

    return {
      reservations: visibleBookings.length,
      players,
      arrived,
      paid,
      carts,
      revenue: round2(revenue),
      outstanding: round2(outstanding),
    };
  }, [visibleBookings]);

  const busy = busyCount > 0;

  return useMemo<TeeSheetController>(
    () => ({
      // data
      bookings,
      visibleBookings,
      slots,
      selected,
      selectedId,

      // view state
      view,
      weekStart,
      focusedDate,
      weekDates: weekDateList,

      // connection + messaging
      connection,
      message,
      toasts,
      busy,
      dismissToast,

      // stats
      stats,

      // view actions
      setView,
      setFocusedDate,
      goToPreviousWeek,
      goToNextWeek,
      goToToday,
      select,

      // booking actions
      createBooking,
      patchBooking,
      deleteBooking,
      moveBooking,
      setStatus,

      // player actions
      addPlayer,
      patchPlayer,
      removePlayer,

      // misc
      refresh,
    }),
    [
      addPlayer,
      bookings,
      busy,
      connection,
      createBooking,
      deleteBooking,
      dismissToast,
      focusedDate,
      goToNextWeek,
      goToPreviousWeek,
      goToToday,
      message,
      moveBooking,
      patchBooking,
      patchPlayer,
      refresh,
      removePlayer,
      select,
      selected,
      selectedId,
      setFocusedDate,
      setStatus,
      setView,
      slots,
      stats,
      toasts,
      view,
      visibleBookings,
      weekDateList,
      weekStart,
    ],
  );
}

export default useTeeSheet;
