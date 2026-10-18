/**
 * 리더보드 API 스키마 검증
 * src/schemas/leaderboard.ts
 */

import { z } from 'zod'

// ============================================================
// 요청 스키마
// ============================================================

export const GetLeaderboardRequestSchema = z.object({
  round_id: z.string().uuid('Invalid round ID'),
})

export type GetLeaderboardRequest = z.infer<typeof GetLeaderboardRequestSchema>

// ============================================================
// 응답 스키마
// ============================================================

export const HoleScoreSchema = z.object({
  hole_number: z.number().int().min(1).max(18),
  strokes: z.number().int(),
  par: z.number().int(),
})

export type HoleScore = z.infer<typeof HoleScoreSchema>

export const LeaderboardEntrySchema = z.object({
  player_id: z.string().uuid(),
  player_name: z.string(),
  total_strokes: z.number().int(),
  total_score: z.number().int(), // vs par (음수는 언더, 양수는 오버)
  hole_scores: z.array(HoleScoreSchema),
})

export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>

export const GetLeaderboardResponseSchema = z.object({
  round_id: z.string().uuid(),
  course_id: z.string().uuid(),
  course_name: z.string(),
  leaderboard: z.array(LeaderboardEntrySchema),
})

export type GetLeaderboardResponse = z.infer<typeof GetLeaderboardResponseSchema>
