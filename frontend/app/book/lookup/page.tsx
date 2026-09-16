"use client";

/**
 * 확인 코드로 예약 찾기.
 *
 * ## 왜 페이지가 얇은 래퍼인가
 * `useSearchParams()` 를 쓰는 컴포넌트는 반드시 `<Suspense>` 안에 있어야 한다.
 * 없으면 `next build` 가 "useSearchParams() should be wrapped in a suspense
 * boundary" 로 **빌드 자체를 실패**시킨다(정적 export 라 더 그렇다). 그래서 실제
 * 내용은 `LookupPanel` 로 빼고 이 페이지는 경계만 친다.
 *
 * ## 조회할 수 있는 것과 없는 것
 * 실내 골프(시뮬레이터)는 Supabase 함수 `pelham_sim_lookup` 으로 찾는다(`lib/booking/rpc.ts`).
 * 코드가 맞는 예약 한 건만 돌아오고, 없으면 null 이다.
 * **티타임에는 조회 엔드포인트가 없다.** 예약 응답이 돌려주는 것은 UUID `id`
 * 뿐이고 확인 코드라는 개념 자체가 없다. 없는 기능을 있는 척 흉내내면 손님은
 * 코드를 계속 다시 쳐 보다가 포기한다. 그래서 UUID 모양이 들어오면 정직하게
 * "티타임 조회는 준비 중" 이라고 말하고 전화로 착지시킨다.
 */

// `useSearchParams` 는 아래 `LookupPanel` 에서만 쓴다 — 반드시 Suspense 경계 안쪽이다.
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import BookingShell from "@/components/booking/BookingShell";
import { formatLongDate } from "@/components/booking/availability";
import { NO_API_MESSAGE } from "@/lib/apiHost";
import { bookingConfigured, bookingRpc } from "@/lib/booking/rpc";
import { ApiError } from "@/lib/teeSheet/api";
import { CLUB } from "@/lib/nav";

export default function LookupPage() {
  return (
    <BookingShell
      subtitle="Enter the confirmation code you got when you booked."
      title="My Booking"
    >
      <Suspense fallback={<PanelSkeleton />}>
        <LookupPanel />
      </Suspense>
    </BookingShell>
  );
}

function PanelSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3">
      <div className="h-28 animate-pulse rounded-sm border border-[#e2ddd0] bg-[#efece3]" />
      <div className="h-40 animate-pulse rounded-sm border border-[#e2ddd0] bg-[#efece3]" />
    </div>
  );
}

type SimulatorReservation = {
  id: number;
  confirmation_code: string;
  bay_type: string;
  bay_number: number | null;
  date: string;
  start_time: string;
  duration_hours: number;
  player_count: number;
  customer_name: string;
  customer_email: string;
  total_price: number | null;
  status: string;
  created_at: string;
};

/** 시뮬레이터 확인 코드는 `secrets.token_hex(5).upper()` — 16진수 10자다. */
const SIM_CODE = /^[0-9a-f]{10}$/i;
/** 티타임 예약이 돌려주는 것은 UUID `id` 하나뿐이다(확인 코드가 없다). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 서버 주소는 문구에 넣지 않는다. 방문자에게 우리 호스트를 알려 줄 이유가 없다. */
function networkMessage(err: unknown, action: string): string {
  if ((err instanceof ApiError && err.status === 0) || err instanceof TypeError) {
    return `Could not reach the booking server. ${action} Please try again in a moment, or call ${CLUB.phone}.`;
  }
  return err instanceof Error && err.message ? err.message : action;
}

function LookupPanel() {
  const params = useSearchParams();
  const prefill = params.get("code") ?? "";

  const [code, setCode] = useState(prefill);
  /** 온라인 조회를 열 수 있는가. `null` 은 "아직 모름"(마운트 전). */
  const [bookingReady, setBookingReady] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** 티타임처럼 **조회 자체가 없는** 경우. 오류가 아니라 안내다. */
  const [teeTimeNotice, setTeeTimeNotice] = useState(false);
  const [found, setFound] = useState<SimulatorReservation | null>(null);

  useEffect(() => {
    setBookingReady(bookingConfigured());
  }, []);

  const lookup = useCallback(
    async (raw: string) => {
      const wanted = raw.trim();
      if (!wanted) return;

      setFound(null);
      setError("");
      setTeeTimeNotice(false);

      // 티타임 예약 번호(UUID)는 조회할 곳이 없다. 요청을 보내 봐야 404 이고,
      // 그러면 손님은 "코드를 잘못 쳤나" 하고 계속 다시 친다.
      if (UUID.test(wanted)) {
        setTeeTimeNotice(true);
        return;
      }

      if (!bookingReady) {
        setError(NO_API_MESSAGE);
        return;
      }

      setLoading(true);
      try {
        const reservation = await bookingRpc<SimulatorReservation | null>("pelham_sim_lookup", {
          p_code: wanted,
        });
        if (!reservation) {
          setError(
            "We could not find a booking with that code. Check the code shown when you booked, or call the pro shop.",
          );
          return;
        }
        setFound(reservation);
      } catch (err) {
        setError(networkMessage(err, "Your booking could not be loaded."));
      } finally {
        setLoading(false);
      }
    },
    [bookingReady],
  );

  // `?code=` 로 들어온 링크는 손님이 다시 누를 필요 없이 바로 찾아 준다.
  // 예약을 열 수 있는지 알게 된 뒤에 한 번만 돈다.
  //
  // `attempted` 가드가 없으면 같은 코드로 요청이 반복된다: `lookup` 은 진입하자마자
  // setState 를 여러 번 하고, 그 렌더로 `lookup` 자체가 다시 만들어지면 이 이펙트가
  // 또 돈다. 코드가 틀렸을 때(404) 특히 잘 드러난다 — 서버를 계속 두드린다.
  const attempted = useRef<string | null>(null);
  useEffect(() => {
    if (bookingReady === null) return;
    if (!prefill) return;
    if (attempted.current === prefill) return;
    attempted.current = prefill;
    void lookup(prefill);
  }, [bookingReady, prefill, lookup]);

  const offline = bookingReady === false;

  return (
    <div className="min-w-0">
      <form
        className="rounded-sm border border-[#d8d1c3] bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup(code);
        }}
      >
        <label className="mb-2 block text-sm font-semibold text-[#3d453d]" htmlFor="lookup-code">
          Confirmation code
        </label>
        <input
          autoCapitalize="characters"
          autoCorrect="off"
          className="w-full rounded-sm border border-[#d8d1c3] px-4 py-3 text-base uppercase tracking-widest"
          id="lookup-code"
          onChange={(event) => setCode(event.target.value)}
          placeholder="A1B2C3D4E5"
          spellCheck={false}
          type="text"
          value={code}
        />
        <p className="mt-2 text-xs text-[#5c6459]">
          Indoor golf codes are 10 characters and are shown on screen when you book.
        </p>

        <button
          className={`tap-target mt-4 w-full rounded-sm py-3 text-base font-bold text-white transition ${
            code.trim() && !loading
              ? "bg-[#214d2f] hover:bg-[#163820]"
              : "cursor-not-allowed bg-[#a9b0a6]"
          }`}
          disabled={!code.trim() || loading}
          type="submit"
        >
          {loading ? "Looking…" : "Find my booking"}
        </button>

        {code.trim() && !SIM_CODE.test(code.trim()) && !UUID.test(code.trim()) ? (
          <p className="mt-3 text-sm text-[#8a6f30]">
            That does not look like an indoor golf code — they are 10 letters and numbers.
          </p>
        ) : null}
      </form>

      {offline ? (
        <Notice tone="warn" title="Booking lookup is offline">
          <p>{NO_API_MESSAGE}</p>
        </Notice>
      ) : null}

      {teeTimeNotice ? (
        <Notice tone="warn" title="Tee time lookup is not ready yet">
          {/* 정직하게 착지시킨다. 티 시트에는 확인 코드도, 코드로 찾는 주소도 없다. */}
          <p>
            That looks like a tee time reservation number. Online tee time lookup is still being
            built — the pro shop can pull up your booking in seconds by phone.
          </p>
        </Notice>
      ) : null}

      {loading ? <PanelSkeleton /> : null}

      {error ? (
        <Notice tone="error" title="We could not open that booking">
          <p>{error}</p>
        </Notice>
      ) : null}

      {found ? <ReservationCard reservation={found} /> : null}

      <div className="mt-5 rounded-sm border border-[#d8d1c3] bg-white p-4 text-sm text-[#5c6459]">
        <p className="font-semibold text-[#182118]">Need to change or cancel?</p>
        <p className="mt-1">
          Changes and cancellations are handled by the pro shop. Call{" "}
          <a className="font-semibold text-[#214d2f] underline" href={CLUB.phoneHref}>
            {CLUB.phone}
          </a>{" "}
          or email{" "}
          <a className="font-semibold text-[#214d2f] underline" href={CLUB.emailHref}>
            {CLUB.email}
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function Notice({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title: string;
  tone: "warn" | "error";
}) {
  const skin =
    tone === "error"
      ? "border-[#e0b3b3] bg-[#fbeeee] text-[#8a2f2f]"
      : "border-[#d6c28f] bg-[#f3ead2] text-[#5c4a1c]";
  return (
    <div className={`mt-5 rounded-sm border p-5 ${skin}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 text-sm">{children}</div>
      <a
        className="tap-target mt-4 flex items-center justify-center rounded-sm bg-[#214d2f] px-5 text-sm font-bold text-white transition hover:bg-[#163820]"
        href={CLUB.phoneHref}
      >
        Call {CLUB.phone}
      </a>
    </div>
  );
}

function ReservationCard({ reservation }: { reservation: SimulatorReservation }) {
  const cancelled = reservation.status !== "confirmed";
  return (
    <div className="mt-5 rounded-sm border border-[#d8d1c3] bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a6f30]">
          Indoor Golf
        </p>
        <span
          className={`rounded-sm px-2 py-1 text-xs font-bold uppercase ${
            cancelled ? "bg-[#efece3] text-[#8a2f2f]" : "bg-[#e4efe4] text-[#214d2f]"
          }`}
        >
          {reservation.status}
        </span>
      </div>

      <p className="mt-2 text-sm text-[#5c6459]">{formatLongDate(reservation.date)}</p>
      <p className="mt-1 text-3xl font-bold">{reservation.start_time}</p>
      <p className="mt-1 text-sm text-[#3d453d]">
        {reservation.duration_hours} hour{reservation.duration_hours > 1 ? "s" : ""} ·{" "}
        {reservation.player_count} player{reservation.player_count > 1 ? "s" : ""} ·{" "}
        {reservation.bay_type}
        {reservation.bay_number ? ` #${reservation.bay_number}` : ""}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[#d8d1c3] pt-4 text-sm">
        <div className="min-w-0">
          <dt className="font-semibold text-[#8a6f30]">Name</dt>
          <dd className="break-words">{reservation.customer_name}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-[#8a6f30]">Total</dt>
          <dd className="font-bold text-[#214d2f]">
            {reservation.total_price === null ? "—" : `$${reservation.total_price.toFixed(2)}`}
          </dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="font-semibold text-[#8a6f30]">Confirmation code</dt>
          <dd className="break-all font-mono font-bold tracking-widest text-[#214d2f]">
            {reservation.confirmation_code}
          </dd>
        </div>
      </dl>
    </div>
  );
}
