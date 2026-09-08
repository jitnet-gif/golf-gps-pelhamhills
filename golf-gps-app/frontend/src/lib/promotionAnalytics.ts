/**
 * 배너 노출·클릭 집계 전송
 *
 * promotion_events에는 anon 권한이 없습니다(0004 마이그레이션). 브라우저가
 * PostgREST로 직접 INSERT할 수 없으므로 배너 조회와 달리 이 길만은 Worker를
 * 거칩니다. 그래서 VITE_API_URL이 없으면 집계는 통째로 꺼집니다 - 배너 자체는
 * Supabase 직결이라 Worker 없이도 계속 보입니다.
 *
 * 보내는 곳: POST {VITE_API_URL}/api/promotions/events (공개, 관리자 키 없음)
 *
 * 요청 본문 (Worker와 맞춰야 하는 계약):
 * ```json
 * {
 *   "deviceId": "32자 hex",
 *   "events": [
 *     { "promotionId": "uuid", "eventType": "impression", "placement": "home" }
 *   ]
 * }
 * ```
 * eventType은 'impression' | 'click' | 'dismiss', placement는 'home' |
 * 'scorecard'. **events는 항상 배열입니다** - 아래 이유로 모아서 한 번에
 * 보내기 때문에, 서버가 단건만 받으면 집계가 통째로 400을 받습니다.
 *
 * 그리고 sendBeacon은 Content-Type을 text/plain으로 고정합니다(아래 flush의
 * 주석 참고). 서버는 Content-Type을 보고 거르지 말고 본문을 그대로 JSON으로
 * 읽어야 합니다.
 *
 * 집계는 있으면 좋은 것입니다. 이 파일의 어떤 함수도 예외를 밖으로 내보내지
 * 않고, 실패는 전부 조용히 삼킵니다.
 */

import { getDeviceId } from '@/lib/push';
import type { PromotionPlacement } from '@/lib/promotions';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

const ENDPOINT = `${API_BASE}/api/promotions/events`;

export type PromotionEventType = 'impression' | 'click' | 'dismiss';

interface PromotionEvent {
  promotionId: string;
  eventType: PromotionEventType;
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
    if (document.visibilityState === 'hidden') flush();
  });

  window.addEventListener('pagehide', () => flush());
}

/**
 * 큐를 비우고 한 번에 전송
 *
 * splice로 먼저 큐에서 떼어 냅니다. 전송이 실패해도 다시 넣지 않습니다 -
 * 집계는 놓쳐도 되는 데이터이고, 되돌려 놓으면 오프라인일 때 같은 이벤트를
 * 계속 재전송하게 됩니다.
 */
function flush(): void {
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
    const payload = JSON.stringify({ deviceId: getDeviceId(), events });

    /*
     * 문자열을 그대로 넘기면 sendBeacon은 text/plain으로 보냅니다. Blob으로
     * application/json을 지정하면 단순 요청이 아니게 되어 OPTIONS 프리플라이트가
     * 먼저 필요한데, 화면이 꺼지는 순간에 왕복 두 번을 기대할 수는 없습니다.
     * 그래서 타입을 붙이지 않고, 대신 서버가 본문을 JSON으로 읽습니다.
     */
    if (navigator.sendBeacon?.(ENDPOINT, payload)) return;

    // sendBeacon이 없거나(구형 브라우저) 자체 큐 한도에 걸려 false를 준 경우.
    // keepalive는 문서가 사라진 뒤에도 요청을 끝까지 보내 줍니다.
    //
    // Content-Type을 일부러 붙이지 않습니다. 문자열 본문의 기본값은
    // text/plain이라 beacon과 같은 모양이 되고, 서버는 한 가지 규칙만
    // 지키면 됩니다. application/json으로 올리면 이 길만 프리플라이트를
    // 타서, 정작 실제로 쓰이는 beacon 쪽이 조용히 거절당해도 모르게 됩니다.
    void fetch(ENDPOINT, {
      method: 'POST',
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* 집계 실패는 화면에 아무 영향이 없습니다. */
    });
  } catch {
    /* JSON 직렬화나 sendBeacon 자체가 던져도 앱은 그대로 굴러가야 합니다. */
  }
}

function enqueue(event: PromotionEvent): void {
  // Worker 주소가 없으면 보낼 곳이 없습니다. 큐도 리스너도 만들지 않습니다.
  if (!API_BASE) return;

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

  enqueue({ promotionId, eventType: 'impression', placement });
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
  enqueue({ promotionId, eventType: 'click', placement });
}

/** 배너를 닫았다 */
export function trackPromotionDismiss(
  promotionId: string,
  placement: PromotionPlacement,
): void {
  enqueue({ promotionId, eventType: 'dismiss', placement });
}
