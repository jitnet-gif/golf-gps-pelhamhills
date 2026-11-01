/**
 * 내 QR (pelhamhills 0084_customer_qr)
 *
 * 프로 샵이 손님마다 `PHC-XXXXXXXXXX` 코드를 만들고, 그 코드를 담은
 * `/me?c=<코드>` 주소를 QR 로 인쇄하거나 문자로 보냅니다. 손님이 폰 카메라로
 * 찍으면 이 앱이 열리고, 생년월일을 한 번 맞추면 로그인 계정이 그 손님 기록에
 * 이어집니다. 그 뒤로는 /me 가 같은 QR 을 화면에 띄워 카운터에서 보여 줍니다.
 *
 * 서버 함수는 pelhamhills 쪽 마이그레이션에 있습니다 - 이 저장소에는 SQL 이 없습니다.
 */

import { supabase } from './supabase';
import { problemOf, type ServerProblem } from './holePaths';

export interface CustomerCard {
  customerRef: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  memberNumber: string | null;
  isMember: boolean;
  /** 코드가 아직 안 만들어진 손님이면 null. */
  qrCode: string | null;
  gpsLinked: boolean;
}

export class CustomerQrError extends Error {
  readonly problem: ServerProblem | 'rejected';
  constructor(message: string, problem: ServerProblem | 'rejected' = 'rejected') {
    super(message);
    this.name = 'CustomerQrError';
    this.problem = problem;
  }
}

const MISSING_FUNCTION = 'PGRST202';

const call = async (fn: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (!supabase) throw new CustomerQrError('This build has no server connection.', 'unavailable');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === MISSING_FUNCTION) {
      throw new CustomerQrError('My QR is not set up on the server yet.', 'missingTable');
    }
    // pelham_fail 은 PT<상태> 로 올라옵니다 - 서버가 일부러 거절한 것이라 그대로 읽힙니다.
    const problem = error.code?.startsWith('PT') ? 'rejected' : problemOf(error);
    throw new CustomerQrError(error.message || 'Something went wrong.', problem);
  }
  return data;
};

/** QR 이 담는 주소. 프로 샵이 인쇄하는 것과 같은 주소여야 해서 배포 주소로 고정합니다. */
export const customerQrUrl = (code: string) =>
  `https://golf-gps-pelhamhills-seven.vercel.app/me?c=${encodeURIComponent(code)}`;

/** 주소나 문자 전체가 붙어 와도 코드만 꺼냅니다. 서버의 pelham_customer_qr_parse 와 같은 규칙. */
export const parseCustomerCode = (text: string | null | undefined): string | null => {
  const match = /PHC-[2-9A-HJKMNP-TV-Z]{10}/.exec((text ?? '').toUpperCase());
  return match ? match[0] : null;
};

/** 로그인 계정에 이어진 손님. 아직 안 이어졌으면 null. */
export const fetchMyCard = async (): Promise<CustomerCard | null> =>
  ((await call('pelham_gps_me')) as CustomerCard | null) ?? null;

/** QR 코드 + 생년월일(YYYY-MM-DD)이 맞으면 이 계정을 그 손님에 잇습니다. */
export const linkMyCard = async (code: string, dob: string): Promise<CustomerCard> =>
  (await call('pelham_gps_link', { p_code: code, p_dob: dob })) as CustomerCard;
