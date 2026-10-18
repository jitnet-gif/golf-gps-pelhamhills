import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  Banknote,
  Bell,
  BellOff,
  Check,
  ChevronLeft,
  CreditCard,
  Loader2,
  PackageCheck,
  Phone,
  Printer,
  RefreshCw,
  Undo2,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AdminAccountGate, OrderCallBanner, OrderReceipt, StaffNotices } from '@/components/admin';
import { useAppStore } from '@/store/appStore';
import { startAuth } from '@/lib/auth';
import {
  clockTime,
  fetchShopOrders,
  money,
  ordersTrackPayment,
  ordersTrackPaymentDetail,
  PAYMENT_LABEL,
  setOrderPayment,
  setOrderStatus,
  setProShopAlerts,
  type OrderStatus,
  type PaymentDetails,
  type PaymentMethod,
  type ShopOrder,
} from '@/lib/foodOrders';
import { isPushSupported, subscribeToPush } from '@/lib/push';
import {
  isSpeechSupported,
  orderCall,
  primeVoices,
  speakOrderCall,
  stopSpeaking,
  type OrderCall,
} from '@/lib/orderAnnounce';
import type { ServerProblem } from '@/lib/holePaths';

/**
 * F&B 카운터 화면 (/fnb)
 *
 * 프로 샵 계산대에 세워 두는 화면입니다. /admin 의 주문 탭과 같은 표를 보지만
 * 쓰임이 다릅니다:
 *
 *   /admin  - 클럽 운영자가 배너·메뉴·스코어를 손보러 가끔 들어가는 곳.
 *             관리자 키를 넣고 탭을 고릅니다.
 *   /fnb    - 카운터 직원이 아침에 한 번 로그인하고 하루 종일 켜 두는 곳.
 *             주문과 결제, 그 둘뿐입니다.
 *
 * 그래서 관리자 키를 묻지 않습니다. 키는 운영 화면의 문이고, 카운터에서는
 * 비밀을 두 개 외우게 하는 값이 없습니다 - 무엇을 할 수 있는지는 결국 서버의
 * 행 보안이 계정으로 정합니다(0006 의 scorecard_admins).
 *
 * ----------------------------------------------------------------------------
 * 결제를 상태와 따로 두는 이유
 * ----------------------------------------------------------------------------
 * '가져감' 은 음식이 나갔다는 뜻이고 '결제' 는 돈이 들어왔다는 뜻입니다. 대개
 * 같이 일어나지만 일주일에 한 번은 어긋납니다 - 먼저 받아 두고 나중에 찾아
 * 가거나, 음식만 내주고 계산을 잊거나. 버튼 하나로 합치면 어느 쪽이 틀어졌는지
 * 알 수 없게 됩니다.
 *
 * 앱은 여전히 돈을 받지 않습니다. 여기서 누르는 것은 "카운터에서 받았다" 는
 * 기록일 뿐이고, 손님 폰에는 보이지 않습니다(0018).
 */

const REFRESH_MS = 15000;

const PROBLEM: Record<ServerProblem, string> = {
  unavailable: '이 빌드에는 서버 연결이 없습니다.',
  signedOut: '로그인이 풀렸습니다. 다시 로그인해 주세요.',
  notAdmin: '이 계정은 프로 샵 계정으로 지정되지 않았습니다 (0006 SQL 맨 아래).',
  missingTable: '서버에 결제 칸이 없습니다. 0018_order_payment.sql 을 실행해 주세요.',
  network: '인터넷 연결이 없어 받아오지 못했습니다.',
  other: '처리하지 못했습니다. 잠시 후 다시 눌러 주세요.',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: '접수',
  ready: '준비됨',
  picked_up: '가져감',
  cancelled: '취소',
};

const STATUS_STYLE: Record<OrderStatus, string> = {
  new: 'bg-amber-500 text-white',
  ready: 'bg-green-600 text-white',
  picked_up: 'bg-muted text-muted-foreground',
  cancelled: 'bg-red-500/15 text-red-800 dark:text-red-200',
};

const METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'cash', label: '현금', icon: Banknote },
  { id: 'card', label: '카드', icon: CreditCard },
  { id: 'member', label: '회원', icon: UserRound },
];

/**
 * 새 주문 소리. /admin 의 주문 탭과 같은 두 음짜리 종소리입니다 - 음원을 받아
 * 오지 않고 그 자리에서 만들어 내므로 인터넷이 끊겨도 울립니다. 브라우저가
 * 사람 손을 한 번 거치기 전에는 소리를 내지 않으므로, 화면의 '소리 켜기' 가
 * 그 한 번입니다.
 */
const CHIME = [
  { hz: 880, at: 0, ms: 160 },
  { hz: 1320, at: 0.16, ms: 260 },
];

const playChime = (context: AudioContext) => {
  const now = context.currentTime;
  for (const note of CHIME) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = note.hz;
    const start = now + note.at;
    const end = start + note.ms / 1000;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(context.destination);
    osc.start(start);
    osc.stop(end + 0.05);
  }
};

export default function Counter() {
  return (
    <main className="min-h-screen bg-background p-3 pb-16">
      <header className="mx-auto mb-3 flex max-w-4xl items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1.5 text-sm font-medium text-primary hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />홈
          </Link>
          <h1 className="text-xl font-bold">F&amp;B 카운터</h1>
        </div>
        <Link href="/admin" className="rounded-md border border-border px-3 py-2 text-sm">
          운영 관리
        </Link>
      </header>

      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {/* 직원 공지는 관리자 문 **밖**에 둡니다. 공지를 받는 직원이 관리자
            계정일 이유가 없고, 관리자로 만들면 메뉴 가격과 손님 위치까지
            딸려 열립니다 - 공지 하나 받자고 치를 값이 아닙니다.
            0019 의 staff_members 가 누가 직원인지 정하고, 이 자리는 로그인만
            했으면 보입니다. */}
        <SignedIn>
          <StaffNotices />
        </SignedIn>

        <AdminAccountGate>
          <CounterBoard />
        </AdminAccountGate>
      </div>
    </main>
  );
}

/** 로그인했을 때만 그립니다. 로그인 자체는 아래 AdminAccountGate 가 받습니다. */
function SignedIn({ children }: { children: React.ReactNode }) {
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  useEffect(() => {
    startAuth();
  }, []);
  if (!accountReady || !account) return null;
  return <>{children}</>;
}

function CounterBoard() {
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [problem, setProblem] = useState<ServerProblem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [alerts, setAlerts] = useState<'off' | 'on' | 'busy'>('off');
  const [note, setNote] = useState('');
  const [chime, setChime] = useState<AudioContext | null>(null);
  const [printing, setPrinting] = useState<ShopOrder | null>(null);
  // 현금·카드를 누르면 바로 찍지 않고 이 칸을 엽니다 - 받은 돈, 카드 끝 4자리.
  const [paying, setPaying] = useState<{ id: string; method: 'cash' | 'card' } | null>(null);
  // 다 끝난 주문까지 하루 종일 쌓이면 화면이 스크롤이 됩니다. 기본은 오늘 할 일.
  const [showDone, setShowDone] = useState(false);
  // 방금 들어온 주문을 크게 알리는 띠. 말로 읽어 주는 것과 같은 글입니다.
  const [call, setCall] = useState<OrderCall | null>(null);

  const chimeRef = useRef<AudioContext | null>(null);
  chimeRef.current = chime;
  const seen = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { orders: rows, problem: failed } = await fetchShopOrders();
    setProblem(failed);
    if (!rows) return;

    const fresh = rows.filter((o) => !seen.current.has(o.id) && o.status === 'new');
    const first = seen.current.size === 0;
    rows.forEach((o) => seen.current.add(o.id));
    setOrders(rows);
    setLoadedAt(new Date());

    if (!first && fresh.length > 0) {
      if (chimeRef.current) playChime(chimeRef.current);
      navigator.vibrate?.([120, 80, 120]);
      // 종소리는 '무슨 일이 났다' 까지입니다. 무엇이 들어왔는지는 말로 읽어
      // 주고(소리를 켰을 때), 같은 글을 띠로도 붙입니다.
      const next = orderCall(fresh);
      setCall(next);
      if (next && chimeRef.current) speakOrderCall(next);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const mark = async (order: ShopOrder, status: OrderStatus) => {
    setBusyId(order.id);
    const failed = await setOrderStatus(order.id, status);
    setBusyId(null);
    if (failed) {
      setProblem(failed);
      return;
    }
    setProblem(null);
    setOrders((rows) => rows.map((o) => (o.id === order.id ? { ...o, status } : o)));
  };

  const pay = async (
    order: ShopOrder,
    method: PaymentMethod | null,
    details: PaymentDetails = {},
    receipt = false
  ) => {
    setBusyId(order.id);
    setNote('');
    const failed = await setOrderPayment(order.id, method, details);
    setBusyId(null);
    if (failed) {
      setProblem(failed);
      return;
    }
    setProblem(null);
    setPaying(null);
    const paid: ShopOrder = {
      ...order,
      paidAt: method ? new Date().toISOString() : null,
      paidMethod: method,
      paidCashCents: method === 'cash' ? (details.cashCents ?? null) : null,
      paidCardLast4: method === 'card' ? (details.cardLast4 ?? null) : null,
      paidCardAuth: method === 'card' ? (details.cardAuth ?? null) : null,
    };
    setOrders((rows) => rows.map((o) => (o.id === order.id ? paid : o)));
    // 받은 그 자리에서 손님 손에 줄 종이. 결제 내용이 찍힌 영수증입니다.
    if (receipt) print(paid);
  };

  // 현금·카드는 칸을 엽니다. 회원은 적을 것이 없어 바로 찍습니다. 0021 이
  // 없는 서버에서는 적어 둘 곳이 없으므로 예전처럼 바로 찍습니다.
  const choose = (order: ShopOrder, method: PaymentMethod) => {
    if (method === 'member' || !ordersTrackPaymentDetail()) {
      void pay(order, method);
      return;
    }
    setPaying({ id: order.id, method });
  };

  const armChime = async () => {
    if (chime) {
      void chime.close();
      setChime(null);
      stopSpeaking();
      return;
    }
    try {
      const context = new AudioContext();
      await context.resume();
      playChime(context);
      setChime(context);
      // 목소리 목록은 처음엔 비어 있습니다. 누르는 김에 깨워 둬야 첫 주문을
      // 기기 언어(한국어) 목소리로 읽지 않습니다.
      primeVoices();
      if (isSpeechSupported()) {
        speakOrderCall({ headline: 'F and B alerts are on.', lines: [], orders: 0, items: 0 });
      }
    } catch {
      setNote('이 브라우저에서 소리를 켜지 못했습니다.');
    }
  };

  const takeAlerts = async () => {
    setAlerts('busy');
    setNote('');
    try {
      const subscription = await subscribeToPush();
      const failed = await setProShopAlerts(subscription.endpoint, true);
      if (failed) {
        setAlerts('off');
        setNote(PROBLEM[failed]);
        return;
      }
      setAlerts('on');
      setNote('이 기기로 새 주문 알림을 받습니다.');
    } catch (err) {
      setAlerts('off');
      const code = err instanceof Error ? err.message : '';
      setNote(
        code === 'PERMISSION_DENIED'
          ? '브라우저에서 알림이 꺼져 있습니다. 사이트 설정에서 허용해 주세요.'
          : code === 'PUSH_UNSUPPORTED'
            ? '이 브라우저는 알림을 지원하지 않습니다. 아이패드는 홈 화면에 추가한 뒤에 됩니다.'
            : '알림을 켜지 못했습니다.'
      );
    }
  };

  const print = (order: ShopOrder) => {
    setPrinting(order);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        window.setTimeout(() => setPrinting(null), 1000);
      });
    });
  };

  const done = (o: ShopOrder) => o.status === 'picked_up' || o.status === 'cancelled';
  const working = useMemo(() => orders.filter((o) => !done(o)), [orders]);
  const finished = useMemo(() => orders.filter(done), [orders]);

  // 마감에 맞춰 보는 숫자. 취소는 빼고, 받은 것만 방법별로.
  const takings = useMemo(() => {
    const sums: Record<PaymentMethod, number> = { cash: 0, card: 0, member: 0 };
    let unpaid = 0;
    for (const order of orders) {
      if (order.status === 'cancelled') continue;
      if (order.paidAt && order.paidMethod) sums[order.paidMethod] += order.totalCents;
      else unpaid += order.totalCents;
    }
    return { sums, unpaid, total: sums.cash + sums.card + sums.member };
  }, [orders]);

  const canTakePayment = ordersTrackPayment();

  const card = (order: ShopOrder) => (
    <li
      key={order.id}
      className={`rounded-xl border-2 bg-card p-3 ${
        order.status === 'new'
          ? 'border-amber-400'
          : order.paidAt || done(order)
            ? 'border-border'
            : 'border-green-500'
      } ${done(order) ? 'opacity-70' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-2xl font-black tabular-nums">{clockTime(order.pickupAt)}</span>
        <span className="font-mono text-lg font-bold tracking-widest">{order.code}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[order.status]}`}>
          {STATUS_LABEL[order.status]}
        </span>
        {order.paidAt ? (
          <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-bold text-white">
            결제 · {order.paidMethod ? PAYMENT_LABEL[order.paidMethod] : ''}
          </span>
        ) : (
          order.status !== 'cancelled' && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-800 dark:text-red-200">
              미결제
            </span>
          )
        )}
        <span className="ml-auto text-xl font-bold tabular-nums">{money(order.totalCents)}</span>
      </div>

      <p className="mt-1 text-base">
        {order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}
      </p>
      {order.note && (
        <p className="mt-1 rounded-md bg-amber-500/15 px-2 py-1 text-sm font-semibold text-amber-900 dark:text-amber-200">
          메모: {order.note}
        </p>
      )}
      <p className="mt-1 text-sm text-muted-foreground">
        {order.customerName}
        {order.holeNumber ? ` · ${order.holeNumber}번 홀에서 주문` : ''}
        {' · '}
        <a className="underline" href={`tel:${order.phone.replace(/[^+\d]/g, '')}`}>
          <Phone className="mr-0.5 inline h-3.5 w-3.5" />
          {order.phone}
        </a>
      </p>

      {/* 결제 줄. 상태 줄과 나란히 두지 않고 따로 둡니다 - 카운터에서 누르는
          두 가지가 서로 다른 일이라는 것이 손에서도 갈라져야 합니다. */}
      {order.status !== 'cancelled' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2">
          <span className="text-sm font-semibold">결제</span>
          {order.paidAt ? (
            <>
              <span className="text-sm">
                {order.paidMethod ? PAYMENT_LABEL[order.paidMethod] : ''} · {clockTime(order.paidAt)}
              </span>
              <button
                type="button"
                onClick={() => void pay(order, null)}
                disabled={busyId === order.id || !canTakePayment}
                className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium disabled:opacity-50"
              >
                <Undo2 className="h-4 w-4" />
                되돌리기
              </button>
            </>
          ) : (
            METHODS.map(({ id, label, icon: Icon }) => {
              const open = paying?.id === order.id && paying.method === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => (open ? setPaying(null) : choose(order, id))}
                  disabled={busyId === order.id || !canTakePayment}
                  aria-expanded={id === 'member' ? undefined : open}
                  className={`inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm font-bold disabled:opacity-50 ${
                    open ? 'bg-green-800 text-white ring-2 ring-green-400' : 'bg-green-600 text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })
          )}
          {order.paidAt && order.paidMethod === 'cash' && order.paidCashCents !== null && (
            <span className="w-full text-sm text-muted-foreground">
              받은 돈 {money(order.paidCashCents)} · 거스름돈{' '}
              {money(order.paidCashCents - order.totalCents)}
            </span>
          )}
          {order.paidAt && order.paidMethod === 'card' && order.paidCardLast4 && (
            <span className="w-full text-sm text-muted-foreground">
              카드 **** {order.paidCardLast4}
              {order.paidCardAuth && ` · 승인 ${order.paidCardAuth}`}
            </span>
          )}
          {!order.paidAt && paying?.id === order.id && (
            <PaymentPanel
              key={paying.method}
              method={paying.method}
              totalCents={order.totalCents}
              busy={busyId === order.id}
              onCancel={() => setPaying(null)}
              onConfirm={(details, receipt) => void pay(order, paying.method, details, receipt)}
            />
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {order.status === 'new' && (
          <button
            type="button"
            onClick={() => void mark(order, 'ready')}
            disabled={busyId === order.id}
            className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            준비됨
          </button>
        )}
        {(order.status === 'new' || order.status === 'ready') && (
          <>
            <button
              type="button"
              onClick={() => void mark(order, 'picked_up')}
              disabled={busyId === order.id}
              className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium disabled:opacity-50"
            >
              <PackageCheck className="h-4 w-4" />
              가져감
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`${order.code} 주문을 취소로 표시할까요? 손님에게 알려 주세요.`)) {
                  void mark(order, 'cancelled');
                }
              }}
              disabled={busyId === order.id}
              className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium text-red-700 disabled:opacity-50 dark:text-red-300"
            >
              <X className="h-4 w-4" />
              취소
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => print(order)}
          className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium"
        >
          <Printer className="h-4 w-4" />
          영수증
        </button>
        {busyId === order.id && <Loader2 className="h-5 w-5 animate-spin self-center" />}
      </div>
    </li>
  );

  return (
    <section className="flex flex-col gap-3">
      {/* 방금 들어온 주문. 말로 읽어 준 것과 같은 글입니다. */}
      <OrderCallBanner call={call} spoken={chime !== null} onDismiss={() => setCall(null)} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">
            처리할 주문 {working.length}건
            {working.filter((o) => o.status === 'new').length > 0 &&
              ` · 새 주문 ${working.filter((o) => o.status === 'new').length}건`}
          </h2>
          <p className="text-sm text-muted-foreground">
            15초마다 자동 새로고침
            {loadedAt && ` · ${clockTime(loadedAt)} 기준`}
            {chime ? ' · 소리·음성 켜짐' : ' · 소리 꺼짐'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void armChime()}
            aria-pressed={chime !== null}
            className={`inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${
              chime ? 'bg-primary text-primary-foreground' : 'border border-border'
            }`}
          >
            {chime ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            {chime ? '소리 켜짐' : '소리 켜기'}
          </button>
          {isPushSupported() && (
            <button
              type="button"
              onClick={() => void takeAlerts()}
              disabled={alerts === 'busy'}
              className={`inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium disabled:opacity-50 ${
                alerts === 'on' ? 'bg-primary text-primary-foreground' : 'border border-border'
              }`}
            >
              {alerts === 'on' ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              {alerts === 'on' ? '알림 켜짐' : '알림 받기'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium"
          >
            <RefreshCw className="h-4 w-4" />
            새로 고침
          </button>
        </div>
      </div>

      {/* 오늘 받은 돈. 마감에 카드 단말기 집계와 맞춰 보는 줄입니다. */}
      {canTakePayment && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-border bg-card p-3">
          <span className="text-sm font-semibold">오늘 받은 돈</span>
          {METHODS.map(({ id, label }) => (
            <span key={id} className="text-sm">
              {label} <b className="tabular-nums">{money(takings.sums[id])}</b>
            </span>
          ))}
          <span className="text-sm">
            합계 <b className="tabular-nums">{money(takings.total)}</b>
          </span>
          {takings.unpaid > 0 && (
            <span className="text-sm text-red-700 dark:text-red-300">
              미결제 <b className="tabular-nums">{money(takings.unpaid)}</b>
            </span>
          )}
        </div>
      )}

      {!canTakePayment && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          결제 기록은 아직 켜지지 않았습니다. Supabase SQL Editor 에서
          <b> 0018_order_payment.sql</b> 을 실행하면 이 화면에서 현금·카드를 찍을 수 있습니다.
          주문 처리는 지금도 됩니다.
        </p>
      )}

      {problem && (
        <p role="alert" className="rounded-lg bg-red-500/15 p-3 text-sm text-red-800 dark:text-red-200">
          {PROBLEM[problem]}
        </p>
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}

      {working.length === 0 && !problem && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          처리할 주문이 없습니다.
        </p>
      )}

      <ul className="flex flex-col gap-2">{working.map(card)}</ul>

      {finished.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowDone((on) => !on)}
            className="self-start rounded-md border border-border px-3 py-2 text-sm font-medium"
          >
            끝난 주문 {finished.length}건 {showDone ? '접기' : '보기'}
          </button>
          {showDone && <ul className="flex flex-col gap-2">{finished.map(card)}</ul>}
        </>
      )}

      {printing && <OrderReceipt order={printing} />}
    </section>
  );
}

/** 손님이 흔히 내는 지폐. 합계보다 큰 것만 버튼으로 보입니다. */
const BILLS = [500, 1000, 2000, 5000, 10000];

/** "12.5" / "$20" -> 센트. 읽을 수 없으면 null. */
const toCents = (text: string): number | null => {
  const clean = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
};

/**
 * 현금 / 카드 결제 칸.
 *
 * 현금: 받은 돈을 누르면 거스름돈이 바로 나옵니다. 합계보다 적으면 확인이 안
 * 눌립니다. 받은 돈은 영수증과 DB(0021)에 남습니다.
 *
 * 카드: 카드는 카운터 단말기로 받고, 여기에는 **끝 4자리**와 승인번호만
 * 적습니다. 번호 전체를 쳐도 서버로는 끝 4자리만 갑니다 - 전체 번호를 가지고
 * 있는 것 자체가 PCI 부담이고, 이 앱은 카드에서 돈을 빼 가지 못합니다(결제
 * 대행사 연동은 보류).
 */
function PaymentPanel({
  method,
  totalCents,
  busy,
  onCancel,
  onConfirm,
}: {
  method: 'cash' | 'card';
  totalCents: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (details: PaymentDetails, receipt: boolean) => void;
}) {
  const [cash, setCash] = useState('');
  const [cardDigits, setCardDigits] = useState('');
  const [auth, setAuth] = useState('');
  const [receipt, setReceipt] = useState(true);

  const tendered = method === 'cash' ? toCents(cash) : null;
  const change = tendered !== null ? tendered - totalCents : null;
  const cashOk = tendered !== null && tendered >= totalCents;

  const digits = cardDigits.replace(/\D/g, '');
  const last4 = digits.length >= 4 ? digits.slice(-4) : null;
  const authClean = auth.trim().replace(/\s+/g, '');
  const authOk = authClean === '' || /^[A-Za-z0-9-]{1,20}$/.test(authClean);
  const cardOk = last4 !== null && authOk;

  const ok = method === 'cash' ? cashOk : cardOk;

  const confirm = () => {
    if (!ok || busy) return;
    if (method === 'cash') onConfirm({ cashCents: tendered }, receipt);
    else onConfirm({ cardLast4: last4, cardAuth: authClean || null }, receipt);
    // 번호가 화면 상태에 남아 있지 않게 바로 비웁니다.
    setCardDigits('');
  };

  const field =
    'h-12 w-full rounded-md border border-border bg-background px-3 text-lg tabular-nums outline-none focus:ring-2 focus:ring-green-500';

  return (
    <form
      className="flex w-full flex-col gap-2 rounded-md border border-green-600/50 bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        confirm();
      }}
    >
      <p className="text-base font-bold">
        {method === 'cash' ? '현금 결제' : '카드 결제'} · 합계{' '}
        <span className="tabular-nums">{money(totalCents)}</span>
      </p>

      {method === 'cash' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCash((totalCents / 100).toFixed(2))}
              className="h-11 rounded-md border border-border px-3 text-sm font-semibold"
            >
              딱 맞게
            </button>
            {BILLS.filter((b) => b > totalCents).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setCash((b / 100).toFixed(2))}
                className="h-11 rounded-md border border-border px-3 text-sm font-semibold tabular-nums"
              >
                {money(b)}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium">
            받은 돈
            <input
              inputMode="decimal"
              autoComplete="off"
              placeholder={(totalCents / 100).toFixed(2)}
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              className={field}
            />
          </label>
          <p className="text-lg font-bold">
            거스름돈{' '}
            <span
              className={`tabular-nums ${change !== null && change < 0 ? 'text-red-600 dark:text-red-400' : ''}`}
            >
              {change === null ? '-' : change < 0 ? `${money(-change)} 모자람` : money(change)}
            </span>
          </p>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            카드 끝 4자리
            <input
              inputMode="numeric"
              autoComplete="off"
              name="card-last4-only"
              maxLength={23}
              placeholder="1234"
              value={cardDigits}
              onChange={(e) => setCardDigits(e.target.value.replace(/[^\d\s-]/g, ''))}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            승인번호 (단말기 영수증, 선택)
            <input
              autoComplete="off"
              maxLength={20}
              value={auth}
              onChange={(e) => setAuth(e.target.value)}
              className={field}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            카드는 카운터 단말기로 받아 주세요. 번호 전체를 넣어도 끝 4자리만 저장됩니다.
            {last4 && (
              <>
                {' '}
                저장: <b>**** {last4}</b>
              </>
            )}
          </p>
        </>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={receipt}
          onChange={(e) => setReceipt(e.target.checked)}
          className="h-5 w-5"
        />
        영수증 출력
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!ok || busy}
          className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-md bg-green-600 px-4 text-base font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
          결제 완료
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-12 rounded-md border border-border px-4 text-sm font-medium"
        >
          닫기
        </button>
      </div>
    </form>
  );
}
