import { clockTime, type ShopOrder } from './foodOrders';

/**
 * 새 주문을 말로 알리기
 *
 * 종소리는 "무슨 일이 났다" 까지만 알려 줍니다. 주방에서 등지고 일하는 사람은
 * 그 소리를 듣고도 화면까지 걸어와야 무엇이 들어왔는지 압니다. 그래서 종소리
 * 뒤에 한 문장을 읽어 줍니다:
 *
 *   F and B ordered. Two new orders.
 *   Order 1: 2 Cheeseburger, 1 Coke. Pickup 2:40 PM.
 *
 * 영어로 말합니다 - 메뉴 이름이 영어이고(인쇄 메뉴판 그대로), 손님과 직원이
 * 주고받는 말도 영어입니다. 'F&B' 는 그대로 읽으면 기호가 씹혀서 'F and B' 로
 * 적어 보냅니다.
 *
 * 야디지 콜아웃(calloutVoice)과 달리 브라우저의 음성 엔진을 씁니다. 그쪽은
 * 신호 없는 페어웨이에서 울려야 해서 ElevenLabs 클립을 구워 두지만, 이 화면은
 * 카운터의 인터넷 붙은 기기이고, 무엇보다 **메뉴 이름이 바뀝니다** - 관리자가
 * 메뉴를 고치는 순간 구워 둔 클립은 그 품목을 말하지 못합니다.
 *
 * 브라우저는 사람이 한 번 누르기 전에는 소리를 내지 않습니다. 화면의
 * '소리 켜기' 가 그 한 번이고, 이 말하기도 그 버튼을 따라갑니다.
 */

/** 한 번에 읽어 줄 주문 수. 그 뒤는 "and N more orders" 로 줄입니다. */
const MAX_ORDERS = 3;

/** 한 주문에서 읽어 줄 품목 수. 긴 주문은 화면을 봐야 합니다. */
const MAX_ITEMS = 6;

export const isSpeechSupported = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * 말할 목소리.
 *
 * 영어 목소리를 고릅니다. 기기 언어가 한국어면 기본 목소리가 한국어라,
 * 그대로 두면 메뉴 이름을 한글 발음으로 읽습니다. 캐나다 > 미국 > 아무 영어
 * 순으로 고르고, 영어가 하나도 없으면 기본 목소리로 말합니다 - 어색해도
 * 조용한 것보다 낫습니다.
 */
const pickVoice = (): SpeechSynthesisVoice | null => {
  try {
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((v) => v.lang === 'en-CA') ??
      voices.find((v) => v.lang === 'en-US') ??
      voices.find((v) => v.lang.startsWith('en')) ??
      null
    );
  } catch {
    return null;
  }
};

/**
 * 목소리 목록 깨우기.
 *
 * getVoices() 는 처음에 빈 배열을 돌려주고 잠시 뒤에 채워집니다. 첫 주문이
 * 들어온 순간에 비어 있으면 한국어 기본 목소리로 읽어 버리므로, '소리 켜기' 를
 * 누를 때 미리 한 번 깨워 둡니다.
 */
export const primeVoices = (): void => {
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', () => {
      window.speechSynthesis.getVoices();
    }, { once: true });
  } catch {
    /* 목소리를 못 깨워도 말하기는 시도합니다. */
  }
};

const itemCount = (order: ShopOrder): number =>
  order.items.reduce((sum, item) => sum + item.quantity, 0);

/** '2 Cheeseburger, 1 Coke' - 품목 이름은 그대로 둡니다(복수형을 붙이면 Fries 같은 이름이 망가집니다). */
const itemList = (order: ShopOrder): string => {
  const shown = order.items.slice(0, MAX_ITEMS).map((item) => `${item.quantity} ${item.name}`);
  if (order.items.length > MAX_ITEMS) shown.push('and more');
  return shown.join(', ');
};

export interface OrderCall {
  /** 'F and B ordered. 2 new orders.' - 화면의 큰 글씨이자 말의 첫 문장. */
  headline: string;
  /** 주문 한 건에 한 줄. 화면에도 그대로 보여 줍니다. */
  lines: string[];
  /** 새 주문 건수. */
  orders: number;
  /** 새 주문에 들어 있는 품목 개수를 모두 더한 수. */
  items: number;
}

/**
 * 읽어 줄 말 + 화면에 띄울 줄. 말과 화면이 같은 글이라, 못 들은 사람이 화면에서
 * 같은 것을 읽습니다.
 */
export const orderCall = (orders: ShopOrder[]): OrderCall | null => {
  if (orders.length === 0) return null;

  const items = orders.reduce((sum, order) => sum + itemCount(order), 0);
  const headline = `F and B ordered. ${orders.length} new order${orders.length === 1 ? '' : 's'}.`;

  const lines = orders.slice(0, MAX_ORDERS).map((order, index) => {
    const label = orders.length === 1 ? 'Order' : `Order ${index + 1}`;
    return `${label}: ${itemList(order)}. Pickup ${clockTime(order.pickupAt)}.`;
  });
  if (orders.length > MAX_ORDERS) {
    lines.push(`And ${orders.length - MAX_ORDERS} more order${orders.length - MAX_ORDERS === 1 ? '' : 's'}.`);
  }

  return { headline, lines, orders: orders.length, items };
};

/**
 * 말하기. 이미 말하는 중이면 끊고 새로 말합니다 - 주문이 연달아 들어올 때 낡은
 * 안내가 줄을 서면, 듣는 사람은 방금 들어온 주문을 마지막에야 듣습니다.
 */
export const speakOrderCall = (call: OrderCall): void => {
  if (!isSpeechSupported()) return;

  const say = () => {
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance([call.headline, ...call.lines].join(' '));
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? 'en-US';
      // 카운터는 시끄럽습니다. 조금 천천히, 조금 크게.
      utterance.rate = 0.95;
      utterance.volume = 1;
      synth.speak(utterance);
    } catch {
      /* 말하지 못해도 종소리와 화면은 그대로입니다. */
    }
  };

  try {
    // 목소리 목록이 아직 비어 있으면 채워질 때까지 잠깐 기다립니다. 비어 있는
    // 채로 말하면 기기 기본 목소리(한국어 기기에서는 한국어)가 영어 문장을
    // 읽습니다. 1초 안에 안 채워지면 그냥 말합니다 - 늦는 것보다 낫습니다.
    if (window.speechSynthesis.getVoices().length > 0) {
      say();
      return;
    }
    let spoken = false;
    const once = () => {
      if (spoken) return;
      spoken = true;
      say();
    };
    window.speechSynthesis.addEventListener?.('voiceschanged', once, { once: true });
    window.setTimeout(once, 1000);
  } catch {
    say();
  }
};

/** 말하는 것을 멈춥니다 (소리를 끌 때). */
export const stopSpeaking = (): void => {
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* 멈출 것이 없으면 그만입니다. */
  }
};
