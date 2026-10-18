import { useEffect } from 'react';
import { BellRing, Volume2, X } from 'lucide-react';
import type { OrderCall } from '@/lib/orderAnnounce';

/** 아무도 누르지 않아도 이만큼 뒤에는 스스로 사라집니다. 주문은 아래 목록에 남습니다. */
const HIDE_MS = 90000;

interface OrderCallBannerProps {
  call: OrderCall | null;
  /** 지금 말로도 나가고 있는지. 소리가 꺼져 있으면 그렇다고 적어 줍니다. */
  spoken: boolean;
  onDismiss: () => void;
}

/**
 * 방금 들어온 주문을 크게 알리는 띠
 *
 * 말(orderAnnounce)과 같은 글을 그대로 보여 줍니다. 주방 소리에 묻혀 못 들은
 * 사람, 소리를 꺼 둔 기기, 지나가다 화면을 본 사람 - 셋 다 같은 것을 읽습니다.
 *
 * 화면 맨 위에 붙어 있고 스크롤을 따라다닙니다. 계산대 화면은 주문이 쌓이면
 * 아래로 길어지는데, 새 주문 안내가 그 아래에 묻히면 알릴 이유가 없습니다.
 */
export function OrderCallBanner({ call, spoken, onDismiss }: OrderCallBannerProps) {
  useEffect(() => {
    if (!call) return undefined;
    const timer = window.setTimeout(onDismiss, HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [call, onDismiss]);

  if (!call) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      className="sticky top-0 z-30 rounded-lg border-2 border-primary bg-primary/10 p-3 shadow-lg backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 animate-pulse text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-tight">
            F&amp;B ORDERED · 주문 {call.orders}건 · 품목 {call.items}개
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {call.lines.map((line) => (
              <li key={line} className="text-sm leading-snug">
                {line}
              </li>
            ))}
          </ul>
          {!spoken && (
            <p className="mt-1 text-xs text-muted-foreground">
              <Volume2 className="mr-0.5 inline h-3 w-3" />
              소리가 꺼져 있어 화면으로만 알렸습니다. 위의 '소리 켜기' 를 누르면 말로도 알려 줍니다.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="알림 닫기"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
