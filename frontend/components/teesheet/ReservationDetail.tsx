"use client";

// 예약 상세 패널 (Reservation Detail).
// 하단 Lightspeed 스타일 패널 — 플레이어 카드 편집, 상태 액션, 취소/삭제, 히스토리.
// 모든 서버 호출은 controller 를 통해서만 한다. 이 파일에서 fetch 를 직접 부르지 않는다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { longDate, money } from "@/lib/teeSheet/dates";
import type {
  AuditEntry,
  BookingStatus,
  PatchBookingInput,
  PatchPlayerInput,
  Player,
  TeeBooking,
  TeeSheetController,
} from "@/lib/teeSheet/types";

export type ReservationDetailProps = { controller: TeeSheetController };

// ===== constants =====

const MAX_PLAYERS = 4;
const MAX_CARTS = 4;
const PLAYER_DEBOUNCE_MS = 700;
const SAVED_FLASH_MS = 1800;

const STATUS_LABEL: Record<BookingStatus, string> = {
  reserved: "Reserved",
  checked_in: "Checked In",
  paid: "Paid",
  cancelled: "Cancelled",
  no_show: "No Show",
  blocked: "Blocked",
};

const STATUS_PILL: Record<BookingStatus, string> = {
  reserved: "border-[#c7c7cc] bg-[#ececf0] text-[#4e5560]",
  checked_in: "border-[#168a3c] bg-[#e7f7ec] text-[#168a3c]",
  paid: "border-[#4533ff] bg-[#ebe8ff] text-[#4533ff]",
  cancelled: "border-[#8a3f26] bg-[#fbeae5] text-[#8a3f26]",
  no_show: "border-[#8a3f26] bg-[#fbeae5] text-[#8a3f26]",
  blocked: "border-[#8b93a1] bg-[#e2e5ea] text-[#3f4650]",
};

const CANCEL_PRESETS = [
  "Weather / course closed",
  "Guest requested cancellation",
  "Course maintenance",
  "No contact — released slot",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ===== local helpers =====

type PlayerDraft = { firstName: string; lastName: string; phone: string; email: string };
type BookingDraft = { title: string; holes: 9 | 18; rate: string; cartCount: number; notes: string };
type SaveState = { kind: "idle" | "saving" | "saved"; nonce: number };
type PanelMode = "none" | "cancel" | "delete";

function playerDraftOf(player: Player): PlayerDraft {
  return {
    firstName: player.firstName ?? "",
    lastName: player.lastName ?? "",
    phone: player.phone ?? "",
    email: player.email ?? "",
  };
}

function bookingDraftOf(booking: TeeBooking): BookingDraft {
  return {
    title: booking.title,
    holes: booking.holes,
    rate: String(booking.rate),
    cartCount: booking.cartCount,
    notes: booking.notes ?? "",
  };
}

function clampCarts(value: number, playerCount: number): number {
  const cap = Math.min(MAX_CARTS, Math.max(0, playerCount));
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(cap, Math.round(value)));
}

function playerPatchFrom(player: Player, draft: PlayerDraft): PatchPlayerInput {
  const patch: PatchPlayerInput = {};
  if (draft.firstName !== (player.firstName ?? "")) patch.firstName = draft.firstName;
  if (draft.lastName !== (player.lastName ?? "")) patch.lastName = draft.lastName;
  if (draft.phone !== (player.phone ?? "")) patch.phone = draft.phone;
  if (draft.email !== (player.email ?? "")) patch.email = draft.email;
  return patch;
}

function bookingPatchFrom(booking: TeeBooking, draft: BookingDraft): PatchBookingInput {
  const patch: PatchBookingInput = {};
  const title = draft.title.trim();
  if (title && title !== booking.title) patch.title = title;
  if (draft.holes !== booking.holes) patch.holes = draft.holes;
  const rate = Number(draft.rate);
  if (draft.rate.trim() !== "" && Number.isFinite(rate) && rate >= 0 && rate !== booking.rate) {
    patch.rate = rate;
  }
  // 값이 실제로 바뀐 경우에만 보낸다. 여기서 clamp 결과와 서버값을 비교하면
  // (예: 서버 cartCount 2 + 플레이어 1명) 손대지 않은 예약이 dirty 로 뜬다.
  if (draft.cartCount !== booking.cartCount) {
    patch.cartCount = clampCarts(draft.cartCount, booking.players.length);
  }
  if (draft.notes !== (booking.notes ?? "")) patch.notes = draft.notes;
  return patch;
}

/** "3 minutes ago" — audit 타임스탬프는 ISO datetime 이므로 dates.ts 의 toDate 를 쓸 수 없다. */
function relativeTime(ts: string): string {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return ts;
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 90) return "1 minute ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

// ===== component =====

export default function ReservationDetail({ controller }: ReservationDetailProps) {
  const booking = controller.selected;
  const bookingId = booking?.id ?? null;

  const [bookingDraft, setBookingDraft] = useState<BookingDraft | null>(null);
  const [playerDrafts, setPlayerDrafts] = useState<Record<string, PlayerDraft>>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle", nonce: 0 });
  const [mode, setMode] = useState<PanelMode>("none");
  const [cancelReason, setCancelReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  // 최신 값을 debounce 타이머 콜백에서 읽기 위한 미러 ref 들.
  const bookingRef = useRef<TeeBooking | null>(booking);
  const draftsRef = useRef<Record<string, PlayerDraft>>(playerDrafts);
  const bookingDraftRef = useRef<BookingDraft | null>(bookingDraft);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inflightRef = useRef(0);

  useEffect(() => {
    bookingRef.current = booking;
  }, [booking]);
  useEffect(() => {
    draftsRef.current = playerDrafts;
  }, [playerDrafts]);
  useEffect(() => {
    bookingDraftRef.current = bookingDraft;
  }, [bookingDraft]);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  // 선택이 바뀌면 draft 를 버린다 (id 기준 — booking 객체 identity 기준이 아니다.
  // 객체 기준으로 리셋하면 매 PATCH 응답마다 입력 중인 값이 날아간다).
  useEffect(() => {
    clearTimers();
    setBookingDraft(null);
    setPlayerDrafts({});
    setMode("none");
    setCancelReason("");
    setHistoryOpen(false);
    setSaveState({ kind: "idle", nonce: 0 });
  }, [bookingId, clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (saveState.kind !== "saved") return;
    const timer = setTimeout(() => setSaveState({ kind: "idle", nonce: 0 }), SAVED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [saveState]);

  const beginSave = useCallback(() => {
    inflightRef.current += 1;
    setSaveState((prev) => ({ kind: "saving", nonce: prev.nonce + 1 }));
  }, []);

  const endSave = useCallback((changed: boolean) => {
    inflightRef.current = Math.max(0, inflightRef.current - 1);
    if (inflightRef.current > 0) return;
    setSaveState((prev) => ({ kind: changed ? "saved" : "idle", nonce: prev.nonce + 1 }));
  }, []);

  /** draft 를 커밋한다. 응답 후에도 draft 가 그대로면(=그 사이 타이핑 없음) 지운다. */
  const commitPlayer = useCallback(
    async (playerId: string): Promise<boolean> => {
      const current = bookingRef.current;
      if (!current) return false;
      const draft = draftsRef.current[playerId];
      const player = current.players.find((p) => p.id === playerId);
      if (!draft || !player) return false;

      const patch = playerPatchFrom(player, draft);
      const dropIfUnchanged = () =>
        setPlayerDrafts((prev) => {
          const held = prev[playerId];
          if (!held) return prev;
          const same =
            held.firstName === draft.firstName &&
            held.lastName === draft.lastName &&
            held.phone === draft.phone &&
            held.email === draft.email;
          if (!same) return prev;
          const next = { ...prev };
          delete next[playerId];
          return next;
        });

      if (Object.keys(patch).length === 0) {
        dropIfUnchanged();
        return false;
      }
      await controller.patchPlayer(current.id, playerId, patch);
      dropIfUnchanged();
      return true;
    },
    [controller],
  );

  const flushPlayer = useCallback(
    async (playerId: string) => {
      const timer = timersRef.current.get(playerId);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(playerId);
      }
      // 실제로 바뀐 게 없으면 "saving…" 을 깜빡이지 않는다 (blur 마다 발생하므로).
      const current = bookingRef.current;
      const draft = current ? draftsRef.current[playerId] : undefined;
      const player = current?.players.find((p) => p.id === playerId);
      if (!current || !draft || !player || Object.keys(playerPatchFrom(player, draft)).length === 0) {
        await commitPlayer(playerId); // draft 정리만 하고 끝
        return;
      }
      beginSave();
      let changed = false;
      try {
        changed = await commitPlayer(playerId);
      } finally {
        endSave(changed);
      }
    },
    [beginSave, commitPlayer, endSave],
  );

  const schedulePlayerCommit = useCallback(
    (playerId: string) => {
      const existing = timersRef.current.get(playerId);
      if (existing) clearTimeout(existing);
      timersRef.current.set(
        playerId,
        setTimeout(() => {
          timersRef.current.delete(playerId);
          void flushPlayer(playerId);
        }, PLAYER_DEBOUNCE_MS),
      );
    },
    [flushPlayer],
  );

  const setPlayerField = useCallback(
    (player: Player, field: keyof PlayerDraft, value: string) => {
      setPlayerDrafts((prev) => {
        const base = prev[player.id] ?? playerDraftOf(player);
        return { ...prev, [player.id]: { ...base, [field]: value } };
      });
      schedulePlayerCommit(player.id);
    },
    [schedulePlayerCommit],
  );

  // ===== derived =====

  const effectiveBookingDraft = useMemo(
    () => (booking ? (bookingDraft ?? bookingDraftOf(booking)) : null),
    [booking, bookingDraft],
  );

  const pendingBookingPatch = useMemo(
    () => (booking && effectiveBookingDraft ? bookingPatchFrom(booking, effectiveBookingDraft) : {}),
    [booking, effectiveBookingDraft],
  );

  const dirtyPlayerIds = useMemo(() => {
    if (!booking) return [] as string[];
    return booking.players
      .filter((player) => {
        const draft = playerDrafts[player.id];
        return draft ? Object.keys(playerPatchFrom(player, draft)).length > 0 : false;
      })
      .map((player) => player.id);
  }, [booking, playerDrafts]);

  const bookingDirty = Object.keys(pendingBookingPatch).length > 0;
  const dirty = bookingDirty || dirtyPlayerIds.length > 0;

  const saveAll = useCallback(async () => {
    const current = bookingRef.current;
    if (!current) return;
    clearTimers();
    beginSave();
    let changed = false;
    try {
      // 플레이어부터 순차로. 각 응답이 booking 전체를 교체하므로 병렬 금지.
      for (const player of current.players) {
        const didChange = await commitPlayer(player.id);
        changed = changed || didChange;
      }
      const latest = bookingRef.current ?? current;
      const draft = bookingDraftRef.current;
      if (draft) {
        const patch = bookingPatchFrom(latest, draft);
        if (Object.keys(patch).length > 0) {
          await controller.patchBooking(latest.id, patch);
          changed = true;
        }
        setBookingDraft((prev) => (prev === draft ? null : prev));
      }
    } finally {
      endSave(changed);
    }
  }, [beginSave, clearTimers, commitPlayer, controller, endSave]);

  // ===== empty state =====

  if (!booking || !effectiveBookingDraft) {
    return (
      <section className="min-w-0 border-t border-[#d4d4d8] bg-[#dedee2] px-4 py-10">
        <div className="mx-auto max-w-sm text-center text-xs text-[#5c6270]">
          <p className="text-sm font-bold text-[#1f2328]">Select a tee time</p>
          <p className="mt-1">
            Pick a reservation on the grid above to see its players, payments and history here.
          </p>
        </div>
      </section>
    );
  }

  const draft = effectiveBookingDraft;
  const players = booking.players;
  const cartCap = Math.min(MAX_CARTS, players.length);
  const carts = clampCarts(draft.cartCount, players.length);
  const busy = controller.busy;

  const dueFor = (player: Player) => (player.paid || player.cancelled ? 0 : booking.rate);
  const collected = players.reduce((sum, p) => sum + (p.paid ? booking.rate : 0), 0);
  const outstanding = players.reduce((sum, p) => sum + dueFor(p), 0);
  const total = collected + outstanding;

  const audit: AuditEntry[] = [...(booking.audit ?? [])].reverse();

  const statusActions: Array<{ label: string; target: BookingStatus }> = [
    { label: "Check In All", target: "checked_in" },
    { label: "Collect All", target: "paid" },
    { label: "Mark No Show", target: "no_show" },
    { label: "Reopen", target: "reserved" },
  ];

  const saveLabel =
    saveState.kind === "saving" ? "saving…" : saveState.kind === "saved" ? "saved" : dirty ? "unsaved changes" : "";

  return (
    <section className="min-w-0 border-t border-[#d4d4d8] bg-[#dedee2] px-4 py-3 text-xs text-[#1f2328]">
      {/* ===== header ===== */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">● {booking.id.toUpperCase().slice(0, 10)}</span>
          <span className={`rounded border px-2 py-1 font-bold ${STATUS_PILL[booking.status]}`}>
            {STATUS_LABEL[booking.status]}
          </span>
          <span className="rounded border border-[#c7c7cc] bg-white px-2 py-1">{longDate(booking.date)}</span>
          <span className="rounded border border-[#c7c7cc] bg-white px-2 py-1">{booking.time}</span>
          <span className="rounded border border-[#c7c7cc] bg-white px-2 py-1">
            {players.length} {players.length === 1 ? "player" : "players"}
          </span>
          {booking.cancelReason ? (
            <span className="rounded border border-[#c47a63] bg-[#fbeae5] px-2 py-1 text-[#8a3f26]">
              Reason: {booking.cancelReason}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`min-w-[92px] text-right ${
              saveState.kind === "saved"
                ? "text-[#168a3c]"
                : saveState.kind === "saving"
                  ? "text-[#4e5560]"
                  : dirty
                    ? "font-bold text-[#8a3f26]"
                    : "text-transparent"
            }`}
            aria-live="polite"
          >
            {saveLabel}
          </span>
          <button
            className="border border-[#c47a63] bg-white px-3 py-2 font-bold text-[#8a3f26] disabled:opacity-40"
            disabled={busy || booking.status === "cancelled"}
            onClick={() => setMode(mode === "cancel" ? "none" : "cancel")}
            type="button"
          >
            Cancel Reservation
          </button>
          <button
            className="border border-[#8a3f26] bg-[#8a3f26] px-3 py-2 font-bold text-white disabled:opacity-40"
            disabled={busy}
            onClick={() => setMode(mode === "delete" ? "none" : "delete")}
            type="button"
          >
            Delete
          </button>
          <button
            className="bg-[#4533ff] px-5 py-2 font-bold text-white disabled:cursor-not-allowed disabled:bg-[#b1a8ff]"
            disabled={busy || !dirty}
            onClick={() => void saveAll()}
            type="button"
          >
            Save
          </button>
        </div>
      </div>

      {/* ===== inline cancel form (window.prompt 대체) ===== */}
      {mode === "cancel" ? (
        <div className="mb-2 border border-[#c47a63] bg-white p-3">
          <p className="font-bold text-[#8a3f26]">Cancel “{booking.title}” — why?</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {CANCEL_PRESETS.map((preset) => (
              <button
                className="border border-[#d7d7dc] bg-[#f2f2f4] px-2 py-1 hover:border-[#8a3f26]"
                key={preset}
                onClick={() => setCancelReason(preset)}
                type="button"
              >
                {preset}
              </button>
            ))}
          </div>
          <textarea
            className="mt-2 h-16 w-full resize-none border border-[#d7d7dc] p-2 outline-none focus:border-[#8a3f26]"
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Reason shown on the reservation and written to the history log"
            value={cancelReason}
          />
          <div className="mt-2 flex gap-2">
            <button
              className="border border-[#8a3f26] bg-[#8a3f26] px-4 py-2 font-bold text-white disabled:opacity-40"
              disabled={busy || cancelReason.trim().length === 0}
              onClick={async () => {
                await controller.setStatus(booking.id, "cancelled", cancelReason.trim());
                setMode("none");
                setCancelReason("");
              }}
              type="button"
            >
              Confirm Cancellation
            </button>
            <button
              className="border border-[#c7c7cc] bg-white px-4 py-2 font-bold"
              onClick={() => setMode("none")}
              type="button"
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {/* ===== inline delete confirm ===== */}
      {mode === "delete" ? (
        <div className="mb-2 border border-[#8a3f26] bg-[#fbeae5] p-3">
          <p className="font-bold text-[#8a3f26]">
            Delete “{booking.title}” at {booking.time} on {longDate(booking.date)}?
          </p>
          <p className="mt-1 text-[#6d3a27]">
            This permanently removes the reservation and its {players.length}{" "}
            {players.length === 1 ? "player" : "players"}. Cancelling instead keeps the record with a reason.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className="border border-[#8a3f26] bg-[#8a3f26] px-4 py-2 font-bold text-white disabled:opacity-40"
              disabled={busy}
              onClick={async () => {
                await controller.deleteBooking(booking.id);
                setMode("none");
              }}
              type="button"
            >
              Delete permanently
            </button>
            <button
              className="border border-[#c7c7cc] bg-white px-4 py-2 font-bold"
              onClick={() => setMode("none")}
              type="button"
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {/* ===== editable booking fields + status actions ===== */}
      <div className="mb-2 grid gap-2 border border-[#c7c7cc] bg-white p-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_auto_auto_auto]">
          <label className="block">
            <span className="text-[#5c6270]">Title</span>
            <input
              className="mt-1 w-full border-b border-[#d7d7dc] px-1 py-1 outline-none focus:border-[#4533ff]"
              onChange={(event) => setBookingDraft({ ...draft, title: event.target.value })}
              placeholder="Reservation name"
              value={draft.title}
            />
            {draft.title.trim() === "" ? (
              <span className="mt-1 block text-[#8a3f26]">Title is required — it will not be saved empty</span>
            ) : null}
          </label>

          <label className="block">
            <span className="text-[#5c6270]">Holes</span>
            <select
              className="mt-1 w-full border-b border-[#d7d7dc] bg-white px-1 py-1 outline-none focus:border-[#4533ff]"
              onChange={(event) =>
                setBookingDraft({ ...draft, holes: Number(event.target.value) === 9 ? 9 : 18 })
              }
              value={String(draft.holes)}
            >
              <option value="9">9 holes</option>
              <option value="18">18 holes</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[#5c6270]">Rate</span>
            <input
              className="mt-1 w-full border-b border-[#d7d7dc] px-1 py-1 outline-none focus:border-[#4533ff]"
              inputMode="decimal"
              onChange={(event) => setBookingDraft({ ...draft, rate: event.target.value })}
              value={draft.rate}
            />
            {draft.rate.trim() !== "" && !Number.isFinite(Number(draft.rate)) ? (
              <span className="mt-1 block text-[#8a3f26]">Not a number — rate will not be saved</span>
            ) : null}
          </label>

          <div>
            <span className="text-[#5c6270]">Carts</span>
            <div className="mt-1 flex items-center gap-1">
              <button
                className="h-7 w-7 border border-[#d7d7dc] bg-white font-bold disabled:opacity-30"
                disabled={busy || carts <= 0}
                onClick={() => setBookingDraft({ ...draft, cartCount: carts - 1 })}
                type="button"
                aria-label="Fewer carts"
              >
                −
              </button>
              <span className="w-8 text-center font-bold tabular-nums">{carts}</span>
              <button
                className="h-7 w-7 border border-[#d7d7dc] bg-white font-bold disabled:opacity-30"
                disabled={busy || carts >= cartCap}
                onClick={() => setBookingDraft({ ...draft, cartCount: carts + 1 })}
                type="button"
                aria-label="More carts"
              >
                +
              </button>
              <span className="text-[#9aa0a6]">/ {cartCap}</span>
            </div>
          </div>

          <label className="block sm:col-span-4">
            <span className="text-[#5c6270]">Notes</span>
            <textarea
              className="mt-1 h-12 w-full resize-none border border-[#ececf0] p-2 outline-none focus:border-[#4533ff]"
              onChange={(event) => setBookingDraft({ ...draft, notes: event.target.value })}
              placeholder="Starter notes, special requests…"
              value={draft.notes}
            />
          </label>
        </div>

        <div className="flex flex-wrap content-start gap-1 lg:w-[190px]">
          {statusActions.map((action) => (
            <button
              className="border border-[#c7c7cc] bg-[#f2f2f4] px-2 py-1.5 font-bold hover:border-[#4533ff] disabled:cursor-not-allowed disabled:opacity-35"
              disabled={busy || booking.status === action.target}
              key={action.target}
              onClick={() => void controller.setStatus(booking.id, action.target)}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== player cards ===== */}
      <div className="relative flex items-stretch gap-3 overflow-x-auto pb-1">
        {players.map((player) => {
          const pd = playerDrafts[player.id] ?? playerDraftOf(player);
          const emailInvalid = pd.email.trim() !== "" && !EMAIL_RE.test(pd.email.trim());
          const due = dueFor(player);
          const canRemove = Boolean(player.id) && !busy;

          return (
            <article
              className="flex w-[186px] shrink-0 flex-col border border-[#c7c7cc] bg-white p-2"
              key={player.id}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="truncate font-bold">{player.type}</span>
                <button
                  className="px-1 text-[#8a3f26] disabled:opacity-30"
                  disabled={!canRemove}
                  onClick={() => void controller.removePlayer(booking.id, player.id)}
                  title={canRemove ? "Remove player" : "This player has no id yet"}
                  type="button"
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1">
                <label className="block">
                  <span className="text-[#5c6270]">Last Name</span>
                  <input
                    className="mt-1 w-full border-b border-[#d7d7dc] px-1 py-1 outline-none focus:border-[#4533ff]"
                    onBlur={() => void flushPlayer(player.id)}
                    onChange={(event) => setPlayerField(player, "lastName", event.target.value)}
                    value={pd.lastName}
                  />
                </label>
                <label className="block">
                  <span className="text-[#5c6270]">First Name</span>
                  <input
                    className="mt-1 w-full border-b border-[#d7d7dc] px-1 py-1 outline-none focus:border-[#4533ff]"
                    onBlur={() => void flushPlayer(player.id)}
                    onChange={(event) => setPlayerField(player, "firstName", event.target.value)}
                    value={pd.firstName}
                  />
                </label>
              </div>

              <label className="mt-2 block">
                <span className="sr-only">Phone</span>
                <input
                  className="w-full border-b border-[#d7d7dc] px-1 py-1 outline-none focus:border-[#4533ff]"
                  inputMode="tel"
                  onBlur={() => void flushPlayer(player.id)}
                  onChange={(event) => setPlayerField(player, "phone", event.target.value)}
                  placeholder="Phone"
                  value={pd.phone}
                />
              </label>

              <label className="mt-1 block">
                <span className="sr-only">Email</span>
                <input
                  className={`w-full border-b px-1 py-1 outline-none focus:border-[#4533ff] ${
                    emailInvalid ? "border-[#8a3f26]" : "border-[#d7d7dc]"
                  }`}
                  inputMode="email"
                  onBlur={() => void flushPlayer(player.id)}
                  onChange={(event) => setPlayerField(player, "email", event.target.value)}
                  placeholder="Email"
                  value={pd.email}
                />
              </label>
              {emailInvalid ? (
                <span className="mt-1 block text-[10px] text-[#8a3f26]">Check this email address</span>
              ) : null}

              <button
                className={`mt-2 w-full border px-2 py-1 font-bold disabled:opacity-40 ${
                  player.arrived ? "border-[#168a3c] bg-[#ecfff1] text-[#168a3c]" : "border-[#d7d7dc]"
                }`}
                disabled={busy}
                onClick={() => void controller.patchPlayer(booking.id, player.id, { arrived: !player.arrived })}
                type="button"
              >
                {player.arrived ? "Arrived" : "Check In"}
              </button>

              <button
                className={`mt-1 w-full border px-2 py-1 font-bold disabled:opacity-40 ${
                  player.no_show ? "border-[#8a3f26] bg-[#fff1ee] text-[#8a3f26]" : "border-[#d7d7dc]"
                }`}
                disabled={busy}
                onClick={() => void controller.patchPlayer(booking.id, player.id, { no_show: !player.no_show })}
                type="button"
              >
                {player.no_show ? "No Show" : "Mark No Show"}
              </button>

              <div className="mt-2 bg-[#ffe5e2] p-1 text-[#9e2f20]">{player.ratePlan || "Public"}</div>

              <div className="mt-2 flex justify-between">
                <span>{booking.holes} Hole Gr.</span>
                <span>{money(booking.rate)}</span>
              </div>
              {player.cancelled ? (
                <div className="mt-1 flex justify-between text-[#8a3f26]">
                  <span>Cancelled</span>
                  <span>−{money(booking.rate)}</span>
                </div>
              ) : null}

              <div className="mt-2 flex justify-between border-t border-[#ececf0] pt-2 font-bold">
                <span>Subtotal Due</span>
                <span>{money(due)}</span>
              </div>

              <button
                className={`mt-2 w-full px-2 py-1 font-bold text-white disabled:opacity-40 ${
                  player.paid ? "bg-[#4533ff]" : "bg-[#b1a8ff]"
                }`}
                disabled={busy}
                onClick={() => void controller.patchPlayer(booking.id, player.id, { paid: !player.paid })}
                type="button"
              >
                {player.paid ? "Paid" : "Collect"}
              </button>
            </article>
          );
        })}

        <button
          className="grid min-h-[240px] w-[186px] shrink-0 place-items-center rounded border border-dashed border-[#aeb2bb] bg-[#d5d5da] text-4xl text-[#9297a1] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy || players.length >= MAX_PLAYERS}
          onClick={() => void controller.addPlayer(booking.id)}
          title={players.length >= MAX_PLAYERS ? "A tee time holds at most 4 players" : "Add player"}
          type="button"
        >
          +
        </button>
      </div>

      {/* ===== money footer ===== */}
      <div className="mt-2 flex flex-wrap items-center gap-4 border border-[#c7c7cc] bg-white px-3 py-2 font-bold">
        <span>
          Reservation total <span className="ml-1 font-normal tabular-nums">{money(total)}</span>
        </span>
        <span className="text-[#168a3c]">
          Collected <span className="ml-1 font-normal tabular-nums">{money(collected)}</span>
        </span>
        <span className={outstanding > 0 ? "text-[#8a3f26]" : "text-[#4e5560]"}>
          Outstanding <span className="ml-1 font-normal tabular-nums">{money(outstanding)}</span>
        </span>
        <span className="text-[#4e5560]">
          Carts <span className="ml-1 font-normal tabular-nums">{booking.cartCount}</span>
        </span>
      </div>

      {/* ===== history ===== */}
      <div className="mt-2 border border-[#c7c7cc] bg-white">
        <button
          aria-expanded={historyOpen}
          className="flex w-full items-center justify-between px-3 py-2 font-bold"
          onClick={() => setHistoryOpen((open) => !open)}
          type="button"
        >
          <span>History ({audit.length})</span>
          <span className="text-[#5c6270]">{historyOpen ? "▲" : "▼"}</span>
        </button>
        {historyOpen ? (
          <ul className="max-h-40 overflow-y-auto border-t border-[#ececf0]">
            {audit.length === 0 ? (
              <li className="px-3 py-2 text-[#9aa0a6]">No activity recorded yet.</li>
            ) : (
              audit.map((entry) => (
                <li className="flex gap-3 border-b border-[#f3f3f5] px-3 py-1.5 last:border-b-0" key={entry.id}>
                  <span className="w-28 shrink-0 text-[#9aa0a6]">{relativeTime(entry.ts)}</span>
                  <span className="min-w-0">{entry.message}</span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
