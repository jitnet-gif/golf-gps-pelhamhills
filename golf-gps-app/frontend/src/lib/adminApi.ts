/**
 * 관리자 API 호출
 *
 * 배너/집계/예약 발송은 모두 Worker(`/api/admin/*`)를 거칩니다. 배너 조회와
 * 달리 Supabase에 직접 붙을 수 없습니다 - push_campaigns와 promotion_events는
 * 공개 정책도 GRANT도 없는 service_role 전용 테이블이고, 배너 쓰기 역시
 * 마찬가지입니다.
 *
 * 모든 요청에는 X-Admin-Key가 붙습니다. 이 키 하나가 전체 발송 권한이라
 * 저장 위치와 만료를 아래 getAdminKey() 주석에서 따로 다룹니다.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? '';

const ADMIN_KEY_STORAGE = 'golf_gps_admin_key';

// ============================================================
// 관리자 키 보관
// ============================================================

/**
 * 관리자 키는 sessionStorage에만 둡니다.
 *
 * localStorage였다면 탭을 닫고 브라우저를 껐다 켜도 키가 남습니다. 이 키는
 * 구독자 전원에게 알림을 쏠 수 있는 권한이고, 프런트 데스크의 공용 PC나
 * 운영자의 휴대폰을 다음 사람이 열었을 때 그 권한까지 넘어가면 안 됩니다.
 * 탭을 닫으면 사라지는 쪽이 맞고, 다시 넣는 수고는 그 대가로 충분히 쌉니다.
 */
export function getAdminKey(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE);
  } catch {
    // 저장이 막힌 브라우저에서는 이번 화면에서만 쓰고 버립니다.
    return null;
  }
}

export function setAdminKey(key: string): void {
  try {
    sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  } catch {
    /* 저장에 실패해도 이번 요청은 넘어온 키로 나갑니다. */
  }
}

export function clearAdminKey(): void {
  try {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    /* 지울 것이 없으면 그대로 둡니다. */
  }
}

// ============================================================
// 에러
// ============================================================

/** 키가 없거나 서버가 401을 돌려준 경우. 화면은 키 입력으로 되돌아갑니다. */
export class AdminAuthError extends Error {
  constructor(message = '관리자 키가 올바르지 않습니다.') {
    super(message);
    this.name = 'AdminAuthError';
  }
}

export class AdminApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/** 화면에 그대로 띄울 수 있는 한 줄짜리 설명 */
export function describeError(error: unknown): string {
  if (error instanceof AdminAuthError) return error.message;
  if (error instanceof AdminApiError) return error.message;
  // 네트워크가 끊겼거나 Worker 주소가 안 잡힌 경우가 대부분입니다.
  return '요청을 보내지 못했습니다. 네트워크를 확인해 주세요.';
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
  title: string | null;
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

export interface CampaignInput {
  title?: string | null;
  body?: string | null;
  url?: string | null;
  image_url?: string | null;
  promotion_id?: string | null;
  topic?: string;
  /** ISO 8601. datetime-local 값을 그대로 넣지 마세요 - localInputToIso()를 거칩니다. */
  scheduled_at: string;
}

// ============================================================
// 표기 맞추기
// ============================================================

/**
 * 요청 본문에 snake_case와 camelCase를 함께 싣습니다.
 *
 * 이 저장소는 두 표기가 섞여 있습니다 - 배너 응답은 image_url인데 발송 요청
 * 스키마(schemas/push.ts)는 imageUrl을 받습니다. 관리 API는 다른 손이 쓰고
 * 있어 어느 쪽인지 여기서 정할 수 없고, 틀리면 화면이 통째로 죽습니다.
 * 이 저장소의 zod 스키마에는 .strict()가 한 군데도 없어 모르는 키는 조용히
 * 버려지므로, 둘 다 보내고 서버가 아는 쪽만 쓰게 둡니다.
 */
const CAMEL_ALIASES: Record<string, string> = {
  image_url: 'imageUrl',
  link_url: 'linkUrl',
  starts_at: 'startsAt',
  ends_at: 'endsAt',
  promotion_id: 'promotionId',
  scheduled_at: 'scheduledAt',
};

function withAliases(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  for (const [snake, camel] of Object.entries(CAMEL_ALIASES)) {
    if (snake in body) out[camel] = body[snake];
  }
  return out;
}

type RawRow = Record<string, unknown>;

/** 응답에서 값 하나 꺼내기. 서버가 어느 표기를 쓰든 같은 값을 봅니다. */
function field(row: RawRow, snake: string): unknown {
  const camel = CAMEL_ALIASES[snake];
  const value = row[snake];
  if (value !== undefined && value !== null) return value;
  return camel ? row[camel] : value;
}

function str(row: RawRow, key: string): string | null {
  const value = field(row, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(row: RawRow, key: string): number {
  const value = field(row, key);
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 목록 응답 꺼내기
 *
 * 이 저장소의 GET 라우트는 `{ data: [...] }`로 감싸지만, 관리 API가 배열을
 * 그대로 돌려주더라도 화면이 빈 목록으로 보이지는 않게 둘 다 받습니다.
 */
function unwrapList(payload: unknown): RawRow[] {
  if (Array.isArray(payload)) return payload as RawRow[];
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as RawRow[];
  }
  return [];
}

function toPromotion(row: RawRow): AdminPromotion {
  return {
    id: String(field(row, 'id') ?? ''),
    title: str(row, 'title') ?? '',
    body: str(row, 'body'),
    image_url: str(row, 'image_url'),
    link_url: str(row, 'link_url'),
    placement: (str(row, 'placement') as PromotionPlacement) ?? 'home',
    priority: num(row, 'priority'),
    starts_at: str(row, 'starts_at'),
    ends_at: str(row, 'ends_at'),
    // active가 빠진 응답을 '내려간 배너'로 그리면 운영자가 놀랍니다. 기본은 노출입니다.
    active: field(row, 'active') !== false,
    created_at: str(row, 'created_at'),
  };
}

function toStat(row: RawRow): PromotionStat {
  const rate = field(row, 'click_rate_pct');
  return {
    promotion_id: String(field(row, 'promotion_id') ?? field(row, 'id') ?? ''),
    title: str(row, 'title') ?? '',
    placement: (str(row, 'placement') as PromotionPlacement) ?? 'home',
    active: field(row, 'active') !== false,
    starts_at: str(row, 'starts_at'),
    ends_at: str(row, 'ends_at'),
    impressions: num(row, 'impressions'),
    clicks: num(row, 'clicks'),
    dismissals: num(row, 'dismissals'),
    // 노출이 0이면 뷰가 NULL을 줍니다. 0%로 바꾸지 않습니다 - '아직 모른다'와
    // '눌리지 않았다'는 다른 이야기입니다.
    click_rate_pct: rate === null || rate === undefined ? null : Number(rate),
  };
}

function toCampaign(row: RawRow): Campaign {
  const count = (key: string): number | null => {
    const value = field(row, key);
    return value === null || value === undefined ? null : num(row, key);
  };

  return {
    id: String(field(row, 'id') ?? ''),
    title: str(row, 'title'),
    body: str(row, 'body'),
    url: str(row, 'url'),
    image_url: str(row, 'image_url'),
    promotion_id: str(row, 'promotion_id'),
    topic: str(row, 'topic') ?? 'marketing',
    scheduled_at: str(row, 'scheduled_at') ?? '',
    status: (str(row, 'status') as CampaignStatus) ?? 'pending',
    attempted: count('attempted'),
    delivered: count('delivered'),
    failed: count('failed'),
    error: str(row, 'error'),
    created_at: str(row, 'created_at'),
  };
}

// ============================================================
// 요청
// ============================================================

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const key = getAdminKey();
  if (!key) throw new AdminAuthError('관리자 키를 입력해 주세요.');

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': key,
      ...init?.headers,
    },
  }).catch(() => {
    throw new AdminApiError('요청을 보내지 못했습니다. 네트워크를 확인해 주세요.', 0);
  });

  if (response.status === 401) {
    // 틀린 키를 들고 계속 두드려 봐야 같은 답만 돌아옵니다. 지우고 다시 받습니다.
    clearAdminKey();
    throw new AdminAuthError();
  }

  // 본문이 없는 응답(204, DELETE)에서 json()은 그냥 던집니다.
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string'
        ? (payload as { message: string }).message
        : null) ?? `요청이 실패했습니다. (${response.status})`;
    throw new AdminApiError(message, response.status);
  }

  return payload;
}

// ---- 배너 -------------------------------------------------

export async function listPromotions(): Promise<AdminPromotion[]> {
  return unwrapList(await request('/api/admin/promotions')).map(toPromotion);
}

export async function createPromotion(input: PromotionInput): Promise<void> {
  await request('/api/admin/promotions', {
    method: 'POST',
    body: JSON.stringify(withAliases(input as Record<string, unknown>)),
  });
}

export async function updatePromotion(id: string, input: PromotionInput): Promise<void> {
  await request(`/api/admin/promotions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(withAliases(input as Record<string, unknown>)),
  });
}

export async function deletePromotion(id: string): Promise<void> {
  await request(`/api/admin/promotions/${id}`, { method: 'DELETE' });
}

// ---- 집계 -------------------------------------------------

export async function fetchPromotionStats(): Promise<PromotionStat[]> {
  return unwrapList(await request('/api/admin/promotions/stats')).map(toStat);
}

// ---- 예약 발송 --------------------------------------------

export async function listCampaigns(): Promise<Campaign[]> {
  return unwrapList(await request('/api/admin/campaigns')).map(toCampaign);
}

export async function createCampaign(input: CampaignInput): Promise<void> {
  await request('/api/admin/campaigns', {
    method: 'POST',
    body: JSON.stringify(withAliases(input as unknown as Record<string, unknown>)),
  });
}

export async function cancelCampaign(id: string): Promise<void> {
  await request(`/api/admin/campaigns/${id}`, { method: 'DELETE' });
}

// ============================================================
// 시각 다루기
// ============================================================

/**
 * datetime-local 값 -> ISO 8601
 *
 * 입력창이 내놓는 "2026-09-08T14:30"에는 타임존이 없습니다. 그대로 보내면
 * 서버는 UTC로 읽고, 한국에서 찍은 오후 두 시가 밤 열한 시에 나갑니다.
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

/** 목록에 찍는 시각. 서버는 UTC로 주지만 운영자는 한국 시각으로 봅니다. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
