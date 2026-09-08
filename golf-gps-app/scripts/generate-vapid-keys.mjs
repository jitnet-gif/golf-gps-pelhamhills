/**
 * VAPID 키쌍 생성
 * scripts/generate-vapid-keys.mjs
 *
 * 사용법:
 *   node scripts/generate-vapid-keys.mjs
 *
 * 출력된 값을 backend/.env(로컬) 또는 wrangler secret(배포)에 넣고,
 * 공개키는 프론트엔드가 GET /api/push/vapid-public-key로 받아 갑니다.
 *
 * 주의: 키를 교체하면 기존 구독이 전부 무효가 됩니다. 사용자는 알림이
 * 끊긴 줄도 모른 채 조용히 안 받게 되므로, 한 번 정했으면 바꾸지 마세요.
 *
 * web-push CLI가 내놓는 형식과 같습니다(공개키 = 비압축 P-256 점의
 * base64url, 개인키 = JWK의 d 값).
 */

const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const rawPublic = await crypto.subtle.exportKey('raw', keyPair.publicKey);
const jwkPrivate = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

const base64url = (buffer) =>
  Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

console.log('VAPID_PUBLIC_KEY=' + base64url(rawPublic));
console.log('VAPID_PRIVATE_KEY=' + jwkPrivate.d);
console.log('VAPID_SUBJECT=mailto:ops@example.com  # 실제 연락처로 바꾸세요');
