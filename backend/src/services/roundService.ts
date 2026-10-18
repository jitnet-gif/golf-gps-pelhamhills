/**
 * 라운드 관리 서비스
 * src/services/roundService.ts
 *
 * 라운드 생성 및 관리 로직
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Round } from '@golf-gps/shared'
import { NotFoundError, ValidationError, UnauthorizedError } from '../middleware/errorHandler'

export class RoundService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * 새로운 라운드 시작
   */
  async startRound(
    courseId: string,
    playerIds: string[],
    currentUserId: string
  ): Promise<Round> {
    // 1. 코스 존재 여부 확인
    const { data: course, error: courseError } = await this.supabase
      .from('courses')
      .select('id')
      .eq('id', courseId)
      .single()

    if (courseError || !course) {
      throw new NotFoundError(`Course not found: ${courseId}`)
    }

    // 2. 현재 사용자가 참여자에 포함되어 있는지 확인
    if (!playerIds.includes(currentUserId)) {
      throw new ValidationError('Current user must be a participant in the round')
    }

    // 3. 라운드 생성
    const { data, error } = await this.supabase
      .from('rounds')
      .insert({
        course_id: courseId,
        player_ids: playerIds,
        start_time: new Date().toISOString(),
        status: 'in_progress',
      })
      .select('*')
      .single()

    if (error || !data) {
      throw new ValidationError('Failed to create round', { supabaseError: error })
    }

    return data as Round
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
   * 사용자의 라운드 목록 조회
   */
  async getUserRounds(userId: string, limit: number = 20, offset: number = 0) {
    // player_ids 배열에 userId가 포함된 라운드 조회
    // Supabase의 배열 포함 확인: @> 연산자 사용
    const { data, count, error } = await this.supabase
      .from('rounds')
      .select('*', { count: 'exact' })
      .contains('player_ids', [userId])
      .order('start_time', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw new ValidationError('Failed to fetch rounds', { supabaseError: error })
    }

    return {
      rounds: (data || []) as Round[],
      total: count || 0,
    }
  }

  /**
   * 라운드 완료
   */
  async completeRound(roundId: string, currentUserId: string): Promise<Round> {
    // 1. 라운드 조회
    const round = await this.getRound(roundId)

    // 2. 권한 확인 (참여자여야 함)
    if (!round.player_ids.includes(currentUserId)) {
      throw new UnauthorizedError('You are not a participant in this round')
    }

    // 3. 라운드 상태 업데이트
    const { data, error } = await this.supabase
      .from('rounds')
      .update({
        status: 'completed',
        end_time: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', roundId)
      .select('*')
      .single()

    if (error || !data) {
      throw new ValidationError('Failed to complete round', { supabaseError: error })
    }

    return data as Round
  }

  /**
   * 라운드 취소
   */
  async cancelRound(roundId: string, currentUserId: string): Promise<Round> {
    // 1. 라운드 조회
    const round = await this.getRound(roundId)

    // 2. 권한 확인 (참여자여야 함)
    if (!round.player_ids.includes(currentUserId)) {
      throw new UnauthorizedError('You are not a participant in this round')
    }

    // 3. 라운드 상태 업데이트
    const { data, error } = await this.supabase
      .from('rounds')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', roundId)
      .select('*')
      .single()

    if (error || !data) {
      throw new ValidationError('Failed to cancel round', { supabaseError: error })
    }

    return data as Round
  }
}
