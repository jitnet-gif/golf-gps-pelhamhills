import { supabase } from './supabase';
import { problemOf, type ServerProblem } from './holePaths';

/**
 * 직원 알림이 갔는지 확인하기
 *
 * 주문이 들어오면 데이터베이스가 'proshop' 알림 한 건을 예약하고(0012), 1분
 * 시계가 그것을 직원 폰으로 보냅니다(0010). 그 결과는 push_campaigns 에 그대로
 * 적혀 있습니다 - 몇 대에 시도했고 몇 대가 받았고 무엇이 틀렸는지. 관리자는 그
 * 칸들을 읽을 수 있으므로(0010 의 GRANT), 이 파일은 그것을 읽어 와서 사람이
 * 읽는 판정으로 바꿉니다.
 *
 * 왜 이 화면이 필요한가: 받을 폰이 0대일 때 발송은 실패가 아닙니다. 시도 0,
 * 전달 0, 오류 없음, 상태는 '발송 완료'. 표에는 성공으로 적히고 아무도 받지
 * 못합니다. 직원이 알림을 못 받는 이유의 대부분이 이것이고, 그래서 이 파일은
 * '발송 완료 + 시도 0대' 를 초록이 아니라 빨강으로 부릅니다.
 *
 * 한 가지는 정직하게 말해 둡니다. '전달' 은 구글·애플의 푸시 서버가 받았다는
 * 뜻입니다. 그 뒤 폰이 알림을 실제로 띄웠는지는 여기서 알 수 없습니다 - 폰이
 * 꺼져 있으면 켤 때 오고(하루까지 보관), 무음이면 조용히 옵니다.
 */

/** 직원 알림에 쓰는 토픽. 손님 알림('marketing')과 나누는 값입니다. */
const TOPIC = 'proshop';

const COLUMNS =
  'id, title, body, scheduled_at, status, attempted, delivered, failed, error, started_at, completed_at, created_at';

export type AlertStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'canceled';

export interface StaffAlert {
  id: string;
  title: string;
  body: string | null;
  scheduledAt: string;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  status: AlertStatus;
  /** 보낸 폰 수 / 받은 폰 수 / 실패한 폰 수. 발송 전에는 null 입니다. */
  attempted: number | null;
  delivered: number | null;
  failed: number | null;
  error: string | null;
}

/** 이 알림이 직원에게 닿았는가. 화면의 색과 문장은 이 값으로 정해집니다. */
export type AlertVerdict =
  /** 전부 전달 */
  | 'delivered'
  /** 일부만 전달 - 폰 한 대가 실패 */
  | 'partial'
  /** 발송은 '완료' 인데 받을 폰이 없었음. 가장 흔한 미수신 원인 */
  | 'nobody'
  /** 푸시 서버가 받아 주지 않음 (키 문제, 망 문제) */
  | 'failed'
  /** 아직 나가는 중 (1분 시계를 기다리는 정상 상태) */
  | 'waiting'
  /** 예약된 채 멈춤 - 발송 시계가 돌지 않고 있음 */
  | 'stuck'
  | 'canceled';

/** 예약이 이만큼 지나도 안 나갔으면 1분 시계가 멈춘 것입니다. */
const STUCK_MS = 5 * 60 * 1000;

export const verdictOf = (alert: StaffAlert, now: number = Date.now()): AlertVerdict => {
  if (alert.status === 'canceled') return 'canceled';
  if (alert.status === 'failed') return 'failed';
  if (alert.status === 'pending' || alert.status === 'sending') {
    const since = Date.parse(alert.status === 'sending' ? (alert.startedAt ?? alert.scheduledAt) : alert.scheduledAt);
    return Number.isFinite(since) && now - since > STUCK_MS ? 'stuck' : 'waiting';
  }
  // 여기부터 status === 'sent'. 서버가 '완료' 라고 적은 것들입니다.
  const attempted = alert.attempted ?? 0;
  const delivered = alert.delivered ?? 0;
  if (attempted === 0) return 'nobody';
  if (delivered === 0) return 'failed';
  return delivered < attempted ? 'partial' : 'delivered';
};

/** 직원이 못 받은(또는 못 받을) 알림인지. 요약 줄의 경고 수를 세는 데 씁니다. */
export const isMissed = (verdict: AlertVerdict): boolean =>
  verdict === 'nobody' || verdict === 'failed' || verdict === 'stuck' || verdict === 'partial';

export interface StaffPhone {
  /** 기기 ID 앞 6자. 목록에서 폰을 구별할 만큼이고, 이것으로 알림을 보낼 수는 없습니다. */
  device: string;
  /** iPhone · Android · Windows 같은 짧은 이름. 모르면 null. */
  kind: string | null;
  /** 그 폰이 앱을 마지막으로 연 시각. 오래되었으면 그 폰은 앱을 안 열고 있습니다. */
  lastSeenAt: string | null;
  addedAt: string | null;
  /** 알림이 꺼진 시각. null 이면 지금 켜져 있습니다. */
  offAt: string | null;
}

export interface StaffReach {
  phones: StaffPhone[];
  /** 1분 시계(pg_cron)가 도는지. 'unknown' 은 확인 자체를 못 한 것입니다. */
  dispatcher: 'on' | 'off' | 'missing' | 'unknown';
}

export const phonesOn = (reach: StaffReach): StaffPhone[] => reach.phones.filter((p) => p.offAt === null);

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

interface AlertRow {
  id: string;
  title: string;
  body: string | null;
  scheduled_at: string;
  status: AlertStatus;
  attempted: number | string | null;
  delivered: number | string | null;
  failed: number | string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
}

/** 최근 직원 알림. 관리자 계정이 아니면 행 보안이 빈 목록을 돌려줍니다. */
export const fetchStaffAlerts = async (
  limit = 12
): Promise<{ alerts: StaffAlert[] | null; problem: ServerProblem | null }> => {
  if (!supabase) return { alerts: null, problem: 'unavailable' };
  try {
    const { data, error } = await supabase
      .from('push_campaigns')
      .select(COLUMNS)
      .eq('topic', TOPIC)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { alerts: null, problem: problemOf(error) };
    const alerts = ((data ?? []) as unknown as AlertRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      scheduledAt: row.scheduled_at,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status,
      attempted: num(row.attempted),
      delivered: num(row.delivered),
      failed: num(row.failed),
      error: row.error,
    }));
    return { alerts, problem: null };
  } catch (err) {
    return { alerts: null, problem: problemOf(err as { message?: string }) };
  }
};

/**
 * 지금 직원 알림을 받는 폰 (0020 의 staff_alert_reach).
 *
 * 0020 을 아직 실행하지 않은 서버에서는 problem 이 'missingTable' 로 옵니다 -
 * 화면은 그때 어느 SQL 을 실행하라고 말하고, 알림 목록은 그대로 보여 줍니다.
 */
export const fetchStaffReach = async (): Promise<{
  reach: StaffReach | null;
  problem: ServerProblem | null;
}> => {
  if (!supabase) return { reach: null, problem: 'unavailable' };
  try {
    const { data, error } = await supabase.rpc('staff_alert_reach');
    if (error) return { reach: null, problem: problemOf(error) };
    const payload = (data ?? {}) as { phones?: unknown; dispatcher?: unknown };
    const rows = Array.isArray(payload.phones) ? payload.phones : [];
    const phones = rows.map((row) => {
      const phone = (row ?? {}) as Record<string, unknown>;
      return {
        device: text(phone.device) ?? '알 수 없음',
        kind: text(phone.kind),
        lastSeenAt: text(phone.last_seen_at),
        addedAt: text(phone.added_at),
        offAt: text(phone.off_at),
      };
    });
    const dispatcher = text(payload.dispatcher);
    return {
      reach: {
        phones,
        dispatcher:
          dispatcher === 'on' || dispatcher === 'off' || dispatcher === 'missing' ? dispatcher : 'unknown',
      },
      problem: null,
    };
  } catch (err) {
    return { reach: null, problem: problemOf(err as { message?: string }) };
  }
};

/** 클럽 시각으로 오늘 0시. 주문과 알림을 같은 하루로 세기 위한 값입니다. */
const startOfToday = (): string => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
};

/**
 * 오늘 만들어진 '새 주문' 알림 수.
 *
 * 오늘 주문 수와 나란히 놓고 봅니다. 0012 의 place_food_order 는 알림 INSERT 가
 * 막혀도 주문은 받습니다(EXCEPTION WHEN others THEN NULL) - 그때는 알림 줄이
 * 아예 생기지 않아서, 이 화면이 "알림 없음" 으로 조용해집니다. 두 수가 어긋나면
 * 그것이 드러납니다.
 */
export const countTodayNewOrderAlerts = async (): Promise<number | null> => {
  if (!supabase) return null;
  const { count, error } = await supabase
    .from('push_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('topic', TOPIC)
    .like('title', 'New order%')
    .gte('created_at', startOfToday());
  return error ? null : (count ?? null);
};

/**
 * 테스트 알림 한 건 보내기.
 *
 * 이것이 이 화면의 요점입니다 - 주문이 들어올 때까지 기다리지 않고, 지금 눌러서
 * 1분 안에 직원 폰에 뜨는지 봅니다. 뜨지 않으면 목록의 그 줄이 어디서 멈췄는지
 * 말해 줍니다. 진짜 주문 알림과 같은 길(같은 토픽, 같은 시계)로 나갑니다.
 */
export const sendTestAlert = async (): Promise<ServerProblem | null> => {
  if (!supabase) return 'unavailable';
  const { error } = await supabase.from('push_campaigns').insert({
    title: 'Test alert',
    body: '직원 알림 확인용입니다. 이 알림이 보이면 정상입니다.',
    url: '/admin',
    topic: TOPIC,
    scheduled_at: new Date().toISOString(),
  });
  return error ? problemOf(error) : null;
};
