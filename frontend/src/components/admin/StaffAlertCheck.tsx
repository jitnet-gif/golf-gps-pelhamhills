import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Check,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Send,
  Smartphone,
} from 'lucide-react';
import {
  countTodayNewOrderAlerts,
  fetchStaffAlerts,
  fetchStaffReach,
  isMissed,
  phonesOn,
  sendTestAlert,
  verdictOf,
  type AlertVerdict,
  type StaffAlert,
  type StaffPhone,
  type StaffReach,
} from '@/lib/staffAlerts';
import type { ServerProblem } from '@/lib/holePaths';

/** 펼쳐 둔 동안. 테스트 알림의 결과가 1분 안에 오므로 이만큼이면 놓치지 않습니다. */
const REFRESH_MS = 20000;

/** 접어 둔 동안. 요약 표가 낡지 않을 만큼만 - 계산대 화면은 하루 종일 켜져 있습니다. */
const IDLE_REFRESH_MS = 120000;

const PROBLEM: Record<ServerProblem, string> = {
  unavailable: '이 빌드에는 서버 연결이 없습니다.',
  signedOut: '관리자 계정으로 로그인해 주세요.',
  notAdmin: '이 계정은 관리자로 지정되지 않았습니다 (0006 SQL 맨 아래 관리자 지정).',
  missingTable: '서버에 알림 표가 없습니다. 0010_push.sql 을 SQL Editor 에서 실행해 주세요.',
  network: '인터넷 연결이 없어 확인하지 못했습니다.',
  other: '알림 기록을 읽지 못했습니다.',
};

const VERDICT: Record<AlertVerdict, { label: string; style: string }> = {
  delivered: { label: '전달', style: 'bg-green-500/15 text-green-800 dark:text-green-200' },
  partial: { label: '일부만 전달', style: 'bg-amber-500/15 text-amber-900 dark:text-amber-200' },
  nobody: { label: '아무도 못 받음', style: 'bg-red-500/15 text-red-800 dark:text-red-200' },
  failed: { label: '발송 실패', style: 'bg-red-500/15 text-red-800 dark:text-red-200' },
  waiting: { label: '나가는 중', style: 'bg-muted text-muted-foreground' },
  stuck: { label: '멈춰 있음', style: 'bg-red-500/15 text-red-800 dark:text-red-200' },
  canceled: { label: '취소됨', style: 'bg-muted text-muted-foreground' },
};

/** 오늘 것은 시각만, 지난 것은 날짜까지. 좁은 화면에서 한 줄에 들어가야 합니다. */
const when = (iso: string | null): string => {
  if (!iso) return '-';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '-';
  const today = new Date();
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  const time = at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return sameDay ? time : `${at.getMonth() + 1}/${at.getDate()} ${time}`;
};

const isToday = (iso: string | null): boolean => {
  if (!iso) return false;
  const at = new Date(iso);
  return !Number.isNaN(at.getTime()) && at.toDateString() === new Date().toDateString();
};

/** '3대 중 2대 전달' 처럼, 서버가 적어 둔 수를 그대로 읽습니다. */
const counts = (alert: StaffAlert): string => {
  if (alert.attempted === null) return '아직 발송 전';
  if (alert.attempted === 0) return '보낼 폰이 없었습니다';
  return `${alert.attempted}대 중 ${alert.delivered ?? 0}대 전달`;
};

const phoneLabel = (phone: StaffPhone): string =>
  `${phone.kind ?? '폰'} · ${phone.device}`;

interface StaffAlertCheckProps {
  /** 오늘 들어온 주문 수. 알림 줄이 아예 안 생긴 경우를 잡는 데 씁니다. */
  ordersToday: number;
}

/**
 * 직원 알림 점검
 *
 * "직원들이 알림을 못 받았다" 를 확인할 수 있는 자리입니다. 주문 알림은
 * 데이터베이스가 예약하고 1분 시계가 보냅니다(0010·0012). 그 결과가 전부
 * push_campaigns 에 적혀 있는데, 지금까지는 그것을 볼 화면이 없었습니다.
 *
 * 특히 한 가지를 드러내기 위해 있습니다: 받을 폰이 0대면 발송은 실패가 아니라
 * '완료' 로 적힙니다(시도 0, 전달 0, 오류 없음). 표만 보면 잘 나간 것처럼
 * 보이고 아무도 받지 못합니다. 이 화면은 그 줄을 빨강으로 부릅니다.
 *
 * 접힌 상태에서는 한 줄입니다 - 계산대 화면에서 자리를 차지하지 않고, 문제가
 * 있을 때만 빨간 표가 붙습니다.
 */
export function StaffAlertCheck({ ordersToday }: StaffAlertCheckProps) {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<StaffAlert[]>([]);
  const [reach, setReach] = useState<StaffReach | null>(null);
  const [reachProblem, setReachProblem] = useState<ServerProblem | null>(null);
  const [alertsToday, setAlertsToday] = useState<number | null>(null);
  const [problem, setProblem] = useState<ServerProblem | null>(null);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    // 세 가지를 따로 기다립니다. 0020 을 아직 실행하지 않은 서버에서도 알림
    // 목록은 보여야 합니다.
    const [alertResult, reachResult, todayResult] = await Promise.all([
      fetchStaffAlerts(),
      fetchStaffReach(),
      countTodayNewOrderAlerts(),
    ]);
    setProblem(alertResult.problem);
    if (alertResult.alerts) setAlerts(alertResult.alerts);
    setReach(reachResult.reach);
    setReachProblem(reachResult.problem);
    setAlertsToday(todayResult);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 접어 둔 채로도 계속 확인합니다 - 이 화면은 계산대에 하루 종일 켜져 있어서,
  // 펼칠 때만 읽으면 아침의 '정상' 표가 오후까지 그대로 붙어 있습니다. 대신
  // 접혀 있을 때는 뜸하게 봅니다.
  useEffect(() => {
    const every = open ? REFRESH_MS : IDLE_REFRESH_MS;
    const timer = window.setInterval(() => void load(), every);
    return () => window.clearInterval(timer);
  }, [open, load]);

  const test = async () => {
    setTesting(true);
    setNote('');
    const failed = await sendTestAlert();
    setTesting(false);
    if (failed) {
      setNote(PROBLEM[failed]);
      return;
    }
    setNote('테스트 알림을 예약했습니다. 1분 안에 직원 폰에 떠야 합니다 - 아래 목록의 맨 위 줄이 결과를 알려 줍니다.');
    void load();
  };

  const active = reach ? phonesOn(reach) : null;
  // 요약 표는 오늘 것만 셉니다. 목록은 최근 12건을 그대로 보여 주지만, 지난주에
  // 한 대 실패한 것이 오늘의 빨간 표로 남아 있으면 이 표를 아무도 믿지 않습니다.
  const missed = alerts.filter(
    (alert) => isToday(alert.createdAt) && isMissed(verdictOf(alert))
  ).length;
  const dispatcherDown = reach !== null && (reach.dispatcher === 'off' || reach.dispatcher === 'missing');
  // 알림 줄이 아예 안 생긴 주문. 0012 는 알림이 막혀도 주문은 받습니다.
  const unlogged = alertsToday !== null ? Math.max(0, ordersToday - alertsToday) : 0;

  const summary: { label: string; style: string } = (() => {
    const bad = 'bg-red-500/15 text-red-800 dark:text-red-200';
    const warn = 'bg-amber-500/15 text-amber-900 dark:text-amber-200';
    if (problem) return { label: '확인 불가', style: 'bg-muted text-muted-foreground' };
    if (active !== null && active.length === 0) return { label: '받는 폰 0대', style: bad };
    if (dispatcherDown) return { label: '발송 멈춤', style: bad };
    if (missed > 0) return { label: `오늘 미수신 ${missed}건`, style: bad };
    if (unlogged > 0) return { label: '알림 누락 의심', style: warn };
    return { label: '정상', style: 'bg-green-500/15 text-green-800 dark:text-green-200' };
  })();

  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <BellRing className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-semibold">직원 알림 점검</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${summary.style}`}>{summary.label}</span>
        <span className="ml-auto text-muted-foreground">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {problem && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {PROBLEM[problem]}
            </p>
          )}

          {/* ---- 받는 폰 --------------------------------------------------- */}
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">알림을 받는 직원 폰</h3>
            {reachProblem === 'missingTable' ? (
              <p className="text-sm text-muted-foreground">
                받는 폰 수는 서버에 <span className="font-mono">0020_staff_alerts.sql</span> 을 실행한 뒤에
                보입니다. 아래 알림 기록은 지금도 그대로 볼 수 있습니다.
              </p>
            ) : reachProblem ? (
              <p className="text-sm text-muted-foreground">{PROBLEM[reachProblem]}</p>
            ) : active === null ? (
              <p className="text-sm text-muted-foreground">확인 중…</p>
            ) : active.length === 0 ? (
              <p className="rounded-md bg-red-500/10 p-2.5 text-sm text-red-800 dark:text-red-200">
                <AlertTriangle className="mr-1 inline h-4 w-4" />
                알림을 받는 직원 폰이 한 대도 없습니다. 주문이 들어와도 아무 폰에도 가지 않습니다. 직원 폰에서 이
                화면 위쪽의 <strong>새 주문 알림 받기</strong> 를 눌러 주세요 (아이폰은 홈 화면에 추가한 뒤에
                됩니다).
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {active.map((phone) => (
                  <li key={phone.device} className="flex flex-wrap items-center gap-x-2 text-sm">
                    <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{phoneLabel(phone)}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      앱 마지막 사용 {when(phone.lastSeenAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* 최근에 꺼진 폰. "어제까지 받던 폰이 어제 꺼졌다" 가 답인 경우가 있습니다. */}
            {reach
              ?.phones.filter((phone) => phone.offAt !== null)
              .map((phone) => (
                <p key={phone.device} className="text-xs text-amber-800 dark:text-amber-300">
                  {phoneLabel(phone)} 는 {when(phone.offAt)} 에 알림이 꺼졌습니다 (직접 끄거나, 브라우저가 구독을
                  버린 경우입니다 - 그 폰에서 다시 켜야 합니다).
                </p>
              ))}

            {dispatcherDown && (
              <p className="rounded-md bg-red-500/10 p-2.5 text-sm text-red-800 dark:text-red-200">
                <AlertTriangle className="mr-1 inline h-4 w-4" />
                1분마다 알림을 내보내는 서버 작업이 멈춰 있습니다. 예약된 알림이 나가지 않습니다 -{' '}
                <span className="font-mono">0010_push.sql</span> 을 다시 실행해 주세요.
              </p>
            )}
          </div>

          {/* ---- 오늘 주문과 알림 수 --------------------------------------- */}
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">오늘</h3>
            <p className="text-sm text-muted-foreground">
              주문 {ordersToday}건 · 새 주문 알림 {alertsToday ?? '-'}건
            </p>
            {unlogged > 0 && (
              <p className="rounded-md bg-amber-500/10 p-2.5 text-sm text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mr-1 inline h-4 w-4" />
                알림이 만들어지지 않은 주문이 {unlogged}건 있습니다. 주문은 알림이 막혀도 받아지도록 되어
                있어서(0012), 이때는 기록조차 남지 않습니다. <span className="font-mono">0010_push.sql</span> 이
                들어가 있는지 확인해 주세요.
              </p>
            )}
          </div>

          {/* ---- 테스트 ---------------------------------------------------- */}
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void test()}
                disabled={testing}
                className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                테스트 알림 보내기
              </button>
              <button
                type="button"
                onClick={() => void load()}
                aria-label="알림 기록 새로고침"
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium"
              >
                <RefreshCw className="h-4 w-4" />
                새로고침
              </button>
            </div>
            {note && <p className="text-sm text-muted-foreground">{note}</p>}
          </div>

          {/* ---- 최근 알림 기록 -------------------------------------------- */}
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">최근 직원 알림</h3>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                직원 알림 기록이 없습니다. 위의 테스트 알림으로 지금 확인해 볼 수 있습니다.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {alerts.map((alert) => {
                  const verdict = verdictOf(alert);
                  return (
                    <li key={alert.id} className="rounded-md border border-border p-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium tabular-nums">{when(alert.createdAt)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${VERDICT[verdict].style}`}>
                          {VERDICT[verdict].label}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">{counts(alert)}</span>
                      </div>
                      <p className="mt-0.5 text-sm">{alert.title}</p>
                      {alert.body && <p className="text-xs text-muted-foreground">{alert.body}</p>}
                      {verdict === 'nobody' && (
                        <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                          보낼 때 알림을 켠 직원 폰이 없었습니다. 서버에는 '발송 완료' 로 적혀 있지만 아무도
                          받지 못했습니다.
                        </p>
                      )}
                      {verdict === 'stuck' && (
                        <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                          예약된 시각이 지났는데 나가지 않았습니다. 1분 시계(pg_cron)를 확인해 주세요.
                        </p>
                      )}
                      {alert.error && (
                        <p className="mt-1 text-xs text-red-700 dark:text-red-300">{alert.error}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {/* 서버가 아는 것과 모르는 것을 분명히 해 둡니다. 여기서 '전달' 은
                구글·애플이 받았다는 뜻입니다. */}
            <p className="text-xs text-muted-foreground">
              <Check className="mr-0.5 inline h-3 w-3" />
              '전달' 은 구글·애플의 알림 서버가 받았다는 뜻입니다. 폰이 꺼져 있으면 켤 때 옵니다(하루까지). 폰에서
              알림을 무음으로 두거나 브라우저 알림을 막아 두면 도착해도 보이지 않습니다 - 그것은 그 폰에서만
              확인할 수 있습니다.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
