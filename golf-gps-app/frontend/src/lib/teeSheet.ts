/**
 * GPS 앱에서 **티 시트 예약 서버**(FastAPI `backend/api/routes/tee_sheet.py`)로
 * 나가는 단 하나의 클라이언트.
 *
 * `lib/api.ts` 의 axios 클라이언트를 쓰지 않는 이유가 둘 있다.
 *  1. 그쪽은 Cloudflare Worker(`VITE_API_URL`, 기본 :8787)를 가리킨다. 티 시트는
 *     완전히 다른 백엔드다. 개발 서버의 `/api` 프록시도 Worker 로 간다.
 *  2. 그쪽 인터셉터는 `auth_token` 을 Authorization 헤더로 붙인다. 손님 예약에는
 *     토큰이 없고, 남의 서버에 우리 토큰을 흘릴 이유도 없다.
 *
 * 계약의 원본은 웹사이트 쪽 `frontend/lib/teeSheet/{api,types}.ts` 다. 여기서는
 * GPS 앱이 실제로 쓰는 부분(슬롯 조회 / 그날 예약 조회 / 예약 생성)만 옮겼다.
 */

// ===== 주소 해석 ========================================================
//
// 웹사이트의 `frontend/lib/apiHost.ts` 와 같은 규칙이다. `VITE_*` 값은 빌드 때
// 번들에 박히므로, 개발 기본값인 localhost 가 그대로 배포되면 방문자의 브라우저가
// **자기 컴퓨터의** 8000 포트를 두드린다. 그래서 loopback 주소는 loopback 페이지
// 에서만 유효한 것으로 취급하고, 아니면 "설정 안 됨"(빈 문자열)으로 떨어뜨린다.

const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)$/i;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function servedLocally(): boolean {
  if (typeof window === 'undefined') return false;
  return LOOPBACK.test(window.location.hostname);
}

/**
 * `/api/v1` 까지 붙은 베이스 주소. 이 브라우저에서 쓸 수 없으면 빈 문자열.
 *
 * 모듈 상수로 굳히지 않는다 — 값이 아니라 "여기서 쓸 수 있는가" 가 답이고,
 * 그건 브라우저에서만 판단할 수 있다.
 */
export function teeSheetBaseUrl(): string {
  const configured = (import.meta.env.VITE_TEE_SHEET_API_URL ?? '').replace(/\/+$/, '');
  const base = configured || 'http://localhost:8000/api/v1';
  return LOOPBACK.test(hostnameOf(base)) && !servedLocally() ? '' : base;
}

/** 예약 서버가 없는 배포에서 손님에게 보여줄 문구. 서버 주소는 절대 넣지 않는다. */
export const NO_BOOKING_MESSAGE =
  'Online booking is not available in this app yet. Please call the pro shop at 905-735-6768.';

export const PRO_SHOP_PHONE = '905-735-6768';
export const PRO_SHOP_PHONE_HREF = 'tel:+19057356768';

// ===== 계약 ============================================================

export type BookingStatus =
  | 'reserved'
  | 'checked_in'
  | 'paid'
  | 'cancelled'
  | 'no_show'
  | 'blocked';

export type TeeSlot = {
  /** "6:58 AM" 꼴의 슬롯 라벨. 예약을 만들 때 이 문자열을 그대로 돌려보낸다. */
  time: string;
  /** 자정 기준 분. 안정적인 정렬 키. */
  minutes: number;
  rate: number;
  cartsTotal: number;
};

export type SlotsResponse = {
  date: string;
  slots: TeeSlot[];
};

export type TeeBookingPlayer = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export type TeeBooking = {
  id: string;
  /** ISO 날짜 "YYYY-MM-DD" */
  date: string;
  time: string;
  holes: 9 | 18;
  rate: number;
  title: string;
  status: BookingStatus;
  cartCount: number;
  notes: string;
  players: TeeBookingPlayer[];
};

export type NewPlayerInput = {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  type?: 'Guest' | 'Existing Customer';
};

export type CreateBookingInput = {
  date: string;
  time: string;
  title: string;
  holes?: 9 | 18;
  cartCount?: number;
  notes?: string;
  players: NewPlayerInput[];
};

// ===== 요청 ============================================================

export class TeeSheetError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TeeSheetError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = teeSheetBaseUrl();
  // 주소가 없으면 요청을 흉내내지 않는다. status 0 은 화면이 이미 "못 닿았다"로
  // 읽는 값이라, 예약 화면은 그대로 전화 안내로 넘어간다.
  if (!base) throw new TeeSheetError(0, 'no booking server is configured for this app');

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch (cause) {
    throw new TeeSheetError(0, cause instanceof Error ? cause.message : 'Network error');
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body && typeof body === 'object' && 'detail' in body) {
        const value = (body as { detail: unknown }).detail;
        detail = typeof value === 'string' ? value : JSON.stringify(value);
      }
    } catch {
      // JSON 이 아닌 오류 본문. 상태줄을 그대로 쓴다.
    }
    throw new TeeSheetError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const teeSheetApi = {
  getSlots: (date: string) =>
    request<SlotsResponse>(`/tee-sheet/slots?date=${encodeURIComponent(date)}`),

  listBookings: (date: string) =>
    request<TeeBooking[]>(`/tee-sheet/bookings?date=${encodeURIComponent(date)}`),

  createBooking: (input: CreateBookingInput) =>
    request<TeeBooking>('/tee-sheet/bookings', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

export default teeSheetApi;
