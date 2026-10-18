/**
 * 직원 공지 - 전 직원 폰으로 한 번에 (마이그레이션 0019)
 *
 * 손님 발송(/admin > 예약 발송, marketing 토픽)과 같은 장치를 쓰지만 토픽이
 * 'proshop' 이라 직원 폰에만 갑니다. 보내는 길이 `send_staff_notice` 하나인
 * 이유도 그것입니다 - 토픽을 서버가 못박으므로, 보낼 권한이 있는 직원이
 * 실수로든 아니든 손님에게 보낼 방법이 없습니다.
 *
 * 권한이 두 단계입니다:
 *   직원 명부에 있으면        -> 받을 수 있습니다 (isStaff)
 *   can_broadcast 가 켜져 있으면 -> 보낼 수 있습니다 (canBroadcast)
 * 받는 것과 보내는 것은 다른 결정이라 따로 둡니다. 관리자는 둘 다입니다.
 */

import { supabase } from './supabase';
import { problemOf, type ServerProblem } from './holePaths';

export interface StaffStatus {
  isStaff: boolean;
  canBroadcast: boolean;
  /** 0019 를 아직 실행하지 않았습니다. 화면은 그렇게 말해야 합니다. */
  notInstalled: boolean;
}

const NOT_INSTALLED: StaffStatus = {
  isStaff: false,
  canBroadcast: false,
  notInstalled: true,
};

const NOT_STAFF: StaffStatus = { isStaff: false, canBroadcast: false, notInstalled: false };

/** PostgREST 가 없는 함수에 붙이는 코드. 0019 미실행과 진짜 오류를 가릅니다. */
const MISSING_FUNCTION = 'PGRST202';

/**
 * 이 계정이 직원인지, 보낼 수 있는지. 서버에 묻습니다 - 화면이 스스로
 * 판단하면 서버와 어긋나고, 어긋나는 쪽은 늘 화면입니다.
 */
export const staffStatus = async (): Promise<StaffStatus> => {
  if (!supabase) return NOT_INSTALLED;
  try {
    const [staff, broadcast] = await Promise.all([
      supabase.rpc('is_staff'),
      supabase.rpc('can_broadcast_staff'),
    ]);
    if (staff.error?.code === MISSING_FUNCTION) return NOT_INSTALLED;
    if (staff.error) return NOT_STAFF;
    return {
      isStaff: staff.data === true,
      canBroadcast: broadcast.data === true,
      notInstalled: false,
    };
  } catch {
    return NOT_STAFF;
  }
};

export interface StaffNotice {
  id: string;
  title: string;
  body: string | null;
  status: string;
  /** 실제로 몇 대에 닿았는지. 발송 함수가 끝난 뒤에 채워집니다. */
  delivered: number | null;
  attempted: number | null;
  createdAt: string;
}

/** 최근에 나간 직원 공지. 보낸 사람이 나갔는지 확인하는 유일한 창입니다. */
export const fetchStaffNotices = async (limit = 20): Promise<StaffNotice[]> => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('push_campaigns')
    .select('id, title, body, status, delivered, attempted, created_at')
    .eq('topic', 'proshop')
    .order('created_at', { ascending: false })
    .limit(limit);
  // 관리자도 직원도 아니면 정책이 빈 배열을 줍니다 - 오류가 아닙니다.
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    status: row.status as string,
    delivered: (row.delivered as number | null) ?? null,
    attempted: (row.attempted as number | null) ?? null,
    createdAt: row.created_at as string,
  }));
};

export class StaffNoticeError extends Error {
  readonly problem: ServerProblem | 'rejected';
  constructor(message: string, problem: ServerProblem | 'rejected' = 'rejected') {
    super(message);
    this.name = 'StaffNoticeError';
    this.problem = problem;
  }
}

/**
 * 전 직원에게 한 줄 보냅니다. 제목은 잠금 화면의 굵은 줄, 본문은 그 아래.
 *
 * 서버가 거절하는 경우가 전부 사람이 읽을 수 있는 말로 돌아옵니다 - 권한이
 * 없음, 제목이 빔, 1 분 안에 같은 글을 또 보냄. 그대로 화면에 보여 주면
 * 됩니다.
 */
export const sendStaffNotice = async (title: string, body: string): Promise<string> => {
  if (!supabase) throw new StaffNoticeError('이 빌드에는 서버 연결이 없습니다.', 'unavailable');
  const { data, error } = await supabase.rpc('send_staff_notice', {
    p_title: title,
    p_body: body,
  });
  if (error) {
    if (error.code === MISSING_FUNCTION) {
      throw new StaffNoticeError(
        '서버에 직원 공지가 아직 없습니다. 0019_staff_notices.sql 을 실행해 주세요.',
        'missingTable'
      );
    }
    throw new StaffNoticeError(error.message || '보내지 못했습니다.', problemOf(error));
  }
  return String(data ?? '');
};
