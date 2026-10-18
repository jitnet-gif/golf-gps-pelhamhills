/**
 * 점수 동기화 및 집계 서비스
 * src/services/scoreService.ts
 *
 * 배치 점수 제출 및 리더보드 계산
 *
 * 멱등성 전략:
 * - (round_id, hole_id, player_id)에 UNIQUE 제약
 * - INSERT ... ON CONFLICT DO UPDATE (UPSERT)를 사용하여 중복 제출 처리
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Score, Round } from '@golf-gps/shared'
import { NotFoundError, ValidationError, UnauthorizedError } from '../middleware/errorHandler'

export interface ScoreEntry {
  hole_id: string
  player_id: string
  strokes: number
}

export interface LeaderboardScore {
  player_id: string
  total_strokes: number
  total_score: number // vs par
  hole_scores: Array<{
    hole_number: number
    strokes: number
    par: number
  }>
}

export class ScoreService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * 배치 점수 제출 (멱등성 지원)
   *
   * 오프라인 앱에서 재시도할 수 있으므로 UPSERT를 사용합니다.
   * - 첫 번째 제출: INSERT
   * - 재시도: UPDATE (CONFLICT 처리)
   */
  async submitScores(
    roundId: string,
    scores: ScoreEntry[],
    currentUserId: string
  ): Promise<{ synced: number; failed: number; errors: Array<{ hole_id: string; player_id: string; error: string }> }> {
    // 1. 라운드 존재 여부 및 권한 확인
    const round = await this.getRound(roundId)
    if (!round.player_ids.includes(currentUserId)) {
      throw new UnauthorizedError('You are not a participant in this round')
    }

    if (round.status !== 'in_progress') {
      throw new ValidationError(`Round is not in progress (status: ${round.status})`)
    }

    // 2. 점수 일괄 제출 (UPSERT - 단일 배치 쿼리)
    const { error, count } = await this.supabase
      .from('scores')
      .upsert(
        scores.map(score => ({
          round_id: roundId,
          hole_id: score.hole_id,
          player_id: score.player_id,
          strokes: score.strokes,
          is_synced: true,
          updated_at: new Date().toISOString(),
        })),
        {
          onConflict: 'round_id,hole_id,player_id',
        }
      )

    // 3. 결과 집계
    const errors: Array<{ hole_id: string; player_id: string; error: string }> = []
    let synced = 0

    if (error) {
      return {
        synced: 0,
        failed: scores.length,
        errors: [{
          hole_id: 'all',
          player_id: 'all',
          error: error.message,
        }],
      }
    }

    synced = count || 0

    return {
      synced,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * 라운드 정보 조회
   */
  async getRound(roundId: string): Promise<Round> {
    const { data, error } = await this.supabase
      .from('rounds')
      .select('*')
      .eq('id', roundId)
      .single()

    if (error || !data) {
      throw new NotFoundError(`Round not found: ${roundId}`)
    }

    return data as Round
  }

  /**
   * 라운드의 점수 조회 (players별로 그룹화)
   */
  async getScoresByRound(roundId: string): Promise<Map<string, Score[]>> {
    const { data, error } = await this.supabase
      .from('scores')
      .select('*')
      .eq('round_id', roundId)
      .order('hole_id', { ascending: true })

    if (error) {
      throw new ValidationError('Failed to fetch scores', { supabaseError: error })
    }

    // player_id별로 그룹화
    const scoresByPlayer = new Map<string, Score[]>()
    for (const score of (data || []) as Score[]) {
      if (!scoresByPlayer.has(score.player_id)) {
        scoresByPlayer.set(score.player_id, [])
      }
      scoresByPlayer.get(score.player_id)!.push(score)
    }

    return scoresByPlayer
  }

  /**
   * 리더보드 계산
   *
   * 각 선수의 총 점수와 vs par 계산
   */
  async calculateLeaderboard(roundId: string): Promise<LeaderboardScore[]> {
    // 라운드 조회
    const round = await this.getRound(roundId)

    // 코스 정보 조회 (par 정보 필요)
    const { data: course, error: courseError } = await this.supabase
      .from('courses')
      .select('id, par')
      .eq('id', round.course_id)
      .single()

    if (courseError || !course) {
      throw new NotFoundError(`Course not found: ${round.course_id}`)
    }

    // 홀 정보 조회 (par, hole_number)
    const { data: holes, error: holesError } = await this.supabase
      .from('holes')
      .select('id, hole_number, par')
      .eq('course_id', round.course_id)
      .order('hole_number', { ascending: true })

    if (holesError || !holes) {
      throw new ValidationError('Failed to fetch holes', { supabaseError: holesError })
    }

    // 홀 par 매핑
    const holePars = new Map(holes.map(h => [h.id, h]))

    // 점수 조회
    const scoresByPlayer = await this.getScoresByRound(roundId)

    // 리더보드 계산
    const leaderboard: LeaderboardScore[] = []

    for (const playerId of round.player_ids) {
      const playerScores = scoresByPlayer.get(playerId) || []
      let totalStrokes = 0
      let totalPar = 0
      const holeScores = []

      for (const score of playerScores) {
        const hole = holePars.get(score.hole_id)
        if (hole) {
          holeScores.push({
            hole_number: hole.hole_number,
            strokes: score.strokes,
            par: hole.par,
          })
          totalStrokes += score.strokes
          totalPar += hole.par
        }
      }

      leaderboard.push({
        player_id: playerId,
        total_strokes: totalStrokes,
        total_score: totalStrokes - totalPar, // vs par
        hole_scores: holeScores,
      })
    }

    // 총 스트로크 기준 정렬 (오름차순)
    return leaderboard.sort((a, b) => a.total_strokes - b.total_strokes)
  }
}
