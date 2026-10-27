/**
 * 지갑 - 기프트카드와 개인 쿠폰 (pelhamhills 마이그레이션 0121_gps_wallet.sql).
 *
 * 장부는 프로 샵과 하나입니다. 기프트카드는 pelham_gift_cards(0120), 개인 쿠폰은 pelham_promotions(0078)의
 * 한 줄이고, 바코드도 프로 샵 계산서에서 찍는 그대로입니다(GIFT-… 는 결제 수단, CPN-… 는 그린피 할인).
 * 잔액·사용 여부는 모두 서버가 셉니다. 화면은 받은 그대로 그립니다.
 *
 * - 손님: my_wallet() - 자기 계정 것만.
 * - 매니저(프로 샵 기프트카드 매니저와 같은 판정): gps_wallet_* - 앱 계정 찾기, 발행, 무효, 발행 목록.
 *   캠페인 쿠폰(PROMO-)은 프로 샵 Promotions 와 같은 함수(pelham_staff_promotion_save)를 그대로 부릅니다.
 */

import { supabase } from './supabase';
import { problemOf, type ServerProblem } from './holePaths';

export type WalletState = 'active' | 'spent' | 'used' | 'expired' | 'void';

export interface WalletGiftCard {
  type: 'gift';
  code: string;
  barcode: string;
  /** 센트 */
  amount: number;
  balance: number;
  kind: 'sold' | 'complimentary';
  issuedOn: string;
  state: WalletState;
}

export interface WalletCoupon {
  type: 'coupon';
  code: string;
  barcode: string;
  name: string;
  discountKind: 'amount' | 'percent';
  /** amount 면 센트, percent 면 % */
  value: number;
  issuedOn: string;
  expiresOn: string | null;
  state: WalletState;
}

export type WalletItem = WalletGiftCard | WalletCoupon;

export interface Wallet {
  giftCards: WalletGiftCard[];
  coupons: WalletCoupon[];
}

/** 매니저 목록의 한 줄: 받은 계정과 발행 사유가 붙습니다. */
export type IssuedItem = WalletItem & {
  ownerEmail: string | null;
  note: string | null;
  issuedBy: string | null;
  voidReason: string | null;
};

export interface GuestAccount {
  ownerId: string;
  email: string;
  name: string | null;
  couponCode: string | null;
  isMember: boolean;
}

export type IssueRequest =
  | { type: 'gift'; ownerId: string; amount: number; kind: 'sold' | 'complimentary'; note: string }
  | {
      type: 'coupon';
      ownerId: string;
      name: string;
      discountKind: 'amount' | 'percent';
      value: number;
      days: number;
      note: string;
    };

export interface CampaignCoupon {
  code: string;
  barcode: string;
  name: string;
  kind: 'amount' | 'percent';
  value: number;
  per_player: boolean;
  expires_on: string | null;
  usage_limit: number | null;
  used: number;
  state: 'active' | 'paused' | 'expired' | 'scheduled' | 'used_up';
}

export class WalletError extends Error {
  readonly problem: ServerProblem | 'rejected';
  constructor(message: string, problem: ServerProblem | 'rejected' = 'rejected') {
    super(message);
    this.name = 'WalletError';
    this.problem = problem;
  }
}

/** PostgREST 가 없는 함수에 붙이는 코드 - 0121 을 아직 실행하지 않았습니다. */
const MISSING_FUNCTION = 'PGRST202';

const call = async (fn: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (!supabase) throw new WalletError('이 빌드에는 서버 연결이 없습니다.', 'unavailable');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === MISSING_FUNCTION) {
      throw new WalletError(
        '서버에 지갑이 아직 없습니다. pelhamhills 0121_gps_wallet.sql 을 실행해 주세요.',
        'missingTable'
      );
    }
    // pelham_fail(PTxxx) 과 0023 류 RAISE(P0001)는 이미 사람이 읽을 말입니다.
    const rejected = error.code === 'P0001' || /^PT\d{3}$/.test(error.code ?? '');
    throw new WalletError(error.message || '처리하지 못했습니다.', rejected ? 'rejected' : problemOf(error));
  }
  return data;
};

type Raw = Record<string, unknown>;

const toItem = (raw: Raw): WalletItem =>
  raw.type === 'gift'
    ? {
        type: 'gift',
        code: String(raw.code),
        barcode: String(raw.barcode),
        amount: Number(raw.amount ?? 0),
        balance: Number(raw.balance ?? 0),
        kind: raw.kind === 'sold' ? 'sold' : 'complimentary',
        issuedOn: String(raw.issued_on ?? ''),
        state: raw.state as WalletState,
      }
    : {
        type: 'coupon',
        code: String(raw.code),
        barcode: String(raw.barcode),
        name: String(raw.name ?? ''),
        discountKind: raw.discount_kind === 'percent' ? 'percent' : 'amount',
        value: Number(raw.value ?? 0),
        issuedOn: String(raw.issued_on ?? ''),
        expiresOn: (raw.expires_on as string | null) ?? null,
        state: raw.state as WalletState,
      };

const toIssued = (raw: Raw): IssuedItem => ({
  ...toItem(raw),
  ownerEmail: (raw.owner_email as string | null) ?? null,
  note: (raw.note as string | null) ?? null,
  issuedBy: (raw.issued_by as string | null) ?? null,
  voidReason: (raw.void_reason as string | null) ?? null,
});

const list = (raw: unknown): Raw[] => (Array.isArray(raw) ? (raw as Raw[]) : []);

// ----- 손님 -----

export const fetchMyWallet = async (): Promise<Wallet> => {
  const raw = (await call('my_wallet')) as Raw;
  return {
    giftCards: list(raw.gift_cards).map(toItem) as WalletGiftCard[],
    coupons: list(raw.coupons).map(toItem) as WalletCoupon[],
  };
};

// ----- 매니저 -----

/** 쿠폰·기프트카드 탭을 보일지. 0121 전이거나 직원이 아니면 false. */
export const walletAccess = async (): Promise<boolean> => {
  try {
    return (await call('gps_wallet_access')) === true;
  } catch {
    return false;
  }
};

export const findGuests = async (query: string): Promise<GuestAccount[]> =>
  list(await call('gps_wallet_find_guests', { p_query: query })).map((raw) => ({
    ownerId: String(raw.owner_id),
    email: String(raw.email ?? ''),
    name: (raw.name as string | null) ?? null,
    couponCode: (raw.coupon_code as string | null) ?? null,
    isMember: raw.is_member === true,
  }));

export const issueToGuest = async (request: IssueRequest): Promise<IssuedItem> => {
  const p =
    request.type === 'gift'
      ? { type: 'gift', owner_id: request.ownerId, amount: request.amount, kind: request.kind, note: request.note }
      : {
          type: 'coupon',
          owner_id: request.ownerId,
          name: request.name,
          discount_kind: request.discountKind,
          value: request.value,
          days: request.days,
          note: request.note,
        };
  return toIssued((await call('gps_wallet_issue', { p })) as Raw);
};

export const voidIssued = async (item: WalletItem, reason: string): Promise<void> => {
  await call('gps_wallet_void', { p_type: item.type, p_code: item.code, p_reason: reason });
};

export const fetchIssued = async (): Promise<IssuedItem[]> =>
  list(await call('gps_wallet_issued', { p_limit: 100 })).map(toIssued);

export const fetchCampaignCoupons = async (): Promise<CampaignCoupon[]> =>
  list(await call('pelham_staff_promotions')) as unknown as CampaignCoupon[];

export const saveCampaignCoupon = async (fields: {
  code: string;
  name: string;
  kind: 'amount' | 'percent';
  value: number;
  per_player: boolean;
  expires_on: string | null;
  usage_limit: number | null;
}): Promise<CampaignCoupon> =>
  (await call('pelham_staff_promotion_save', { p: fields })) as CampaignCoupon;

// ----- 표시 -----

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const discountLabel = (kind: 'amount' | 'percent', value: number) =>
  kind === 'percent' ? `${value}% off` : `${money(value)} off`;
