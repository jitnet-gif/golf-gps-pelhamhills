"use client";

// 예약 상세 패널 (Reservation Detail).
//
// 레이아웃은 Lightspeed Golf 의 하단 패널을 그대로 따른다:
//   ┌ 헤더 줄: ☎ 확인코드 · 홀 수 · 날짜 · 시각 ······ [Cancel] [Save]
//   ├ 왼쪽 아이콘 레일 │ 플레이어 카드 가로 나열
//   └ 노란 메모 줄
//
// 예전에는 **예약 단위**로 편집하는 화면이었다 (Title / Notes / Holes / Rate / Carts
// 한 묶음 + Check In All · Collect All · Mark No Show · Reopen 네 버튼). 레퍼런스는
// 그 반대로 **플레이어 단위**다 — 요금제도, 도착 여부도, 받을 돈도 사람마다 다르기
// 때문이다. 그래서 예약 단위로만 남은 것은 홀 수 · 날짜 · 시각 · 메모 넷뿐이고
// 나머지는 전부 카드 안으로 들어갔다.
//
// 모든 서버 호출은 controller 를 통해서만 한다. 이 파일에서 fetch 를 직접 부르지 않는다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { longDate, money } from "@/lib/teeSheet/dates";
import type {
  AuditEntry,
  PatchBookingInput,
  PatchPlayerInput,
  Player,
  TeeBooking,
  TeeSheetController,
} from "@/lib/teeSheet/types";

export type ReservationDetailProps = { controller: TeeSheetController };

// ===== constants =====

const MAX_PLAYERS = 4;
const PLAYER_DEBOUNCE_MS = 700;
const SAVED_FLASH_MS = 1800;

const CANCEL_PRESETS = [
  "Weather / course closed",
  "Guest requested cancellation",
  "Course maintenance",
  "No contact — released slot",
];

/**
 * 요금제 목록. 백엔드의 `ratePlan` 은 자유 문자열이지만 화면에서는 고르게 한다 —
 * 레퍼런스가 드롭다운이고, 무엇보다 `tone.ts` 의 색 규칙이 "Full Member" 라는
 * **정확한 접두사**를 보기 때문이다. 자유 입력이면 "full member" 같은 오타 하나로
 * 격자의 색이 조용히 달라진다.
 *
 * 서버가 목록에 없는 값을 들고 있으면 그 값을 그대로 한 항목 더 붙인다(아래 참고) —
 * 고르지 않았는데 저장 버튼 한 번에 값이 바뀌어 버리는 일이 없어야 한다.
 */
const RATE_PLANS = [
  "Public",
  "Public Senior",
  "Weekday Member - Single",
  "Weekday Member - Single with Weekday Cart",
  "Full Member - Single with 7 Day Cart",
  "GolfNow",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ===== local helpers =====

type PlayerDraft = { firstName: string; lastName: string; phone: string; email: string };
/** 예약 단위로 남은 편집 대상. Title·Carts 는 레퍼런스 패널에 없어서 빠졌다. */
type BookingDraft = { holes: 9 | 18; rate: string; notes: string };
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
    holes: booking.holes,
    rate: String(booking.rate),
    notes: booking.notes ?? "",
  };
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
  if (draft.holes !== booking.holes) patch.holes = draft.holes;
  const rate = Number(draft.rate);
  if (draft.rate.trim() !== "" && Number.isFinite(rate) && rate >= 0 && rate !== booking.rate) {
    patch.rate = rate;
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

/** 확인 코드 — 레퍼런스의 `6HOR-4M6L` 자리. id 를 사람이 읽고 부를 수 있는 모양으로 자른다. */
function confirmationCode(bookingId: string): string {
  const clean = bookingId.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const head = clean.slice(0, 8).padEnd(8, "0");
  return `${head.slice(0, 4)}-${head.slice(4, 8)}`;
}

const CHIP =
  "flex items-center gap-1.5 border border-[#c7c7cc] bg-white px-2 py-1 text-[11px] outline-none focus:border-[#4533ff]";

// ===== 글리프 =====
//
// 이모지를 쓰지 않는다. 두 가지 이유가 있다:
//   1) 레퍼런스의 아이콘은 전부 **단색 선 아이콘**이다. 컬러 이모지를 섞으면 이 패널만
//      튀어 보인다.
//   2) 🏷 · 🗑 는 폰트에 따라 그냥 빈 네모로 떨어진다 — 실제로 그렇게 나왔다.
//      "삭제" 버튼이 빈 네모인 화면을 프로 샵에 내보낼 수는 없다.
// 전부 장식이므로 aria-hidden 이고, 뜻은 감싸는 버튼의 이름/툴팁이 전달한다.
const GLYPH_PATH: Record<string, string> = {
  phone: "M3 2.6h3l1 3-1.6 1.2a8 8 0 0 0 3.8 3.8L10.4 9l3 1v3a1 1 0 0 1-1.1 1A11.4 11.4 0 0 1 2 3.7 1 1 0 0 1 3 2.6z",
  calendar: "M2.5 3.6h11v9.8h-11zM2.5 6.4h11M5.4 1.8v2.4M10.6 1.8v2.4",
  clock: "M8 2.4a5.6 5.6 0 1 1 0 11.2 5.6 5.6 0 0 1 0-11.2zM8 5.2V8l2 1.4",
  people: "M6 3.2a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM1.8 13.2c0-2.3 1.9-3.8 4.2-3.8s4.2 1.5 4.2 3.8M11 3.6a2.2 2.2 0 0 1 0 4.4M12.2 9.9c1.4.5 2.3 1.7 2.3 3.3",
  tag: "M2.4 2.4h5l6.2 6.2-5 5L2.4 7.4zM4.9 4.9h.01",
  copy: "M5.4 5.4h8.2v8.2H5.4zM10.6 5.4V2.4H2.4v8.2h3",
  trash: "M2.8 4.4h10.4M6.2 4.4V2.6h3.6v1.8M4.2 4.4l.7 9h6.2l.7-9M6.6 6.6v4.6M9.4 6.6v4.6",
  card: "M1.8 4.2h12.4v7.6H1.8zM1.8 6.8h12.4M4 9.6h2.4",
};

function Glyph({ name, className = "h-3.5 w-3.5" }: { name: keyof typeof GLYPH_PATH; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`${className} shrink-0`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 16 16"
    >
      <path d={GLYPH_PATH[name]} />
    </svg>
  );
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
  // 날짜 칩은 draft 를 거친다. <input type="date"> 의 change 는 값이 완성될 때마다
  // — 화살표로 연도를 한 칸 올릴 때마다 한 번씩 — 터지는데, 그때마다 moveBooking 을
  // 부르면 예약이 중간 날짜들을 하나씩 밟고 지나간다. blur 에서 한 번만 커밋한다.
  const [dateDraft, setDateDraft] = useState<string | null>(null);
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
    setDateDraft(null);
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
  const busy = controller.busy;
  const audit: AuditEntry[] = [...(booking.audit ?? [])].reverse();

  const dueFor = (player: Player) => (player.paid || player.cancelled ? 0 : booking.rate);

  // 시각 선택지는 그날의 실제 티타임 목록이다. 서버가 아직 슬롯을 안 줬거나 이 예약이
  // 목록에 없는 시각을 갖고 있으면(레거시 레코드) 현재 값을 한 항목 더 붙인다 —
  // 안 그러면 <select> 가 제멋대로 첫 항목을 고른 것처럼 보이고, 저장 한 번에
  // 예약이 다른 시각으로 옮겨 간다.
  const slotTimes = controller.slots.map((slot) => slot.time);
  const timeOptions = slotTimes.includes(booking.time) ? slotTimes : [booking.time, ...slotTimes];

  /**
   * 예약을 옮기고 **시트를 따라가게** 한다.
   * 따라가지 않으면 다른 주로 옮긴 순간 그 예약이 `visibleBookings` 에서 빠지고,
   * `selected` 가 풀리면서 상세 패널이 사용자 손 밑에서 그냥 닫힌다.
   */
  const moveTo = async (date: string, time: string) => {
    const moved = await controller.moveBooking(booking.id, date, time);
    if (moved) controller.setFocusedDate(moved.date);
  };

  const saveLabel =
    saveState.kind === "saving" ? "saving…" : saveState.kind === "saved" ? "saved" : dirty ? "unsaved" : "";

  return (
    <section className="min-w-0 border-t border-[#d4d4d8] bg-[#dedee2] text-xs text-[#1f2328]">
      {/* ===== 헤더 줄 ===== */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#c7c7cc] bg-white px-3 py-2">
        <span className="flex items-center gap-1.5 font-bold" title={`Reservation ${booking.id}`}>
          <Glyph className="h-3.5 w-3.5 text-[#4e5560]" name="phone" />
          {confirmationCode(booking.id)}
        </span>

        <label className={CHIP}>
          <span className="sr-only">Holes</span>
          <select
            className="bg-transparent outline-none"
            onChange={(event) => setBookingDraft({ ...draft, holes: Number(event.target.value) === 9 ? 9 : 18 })}
            value={String(draft.holes)}
          >
            <option value="9">9 holes</option>
            <option value="18">18 holes</option>
          </select>
        </label>

        {/* 날짜·시각은 draft 가 아니라 즉시 이동이다. `moveBooking` 은 목적지가 가득 찼는지
            서버가 판정해야 하므로 (좌석 정원 4명) Save 까지 미뤄 두면 실패를 늦게 알게 된다. */}
        <label className={CHIP} title="Move this reservation to another date">
          <Glyph className="h-3.5 w-3.5 text-[#4e5560]" name="calendar" />
          <span className="sr-only">Date</span>
          <input
            className="bg-transparent outline-none"
            disabled={busy}
            onBlur={() => {
              const next = dateDraft;
              setDateDraft(null);
              // 연도 자리를 다 채우기 전에 포커스가 빠지면 `0001-09-08` 같은 값이 남는다.
              // 실제로 그렇게 옮겨진 예약을 되돌려 본 적이 있다 — 그러니 커밋 전에 거른다.
              if (next && next !== booking.date && /^\d{4}-\d{2}-\d{2}$/.test(next) && next >= "1900-01-01") {
                void moveTo(next, booking.time);
              }
            }}
            onChange={(event) => setDateDraft(event.target.value)}
            type="date"
            value={dateDraft ?? booking.date}
          />
        </label>

        <label className={CHIP} title="Move this reservation to another tee time">
          <Glyph className="h-3.5 w-3.5 text-[#4e5560]" name="clock" />
          <span className="sr-only">Tee time</span>
          <select
            className="bg-transparent outline-none"
            disabled={busy}
            onChange={(event) => void moveTo(booking.date, event.target.value)}
            value={booking.time}
          >
            {timeOptions.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>

        {booking.cancelReason ? (
          <span className="border border-[#c47a63] bg-[#fbeae5] px-2 py-1 text-[#8a3f26]">
            Cancelled: {booking.cancelReason}
          </span>
        ) : null}

        <span
          aria-live="polite"
          className={`ml-auto min-w-[64px] text-right ${
            saveState.kind === "saved"
              ? "text-[#168a3c]"
              : saveState.kind === "saving"
                ? "text-[#4e5560]"
                : dirty
                  ? "font-bold text-[#8a3f26]"
                  : "text-transparent"
          }`}
        >
          {saveLabel}
        </span>

        <button
          className="border border-[#c7c7cc] bg-white px-4 py-1.5 font-bold text-[#4e5560] hover:border-[#4533ff] disabled:opacity-40"
          disabled={busy || booking.status === "cancelled"}
          onClick={() => setMode(mode === "cancel" ? "none" : "cancel")}
          title="Cancel this reservation"
          type="button"
        >
          Cancel
        </button>
        <button
          className="bg-[#4533ff] px-5 py-1.5 font-bold text-white disabled:cursor-not-allowed disabled:bg-[#b1a8ff]"
          disabled={busy || !dirty}
          onClick={() => void saveAll()}
          type="button"
        >
          Save
        </button>
      </div>

      {/* ===== inline cancel form (window.prompt 대체) ===== */}
      {mode === "cancel" ? (
        <div className="border-b border-[#c47a63] bg-white p-3">
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

      {/* ===== inline delete confirm (레일의 🗑) ===== */}
      {mode === "delete" ? (
        <div className="border-b border-[#8a3f26] bg-[#fbeae5] p-3">
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

      {/* ===== 아이콘 레일 + 플레이어 카드 ===== */}
      <div className="flex items-stretch">
        <IconRail
          historyOpen={historyOpen}
          onClose={() => controller.select(null)}
          onDelete={() => setMode(mode === "delete" ? "none" : "delete")}
          onToggleHistory={() => setHistoryOpen((open) => !open)}
          playerCount={players.length}
        />

        <div className="flex min-w-0 flex-1 items-stretch gap-2 overflow-x-auto p-2">
          {players.map((player) => {
            const pd = playerDrafts[player.id] ?? playerDraftOf(player);
            const emailInvalid = pd.email.trim() !== "" && !EMAIL_RE.test(pd.email.trim());
            // 서버 값이 목록에 없으면 그 값도 항목으로 붙인다 (RATE_PLANS 주석 참고).
            const plan = player.ratePlan?.trim() || "Public";
            const planOptions = RATE_PLANS.includes(plan) ? RATE_PLANS : [plan, ...RATE_PLANS];

            return (
              <article
                className="flex w-[212px] shrink-0 flex-col border border-[#c7c7cc] bg-white p-1.5"
                key={player.id}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ececf0] text-[10px] text-[#6b7280]"
                  >
                    {player.type === "Guest" ? "G" : "●"}
                  </span>
                  <span className="truncate font-bold">{player.type}</span>
                  <button
                    className="ml-auto px-1 text-[#8a3f26] disabled:opacity-30"
                    disabled={busy}
                    onClick={() => void controller.removePlayer(booking.id, player.id)}
                    title="Remove this player from the reservation"
                    type="button"
                  >
                    ×
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1">
                  <label className="block">
                    <span className="sr-only">Last Name</span>
                    <input
                      className="w-full border-b border-[#d7d7dc] px-1 py-1 font-bold outline-none focus:border-[#4533ff]"
                      onBlur={() => void flushPlayer(player.id)}
                      onChange={(event) => setPlayerField(player, "lastName", event.target.value)}
                      placeholder="Last Name"
                      value={pd.lastName}
                    />
                  </label>
                  <label className="block">
                    <span className="sr-only">First Name</span>
                    <input
                      className="w-full border-b border-[#d7d7dc] px-1 py-1 outline-none focus:border-[#4533ff]"
                      onBlur={() => void flushPlayer(player.id)}
                      onChange={(event) => setPlayerField(player, "firstName", event.target.value)}
                      placeholder="First Name"
                      value={pd.firstName}
                    />
                  </label>
                </div>

                {/* Postal / Mem # 은 레퍼런스에 있는 칸이지만 우리 Player 모델에는 없다.
                    입력을 받아 두고 조용히 버리면 프런트 데스크가 적어 넣은 회원번호가
                    사라지므로, 칸만 두고 `disabled` 로 잠근다. 백엔드에 필드가 생기면
                    여기만 풀면 된다. */}
                <div className="mt-1 grid grid-cols-[1.4fr_1fr_1fr] gap-1">
                  <label className="block">
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
                  <input
                    className="w-full cursor-not-allowed border-b border-[#ececf0] px-1 py-1 text-[#b6b6c0]"
                    disabled
                    placeholder="Postal"
                    title="No postal code field on the reservation record yet"
                  />
                  <input
                    className="w-full cursor-not-allowed border-b border-[#ececf0] px-1 py-1 text-[#b6b6c0]"
                    disabled
                    placeholder="Mem #"
                    title="No membership number field on the reservation record yet"
                  />
                </div>

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

                {/* 요금제. 격자의 셀 색이 여기서 정해진다 (tone.ts) — 그래서 바로 저장한다. */}
                <label className="mt-1.5 flex items-center gap-1 border border-[#c7c7cc] px-1.5 py-0.5">
                  <span aria-hidden className="text-[8px] leading-none text-[#4533ff]">
                    &#9679;
                  </span>
                  <span className="sr-only">Rate plan</span>
                  <select
                    className="w-full bg-transparent outline-none"
                    disabled={busy}
                    onChange={(event) =>
                      void controller.patchPlayer(booking.id, player.id, { ratePlan: event.target.value })
                    }
                    value={plan}
                  >
                    {planOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="mt-1.5 grid grid-cols-2 gap-1">
                  <button
                    className={`border px-1 py-1 font-bold disabled:opacity-40 ${
                      player.arrived ? "border-[#168a3c] bg-[#ecfff1] text-[#168a3c]" : "border-[#d7d7dc]"
                    }`}
                    disabled={busy}
                    onClick={() => void controller.patchPlayer(booking.id, player.id, { arrived: !player.arrived })}
                    type="button"
                  >
                    Arrived
                  </button>
                  <button
                    className={`border px-1 py-1 font-bold disabled:opacity-40 ${
                      player.no_show ? "border-[#8a3f26] bg-[#fff1ee] text-[#8a3f26]" : "border-[#d7d7dc]"
                    }`}
                    disabled={busy}
                    onClick={() => void controller.patchPlayer(booking.id, player.id, { no_show: !player.no_show })}
                    type="button"
                  >
                    No show
                  </button>
                </div>

                {/* 그린피 한 줄. 금액은 예약 단위 `rate` 라서 한 카드에서 고치면 모든
                    카드가 같이 바뀐다 — title 로 그 사실을 말해 둔다. 레퍼런스처럼
                    글자로 보이지만 실제로는 입력칸이다 (요금 편집을 잃지 않으려고). */}
                <div className="mt-1.5 flex items-center gap-1 border border-[#d7d7dc] px-1.5 py-1">
                  <span className="truncate">{booking.holes} Hole Green Fee</span>
                  <span aria-hidden className="ml-auto text-[#9aa0a6]">
                    $
                  </span>
                  <input
                    aria-label="Green fee for every player on this reservation"
                    className="w-12 bg-transparent text-right tabular-nums outline-none focus:text-[#4533ff]"
                    inputMode="decimal"
                    onChange={(event) => setBookingDraft({ ...draft, rate: event.target.value })}
                    title="Green fee — one rate for the whole reservation"
                    value={draft.rate}
                  />
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full border ${
                      player.paid ? "border-[#168a3c] bg-[#168a3c]" : "border-[#c7c7cc]"
                    }`}
                  />
                </div>
                {draft.rate.trim() !== "" && !Number.isFinite(Number(draft.rate)) ? (
                  <span className="mt-1 block text-[10px] text-[#8a3f26]">Not a number — will not be saved</span>
                ) : null}
                {player.cancelled ? (
                  <div className="mt-1 flex justify-between text-[#8a3f26]">
                    <span>Cancelled</span>
                    <span>−{money(booking.rate)}</span>
                  </div>
                ) : null}

                <div className="mt-1.5 flex justify-between border-t border-[#ececf0] pt-1.5 font-bold">
                  <span>Subtotal Due</span>
                  <span className="tabular-nums">{money(dueFor(player))}</span>
                </div>

                <div className="mt-1.5 grid grid-cols-2 gap-1">
                  {/* 할인 API 가 아직 없다. 생김새만 맞추고 눌리지 않게 잠근다 —
                      눌러도 아무 일이 없는 버튼보다 잠긴 버튼이 정직하다. */}
                  <button
                    className="cursor-not-allowed border border-[#ececf0] px-1 py-1 font-bold text-[#b6b6c0]"
                    disabled
                    title="No discount API yet"
                    type="button"
                  >
                    Discount
                  </button>
                  <button
                    className={`flex items-center justify-center gap-1 px-1 py-1 font-bold text-white disabled:opacity-40 ${
                      player.paid ? "bg-[#4533ff]" : "bg-[#b1a8ff]"
                    }`}
                    disabled={busy}
                    onClick={() => void controller.patchPlayer(booking.id, player.id, { paid: !player.paid })}
                    title={player.paid ? "Mark unpaid" : "Take payment"}
                    type="button"
                  >
                    Payment
                    <Glyph className="h-3 w-3" name="card" />
                  </button>
                </div>
              </article>
            );
          })}

          {/* 자리를 더 파는 길. 레퍼런스는 격자의 ⊕ 로만 사람을 넣지만 그것은 **새 예약**을
              여는 버튼이라, 이 카드를 없애면 기존 예약에 세 번째 사람을 붙일 방법이 사라진다. */}
          {players.length < MAX_PLAYERS ? (
            <button
              className="w-[52px] shrink-0 border border-dashed border-[#aeb2bb] bg-[#d5d5da] text-2xl text-[#9297a1] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={busy}
              onClick={() => void controller.addPlayer(booking.id)}
              title="Add a player to this reservation"
              type="button"
            >
              +
            </button>
          ) : null}
        </div>
      </div>

      {/* ===== history (레일의 🕐) ===== */}
      {historyOpen ? (
        <div className="border-t border-[#c7c7cc] bg-white">
          <p className="px-3 py-1.5 font-bold">History ({audit.length})</p>
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
        </div>
      ) : null}

      {/* ===== 노란 메모 줄 ===== */}
      <textarea
        aria-label="Reservation note"
        className="block h-8 w-full resize-none border-t border-[#c7c7cc] bg-[#fffbd5] px-3 py-2 leading-4 outline-none focus:h-16 focus:bg-[#fffde8]"
        onChange={(event) => setBookingDraft({ ...draft, notes: event.target.value })}
        placeholder="Type a note concerning this reservation..."
        value={draft.notes}
      />
    </section>
  );
}

/**
 * 상세 패널 왼쪽의 세로 아이콘 레일.
 *
 * 실제로 무언가 하는 것은 셋뿐이다 — 히스토리 · 삭제 · 닫기. 나머지 글리프는
 * 레퍼런스의 자리를 지키는 **표시**이고 버튼이 아니다(`<span>`). 눌러도 아무 일이
 * 없는 과녁을 일곱 개 만들어 두면 사용자는 앱이 고장 났다고 생각한다 — 사이드바의
 * Golf 드롭다운, 상단바 글리프와 같은 판단이다.
 */
function IconRail({
  playerCount,
  historyOpen,
  onToggleHistory,
  onDelete,
  onClose,
}: {
  playerCount: number;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const cell = "flex h-7 w-9 items-center justify-center";
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5 border-r border-[#c7c7cc] bg-[#d5d5da] py-2">
      <span className={`${cell} text-[#4e5560]`} title={`${playerCount} player(s)`}>
        <Glyph name="people" />
      </span>
      <button
        aria-pressed={historyOpen}
        className={`${cell} ${historyOpen ? "bg-white text-[#4533ff]" : "text-[#4e5560] hover:bg-white/60"}`}
        onClick={onToggleHistory}
        title="Reservation history"
        type="button"
      >
        <Glyph name="clock" />
      </button>
      <span className={`${cell} text-[#9297a1]`}>
        <Glyph name="tag" />
      </span>
      <span aria-hidden className={`${cell} text-[13px] text-[#9297a1]`}>
        ?
      </span>
      <span className={`${cell} text-[#9297a1]`}>
        <Glyph name="copy" />
      </span>
      <button
        className={`${cell} text-[15px] text-[#4e5560] hover:bg-white/60`}
        onClick={onClose}
        title="Close and expand the tee sheet"
        type="button"
      >
        <span aria-hidden>&times;</span>
      </button>
      <button
        className={`${cell} text-[#8a3f26] hover:bg-white/60`}
        onClick={onDelete}
        title="Delete this reservation"
        type="button"
      >
        <Glyph name="trash" />
      </button>
    </div>
  );
}
