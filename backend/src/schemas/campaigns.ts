/**
 * 예약 발송(푸시 캠페인) API 스키마 검증
 * src/schemas/campaigns.ts
 */

import { z } from 'zod'

// ============================================================
// 공통
// ============================================================

/**
 * 상태 흐름: pending -> sending -> sent | failed, 그리고 pending -> canceled.
 * migrations/0004의 CHECK 제약과 값이 같아야 합니다. 여기서 하나 빠지면
 * 필터가 조용히 아무것도 못 걸러냅니다.
 */
export const CampaignStatusSchema = z.enum([
  'pending',
  'sending',
  'sent',
  'failed',
  'canceled',
])

export type CampaignStatus = z.infer<typeof CampaignStatusSchema>

/**
 * 예약 시각이 과거여도 받아주는 여유.
 *
 * 관리 화면에서 "지금"을 고르면 왕복 지연 때문에 서버에 닿을 때는 이미
 * 몇 초 전입니다. 엄격하게 자르면 멀쩡한 의도가 400을 받습니다.
 * 어차피 Cron은 5분마다 도므로 초 단위 정밀도는 의미가 없습니다.
 */
const SCHEDULE_GRACE_MS = 60 * 1000

/**
 * snake_case로 온 필드를 camelCase로 맞춰 줍니다.
 *
 * 요청 본문은 push.ts와 같은 camelCase가 정본입니다. 다만 응답은 DB 행
 * 그대로(snake_case)라서, 관리 화면이 방금 받은 행을 그대로 되돌려 보내는
 * 실수를 하기 쉽습니다. 그때 400 대신 의도대로 동작하게 두는 편이 낫습니다.
 */
const SNAKE_CASE_ALIASES: Record<string, string> = {
  promotion_id: 'promotionId',
  image_url: 'imageUrl',
  scheduled_at: 'scheduledAt',
}

function normalizeKeys(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return input
  }

  const out = { ...(input as Record<string, unknown>) }
  for (const [snake, camel] of Object.entries(SNAKE_CASE_ALIASES)) {
    if (!(snake in out)) continue
    // 둘 다 왔다면 camelCase가 정본이므로 그쪽을 남깁니다.
    if (!(camel in out)) out[camel] = out[snake]
    delete out[snake]
  }
  return out
}

// ============================================================
// 요청 스키마
// ============================================================

export const ListCampaignsQuerySchema = z.object({
  status: CampaignStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export type ListCampaignsQuery = z.infer<typeof ListCampaignsQuerySchema>

/**
 * 예약 등록 요청.
 *
 * promotionId를 주면 발송 시점에 배너 내용을 읽어 채웁니다. 등록 시점에
 * 복사해 두지 않는 이유: 예약해 둔 뒤 배너 문구를 고치면, 사람은 고친 문구가
 * 나갈 것이라고 기대합니다.
 */
export const CreateCampaignSchema = z.preprocess(
  normalizeKeys,
  z
    .object({
      title: z.string().min(1).max(120).optional(),
      body: z.string().max(300).optional(),
      url: z.string().max(500).optional(),
      imageUrl: z.string().url().max(500).optional(),
      promotionId: z.string().uuid().optional(),
      // 이 토픽을 구독한 기기에만 나갑니다.
      topic: z.string().min(1).max(40).default('marketing'),
      // 오프셋을 허용해야 '2026-09-08T20:00:00+09:00' 같은 값이 통과합니다.
      scheduledAt: z.string().datetime({ offset: true }),
    })
    // DB의 push_campaigns_has_content 제약과 같은 규칙입니다.
    .refine((v) => !!v.promotionId || !!v.title, {
      message: 'title 또는 promotionId 중 하나는 있어야 합니다',
      path: ['title'],
    })
    .refine((v) => new Date(v.scheduledAt).getTime() >= Date.now() - SCHEDULE_GRACE_MS, {
      message: 'scheduledAt은 과거일 수 없습니다',
      path: ['scheduledAt'],
    })
)

export type CreateCampaignRequest = z.infer<typeof CreateCampaignSchema>

// ============================================================
// 응답 스키마
// ============================================================

/** DB 행 그대로 내보냅니다(snake_case). */
export const CampaignSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  url: z.string().nullable(),
  image_url: z.string().nullable(),
  promotion_id: z.string().uuid().nullable(),
  topic: z.string(),
  scheduled_at: z.string(),
  status: CampaignStatusSchema,
  attempted: z.number().int().nullable(),
  delivered: z.number().int().nullable(),
  failed: z.number().int().nullable(),
  error: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type Campaign = z.infer<typeof CampaignSchema>

export const ListCampaignsResponseSchema = z.object({
  data: z.array(CampaignSchema),
})

export type ListCampaignsResponse = z.infer<typeof ListCampaignsResponseSchema>
