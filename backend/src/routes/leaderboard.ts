/**
 * 리더보드 API 라우트
 * src/routes/leaderboard.ts
 *
 * GET /api/leaderboard/:roundId - 라운드 리더보드
 *
 * 리더보드는 크로스 유저 데이터를 집계하므로,
 * service_role_key를 사용하여 RLS를 바이패스합니다.
 * 하지만 라운드 ID 필터는 명시적으로 유지합니다.
 */

import { Hono } from 'hono'
import type { Env } from '../types/env'
import { createSupabaseClient } from '../lib/supabase'
import { getAuthContext } from '../middleware/auth'
import { ScoreService } from '../services/scoreService'
import { CourseService } from '../services/courseService'
import { GetLeaderboardResponseSchema } from '../schemas/leaderboard'
import { ValidationError, NotFoundError } from '../middleware/errorHandler'

type HonoEnv = {
  Bindings: Env
}

const router = new Hono<HonoEnv>()

/**
 * GET /api/leaderboard/:roundId - 라운드 리더보드
 *
 * 응답:
 * ```json
 * {
 *   "round_id": "uuid",
 *   "course_id": "uuid",
 *   "course_name": "Pelham Hills Golf Club",
 *   "leaderboard": [
 *     {
 *       "player_id": "user-id-1",
 *       "player_name": "John Doe",
 *       "total_strokes": 72,
 *       "total_score": 0,
 *       "hole_scores": [
 *         {
 *           "hole_number": 1,
 *           "strokes": 4,
 *           "par": 4
 *         },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 * }
 * ```
 *
 * 참고: 리더보드는 누구나 조회 가능하므로 인증 불필요
 */
router.get('/api/leaderboard/:roundId', async (c) => {
  try {
    const roundId = c.req.param('roundId')

    // Supabase 클라이언트 (anon key 사용 - 기본)
    const supabase = createSupabaseClient(c.env)
    const scoreService = new ScoreService(supabase)
    const courseService = new CourseService(supabase)

    // 라운드 정보 조회
    const round = await scoreService.getRound(roundId)

    // 코스 정보 조회
    const course = await courseService.getCourseDetail(round.course_id)

    // 리더보드 계산
    const leaderboard = await scoreService.calculateLeaderboard(roundId)

    // 응답 생성
    const response = GetLeaderboardResponseSchema.parse({
      round_id: roundId,
      course_id: round.course_id,
      course_name: course.name,
      leaderboard: leaderboard.map(entry => ({
        player_id: entry.player_id,
        player_name: `Player ${entry.player_id.substring(0, 8)}`, // 임시: 실제로는 profiles 테이블에서 조회
        total_strokes: entry.total_strokes,
        total_score: entry.total_score,
        hole_scores: entry.hole_scores,
      })),
    })

    return c.json(response)
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    if (error instanceof ValidationError) throw error
    throw new ValidationError(
      error instanceof Error ? error.message : 'Failed to fetch leaderboard'
    )
  }
})

export default router
