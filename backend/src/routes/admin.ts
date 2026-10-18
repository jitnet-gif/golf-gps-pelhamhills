/**
 * 관리자 배너 API 라우트
 * src/routes/admin.ts
 *
 * GET    /api/admin/promotions      - 배너 전체 목록 (내려간 것 포함)
 * POST   /api/admin/promotions      - 배너 등록
 * PATCH  /api/admin/promotions/:id  - 배너 부분 수정
 * DELETE /api/admin/promotions/:id  - 배너 삭제
 *
 * 모두 X-Admin-Key 헤더가 필요합니다.
 */

import { Hono } from 'hono'
import type { Env } from '../types/env'
import { createSupabaseServiceClient } from '../lib/supabase'
import { PromotionAdminService } from '../services/promotionAdminService'
import {
  AdminListPromotionsQuerySchema,
  CreatePromotionSchema,
  PromotionIdSchema,
  UpdatePromotionSchema,
} from '../schemas/admin'
import { ValidationError } from '../middleware/errorHandler'
import { requireAdminKey } from '../middleware/adminAuth'

type HonoEnv = {
  Bindings: Env
}

const router = new Hono<HonoEnv>()

/**
 * 네 엔드포인트를 한 번에 막습니다.
 *
 * 핸들러마다 verifyAdminKey를 부르지 않는 이유는, 나중에 엔드포인트를
 * 하나 더 붙이는 사람이 그 한 줄을 빠뜨리면 그대로 열린 채 배포되기
 * 때문입니다. 컬렉션(/promotions)과 개별(/promotions/:id)은 경로가 달라
 * 패턴 두 개가 필요합니다.
 */
router.use('/api/admin/promotions', requireAdminKey())
router.use('/api/admin/promotions/*', requireAdminKey())

/**
 * GET /api/admin/promotions?limit=20&offset=0
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
 *       "link_url": "/courses/pelham-hills",
 *       "placement": "home",
 *       "priority": 10,
 *       "starts_at": null,
 *       "ends_at": "2026-09-30T15:00:00+00:00",
 *       "active": true,
 *       "created_at": "2026-09-01T02:11:04.512+00:00",
 *       "updated_at": "2026-09-01T02:11:04.512+00:00"
 *     }
 *   ],
 *   "total": 42,
 *   "limit": 20,
 *   "offset": 0
 * }
 * ```
 *
 * 공개 API(GET /api/promotions)와 달리 기간이 지났거나 active=false인
 * 배너도 그대로 나옵니다.
 */
router.get('/api/admin/promotions', async (c) => {
  // ??가 아니라 ||인 이유: "?limit=" 처럼 값이 빈 파라미터는 빈 문자열로
  // 들어오고, 그대로 넘기면 0으로 강제 변환돼 400이 됩니다. 입력칸을 비운 채
  // 쿼리를 조립하는 화면에서 흔한 일이라 "안 보낸 것"과 같게 봅니다.
  const query = AdminListPromotionsQuerySchema.parse({
    limit: c.req.query('limit') || undefined,
    offset: c.req.query('offset') || undefined,
  })

  const supabase = createSupabaseServiceClient(c.env)
  const service = new PromotionAdminService(supabase)

  const { data, total } = await service.list(query.limit, query.offset)

  return c.json({ data, total, limit: query.limit, offset: query.offset })
})

/**
 * POST /api/admin/promotions
 *
 * 요청 본문 (title만 필수):
 * ```json
 * {
 *   "title": "주말 그린피 30% 할인",
 *   "body": "이번 주 토·일 오후 티타임 한정",
 *   "image_url": "https://cdn.example.com/promo.jpg",
 *   "link_url": "/courses/pelham-hills",
 *   "placement": "home",
 *   "priority": 10,
 *   "starts_at": "2026-09-10T00:00:00+09:00",
 *   "ends_at": "2026-09-30T23:59:59+09:00",
 *   "active": true
 * }
 * ```
 *
 * 등록한 행을 그대로 돌려줍니다. id와 DB가 채운 시각을 다시 받아 오려고
 * 목록을 새로 부르지 않아도 되게 하기 위해서입니다.
 */
router.post('/api/admin/promotions', async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError('Invalid JSON body')
  })
  const input = CreatePromotionSchema.parse(body)

  const supabase = createSupabaseServiceClient(c.env)
  const service = new PromotionAdminService(supabase)

  const promotion = await service.create(input)

  return c.json(promotion, { status: 201 })
})

/**
 * PATCH /api/admin/promotions/:id
 *
 * 보낸 필드만 바뀝니다. 값을 지우려면 null을 명시적으로 보내세요.
 * ```json
 * { "ends_at": null, "active": false }
 * ```
 * 위 요청은 종료일을 지우고 배너를 내리며, 제목과 이미지는 건드리지 않습니다.
 * 반대로 `{}`는 400입니다 - 아무것도 안 바꾸는 수정은 실수일 가능성이 큽니다.
 */
router.patch('/api/admin/promotions/:id', async (c) => {
  const id = PromotionIdSchema.parse(c.req.param('id'))
  const body = await c.req.json().catch(() => {
    throw new ValidationError('Invalid JSON body')
  })
  const patch = UpdatePromotionSchema.parse(body)

  const supabase = createSupabaseServiceClient(c.env)
  const service = new PromotionAdminService(supabase)

  const promotion = await service.update(id, patch)

  return c.json(promotion)
})

/**
 * DELETE /api/admin/promotions/:id
 *
 * 없는 id면 404입니다. 삭제를 여러 번 눌러도 조용히 성공하면, 실제로는
 * 다른 배너를 지워 놓고도 알아채지 못합니다.
 */
router.delete('/api/admin/promotions/:id', async (c) => {
  const id = PromotionIdSchema.parse(c.req.param('id'))

  const supabase = createSupabaseServiceClient(c.env)
  const service = new PromotionAdminService(supabase)

  await service.remove(id)

  return c.json({ id, status: 'deleted' })
})

export default router
