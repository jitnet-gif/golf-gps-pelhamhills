/**
 * 웹 푸시 구독
 *
 * 구독 등록/해지는 Worker(`/api/push/*`)를 거칩니다. 배너와 달리
 * Supabase에 직접 붙일 수 없습니다 - push_subscriptions에는 anon 권한이
 * 아예 없고, 앞으로도 그래야 합니다. 구독 정보는 기기를 지목할 수 있는
 * 데이터라서 service_role을 쥔 Worker만 만지게 두었습니다.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? '';

const DEVICE_ID_KEY = 'golf_gps_device_id';

/**
 * 익명 기기 ID
 *
 * 이 앱에는 로그인이 없어서 구독에 붙일 사용자가 없습니다. 대신 기기마다
 * 한 번 만든 UUID를 주인으로 씁니다. 브라우저 데이터를 지우면 새 ID가
 * 발급되고, 남겨진 옛 구독은 발송 중 404/410을 받아 서버가 정리합니다.
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    const created = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    // 저장이 막힌 브라우저에서는 세션 한정 ID로 동작합니다.
    // 구독 자체는 endpoint로 식별되므로 발송에는 지장이 없습니다.
    return crypto.randomUUID().replace(/-/g, '');
  }
}

/**
 * base64url 공개키 -> pushManager가 요구하는 Uint8Array
 *
 * applicationServerKey는 문자열도 받지만, 사파리를 포함한 몇몇 구현이
 * 여전히 BufferSource만 확실히 받습니다.
 */
function decodeVapidKey(base64url: string): Uint8Array {
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 이 브라우저에서 푸시가 가능한지
 *
 * iOS는 16.4부터 지원하지만 홈 화면에 설치된 상태에서만 PushManager가
 * 생깁니다. 사파리 탭에서 열어 본 사람에게는 '설치가 먼저'라고 말해 줘야
 * 해서, 지원 여부와 설치 여부를 나눠 봅니다.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** 홈 화면에 설치되어 실행 중인지 (iOS에서 푸시의 전제 조건) */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS 사파리만 쓰는 비표준 플래그
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * 서버가 쓰는 VAPID 공개키 가져오기
 *
 * 빌드 타임 환경변수(VITE_VAPID_PUBLIC_KEY)가 있으면 그걸 쓰고, 없으면
 * 서버에 물어봅니다. 두 값이 어긋나면 구독은 멀쩡히 성공하고 발송만
 * 조용히 실패하므로, 기본값은 서버 쪽 하나로 두는 편이 안전합니다.
 */
async function getVapidPublicKey(signal?: AbortSignal): Promise<string> {
  const fromEnv = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (fromEnv) return fromEnv;

  const response = await fetch(`${API_BASE}/api/push/vapid-public-key`, { signal });
  if (!response.ok) {
    throw new Error(`VAPID key unavailable (${response.status})`);
  }

  const { publicKey } = (await response.json()) as { publicKey: string };
  if (!publicKey) throw new Error('VAPID key unavailable');

  return publicKey;
}

/**
 * 서버에 구독 등록
 *
 * endpoint에 UNIQUE 제약이 있어 몇 번을 보내도 행은 하나입니다.
 * 앱을 열 때마다 다시 보내는 이유는 pushsubscriptionchange 때문입니다:
 * 브라우저가 구독을 갱신해도 서비스워커는 localStorage의 기기 ID를 읽을 수
 * 없어 스스로 재등록할 수 없습니다. 대신 앱이 켜질 때 맞춰 두면 됩니다.
 */
async function registerSubscription(
  subscription: PushSubscription,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      deviceId: getDeviceId(),
      subscription: subscription.toJSON(),
      topics: ['marketing'],
      locale: navigator.language?.slice(0, 10),
    }),
  });

  if (!response.ok) {
    throw new Error(`Subscription failed (${response.status})`);
  }
}

/**
 * 구독하기
 *
 * 반드시 사용자 조작(클릭) 안에서 불러야 합니다. 브라우저는 제스처 없이
 * 부른 requestPermission()을 그냥 거부하고, 한 번 거부로 굳으면
 * 사이트 설정에 들어가지 않는 한 되돌릴 수 없습니다.
 */
export async function subscribeToPush(signal?: AbortSignal): Promise<PushSubscription> {
  if (!isPushSupported()) {
    throw new Error('PUSH_UNSUPPORTED');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('PERMISSION_DENIED');
  }

  const registration = await navigator.serviceWorker.ready;

  // 이미 구독이 있으면 그대로 씁니다. 다시 subscribe()를 부르면
  // 브라우저에 따라 키가 다를 때 에러를 던집니다.
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // 모든 푸시가 사용자에게 보이는 알림이 된다는 약속. 크롬은 이 값이
      // false면 구독 자체를 거부합니다.
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(await getVapidPublicKey(signal)),
    }));

  await registerSubscription(subscription, signal);
  return subscription;
}

/**
 * 구독 해지
 *
 * 브라우저 쪽을 먼저 끊고 서버에 알립니다. 순서가 중요합니다 - 서버 호출이
 * 실패해도 사용자는 알림을 더 받지 않아야 하고, 남은 구독은 다음 발송에서
 * 410을 받아 정리됩니다.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const { endpoint } = subscription;
  await subscription.unsubscribe();

  await fetch(`${API_BASE}/api/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {
    /* 서버에 못 알려도 사용자에게는 이미 꺼진 상태입니다. */
  });
}

/**
 * 앱 시작 시 구독 상태 맞추기
 *
 * 이미 허용해 둔 사용자에게만 조용히 동작합니다. 권한을 묻지 않으므로
 * 제스처 밖에서 불러도 됩니다.
 */
export async function syncExistingSubscription(signal?: AbortSignal): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== 'granted') return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  await registerSubscription(subscription, signal).catch(() => {
    /* 오프라인일 수 있습니다. 다음 실행에서 다시 맞춥니다. */
  });
  return true;
}
