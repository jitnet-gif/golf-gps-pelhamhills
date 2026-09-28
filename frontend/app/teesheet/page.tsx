"use client";

import { useEffect, useMemo, useState } from "react";

type BookingStatus = "reserved" | "checked_in" | "paid" | "cancelled" | "no_show" | "blocked";

type Player = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  type: "Existing Customer" | "Guest";
  ratePlan?: string;
  arrived: boolean;
  paid: boolean;
  cancelled?: boolean;
  no_show?: boolean;
  rateAuto?: boolean;
  paymentStatus?: "link_sent" | "paid" | "member" | "host_link";
};

type BookingSource = "voice_ai" | "web" | "shop";

type VoiceCall = {
  ref: string;
  receivedAt: string;
  duration: string;
  outcome: string;
  summary: string;
  sms: { at: string; label: string; status: string }[];
};

type VoiceHold = {
  id: string;
  time: string;
  dayIndex: number;
  players: number;
  caller: string;
  expiresInSec: number;
};

type TeeBooking = {
  id: string;
  date: string;
  time: string;
  holes: 9 | 18;
  rate: number;
  dayIndex: number;
  span: number;
  color: "blue" | "gold" | "gray" | "ai";
  title: string;
  status: BookingStatus;
  cartCount: number;
  players: Player[];
  audit?: { id: string; ts: string; message: string }[];
  cancelReason?: string | null;
  source?: BookingSource;
  ref?: string;
  phoneE164?: string;
  smsDelivered?: boolean;
  waitlist?: number;
  call?: VoiceCall;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

const days = [
  "Mon 7",
  "Tue 8",
  "Wed 9",
  "Thu 10",
  "Today",
  "Sat 12",
  "Sun 13",
];

const menuLinks = [
  ["Pelham Hills Golf Club", "/"],
  ["Tee Sheet", "/admin"],
  ["Tee Times & Pricing", "/pricing"],
  ["Dynamic Pricing", "/dynamic-pricing"],
  ["Events", "/events"],
  ["Customers", "/customers"],
  ["Tour Operators", "/tour-operators"],
  ["Promotions", "/promotions"],
  ["Calls & SMS", "/calls"],
  ["Reports", "/reports"],
  ["Business Intelligence", "/business-intelligence"],
  ["Radar", "/radar"],
  ["Integrations", "/integrations"],
  ["Settings", "/settings"],
];

const teeTimes = [
  "6:40 AM",
  "6:49 AM",
  "6:58 AM",
  "7:07 AM",
  "7:16 AM",
  "7:25 AM",
  "7:34 AM",
  "7:43 AM",
  "7:52 AM",
  "8:01 AM",
  "8:10 AM",
  "9:00 AM",
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "1:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
  "6:00 PM",
];

const initialBookings: TeeBooking[] = [
  {
    id: "b-predote",
    date: "September 10, 2026",
    time: "6:58 AM",
    holes: 18,
    rate: 47.79,
    dayIndex: 3,
    span: 1,
    color: "gold",
    title: "Predote, Marie",
    status: "reserved",
    cartCount: 2,
    players: [
      { name: "Marie Predote", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart", arrived: false, paid: false },
      { name: "Betty Lou DiMattio", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart", arrived: false, paid: false },
      { name: "Roseann Norton", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart", arrived: false, paid: false },
      { name: "Steve Murphy", email: "", phone: "", type: "Existing Customer", ratePlan: "Full Member - Single with 7 Day Cart", arrived: false, paid: false },
    ],
  },
  {
    id: "b-wheeland",
    date: "September 10, 2026",
    time: "7:07 AM",
    holes: 18,
    rate: 47.79,
    dayIndex: 3,
    span: 1,
    color: "blue",
    title: "Wheeland, Bryan",
    status: "reserved",
    cartCount: 0,
    players: [
      { name: "Bryan Wheeland", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "Alf Wheeland", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart", arrived: false, paid: false },
      { name: "Colin Scott", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "David Neville", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart", arrived: false, paid: false },
    ],
  },
  {
    id: "b-marshall",
    date: "September 10, 2026",
    time: "7:16 AM",
    holes: 18,
    rate: 47.79,
    dayIndex: 3,
    span: 1,
    color: "gold",
    title: "Marshall, Dan",
    status: "reserved",
    cartCount: 1,
    players: [
      { name: "Dan Marshall", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "Leslie Reid", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "Joe Grdovich", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "Peter Catti", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
    ],
  },
  {
    id: "b-nicalou",
    date: "September 10, 2026",
    time: "7:25 AM",
    holes: 18,
    rate: 47.79,
    dayIndex: 3,
    span: 1,
    color: "blue",
    title: "Nicalou, Chris",
    status: "reserved",
    cartCount: 1,
    players: [
      { name: "Chris Nicalou", email: "", phone: "", type: "Existing Customer", ratePlan: "Full Member - Single with 7 Day Cart", arrived: false, paid: false },
      { name: "Triada Nicolou", email: "", phone: "", type: "Existing Customer", ratePlan: "Full Member - Single with 7 Day Cart", arrived: false, paid: false },
    ],
  },
  {
    id: "b-carlsson",
    date: "September 10, 2026",
    time: "8:01 AM",
    holes: 18,
    rate: 47.79,
    dayIndex: 3,
    span: 1,
    color: "gold",
    title: "Carlsson, James",
    status: "reserved",
    cartCount: 0,
    players: [
      { name: "James Carlsson", email: "", phone: "", type: "Existing Customer", ratePlan: "GolfNow", arrived: false, paid: false },
      { name: "Guest", email: "", phone: "", type: "Guest", ratePlan: "GolfNow", arrived: false, paid: false },
      { name: "Guest", email: "", phone: "", type: "Guest", ratePlan: "GolfNow", arrived: false, paid: false },
    ],
  },
  {
    id: "b-costea",
    date: "September 10, 2026",
    time: "8:10 AM",
    holes: 18,
    rate: 47.79,
    dayIndex: 3,
    span: 1,
    color: "blue",
    title: "Costea, Rick",
    status: "reserved",
    cartCount: 2,
    players: [
      { name: "Rick Costea", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "Rudy Videchak", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "Roger Denis", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
    ],
  },
  {
    id: "b-sep11-predote",
    date: "September 11, 2026",
    time: "6:58 AM",
    holes: 18,
    rate: 58.41,
    dayIndex: 4,
    span: 1,
    color: "gold",
    title: "Predote, Marie",
    status: "reserved",
    cartCount: 2,
    players: [
      { name: "Marie Predote", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart", arrived: false, paid: false },
      { name: "Roseann Norton", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart", arrived: false, paid: false },
      { name: "Betty Lou DiMattio", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart", arrived: false, paid: false },
      { name: "Steve Murphy", email: "", phone: "", type: "Existing Customer", ratePlan: "Full Member - Single with 7 Day Cart", arrived: false, paid: false },
    ],
  },
  {
    id: "b-sep11-marshall",
    date: "September 11, 2026",
    time: "7:07 AM",
    holes: 18,
    rate: 58.41,
    dayIndex: 4,
    span: 1,
    color: "blue",
    title: "Marshall, Dan",
    status: "reserved",
    cartCount: 1,
    players: [
      { name: "Dan Marshall", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "Colin Scott", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "David Neville", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single with Weekday Cart", arrived: false, paid: false },
      { name: "Guest", email: "", phone: "", type: "Guest", ratePlan: "Public", arrived: false, paid: false },
    ],
  },
  {
    id: "b-sep11-nicalou",
    date: "September 11, 2026",
    time: "7:16 AM",
    holes: 18,
    rate: 58.41,
    dayIndex: 4,
    span: 1,
    color: "gold",
    title: "Nicalou, Chris",
    status: "reserved",
    cartCount: 1,
    players: [
      { name: "Chris Nicalou", email: "", phone: "", type: "Existing Customer", ratePlan: "Full Member - Single with 7 Day Cart", arrived: false, paid: false },
      { name: "Triada Nicolou", email: "", phone: "", type: "Existing Customer", ratePlan: "Full Member - Single with 7 Day Cart", arrived: false, paid: false },
    ],
  },
  {
    id: "b-sep11-kicul",
    date: "September 11, 2026",
    time: "7:25 AM",
    holes: 18,
    rate: 58.41,
    dayIndex: 4,
    span: 1,
    color: "blue",
    title: "Kicul, Marty",
    status: "reserved",
    cartCount: 0,
    players: [
      { name: "Marty Kicul", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "Wayne Armstrong", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "David Kaufmann", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
    ],
  },
  {
    id: "b-sep11-buckley",
    date: "September 11, 2026",
    time: "7:34 AM",
    holes: 18,
    rate: 58.41,
    dayIndex: 4,
    span: 1,
    color: "gold",
    title: "buckley, jami",
    status: "reserved",
    cartCount: 2,
    waitlist: 2,
    players: [
      { name: "Jami Buckley", email: "", phone: "", type: "Existing Customer", ratePlan: "Public", arrived: false, paid: false },
      { name: "Guest", email: "", phone: "", type: "Guest", ratePlan: "Public", arrived: false, paid: false },
      { name: "Guest", email: "", phone: "", type: "Guest", ratePlan: "Public", arrived: false, paid: false },
      { name: "Guest", email: "", phone: "", type: "Guest", ratePlan: "Public", arrived: false, paid: false },
    ],
  },
  {
    id: "b-sep11-unrau",
    date: "September 11, 2026",
    time: "7:43 AM",
    holes: 18,
    rate: 58.41,
    dayIndex: 4,
    span: 1,
    color: "blue",
    title: "Unrau, Ruth",
    status: "reserved",
    cartCount: 1,
    players: [
      { name: "Ruth Unrau", email: "", phone: "", type: "Existing Customer", ratePlan: "Public Senior", arrived: false, paid: false },
      { name: "Guest", email: "", phone: "", type: "Guest", ratePlan: "Public Senior", arrived: false, paid: false },
    ],
  },
  {
    id: "b-sep11-costea",
    date: "September 11, 2026",
    time: "8:10 AM",
    holes: 18,
    rate: 58.41,
    dayIndex: 4,
    span: 1,
    color: "gold",
    title: "Costea, Rick",
    status: "reserved",
    cartCount: 2,
    players: [
      { name: "Rick Costea", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "Rudy Videchak", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
      { name: "Roger Denis", email: "", phone: "", type: "Existing Customer", ratePlan: "Weekday Member - Single", arrived: false, paid: false },
    ],
  },
  {
    id: "b-sep11-kim-ai",
    date: "September 11, 2026",
    time: "7:52 AM",
    holes: 18,
    rate: 58.41,
    dayIndex: 4,
    span: 1,
    color: "ai",
    title: "Kim, Daniel",
    status: "reserved",
    cartCount: 2,
    source: "voice_ai",
    ref: "PH-10392",
    phoneE164: "+1 905-562-7189",
    smsDelivered: true,
    players: [
      { name: "Daniel Kim", email: "", phone: "+1 905-562-7189", type: "Existing Customer", ratePlan: "Public", rateAuto: true, paymentStatus: "link_sent", arrived: false, paid: false },
      { name: "Guest", email: "", phone: "", type: "Guest", ratePlan: "Public", paymentStatus: "host_link", arrived: false, paid: false },
      { name: "Guest", email: "", phone: "", type: "Guest", ratePlan: "Public", paymentStatus: "host_link", arrived: false, paid: false },
      { name: "Guest", email: "", phone: "", type: "Guest", ratePlan: "Public", paymentStatus: "host_link", arrived: false, paid: false },
    ],
    call: {
      ref: "PH-10392",
      receivedAt: "09/11 06:42 AM",
      duration: "1분 34초",
      outcome: "예약 완료",
      summary: "오전 4인 18홀 요청. 8:01 제안 → 고객이 7:52 선택. 카트 2대 원함(Half Cart 체크 필요). 게스트 3명 이름 미정.",
      sms: [
        { at: "06:44", label: "확정 문자", status: "delivered" },
        { at: "06:44", label: "결제 링크", status: "delivered" },
        { at: "05:52", label: "2시간 전 리마인더", status: "예정" },
      ],
    },
  },
];

const sampleHolds: VoiceHold[] = [
  { id: "hold-1", time: "8:01 AM", dayIndex: 4, players: 4, caller: "+1 905-***-7189", expiresInSec: 221 },
];

const sampleVoiceStats = { calls: 12, booked: 7, transferred: 2 };

function bookingColor(color: TeeBooking["color"]) {
  if (color === "ai") return "bg-[#d9d0ff] text-[#2a1d7a]";
  if (color === "blue") return "bg-[#0034c9] text-white";
  if (color === "gray") return "bg-[#ececf0] text-[#4e5560]";
  return "bg-[#ffd400] text-[#1d232b]";
}

function statusLabel(status: BookingStatus) {
  if (status === "checked_in") return "Arrived";
  if (status === "paid") return "Paid";
  if (status === "cancelled") return "Cancelled";
  if (status === "no_show") return "No Show";
  if (status === "blocked") return "Blocked";
  return "Reserved";
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

function sourceLabel(source?: BookingSource) {
  if (source === "voice_ai") return "AI CALL";
  if (source === "web") return "WEB";
  return "SHOP";
}

function paymentLabel(player: Player) {
  if (player.paid || player.paymentStatus === "paid") return { text: "결제 완료", cls: "border-[#1f9d55] bg-[#e6f5ec] text-[#1f7a45]" };
  if (player.paymentStatus === "member") return { text: "회원 · 결제 없음", cls: "border-[#1f9d55] bg-[#e6f5ec] text-[#1f7a45]" };
  if (player.paymentStatus === "link_sent") return { text: "링크 발송 · 미결제", cls: "border-dashed border-[#e0a24a] bg-[#fff4e0] text-[#a15c00]" };
  if (player.paymentStatus === "host_link") return { text: "호스트 링크에 포함", cls: "border-dashed border-[#e0a24a] bg-[#fff4e0] text-[#a15c00]" };
  return null;
}

function mmss(sec: number) {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function TeeSheetPage() {
  const [bookings, setBookings] = useState<TeeBooking[]>(initialBookings);
  const [selectedId, setSelectedId] = useState("b-sep11-kim-ai");
  const [view, setView] = useState<"week" | "day">("week");
  const [apiOnline, setApiOnline] = useState(false);
  const [message, setMessage] = useState("Local sample mode");
  const [holds, setHolds] = useState<VoiceHold[]>(sampleHolds);
  const [voiceStats, setVoiceStats] = useState(sampleVoiceStats);
  const [showCall, setShowCall] = useState(true);
  const selected = useMemo(
    () => bookings.find((booking) => booking.id === selectedId) ?? bookings[0],
    [bookings, selectedId],
  );

  const totalPlayers = bookings.reduce((sum, booking) => sum + booking.players.length, 0);
  const checkedIn = bookings.reduce(
    (sum, booking) => sum + booking.players.filter((player) => player.arrived).length,
    0,
  );
  const carts = bookings.reduce((sum, booking) => sum + booking.cartCount, 0);

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      ...init,
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json() as Promise<T>;
  }

  function replaceBooking(next: TeeBooking) {
    setBookings((current) => current.map((booking) => (booking.id === next.id ? next : booking)));
    setSelectedId(next.id);
  }

  useEffect(() => {
    request<TeeBooking[]>("/tee-sheet/bookings")
      .then((data) => {
        setBookings(data);
        setSelectedId(data.find((booking) => booking.id === "b-sep11-predote")?.id ?? data[0]?.id ?? initialBookings[0].id);
        setApiOnline(true);
        setMessage("Connected to FastAPI tee sheet service");
      })
      .catch(() => {
        setApiOnline(false);
        setMessage("FastAPI offline: using local sample mode");
      });

    request<{ calls?: number; booked?: number; transferred?: number }>("/voice/stats")
      .then((data) =>
        setVoiceStats({
          calls: data.calls ?? sampleVoiceStats.calls,
          booked: data.booked ?? sampleVoiceStats.booked,
          transferred: data.transferred ?? sampleVoiceStats.transferred,
        }),
      )
      .catch(() => undefined);
  }, []);

  // HOLD countdown: expired holds return the slot to open (+)
  useEffect(() => {
    const timer = window.setInterval(() => {
      setHolds((current) =>
        current.map((hold) => ({ ...hold, expiresInSec: hold.expiresInSec - 1 })).filter((hold) => hold.expiresInSec > 0),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const payAllTotal = selected ? selected.rate * selected.players.filter((p) => !p.paid).length * 1.13 : 0;

  function sendPaymentLink() {
    setBookings((current) =>
      current.map((booking) =>
        booking.id === selected.id
          ? {
              ...booking,
              players: booking.players.map((player, index) =>
                player.paid ? player : { ...player, paymentStatus: index === 0 ? "link_sent" : "host_link" },
              ),
            }
          : booking,
      ),
    );
    setMessage(`결제 링크 SMS 발송 (샘플) · ${money(payAllTotal)}`);
  }

  async function updateBookingStatus(status: BookingStatus, cancelReason?: string) {
    if (apiOnline) {
      const next = await request<TeeBooking>(`/tee-sheet/bookings/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, cancelReason }),
      });
      replaceBooking(next);
      return;
    }

    setBookings((current) =>
      current.map((booking) =>
        booking.id === selected.id
          ? {
              ...booking,
              status,
              players: booking.players.map((player) => ({
                ...player,
                arrived: status === "checked_in" || status === "paid" ? true : player.arrived,
                paid: status === "paid" ? true : player.paid,
              })),
            }
          : booking,
      ),
    );
  }

  async function addGuest() {
    if (selected.players.length >= 4) {
      setMessage("A tee time can contain at most 4 players.");
      return;
    }

    if (apiOnline) {
      const next = await request<TeeBooking>(`/tee-sheet/bookings/${selected.id}/players`, {
        method: "POST",
        body: JSON.stringify({ name: "Guest", type: "Guest" }),
      });
      replaceBooking(next);
      return;
    }

    setBookings((current) =>
      current.map((booking) =>
        booking.id === selected.id && booking.players.length < 4
          ? {
              ...booking,
              players: [
                ...booking.players,
                {
                  name: "Guest",
                  email: "",
                  phone: "",
                  type: "Guest",
                  arrived: false,
                  paid: false,
                },
              ],
            }
          : booking,
      ),
    );
  }

  async function removePlayer(playerIndex: number) {
    const player = selected.players[playerIndex];
    if (selected.players.length <= 1) {
      setMessage("A reservation must keep at least one player.");
      return;
    }

    if (apiOnline && player.id) {
      const next = await request<TeeBooking>(`/tee-sheet/bookings/${selected.id}/players/${player.id}`, {
        method: "DELETE",
      });
      replaceBooking(next);
      return;
    }

    setBookings((current) =>
      current.map((booking) =>
        booking.id === selected.id
          ? { ...booking, players: booking.players.filter((_, index) => index !== playerIndex) }
          : booking,
      ),
    );
  }

  async function updatePlayer(playerIndex: number, patch: Partial<Player>) {
    const player = selected.players[playerIndex];
    if (apiOnline && player.id) {
      const next = await request<TeeBooking>(`/tee-sheet/bookings/${selected.id}/players/${player.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      replaceBooking(next);
      return;
    }

    setBookings((current) =>
      current.map((booking) =>
        booking.id === selected.id
          ? {
              ...booking,
              players: booking.players.map((item, index) =>
                index === playerIndex ? { ...item, ...patch } : item,
              ),
            }
          : booking,
      ),
    );
  }

  function cancelReservation() {
    const reason = window.prompt("취소 사유를 입력하세요.", "Cancelled by pro shop.");
    if (reason === null) return;
    updateBookingStatus("cancelled", reason || "Cancelled by pro shop.");
  }

  return (
    <main className="min-h-screen bg-[#f2f2f4] text-[#1f2328]">
      <div className="grid min-h-screen lg:grid-cols-[148px_1fr]">
        <aside className="hidden bg-[#111315] text-white lg:block">
          <div className="border-b border-white/10 px-4 py-4 text-sm font-bold">lightspeed</div>
          <nav className="grid gap-1 px-2 py-3 text-xs">
            {menuLinks.map(([item, href]) => (
              <a
                className={`px-3 py-2 font-semibold ${item === "Tee Sheet" ? "bg-[#4533ff]" : "hover:bg-white/10"}`}
                href={href}
                key={item}
              >
                {item}
              </a>
            ))}
          </nav>
          <div className="mx-3 mt-4 bg-[#fffbd5] p-3 text-[11px] leading-5 text-[#2f2f21]">
            <p className="font-bold">Note</p>
            <p>John&apos;s Mobile #: 905-512-8755</p>
            <p>Login: Chronogolf</p>
            <p>Course: Pelham Hills</p>
          </div>
        </aside>

        <section className="grid min-w-0 grid-rows-[auto_auto_1fr_auto]">
          <header className="flex items-center justify-between border-b border-[#d4d4d8] bg-white px-4 py-3">
            <div className="flex items-center gap-3">
              <button className="text-xl text-[#6b7280]">☰</button>
              <a className="text-sm font-bold" href="/admin">
                Tee Sheet
              </a>
            </div>
            <div className="flex items-center gap-2">
              <a className="border border-[#d7d7dc] px-3 py-1.5 text-xs font-bold" href="/booking">
                Booking
              </a>
              <button className="bg-[#4533ff] px-4 py-1.5 text-xs font-bold text-white">Add +</button>
            </div>
          </header>

          <section className="border-b border-[#d4d4d8] bg-white px-4 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span>☀ 23°</span>
                <span>♨ 6:45 AM</span>
                <span>☾ 7:46 PM</span>
                <span className="rounded bg-[#111315] px-2 py-1 text-white">{bookings.length} Reservations</span>
                <span>{totalPlayers} Players</span>
                <span>{checkedIn} Arrived</span>
                <span>{carts} Carts</span>
                <a
                  className="rounded border border-dashed border-[#8f76ff] bg-[#efeaff] px-2 py-1 font-bold text-[#4b32d6]"
                  href="/calls"
                  title="오늘 AI 통화 / 예약 성사 / 직원 연결"
                >
                  ☎ AI {voiceStats.calls} · 예약 {voiceStats.booked} · 연결 {voiceStats.transferred}
                </a>
                <span className={`rounded px-2 py-1 ${apiOnline ? "bg-[#dbf5e3] text-[#126c31]" : "bg-[#fff3cd] text-[#8a5b00]"}`}>
                  {message}
                </span>
              </div>
              <div className="text-center">
                <p className="text-3xl font-semibold leading-none">11</p>
                <p className="text-xs font-semibold">Friday · Sep 2026</p>
              </div>
              <div className="flex gap-2">
                <button
                  className={`border px-3 py-1.5 text-xs font-bold ${view === "week" ? "bg-[#4533ff] text-white" : "bg-white"}`}
                  onClick={() => setView("week")}
                >
                  Week
                </button>
                <button
                  className={`border px-3 py-1.5 text-xs font-bold ${view === "day" ? "bg-[#4533ff] text-white" : "bg-white"}`}
                  onClick={() => setView("day")}
                >
                  Day
                </button>
              </div>
            </div>
          </section>

          <section className="min-w-0 overflow-auto p-4">
            <div className="min-w-[1050px] rounded border border-[#d6d6dc] bg-white">
              <div className="grid grid-cols-[86px_48px_repeat(7,minmax(120px,1fr))_64px] border-b border-[#d6d6dc] bg-[#d7d5da] text-center text-xs font-bold">
                <div className="p-2 text-left">Time</div>
                <div className="p-2">Rate</div>
                {days.map((day) => (
                  <div className={`p-2 ${day === "Today" ? "bg-[#4533ff] text-white" : ""}`} key={day}>
                    {day}
                  </div>
                ))}
                <div className="p-2">Cart</div>
              </div>

              <div className="relative">
                {teeTimes.map((time) => (
                  <div
                    className="grid min-h-[29px] grid-cols-[86px_48px_repeat(7,minmax(120px,1fr))_64px] border-b border-[#ececf0] text-xs last:border-b-0"
                    key={time}
                  >
                    <div className="flex items-center px-2 font-semibold">{time}</div>
                    <div className="flex items-center justify-center text-[#9aa0a6]">$47.79</div>
                    {days.map((day) => (
                      <div className="border-l border-[#ececf0]" key={`${time}-${day}`} />
                    ))}
                    <div className="flex items-center justify-center gap-1 border-l border-[#ececf0] text-[#3f4650]">
                      🚗 <span>2</span>
                    </div>
                  </div>
                ))}

                <div className="pointer-events-none absolute inset-0">
                  {bookings.map((booking) => {
                    const row = teeTimes.indexOf(booking.time);
                    if (row < 0) return null;
                    return (
                      <button
                        className={`pointer-events-auto absolute h-[18px] overflow-hidden rounded-sm px-2 text-left text-[11px] font-bold leading-[18px] shadow-sm ${bookingColor(booking.color)} ${
                          selected.id === booking.id ? "ring-2 ring-[#111315]" : ""
                        }`}
                        key={booking.id}
                        onClick={() => setSelectedId(booking.id)}
                        style={{
                          top: row * 29 + 6,
                          left: 86 + 48 + booking.dayIndex * 121 + 4,
                          width: Math.max(112, booking.span * 121 - 8),
                        }}
                      >
                        {booking.source === "voice_ai" && (
                          <span className="mr-1 rounded-sm bg-[#5a3ff0] px-1 text-[9px] text-white">AI</span>
                        )}
                        ● {booking.title}
                        {booking.players.length > 1 ? "   ● Guest" : ""}
                        {booking.source === "voice_ai" && (
                          <span
                            className={`absolute right-1 top-[2px] rounded-sm px-1 text-[9px] leading-[14px] text-white ${
                              booking.smsDelivered ? "bg-[#1f9d55]" : "bg-[#c0392b]"
                            }`}
                          >
                            SMS {booking.smsDelivered ? "✓" : "✕"}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {bookings
                    .filter((booking) => booking.waitlist)
                    .map((booking) => {
                      const row = teeTimes.indexOf(booking.time);
                      if (row < 0) return null;
                      return (
                        <span
                          className="absolute rounded-sm border border-[#5a3ff0] bg-white px-1 text-[9px] font-bold leading-[14px] text-[#5a3ff0]"
                          key={`wl-${booking.id}`}
                          style={{ top: row * 29 + 8, left: 86 + 48 + (booking.dayIndex + 1) * 121 - 44 }}
                          title="AI가 받은 대기 요청 수"
                        >
                          대기 {booking.waitlist}
                        </span>
                      );
                    })}

                  {holds.map((hold) => {
                    const row = teeTimes.indexOf(hold.time);
                    if (row < 0) return null;
                    return (
                      <div
                        className="pointer-events-auto absolute h-[18px] overflow-hidden rounded-sm px-2 text-[11px] font-bold leading-[18px] text-[#9a3d10]"
                        key={hold.id}
                        onClick={() => setMessage("AI 통화 중 확보된 슬롯입니다. 만료 후 예약 가능합니다.")}
                        style={{
                          top: row * 29 + 6,
                          left: 86 + 48 + hold.dayIndex * 121 + 4,
                          width: 113,
                          background: "repeating-linear-gradient(135deg,#ffe1cc 0 8px,#fff1e6 8px 16px)",
                        }}
                        title={`HOLD · AI 통화 중 · ${hold.players}명 · ${hold.caller}`}
                      >
                        HOLD {mmss(hold.expiresInSec)} · {hold.players}명
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {selected && (
            <section className="border-t border-[#d4d4d8] bg-[#dedee2] px-4 py-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold">● {selected.id.toUpperCase().slice(0, 10)}</span>
                  <span className="rounded border border-[#c7c7cc] bg-white px-2 py-1">{selected.holes} holes</span>
                  <span className="rounded border border-[#c7c7cc] bg-white px-2 py-1">{selected.date}</span>
                  <span className="rounded border border-[#c7c7cc] bg-white px-2 py-1">{selected.time}</span>
                  <span className="rounded border border-[#c7c7cc] bg-white px-2 py-1">{statusLabel(selected.status)}</span>
                  {selected.phoneE164 && (
                    <span className="rounded border border-[#1f9d55] bg-white px-2 py-1" title="E.164 정규화 번호">
                      ☎ {selected.phoneE164} <b className="text-[#1f9d55]">✓ SMS</b>
                    </span>
                  )}
                  <span className="rounded border-[1.5px] border-[#5a3ff0] bg-white px-2 py-1 font-bold text-[#5a3ff0]">
                    Pay all ({selected.players.filter((p) => !p.paid).length}) {money(payAllTotal)}
                  </span>
                  <button
                    className="rounded border-[1.5px] border-dashed border-[#8f76ff] bg-[#efeaff] px-2 py-1 font-bold text-[#4b32d6]"
                    onClick={sendPaymentLink}
                  >
                    결제 링크 SMS
                  </button>
                  <span
                    className={`rounded px-2 py-1 font-bold ${
                      selected.source === "voice_ai" ? "bg-[#5a3ff0] text-white" : "border border-[#c7c7cc] bg-white text-[#4e5560]"
                    }`}
                  >
                    {sourceLabel(selected.source)}
                    {selected.ref ? ` · ${selected.ref}` : ""}
                  </span>
                  {selected.call && (
                    <button
                      className={`rounded border-[1.5px] px-2 py-1 font-bold ${
                        showCall ? "border-[#5a3ff0] bg-[#d9d0ff] text-[#2a1d7a]" : "border-dashed border-[#8f76ff] bg-white text-[#4b32d6]"
                      }`}
                      onClick={() => setShowCall((value) => !value)}
                      title="통화 요약 · 녹취 · 문자 이력"
                    >
                      ☎ 통화
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="border border-[#c47a63] bg-white px-4 py-2 text-xs font-bold text-[#8a3f26]" onClick={cancelReservation}>
                    Cancel Reservation
                  </button>
                  <button className="bg-[#4533ff] px-5 py-2 text-xs font-bold text-white" onClick={() => updateBookingStatus(selected.status)}>
                    Save
                  </button>
                </div>
              </div>

              <div className="flex gap-3 overflow-x-auto">
                {selected.players.map((player, index) => (
                  <article className="w-[150px] shrink-0 border border-[#c7c7cc] bg-white p-2 text-xs" key={`${selected.id}-${index}-${player.name}`}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-bold">{player.type}</span>
                      <button className="text-[#8a3f26]" onClick={() => removePlayer(index)} title="Remove player">
                        ×
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <label>
                        Last Name
                        <input className="mt-1 w-full border-b border-[#d7d7dc] px-1 py-1" value={player.name.split(" ").slice(-1)[0]} readOnly />
                      </label>
                      <label>
                        First Name
                        <input className="mt-1 w-full border-b border-[#d7d7dc] px-1 py-1" value={player.name.split(" ")[0]} readOnly />
                      </label>
                    </div>
                    <p className="mt-2 truncate">{player.phone || "Phone"}</p>
                    <p className="truncate">{player.email || "Email"}</p>
                    <button
                      className={`mt-2 w-full border px-2 py-1 font-bold ${
                        player.arrived ? "border-[#168a3c] bg-[#ecfff1] text-[#168a3c]" : "border-[#d7d7dc]"
                      }`}
                      onClick={() => updatePlayer(index, { arrived: !player.arrived })}
                    >
                      {player.arrived ? "Arrived" : "Check In"}
                    </button>
                    <button
                      className={`mt-2 w-full border px-2 py-1 font-bold ${
                        player.no_show ? "border-[#8a3f26] bg-[#fff1ee] text-[#8a3f26]" : "border-[#d7d7dc]"
                      }`}
                      onClick={() => updatePlayer(index, { no_show: !player.no_show })}
                    >
                      {player.no_show ? "No Show" : "Mark No Show"}
                    </button>
                    <div
                      className={`mt-2 flex justify-between p-1 ${
                        player.rateAuto ? "border-[1.5px] border-dashed border-[#8f76ff] bg-[#f6f3ff] text-[#4b32d6]" : "bg-[#ffe5e2] text-[#9e2f20]"
                      }`}
                      title={player.rateAuto ? "AI가 발신번호·회원번호로 자동 선택 — 확인 필요" : undefined}
                    >
                      <span>{player.ratePlan ?? "Public"}</span>
                      {player.rateAuto && <b>AI</b>}
                    </div>
                    <div className="mt-2 flex justify-between">
                      <span>{selected.holes} Hole Gr.</span>
                      <span>{money(selected.rate)}</span>
                    </div>
                    <div className="mt-2 flex justify-between border-t pt-2 font-bold">
                      <span>Subtotal Due</span>
                      <span>{player.paid ? "$0.00" : money(selected.rate)}</span>
                    </div>
                    {(() => {
                      const pay = paymentLabel(player);
                      return pay ? <div className={`mt-2 border px-1 py-1 text-center text-[10.5px] font-bold ${pay.cls}`}>{pay.text}</div> : null;
                    })()}
                    <button
                      className={`mt-2 w-full px-2 py-1 font-bold text-white ${player.paid ? "bg-[#8c7cf6]" : "bg-[#b1a8ff]"}`}
                      onClick={() => updatePlayer(index, { paid: !player.paid })}
                    >
                      {player.paid ? "Paid" : "Collect"}
                    </button>
                  </article>
                ))}

                <button
                  className="grid h-[204px] w-[150px] shrink-0 place-items-center rounded border border-dashed border-[#aeb2bb] bg-[#d5d5da] text-4xl text-[#9297a1]"
                  onClick={addGuest}
                >
                  +
                </button>

                {selected.call && showCall && (
                  <aside className="grid w-[250px] shrink-0 content-start gap-2 border-[1.5px] border-dashed border-[#8f76ff] bg-white p-3 text-xs">
                    <h4 className="font-bold text-[#4b32d6]">☎ 통화 기록 · {selected.call.ref}</h4>
                    <div className="flex justify-between text-[#555]"><span>수신</span><span>{selected.call.receivedAt}</span></div>
                    <div className="flex justify-between text-[#555]"><span>길이</span><span>{selected.call.duration}</span></div>
                    <div className="flex justify-between text-[#555]">
                      <span>결과</span>
                      <b className="text-[#1f7a45]">{selected.call.outcome}</b>
                    </div>
                    <p className="rounded bg-[#f6f3ff] p-2 leading-5 text-[#333]">{selected.call.summary}</p>
                    <button className="border border-[#cfd3da] px-2 py-1" onClick={() => setMessage("녹취 재생은 ElevenLabs 연동 후 활성화됩니다.")}>
                      ▶ 녹취 재생 · 전문 보기
                    </button>
                    <div className="grid gap-1 text-[10.5px] text-[#555]">
                      <b>SMS</b>
                      {selected.call.sms.map((sms) => (
                        <span key={`${sms.at}-${sms.label}`}>
                          {sms.at} {sms.label} · {sms.status}
                        </span>
                      ))}
                    </div>
                  </aside>
                )}
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
