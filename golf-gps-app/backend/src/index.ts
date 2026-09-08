/**
 * Golf GPS Backend - Cloudflare Workers 애플리케이션
 * src/index.ts
 *
 * 메인 진입점: 라우트 연결 및 미들웨어 설정
 */

import { Hono } from 'hono'
import type { Env } from './types/env'
import { createCorsMiddleware } from './middleware/cors'
import { authMiddleware } from './middleware/auth'
import { errorHandler } from './middleware/errorHandler'

// 라우트 임포트
import coursesRouter from './routes/courses'
import roundsRouter from './routes/rounds'
import scoresRouter from './routes/scores'
import leaderboardRouter from './routes/leaderboard'
import promotionsRouter from './routes/promotions'
import pushRouter from './routes/push'

// TypeScript 타입 지정: Bindings 타입 사용
type HonoEnv = {
  Bindings: Env
}

const app = new Hono<HonoEnv>()

// ============================================================
// 글로벌 미들웨어
// ============================================================

// CORS - env를 주입하여 미들웨어 팩토리 호출
app.use('*', (c, next) => createCorsMiddleware(c.env)(c, next))

// 인증 (모든 요청에 적용, requireAuth()로 강제할 수 있음)
app.use('*', authMiddleware())

// ============================================================
// 헬스 체크
// ============================================================

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: c.env.API_VERSION || 'v1',
    environment: c.env.ENVIRONMENT || 'unknown',
  })
})

// ============================================================
// API 라우트
// ============================================================

// 공개 라우트 (인증 불필요)
app.route('/', coursesRouter)
app.route('/', leaderboardRouter)
app.route('/', promotionsRouter)

// 푸시: 로그인 없는 앱이라 구독/해지는 공개이고,
// 발송만 라우트 안에서 X-Admin-Key로 막습니다.
app.route('/', pushRouter)

// 인증 필요 라우트
app.route('/', roundsRouter)
app.route('/', scoresRouter)

// ============================================================
// 404 처리
// ============================================================

app.notFound((c) => {
  return c.json(
    {
      error: 'NotFound',
      code: 'NOT_FOUND',
      message: `Endpoint not found: ${c.req.method} ${c.req.path}`,
      status: 404,
    },
    { status: 404 }
  )
})

// ============================================================
// 에러 핸들링
// ============================================================

app.onError((err, c) => errorHandler(c.env)(err, c))

// ============================================================
// Workers 내보내기
// ============================================================

export default app
