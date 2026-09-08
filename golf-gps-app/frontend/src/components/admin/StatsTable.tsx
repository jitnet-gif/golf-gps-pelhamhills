import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  AdminAuthError,
  describeError,
  fetchPromotionStats,
  type PromotionStat,
} from '@/lib/adminApi';
import { PromotionStatusBadge } from './PromotionList';

interface StatsTableProps {
  onUnauthorized: () => void;
  className?: string;
}

/**
 * 배너 성적표
 *
 * 노출은 기기 하나당 하루 한 번만 셉니다(uniq_promotion_impression_per_day).
 * 앱을 자주 켜는 사람 한 명이 숫자를 좌우하지 않게 한 것이고, 그래서 여기
 * 클릭률은 '보여 준 사람 중 몇 명이 눌렀나'에 가깝습니다.
 */
export const StatsTable: React.FC<StatsTableProps> = ({ onUnauthorized, className = '' }) => {
  const [stats, setStats] = useState<PromotionStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await fetchPromotionStats();
      // 많이 보인 배너부터. 노출이 0인 줄은 아직 판단할 근거가 없으므로 뒤로 갑니다.
      setStats([...rows].sort((a, b) => b.impressions - a.impressions));
    } catch (err) {
      if (err instanceof AdminAuthError) onUnauthorized();
      setError(describeError(err));
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className={className} aria-label="배너 성과">
      <header className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-semibold text-base">배너 성과</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={isLoading}
          aria-label="집계 새로 고침"
          className="p-2 rounded-md border border-border text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {error && (
        <p className="text-sm text-red-700 dark:text-red-300 mb-3" role="alert">
          {error}
        </p>
      )}

      {isLoading && stats.length === 0 && (
        <p className="text-sm text-muted-foreground">불러오는 중입니다...</p>
      )}

      {!isLoading && stats.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">아직 집계된 배너가 없습니다.</p>
      )}

      {stats.length > 0 && (
        // 휴대폰 폭에서는 표가 넘칩니다. 글자를 줄이는 대신 표만 옆으로 밀립니다.
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="text-left font-medium px-3 py-2 whitespace-nowrap">
                  배너
                </th>
                <th scope="col" className="text-right font-medium px-3 py-2 whitespace-nowrap">
                  노출
                </th>
                <th scope="col" className="text-right font-medium px-3 py-2 whitespace-nowrap">
                  클릭
                </th>
                <th scope="col" className="text-right font-medium px-3 py-2 whitespace-nowrap">
                  닫음
                </th>
                <th scope="col" className="text-right font-medium px-3 py-2 whitespace-nowrap">
                  클릭률
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.map((stat) => (
                <tr key={stat.promotion_id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{stat.title}</span>
                      <PromotionStatusBadge promotion={stat} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {stat.placement === 'home' ? '홈' : '스코어카드'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {stat.impressions.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {stat.clicks.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {stat.dismissals.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {/* 노출이 0이면 뷰가 NULL을 줍니다. 0%로 적으면 '눌리지 않았다'로
                        읽히지만 실제로는 아직 아무에게도 안 보인 배너입니다. */}
                    {stat.click_rate_pct === null ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      `${stat.click_rate_pct}%`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
