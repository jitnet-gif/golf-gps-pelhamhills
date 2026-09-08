/**
 * 푸시 알림 API 스키마 검증
 * src/schemas/push.ts
 */

import { z } from 'zod'

// ============================================================
// 요청 스키마
// ============================================================

/** 브라우저 PushSubscription.toJSON()이 내놓는 모양 그대로 받습니다. */
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith('https://'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    // P-256 공개키(비압축 65바이트)의 base64url = 87~88자
    p256dh: z.string().min(80).max(200),
    // 인증 시크릿 16바이트의 base64url = 22~24자
    auth: z.string().min(16).max(48),
  }),
})

export type PushSubscriptionInput = z.infer<typeof PushSubscriptionSchema>

export const SubscribeRequestSchema = z.object({
  // 로그인이 없으므로 클라이언트가 만든 익명 기기 ID가 주인 역할을 합니다.
  deviceId: z.string().min(8).max(64),
  subscription: PushSubscriptionSchema,
  topics: z.array(z.string().max(40)).max(10).default(['marketing']),
  locale: z.string().max(10).optional(),
})

export type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>

export const UnsubscribeRequestSchema = z.object({
  endpoint: z.string().url(),
})

export type UnsubscribeRequest = z.infer<typeof UnsubscribeRequestSchema>

/** 관리자 발송 요청. promotionId를 주면 배너 내용을 그대로 알림으로 보냅니다. */
export const SendRequestSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    body: z.string().max(300).optional(),
    url: z.string().max(500).optional(),
    imageUrl: z.string().url().max(500).optional(),
    promotionId: z.string().uuid().optional(),
    // 이 토픽을 구독한 기기에만. 생략하면 살아있는 구독 전체.
    topic: z.string().max(40).optional(),
    // 특정 기기에만 보내는 테스트 발송.
    deviceId: z.string().min(8).max(64).optional(),
    ttl: z.number().int().min(0).max(60 * 60 * 24 * 28).default(60 * 60 * 24),
    urgency: z.enum(['low', 'normal', 'high']).default('normal'),
    // 한 번에 건드릴 구독 수. Workers의 요청당 subrequest 상한 때문에
    // 무제한 팬아웃은 조용히 잘려나갑니다. 상한은 pushService가 강제합니다.
    limit: z.number().int().min(1).max(500).default(500),
  })
  .refine((v) => !!v.promotionId || !!v.title, {
    message: 'title 또는 promotionId 중 하나는 있어야 합니다',
  })

export type SendRequest = z.infer<typeof SendRequestSchema>

// ============================================================
// 응답 스키마
// ============================================================

export const SendResultSchema = z.object({
  attempted: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  // 푸시 서비스가 404/410으로 죽었다고 알려준 구독 수
  revoked: z.number().int(),
})

export type SendResult = z.infer<typeof SendResultSchema>
