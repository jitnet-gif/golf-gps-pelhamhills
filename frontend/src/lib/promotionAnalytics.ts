/**
 * 배너 노출·클릭 집계 전송
 *
 * Supabase 함수 record_promotion_events(migration 0009)로 바로 보냅니다.
 * promotion_events 표 자체에는 공개 권한이 없고, 이 함수만 공개 키로 부를 수
 * 있습니다 - 기록을 넣을 수는 있어도 읽거나 고칠 수는 없습니다.
 *
 * 보내는 모양:
 * ```json
 * {
 *   "p_device_id": "32자 hex",
 *   "p_events": [
 *     { "promotion_id": "uuid", "event_type": "impression", "placement": "home" }
 *   ]
 * }
 * ```
 * event_type은 'impression' | 'click' | 'dismiss', placement는 'home' |
 * 'scorecard'. 한 번에 최대 50건이고, 같은 폰의 같은 배너 노출은 하루 한 번만
 * 셉니다(서버가 거릅니다).
 *
 * 집계는 있으면 좋은 것입니다. 이 파일의 어떤 함수도 예외를 밖으로 내보내지
 * 않고, 실패는 전부 조용히 삼킵니다.
 */

import { getDeviceId } from '@/lib/push';
import type { PromotionPlacement } from '@/lib/promotions';

const URL_BASE = import.meta.env.VITE_SUPABASE_URL;
const KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

const ENDPOINT = URL_BASE && KEY ? `${URL_BASE}/rest/v1/rpc/record_promotion_events` : '';

export type PromotionEventType = 'impression' | 'click' | 'dismiss';

interface PromotionEvent {
  promotion_id: string;
  event_type: PromotionEventType;
  placement: PromotionPlacement;
}

/**
 * 요청 하나에 이벤트 하나씩 보내면 배너를 넘겨 볼 때마다 통신이 일어납니다.
 * 코스에서는 신호가 약하고 데이터도 아까우므로 잠깐 모았다가 함께 보냅니다.
 * 5초는 사람이 배너를 넘기는 속도보다 넉넉히 길고, 화면을 끄기 전에는
 * 대개 지나가는 길이입니다.
 */
const FLUSH_DELAY_MS = 5000;

/** 오프라인이 길어져도 큐가 무한히 자라지 않게. 넘치면 바로 보냅니다. */
const MAX_QUEUE = 20;

let queue: PromotionEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listenersAttached = false;

/**
 * 이미 보낸 노출은 다시 담지 않습니다.
 *
 * 서버가 (배너, 기기, 날짜)로 하루 한 번만 세지만, 스크롤로 배너가 화면을
 * 들락날락할 때마다 요청에 실어 보낼 이유는 없습니다. 탭을 새로 열면
 * 초기화되고 그때 한 번 더 갈 뿐인데, 그건 서버가 걸러 냅니다.
 */
const sentImpressions = new Set<string>();

/**
 * 페이지를 떠날 때 남은 것 보내기
 *
 * beforeunload는 쓰지 않습니다. 모바일 브라우저는 탭을 배경으로 돌린 뒤
 * 메모리 압박으로 그냥 죽이는 일이 흔하고, 그때 beforeunload는 불리지
 * 않습니다. iOS 사파리는 앱 전환만으로도 그렇습니다. 확실히 불리는 신호는
 * visibilitychange의 'hidden'이고, pagehide는 그보다 오래된 iOS를 위한
 * 보험입니다.
 */
function attachListeners(): void {
  if (listenersAttached || typeof document === 'undefined') return;
  listenersAttached = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });

  window.addEventListener('pagehide', () => flush(true));
}

/**
 * 큐를 비우고 한 번에 전송
 *
 * splice로 먼저 큐에서 떼어 냅니다. 전송이 실패해도 다시 넣지 않습니다 -
 * 집계는 놓쳐도 되는 데이터이고, 되돌려 놓으면 오프라인일 때 같은 이벤트를
 * 계속 재전송하게 됩니다.
 *
 * `leaving`이면 keepalive로 보냅니다. 화면이 사라진 뒤에도 요청이 끝까지 가게
 * 해 주는 대신, 일부 브라우저는 머리글(apikey)이 붙은 keepalive 요청을 받지
 * 않습니다. 그래서 평소(5초 타이머)에는 보통 요청으로 보내고, 떠나는 순간에만
 * keepalive에 기댑니다. sendBeacon은 머리글을 붙일 수 없어 Supabase에 쓸 수 없습니다.
 */
function flush(leaving = false): void {
  if (queue.length === 0) return;

  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }

  const events = queue.splice(0);

  try {
    // deviceId는 배치당 한 번만 읽습니다. 저장이 막힌 브라우저에서
    // getDeviceId()는 부를 때마다 새 UUID를 주기 때문에, 이벤트마다 부르면
    // 한 사람이 여러 기기로 보입니다.
    const body = JSON.stringify({ p_device_id: getDeviceId(), p_events: events });

    void fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body,
      keepalive: leaving,
    }).catch(() => {
      /* 집계 실패는 화면에 아무 영향이 없습니다. */
    });
  } catch {
    /* JSON 직렬화나 fetch 자체가 던져도 앱은 그대로 굴러가야 합니다. */
  }
}

function enqueue(event: PromotionEvent): void {
  // 서버 설정이 없는 빌드에서는 보낼 곳이 없습니다. 큐도 리스너도 만들지 않습니다.
  if (!ENDPOINT) return;

  try {
    attachListeners();
    queue.push(event);

    if (queue.length >= MAX_QUEUE) {
      flush();
      return;
    }

    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, FLUSH_DELAY_MS);
    }
  } catch {
    /* 집계 때문에 배너가 깨지는 일은 없어야 합니다. */
  }
}

/**
 * 배너가 실제로 화면에 보였다
 *
 * 렌더된 것과 눈에 보인 것은 다릅니다. 이 함수는 IntersectionObserver로
 * 노출을 확인한 쪽에서만 불러야 합니다.
 */
export function trackPromotionImpression(
  promotionId: string,
  placement: PromotionPlacement,
): void {
  const key = `${placement}:${promotionId}`;
  if (sentImpressions.has(key)) return;
  sentImpressions.add(key);

  enqueue({ promotion_id: promotionId, event_type: 'impression', placement });
}

/**
 * 배너를 눌렀다
 *
 * 클릭은 대개 다른 탭을 열고 이 탭은 그대로 남습니다. 그러면 'hidden'이
 * 오지 않으므로 타이머로 보내는 길이 실제로 쓰입니다.
 */
export function trackPromotionClick(
  promotionId: string,
  placement: PromotionPlacement,
): void {
  enqueue({ promotion_id: promotionId, event_type: 'click', placement });
}

/** 배너를 닫았다 */
export function trackPromotionDismiss(
  promotionId: string,
  placement: PromotionPlacement,
): void {
  enqueue({ promotion_id: promotionId, event_type: 'dismiss', placement });
}
