/**
 * 예약 발송(푸시 캠페인) 관리 API 라우트
 * src/routes/campaigns.ts
 *
 * GET    /api/admin/campaigns     - 예약 목록
 * POST   /api/admin/campaigns     - 예약 등록
 * DELETE /api/admin/campaigns/:id - 예약 취소 (pending일 때만)
 *
 * 실제 발송은 여기가 아니라 src/scheduled.ts의 Cron 핸들러가 합니다.
 */

import { Hono } from 'hono'
import type { Env } from '../types/env'
import { createSupabaseServiceClient } from '../lib/supabase'
import { CampaignService } from '../services/campaignService'
import {
  CreateCampaignSchema,
  ListCampaignsQuerySchema,
} from '../schemas/campaigns'
import { ValidationError } from '../middleware/errorHandler'
import { requireAdminKey } from '../middleware/adminAuth'

type HonoEnv = {
  Bindings: Env
}

const router = new Hono<HonoEnv>()

/*
 * 관리자 키는 이 라우터의 경로에만 겁니다.
 * 이 라우터는 index.ts에서 app.route('/', ...)로 앱에 합쳐지므로,
 * '*'로 걸면 /api/courses 같은 공개 라우트까지 관리자 키를 요구하게 됩니다.
 * 목록/등록은 끝에 슬래시가 없어 '/*' 패턴에 걸리지 않으므로 따로 겁니다.
 */
router.use('/api/admin/campaigns', requireAdminKey())
router.use('/api/admin/campaigns/*', requireAdminKey())

/**
 * GET /api/admin/campaigns - 예약 목록
 *
 * 헤더: `X-Admin-Key: <ADMIN_API_KEY>`
 * 쿼리: `?status=pending&limit=50`
 *
 * 응답:
 * ```json
 * { "data": [ { "id": "uuid", "status": "pending", "scheduled_at": "...", ... } ] }
 * ```
 */
router.get('/api/admin/campaigns', async (c) => {
  // 빈 문자열은 없는 것으로 봅니다. '전체' 항목이 ?status= 를 보내는데,
  // 그대로 넘기면 enum 검증에 걸려 목록 전체가 400이 됩니다.
  const query = ListCampaignsQuerySchema.parse({
    status: c.req.query('status') || undefined,
    limit: c.req.query('limit') || undefined,
  })

  const supabase = createSupabaseServiceClient(c.env)
  const data = await new CampaignService(supabase).list(query)

  return c.json({ data })
})

/**
 * POST /api/admin/campaigns - 예약 등록
 *
 * 요청 본문 (직접 작성):
 * ```json
 * {
 *   "title": "주말 그린피 30% 할인",
 *   "body": "이번 주 토·일 오후 티타임",
 *   "url": "/",
 *   "topic": "marketing",
 *   "scheduledAt": "2026-09-12T09:00:00+09:00"
 * }
 * ```
 *
 * 요청 본문 (등록된 배너를 그대로 예약):
 * ```json
 * { "promotionId": "uuid", "scheduledAt": "2026-09-12T09:00:00+09:00" }
 * ```
 */
router.post('/api/admin/campaigns', async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError('Invalid JSON body')
  })
  const request = CreateCampaignSchema.parse(body)

  const supabase = createSupabaseServiceClient(c.env)
  const data = await new CampaignService(supabase).create(request)

  return c.json({ data }, { status: 201 })
})

/**
 * DELETE /api/admin/campaigns/:id - 예약 취소
 *
 * pending일 때만 취소됩니다. 이미 보냈거나 보내는 중이면 409입니다 -
 * 나간 알림은 되돌릴 수 없으니, 취소된 척하는 것이 제일 나쁜 응답입니다.
 */
router.delete('/api/admin/campaigns/:id', async (c) => {
  const supabase = createSupabaseServiceClient(c.env)
  const data = await new CampaignService(supabase).cancel(c.req.param('id'))

  return c.json({ data })
})

export default router
