/**
 * 예약 발송(푸시 캠페인) 서비스
 * src/services/campaignService.ts
 *
 * push_campaigns에는 공개 RLS 정책도 GRANT도 없습니다. 이 서비스에 넘기는
 * 클라이언트는 반드시 createSupabaseServiceClient여야 하고, anon 키로 부르면
 * 조회는 빈 배열, 쓰기는 조용히 0행으로 끝납니다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler'
import type { Campaign, CreateCampaignRequest, ListCampaignsQuery } from '../schemas/campaigns'

/** 행 전체를 그대로 내보내므로 컬럼 목록을 한 곳에 둡니다. */
const CAMPAIGN_COLUMNS =
  'id, title, body, url, image_url, promotion_id, topic, scheduled_at, status, ' +
  'attempted, delivered, failed, error, started_at, completed_at, created_at, updated_at'

/** DB error 텍스트 컬럼에 스택 전체를 붓지 않기 위한 상한 */
const MAX_ERROR_LENGTH = 1000

export class CampaignService {
  /** @param supabase service_role 클라이언트여야 합니다. */
  constructor(private supabase: SupabaseClient) {}

  /**
   * 목록 (최신 등록순)
   *
   * scheduled_at이 아니라 created_at 기준입니다. 관리 화면에서 방금 만든
   * 예약이 맨 위에 있어야 등록이 됐는지 눈으로 확인할 수 있습니다.
   */
  async list(query: ListCampaignsQuery): Promise<Campaign[]> {
    let request = this.supabase.from('push_campaigns').select(CAMPAIGN_COLUMNS)

    if (query.status) {
      request = request.eq('status', query.status)
    }

    const { data, error } = await request
      .order('created_at', { ascending: false })
      .limit(query.limit)

    if (error) {
      throw new ValidationError('Failed to list campaigns', { supabaseError: error })
    }

    return (data || []) as unknown as Campaign[]
  }

  /**
   * 예약 등록
   *
   * scheduled_at은 UTC로 정규화해서 넣습니다. 관리 화면이 '+09:00'을 보내든
   * 'Z'를 보내든 컬럼에 같은 모양으로 쌓여야 나중에 눈으로 비교할 수 있습니다.
   */
  async create(request: CreateCampaignRequest): Promise<Campaign> {
    const { data, error } = await this.supabase
      .from('push_campaigns')
      .insert({
        title: request.title ?? null,
        body: request.body ?? null,
        url: request.url ?? null,
        image_url: request.imageUrl ?? null,
        promotion_id: request.promotionId ?? null,
        topic: request.topic,
        scheduled_at: new Date(request.scheduledAt).toISOString(),
      })
      .select(CAMPAIGN_COLUMNS)
      .single()

    if (error) {
      // 없는 배너를 가리키면 FK 위반(23503)입니다. 서버 잘못이 아니므로 400.
      throw new ValidationError('Failed to create campaign', { supabaseError: error })
    }

    return data as unknown as Campaign
  }

  /**
   * 취소
   *
   * pending일 때만 취소할 수 있습니다. 조건부 UPDATE가 0행이면 "없는 id"와
   * "이미 보낸 캠페인"이 구분되지 않으므로, 그때만 한 번 더 읽어서
   * 404와 409를 갈라 줍니다. 부르는 쪽 입장에서 이 둘은 완전히 다른 상황입니다.
   */
  async cancel(id: string): Promise<Campaign> {
    const { data, error } = await this.supabase
      .from('push_campaigns')
      .update({ status: 'canceled' })
      .eq('id', id)
      .eq('status', 'pending')
      .select(CAMPAIGN_COLUMNS)
      .maybeSingle()

    if (error) {
      throw new ValidationError('Failed to cancel campaign', { supabaseError: error })
    }
    if (data) {
      return data as unknown as Campaign
    }

    const { data: existing, error: lookupError } = await this.supabase
      .from('push_campaigns')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()

    if (lookupError) {
      throw new ValidationError('Failed to cancel campaign', { supabaseError: lookupError })
    }
    if (!existing) {
      throw new NotFoundError(`Campaign not found: ${id}`)
    }

    throw new ConflictError(
      `Campaign is ${existing.status}, only pending campaigns can be canceled`
    )
  }

  /**
   * 보낼 때가 된 캠페인 id 목록
   *
   * scheduled_at 오름차순입니다. 한 번에 처리할 수를 제한하는 이상,
   * 최신순으로 집으면 밀린 캠페인이 영원히 뒤로 밀립니다.
   */
  async findDue(now: string, limit: number): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('push_campaigns')
      .select('id')
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(limit)

    if (error) {
      throw new ValidationError('Failed to find due campaigns', { supabaseError: error })
    }

    return (data || []).map((row) => row.id as string)
  }

  /**
   * pending -> sending 낚아채기
   *
   * 이 메서드가 이 파일에서 가장 중요합니다. 조회한 뒤 그냥 보내면, Cron이
   * 겹쳐 돌거나 앞 실행이 늦어졌을 때 같은 캠페인을 두 번 보내게 되고
   * 사용자에게는 같은 알림이 두 번 옵니다.
   *
   * WHERE에 status='pending'을 함께 걸면 Postgres가 행 잠금을 잡고 조건을
   * 다시 확인하므로, 동시에 들어온 둘 중 하나만 행을 받아 갑니다.
   * null이 돌아왔다는 것은 남이 먼저 가져갔거나 그 사이 취소됐다는 뜻이니
   * 조용히 건너뛰어야 합니다.
   */
  async claim(id: string): Promise<Campaign | null> {
    const { data, error } = await this.supabase
      .from('push_campaigns')
      .update({ status: 'sending', started_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select(CAMPAIGN_COLUMNS)
      .maybeSingle()

    if (error) {
      throw new ValidationError('Failed to claim campaign', { supabaseError: error })
    }

    return (data as unknown as Campaign) ?? null
  }

  /**
   * 발송 완료 기록
   *
   * attempted가 0이어도 sent입니다. 대상 구독이 없는 것은 실패가 아니라
   * 그냥 아무도 구독하지 않았다는 사실이고, failed로 적으면 진짜 실패와
   * 섞여 목록에서 구분할 수 없게 됩니다.
   */
  async markSent(
    id: string,
    result: { attempted: number; delivered: number; failed: number }
  ): Promise<void> {
    const { error } = await this.supabase
      .from('push_campaigns')
      .update({
        status: 'sent',
        attempted: result.attempted,
        delivered: result.delivered,
        failed: result.failed,
        error: null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      throw new ValidationError('Failed to record campaign result', { supabaseError: error })
    }
  }

  /**
   * 발송 실패 기록
   *
   * pending으로 되돌리지 않습니다. 되돌리면 다음 Cron이 같은 실패를 반복하고,
   * 이미 절반쯤 나간 발송이라면 받은 사람에게 두 번째 알림이 갑니다.
   * 다시 보낼지는 사람이 새 캠페인을 만들어 정할 일입니다.
   */
  async markFailed(id: string, message: string): Promise<void> {
    const { error } = await this.supabase
      .from('push_campaigns')
      .update({
        status: 'failed',
        error: message.slice(0, MAX_ERROR_LENGTH),
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      throw new ValidationError('Failed to record campaign failure', { supabaseError: error })
    }
  }
}
