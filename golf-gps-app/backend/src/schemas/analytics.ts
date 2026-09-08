/**
 * 배너 노출·클릭 집계 API 스키마 검증
 * src/schemas/analytics.ts
 */

import { z } from 'zod'
import { PromotionPlacementSchema } from './promotions'

// ============================================================
// 요청 스키마
// ============================================================

export const PromotionEventTypeSchema = z.enum(['impression', 'click', 'dismiss'])

export type PromotionEventType = z.infer<typeof PromotionEventTypeSchema>

/**
 * 이벤트 한 건
 *
 * created_at은 받지 않습니다. 노출을 하루 한 번으로 세는 유니크 인덱스가
 * created_at에서 날짜를 뽑아 쓰기 때문에, 시각을 클라이언트가 정하게 두면
 * 어제 날짜를 적어 보내는 것만으로 하루 상한을 얼마든지 넘길 수 있습니다.
 */
export const PromotionEventSchema = z.object({
  promotionId: z.string().uuid(),
  eventType: PromotionEventTypeSchema,
  placement: PromotionPlacementSchema,
})

export type PromotionEventInput = z.infer<typeof PromotionEventSchema>

/**
 * 이벤트 수집 요청
 *
 * 관리자 키가 없는 공개 엔드포인트라 아무나 부를 수 있습니다. 레이트 리밋은
 * 이 층에서 할 일이 아니지만, 한 번의 요청으로 넣을 수 있는 양과 device_id의
 * 모양만은 여기서 못박습니다. device_id는 프론트엔드가 만든 32자리 hex(UUID에서
 * 하이픈을 뺀 값)이며, DB 컬럼도 VARCHAR(64)입니다.
 *
 * events가 비어 있어도 통과시킵니다. 받는 쪽은 sendBeacon이라 400을 읽을
 * 사람이 없고, 넣을 게 없다는 것은 실패가 아닙니다.
 */
export const TrackEventsRequestSchema = z.object({
  deviceId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'deviceId must be alphanumeric'),
  events: z.array(PromotionEventSchema).max(20),
})

export type TrackEventsRequest = z.infer<typeof TrackEventsRequestSchema>

export const GetPromotionStatsQuerySchema = z.object({
  placement: PromotionPlacementSchema.optional(),
})

export type GetPromotionStatsQuery = z.infer<typeof GetPromotionStatsQuerySchema>

// ============================================================
// 응답 스키마
// ============================================================

export const TrackEventsResultSchema = z.object({
  accepted: z.number().int(),
  // 하루 한 번 상한에 걸렸거나, 이미 지워진 배너를 가리키던 이벤트 수
  skipped: z.number().int(),
})

export type TrackEventsResult = z.infer<typeof TrackEventsResultSchema>

/** v_promotion_stats 뷰 한 행 */
export const PromotionStatsSchema = z.object({
  promotion_id: z.string().uuid(),
  title: z.string(),
  placement: PromotionPlacementSchema,
  active: z.boolean(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  impressions: z.number().int(),
  clicks: z.number().int(),
  dismissals: z.number().int(),
  // 노출이 0이면 나눌 것이 없어 null입니다.
  click_rate_pct: z.number().nullable(),
})

export type PromotionStats = z.infer<typeof PromotionStatsSchema>
