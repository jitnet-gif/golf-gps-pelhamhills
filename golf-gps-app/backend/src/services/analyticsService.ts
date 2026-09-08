/**
 * 배너 노출·클릭 집계 서비스
 * src/services/analyticsService.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ValidationError } from '../middleware/errorHandler'
import type {
  PromotionEventInput,
  PromotionStats,
  TrackEventsResult,
} from '../schemas/analytics'
import type { PromotionPlacement } from '../schemas/promotions'

/** 유니크 인덱스 위반. 노출을 하루 한 번으로 세는 장치가 제 일을 한 것입니다. */
const PG_UNIQUE_VIOLATION = '23505'

/** 외래키 위반. 이벤트가 만들어진 뒤 배너가 지워졌을 때 납니다. */
const PG_FOREIGN_KEY_VIOLATION = '23503'

/** DB에 넣을 행의 모양 */
interface EventRow {
  promotion_id: string
  device_id: string
  event_type: string
  placement: string
}

export class AnalyticsService {
  /**
   * @param supabase service_role 클라이언트여야 합니다.
   *   promotion_events와 v_promotion_stats에는 GRANT도 RLS 정책도 없어서
   *   anon 키로는 INSERT도 SELECT도 조용히 아무것도 하지 못합니다.
   */
  constructor(private supabase: SupabaseClient) {}

  /**
   * 이벤트 기록
   *
   * 집계는 있으면 좋은 것이지 사용자 화면을 깨뜨릴 이유가 아닙니다. 한 건이
   * 걸려도 나머지는 들어가야 하고, 요청 자체가 실패하면 안 됩니다.
   *
   * 먼저 전체를 한 번에 넣어 봅니다. INSERT 한 문장이므로 한 행만 걸려도
   * 전부 되돌아가는데, 그때만 한 건씩 다시 넣습니다. 대부분의 요청은
   * 아무것도 걸리지 않으므로 왕복 한 번으로 끝나고, 최악이라도
   * 1 + 20번입니다(Workers의 요청당 subrequest 상한에 한참 못 미칩니다).
   *
   * 넘어가는 것은 23505와 23503 둘뿐입니다. 권한이 빠졌거나 DB가 죽은 것까지
   * 삼키면, 집계가 통째로 유실되는 동안 로그에는 아무 흔적도 남지 않습니다.
   */
  async recordEvents(
    deviceId: string,
    events: PromotionEventInput[]
  ): Promise<TrackEventsResult> {
    const rows = dedupeImpressions(deviceId, events)
    if (rows.length === 0) {
      return { accepted: 0, skipped: events.length }
    }

    const { error } = await this.supabase.from('promotion_events').insert(rows)

    if (!error) {
      return { accepted: rows.length, skipped: events.length - rows.length }
    }
    if (!isIgnorableInsertError(error.code)) {
      throw new ValidationError('Failed to record promotion events', {
        supabaseError: error,
      })
    }

    let accepted = 0
    for (const row of rows) {
      const { error: rowError } = await this.supabase.from('promotion_events').insert(row)

      if (!rowError) {
        accepted += 1
      } else if (!isIgnorableInsertError(rowError.code)) {
        throw new ValidationError('Failed to record promotion events', {
          supabaseError: rowError,
        })
      }
    }

    return { accepted, skipped: events.length - accepted }
  }

  /**
   * 배너별 성적
   *
   * 뷰가 LEFT JOIN이라 이벤트가 하나도 없는 배너도 impressions 0,
   * click_rate_pct null로 함께 나옵니다. 이것이 원하는 모습입니다 -
   * 아무도 보지 않은 배너야말로 관리자가 가장 먼저 알아야 할 것이라,
   * null을 0으로 덮어 "클릭률 0%"인 척하지 않습니다.
   */
  async getStats(placement?: PromotionPlacement): Promise<PromotionStats[]> {
    let query = this.supabase
      .from('v_promotion_stats')
      .select(
        'promotion_id, title, placement, active, starts_at, ends_at, impressions, clicks, dismissals, click_rate_pct'
      )

    if (placement) {
      query = query.eq('placement', placement)
    }

    const { data, error } = await query.order('impressions', { ascending: false })

    if (error) {
      throw new ValidationError('Failed to fetch promotion stats', {
        supabaseError: error,
      })
    }

    return (data || []) as PromotionStats[]
  }
}

function isIgnorableInsertError(code: string | undefined): boolean {
  return code === PG_UNIQUE_VIOLATION || code === PG_FOREIGN_KEY_VIOLATION
}

/**
 * 한 요청 안의 중복 노출 정리
 *
 * 같은 배너를 두 자리에서 봤다며 impression 두 건이 함께 오는 일이 있는데,
 * 유니크 인덱스에는 placement가 없어서 DB는 이것을 중복으로 봅니다. 미리
 * 걸러 두지 않으면 그런 요청마다 한 건씩 다시 넣는 느린 길로 떨어집니다.
 * 클릭과 닫기는 행동이므로 몇 번을 하든 그대로 쌓습니다.
 */
function dedupeImpressions(deviceId: string, events: PromotionEventInput[]): EventRow[] {
  const seenImpressions = new Set<string>()
  const rows: EventRow[] = []

  for (const event of events) {
    if (event.eventType === 'impression') {
      if (seenImpressions.has(event.promotionId)) continue
      seenImpressions.add(event.promotionId)
    }

    rows.push({
      promotion_id: event.promotionId,
      device_id: deviceId,
      event_type: event.eventType,
      placement: event.placement,
    })
  }

  return rows
}
