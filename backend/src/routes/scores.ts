/**
 * 점수 API 라우트
 * src/routes/scores.ts
 *
 * POST /api/scores - 배치 점수 제출 (멱등성 지원)
 */

import { Hono } from 'hono'
import type { Env } from '../types/env'
import { createSupabaseClient } from '../lib/supabase'
import { getAuthContext, requireAuth } from '../middleware/auth'
import { ScoreService } from '../services/scoreService'
import { SubmitScoresRequestSchema, SubmitScoresResponseSchema } from '../schemas/scores'
import { ValidationError } from '../middleware/errorHandler'

type HonoEnv = {
  Bindings: Env
}

const router = new Hono<HonoEnv>()

/**
 * POST /api/scores - 배치 점수 제출
 *
 * 요청 본문:
 * ```json
 * {
 *   "round_id": "uuid",
 *   "scores": [
 *     {
 *       "hole_id": "uuid",
 *       "player_id": "user-id",
 *       "strokes": 4
 *     },
 *     ...
 *   ]
 * }
 * ```
 *
 * 응답:
 * ```json
 * {
 *   "synced_count": 10,
 *   "failed_count": 0
 * }
 * ```
 *
 * 멱등성:
 * - 같은 (round_id, hole_id, player_id) 조합을 재제출하면 업데이트됨
 * - 클라이언트 오프라인 모드에서 재시도할 수 있음
 */
router.post('/api/scores', requireAuth(), async (c) => {
  try {
    const authContext = getAuthContext(c)
    const body = await c.req.json()

    // 요청 검증
    const request = SubmitScoresRequestSchema.parse(body)

    // Supabase 클라이언트 (사용자 JWT 사용 - RLS 적용)
    const supabase = createSupabaseClient(c.env, authContext.token || undefined)
    const scoreService = new ScoreService(supabase)

    // 점수 제출
    const result = await scoreService.submitScores(
      request.round_id,
      request.scores,
      authContext.userId!
    )

    // 응답 검증
    const response = SubmitScoresResponseSchema.parse({
      synced_count: result.synced,
      failed_count: result.failed,
      ...(result.errors && { errors: result.errors }),
    })

    return c.json(response, {
      status: (result.failed === 0 ? 200 : 207) as const, // 207 Partial Content (일부 실패)
    })
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(
      error instanceof Error ? error.message : 'Failed to submit scores'
    )
  }
})

export default router
