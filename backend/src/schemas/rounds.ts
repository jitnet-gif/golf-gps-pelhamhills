/**
 * 라운드 관련 API 스키마 검증
 * src/schemas/rounds.ts
 */

import { z } from 'zod'

// ============================================================
// 요청 스키마
// ============================================================

export const StartRoundRequestSchema = z.object({
  course_id: z.string().uuid('Invalid course ID'),
  player_ids: z.array(z.string().uuid('Invalid player ID')).min(1).max(4),
})

export type StartRoundRequest = z.infer<typeof StartRoundRequestSchema>

// ============================================================
// 응답 스키마
// ============================================================

export const RoundSchema = z.object({
  id: z.string().uuid(),
  course_id: z.string().uuid(),
  player_ids: z.array(z.string().uuid()),
  start_time: z.string().datetime(),
  end_time: z.string().datetime().nullable(),
  status: z.enum(['in_progress', 'completed', 'cancelled']),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
})

export type Round = z.infer<typeof RoundSchema>

export const StartRoundResponseSchema = z.object({
  round_id: z.string().uuid(),
  course_id: z.string().uuid(),
  player_ids: z.array(z.string().uuid()),
  start_time: z.string().datetime(),
})

export type StartRoundResponse = z.infer<typeof StartRoundResponseSchema>
