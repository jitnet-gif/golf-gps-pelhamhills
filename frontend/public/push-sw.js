/*
 * 푸시 알림 서비스워커 핸들러
 * public/push-sw.js
 *
 * 이 파일은 번들러를 거치지 않습니다. vite.config.ts의
 * workbox.importScripts가 생성된 sw.js 안으로 그대로 끌어옵니다.
 *
 * generateSW로 만든 서비스워커는 우리가 직접 코드를 넣을 수 없어서,
 * 핸들러만 따로 두고 importScripts로 붙입니다. injectManifest로 바꾸면
 * push 핸들러는 넣을 수 있지만 vite.config.ts의 runtimeCaching 설정이
 * 통째로 무시됩니다 - 그 안에는 코스에서 지도를 살려 두는 타일 캐시 규칙이
 * 들어 있으므로, 알림을 얻자고 오프라인 지도를 잃을 수는 없습니다.
 */

/* global self, clients */

// 서버(pushService의 PushPayload)가 보내는 필드와 맞춰야 합니다.
const DEFAULT_TITLE = 'Golf GPS';
const DEFAULT_ICON = '/pwa-192x192.png';
const BADGE_ICON = '/pwa-192x192.png';

/**
 * 페이로드 해석
 *
 * 발신자가 우리 서버라는 보장이 없고(VAPID는 발신자를 확인해 주지만
 * 페이로드 형식까지 보장하진 않습니다), 텍스트만 보내는 경우도 있으므로
 * JSON 파싱 실패를 알림 누락으로 만들지 않습니다.
 */
function readPayload(event) {
  if (!event.data) return { title: DEFAULT_TITLE };

  try {
    const parsed = event.data.json();
    if (parsed && typeof parsed === 'object') return parsed;
    return { title: String(parsed) };
  } catch {
    return { title: DEFAULT_TITLE, body: event.data.text() };
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);

  const options = {
    body: payload.body || '',
    icon: payload.icon || DEFAULT_ICON,
    badge: BADGE_ICON,
    // tag가 같으면 새 알림이 이전 것을 대체합니다. 같은 프로모션을
    // 두 번 보내도 알림창이 두 개 쌓이지 않습니다.
    tag: payload.tag || 'golf-gps',
    // 클릭했을 때 열 곳. notificationclick에서 꺼내 씁니다.
    data: { url: payload.url || '/' },
    // 진동은 지원하는 기기에서만 동작하고, 아닌 곳에서는 무시됩니다.
    vibrate: [80, 40, 80],
  };

  // 큰 이미지는 안드로이드에서만 보이고 iOS는 무시합니다. 넣어서 손해는 없습니다.
  if (payload.image) options.image = payload.image;

  // waitUntil이 없으면 알림을 그리기 전에 워커가 잠들 수 있고,
  // 브라우저는 "이 사이트가 백그라운드에서 실행 중" 같은 대체 알림을 띄웁니다.
  event.waitUntil(self.registration.showNotification(payload.title || DEFAULT_TITLE, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });

      // 이미 열려 있는 탭이 있으면 새로 띄우지 않고 그 탭을 씁니다.
      // 라운드 중에 알림을 눌렀다고 진행 중인 화면이 날아가면 안 됩니다.
      for (const client of windows) {
        if (new URL(client.url).origin !== target.origin) continue;
        await client.focus();
        if (client.url !== target.href && 'navigate' in client) {
          await client.navigate(target.href);
        }
        return;
      }

      await clients.openWindow(target.href);
    })(),
  );
});
