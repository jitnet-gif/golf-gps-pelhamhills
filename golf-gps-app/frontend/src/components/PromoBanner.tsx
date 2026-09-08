import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { usePromotions } from '@/hooks';
import type { Promotion, PromotionPlacement } from '@/lib/promotions';
import {
  trackPromotionClick,
  trackPromotionDismiss,
  trackPromotionImpression,
} from '@/lib/promotionAnalytics';

const DISMISSED_KEY = 'golf_gps_dismissed_promos';

/**
 * 닫은 배너는 그 기기에서 다시 뜨지 않습니다.
 *
 * 서버에 보내지 않고 이 기기에만 남깁니다. 로그인이 없어서 어차피 사람
 * 단위로 모을 수 없고, 홍보 배너를 껐다는 사실까지 서버가 알아야 할 이유도
 * 없습니다.
 */
function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function rememberDismissed(id: string): void {
  try {
    const next = Array.from(new Set([...readDismissed(), id]));
    // 오래된 배너 ID가 무한히 쌓이지 않게 최근 것만 남깁니다.
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-50)));
  } catch {
    /* 저장이 막혀 있으면 이번 세션에만 닫힌 상태로 둡니다. */
  }
}

interface PromoBannerProps {
  placement: PromotionPlacement;
  className?: string;
}

/**
 * 마케팅/홍보 배너
 *
 * 여러 개가 걸려 있으면 좌우로 넘겨 볼 수 있고, 닫으면 그 배너는 이 기기에서
 * 사라집니다. 보여 줄 게 없으면 아무것도 그리지 않습니다 - 빈 상자나
 * 스켈레톤을 남기면 배너가 없는 날에도 화면이 배너 자리만큼 어수선해집니다.
 *
 * 코스 지도 화면에는 넣지 않습니다. 플레이 중에 거리와 지도를 가리는 광고는
 * 이 앱을 쓰는 이유를 깎아먹습니다.
 */
export const PromoBanner: React.FC<PromoBannerProps> = ({ placement, className = '' }) => {
  const promotions = usePromotions(placement);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [index, setIndex] = useState(0);

  // 관찰 대상을 useRef 대신 state로 잡습니다. 배너가 없을 때는 아무것도
  // 그리지 않으므로 ref는 나중에 생기는데, useRef는 값이 채워져도 다시
  // 렌더되지 않아 아래 effect가 영영 관찰을 시작하지 못합니다.
  const [bannerEl, setBannerEl] = useState<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  const visible = promotions.filter((promotion) => !dismissed.includes(promotion.id));

  // 배너가 줄어들면(닫았거나 기간이 끝났거나) 현재 위치가 범위를 벗어납니다.
  useEffect(() => {
    if (index > 0 && index >= visible.length) setIndex(Math.max(0, visible.length - 1));
  }, [index, visible.length]);

  // 닫은 직후에는 index가 범위를 벗어날 수 있습니다. 아래 점 표시도 같은
  // 값을 봐야 내용과 점이 한 프레임이라도 어긋나지 않습니다.
  const active = Math.min(index, Math.max(0, visible.length - 1));
  const promotion: Promotion | undefined = visible[active];
  const promotionId = promotion?.id;

  /*
   * 컴포넌트가 렌더된 것과 사람 눈에 보인 것은 다릅니다. 스코어카드 아래에
   * 붙은 배너는 스크롤하기 전까지 화면 밖에 있고, 그걸 노출로 세면 클릭률이
   * 통째로 무의미해집니다. 절반쯤 들어왔을 때를 '보였다'로 봅니다.
   *
   * 한 번 보고 관찰을 끊지 않습니다. 계속 보고 있어야 아래에서 배너를
   * 넘겼을 때(inView는 그대로, promotionId만 바뀜) 다음 장의 노출을 셀 수
   * 있습니다.
   */
  useEffect(() => {
    if (!bannerEl || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.5 },
    );
    // 관찰을 새로 시작할 때는 아직 안 본 상태에서 출발합니다. 배너가 통째로
    // 사라졌다 다시 생기면 inView가 true로 남아 있어, 관찰자가 답하기도 전에
    // 새 배너를 봤다고 셀 수 있습니다.
    setInView(false);
    observer.observe(bannerEl);

    return () => observer.disconnect();
  }, [bannerEl]);

  // 보이는 동안 배너가 바뀌면(넘기기·닫기) 그 장도 따로 셉니다.
  // 같은 배너를 두 번 세는 일은 promotionAnalytics가 막습니다.
  useEffect(() => {
    if (inView && promotionId) trackPromotionImpression(promotionId, placement);
  }, [inView, promotionId, placement]);

  if (!promotion) return null;

  const dismiss = (id: string) => {
    trackPromotionDismiss(id, placement);
    rememberDismissed(id);
    setDismissed((current) => [...current, id]);
  };

  return (
    <section
      className={`w-full max-w-md ${className}`}
      aria-label="이벤트 및 프로모션"
    >
      <div
        ref={setBannerEl}
        className="relative rounded-lg border border-border bg-background overflow-hidden"
      >
        <PromoContent
          promotion={promotion}
          onClick={() => trackPromotionClick(promotion.id, placement)}
        />

        <button
          type="button"
          onClick={() => dismiss(promotion.id)}
          aria-label="배너 닫기"
          className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 text-muted-foreground hover:text-foreground backdrop-blur transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {visible.length > 1 && (
          <nav className="flex items-center justify-between px-2 py-1.5 border-t border-border">
            <button
              type="button"
              onClick={() => setIndex((i) => (i - 1 + visible.length) % visible.length)}
              aria-label="이전 배너"
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex gap-1.5" aria-hidden="true">
              {visible.map((item, i) => (
                <span
                  key={item.id}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === active ? 'bg-primary' : 'bg-border'
                  }`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % visible.length)}
              aria-label="다음 배너"
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </nav>
        )}
      </div>
    </section>
  );
};

/**
 * 배너 한 장의 내용
 *
 * link_url이 있으면 통째로 링크가 되고, 없으면 그냥 공지입니다.
 * 링크가 없는 배너를 <a>로 감싸면 눌러도 아무 일이 없는 버튼이 됩니다.
 *
 * 그래서 클릭 집계도 링크가 있는 배너에만 붙습니다. 눌러도 갈 곳이 없는
 * 공지를 만졌다는 사실은 클릭률의 분자로 셀 만한 행동이 아닙니다.
 * 닫기 버튼은 이 <a> 바깥(부모의 absolute 자리)에 있어서 클릭으로 새지
 * 않습니다 - dismiss와 click이 함께 기록되는 일은 없습니다.
 */
const PromoContent: React.FC<{ promotion: Promotion; onClick: () => void }> = ({
  promotion,
  onClick,
}) => {
  const body = (
    <>
      {promotion.imageUrl && (
        <img
          src={promotion.imageUrl}
          alt=""
          // 이미지가 아직 안 왔을 때 글자가 위아래로 튀지 않게 자리를 잡아 둡니다.
          className="w-full aspect-[2/1] object-cover bg-muted"
          loading="lazy"
        />
      )}
      <div className="p-4 pr-10">
        <h3 className="font-semibold text-sm">{promotion.title}</h3>
        {promotion.body && (
          <p className="text-sm text-muted-foreground mt-1">{promotion.body}</p>
        )}
      </div>
    </>
  );

  if (!promotion.linkUrl) return <div>{body}</div>;

  return (
    <a
      href={promotion.linkUrl}
      target="_blank"
      // 새 탭에서 여는 링크에는 항상 붙입니다. 링크 대상이 window.opener로
      // 이 앱의 탭을 건드릴 수 있고, 배너 주소는 운영자가 나중에 넣는 값입니다.
      rel="noopener noreferrer"
      onClick={onClick}
      className="block hover:bg-muted/40 transition-colors"
    >
      {body}
    </a>
  );
};
