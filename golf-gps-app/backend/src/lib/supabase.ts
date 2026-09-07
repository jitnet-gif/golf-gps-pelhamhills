/**
 * Supabase 클라이언트 생성 (Workers용)
 * src/lib/supabase.ts
 *
 * Workers는 모듈 스코프에서 I/O를 금지하므로,
 * 각 요청 핸들러 내에서 클라이언트를 생성해야 합니다.
 *
 * 보안 노트:
 * - SUPABASE_ANON_KEY + user JWT를 사용하여 RLS를 활용
 * - SERVICE_ROLE_KEY는 크로스 유저 집계(리더보드)에만 사용
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Env } from '../types/env'

export function createSupabaseClient(env: Env, jwtToken?: string): SupabaseClient {
  // Bearer 토큰이 제공되면 사용, 아니면 anon key 사용
  const authToken = jwtToken || env.SUPABASE_ANON_KEY

  return createClient(env.SUPABASE_URL, authToken, {
    auth: {
      persistSession: false, // Workers는 세션 지속 불필요
      autoRefreshToken: false,
    },
    global: {
      headers: {
        // Workers에서는 User-Agent를 명시해야 하는 경우가 있음
        'User-Agent': 'golf-gps-backend/1.0.0',
      },
    },
  })
}

/**
 * 서비스 역할 클라이언트 생성 (RLS 바이패스)
 * 크로스 유저 집계(예: 리더보드)에만 사용
 *
 * WARNING: 이 클라이언트는 RLS를 무시하므로 매우 조심히 사용해야 합니다.
 *         모든 쿼리는 명시적으로 필터링되어야 합니다.
 */
export function createSupabaseServiceClient(env: Env): SupabaseClient {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'User-Agent': 'golf-gps-backend/1.0.0',
      },
    },
  })
}

/**
 * JWT 토큰에서 user ID 추출
 * Supabase JWT 형식: { sub: user_id, ... }
 */
export function extractUserIdFromJwt(token: string): string | null {
  try {
    // JWT는 3개 부분으로 구성: header.payload.signature
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payload = JSON.parse(atob(parts[1]))
    return payload.sub || null
  } catch {
    return null
  }
}
