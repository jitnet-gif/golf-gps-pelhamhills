/**
 * 웹 푸시 발송 서비스
 * src/services/pushService.ts
 *
 * Cloudflare Workers에서 동작해야 하므로 Node 전용 web-push 패키지는 쓸 수 없습니다.
 * @block65/webcrypto-web-push는 WebCrypto만 사용하고, 최신 규격인
 * RFC 8291(aes128gcm 페이로드 암호화) + RFC 8292(vapid t=..., k=...)로 보냅니다.
 * 구형 aesgcm 방식은 Apple(사파리/iOS)이 거부하므로 이 조합이어야 합니다.
 */

import { buildPushPayload } from '@block65/webcrypto-web-push'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ValidationError } from '../middleware/errorHandler'
import type { SendRequest, SendResult, SubscribeRequest } from '../schemas/push'

/** DB에 저장된 구독 한 건 */
interface StoredSubscription {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * 알림 하나가 서비스워커로 실어 보내는 내용.
 * public/push-sw.js의 push 핸들러가 읽는 필드와 1:1로 맞춰야 합니다.
 */
export interface PushPayload {
  title: string
  body?: string
  url?: string
  image?: string
  tag?: string
}

/**
 * 한 번의 발송에서 건드릴 수 있는 최대 구독 수.
 * Workers는 요청 하나당 subrequest 수에 상한이 있습니다(무료 50, 유료 1000).
 * 여기서 넘기면 초과분이 조용히 실패하므로, 상한 아래로 잘라 두고
 * 그보다 큰 대상은 여러 번 나눠 보내게 합니다.
 */
const MAX_FAN_OUT = 500

/**
 * 동시에 열어 두는 요청 수. 푸시 서비스는 순차 전송을 견디지만
 * 500건을 하나씩 보내면 Workers CPU 시간 안에 끝나지 않습니다.
 */
const CONCURRENCY = 25

export class PushService {
  /**
   * @param supabase service_role 클라이언트여야 합니다.
   *   push_subscriptions에는 공개 정책이 없어 anon 키로는 아무것도 보이지 않습니다.
   */
  constructor(
    private supabase: SupabaseClient,
    private vapid: { subject: string; publicKey: string; privateKey: string }
  ) {}

  /**
   * 구독 등록 (재등록 포함)
   *
   * endpoint에 UNIQUE 제약이 있으므로 upsert 한 번이면 됩니다.
   * 같은 기기가 브라우저 데이터를 지우고 다시 구독하면 endpoint가 바뀌는데,
   * 그때 남는 옛 구독은 발송 중 404/410을 받아 자동으로 정리됩니다.
   */
  async subscribe(request: SubscribeRequest, userAgent?: string): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .from('push_subscriptions')
      .upsert(
        {
          device_id: request.deviceId,
          endpoint: request.subscription.endpoint,
          p256dh: request.subscription.keys.p256dh,
          auth: request.subscription.keys.auth,
          topics: request.topics,
          locale: request.locale ?? null,
          user_agent: userAgent ?? null,
          last_seen_at: new Date().toISOString(),
          // 다시 구독했다는 것은 살아났다는 뜻입니다.
          revoked_at: null,
        },
        { onConflict: 'endpoint' }
      )
      .select('id')
      .single()

    if (error) {
      throw new ValidationError('Failed to store push subscription', {
        supabaseError: error,
      })
    }

    return { id: data.id as string }
  }

  /**
   * 구독 해지
   *
   * 행을 지우지 않고 revoked_at만 찍습니다. 같은 기기가 다시 켤 때
   * 구독 이력이 남아 있는 편이 진단에 쓸모가 있습니다.
   */
  async unsubscribe(endpoint: string): Promise<void> {
    const { error } = await this.supabase
      .from('push_subscriptions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('endpoint', endpoint)

    if (error) {
      throw new ValidationError('Failed to revoke push subscription', {
        supabaseError: error,
      })
    }
  }

  /**
   * 대상 구독 조회
   *
   * topic을 주면 그 토픽을 배열에 담은 구독만, deviceId를 주면 그 기기만.
   * 어느 쪽이든 revoked된 구독은 제외합니다.
   */
  private async findTargets(request: SendRequest): Promise<StoredSubscription[]> {
    let query = this.supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .is('revoked_at', null)

    if (request.deviceId) {
      query = query.eq('device_id', request.deviceId)
    }
    if (request.topic) {
      // topics는 TEXT[]이므로 배열 포함 검사
      query = query.contains('topics', [request.topic])
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(Math.min(request.limit, MAX_FAN_OUT))

    if (error) {
      throw new ValidationError('Failed to load push subscriptions', {
        supabaseError: error,
      })
    }

    return (data || []) as StoredSubscription[]
  }

  /**
   * 구독 하나에 실제로 보내기
   *
   * 반환값의 gone은 "이 구독은 죽었다"는 뜻입니다. 푸시 서비스는
   * 404(모르는 구독) 또는 410(만료된 구독)으로 그것을 알려줍니다.
   */
  private async sendOne(
    subscription: StoredSubscription,
    payload: PushPayload,
    options: { ttl: number; urgency: 'low' | 'normal' | 'high' }
  ): Promise<{ ok: boolean; gone: boolean }> {
    try {
      // 값이 없는 필드는 빼고 보냅니다. JSON에 "body": null을 실어 보내면
      // 서비스워커가 빈 줄짜리 알림을 그리게 되고, 페이로드는 4KB 예산 안에서
      // 움직여야 합니다.
      const data: Record<string, string> = {}
      for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined) data[key] = value
      }

      const { headers, body, method } = await buildPushPayload(
        { data, options },
        {
          endpoint: subscription.endpoint,
          expirationTime: null,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        this.vapid
      )

      const res = await fetch(subscription.endpoint, {
        method,
        headers,
        body: body as unknown as BodyInit,
      })

      return { ok: res.ok, gone: res.status === 404 || res.status === 410 }
    } catch {
      // 네트워크 오류는 일시적일 수 있으므로 구독을 죽이지 않습니다.
      return { ok: false, gone: false }
    }
  }

  /**
   * 발송
   *
   * 죽은 구독은 이번 발송 안에서 한 번에 revoked 처리합니다.
   * 매 실패마다 UPDATE를 날리면 subrequest 예산을 발송이 아니라
   * 정리 작업에 써 버리게 됩니다.
   */
  async send(payload: PushPayload, request: SendRequest): Promise<SendResult> {
    const targets = await this.findTargets(request)

    const result: SendResult = {
      attempted: targets.length,
      delivered: 0,
      failed: 0,
      revoked: 0,
    }
    const goneIds: string[] = []

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY)
      const outcomes = await Promise.all(
        batch.map((t) =>
          this.sendOne(t, payload, { ttl: request.ttl, urgency: request.urgency }).then(
            (r) => ({ ...r, id: t.id })
          )
        )
      )

      for (const outcome of outcomes) {
        if (outcome.ok) result.delivered += 1
        else result.failed += 1
        if (outcome.gone) goneIds.push(outcome.id)
      }
    }

    if (goneIds.length > 0) {
      const { error } = await this.supabase
        .from('push_subscriptions')
        .update({ revoked_at: new Date().toISOString() })
        .in('id', goneIds)

      // 정리 실패로 발송 결과를 뒤집지는 않습니다. 다음 발송에서 다시 걸립니다.
      if (!error) result.revoked = goneIds.length
    }

    return result
  }
}
