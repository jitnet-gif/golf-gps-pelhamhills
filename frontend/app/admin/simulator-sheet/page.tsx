"use client";

// Indoor Golf Simulator — Bay Sheet (GolfOClock 방식 관리자 화면)
// 가로축 = 베이, 세로축 = 15분 슬롯. 빈 칸 클릭 → 새 예약, 블록 드래그 → 베이/시간 이동.
// FastAPI(/api/v1/simulator/*)가 꺼져 있으면 로컬 샘플 모드로 동작한다.

import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";

import AdminShell from "@/components/admin/AdminShell";
import { BOOK_INDOOR } from "@/lib/nav";

type Bay = {
  id: number;
  bay_number: number;
  bay_type: string;
  hourly_rate: number;
  is_active: boolean;
};

type ResStatus = "confirmed" | "checked_in" | "paid" | "no_show" | "cancelled";
type ResSource = "online" | "phone" | "walk_in" | "voice_ai";

type Reservation = {
  id: number | string;
  confirmation_code: string;
  bay_id: number;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  duration_hours: number;
  player_count: number;
  customer_name: string;
  customer_email: string;
  phone: string;
  notes: string;
  status: ResStatus;
  source: ResSource;
};

type BayState = "open" | "cleaning" | "maintenance";

type Draft = Omit<Reservation, "id" | "confirmation_code"> & {
  id?: Reservation["id"];
  confirmation_code?: string;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

// backend/api/routes/simulator.py 와 동일한 운영 규칙
const OPEN_HOUR = 14;
const CLOSE_HOUR = 22;
const SLOT_MIN = 15;
const CLOSED_WEEKDAYS = [1, 2]; // JS: 0=Sun, 1=Mon, 2=Tue
const HST = 0.13;
const ROW_H = 22; // px per 15-min slot
const SLOTS = ((CLOSE_HOUR - OPEN_HOUR) * 60) / SLOT_MIN;

const SAMPLE_BAYS: Bay[] = [
  {
    id: 1,
    bay_number: 1,
    bay_type: "right_handed",
    hourly_rate: 20,
    is_active: true,
  },
  {
    id: 2,
    bay_number: 2,
    bay_type: "right_handed",
    hourly_rate: 20,
    is_active: true,
  },
  {
    id: 3,
    bay_number: 3,
    bay_type: "right_handed",
    hourly_rate: 20,
    is_active: true,
  },
  {
    id: 4,
    bay_number: 4,
    bay_type: "left_right",
    hourly_rate: 20,
    is_active: true,
  },
  { id: 5, bay_number: 5, bay_type: "vip", hourly_rate: 25, is_active: true },
];

const BAY_TYPE_LABEL: Record<string, string> = {
  right_handed: "Right-Handed",
  left_right: "Left & Right",
  vip: "VIP Lounge",
};

const STATUS_STYLE: Record<ResStatus, { box: string; label: string }> = {
  confirmed: { box: "bg-[#0034c9] text-white", label: "Booked" },
  checked_in: { box: "bg-[#ffd400] text-[#1d232b]", label: "Checked In" },
  paid: { box: "bg-[#16a34a] text-white", label: "Paid" },
  no_show: {
    box: "bg-[#fde2dd] text-[#9e2f20] line-through",
    label: "No Show",
  },
  cancelled: {
    box: "bg-[#ececf0] text-[#8a8f98] line-through",
    label: "Cancelled",
  },
};

const SOURCE_LABEL: Record<ResSource, string> = {
  online: "WEB",
  phone: "PHONE",
  walk_in: "WALK-IN",
  voice_ai: "AI CALL",
};

// ---------- helpers ----------
function toMin(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function fromMin(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function fmt12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${suffix}`;
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso: string, n: number) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
function isClosed(iso: string) {
  return CLOSED_WEEKDAYS.includes(parseIso(iso).getDay());
}
function nextOpen(iso: string) {
  let d = iso;
  for (let i = 0; i < 7 && isClosed(d); i++) d = addDays(d, 1);
  return d;
}
function money(v: number) {
  return `$${v.toFixed(2)}`;
}
function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
) {
  return a.start < b.end && b.start < a.end;
}
function code() {
  return Math.random().toString(36).slice(2, 12).toUpperCase();
}

// 날짜별로 항상 같은 샘플 예약을 만든다 (API 오프라인일 때)
function sampleReservations(date: string): Reservation[] {
  if (isClosed(date)) return [];
  const seed = parseIso(date).getDate();
  const rows: [number, string, number, number, string, ResStatus, ResSource][] =
    [
      [1, "14:00", 1, 2, "Walton, Connor", "paid", "online"],
      [2, "15:00", 2, 4, "Kim, Daniel", "checked_in", "voice_ai"],
      [3, "16:30", 1, 3, "Patel, Sonia", "confirmed", "online"],
      [4, "17:00", 2, 2, "Leblanc, Marc", "confirmed", "phone"],
      [5, "18:00", 3, 6, "Okafor Birthday", "confirmed", "phone"],
      [1, "19:00", 2, 4, "Nguyen, Tim", "confirmed", "online"],
      [2, "20:00", 1, 1, "Walk-in", "confirmed", "walk_in"],
      [3, "20:30", 1, 2, "Russo, Gina", "no_show", "online"],
    ];
  return rows
    .filter((_, i) => (i + seed) % 5 !== 0)
    .map(([bay, start, hours, players, name, status, source], i) => ({
      id: `s-${date}-${i}`,
      confirmation_code: `SIM${seed}${i}${bay}`.padEnd(10, "X"),
      bay_id: bay,
      date,
      start_time: start,
      duration_hours: hours,
      player_count: Math.min(players, 6),
      customer_name: name,
      customer_email: "",
      phone: "",
      notes: "",
      status,
      source,
    }));
}

// ---------- page ----------
export default function SimulatorSheetPage() {
  const todayIso = useMemo(() => isoDate(new Date()), []);
  const [date, setDate] = useState(() => nextOpen(isoDate(new Date())));
  const [bays, setBays] = useState<Bay[]>(SAMPLE_BAYS);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [bayState, setBayState] = useState<Record<number, BayState>>({});
  const [apiOnline, setApiOnline] = useState(false);
  const [message, setMessage] = useState("Local sample mode");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [nowMin, setNowMin] = useState<number | null>(null);

  const closed = isClosed(date);

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(`${apiBaseUrl}${path}`, {
        headers: { "Content-Type": "application/json", ...init?.headers },
        ...init,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<T>;
    },
    [],
  );

  // load bays once
  useEffect(() => {
    request<{ bays: Bay[] } | Bay[]>("/simulator/bays")
      .then((data) => {
        const list = Array.isArray(data) ? data : data.bays;
        if (list?.length) setBays(list.filter((b) => b.is_active !== false));
        setApiOnline(true);
        setMessage("Connected to FastAPI simulator service");
      })
      .catch(() => {
        setApiOnline(false);
        setMessage("FastAPI offline: using local sample mode");
      });
  }, [request]);

  // load reservations when date or api changes
  useEffect(() => {
    setDraft(null);
    if (!apiOnline) {
      setReservations(sampleReservations(date));
      return;
    }
    request<{ reservations: Reservation[] }>(
      `/simulator/admin/reservations?date=${date}`,
    )
      .then((data) => setReservations(data.reservations))
      .catch(() => {
        setReservations(sampleReservations(date));
        setMessage("Admin API missing: showing sample reservations");
      });
  }, [date, apiOnline, request]);

  // now-line
  useEffect(() => {
    function tick() {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    }
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const visible = reservations.filter(
    (r) => showCancelled || r.status !== "cancelled",
  );
  const active = reservations.filter((r) => r.status !== "cancelled");
  const bookedHours = active.reduce((s, r) => s + r.duration_hours, 0);
  const capacityHours = closed ? 0 : bays.length * (CLOSE_HOUR - OPEN_HOUR);
  const utilization = capacityHours
    ? Math.round((bookedHours / capacityHours) * 100)
    : 0;
  const bayById = useMemo(
    () => Object.fromEntries(bays.map((b) => [b.id, b])),
    [bays],
  );
  const revenue = active
    .filter((r) => r.status !== "no_show")
    .reduce(
      (s, r) => s + (bayById[r.bay_id]?.hourly_rate ?? 20) * r.duration_hours,
      0,
    );
  const players = active.reduce((s, r) => s + r.player_count, 0);

  function conflicts(candidate: {
    id?: Reservation["id"];
    bay_id: number;
    start_time: string;
    duration_hours: number;
  }) {
    const a = {
      start: toMin(candidate.start_time),
      end: toMin(candidate.start_time) + candidate.duration_hours * 60,
    };
    return active.some(
      (r) =>
        r.id !== candidate.id &&
        r.bay_id === candidate.bay_id &&
        overlaps(a, {
          start: toMin(r.start_time),
          end: toMin(r.start_time) + r.duration_hours * 60,
        }),
    );
  }
  function withinHours(start: string, hours: number) {
    return (
      toMin(start) >= OPEN_HOUR * 60 &&
      toMin(start) + hours * 60 <= CLOSE_HOUR * 60
    );
  }
  function maxHoursFrom(bay_id: number, start: string, id?: Reservation["id"]) {
    let h = 0;
    for (let n = 1; n <= 4; n++) {
      if (
        !withinHours(start, n) ||
        conflicts({ id, bay_id, start_time: start, duration_hours: n })
      )
        break;
      h = n;
    }
    return h;
  }

  // ---------- actions ----------
  function openNew(bay_id: number, start: string) {
    if (closed) return;
    if (bayState[bay_id] && bayState[bay_id] !== "open") {
      setMessage(
        `Bay ${bayById[bay_id]?.bay_number} is ${bayState[bay_id]} — set it to Open first.`,
      );
      return;
    }
    if (maxHoursFrom(bay_id, start) < 1) {
      setMessage("Not enough free time from that slot (min 1 hour).");
      return;
    }
    setConfirmCancel(false);
    setDraft({
      bay_id,
      date,
      start_time: start,
      duration_hours: 1,
      player_count: 2,
      customer_name: "",
      customer_email: "",
      phone: "",
      notes: "",
      status: "confirmed",
      source: "walk_in",
    });
  }

  function openExisting(r: Reservation) {
    setConfirmCancel(false);
    setDraft({ ...r });
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.customer_name.trim()) {
      setMessage("Customer name is required.");
      return;
    }
    if (!withinHours(draft.start_time, draft.duration_hours)) {
      setMessage("Reservation must end by 10:00 PM.");
      return;
    }
    if (conflicts(draft)) {
      setMessage("That bay is already booked for part of this time.");
      return;
    }

    if (apiOnline) {
      try {
        if (draft.id === undefined) {
          const created = await request<Reservation>(
            "/simulator/reservations",
            {
              method: "POST",
              body: JSON.stringify({
                ...draft,
                customer_email: draft.customer_email || "walkin@pelhamhills.ca",
                notes: `[src:${draft.source}] ${draft.notes}`.trim(),
              }),
            },
          );
          setReservations((cur) => [
            ...cur,
            { ...draft, ...created, id: created.id } as Reservation,
          ]);
        } else {
          const updated = await request<Reservation>(
            `/simulator/admin/reservations/${draft.id}`,
            {
              method: "PATCH",
              body: JSON.stringify(draft),
            },
          );
          setReservations((cur) =>
            cur.map((r) => (r.id === draft.id ? { ...r, ...updated } : r)),
          );
        }
        setMessage("Saved");
        setDraft(null);
        return;
      } catch (err) {
        setMessage(`Save failed: ${(err as Error).message.slice(0, 120)}`);
        return;
      }
    }

    if (draft.id === undefined) {
      setReservations((cur) => [
        ...cur,
        {
          ...draft,
          id: `l-${Date.now()}`,
          confirmation_code: code(),
        } as Reservation,
      ]);
    } else {
      setReservations((cur) =>
        cur.map((r) =>
          r.id === draft.id ? ({ ...r, ...draft } as Reservation) : r,
        ),
      );
    }
    setMessage("Saved locally (sample mode)");
    setDraft(null);
  }

  async function patchReservation(
    id: Reservation["id"],
    patch: Partial<Reservation>,
    note: string,
  ) {
    if (apiOnline && typeof id === "number") {
      try {
        const updated = await request<Reservation>(
          `/simulator/admin/reservations/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify(patch),
          },
        );
        setReservations((cur) =>
          cur.map((r) => (r.id === id ? { ...r, ...updated } : r)),
        );
      } catch (err) {
        setMessage(`Update failed: ${(err as Error).message.slice(0, 120)}`);
        return;
      }
    } else {
      setReservations((cur) =>
        cur.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
    }
    setDraft((d) => (d && d.id === id ? { ...d, ...patch } : d));
    setMessage(note);
  }

  // ---------- drag to move ----------
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    id: Reservation["id"];
    startX: number;
    startY: number;
    moved: boolean;
    bay_id: number;
    start_time: string;
    ok: boolean;
  } | null>(null);

  function locate(clientX: number, clientY: number) {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * bays.length);
    const slot = Math.floor((clientY - rect.top) / ROW_H);
    if (col < 0 || col >= bays.length || slot < 0 || slot >= SLOTS) return null;
    return { bay_id: bays[col].id, slot };
  }

  function onBlockDown(e: ReactPointerEvent, r: Reservation) {
    if (r.status === "cancelled") return openExisting(r);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      id: r.id,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      bay_id: r.bay_id,
      start_time: r.start_time,
      ok: true,
    });
  }

  function onBlockMove(e: ReactPointerEvent, r: Reservation) {
    if (!drag || drag.id !== r.id) return;
    const moved =
      drag.moved ||
      Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 6;
    if (!moved) return;
    // 블록의 윗부분을 잡은 위치를 유지하기 위해 이동량 기준으로 계산
    const dy = Math.round((e.clientY - drag.startY) / ROW_H);
    const hit = locate(e.clientX, e.clientY);
    const bay_id = hit ? hit.bay_id : drag.bay_id;
    const start = Math.min(
      Math.max(toMin(r.start_time) + dy * SLOT_MIN, OPEN_HOUR * 60),
      CLOSE_HOUR * 60 - r.duration_hours * 60,
    );
    const start_time = fromMin(start);
    const ok =
      bayState[bay_id] !== "cleaning" &&
      bayState[bay_id] !== "maintenance" &&
      !conflicts({
        id: r.id,
        bay_id,
        start_time,
        duration_hours: r.duration_hours,
      });
    setDrag({ ...drag, moved: true, bay_id, start_time, ok });
  }

  function onBlockUp(r: Reservation) {
    if (!drag || drag.id !== r.id) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) return openExisting(r);
    if (!d.ok) {
      setMessage(
        "Can't move there — overlaps another booking or the bay is unavailable.",
      );
      return;
    }
    if (d.bay_id === r.bay_id && d.start_time === r.start_time) return;
    patchReservation(
      r.id,
      { bay_id: d.bay_id, start_time: d.start_time },
      `Moved ${r.customer_name} → Bay ${bayById[d.bay_id]?.bay_number} at ${fmt12(d.start_time)}`,
    );
  }

  // ---------- render helpers ----------
  const hours = Array.from(
    { length: CLOSE_HOUR - OPEN_HOUR },
    (_, i) => OPEN_HOUR + i,
  );
  const dateLabel = parseIso(date).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "short",
    year: "numeric",
  });
  const dayNum = parseIso(date).getDate();
  const showNow =
    date === todayIso &&
    nowMin !== null &&
    nowMin >= OPEN_HOUR * 60 &&
    nowMin <= CLOSE_HOUR * 60;
  const draftBay = draft ? bayById[draft.bay_id] : undefined;
  const subtotal =
    draft && draftBay ? draftBay.hourly_rate * draft.duration_hours : 0;
  const draftMaxHours = draft
    ? Math.max(
        maxHoursFrom(draft.bay_id, draft.start_time, draft.id),
        draft.duration_hours,
      )
    : 1;
  const startOptions = Array.from({ length: SLOTS }, (_, i) =>
    fromMin(OPEN_HOUR * 60 + i * SLOT_MIN),
  );

  return (
    <AdminShell
      actions={
        <>
          <Link
            className="border border-[#d7d7dc] px-3 py-1.5 text-xs font-bold"
            href={BOOK_INDOOR}
          >
            Online Booking Page
          </Link>
          <button
            className="bg-[#4533ff] px-4 py-1.5 text-xs font-bold text-white disabled:opacity-40"
            disabled={closed}
            onClick={() => {
              const firstOpenBay = bays.find(
                (b) => (bayState[b.id] ?? "open") === "open",
              );
              if (!firstOpenBay) return;
              const base =
                date === todayIso && nowMin
                  ? Math.ceil(nowMin / SLOT_MIN) * SLOT_MIN
                  : OPEN_HOUR * 60;
              openNew(firstOpenBay.id, fromMin(Math.max(base, OPEN_HOUR * 60)));
            }}
          >
            Add Walk-in +
          </button>
        </>
      }
      title="Indoor Golf Simulator · Bay Sheet"
    >
      <div className="grid min-w-0 grid-rows-[auto_1fr]">
        {/* stats + date nav */}
        <section className="border-b border-[#d4d4d8] bg-white px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="rounded bg-[#111315] px-2 py-1 text-white">
                {active.length} Reservations
              </span>
              <span>{players} Players</span>
              <span>
                {bookedHours}h / {capacityHours}h booked
              </span>
              <span className="font-bold">{utilization}% utilization</span>
              <span>{money(revenue)} before tax</span>
              <span
                className={`rounded px-2 py-1 ${apiOnline ? "bg-[#dbf5e3] text-[#126c31]" : "bg-[#fff3cd] text-[#8a5b00]"}`}
              >
                {message}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                aria-label="Previous day"
                className="border border-[#d7d7dc] px-2 py-1 text-xs font-bold"
                onClick={() => setDate(addDays(date, -1))}
              >
                ‹
              </button>
              <div className="text-center">
                <p className="text-3xl font-semibold leading-none">{dayNum}</p>
                <p className="text-xs font-semibold">{dateLabel}</p>
              </div>
              <button
                aria-label="Next day"
                className="border border-[#d7d7dc] px-2 py-1 text-xs font-bold"
                onClick={() => setDate(addDays(date, 1))}
              >
                ›
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <button
                className="border border-[#d7d7dc] px-3 py-1.5 font-bold"
                onClick={() => setDate(nextOpen(todayIso))}
              >
                Today
              </button>
              <input
                className="border border-[#d7d7dc] px-2 py-1"
                id="sim-date"
                onChange={(e) => e.target.value && setDate(e.target.value)}
                type="date"
                value={date}
              />
              <label className="flex items-center gap-1">
                <input
                  checked={showCancelled}
                  id="sim-show-cancelled"
                  onChange={(e) => setShowCancelled(e.target.checked)}
                  type="checkbox"
                />
                Show cancelled
              </label>
            </div>
          </div>
        </section>

        {/* grid + drawer */}
        <section className="grid min-w-0 gap-0 xl:grid-cols-[1fr_320px]">
          <div className="min-w-0 overflow-auto p-4">
            {closed ? (
              <div className="grid place-items-center gap-3 rounded border border-[#d6d6dc] bg-white p-10 text-center">
                <p className="text-lg font-bold">
                  Simulators are closed on Mondays and Tuesdays
                </p>
                <p className="text-sm text-[#5d6673]">
                  Hours: Wednesday – Sunday, 2:00 PM – 10:00 PM
                </p>
                <button
                  className="bg-[#4533ff] px-4 py-2 text-xs font-bold text-white"
                  onClick={() => setDate(nextOpen(date))}
                >
                  Go to next open day
                </button>
              </div>
            ) : (
              <div
                className="rounded border border-[#d6d6dc] bg-white"
                style={{ minWidth: 64 + bays.length * 170 }}
              >
                {/* bay header */}
                <div
                  className="grid border-b border-[#d6d6dc] bg-[#d7d5da] text-xs"
                  style={{
                    gridTemplateColumns: `64px repeat(${bays.length}, 1fr)`,
                  }}
                >
                  <div className="p-2 font-bold">Time</div>
                  {bays.map((b) => {
                    const st = bayState[b.id] ?? "open";
                    return (
                      <div className="border-l border-[#c9c7cc] p-2" key={b.id}>
                        <div className="flex items-center justify-between">
                          <span className="font-bold">Bay {b.bay_number}</span>
                          <span className="text-[#5d6673]">
                            {money(b.hourly_rate)}/h
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-1">
                          <span className="truncate text-[11px] text-[#4e5560]">
                            {BAY_TYPE_LABEL[b.bay_type] ?? b.bay_type}
                          </span>
                          <select
                            aria-label={`Bay ${b.bay_number} status`}
                            className={`rounded px-1 py-0.5 text-[10px] font-bold ${
                              st === "open"
                                ? "bg-[#dbf5e3] text-[#126c31]"
                                : st === "cleaning"
                                  ? "bg-[#fff3cd] text-[#8a5b00]"
                                  : "bg-[#fde2dd] text-[#9e2f20]"
                            }`}
                            id={`bay-state-${b.id}`}
                            onChange={(e) =>
                              setBayState((cur) => ({
                                ...cur,
                                [b.id]: e.target.value as BayState,
                              }))
                            }
                            value={st}
                          >
                            <option value="open">Open</option>
                            <option value="cleaning">Cleaning</option>
                            <option value="maintenance">Maintenance</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* body */}
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `64px 1fr` }}
                >
                  {/* time labels */}
                  <div>
                    {hours.map((h) => (
                      <div
                        className="border-b border-[#d6d6dc] px-2 text-[11px] font-semibold text-[#4e5560]"
                        key={h}
                        style={{ height: ROW_H * 4 }}
                      >
                        {fmt12(`${String(h).padStart(2, "0")}:00`)}
                      </div>
                    ))}
                  </div>

                  {/* bay columns */}
                  <div
                    className="relative"
                    ref={gridRef}
                    style={{ height: SLOTS * ROW_H }}
                  >
                    <div
                      className="absolute inset-0 grid"
                      style={{
                        gridTemplateColumns: `repeat(${bays.length}, 1fr)`,
                      }}
                    >
                      {bays.map((b) => {
                        const st = bayState[b.id] ?? "open";
                        return (
                          <div
                            className={`border-l border-[#e3e3e8] ${st !== "open" ? "bg-[repeating-linear-gradient(135deg,#f4f4f6_0_8px,#ececf0_8px_16px)]" : ""}`}
                            key={b.id}
                          >
                            {startOptions.map((t, i) => (
                              <button
                                aria-label={`Book Bay ${b.bay_number} at ${fmt12(t)}`}
                                className={`block w-full hover:bg-[#eef0ff] ${i % 4 === 3 ? "border-b border-[#d6d6dc]" : "border-b border-dashed border-[#f0f0f3]"}`}
                                key={t}
                                onClick={() => openNew(b.id, t)}
                                style={{ height: ROW_H }}
                              />
                            ))}
                          </div>
                        );
                      })}
                    </div>

                    {/* now line */}
                    {showNow && nowMin !== null && (
                      <div
                        className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-[#e11d48]"
                        style={{
                          top: ((nowMin - OPEN_HOUR * 60) / SLOT_MIN) * ROW_H,
                        }}
                      >
                        <span className="absolute -top-2 left-0 rounded bg-[#e11d48] px-1 text-[9px] font-bold text-white">
                          NOW
                        </span>
                      </div>
                    )}

                    {/* reservations */}
                    {visible.map((r) => {
                      const isDrag = drag?.id === r.id && drag.moved;
                      const bayId = isDrag ? drag.bay_id : r.bay_id;
                      const start = isDrag ? drag.start_time : r.start_time;
                      const col = bays.findIndex((b) => b.id === bayId);
                      if (col < 0) return null;
                      const top =
                        ((toMin(start) - OPEN_HOUR * 60) / SLOT_MIN) * ROW_H;
                      const height = r.duration_hours * 4 * ROW_H;
                      const s = STATUS_STYLE[r.status];
                      const selected = draft?.id === r.id;
                      return (
                        <div
                          className={`absolute z-10 cursor-grab touch-none select-none overflow-hidden rounded-sm px-2 py-1 text-[11px] leading-4 shadow-sm ${s.box} ${
                            selected ? "ring-2 ring-[#111315]" : ""
                          } ${isDrag ? (drag.ok ? "opacity-80 ring-2 ring-[#4533ff]" : "opacity-80 ring-2 ring-[#e11d48]") : ""}`}
                          key={r.id}
                          onPointerDown={(e) => onBlockDown(e, r)}
                          onPointerMove={(e) => onBlockMove(e, r)}
                          onPointerUp={() => onBlockUp(r)}
                          role="button"
                          style={{
                            top: top + 1,
                            height: height - 2,
                            left: `calc(${(col / bays.length) * 100}% + 3px)`,
                            width: `calc(${100 / bays.length}% - 6px)`,
                          }}
                          tabIndex={0}
                          onKeyDown={(e) =>
                            e.key === "Enter" && openExisting(r)
                          }
                        >
                          <div className="flex items-center justify-between gap-1 font-bold">
                            <span className="truncate">
                              ● {r.customer_name}
                            </span>
                            <span className="shrink-0 rounded bg-black/15 px-1 text-[9px]">
                              {SOURCE_LABEL[r.source ?? "online"]}
                            </span>
                          </div>
                          <div className="truncate opacity-90">
                            {fmt12(start)} · {r.duration_hours}h · 👥{" "}
                            {r.player_count}
                          </div>
                          {height > 60 && (
                            <div className="truncate opacity-80">
                              {s.label} · #{r.confirmation_code}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[#4e5560]">
              {(Object.keys(STATUS_STYLE) as ResStatus[]).map((k) => (
                <span className="flex items-center gap-1" key={k}>
                  <span
                    className={`inline-block h-3 w-4 rounded-sm ${STATUS_STYLE[k].box}`}
                  />{" "}
                  {STATUS_STYLE[k].label}
                </span>
              ))}
              <span>
                · Click an empty slot to book · Drag a booking to move it
              </span>
            </div>
          </div>

          {/* drawer */}
          <aside className="border-l border-[#d4d4d8] bg-[#dedee2] p-3">
            {!draft ? (
              <div className="grid gap-3 text-xs">
                <p className="font-bold">Bay status now</p>
                {bays.map((b) => {
                  const cur =
                    date === todayIso && nowMin !== null
                      ? active.find(
                          (r) =>
                            r.bay_id === b.id &&
                            toMin(r.start_time) <= nowMin &&
                            nowMin <
                              toMin(r.start_time) + r.duration_hours * 60,
                        )
                      : undefined;
                  const next = active
                    .filter(
                      (r) =>
                        r.bay_id === b.id &&
                        (!nowMin ||
                          date !== todayIso ||
                          toMin(r.start_time) > nowMin),
                    )
                    .sort(
                      (a, c) => toMin(a.start_time) - toMin(c.start_time),
                    )[0];
                  return (
                    <div
                      className="border border-[#c7c7cc] bg-white p-2"
                      key={b.id}
                    >
                      <div className="flex justify-between font-bold">
                        <span>Bay {b.bay_number}</span>
                        <span
                          className={cur ? "text-[#0034c9]" : "text-[#126c31]"}
                        >
                          {cur
                            ? "In use"
                            : (bayState[b.id] ?? "open") === "open"
                              ? "Free"
                              : bayState[b.id]}
                        </span>
                      </div>
                      <p className="mt-1 text-[#5d6673]">
                        {cur
                          ? `${cur.customer_name} until ${fmt12(fromMin(toMin(cur.start_time) + cur.duration_hours * 60))}`
                          : next
                            ? `Next: ${next.customer_name} at ${fmt12(next.start_time)}`
                            : "No more bookings"}
                      </p>
                    </div>
                  );
                })}
                <p className="text-[11px] text-[#5d6673]">
                  Select a booking or an empty slot to edit.
                </p>
              </div>
            ) : (
              <div className="grid gap-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold">
                    {draft.id === undefined
                      ? "New Reservation"
                      : `#${draft.confirmation_code}`}
                  </span>
                  <button
                    aria-label="Close"
                    className="px-2 text-lg leading-none"
                    onClick={() => setDraft(null)}
                  >
                    ×
                  </button>
                </div>
                {draft.id !== undefined && (
                  <span
                    className={`w-fit rounded px-2 py-0.5 font-bold ${STATUS_STYLE[draft.status].box}`}
                  >
                    {STATUS_STYLE[draft.status].label}
                  </span>
                )}

                <label className="grid gap-1">
                  Customer name
                  <input
                    className="border border-[#c7c7cc] bg-white px-2 py-1"
                    id="sim-name"
                    onChange={(e) =>
                      setDraft({ ...draft, customer_name: e.target.value })
                    }
                    placeholder="Last, First"
                    value={draft.customer_name}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1">
                    Phone
                    <input
                      className="border border-[#c7c7cc] bg-white px-2 py-1"
                      id="sim-phone"
                      onChange={(e) =>
                        setDraft({ ...draft, phone: e.target.value })
                      }
                      placeholder="+1 905 …"
                      value={draft.phone}
                    />
                  </label>
                  <label className="grid gap-1">
                    Players
                    <select
                      className="border border-[#c7c7cc] bg-white px-2 py-1"
                      id="sim-players"
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          player_count: Number(e.target.value),
                        })
                      }
                      value={draft.player_count}
                    >
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="grid gap-1">
                  Email
                  <input
                    className="border border-[#c7c7cc] bg-white px-2 py-1"
                    id="sim-email"
                    onChange={(e) =>
                      setDraft({ ...draft, customer_email: e.target.value })
                    }
                    placeholder="optional for walk-ins"
                    value={draft.customer_email}
                  />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="grid gap-1">
                    Bay
                    <select
                      className="border border-[#c7c7cc] bg-white px-1 py-1"
                      id="sim-bay"
                      onChange={(e) =>
                        setDraft({ ...draft, bay_id: Number(e.target.value) })
                      }
                      value={draft.bay_id}
                    >
                      {bays.map((b) => (
                        <option key={b.id} value={b.id}>
                          Bay {b.bay_number}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    Start
                    <select
                      className="border border-[#c7c7cc] bg-white px-1 py-1"
                      id="sim-start"
                      onChange={(e) =>
                        setDraft({ ...draft, start_time: e.target.value })
                      }
                      value={draft.start_time}
                    >
                      {startOptions.map((t) => (
                        <option key={t} value={t}>
                          {fmt12(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    Hours
                    <select
                      className="border border-[#c7c7cc] bg-white px-1 py-1"
                      id="sim-hours"
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          duration_hours: Number(e.target.value),
                        })
                      }
                      value={draft.duration_hours}
                    >
                      {[1, 2, 3, 4].map((n) => (
                        <option disabled={n > draftMaxHours} key={n} value={n}>
                          {n}h
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="grid gap-1">
                  Source
                  <select
                    className="border border-[#c7c7cc] bg-white px-2 py-1"
                    id="sim-source"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        source: e.target.value as ResSource,
                      })
                    }
                    value={draft.source}
                  >
                    <option value="walk_in">Walk-in</option>
                    <option value="phone">Phone</option>
                    <option value="online">Online</option>
                    <option value="voice_ai">AI Call</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  Notes
                  <textarea
                    className="border border-[#c7c7cc] bg-white px-2 py-1"
                    id="sim-notes"
                    onChange={(e) =>
                      setDraft({ ...draft, notes: e.target.value })
                    }
                    rows={2}
                    value={draft.notes}
                  />
                </label>

                <div className="grid gap-1 border border-[#c7c7cc] bg-white p-2">
                  <div className="flex justify-between">
                    <span>
                      Bay {draftBay?.bay_number} · {draft.duration_hours}h ×{" "}
                      {money(draftBay?.hourly_rate ?? 0)}
                    </span>
                    <span>{money(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[#5d6673]">
                    <span>HST 13%</span>
                    <span>{money(subtotal * HST)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1 font-bold">
                    <span>Total</span>
                    <span>{money(subtotal * (1 + HST))}</span>
                  </div>
                  <p className="text-[10px] text-[#5d6673]">
                    {fmt12(draft.start_time)} –{" "}
                    {fmt12(
                      fromMin(
                        toMin(draft.start_time) + draft.duration_hours * 60,
                      ),
                    )}
                  </p>
                </div>

                {draft.id !== undefined && draft.status !== "cancelled" && (
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      className="border border-[#c7c7cc] bg-white px-1 py-1.5 font-bold"
                      onClick={() =>
                        patchReservation(
                          draft.id!,
                          { status: "checked_in" },
                          "Checked in",
                        )
                      }
                    >
                      Check In
                    </button>
                    <button
                      className="bg-[#16a34a] px-1 py-1.5 font-bold text-white"
                      onClick={() =>
                        patchReservation(
                          draft.id!,
                          { status: "paid" },
                          "Marked paid",
                        )
                      }
                    >
                      Paid
                    </button>
                    <button
                      className="border border-[#c47a63] bg-white px-1 py-1.5 font-bold text-[#8a3f26]"
                      onClick={() =>
                        patchReservation(
                          draft.id!,
                          { status: "no_show" },
                          "Marked no-show",
                        )
                      }
                    >
                      No Show
                    </button>
                  </div>
                )}

                <div className="flex gap-2">
                  {draft.id !== undefined &&
                    draft.status !== "cancelled" &&
                    !confirmCancel && (
                      <button
                        className="flex-1 border border-[#c47a63] bg-white px-2 py-2 font-bold text-[#8a3f26]"
                        onClick={() => setConfirmCancel(true)}
                      >
                        Cancel booking
                      </button>
                    )}
                  {confirmCancel && (
                    <button
                      className="flex-1 bg-[#b42318] px-2 py-2 font-bold text-white"
                      onClick={() => {
                        setConfirmCancel(false);
                        patchReservation(
                          draft.id!,
                          { status: "cancelled" },
                          "Booking cancelled",
                        );
                      }}
                    >
                      Confirm cancel
                    </button>
                  )}
                  <button
                    className="flex-1 bg-[#4533ff] px-2 py-2 font-bold text-white"
                    onClick={saveDraft}
                  >
                    {draft.id === undefined ? "Book" : "Save"}
                  </button>
                </div>
                <p className="text-[10px] leading-4 text-[#5d6673]">
                  Policy: free cancellation up to 12h before start · 50% within
                  12h · 100% no-show.
                </p>
              </div>
            )}
          </aside>
        </section>
      </div>
    </AdminShell>
  );
}
