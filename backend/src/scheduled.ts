/**
 * Cron 핸들러 - 예약된 푸시 캠페인 발송
 * src/scheduled.ts
 *
 * wrangler.toml의 [triggers] crons 설정이 이 함수를 5분마다 깨웁니다.
 * 하는 일은 하나입니다: 보낼 때가 된 캠페인을 낚아채서 보내고 결과를 적는다.
 *
 * index.ts가 `export default { fetch: app.fetch, scheduled }` 형태로
 * 함께 내보내야 트리거가 실제로 동작합니다. Hono 앱만 default export하면
 * 크론은 조용히 아무 일도 하지 않습니다.
 */

// ExecutionContext는 hono가 다시 내보내는 타입을 씁니다. 이 패키지의 tsconfig는
// @cloudflare/workers-types의 전역 타입을 들이지 않아서(그래서 types/env.ts의
// R2Bucket 등이 이미 에러입니다), 전역 이름을 그대로 쓰면 컴파일되지 않습니다.
import type { ExecutionContext } from 'hono'
import type { Env } from './types/env'
import { createSupabaseServiceClient } from './lib/supabase'
import { CampaignService } from './services/campaignService'
import { PromotionService } from './services/promotionService'
import { PushService, type PushPayload } from './services/pushService'
import type { Campaign } from './schemas/campaigns'
import type { SendRequest } from './schemas/push'

/**
 * 한 번의 실행에서 처리할 캠페인 수.
 *
 * 캠페인 하나가 최대 500건까지 팬아웃하고, Workers는 호출 하나당
 * subrequest 상한이 있습니다(무료 50, 유료 1000). 5 × 500은 이미 상한을
 * 넘는 숫자지만, 실제 토픽 구독자 수는 그보다 훨씬 적어서 현실적인 한도로
 * 잡았습니다. 같은 시각에 5건 넘게 예약돼 있으면 남은 것은 5분 뒤에
 * 다음 실행이 집어 갑니다 - 오래 밀린 것부터 순서대로.
 */
const MAX_CAMPAIGNS_PER_RUN = 5

/** 예약 발송의 전송 옵션. 관리 화면에서 고르게 할 만큼 쓸모 있는 값이 아직 없습니다. */
const DEFAULT_TTL_SECONDS = 60 * 60 * 24
const MAX_FAN_OUT = 500

/**
 * 이 배포에서 발송이 가능한지
 *
 * VAPID 키가 없으면 푸시 자체가 꺼진 배포이고, service_role 키가 없으면
 * push_campaigns가 보이지도 않습니다. 어느 쪽이든 5분마다 예외를 던지며
 * 로그를 채우는 것보다 조용히 손을 떼는 편이 낫습니다.
 */
function getSendConfig(env: Env) {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUPABASE_SERVICE_ROLE_KEY } = env

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT || !SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }

  return {
    subject: VAPID_SUBJECT,
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
  }
}

/**
 * 캠페인 한 건을 알림 내용으로 바꾸기
 *
 * promotion_id가 있으면 배너 내용이 기본값이 되고, 캠페인에 직접 적은 값이
 * 이깁니다. routes/push.ts의 /api/push/send와 같은 규칙입니다 - 즉석 발송과
 * 예약 발송이 같은 입력에 다른 알림을 만들면 안 됩니다.
 */
async function buildPayload(
  campaign: Campaign,
  promotions: PromotionService
): Promise<PushPayload> {
  if (campaign.promotion_id) {
    const promotion = await promotions.getById(campaign.promotion_id)
    return {
      title: campaign.title ?? promotion.title,
      body: campaign.body ?? promotion.body ?? undefined,
      url: campaign.url ?? promotion.link_url ?? '/',
      image: campaign.image_url ?? promotion.image_url ?? undefined,
      // 같은 배너를 두 번 보내도 알림은 하나로 합쳐집니다.
      tag: `promo-${promotion.id}`,
    }
  }

  return {
    // DB의 push_campaigns_has_content 제약이 promotion_id 없는 행에 title을 강제합니다.
    title: campaign.title as string,
    body: campaign.body ?? undefined,
    url: campaign.url ?? '/',
    image: campaign.image_url ?? undefined,
  }
}

/**
 * 예약 발송 실행
 *
 * @param env Workers 환경 바인딩
 * @param _ctx ExecutionContext. 지금은 쓰지 않지만 시그니처는 유지합니다 -
 *   이 함수는 scheduled 핸들러 안에서 await 되어야 합니다. waitUntil로
 *   감싸 던져 놓으면 발송이 끝나기 전에 호출이 끝날 수 있습니다.
 */
export async function handleScheduled(env: Env, _ctx: ExecutionContext): Promise<void> {
  const vapid = getSendConfig(env)
  if (!vapid) return

  const supabase = createSupabaseServiceClient(env)
  const campaigns = new CampaignService(supabase)
  const promotions = new PromotionService(supabase)
  const push = new PushService(supabase, vapid)

  const dueIds = await campaigns.findDue(new Date().toISOString(), MAX_CAMPAIGNS_PER_RUN)

  /*
   * 순차 처리입니다. 병렬로 돌리면 최대 5 × 500개의 fetch가 한꺼번에 열려
   * subrequest 상한에 부딪히고, 초과분은 에러도 없이 그냥 실패합니다.
   */
  for (const id of dueIds) {
    // 낚아채지 못했다 = 다른 실행이 먼저 가져갔거나 그 사이 취소됐다.
    const campaign = await campaigns.claim(id)
    if (!campaign) continue

    try {
      const payload = await buildPayload(campaign, promotions)

      const request: SendRequest = {
        topic: campaign.topic,
        ttl: DEFAULT_TTL_SECONDS,
        urgency: 'normal',
        limit: MAX_FAN_OUT,
      }

      // revoked는 결과에 있지만 push_campaigns에는 없는 컬럼이라 버립니다.
      const { attempted, delivered, failed } = await push.send(payload, request)
      await campaigns.markSent(campaign.id, { attempted, delivered, failed })
    } catch (error) {
      /*
       * 실패는 failed로 못 박습니다. status를 pending으로 되돌리면 5분마다
       * 같은 실패를 영원히 반복하고, 중간까지 나간 발송이라면 이미 받은
       * 사람이 두 번째 알림을 받습니다.
       *
       * 여기서 예외가 터지면(DB가 아예 안 될 때) 그 캠페인은 sending으로
       * 남습니다. 자동으로 pending으로 되돌리지 않는 것은 의도입니다 -
       * 어디까지 나갔는지 모르는 채 다시 보내는 것이 이 설계가 막으려는
       * 바로 그 일입니다. 남은 캠페인은 계속 처리합니다.
       */
      const message = error instanceof Error ? error.message : String(error)
      try {
        await campaigns.markFailed(campaign.id, message)
      } catch (markError) {
        console.error('[cron] failed to mark campaign failed', campaign.id, markError)
      }
    }
  }
}
