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
   * 반드시 anon 클라이언트(createSupabaseClient)로 호출해야 합니다.
   * active와 노출 기간을 거르는 것은 RLS의 promotions_read_live 정책이고,
   * 그 정책은 anon에만 걸립니다. service_role로 부르면 아직 시작하지 않은
   * 배너까지 딸려 나옵니다.
   *
   * 같은 조건을 쿼리에 한 번 더 쓰지 않습니다. PostgREST에서 .or()를 연달아
   * 부르면 같은 이름의 파라미터가 겹쳐 한쪽이 묻히고, 무엇보다 규칙이 두
   * 군데로 갈라져 서로 어긋나기 시작합니다.
   */
  async listLive(placement?: PromotionPlacement, limit = 5): Promise<Promotion[]> {
    let query = this.supabase
      .from('promotions')
      .select('id, title, body, image_url, link_url, placement, priority, starts_at, ends_at')

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
