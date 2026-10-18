import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  Banknote,
  Bell,
  BellOff,
  Check,
  Clock,
  CreditCard,
  PackageCheck,
  Phone,
  Printer,
  RefreshCw,
  Store,
  Undo2,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { OrderReceipt } from './OrderReceipt';
import { OrderCallBanner } from './OrderCallBanner';
import { StaffAlertCheck } from './StaffAlertCheck';
import {
  clockTime,
  fetchShopOrders,
  money,
  ordersTrackPayment,
  PAYMENT_LABEL,
  setOrderPayment,
  setOrderStatus,
  setProShopAlerts,
  type OrderStatus,
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

/** 새 주문을 놓치지 않을 만큼 자주, 서버를 괴롭히지 않을 만큼 뜸하게. */
const REFRESH_MS = 20000;

/**
 * 새 주문이 들어올 때 울리는 소리.
 *
 * 푸시 알림(아래 'proshop' 토픽)은 주머니 속 폰을 위한 것이고, 이것은 계산대에
 * 세워 둔 화면을 위한 것입니다. 그 화면은 이미 열려 있어서 푸시가 오지 않거나,
 * 와도 화면 위쪽에 조용히 쌓입니다 - 주방에서 등지고 일하는 사람에게는 소리가
 * 필요합니다.
 *
 * 음원 파일 대신 그 자리에서 만들어 냅니다. 두 음을 이어 붙인 짧은 종소리라
 * 받아 올 것이 없고, 인터넷이 끊긴 순간에도 울립니다.
 *
 * 브라우저는 사람이 한 번 누르기 전에는 소리를 내지 않습니다. 그래서 화면의
 * '소리 켜기' 버튼이 AudioContext 를 그 탭 안에서 깨웁니다 - 그 한 번의 탭이
 * 이 소리의 전부입니다.
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
    // 시작과 끝을 눕혀 둡니다. 사각으로 끊으면 싸구려 알람처럼 '딱' 소리가
    // 같이 납니다.
    const start = now + note.at;
    const end = start + note.ms / 1000;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(context.destination);
    osc.start(start);
    osc.stop(end + 0.05);
  }
};

const PROBLEM: Record<ServerProblem, string> = {
  unavailable: '이 빌드에는 서버 연결이 없습니다.',
  signedOut: '관리자 계정으로 로그인해 주세요.',
  notAdmin: '이 계정은 관리자로 지정되지 않았습니다 (0006 SQL 맨 아래 관리자 지정).',
  missingTable: '서버에 food_orders 표가 없습니다. 0012_food_orders.sql 을 SQL Editor 에서 실행해 주세요.',
  network: '인터넷 연결이 없어 주문을 받아오지 못했습니다.',
  other: '주문을 받아오지 못했습니다. 잠시 후 새로고침을 눌러 주세요.',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: '접수',
  ready: '준비됨',
  picked_up: '가져감',
  cancelled: '취소',
};

const STATUS_STYLE: Record<OrderStatus, string> = {
  new: 'bg-amber-500/15 text-amber-900 dark:text-amber-200',
  ready: 'bg-primary/15 text-primary',
  picked_up: 'bg-muted text-muted-foreground',
  cancelled: 'bg-red-500/15 text-red-800 dark:text-red-200',
};

const METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'cash', label: '현금', icon: Banknote },
  { id: 'card', label: '카드', icon: CreditCard },
  { id: 'member', label: '회원', icon: UserRound },
];

/**
 * 프로 샵 주문 화면
 *
 * 오늘 들어온 주문을 픽업 시간 순으로 보여 주고, 준비됨·가져감·취소를 찍습니다.
 * 20초마다 스스로 다시 읽습니다 - 계산대 옆에 띄워 두는 화면이라 새로고침을
 * 누르러 오는 사람이 없습니다.
 *
 * 알림(푸시)은 이 폰을 'proshop' 토픽에 넣습니다. 손님 알림과 같은 장치를 쓰되
 * 토픽이 달라, 주문 알림은 직원 폰에만 갑니다 (0012 의 set_proshop_push).
 */
export function OrdersAdmin() {
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [problem, setProblem] = useState<ServerProblem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [alerts, setAlerts] = useState<'off' | 'on' | 'busy'>('off');
  const [alertNote, setAlertNote] = useState('');
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  // 소리는 사람이 한 번 눌러야 켜집니다 - 브라우저 규칙이자, 계산대 화면을
  // 켜 둔 채 자리를 비우는 밤에도 조용한 편이 낫기 때문입니다.
  const [chime, setChime] = useState<AudioContext | null>(null);
  // load() 는 20초마다 도는 타이머가 쥐고 있습니다. 소리를 상태로 읽으면
  // 켜는 순간 타이머가 새로 걸리고, 그때마다 주기가 처음부터 다시 셉니다.
  const chimeRef = useRef<AudioContext | null>(null);
  chimeRef.current = chime;
  // 인쇄할 주문. 한 장씩만 - 프린터로 나가는 것은 이 한 장입니다.
  const [printing, setPrinting] = useState<ShopOrder | null>(null);
  // 방금 들어온 주문을 크게 알리는 띠. 말로 읽어 주는 것과 같은 글입니다.
  const [call, setCall] = useState<OrderCall | null>(null);

  const load = useCallback(async () => {
    const { orders: rows, problem: failed } = await fetchShopOrders();
    setProblem(failed);
    if (!rows) return;
    // 이번에 처음 본 주문에 '새 주문' 표를 답니다.
    const newly = new Set(rows.filter((o) => !seen.current.has(o.id) && o.status === 'new').map((o) => o.id));
    if (seen.current.size === 0) newly.clear();
    rows.forEach((o) => seen.current.add(o.id));
    setOrders(rows);
    setFresh((current) => new Set([...current, ...newly]));
    setLoadedAt(new Date());

    if (newly.size > 0) {
      // 몇 건이 한꺼번에 들어와도 한 번만 울립니다.
      if (chimeRef.current) playChime(chimeRef.current);
      // 폰으로 보고 있을 때. 지원하지 않는 브라우저에서는 아무 일도 없습니다.
      navigator.vibrate?.([120, 80, 120]);
      // 종소리 다음에 무엇이 들어왔는지 읽어 줍니다(소리를 켰을 때). 화면에는
      // 같은 글이 띠로 붙어서, 못 들은 사람이 그대로 읽습니다.
      const next = orderCall(rows.filter((o) => newly.has(o.id)));
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
    setFresh((current) => {
      const next = new Set(current);
      next.delete(order.id);
      return next;
    });
    setOrders((current) => current.map((o) => (o.id === order.id ? { ...o, status } : o)));
  };

  /**
   * 카운터에서 돈을 받았다는 기록. /fnb 와 같은 칸(0018)을 씁니다 - 상태와는
   * 따로입니다: '가져감' 은 음식이 나갔다는 뜻이고 이것은 돈이 들어왔다는 뜻.
   */
  const pay = async (order: ShopOrder, method: PaymentMethod | null) => {
    setBusyId(order.id);
    const failed = await setOrderPayment(order.id, method);
    setBusyId(null);
    if (failed) {
      setAlertNote(
        failed === 'missingTable'
          ? '서버에 결제 칸이 없습니다. 0018_order_payment.sql 을 실행해 주세요.'
          : PROBLEM[failed]
      );
      return;
    }
    setOrders((current) =>
      current.map((o) =>
        o.id === order.id
          ? {
              ...o,
              paidAt: method ? new Date().toISOString() : null,
              paidMethod: method,
              paidCashCents: null,
              paidCardLast4: null,
              paidCardAuth: null,
            }
          : o
      )
    );
  };

  const takeAlerts = async () => {
    setAlerts('busy');
    setAlertNote('');
    try {
      const subscription = await subscribeToPush();
      const failed = await setProShopAlerts(subscription.endpoint, true);
      if (failed) {
        setAlerts('off');
        setAlertNote(PROBLEM[failed]);
        return;
      }
      setAlerts('on');
      setAlertNote('이 폰으로 새 주문 알림을 받습니다.');
    } catch (err) {
      setAlerts('off');
      const code = err instanceof Error ? err.message : '';
      setAlertNote(
        code === 'PERMISSION_DENIED'
          ? '브라우저에서 알림이 꺼져 있습니다. 사이트 설정에서 알림을 허용해 주세요.'
          : code === 'PUSH_UNSUPPORTED'
            ? '이 브라우저는 알림을 지원하지 않습니다. 아이폰은 홈 화면에 추가한 뒤에 됩니다.'
            : '알림을 켜지 못했습니다.'
      );
    }
  };

  /** 이 탭에서 소리를 쓸 권리를 사는 한 번의 탭. 눌러 본 사람이 한 번 듣습니다. */
  const armChime = async () => {
    if (chime) {
      void chime.close();
      setChime(null);
      stopSpeaking();
      return;
    }
    try {
      const context = new AudioContext();
      // 탭 안에서 깨워야 합니다. 나중에 부르면 브라우저가 거절합니다.
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
      setAlertNote('이 브라우저에서 소리를 켜지 못했습니다.');
    }
  };

  /**
   * 주문서 한 장 인쇄.
   *
   * 종이를 먼저 화면(숨은 자리)에 그려 놓고 브라우저의 인쇄를 부릅니다. 그리는
   * 것과 부르는 것 사이에 한 프레임을 두는 이유는, React 가 아직 붙이지 않은
   * 종이를 인쇄하면 빈 장이 나오기 때문입니다.
   */
  const print = (order: ShopOrder) => {
    setPrinting(order);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        // 인쇄 대화창이 닫히는 시점은 브라우저마다 다릅니다. onafterprint 를
        // 기다리지 않고 조금 뒤에 치웁니다 - 남아 있어도 화면에는 안 보이지만,
        // 다음 인쇄가 이 장을 같이 뽑으면 안 됩니다.
        window.setTimeout(() => setPrinting(null), 1000);
      });
    });
  };

  const waiting = orders.filter((o) => o.status === 'new' || o.status === 'ready');
  const canTakePayment = ordersTrackPayment();

  // 마감에 카드 단말기 집계와 맞춰 보는 숫자. 취소는 빼고, 받은 것만 방법별로.
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

  /**
   * 오늘 들어온 주문 수. 아래 점검 패널이 "오늘 주문 7건인데 알림은 3건" 처럼
   * 짚어 주는 데 씁니다 - 픽업 시간이 아니라 접수 시각으로 세야 어제 받아 둔
   * 오늘 픽업 주문이 섞이지 않습니다.
   */
  const today = new Date().toDateString();
  const ordersToday = orders.filter(
    (o) => o.createdAt && new Date(o.createdAt).toDateString() === today
  ).length;

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">오늘 주문 {waiting.length}건 대기</h2>
          <p className="text-sm text-muted-foreground">
            픽업 시간 순 · 20초마다 자동 새로고침
            {loadedAt && ` · ${clockTime(loadedAt)} 기준`}
            {chime ? ' · 소리·음성 켜짐' : ' · 소리 꺼짐'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 계산대 전용 화면. 관리자 키 없이 로그인만으로 열리고, 결제와
              주문만 크게 보여 줍니다. */}
          <Link
            href="/fnb"
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-green-600 px-3 text-sm font-semibold text-white"
          >
            <Store className="h-4 w-4" />
            결제 화면
          </Link>
          {isPushSupported() && (
            <button
              type="button"
              onClick={() => void takeAlerts()}
              disabled={alerts === 'busy'}
              className={`inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium disabled:opacity-50 ${
                alerts === 'on' ? 'bg-primary text-primary-foreground' : 'border border-border'
              }`}
            >
              {alerts === 'on' ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              {alerts === 'on' ? '알림 켜짐' : '새 주문 알림 받기'}
            </button>
          )}
          {/* 계산대에 세워 두는 화면을 위한 소리. 푸시와 별개입니다 - 푸시는
              주머니 속 폰으로 가고, 이것은 이 화면에서 울립니다. */}
          <button
            type="button"
            onClick={() => void armChime()}
            aria-pressed={chime !== null}
            className={`inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${
              chime ? 'bg-primary text-primary-foreground' : 'border border-border'
            }`}
          >
            {chime ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            {chime ? '소리 켜짐' : '소리 켜기'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="새로고침"
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium"
          >
            <RefreshCw className="h-4 w-4" />
            새로고침
          </button>
        </div>
      </header>

      {/* 오늘 받은 돈. */}
      {canTakePayment ? (
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
      ) : (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          결제 기록은 아직 켜지지 않았습니다. Supabase SQL Editor 에서
          <b> 0018_order_payment.sql</b> 을 실행하면 현금·카드를 찍을 수 있습니다.
        </p>
      )}

      {alertNote && <p className="text-sm text-muted-foreground">{alertNote}</p>}
      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {PROBLEM[problem]}
        </p>
      )}

      {/* 방금 들어온 주문. 말로 읽어 준 것과 같은 글입니다. */}
      <OrderCallBanner call={call} spoken={chime !== null} onDismiss={() => setCall(null)} />

      {/* 직원 알림이 실제로 갔는지. 접힌 채로 한 줄이고, 문제가 있을 때만
          빨간 표가 붙습니다 - 계산대 화면의 자리를 먹지 않게. */}
      <StaffAlertCheck ordersToday={ordersToday} />

      {orders.length === 0 && !problem && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          오늘 들어온 주문이 없습니다.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {orders.map((order) => (
          <li
            key={order.id}
            className={`rounded-lg border bg-card p-3 ${
              fresh.has(order.id) ? 'border-primary shadow-sm' : 'border-border'
            } ${order.status === 'picked_up' || order.status === 'cancelled' ? 'opacity-60' : ''}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1 text-lg font-bold tabular-nums">
                <Clock className="h-4 w-4 text-primary" />
                {clockTime(order.pickupAt)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[order.status]}`}>
                {STATUS_LABEL[order.status]}
              </span>
              {fresh.has(order.id) && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                  새 주문
                </span>
              )}
              <span className="ml-auto font-mono text-sm font-bold tracking-widest text-muted-foreground">
                {order.code}
              </span>
            </div>

            <p className="mt-1 text-sm">
              {order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {money(order.totalCents)} ·{' '}
              {order.paidAt ? (
                <span className="text-green-600 dark:text-green-400">
                  결제됨{order.paidMethod ? ` (${PAYMENT_LABEL[order.paidMethod]})` : ''}
                </span>
              ) : order.status === 'cancelled' ? (
                '현장 결제'
              ) : (
                <span className="text-red-700 dark:text-red-300">미결제</span>
              )}
            </p>
            {order.note && <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">메모: {order.note}</p>}
            <p className="mt-1 text-sm text-muted-foreground">
              {order.customerName}
              {order.holeNumber ? ` · ${order.holeNumber}번 홀에서 주문` : ''}
              {' · '}
              <a className="underline" href={`tel:${order.phone.replace(/[^+\d]/g, '')}`}>
                <Phone className="mr-0.5 inline h-3.5 w-3.5" />
                {order.phone}
              </a>
            </p>

            {/* 결제 줄. 상태 버튼과 따로 둡니다 - 음식이 나간 것과 돈이 들어온
                것은 다른 일입니다. */}
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
                  METHODS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => void pay(order, id)}
                      disabled={busyId === order.id || !canTakePayment}
                      className="inline-flex h-10 items-center gap-1.5 rounded-md bg-green-600 px-3 text-sm font-bold text-white disabled:opacity-50"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              {/* 어느 상태든 다시 뽑을 수 있습니다 - 종이는 잃어버리고,
                  가져간 주문의 영수증을 손님이 다시 달라고도 합니다. */}
              <button
                type="button"
                onClick={() => print(order)}
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium"
              >
                <Printer className="h-4 w-4" />
                영수증 출력
              </button>
            </div>

            {(order.status === 'new' || order.status === 'ready') && (
              <div className="mt-2 flex flex-wrap gap-2">
                {order.status === 'new' && (
                  <button
                    type="button"
                    onClick={() => void mark(order, 'ready')}
                    disabled={busyId === order.id}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    준비됨
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void mark(order, 'picked_up')}
                  disabled={busyId === order.id}
                  className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium disabled:opacity-50"
                >
                  <PackageCheck className="h-4 w-4" />
                  가져감
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`${order.code} 주문을 취소로 표시할까요? 손님에게는 전화로 알려 주세요.`)) {
                      void mark(order, 'cancelled');
                    }
                  }}
                  disabled={busyId === order.id}
                  className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-red-700 disabled:opacity-50 dark:text-red-300"
                >
                  <X className="h-4 w-4" />
                  취소
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* 인쇄할 종이 한 장. 화면에는 보이지 않습니다 - index.css 참고. */}
      {printing && <OrderReceipt order={printing} />}
    </section>
  );
}
