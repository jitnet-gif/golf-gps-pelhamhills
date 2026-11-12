/**
 * 운영 화면 입구와 직원 행동 기록 (migration 0032)
 *
 * - 숫자판: /api/admin/pin-login 이 Pelham Shift 직원 ID 를 확인하고 공용 직원 계정 세션을 돌려줍니다.
 *   그 세션을 이 앱의 Supabase 로그인으로 씁니다. 누가 들어왔는지는 서버가 세션별로 적어 둡니다.
 * - 이메일: 매니저와 코스 지도 담당(analysis@pelhamhills.ca)은 이메일·비밀번호로 들어옵니다.
 *
 * 운영 화면이 '열려 있다'는 표시는 sessionStorage 에만 둡니다 - 전의 관리자 키처럼 탭을 닫으면
 * 사라져, 공용 PC 의 다음 사람은 자기 번호로 다시 들어와야 합니다(기록이 앞 사람 이름으로 남지 않게).
 */

import { supabase } from './supabase';

const UNLOCK_KEY = 'golf_gps_admin_unlocked';

export function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function setUnlocked(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(UNLOCK_KEY, '1');
    else sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    /* 저장이 막힌 브라우저는 이번 화면에서만 */
  }
}

export class PinError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PinError';
  }
}

/** 직원 ID 로 들어옵니다. 성공하면 Supabase 세션이 바뀌고 직원 이름을 돌려줍니다. */
export async function pinSignIn(code: string): Promise<{ name: string; recorded: boolean }> {
  if (!supabase) throw new PinError(503, '이 빌드에는 서버 연결이 없습니다.');
  let response: Response;
  try {
    response = await fetch('/api/admin/pin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    });
  } catch {
    throw new PinError(0, "Can't reach the server. Check the internet connection.");
  }
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    access_token?: string;
    refresh_token?: string;
    name?: string;
    recorded?: boolean;
  } | null;
  if (!response.ok) {
    throw new PinError(response.status, body?.error || `Sign-in failed (${response.status}).`);
  }
  if (!body?.access_token || !body.refresh_token) {
    throw new PinError(500, 'Sign-in answer was not understood. Try again.');
  }
  const { error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });
  if (error) throw new PinError(500, error.message);
  setUnlocked(true);
  return { name: body.name ?? '', recorded: body.recorded === true };
}

export interface AdminWho {
  name: string;
  email: string | null;
  via: 'pin' | 'email';
  /** 숫자판 공용 계정 - 이메일로 '계속하기' 를 보여 주면 앞 사람 이름으로 남습니다. */
  shared: boolean;
}

export async function whoami(): Promise<AdminWho | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('gps_admin_whoami');
    if (error || !data) return null;
    return data as AdminWho;
  } catch {
    return null;
  }
}

/** 화면이 남기는 기록. 실패해도 화면은 멈추지 않습니다. */
export async function logEvent(action: string, target?: string, detail?: Record<string, unknown>): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('gps_admin_log_event', {
      p_action: action,
      p_target: target ?? null,
      p_detail: detail ?? null,
    });
  } catch {
    /* 기록 실패로 일을 막지 않습니다 */
  }
}

/** 운영 화면 닫기: 기록을 남기고 로그아웃합니다. */
export async function endAdmin(): Promise<void> {
  await logEvent('logout', 'admin');
  setUnlocked(false);
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    /* 오프라인이면 이 기기의 세션만 지워집니다 */
  }
}

// ============================================================
// 기록 보기
// ============================================================

export interface AdminLogRow {
  id: number;
  at: string;
  actor: string;
  actor_email: string | null;
  via: 'pin' | 'email' | 'server';
  action: string;
  target: string | null;
  row_key: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}

export async function logAccess(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.rpc('gps_admin_log_access');
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function listLog(options: { before?: number; actor?: string; limit?: number } = {}): Promise<AdminLogRow[]> {
  if (!supabase) throw new Error('이 빌드에는 서버 연결이 없습니다.');
  const { data, error } = await supabase.rpc('gps_admin_log_list', {
    p_limit: options.limit ?? 100,
    p_before: options.before ?? null,
    p_actor: options.actor?.trim() || null,
  });
  if (error) {
    if (/gps_admin_log_list|schema cache|does not exist/i.test(error.message)) {
      throw new Error('서버에 기록 표가 아직 없습니다. 0032_admin_pin_audit.sql 을 Supabase SQL Editor 에서 실행해 주세요.');
    }
    throw new Error(`기록을 읽지 못했습니다. (${error.message})`);
  }
  return (data ?? []) as AdminLogRow[];
}
