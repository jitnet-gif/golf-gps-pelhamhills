/**
 * 마케팅/홍보 배너 조회
 *
 * 코스 데이터와 같은 길을 씁니다: PostgREST에 publishable 키로 직접 붙습니다.
 * Worker(`GET /api/promotions`)에도 같은 데이터가 있지만, 배포된 프론트엔드는
 * Vercel 정적 호스팅이라 Worker 주소가 따로 잡혀 있어야만 닿습니다.
 * 배너 하나 때문에 그 의존을 늘리지 않습니다.
 *
 * 노출 기간과 active 필터는 여기서 다시 걸지 않습니다. promotions의 RLS
 * 정책(promotions_read_live)이 anon 키에 대해 이미 같은 조건을 걸고 있어서,
 * 클라이언트에서 한 번 더 거르면 규칙이 두 군데로 갈라집니다.
 */

import { db, type CachedPromotion } from '@/db';

const URL_BASE = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export type PromotionPlacement = 'home' | 'scorecard';

export interface Promotion {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  placement: PromotionPlacement;
  priority: number;
}

interface PromotionRow {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
  placement: PromotionPlacement;
  priority: number;
}

function toPromotion(row: PromotionRow): Promotion {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    placement: row.placement,
    priority: row.priority,
  };
}

/**
 * 마지막으로 받아 온 배너를 Dexie에 남깁니다.
 *
 * 서비스워커의 api-cache는 5분이면 만료되고, 어차피 PostgREST 응답은
 * 그 규칙에 걸리지도 않습니다. 통신이 없는 코스 위에서 배너 자리가
 * 통째로 비어 보이지 않으려면 앱이 직접 들고 있어야 합니다.
 * 이미지는 서비스워커의 image-cache(CacheFirst)가 따로 잡아 둡니다.
 */
async function readCache(placement: PromotionPlacement): Promise<Promotion[]> {
  try {
    const cached = await db.promotions
      .where('placement')
      .equals(placement)
      .toArray();

    return cached
      .sort((a, b) => b.priority - a.priority)
      .map(({ cachedAt: _cachedAt, ...promotion }) => promotion);
  } catch {
    // Dexie가 열리지 않는 브라우저(사파리 프라이빗 등)에서도 앱은 살아야 합니다.
    return [];
  }
}

async function writeCache(placement: PromotionPlacement, promotions: Promotion[]): Promise<void> {
  try {
    const now = new Date().toISOString();
    const rows: CachedPromotion[] = promotions.map((promotion) => ({
      ...promotion,
      placement,
      cachedAt: now,
    }));

    // 내려간 배너가 캐시에 남아 계속 보이면 안 되므로, 이 자리의 캐시는
    // 통째로 갈아 끼웁니다.
    await db.transaction('rw', db.promotions, async () => {
      await db.promotions.where('placement').equals(placement).delete();
      if (rows.length > 0) await db.promotions.bulkPut(rows);
    });
  } catch {
    // 캐시 실패는 화면에 영향을 주지 않습니다.
  }
}

/**
 * 지금 노출할 배너 목록
 *
 * 네트워크가 안 되면 마지막으로 저장해 둔 목록을 돌려줍니다.
 * 설정이 비어 있으면(로컬에서 Supabase 없이 띄운 경우) 빈 배열입니다 -
 * 배너는 없어도 되는 것이므로 에러를 던지지 않습니다.
 */
export async function fetchPromotions(
  placement: PromotionPlacement,
  signal?: AbortSignal,
): Promise<Promotion[]> {
  if (!URL_BASE || !KEY) return readCache(placement);

  const query = new URLSearchParams({
    select: 'id,title,body,image_url,link_url,placement,priority',
    placement: `eq.${placement}`,
    order: 'priority.desc,created_at.desc',
    limit: '5',
  });

  try {
    const response = await fetch(`${URL_BASE}/rest/v1/promotions?${query}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      signal,
    });

    if (!response.ok) return readCache(placement);

    const rows = (await response.json()) as PromotionRow[];
    const promotions = rows.map(toPromotion);

    await writeCache(placement, promotions);
    return promotions;
  } catch {
    return readCache(placement);
  }
}
