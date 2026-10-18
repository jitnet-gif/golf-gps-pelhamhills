/**
 * 알림 켜기에 쓰는 공개키 - GET /api/push/vapid-public-key
 *
 * 폰이 알림을 켤 때 이 키로 구독을 만들고, 발송(dispatch.js)은 같은 쌍의 비밀키로
 * 서명합니다. 공개키를 앱 빌드에 따로 박아 두지 않고 여기 한 곳에서만 주는 이유:
 * 두 값이 어긋나면 켜기는 멀쩡히 되고 알림만 조용히 안 옵니다.
 */

export function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return Response.json({ error: 'push is not configured' }, { status: 503 });
  return Response.json({ publicKey }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
