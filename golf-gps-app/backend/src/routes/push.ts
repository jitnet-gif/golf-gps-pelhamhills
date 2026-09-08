/**
 * 푸시 알림 API 라우트
 * src/routes/push.ts
 *
 * GET  /api/push/vapid-public-key - 구독에 필요한 공개키
 * POST /api/push/subscribe        - 구독 등록
 * POST /api/push/unsubscribe      - 구독 해지
 * POST /api/push/send             - 발송 (관리자 키 필요)
 */

import { Hono } from 'hono'
import type { Env } from '../types/env'
import { createSupabaseServiceClient } from '../lib/supabase'
import { PushService, type PushPayload } from '../services/pushService'
import { PromotionService } from '../services/promotionService'
import {
  SendRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '../schemas/push'
import { ApiError, UnauthorizedError, ValidationError } from '../middleware/errorHandler'

type HonoEnv = {
  Bindings: Env
}

const router = new Hono<HonoEnv>()

/**
 * VAPID 설정 읽기
 *
 * 셋 중 하나라도 비어 있으면 푸시 기능 전체가 꺼진 것으로 봅니다.
 * 키가 없는데 구독만 받아 두면, 나중에 보낼 수 없는 구독이 쌓입니다.
 */
function getVapidConfig(env: Env) {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    throw new ApiError(
      'PUSH_NOT_CONFIGURED',
      'Push notifications are not configured on this deployment',
      503
    )
  }

  return {
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT,
  }
}

/**
 * 관리자 키 검증
 *
 * 길이가 다르면 곧바로 탈락시키되, 같은 길이일 때는 전체를 다 비교합니다.
 * 첫 글자에서 빠져나오면 응답 시간이 키를 한 글자씩 흘립니다.
 */
function requireAdminKey(env: Env, provided: string | undefined): void {
  const expected = env.ADMIN_API_KEY

  if (!expected) {
    throw new ApiError(
      'ADMIN_KEY_NOT_CONFIGURED',
      'ADMIN_API_KEY is not configured on this deployment',
      503
    )
  }
  if (!provided || provided.length !== expected.length) {
    throw new UnauthorizedError('Invalid admin key')
  }

  let mismatch = 0
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  }
  if (mismatch !== 0) {
    throw new UnauthorizedError('Invalid admin key')
  }
}

/**
 * GET /api/push/vapid-public-key
 *
 * 프론트엔드가 pushManager.subscribe()에 넣을 공개키입니다.
 * 빌드 타임 환경변수로 박아 둘 수도 있지만, 서버와 값이 어긋나면
 * 구독은 성공하고 발송만 조용히 실패합니다. 한 곳에서 가져오게 합니다.
 */
router.get('/api/push/vapid-public-key', (c) => {
  const { publicKey } = getVapidConfig(c.env)
  return c.json({ publicKey })
})

/**
 * POST /api/push/subscribe
 *
 * 요청 본문:
 * ```json
 * {
 *   "deviceId": "a1b2c3...",
 *   "subscription": { "endpoint": "https://...", "keys": { "p256dh": "...", "auth": "..." } },
 *   "topics": ["marketing"],
 *   "locale": "ko"
 * }
 * ```
 */
router.post('/api/push/subscribe', async (c) => {
  // 키가 없는 배포에서는 구독을 받지 않습니다.
  getVapidConfig(c.env)

  const body = await c.req.json().catch(() => {
    throw new ValidationError('Invalid JSON body')
  })
  const request = SubscribeRequestSchema.parse(body)

  // push_subscriptions에는 공개 RLS 정책이 없으므로 service_role이어야 합니다.
  const supabase = createSupabaseServiceClient(c.env)
  const pushService = new PushService(supabase, getVapidConfig(c.env))

  const { id } = await pushService.subscribe(request, c.req.header('User-Agent'))

  return c.json({ id, status: 'subscribed' }, { status: 201 })
})

/**
 * POST /api/push/unsubscribe
 *
 * 브라우저 쪽 구독은 이미 해지된 뒤일 수 있으므로, 없는 endpoint를 보내도
 * 200을 돌려줍니다. 해지는 여러 번 해도 같은 결과여야 합니다.
 */
router.post('/api/push/unsubscribe', async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError('Invalid JSON body')
  })
  const request = UnsubscribeRequestSchema.parse(body)

  const supabase = createSupabaseServiceClient(c.env)
  const pushService = new PushService(supabase, {
    // 해지는 암호화가 필요 없으므로 키가 없어도 동작해야 합니다.
    publicKey: c.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: c.env.VAPID_PRIVATE_KEY ?? '',
    subject: c.env.VAPID_SUBJECT ?? '',
  })

  await pushService.unsubscribe(request.endpoint)

  return c.json({ status: 'unsubscribed' })
})

/**
 * POST /api/push/send - 관리자 발송
 *
 * 헤더: `X-Admin-Key: <ADMIN_API_KEY>`
 *
 * 요청 본문 (직접 작성):
 * ```json
 * { "title": "주말 그린피 30% 할인", "body": "이번 주 토·일 오후 티타임", "url": "/", "topic": "marketing" }
 * ```
 *
 * 요청 본문 (등록된 배너를 그대로 발송):
 * ```json
 * { "promotionId": "uuid", "topic": "marketing" }
 * ```
 */
router.post('/api/push/send', async (c) => {
  requireAdminKey(c.env, c.req.header('X-Admin-Key'))

  const body = await c.req.json().catch(() => {
    throw new ValidationError('Invalid JSON body')
  })
  const request = SendRequestSchema.parse(body)

  const supabase = createSupabaseServiceClient(c.env)

  // promotionId가 있으면 배너 내용이 기본값이 되고, 요청에 직접 쓴 값이 이깁니다.
  let payload: PushPayload
  if (request.promotionId) {
    const promotion = await new PromotionService(supabase).getById(request.promotionId)
    payload = {
      title: request.title ?? promotion.title,
      body: request.body ?? promotion.body ?? undefined,
      url: request.url ?? promotion.link_url ?? '/',
      image: request.imageUrl ?? promotion.image_url ?? undefined,
      // 같은 배너를 두 번 보내도 알림은 하나로 합쳐집니다.
      tag: `promo-${promotion.id}`,
    }
  } else {
    payload = {
      // 스키마의 refine이 promotionId 없는 요청에는 title을 강제합니다.
      title: request.title as string,
      body: request.body,
      url: request.url ?? '/',
      image: request.imageUrl,
    }
  }

  const pushService = new PushService(supabase, getVapidConfig(c.env))
  const result = await pushService.send(payload, request)

  return c.json(result)
})

export default router
