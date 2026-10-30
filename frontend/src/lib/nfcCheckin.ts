/**
 * NFC 체크인 (마이그레이션 0024, pelhamhills 0082)
 *
 * 카운터의 NFC 스티커에는 `/checkin?t=<토큰>` 주소가 적혀 있습니다. 폰을 대면
 * OS 가 그 주소를 열고(아이폰도 됩니다 - Web NFC 가 아니라 태그가 주소를 여는
 * 것), 이 앱은 로그인한 이메일로 오늘 티타임을 찾아 체크인합니다.
 *
 * Web NFC(NDEFReader)는 직원이 안드로이드 Chrome 에서 **스티커에 주소를 쓸 때만**
 * 씁니다(writeCheckinTag). 손님 쪽은 어떤 폰이든 됩니다.
 */

import { supabase } from './supabase';
import { problemOf, type ServerProblem } from './holePaths';

export interface CheckinResult {
  status: 'checked_in' | 'already';
  idOnFile: boolean;
  booking: { time: string | null; holes: number | null; players: number; cartCount: number | null };
}

export interface CheckinFeedRow {
  id: number;
  bookingId: string;
  email: string | null;
  at: string;
  name: string | null;
  time: string | null;
  players: number;
  cartCount: number | null;
  status: string | null;
  idOnFile: boolean;
}

export interface CheckinTag {
  token: string;
  label: string;
}

export class CheckinError extends Error {
  readonly problem: ServerProblem | 'rejected';
  constructor(message: string, problem: ServerProblem | 'rejected' = 'rejected') {
    super(message);
    this.name = 'CheckinError';
    this.problem = problem;
  }
}

const MISSING_FUNCTION = 'PGRST202';

const call = async (fn: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (!supabase) throw new CheckinError('This build has no server connection.', 'unavailable');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === MISSING_FUNCTION) {
      throw new CheckinError(
        'NFC check-in is not set up on the server yet (0024_nfc_checkin.sql).',
        'missingTable'
      );
    }
    // P0001 은 서버가 일부러 거절한 것 - 이미 사람이 읽을 말입니다.
    const problem = error.code === 'P0001' ? 'rejected' : problemOf(error);
    throw new CheckinError(error.message || 'Could not check in.', problem);
  }
  return data;
};

/** 손님: 태그를 댄 뒤 오늘 예약을 체크인합니다. */
export const nfcCheckin = async (tag: string): Promise<CheckinResult> =>
  (await call('nfc_checkin', { p_tag: tag })) as CheckinResult;

/** 직원: 오늘 NFC 로 들어온 체크인, 최근 것부터. */
export const fetchCheckinFeed = async (): Promise<CheckinFeedRow[]> =>
  ((await call('nfc_checkin_feed')) as CheckinFeedRow[] | null) ?? [];

/** 직원: 예약에 붙은 신분증 사진. 없으면 null. 화면에 바로 쓸 data: 주소로 돌려줍니다. */
export const fetchCheckinIdImage = async (bookingId: string): Promise<string | null> => {
  const data = (await call('nfc_checkin_id_image', { p_booking_id: bookingId })) as {
    mime: string;
    data: string;
  } | null;
  return data ? `data:${data.mime};base64,${data.data}` : null;
};

export const fetchCheckinTags = async (): Promise<CheckinTag[]> =>
  ((await call('nfc_checkin_tags')) as CheckinTag[] | null) ?? [];

/** 스티커에 적을 주소. 이 앱이 떠 있는 곳 기준입니다. */
export const checkinTagUrl = (token: string) =>
  `${window.location.origin}/checkin?t=${encodeURIComponent(token)}`;

/** Web NFC 로 스티커에 쓸 수 있는 브라우저인가 (안드로이드 Chrome). */
export const canWriteNfc = () => typeof window !== 'undefined' && 'NDEFReader' in window;

/** 스티커에 체크인 주소를 씁니다. 부르면 폰을 스티커에 대라는 OS 안내가 뜹니다. */
export const writeCheckinTag = async (token: string): Promise<void> => {
  const Reader = (window as unknown as { NDEFReader?: new () => { write: (m: unknown) => Promise<void> } })
    .NDEFReader;
  if (!Reader) throw new CheckinError('This browser cannot write NFC tags. Use Chrome on Android.');
  await new Reader().write({ records: [{ recordType: 'url', data: checkinTagUrl(token) }] });
};
