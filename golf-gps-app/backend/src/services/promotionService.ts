/**
 * 프로모션(마케팅 배너) 조회 서비스
 * src/services/promotionService.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { NotFoundError, ValidationError } from '../middleware/errorHandler'
import type { Promotion, PromotionPlacement } from '../schemas/promotions'

export class PromotionService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * 지금 노출할 배너 목록
   *
   * 기간/활성 필터를 여기서 한 번 더 거는 이유: RLS의 promotions_read_live가
   * 같은 조건을 이미 걸지만, 그 정책은 anon 키에만 적용됩니다.
   * service_role로 호출될 때도 예약된 배너가 새지 않도록 쿼리에서 막습니다.
   */
  async listLive(placement?: PromotionPlacement, limit = 5): Promise<Promotion[]> {
    const now = new Date().toISOString()

    let query = this.supabase
      .from('promotions')
      .select('id, title, body, image_url, link_url, placement, priority, starts_at, ends_at')
      .eq('active', true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gt.${now}`)

    if (placement) {
      query = query.eq('placement', placement)
    }

    const { data, error } = await query
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw new ValidationError('Failed to fetch promotions', { supabaseError: error })
    }

    return (data || []) as Promotion[]
  }

  /**
   * 배너 한 건 조회
   *
   * 배너 내용을 그대로 푸시로 보낼 때 씁니다. 이쪽은 기간을 따지지 않습니다 -
   * 발송 시점을 정하는 것은 보내는 사람이지 배너의 노출 기간이 아닙니다.
   */
  async getById(id: string): Promise<Promotion> {
    const { data, error } = await this.supabase
      .from('promotions')
      .select('id, title, body, image_url, link_url, placement, priority, starts_at, ends_at')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      throw new ValidationError('Failed to fetch promotion', { supabaseError: error })
    }
    if (!data) {
      throw new NotFoundError(`Promotion not found: ${id}`)
    }

    return data as Promotion
  }
}
