/**
 * 프로모션(마케팅 배너) API 라우트
 * src/routes/promotions.ts
 *
 * GET /api/promotions?placement=home&limit=5 - 지금 노출할 배너 목록
 */

import { Hono } from 'hono'
import type { Env } from '../types/env'
import { createSupabaseClient } from '../lib/supabase'
import { PromotionService } from '../services/promotionService'
import { GetPromotionsQuerySchema } from '../schemas/promotions'

type HonoEnv = {
  Bindings: Env
}

const router = new Hono<HonoEnv>()

/**
 * GET /api/promotions
 *
 * 쿼리 파라미터:
 * - placement: 'home' | 'scorecard' (생략하면 전체)
 * - limit: 1~20 (기본 5)
 *
 * 응답:
 * ```json
 * {
 *   "data": [
 *     {
 *       "id": "uuid",
 *       "title": "주말 그린피 30% 할인",
 *       "body": "이번 주 토·일 오후 티타임 한정",
 *       "image_url": "https://...",
 *       "link_url": "https://...",
 *       "placement": "home",
 *       "priority": 10,
 *       "starts_at": null,
 *       "ends_at": "2026-09-30T15:00:00Z"
 *     }
 *   ]
 * }
 * ```
 *
 * POST가 아니라 GET인 이유: 서비스워커의 /api/ 런타임 캐시(NetworkFirst)는
 * GET만 저장합니다. 통신이 끊긴 코스 위에서도 마지막 배너가 남아야 합니다.
 */
router.get('/api/promotions', async (c) => {
  const query = GetPromotionsQuerySchema.parse({
    placement: c.req.query('placement'),
    limit: c.req.query('limit') ?? undefined,
  })

  const supabase = createSupabaseClient(c.env)
  const promotionService = new PromotionService(supabase)

  const promotions = await promotionService.listLive(query.placement, query.limit)

  return c.json({ data: promotions })
})

export default router
