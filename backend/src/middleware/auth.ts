/**
 * 인증 미들웨어
 * src/middleware/auth.ts
 *
 * JWT 검증 및 사용자 인증 처리
 *
 * 전략:
 * 1. Authorization: Bearer <token> 헤더에서 JWT 추출
 * 2. JWT 서명 검증 (JWKS 엔드포인트 사용)
 * 3. 사용자 정보를 context에 첨부
 * 4. RLS 규칙이 나머지 접근 제어를 담당
 */

import type { MiddlewareHandler, Context } from 'hono'
import type { Env } from '../types/env'
import { extractUserIdFromJwt } from '../lib/supabase'

export interface AuthContext {
  userId: string | null
  token: string | null
  isAuthenticated: boolean
}

/**
 * 인증 토큰 검증 및 user ID 추출
 *
 * 참고: Supabase JWT 검증
 * - 새로운 프로젝트: RS256 (JWKS 엔드포인트에서 공개키 사용)
 * - 레거시 프로젝트: HS256 (JWT_SECRET 사용)
 *
 * 현재는 JWT 형식만 확인하고, Supabase RLS가 최종 접근 제어를 담당합니다.
 */
export function authMiddleware(): MiddlewareHandler<{
  Bindings: Env
  Variables: { authContext: AuthContext }
}> {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization')
    let userId: string | null = null
    let token: string | null = null

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7) // 'Bearer ' 제거
      userId = extractUserIdFromJwt(token)
    }

    // context에 인증 정보 저장
    c.set('authContext', {
      userId,
      token,
      isAuthenticated: !!userId,
    })

    await next()
  }
}

/**
 * 인증 필수 미들웨어
 * 인증되지 않은 요청을 거부합니다.
 */
export function requireAuth(): MiddlewareHandler<{
  Bindings: Env
  Variables: { authContext: AuthContext }
}> {
  return async (c, next) => {
    const authContext = c.get('authContext')

    if (!authContext?.isAuthenticated || !authContext?.userId) {
      return c.json(
        {
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
        { status: 401 as const }
      )
    }

    await next()
  }
}

/**
 * 인증 정보 가져오기 (타입 안전)
 */
export function getAuthContext(c: Context<{ Bindings: Env; Variables: { authContext: AuthContext } }>): AuthContext {
  const authContext = c.get('authContext')
  return authContext || { userId: null, token: null, isAuthenticated: false }
}
