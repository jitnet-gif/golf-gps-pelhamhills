import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, ChevronLeft, Check, Loader2, Phone, RefreshCw } from 'lucide-react';
import {
  DAY_PART_LABEL,
  type DayPartFilter,
  type OpenTeeTime,
  buildOpenTeeTimes,
  dayPartOf,
  describeFailure,
  formatChipDate,
  formatLongDate,
  splitName,
  todayIso,
  upcomingDates,
} from '@/lib/availability';
import {
  NO_BOOKING_MESSAGE,
  PRO_SHOP_PHONE,
  PRO_SHOP_PHONE_HREF,
  type TeeBooking,
  teeSheetApi,
  teeSheetBaseUrl,
} from '@/lib/teeSheet';

/**
 * 앱에서 티타임 예약하기.
 *
 * 어드민 티 시트(웹사이트의 `/teesheet`)와 **같은 데이터**를 보지만 화면은
 * 정반대다. 직원은 "하루 전체가 어떻게 차 있나"를 보고, 손님은 "내가 원하는
 * 시간에 자리가 있나" 하나만 본다. 그래서 격자가 아니라 날짜 → 인원 → 시간 →
 * 이름 네 걸음이다.
 *
 * 이 앱은 코스에서 열리는 PWA 라서 웹사이트의 예약 화면과 사정이 두 가지 다르다.
 *  - 신호가 없는 자리에서 열릴 수 있다. 실패는 언제나 전화번호로 착지한다.
 *  - 예약 서버(`VITE_TEE_SHEET_API_URL`)가 설정되지 않은 배포가 있을 수 있다.
 *    그때는 폼을 아예 열지 않는다 — 다 채운 뒤 마지막에 실패하는 것보다
 *    첫 화면에서 전화번호를 주는 편이 정직하다.
 */

/** 오늘부터 2주. 그 너머는 프로 샵이 요금·행사를 아직 확정하지 않은 구간이다. */
const DAYS_AHEAD = 14;
const PARTY_SIZES = [1, 2, 3, 4] as const;
const DAY_PARTS: DayPartFilter[] = ['all', 'morning', 'afternoon', 'evening'];

export default function Book() {
  // `null` 은 "아직 모름"(마운트 전), `false` 는 "이 앱엔 예약 서버가 없다".
  // 브라우저에서만 판단할 수 있는 값이라 모듈 상수가 아니라 state 다.
  const [apiReady, setApiReady] = useState<boolean | null>(null);

  const [date, setDate] = useState(todayIso());
  const [party, setParty] = useState(2);
  const [dayPart, setDayPart] = useState<DayPartFilter>('all');

  const [openTimes, setOpenTimes] = useState<OpenTeeTime[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const [selected, setSelected] = useState<OpenTeeTime | null>(null);
  const [created, setCreated] = useState<TeeBooking | null>(null);

  const dates = useMemo(() => upcomingDates(DAYS_AHEAD), []);

  useEffect(() => {
    setApiReady(Boolean(teeSheetBaseUrl()));
  }, []);

  useEffect(() => {
    if (apiReady !== true) return;

    let cancelled = false;
    setLoading(true);
    setLoadError('');

    // 슬롯과 예약을 함께 가져와 겹친다. 백엔드에 "예약 가능 시간" 엔드포인트가
    // 없기 때문이고, 두 요청은 서로를 기다릴 이유가 없다.
    Promise.all([teeSheetApi.getSlots(date), teeSheetApi.listBookings(date)])
      .then(([slotsResponse, bookings]) => {
        if (cancelled) return;
        setOpenTimes(buildOpenTeeTimes(slotsResponse.slots, bookings, date));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setOpenTimes([]);
        setLoadError(describeFailure(error, 'Tee times could not be loaded.').message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiReady, date, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const visible = useMemo(() => {
    if (!openTimes) return [];
    return openTimes.filter((slot) => dayPart === 'all' || dayPartOf(slot.minutes) === dayPart);
  }, [openTimes, dayPart]);

  const bookable = visible.filter((slot) => slot.remaining >= party).length;

  if (apiReady === false) {
    return (
      <Shell title="Tee Times">
        <div className="card">
          <p className="text-sm text-muted-foreground">{NO_BOOKING_MESSAGE}</p>
          <CallButton />
        </div>
      </Shell>
    );
  }

  if (created) {
    return (
      <Shell title="You are booked">
        <Confirmation
          booking={created}
          onBookAnother={() => {
            setCreated(null);
            setSelected(null);
            refresh();
          }}
        />
      </Shell>
    );
  }

  if (selected) {
    return (
      <Shell
        onBack={() => setSelected(null)}
        subtitle={`${formatLongDate(date)} · ${selected.time}`}
        title="Your details"
      >
        <BookingForm
          date={date}
          onBooked={setCreated}
          onSlotGone={() => {
            setSelected(null);
            refresh();
          }}
          party={party}
          slot={selected}
        />
      </Shell>
    );
  }

  return (
    <Shell subtitle="Pick a day, tell us how many are playing, and choose a time." title="Tee Times">
      <DateStrip dates={dates} onChange={setDate} value={date} />

      <Field label="Players">
        <div className="flex gap-2">
          {PARTY_SIZES.map((size) => (
            <Choice key={size} onClick={() => setParty(size)} selected={party === size}>
              {size}
            </Choice>
          ))}
        </div>
      </Field>

      <Field label="Time of day">
        <div className="flex gap-2">
          {DAY_PARTS.map((part) => (
            <Choice key={part} onClick={() => setDayPart(part)} selected={dayPart === part}>
              <span className="truncate">{part === 'all' ? 'Any' : DAY_PART_LABEL[part]}</span>
            </Choice>
          ))}
        </div>
      </Field>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{formatLongDate(date)}</h2>
        {!loading && !loadError && openTimes ? (
          <p className="text-xs text-muted-foreground">
            {bookable} tee time{bookable === 1 ? '' : 's'} open for {party} player
            {party === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>

      <div className="mt-3">
        {apiReady === null || loading ? (
          <Loading />
        ) : loadError ? (
          <LoadFailure message={loadError} onRetry={refresh} />
        ) : visible.length === 0 ? (
          <EmptyDay
            filtered={dayPart !== 'all'}
            onClearFilter={() => setDayPart('all')}
            onNextDay={() => setDate(dates[Math.min(dates.indexOf(date) + 1, dates.length - 1)])}
          />
        ) : (
          <SlotGrid onPick={setSelected} party={party} slots={visible} />
        )}
      </div>
    </Shell>
  );
}

// ===== 껍데기 ==========================================================

function Shell({
  children,
  onBack,
  subtitle,
  title,
}: {
  children: ReactNode;
  onBack?: () => void;
  subtitle?: string;
  title: string;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4 pb-10">
      {/* 뒤로 가기는 폼 단계에서만 화면 안의 버튼이고, 첫 화면에서는 홈 링크다.
          설치된 PWA 에는 브라우저 뒤로 가기 버튼이 없다. */}
      {onBack ? (
        <button
          className="-ml-1 inline-flex items-center gap-1 py-2 text-sm text-muted-foreground"
          onClick={onBack}
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to times
        </button>
      ) : (
        <Link
          className="-ml-1 inline-flex items-center gap-1 py-2 text-sm text-muted-foreground"
          href="/"
        >
          <ChevronLeft className="h-4 w-4" />
          Home
        </Link>
      )}

      <h1 className="mt-1 text-2xl font-bold">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}

      <div className="mt-5">{children}</div>
    </main>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Choice({
  children,
  onClick,
  selected,
}: {
  children: ReactNode;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`min-h-11 min-w-0 flex-1 rounded-lg border px-2 text-sm font-semibold transition-colors ${
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground'
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function CallButton() {
  return (
    <a
      className="btn-primary mt-4 flex min-h-11 items-center justify-center gap-2"
      href={PRO_SHOP_PHONE_HREF}
    >
      <Phone className="h-4 w-4" />
      Call {PRO_SHOP_PHONE}
    </a>
  );
}

// ===== 날짜 칩 =========================================================

function DateStrip({
  dates,
  onChange,
  value,
}: {
  dates: string[];
  onChange: (iso: string) => void;
  value: string;
}) {
  return (
    // 가로 스크롤은 이 줄 안에서만 일어난다. `min-w-0` 이 없으면 칩 14장이
    // 페이지 전체를 가로로 밀어 낸다.
    <div className="-mx-4 min-w-0 overflow-x-auto px-4">
      <div className="flex w-max gap-2">
        {dates.map((iso, index) => {
          const chip = formatChipDate(iso);
          const selected = iso === value;
          return (
            <button
              aria-pressed={selected}
              className={`w-14 shrink-0 rounded-lg border py-2 text-center transition-colors ${
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground'
              }`}
              key={iso}
              onClick={() => onChange(iso)}
              type="button"
            >
              <span className="block text-[10px] uppercase opacity-80">
                {index === 0 ? 'Today' : chip.weekday}
              </span>
              <span className="block text-lg font-bold leading-tight">{chip.day}</span>
              <span className="block text-[10px] uppercase opacity-80">{chip.month}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===== 시간 목록 =======================================================

function SlotGrid({
  onPick,
  party,
  slots,
}: {
  onPick: (slot: OpenTeeTime) => void;
  party: number;
  slots: OpenTeeTime[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {slots.map((slot) => {
        // 인원이 안 되는 시간은 목록에서 빼지 않고 **눌러 둔다**. 지워 버리면
        // 손님은 "이 날은 아침이 아예 없다"고 읽는다.
        const full = slot.remaining < party;
        return (
          <button
            className={`rounded-lg border p-3 text-left transition-colors ${
              full
                ? 'cursor-not-allowed border-border bg-muted text-muted-foreground'
                : 'border-border bg-card text-card-foreground hover:border-primary'
            }`}
            disabled={full}
            key={slot.time}
            onClick={() => onPick(slot)}
            type="button"
          >
            <span className="block font-semibold">{slot.time}</span>
            <span className="block text-xs text-muted-foreground">
              ${slot.rate.toFixed(2)} · {full ? 'Full' : `${slot.remaining} left`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading tee times…
    </div>
  );
}

function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card">
      <p className="flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        {message}
      </p>
      <button
        className="btn-secondary mt-4 flex min-h-11 w-full items-center justify-center gap-2"
        onClick={onRetry}
        type="button"
      >
        <RefreshCw className="h-4 w-4" />
        Try again
      </button>
      <CallButton />
    </div>
  );
}

function EmptyDay({
  filtered,
  onClearFilter,
  onNextDay,
}: {
  filtered: boolean;
  onClearFilter: () => void;
  onNextDay: () => void;
}) {
  return (
    <div className="card">
      <p className="text-sm text-muted-foreground">
        {filtered ? 'No tee times left in that part of the day.' : 'No tee times left on this day.'}
      </p>
      <div className="mt-4 flex gap-2">
        {filtered ? (
          <button className="btn-secondary min-h-11 flex-1" onClick={onClearFilter} type="button">
            Any time
          </button>
        ) : null}
        <button className="btn-primary min-h-11 flex-1" onClick={onNextDay} type="button">
          Next day
        </button>
      </div>
    </div>
  );
}

// ===== 예약 폼 =========================================================

function BookingForm({
  date,
  onBooked,
  onSlotGone,
  party,
  slot,
}: {
  date: string;
  onBooked: (booking: TeeBooking) => void;
  onSlotGone: () => void;
  party: number;
  slot: OpenTeeTime;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [holes, setHoles] = useState<9 | 18>(18);
  const [cart, setCart] = useState(true);
  // 목록에서 고른 인원을 그대로 받되, 남은 자리를 넘지 않게 자른다.
  const [size, setSize] = useState(Math.min(party, slot.remaining));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const maxParty = Math.min(4, slot.remaining);
  const carts = cart ? Math.ceil(size / 2) : 0;
  const ready = name.trim().length > 0 && email.trim().length > 0 && !submitting;
  const total = slot.rate * size;

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const [firstName, lastName] = splitName(name);
      const booking = await teeSheetApi.createBooking({
        date,
        time: slot.time,
        // `title` 은 서버 기본값이 없는 필수 필드다 — 비우면 422 다. 어드민 격자에
        // 이 문자열이 그대로 찍히므로 예약자 이름을 쓴다.
        title: `${firstName} ${lastName}`.trim(),
        holes,
        // `rate` 는 보내지 않는다. 서버가 그날의 슬롯 요금을 매긴다. 화면에 굳어
        // 있던 값을 보내면 프로 샵이 요금을 바꾼 날 손님이 옛 가격으로 예약한다.
        cartCount: carts,
        notes: 'Booked from the Golf GPS app.',
        // **인원 = 플레이어 객체 수.** 서버의 정원 검사가 `incoming=len(body.players)`
        // 라서 빈 배열로 보내면 자리를 하나도 잡지 않은 채 예약만 생긴다 —
        // 같은 티타임이 몇 번이고 다시 팔린다.
        players: Array.from({ length: size }, (_, index) =>
          index === 0
            ? {
                firstName,
                lastName,
                email: email.trim(),
                phone: phone.trim(),
                type: 'Guest' as const,
              }
            : { firstName: 'Guest', lastName: '', type: 'Guest' as const }
        ),
      });
      onBooked(booking);
    } catch (failure) {
      const described = describeFailure(failure, 'Your tee time could not be booked.');
      if (described.conflict) {
        // 자리가 나간 것은 실패가 아니라 **상태가 변한 것**이다. 폼에 붉은 배너만
        // 띄워 두면 손님은 이미 없는 시간을 계속 누르게 된다. 목록으로 돌려보낸다.
        onSlotGone();
        return;
      }
      setError(described.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-w-0">
      <Field label="Players">
        <div className="flex gap-2">
          {PARTY_SIZES.filter((value) => value <= maxParty).map((value) => (
            <Choice key={value} onClick={() => setSize(value)} selected={size === value}>
              {value}
            </Choice>
          ))}
        </div>
      </Field>

      <Field label="Holes">
        <div className="flex gap-2">
          {([18, 9] as const).map((value) => (
            <Choice key={value} onClick={() => setHoles(value)} selected={holes === value}>
              {value} holes
            </Choice>
          ))}
        </div>
      </Field>

      <Field label="Cart">
        <div className="flex gap-2">
          <Choice onClick={() => setCart(true)} selected={cart}>
            Yes
          </Choice>
          <Choice onClick={() => setCart(false)} selected={!cart}>
            Walking
          </Choice>
        </div>
      </Field>

      <Field label="Name">
        <input
          autoComplete="name"
          className="input-field w-full"
          onChange={(event) => setName(event.target.value)}
          placeholder="Full name"
          value={name}
        />
      </Field>

      <Field label="Email">
        <input
          autoComplete="email"
          className="input-field w-full"
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          type="email"
          value={email}
        />
      </Field>

      <Field label="Phone (optional)">
        <input
          autoComplete="tel"
          className="input-field w-full"
          inputMode="tel"
          onChange={(event) => setPhone(event.target.value)}
          placeholder="905-000-0000"
          type="tel"
          value={phone}
        />
      </Field>

      <div className="card mt-6">
        <Line label="Tee time" value={`${formatLongDate(date)} · ${slot.time}`} />
        <Line label="Players" value={`${size} · ${holes} holes`} />
        <Line label="Carts" value={carts === 0 ? 'Walking' : String(carts)} />
        <Line label="Green fee" value={`$${slot.rate.toFixed(2)} each`} />
        <div className="mt-2 border-t border-border pt-2">
          <Line bold label="Total" value={`$${total.toFixed(2)}`} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Pay at the pro shop when you check in.
        </p>
      </div>

      {error ? (
        <div className="card mt-4">
          <p className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            {error}
          </p>
          <CallButton />
        </div>
      ) : null}

      <button
        className="btn-primary mt-5 flex min-h-12 w-full items-center justify-center gap-2 text-base"
        disabled={!ready}
        onClick={submit}
        type="button"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {submitting ? 'Booking…' : `Book ${slot.time}`}
      </button>
    </div>
  );
}

function Line({ bold, label, value }: { bold?: boolean; label: string; value: string }) {
  return (
    <div className={`flex justify-between gap-4 py-0.5 text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{value}</span>
    </div>
  );
}

// ===== 확인 ============================================================

function Confirmation({
  booking,
  onBookAnother,
}: {
  booking: TeeBooking;
  onBookAnother: () => void;
}) {
  return (
    <div className="min-w-0">
      <div className="card">
        <p className="flex items-center gap-2 font-semibold text-primary">
          <Check className="h-5 w-5" />
          Reserved
        </p>
        <div className="mt-3">
          <Line label="Tee time" value={`${formatLongDate(booking.date)} · ${booking.time}`} />
          <Line label="Name" value={booking.title} />
          <Line label="Players" value={`${booking.players.length} · ${booking.holes} holes`} />
          <Line
            label="Carts"
            value={booking.cartCount === 0 ? 'Walking' : String(booking.cartCount)}
          />
          <Line label="Green fee" value={`$${booking.rate.toFixed(2)} each`} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Please check in at the pro shop 15 minutes before your tee time. To change or cancel, call{' '}
          {PRO_SHOP_PHONE}.
        </p>
      </div>

      <button className="btn-secondary mt-4 min-h-11 w-full" onClick={onBookAnother} type="button">
        Book another tee time
      </button>
      <Link className="btn-primary mt-2 flex min-h-11 w-full items-center justify-center" href="/">
        Done
      </Link>
    </div>
  );
}
