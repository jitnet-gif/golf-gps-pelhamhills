/**
 * 배너 집계 API 라우트
 * src/routes/analytics.ts
 *
 * POST /api/promotions/events       - 노출/클릭/닫기 수집 (공개)
 * GET  /api/admin/promotions/stats  - 배너별 성적 (관리자 키 필요)
 */

import { Hono } from 'hono'
import type { Env } from '../types/env'
import { createSupabaseServiceClient } from '../lib/supabase'
import { AnalyticsService } from '../services/analyticsService'
import {
  GetPromotionStatsQuerySchema,
  TrackEventsRequestSchema,
} from '../schemas/analytics'
import { ValidationError } from '../middleware/errorHandler'
import { requireAdminKey } from '../middleware/adminAuth'

type HonoEnv = {
  Bindings: Env
}

const router = new Hono<HonoEnv>()

// 라우트 정의보다 먼저 걸어야 합니다. Hono는 등록한 순서대로 실행하므로,
// 라우트 아래에 붙인 미들웨어는 그 라우트를 지키지 못합니다.
router.use('/api/admin/*', requireAdminKey())

/**
 * POST /api/promotions/events - 배너 이벤트 수집
 *
 * 관리자 키가 없는 공개 엔드포인트입니다. 브라우저가 화면을 떠나면서
 * sendBeacon으로 보내기 때문에, 응답을 읽을 사람도 재시도할 사람도 없습니다.
 * 그래서 202만 돌려주고 뒤는 서버가 알아서 합니다.
 *
 * 요청 본문:
 * ```json
 * {
 *   "deviceId": "a1b2c3d4e5f6...",
 *   "events": [
 *     { "promotionId": "uuid", "eventType": "impression", "placement": "home" },
 *     { "promotionId": "uuid", "eventType": "click", "placement": "home" }
 *   ]
 * }
 * ```
 *
 * 응답: `{ "accepted": 1, "skipped": 1 }` (202)
 *
 * promotionId가 UUID 모양이 아니면 400으로 되돌립니다 - 그것은 부르는 쪽
 * 코드의 버그라 조용히 넘기면 영영 드러나지 않습니다. 반대로 모양은 맞는데
 * 그런 배너가 없는 경우는 배너가 내려간 뒤 늦게 도착한 비콘일 수 있으니
 * 실패로 보지 않습니다.
 */
router.post('/api/promotions/events', async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError('Invalid JSON body')
  })
  const request = TrackEventsRequestSchema.parse(body)

  const supabase = createSupabaseServiceClient(c.env)
  const analyticsService = new AnalyticsService(supabase)

  const result = await analyticsService.recordEvents(request.deviceId, request.events)

  return c.json(result, { status: 202 })
})

/**
 * GET /api/admin/promotions/stats - 배너별 성적
 *
 * 헤더: `X-Admin-Key: <ADMIN_API_KEY>`
 *
 * 쿼리 파라미터:
 * - placement: 'home' | 'scorecard' (생략하면 전체)
 *
 * 응답:
 * ```json
 * {
 *   "data": [
 *     {
 *       "promotion_id": "uuid",
 *       "title": "주말 그린피 30% 할인",
 *       "placement": "home",
 *       "active": true,
 *       "starts_at": null,
 *       "ends_at": "2026-09-30T15:00:00Z",
 *       "impressions": 1240,
 *       "clicks": 86,
 *       "dismissals": 31,
 *       "click_rate_pct": 6.9
 *     }
 *   ]
 * }
 * ```
 *
 * 노출 많은 순입니다. 관리 화면이 제일 먼저 보고 싶어 하는 것은
 * 사람들 눈에 실제로 닿고 있는 배너이기 때문입니다.
 */
router.get('/api/admin/promotions/stats', async (c) => {
  const query = GetPromotionStatsQuerySchema.parse({
    placement: c.req.query('placement'),
  })

  const supabase = createSupabaseServiceClient(c.env)
  const analyticsService = new AnalyticsService(supabase)

  const stats = await analyticsService.getStats(query.placement)

  return c.json({ data: stats })
})

export default router
