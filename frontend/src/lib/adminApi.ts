/**
 * 관리자 화면의 서버 호출
 *
 * 배너·성과(migration 0009)와 예약 발송(0010)은 Supabase 에 직접 붙습니다.
 * 스코어카드·코스 지도와 같은 길입니다: 관리자 계정으로 로그인한 세션으로 읽고
 * 쓰고, 누가 관리자인지는 서버가 scorecard_admins 표로 정합니다. 화면이 먼저
 * 거르는 것은 편의일 뿐이고, 관리자가 아닌 계정의 쓰기는 데이터베이스가 거절합니다.
 */

import { supabase } from './supabase';
import { problemOf } from './holePaths';

// ============================================================
// 에러
// ============================================================

/** 로그인 세션이 없는 경우. 화면은 로그인 칸을 보여 줍니다. */
export class AdminAuthError extends Error {
  constructor(message = '관리자 계정으로 로그인해 주세요.') {
    super(message);
    this.name = 'AdminAuthError';
  }
}

export class AdminApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/** 화면에 그대로 띄울 수 있는 한 줄짜리 설명 */
export function describeError(error: unknown): string {
  if (error instanceof AdminAuthError) return error.message;
  if (error instanceof AdminApiError) return error.message;
  return '요청을 보내지 못했습니다. 네트워크를 확인해 주세요.';
}

const NOT_ADMIN = '이 계정은 관리자로 지정되지 않아 바꿀 수 없습니다.';

/** Supabase 에러를 운영자가 할 일로 바꿔 말합니다. */
function explain(error: { code?: string; message?: string }, migration: string): AdminApiError {
  // promotions_window_valid. 폼이 먼저 막지만, 다른 기기에서 고친 값과 섞일 때를 대비합니다.
  if (error.code === '23514') return new AdminApiError('종료 시각은 시작 시각보다 뒤여야 합니다.');
  switch (problemOf(error)) {
    case 'missingTable':
      return new AdminApiError(
        `서버에 필요한 표가 아직 없습니다. ${migration} 을 Supabase SQL Editor 에서 실행해 주세요.`,
      );
    case 'notAdmin':
      return new AdminApiError(NOT_ADMIN);
    case 'network':
      return new AdminApiError('인터넷 연결이 없어 서버에 닿지 못했습니다.');
    default:
      return new AdminApiError(`서버가 요청을 거절했습니다. (${error.message ?? error.code ?? '알 수 없음'})`);
  }
}

/** 로그인된 클라이언트. 세션이 없으면 요청을 보내기 전에 멈춥니다. */
async function signedInClient() {
  if (!supabase) throw new AdminApiError('이 빌드에는 서버 연결이 없습니다.');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new AdminAuthError();
  return supabase;
}

/**
 * 이 계정이 관리자인지. '모름'(error)을 '아니다'로 뭉개지 않습니다 - 신호가 약한
 * 클럽하우스에서 관리자에게 "관리자가 아닙니다"라고 말하면 엉뚱한 곳을 고치게 됩니다.
 */
export async function adminStatus(): Promise<'admin' | 'notAdmin' | 'error'> {
  if (!supabase) return 'error';
  try {
    const { data, error } = await supabase.rpc('is_scorecard_admin');
    if (error) return 'error';
    return data === true ? 'admin' : 'notAdmin';
  } catch {
    return 'error';
  }
}

// ============================================================
// 타입
// ============================================================

export type PromotionPlacement = 'home' | 'scorecard';

export type CampaignStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'canceled';

export interface AdminPromotion {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
  placement: PromotionPlacement;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  created_at: string | null;
}

/** 등록/수정에 보내는 값. 수정은 바뀐 필드만 담아도 됩니다. */
export interface PromotionInput {
  title?: string;
  body?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  placement?: PromotionPlacement;
  priority?: number;
  starts_at?: string | null;
  ends_at?: string | null;
  active?: boolean;
}

export interface PromotionStat {
  promotion_id: string;
  title: string;
  placement: PromotionPlacement;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  impressions: number;
  clicks: number;
  dismissals: number;
  click_rate_pct: number | null;
}

export interface Campaign {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  image_url: string | null;
  promotion_id: string | null;
  topic: string;
  scheduled_at: string;
  status: CampaignStatus;
  attempted: number | null;
  delivered: number | null;
  failed: number | null;
  error: string | null;
  created_at: string | null;
}

/**
 * 예약 한 건. 배너에서 가져온 예약도 제목·내용을 채워서 보냅니다 - 서버는 적힌
 * 그대로 보내므로, 나중에 배너를 고치거나 지워도 예약한 내용이 바뀌지 않습니다.
 */
export interface CampaignInput {
  title: string;
  body?: string | null;
  url?: string | null;
  image_url?: string | null;
  promotion_id?: string | null;
  /** ISO 8601. datetime-local 값을 그대로 넣지 마세요 - localInputToIso()를 거칩니다. */
  scheduled_at: string;
}

const count = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

// ---- 배너 -------------------------------------------------

const PROMOTION_COLUMNS =
  'id, title, body, image_url, link_url, placement, priority, starts_at, ends_at, active, created_at';

const PROMOTIONS_SQL = '0009_promotions.sql';

export async function listPromotions(): Promise<AdminPromotion[]> {
  const db = await signedInClient();
  const { data, error } = await db
    .from('promotions')
    .select(PROMOTION_COLUMNS)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw explain(error, PROMOTIONS_SQL);
  return (data ?? []) as AdminPromotion[];
}

export async function createPromotion(input: PromotionInput): Promise<void> {
  const db = await signedInClient();
  const { error } = await db.from('promotions').insert(input);
  if (error) throw explain(error, PROMOTIONS_SQL);
}

/**
 * 행 보안은 관리자가 아닌 계정의 수정·삭제를 에러가 아니라 "0행"으로 끝냅니다.
 * 바뀐 행을 돌려받아 0이면 이유를 가려 말합니다.
 */
async function touchedNothing(gone: string): Promise<AdminApiError> {
  return (await adminStatus()) === 'notAdmin' ? new AdminApiError(NOT_ADMIN) : new AdminApiError(gone);
}

export async function updatePromotion(id: string, input: PromotionInput): Promise<void> {
  const db = await signedInClient();
  const { data, error } = await db.from('promotions').update(input).eq('id', id).select('id');
  if (error) throw explain(error, PROMOTIONS_SQL);
  if (!data?.length) throw await touchedNothing('이미 지워진 배너입니다. 목록을 새로 고쳐 주세요.');
}

export async function deletePromotion(id: string): Promise<void> {
  const db = await signedInClient();
  const { data, error } = await db.from('promotions').delete().eq('id', id).select('id');
  if (error) throw explain(error, PROMOTIONS_SQL);
  if (!data?.length) throw await touchedNothing('이미 지워진 배너입니다. 목록을 새로 고쳐 주세요.');
}

// ---- 집계 -------------------------------------------------

export async function fetchPromotionStats(): Promise<PromotionStat[]> {
  const db = await signedInClient();
  const { data, error } = await db.rpc('promotion_stats');
  if (error) throw explain(error, PROMOTIONS_SQL);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    promotion_id: String(row.promotion_id ?? ''),
    title: String(row.title ?? ''),
    placement: row.placement === 'scorecard' ? 'scorecard' : 'home',
    active: row.active !== false,
    starts_at: (row.starts_at as string | null) ?? null,
    ends_at: (row.ends_at as string | null) ?? null,
    impressions: count(row.impressions),
    clicks: count(row.clicks),
    dismissals: count(row.dismissals),
    // 보인 적이 없으면 NULL 입니다. 0% 로 바꾸지 않습니다 - '아직 모른다'와
    // '눌리지 않았다'는 다른 이야기입니다.
    click_rate_pct: row.click_rate_pct === null || row.click_rate_pct === undefined ? null : Number(row.click_rate_pct),
  }));
}

// ---- 예약 발송 --------------------------------------------

const CAMPAIGN_COLUMNS =
  'id, title, body, url, image_url, promotion_id, topic, scheduled_at, status, ' +
  'attempted, delivered, failed, error, created_at';

const PUSH_SQL = '0010_push.sql';

export async function listCampaigns(): Promise<Campaign[]> {
  const db = await signedInClient();
  const { data, error } = await db
    .from('push_campaigns')
    .select(CAMPAIGN_COLUMNS)
    .order('scheduled_at', { ascending: false })
    .limit(100);
  if (error) throw explain(error, PUSH_SQL);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as Campaign),
    attempted: row.attempted === null ? null : count(row.attempted),
    delivered: row.delivered === null ? null : count(row.delivered),
    failed: row.failed === null ? null : count(row.failed),
  }));
}

export async function createCampaign(input: CampaignInput): Promise<void> {
  const db = await signedInClient();
  const { error } = await db.from('push_campaigns').insert({
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    image_url: input.image_url ?? null,
    promotion_id: input.promotion_id ?? null,
    scheduled_at: input.scheduled_at,
  });
  if (error) throw explain(error, PUSH_SQL);
}

export async function cancelCampaign(id: string): Promise<void> {
  const db = await signedInClient();
  const { data, error } = await db.rpc('cancel_push_campaign', { p_id: id });
  if (error) throw explain(error, PUSH_SQL);
  if (data === 'not_pending') throw new AdminApiError('이미 발송이 시작되어 취소할 수 없습니다.');
  if (data === 'not_found') throw new AdminApiError('이미 지워진 예약입니다. 목록을 새로 고쳐 주세요.');
}

/** 지금 알림을 받는 폰 수. 모르면 null - 화면은 숫자 자리를 비워 둡니다. */
export async function pushSubscriberCount(): Promise<number | null> {
  const db = await signedInClient();
  const { data, error } = await db.rpc('push_subscriber_count');
  return error || typeof data !== 'number' ? null : data;
}

// ============================================================
// 시각 다루기
// ============================================================

/**
 * datetime-local 값 -> ISO 8601
 *
 * 입력창이 내놓는 "2026-09-08T14:30"에는 타임존이 없습니다. 그대로 보내면
 * 서버는 UTC로 읽고, 온타리오에서 찍은 오후 두 시가 오전 열 시에 나갑니다.
 * new Date()가 이 문자열을 로컬 시각으로 해석하니, toISOString()을 한 번
 * 거쳐 오프셋을 붙여 보냅니다.
 */
export function localInputToIso(value: string): string | null {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * ISO 8601 -> datetime-local 값
 *
 * toISOString().slice(0, 16)은 UTC 문자열이라 입력창에 넣으면 시차만큼
 * 밀립니다. 수정 폼이 저장된 시각과 다른 값을 보여 주면 손대지 않은
 * 필드가 저장할 때마다 조금씩 어긋납니다.
 */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** 목록에 찍는 시각. 서버는 UTC로 주지만 운영자는 이 기기의 시각으로 봅니다. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
