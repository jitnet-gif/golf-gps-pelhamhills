/**
 * 점수 관련 API 스키마 검증
 * src/schemas/scores.ts
 *
 * 배치 점수 제출 - 오프라인 골프 앱의 재시도 지원
 * 멱등성: (round_id, hole_id, player_id) 조합의 UNIQUE 제약으로 보장
 */

import { z } from 'zod'

// ============================================================
// 요청 스키마
// ============================================================

export const ScoreEntrySchema = z.object({
  hole_id: z.string().uuid('Invalid hole ID'),
  player_id: z.string().uuid('Invalid player ID'),
  strokes: z.number().int().min(1).max(13, 'Max strokes is 13'),
})

export type ScoreEntry = z.infer<typeof ScoreEntrySchema>

export const SubmitScoresRequestSchema = z.object({
  round_id: z.string().uuid('Invalid round ID'),
  scores: z.array(ScoreEntrySchema).min(1).max(72, 'Max 72 scores (18 holes * 4 players)'),
})

export type SubmitScoresRequest = z.infer<typeof SubmitScoresRequestSchema>

// ============================================================
// 응답 스키마
// ============================================================

export const ScoreErrorSchema = z.object({
  hole_id: z.string().uuid(),
  player_id: z.string().uuid(),
  error: z.string(),
})

export type ScoreError = z.infer<typeof ScoreErrorSchema>

export const SubmitScoresResponseSchema = z.object({
  synced_count: z.number().int().min(0),
  failed_count: z.number().int().min(0),
  errors: z.array(ScoreErrorSchema).optional(),
})

export type SubmitScoresResponse = z.infer<typeof SubmitScoresResponseSchema>

// ============================================================
// 데이터베이스 스키마
// ============================================================

export const ScoreSchema = z.object({
  id: z.string().uuid(),
  round_id: z.string().uuid(),
  hole_id: z.string().uuid(),
  player_id: z.string().uuid(),
  strokes: z.number().int(),
  is_synced: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
})

export type Score = z.infer<typeof ScoreSchema>
