/**
 * 웹 푸시 구독
 *
 * 구독(폰 주소 + 암호 키)은 Supabase 함수 push_subscribe 로 남깁니다(migration
 * 0010). push_subscriptions 표 자체는 공개 키로 읽을 수도 쓸 수도 없고, 이 함수만
 * 부를 수 있습니다 - 구독 정보는 폰을 지목할 수 있는 데이터입니다.
 *
 * 발송용 공개키(VAPID)는 앱 서버(/api/push/vapid-public-key) 한 곳에서만 받습니다.
 * 빌드에 따로 박아 두면 서버 키와 어긋났을 때 켜기는 되고 알림만 조용히 안 옵니다.
 */

import { supabase } from './supabase';

const DEVICE_ID_KEY = 'golf_gps_device_id';

/**
 * 익명 기기 ID
 *
 * 알림은 로그인 없이 켭니다. 구독에 붙일 사용자가 없으니 기기마다 한 번 만든
 * UUID를 주인으로 씁니다. 브라우저 데이터를 지우면 새 ID가 발급되고, 남겨진 옛
 * 구독은 발송 중 404/410을 받아 서버가 정리합니다.
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
function decodeVapidKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));

  // new Uint8Array(length)는 SharedArrayBuffer도 담을 수 있는 타입이라
  // BufferSource로 넘어가지 않습니다. ArrayBuffer를 먼저 잡아 둡니다.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 이 구독이 지금 서버 키로 만든 것인지. 브라우저가 키를 알려 주지 않으면 같다고
 * 봅니다 - 모르는 채로 매번 구독을 새로 만들면 켤 때마다 주소가 바뀝니다.
 */
function madeWithKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
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

/** 서버가 발송에 쓰는 VAPID 공개키 */
async function getVapidPublicKey(signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/push/vapid-public-key', { signal });
  if (!response.ok) {
    throw new Error(`VAPID key unavailable (${response.status})`);
  }

  const { publicKey } = (await response.json()) as { publicKey?: string };
  if (!publicKey) throw new Error('VAPID key unavailable');

  return publicKey;
}

/**
 * 서버에 구독 등록
 *
 * endpoint가 같으면 행은 하나입니다(서버가 덮어씁니다). 앱을 열 때마다 다시
 * 보내는 이유는 pushsubscriptionchange 때문입니다: 브라우저가 구독을 갱신해도
 * 서비스워커는 localStorage의 기기 ID를 읽을 수 없어 스스로 재등록할 수 없습니다.
 * 대신 앱이 켜질 때 맞춰 두면 됩니다.
 */
async function registerSubscription(
  subscription: PushSubscription,
  signal?: AbortSignal,
): Promise<void> {
  if (!supabase) throw new Error('PUSH_SERVER_UNAVAILABLE');

  const { endpoint, keys } = subscription.toJSON();
  let call = supabase.rpc('push_subscribe', {
    p_device_id: getDeviceId(),
    p_endpoint: endpoint ?? subscription.endpoint,
    p_p256dh: keys?.p256dh ?? null,
    p_auth: keys?.auth ?? null,
    p_locale: navigator.language?.slice(0, 10) ?? null,
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (signal) call = call.abortSignal(signal);

  const { error } = await call;
  if (error) {
    throw new Error(`Subscription failed (${error.code ?? error.message})`);
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
  const serverKey = decodeVapidKey(await getVapidPublicKey(signal));

  // 이미 구독이 있으면 그대로 씁니다. 다만 서버 키가 바뀐 뒤의 옛 구독으로는
  // 알림이 오지 않으므로, 그때만 끊고 새로 받습니다.
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !madeWithKey(subscription, serverKey)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }

  subscription ??= await registration.pushManager.subscribe({
    // 모든 푸시가 사용자에게 보이는 알림이 된다는 약속. 크롬은 이 값이
    // false면 구독 자체를 거부합니다.
    userVisibleOnly: true,
    applicationServerKey: serverKey,
  });

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

  try {
    await supabase?.rpc('push_unsubscribe', { p_endpoint: endpoint });
  } catch {
    /* 서버에 못 알려도 사용자에게는 이미 꺼진 상태입니다. */
  }
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
