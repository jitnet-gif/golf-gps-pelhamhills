/**
 * 푸시 알림 발송
 * scripts/send-push.mjs
 *
 * 사용법:
 *   API_URL=https://golf-gps-backend.<계정>.workers.dev \
 *   ADMIN_API_KEY=... \
 *   node scripts/send-push.mjs --title "주말 그린피 30% 할인" --body "토·일 오후 티타임" --url /
 *
 * 등록해 둔 배너를 그대로 보내기:
 *   node scripts/send-push.mjs --promotion <배너 UUID>
 *
 * 내 기기에만 보내서 확인하기 (브라우저 콘솔에서
 * localStorage.getItem('golf_gps_device_id')로 값을 확인하세요):
 *   node scripts/send-push.mjs --title "테스트" --device <기기 ID>
 *
 * 옵션:
 *   --title, --body, --url, --image
 *   --promotion <uuid>  등록된 배너 내용으로 발송
 *   --topic <이름>      해당 토픽 구독자에게만 (기본: marketing)
 *   --device <id>       특정 기기에만
 *   --urgency low|normal|high
 *   --dry-run           보내지 않고 요청 내용만 출력
 */

const args = process.argv.slice(2);

function flag(name) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

const apiUrl = process.env.API_URL || 'http://127.0.0.1:8787';
const adminKey = process.env.ADMIN_API_KEY;

if (!adminKey) {
  console.error('ADMIN_API_KEY 환경변수가 필요합니다.');
  console.error('배포된 값은 Cloudflare 대시보드가 아니라 등록할 때 쓴 값입니다 -');
  console.error('secret은 다시 읽을 수 없으니, 모르면 새로 넣으세요:');
  console.error('  wrangler secret put ADMIN_API_KEY');
  process.exit(1);
}

const body = {
  ...(flag('title') && { title: flag('title') }),
  ...(flag('body') && { body: flag('body') }),
  ...(flag('url') && { url: flag('url') }),
  ...(flag('image') && { imageUrl: flag('image') }),
  ...(flag('promotion') && { promotionId: flag('promotion') }),
  ...(flag('device') && { deviceId: flag('device') }),
  ...(flag('urgency') && { urgency: flag('urgency') }),
  // 토픽을 지정하지 않으면 전체 발송이 됩니다. 실수로 전체에 나가는 쪽보다
  // 기본을 marketing으로 좁혀 두는 편이 안전합니다.
  topic: flag('topic') || 'marketing',
};

if (!body.title && !body.promotionId) {
  console.error('--title 또는 --promotion 중 하나는 있어야 합니다.');
  process.exit(1);
}

if (args.includes('--dry-run')) {
  console.log(`POST ${apiUrl}/api/push/send`);
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

const response = await fetch(`${apiUrl}/api/push/send`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
  body: JSON.stringify(body),
});

const result = await response.json();

if (!response.ok) {
  console.error(`발송 실패 (HTTP ${response.status}):`, result);
  process.exit(1);
}

// attempted는 대상 구독 수, delivered는 푸시 서비스가 받아 준 수입니다.
// 사용자가 실제로 봤는지까지는 알 수 없습니다.
console.log(
  `대상 ${result.attempted}건 / 전달 ${result.delivered}건 / 실패 ${result.failed}건` +
    (result.revoked ? ` / 만료 정리 ${result.revoked}건` : ''),
);

if (result.attempted === 0) {
  console.log('구독자가 없습니다. 앱에서 알림을 켠 기기가 있는지 확인하세요.');
}
