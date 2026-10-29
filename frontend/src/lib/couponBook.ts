/**
 * 쿠폰북 - 라운드 10번에 1번 무료 (마이그레이션 0023). 회원은 제외(0026).
 *
 * 도장은 체크인할 때 서버가 찍고(0027), 카운터 직원이 손으로 찍을 수도 있습니다. 손님 폰은 자기 쿠폰북과 카운터에 보여 줄
 * 여섯 자리 코드를 보기만 합니다 - 손님 폰이 찍을 수 있으면 거실에서 열 번
 * 누르면 공짜 라운드입니다.
 *
 * 숫자는 전부 서버가 셉니다(장부 줄 수). 화면은 받은 그대로 그립니다.
 */

import { supabase } from './supabase';
import { problemOf, type ServerProblem } from './holePaths';

/** 도장 몇 개에 무료 한 번. 서버(0023)의 10 과 같아야 합니다. */
export const STAMPS_PER_FREE = 10;

/** 라운드 몇 번에 기념품 하나. 서버(0029)의 100 과 같아야 합니다. */
export const ROUNDS_PER_GIFT = 100;

/** 도장 자리에 찍히는 클럽 로고 (pelhamhills frontend/public/pelham-hills/club-logo.png 사본). */
export const STAMP_LOGO = '/club-logo.png';

export interface CouponEntry {
  /** cart_credit/cart_redeem 은 친구 소개 카트 무료(0025), gift 는 100라운드 기념품(0029) */
  kind: 'stamp' | 'redeem' | 'cart_credit' | 'cart_redeem' | 'gift';
  at: string;
}

export interface CouponBook {
  code: string | null;
  /** 회원은 도장이 없습니다(0026) - 회원권으로 칩니다. */
  isMember: boolean;
  /** 친구 소개 보상을 받을 수 있는가. 멤버는 아닙니다(0028). */
  canRefer: boolean;
  stamps: number;
  /** 지금 판 위에 있는 도장, 0..9 */
  onCard: number;
  freeLeft: number;
  redeemed: number;
  stampedToday: boolean;
  /** 누적 라운드 = 도장 + 쓴 무료 (0029) */
  rounds: number;
  /** 받을 기념품 수, 다음 기념품까지 남은 라운드, 받은 기념품 수 */
  giftDue: number;
  roundsToGift: number;
  giftsGiven: number;
  /** 친구 소개로 쌓인, 아직 안 쓴 카트 무료 */
  cartsLeft: number;
  cartsUsed: number;
  /** 소개한 친구 중 첫 라운드를 친 수 / 아직 안 온 수 */
  friendsRewarded: number;
  friendsPending: number;
  /** 소개 코드를 넣을 수 있는가(도장이 없고, 아직 안 넣었음) */
  canEnterReferral: boolean;
  history: CouponEntry[];
}

/** 직원이 찾은 손님. 쿠폰북에 계정 정보가 붙습니다. */
export interface CouponHolder extends CouponBook {
  ownerId: string;
  email: string | null;
  /** 방금 찍은 도장이 친구의 첫 도장이면, 카트 무료를 받은 소개자 이메일 */
  referralRewarded?: string;
}

export class CouponError extends Error {
  readonly problem: ServerProblem | 'rejected';
  constructor(message: string, problem: ServerProblem | 'rejected' = 'rejected') {
    super(message);
    this.name = 'CouponError';
    this.problem = problem;
  }
}

/** PostgREST 가 없는 함수에 붙이는 코드 - 0023 을 아직 실행하지 않았습니다. */
const MISSING_FUNCTION = 'PGRST202';

const toBook = (raw: Record<string, unknown>): CouponBook => ({
  code: (raw.code as string | null) ?? null,
  isMember: raw.is_member === true,
  // 0028 전 서버는 이 값을 주지 않습니다 - 그때는 멤버가 아닌 사람만 소개할 수 있게 둡니다.
  canRefer: raw.can_refer === undefined ? raw.is_member !== true : raw.can_refer === true,
  stamps: Number(raw.stamps ?? 0),
  onCard: Number(raw.on_card ?? 0),
  freeLeft: Number(raw.free_left ?? 0),
  redeemed: Number(raw.redeemed ?? 0),
  stampedToday: raw.stamped_today === true,
  // 0029 전 서버는 rounds 를 주지 않습니다 - 그때는 도장 + 사용으로 셉니다.
  rounds: Number(raw.rounds ?? Number(raw.stamps ?? 0) + Number(raw.redeemed ?? 0)),
  giftDue: Number(raw.gift_due ?? 0),
  roundsToGift: Number(raw.rounds_to_gift ?? ROUNDS_PER_GIFT),
  giftsGiven: Number(raw.gifts_given ?? 0),
  cartsLeft: Number(raw.carts_left ?? 0),
  cartsUsed: Number(raw.carts_used ?? 0),
  friendsRewarded: Number(raw.friends_rewarded ?? 0),
  friendsPending: Number(raw.friends_pending ?? 0),
  canEnterReferral: raw.can_enter_referral === true,
  history: Array.isArray(raw.history) ? (raw.history as CouponEntry[]) : [],
});

const toHolder = (raw: Record<string, unknown>): CouponHolder => ({
  ...toBook(raw),
  ownerId: raw.owner_id as string,
  email: (raw.email as string | null) ?? null,
});

const call = async (fn: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (!supabase) throw new CouponError('이 빌드에는 서버 연결이 없습니다.', 'unavailable');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === MISSING_FUNCTION) {
      throw new CouponError(
        '서버에 쿠폰북이 아직 없습니다. 0023_coupon_book.sql 을 실행해 주세요.',
        'missingTable'
      );
    }
    // 서버가 일부러 거절한 것(P0001)은 이미 사람이 읽을 말입니다.
    const problem = error.code === 'P0001' ? 'rejected' : problemOf(error);
    throw new CouponError(error.message || '처리하지 못했습니다.', problem);
  }
  return data;
};

/** 손님: 내 쿠폰북. 처음 부르면 서버가 코드를 만듭니다. */
export const fetchMyCouponBook = async (): Promise<CouponBook> =>
  toBook((await call('my_coupon_book')) as Record<string, unknown>);

/** 직원: 코드나 이메일로 찾기. 못 찾으면 null. */
export const lookupCouponHolder = async (query: string): Promise<CouponHolder | null> => {
  const data = await call('coupon_lookup', { p_query: query });
  return data ? toHolder(data as Record<string, unknown>) : null;
};

/** 손님: 나를 소개한 친구의 코드를 넣습니다(첫 라운드 전, 한 번만). */
export const setReferrer = async (code: string): Promise<CouponBook> =>
  toBook((await call('coupon_set_referrer', { p_code: code })) as Record<string, unknown>);

const act =
  (fn: 'coupon_stamp' | 'coupon_redeem' | 'coupon_redeem_cart' | 'coupon_gift' | 'coupon_undo') =>
  async (holder: CouponHolder): Promise<CouponHolder> => {
    const raw = (await call(fn, { p_owner: holder.ownerId })) as Record<string, unknown>;
    return {
      ...toBook(raw),
      ownerId: holder.ownerId,
      email: holder.email,
      referralRewarded: (raw.referral_rewarded as string | undefined) ?? undefined,
    };
  };

export const addCouponStamp = act('coupon_stamp');
export const redeemFreeRound = act('coupon_redeem');
export const redeemFreeCart = act('coupon_redeem_cart');
export const giveSouvenir = act('coupon_gift');
export const undoCouponEntry = act('coupon_undo');
