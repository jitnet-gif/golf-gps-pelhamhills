/**
 * 관리자 인증
 * src/middleware/adminAuth.ts
 *
 * 이 앱에는 관리자 로그인이 없습니다. 발송과 배너 관리처럼 밖에 열어 둘 수
 * 없는 동작은 공유 비밀키 하나(ADMIN_API_KEY)로 막습니다.
 * 사용자용 인증(middleware/auth.ts)과는 아무 관계가 없습니다.
 */

import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types/env'
import { ApiError, UnauthorizedError } from './errorHandler'

/**
 * X-Admin-Key 헤더 검증
 *
 * 길이가 다르면 곧바로 탈락시키되, 같은 길이일 때는 첫 글자에서 빠져나오지
 * 않고 전체를 비교합니다. 일찍 반환하면 응답 시간이 키를 한 글자씩 흘립니다.
 */
export function verifyAdminKey(env: Env, provided: string | undefined): void {
  const expected = env.ADMIN_API_KEY

  if (!expected) {
    throw new ApiError(
      'ADMIN_KEY_NOT_CONFIGURED',
      'ADMIN_API_KEY is not configured on this deployment',
      503
    )
  }
  if (!provided || provided.length !== expected.length) {
    throw new UnauthorizedError('Invalid admin key')
  }

  let mismatch = 0
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  }
  if (mismatch !== 0) {
    throw new UnauthorizedError('Invalid admin key')
  }
}

/**
 * 관리자 전용 라우트에 거는 미들웨어
 *
 * 라우터 단위로 `router.use('/api/admin/*', requireAdminKey())`처럼 씁니다.
 */
export function requireAdminKey(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    verifyAdminKey(c.env, c.req.header('X-Admin-Key'))
    await next()
  }
}
