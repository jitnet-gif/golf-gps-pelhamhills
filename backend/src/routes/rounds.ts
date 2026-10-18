/**
 * 라운드 API 라우트
 * src/routes/rounds.ts
 *
 * POST /api/rounds - 라운드 시작
 * GET /api/rounds/:id - 라운드 상세 정보
 * GET /api/rounds/user/me - 사용자의 라운드 목록
 * POST /api/rounds/:id/complete - 라운드 완료
 * POST /api/rounds/:id/cancel - 라운드 취소
 */

import { Hono } from 'hono'
import type { Env } from '../types/env'
import { createSupabaseClient } from '../lib/supabase'
import { getAuthContext, requireAuth } from '../middleware/auth'
import { RoundService } from '../services/roundService'
import { StartRoundRequestSchema, RoundSchema, StartRoundResponseSchema } from '../schemas/rounds'
import { ValidationError } from '../middleware/errorHandler'

type HonoEnv = {
  Bindings: Env
}

const router = new Hono<HonoEnv>()

/**
 * POST /api/rounds - 라운드 시작
 *
 * 요청 본문:
 * ```json
 * {
 *   "course_id": "uuid",
 *   "player_ids": ["user-id-1", "user-id-2", "user-id-3"]
 * }
 * ```
 */
router.post('/api/rounds', async (c) => {
  try {
    const authContext = getAuthContext(c)
    const body = await c.req.json()

    // 요청 검증
    const request = StartRoundRequestSchema.parse(body)

    // Supabase 클라이언트 생성 (사용자 JWT 사용)
    const supabase = createSupabaseClient(c.env, authContext.token || undefined)
    const roundService = new RoundService(supabase)

    // 라운드 시작
    const round = await roundService.startRound(
      request.course_id,
      request.player_ids,
      authContext.userId!
    )

    // 응답 검증
    const response = StartRoundResponseSchema.parse({
      round_id: round.id,
      course_id: round.course_id,
      player_ids: round.player_ids,
      start_time: round.start_time,
    })

    return c.json(response, { status: 201 })
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(
      error instanceof Error ? error.message : 'Failed to start round'
    )
  }
})

/**
 * GET /api/rounds/:id - 라운드 상세 정보
 */
router.get('/api/rounds/:id', requireAuth(), async (c) => {
  try {
    const authContext = getAuthContext(c)
    const roundId = c.req.param('id')

    // Supabase 클라이언트
    const supabase = createSupabaseClient(c.env, authContext.token || undefined)
    const roundService = new RoundService(supabase)

    // 라운드 조회
    const round = await roundService.getRound(roundId)

    // 권한 확인 (참여자만 조회 가능)
    if (!round.player_ids.includes(authContext.userId!)) {
      throw new ValidationError('You are not a participant in this round')
    }

    const response = RoundSchema.parse(round)
    return c.json(response)
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(
      error instanceof Error ? error.message : 'Failed to fetch round'
    )
  }
})

/**
 * GET /api/rounds/user/me - 사용자의 라운드 목록
 *
 * 쿼리 파라미터:
 * - limit (기본값: 20)
 * - offset (기본값: 0)
 */
router.get('/api/rounds/user/me', async (c) => {
  try {
    const authContext = getAuthContext(c)
    const limit = parseInt(c.req.query('limit') || '20')
    const offset = parseInt(c.req.query('offset') || '0')

    // Supabase 클라이언트
    const supabase = createSupabaseClient(c.env, authContext.token || undefined)
    const roundService = new RoundService(supabase)

    // 라운드 목록 조회
    const { rounds, total } = await roundService.getUserRounds(
      authContext.userId!,
      limit,
      offset
    )

    return c.json({
      data: rounds.map(r => RoundSchema.parse(r)),
      total,
      limit,
      offset,
    })
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(
      error instanceof Error ? error.message : 'Failed to fetch rounds'
    )
  }
})

/**
 * POST /api/rounds/:id/complete - 라운드 완료
 */
router.post('/api/rounds/:id/complete', requireAuth(), async (c) => {
  try {
    const authContext = getAuthContext(c)
    const roundId = c.req.param('id')

    const supabase = createSupabaseClient(c.env, authContext.token || undefined)
    const roundService = new RoundService(supabase)

    const round = await roundService.completeRound(roundId, authContext.userId!)

    return c.json(RoundSchema.parse(round))
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(
      error instanceof Error ? error.message : 'Failed to complete round'
    )
  }
})

/**
 * POST /api/rounds/:id/cancel - 라운드 취소
 */
router.post('/api/rounds/:id/cancel', requireAuth(), async (c) => {
  try {
    const authContext = getAuthContext(c)
    const roundId = c.req.param('id')

    const supabase = createSupabaseClient(c.env, authContext.token || undefined)
    const roundService = new RoundService(supabase)

    const round = await roundService.cancelRound(roundId, authContext.userId!)

    return c.json(RoundSchema.parse(round))
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(
      error instanceof Error ? error.message : 'Failed to cancel round'
    )
  }
})

export default router
