import { useEffect, useState } from 'react';
import {
  fetchPromotions,
  type Promotion,
  type PromotionPlacement,
} from '@/lib/promotions';

/**
 * 해당 자리에 지금 노출할 배너 목록
 *
 * 배너는 없어도 되는 것이므로 로딩 상태를 따로 내보내지 않습니다.
 * 화면은 빈 배열로 시작해서 도착하면 채워지고, 실패하면 그냥 비어 있습니다.
 * 오프라인일 때는 fetchPromotions가 Dexie에 남은 마지막 목록을 돌려줍니다.
 */
export function usePromotions(placement: PromotionPlacement): Promotion[] {
  const [promotions, setPromotions] = useState<Promotion[]>([]);

  useEffect(() => {
    const ac = new AbortController();

    fetchPromotions(placement, ac.signal)
      .then((result) => {
        if (!ac.signal.aborted) setPromotions(result);
      })
      .catch(() => {
        /* fetchPromotions가 이미 캐시로 물러섭니다. */
      });

    return () => ac.abort();
  }, [placement]);

  return promotions;
}
