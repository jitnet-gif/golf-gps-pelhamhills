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
import analyticsRouter from './routes/analytics'
import adminRouter from './routes/admin'
import campaignsRouter from './routes/campaigns'
import { handleScheduled } from './scheduled'

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

// 집계 수집(공개) + 집계 조회(관리자).
// adminRouter보다 먼저 붙입니다. 나중에 그쪽에 GET /api/admin/promotions/:id가
// 생기면 :id가 문자열 "stats"를 먼저 삼켜 이 라우트가 영영 실행되지 않습니다.
app.route('/', analyticsRouter)

// 관리자 전용. 각 라우터가 스스로 requireAdminKey()를 겁니다.
app.route('/', adminRouter)
app.route('/', campaignsRouter)

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

/*
 * Hono 앱만 default export하면 크론 트리거가 조용히 아무 일도 하지 않습니다.
 * wrangler.toml의 [triggers]가 부를 수 있는 것은 scheduled 핸들러뿐이고,
 * 그것은 이 객체에 함께 실려 있어야 합니다.
 */
export default {
  fetch: app.fetch,
  scheduled: async (
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> => {
    // waitUntil로 감싸야 핸들러가 반환된 뒤에도 발송이 끝까지 갑니다.
    ctx.waitUntil(handleScheduled(env, ctx))
  },
}
