/**
 * 앱 가입 - 회원은 멤버십 카드 등록, 비회원은 쿠폰북 등록 (마이그레이션 0031).
 *
 * 계정은 기존 이메일 + 비밀번호(lib/auth) 그대로이고, 이 파일은 그 계정에 프로필을 붙입니다.
 * 쿠폰북은 어느 쪽으로 가입하든 서버가 함께 만듭니다.
 *
 * 회원권 바코드(MEM-)는 계산서에서 시뮬레이터 시간을 쓰는 코드입니다(pelhamhills 0151).
 * 서버는 등록한 계정의, 완납한 회원권일 때만 내려줍니다.
 */

import { supabase } from './supabase';
import { problemOf, type ServerProblem } from './holePaths';

export type JoinKind = 'member' | 'guest';

export interface MemberCard {
  memberName: string;
  membershipType: string;
  season: number;
  memberNumber: string | null;
  /** 완납 전에는 null */
  memberCode: string | null;
  paidInFull: boolean;
  expiresOn: string | null;
  simHoursLeft: number;
  simExpiresOn: string | null;
}

export interface MyProfile {
  /** null 이면 아직 /join 을 안 거친 계정 */
  kind: JoinKind | null;
  name: string | null;
  isMember: boolean;
  couponCode: string | null;
  card: MemberCard | null;
}

export class MembershipError extends Error {
  readonly problem: ServerProblem | 'rejected';
  constructor(message: string, problem: ServerProblem | 'rejected' = 'rejected') {
    super(message);
    this.name = 'MembershipError';
    this.problem = problem;
  }
}

/** PostgREST 가 없는 함수에 붙이는 코드 - 0031 을 아직 실행하지 않았습니다. */
const MISSING_FUNCTION = 'PGRST202';

const toCard = (raw: Record<string, unknown>): MemberCard => ({
  memberName: raw.member_name as string,
  membershipType: raw.membership_type as string,
  season: Number(raw.season),
  memberNumber: (raw.member_number as string | null) ?? null,
  memberCode: (raw.member_code as string | null) ?? null,
  paidInFull: raw.paid_in_full === true,
  expiresOn: (raw.expires_on as string | null) ?? null,
  simHoursLeft: Number(raw.sim_hours_left ?? 0),
  simExpiresOn: (raw.sim_expires_on as string | null) ?? null,
});

const toProfile = (raw: Record<string, unknown>): MyProfile => ({
  kind: (raw.kind as JoinKind | null) ?? null,
  name: (raw.name as string | null) ?? null,
  isMember: raw.is_member === true,
  couponCode: (raw.coupon_code as string | null) ?? null,
  card: raw.card ? toCard(raw.card as Record<string, unknown>) : null,
});

const call = async (fn: string, args?: Record<string, unknown>): Promise<MyProfile> => {
  if (!supabase) throw new MembershipError('This build has no server connection.', 'unavailable');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === MISSING_FUNCTION) {
      throw new MembershipError('Sign-up is not set up on the server yet.', 'missingTable');
    }
    // 서버가 일부러 거절한 것(P0001)은 이미 사람이 읽을 말입니다.
    const problem = error.code === 'P0001' ? 'rejected' : problemOf(error);
    throw new MembershipError(error.message || 'Something went wrong.', problem);
  }
  const raw = data as Record<string, unknown>;
  // 틀린 횟수를 남기려고 서버가 raise 대신 {error} 로 돌려줍니다.
  if (typeof raw.error === 'string') throw new MembershipError(raw.error);
  return toProfile(raw);
};

export const fetchMyProfile = (): Promise<MyProfile> => call('gps_my_profile');

/** 비회원 가입: 프로필 + 쿠폰북. */
export const joinAsGuest = (name: string, phone: string): Promise<MyProfile> =>
  call('gps_join_guest', { p_name: name, p_phone: phone });

/** 회원 등록: 카드 값(MEM- 바코드 또는 회원 번호)과 전화가 기록과 맞아야 합니다. 바코드면 가입 이메일이 맞아도 됩니다. */
export const joinAsMember = (card: string, phone: string): Promise<MyProfile> =>
  call('gps_join_member', { p_card: card, p_phone: phone });

const TYPE_LABEL: Record<string, string> = {
  full: 'Full',
  weekday: 'Weekday',
  intermediate: 'Intermediate',
  nine_hole: '9-Hole',
  twilight: 'Twilight',
};

export const membershipLabel = (type: string) =>
  TYPE_LABEL[type] ?? type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
