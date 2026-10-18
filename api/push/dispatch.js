/**
 * 예약 발송 한 건 보내기 - POST /api/push/dispatch
 *
 * 부르는 쪽은 Supabase 입니다. pg_cron 이 1분마다 push_dispatch_due()
 * (migration 0010)를 돌리고, 보낼 때가 된 예약이 있으면 { campaign_id, token }
 * 을 여기로 보냅니다. 이 함수는
 *   1. 그 토큰으로 push_campaign_batch 에서 알림 내용과 받을 폰 목록을 받고,
 *   2. 폰마다 암호화해 푸시 서비스(구글·애플·모질라)로 보내고,
 *   3. push_campaign_report 로 결과를 적습니다.
 *
 * 데이터베이스 마스터 키(service_role)는 쓰지 않습니다. 앱과 같은 공개 키만 쓰고,
 * 구독 목록은 발송 중인 예약의 일회용 토큰이 있어야만 나옵니다. 토큰 없이 이
 * 주소를 두드리면 404 만 돌아옵니다.
 *
 * 환경 변수 (Vercel > Settings > Environment Variables)
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  한 쌍 (npx web-push generate-vapid-keys)
 *   VAPID_SUBJECT                        문제가 있을 때 푸시 서비스가 연락할 곳 (https: 또는 mailto:)
 *   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY  앱 빌드에 쓰는 것과 같은 값
 */

import webpush from 'web-push';

/** 폰이 꺼져 있으면 푸시 서비스가 하루까지 들고 있다가 켜질 때 건넵니다. */
const TTL_SECONDS = 24 * 60 * 60;

/** 동시에 열어 두는 요청 수. 수백 대를 하나씩 보내면 함수 시간 안에 못 끝냅니다. */
const CONCURRENCY = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status, body) => Response.json(body, { status });

function supabaseConfig() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

function vapidConfig() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  return VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT
    ? { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY }
    : null;
}

async function rpc(db, name, args) {
  const res = await fetch(`${db.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: db.key,
      Authorization: `Bearer ${db.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * 폰 한 대에 보내기. `gone` 은 푸시 서비스가 "이 구독은 이제 없다"(404/410)고
 * 답했다는 뜻이고, 그 구독은 다음부터 빠집니다.
 *
 * 암호화와 서명은 web-push 가 하고, 보내는 것은 fetch 로 직접 합니다 - 시간 초과를
 * 우리가 정하고, 푸시 서비스 주소가 무엇이든 같은 길로 나갑니다.
 */
async function sendOne(subscription, body, vapid) {
  try {
    const request = webpush.generateRequestDetails(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      body,
      { vapidDetails: vapid, TTL: TTL_SECONDS, urgency: 'normal' },
    );
    const res = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, gone: res.status === 404 || res.status === 410 };
  } catch {
    // 네트워크 오류, 망가진 키. 한 번 실패로 구독을 지우지는 않습니다.
    return { ok: false, gone: false };
  }
}

export async function sendAll(subscriptions, payload, vapid) {
  const body = JSON.stringify(payload);
  const result = { attempted: subscriptions.length, delivered: 0, failed: 0, gone: [] };

  for (let i = 0; i < subscriptions.length; i += CONCURRENCY) {
    const batch = subscriptions.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(batch.map((s) => sendOne(s, body, vapid)));
    outcomes.forEach((outcome, j) => {
      if (outcome.ok) result.delivered += 1;
      else result.failed += 1;
      if (outcome.gone) result.gone.push(batch[j].endpoint);
    });
  }
  return result;
}

export async function POST(request) {
  const input = await request.json().catch(() => null);
  const campaignId = input?.campaign_id;
  const token = input?.token;
  if (!UUID.test(String(campaignId)) || !UUID.test(String(token))) {
    return json(400, { error: 'campaign_id and token are required' });
  }

  const db = supabaseConfig();
  if (!db) return json(503, { error: 'Supabase is not configured' });

  const batch = await rpc(db, 'push_campaign_batch', { p_campaign_id: campaignId, p_token: token });
  if (!batch) return json(404, { error: 'no campaign is being sent with that token' });

  const report = (fields) =>
    rpc(db, 'push_campaign_report', { p_campaign_id: campaignId, p_token: token, ...fields });

  const vapid = vapidConfig();
  if (!vapid) {
    await report({
      p_attempted: 0,
      p_delivered: 0,
      p_failed: 0,
      p_gone: [],
      p_error: '알림 발송 키(VAPID)가 서버에 설정되지 않아 보내지 못했습니다.',
    });
    return json(503, { error: 'VAPID keys are not configured' });
  }

  const subscriptions = Array.isArray(batch.subscriptions) ? batch.subscriptions : [];
  let result;
  try {
    result = await sendAll(subscriptions, batch.payload, vapid);
  } catch (error) {
    await report({
      p_attempted: subscriptions.length,
      p_delivered: 0,
      p_failed: subscriptions.length,
      p_gone: [],
      p_error: `발송 중 오류: ${error instanceof Error ? error.message : String(error)}`,
    });
    return json(500, { error: 'send failed' });
  }

  await report({
    p_attempted: result.attempted,
    p_delivered: result.delivered,
    p_failed: result.failed,
    p_gone: result.gone,
    p_error: null,
  });

  return json(200, {
    attempted: result.attempted,
    delivered: result.delivered,
    failed: result.failed,
    revoked: result.gone.length,
  });
}
