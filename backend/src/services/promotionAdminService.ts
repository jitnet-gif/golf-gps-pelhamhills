/**
 * 프로모션(마케팅 배너) 관리 서비스
 * src/services/promotionAdminService.ts
 *
 * 조회 전용인 promotionService와 달리 여기는 쓰기까지 합니다.
 * promotions에는 anon INSERT/UPDATE/DELETE 권한이 없으므로, 이 서비스는
 * 반드시 createSupabaseServiceClient로 만든 클라이언트를 받아야 합니다.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { NotFoundError, ValidationError } from '../middleware/errorHandler'
import type {
  AdminPromotion,
  CreatePromotionInput,
  UpdatePromotionInput,
} from '../schemas/admin'

/** 관리 화면에 필요한 전체 컬럼. select('*')를 쓰지 않는 이유는 컬럼이 늘어도 응답이 조용히 바뀌지 않게 하기 위해서입니다. */
const COLUMNS =
  'id, title, body, image_url, link_url, placement, priority, starts_at, ends_at, active, created_at, updated_at'

/**
 * PATCH 본문을 UPDATE에 넣을 값으로 바꿉니다.
 *
 * "안 보낸 필드"와 "null로 보낸 필드"를 가르는 지점입니다. JSON에는
 * undefined가 없으니 값이 undefined면 클라이언트가 보내지 않은 것이고,
 * null이면 지워 달라는 뜻입니다. 전자를 그대로 넘기면 supabase-js가 컬럼을
 * NULL로 덮어써서, 제목만 고치려던 요청이 이미지와 기간까지 날려 버립니다.
 */
function toColumnPatch(patch: UpdatePromotionInput): Record<string, unknown> {
  const changes: Record<string, unknown> = {}

  for (const [column, value] of Object.entries(patch)) {
    if (value !== undefined) changes[column] = value
  }

  return changes
}

/**
 * Postgres 에러를 사람이 읽을 수 있는 400으로 바꿉니다.
 *
 * 23514는 CHECK 위반이고, 이 테이블에서는 사실상 노출 기간이 뒤집혔거나
 * placement가 목록에 없는 값일 때입니다. 그대로 흘리면 관리자에게
 * 제약 조건 이름만 돌아갑니다.
 */
function toApiError(error: PostgrestError, fallback: string): ValidationError {
  if (error.code === '23514') {
    return new ValidationError('배너 값이 제약 조건에 맞지 않습니다 (노출 기간/placement 확인)', {
      supabaseError: error,
    })
  }

  return new ValidationError(fallback, { supabaseError: error })
}

export class PromotionAdminService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * 배너 전체 목록
   *
   * listLive와 달리 active=false도, 기간이 끝난 것도 모두 나옵니다.
   * 관리 화면은 내려간 배너를 다시 올리거나 지우려고 보는 곳이라,
   * 노출 규칙으로 거르면 정작 손대야 할 배너가 화면에서 사라집니다.
   *
   * 정렬은 priority가 아니라 created_at입니다. 방금 등록한 배너가 맨 위에
   * 있어야 등록이 됐는지 확인할 수 있습니다.
   */
  async list(limit: number, offset: number): Promise<{ data: AdminPromotion[]; total: number }> {
    const { data, error, count } = await this.supabase
      .from('promotions')
      .select(COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw toApiError(error, 'Failed to fetch promotions')
    }

    return { data: (data || []) as AdminPromotion[], total: count ?? 0 }
  }

  /** 배너 등록. 기본값(placement/priority/active)은 스키마가 이미 채워서 넘깁니다. */
  async create(input: CreatePromotionInput): Promise<AdminPromotion> {
    const { data, error } = await this.supabase
      .from('promotions')
      .insert(input)
      .select(COLUMNS)
      .single()

    if (error) {
      throw toApiError(error, 'Failed to create promotion')
    }

    return data as AdminPromotion
  }

  /**
   * 배너 부분 수정
   *
   * updated_at은 건드리지 않습니다. trg_promotions_updated_at 트리거가
   * 갱신하므로, 여기서 또 넣으면 두 곳이 서로 어긋날 수 있습니다.
   *
   * service_role이라 RLS가 걸리지 않으니, 돌아온 행이 없다는 것은
   * 권한 문제가 아니라 그런 id가 없다는 뜻입니다.
   */
  async update(id: string, patch: UpdatePromotionInput): Promise<AdminPromotion> {
    const { data, error } = await this.supabase
      .from('promotions')
      .update(toColumnPatch(patch))
      .eq('id', id)
      .select(COLUMNS)
      .maybeSingle()

    if (error) {
      throw toApiError(error, 'Failed to update promotion')
    }
    if (!data) {
      throw new NotFoundError(`Promotion not found: ${id}`)
    }

    return data as AdminPromotion
  }

  /**
   * 배너 삭제
   *
   * promotion_events가 ON DELETE CASCADE라 노출·클릭 집계도 같이 사라집니다.
   * 잠깐 내리는 것이 목적이라면 삭제가 아니라 active=false로 해야 합니다.
   *
   * 지워진 행을 돌려받아야 없는 id를 404로 구분할 수 있습니다.
   * delete만 하면 0건이든 1건이든 똑같이 성공으로 돌아옵니다.
   */
  async remove(id: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('promotions')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) {
      throw toApiError(error, 'Failed to delete promotion')
    }
    if (!data) {
      throw new NotFoundError(`Promotion not found: ${id}`)
    }
  }
}
