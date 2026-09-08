import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  AdminAuthError,
  deletePromotion,
  describeError,
  formatDateTime,
  listPromotions,
  type AdminPromotion,
} from '@/lib/adminApi';

type PromotionState = 'live' | 'scheduled' | 'ended' | 'off';

interface StatusInfo {
  state: PromotionState;
  label: string;
}

/**
 * 배너가 지금 어떤 상태인지
 *
 * 서버는 active와 노출 기간을 따로 들고 있어서, 목록만 보면 "active인데 왜
 * 안 보이지"가 생깁니다. 두 값을 한 단어로 합쳐서 그 질문을 없앱니다.
 * 판정 순서가 중요합니다 - 수동으로 내린 배너는 기간이 남아 있어도
 * 안 나가므로 active를 먼저 봅니다.
 */
export function getPromotionStatus(promotion: {
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}): StatusInfo {
  if (!promotion.active) return { state: 'off', label: '중지됨' };

  const now = Date.now();
  const starts = promotion.starts_at ? new Date(promotion.starts_at).getTime() : null;
  const ends = promotion.ends_at ? new Date(promotion.ends_at).getTime() : null;

  if (starts !== null && now < starts) return { state: 'scheduled', label: '예정' };
  if (ends !== null && now >= ends) return { state: 'ended', label: '종료' };

  return { state: 'live', label: '노출 중' };
}

const STATUS_STYLE: Record<PromotionState, string> = {
  live: 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300',
  scheduled: 'bg-accent/10 text-accent',
  ended: 'bg-muted text-muted-foreground',
  off: 'bg-muted text-muted-foreground',
};

export const PromotionStatusBadge: React.FC<{
  promotion: { active: boolean; starts_at: string | null; ends_at: string | null };
}> = ({ promotion }) => {
  const { state, label } = getPromotionStatus(promotion);

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${STATUS_STYLE[state]}`}
    >
      {label}
    </span>
  );
};

interface PromotionListProps {
  /** 이 값이 바뀌면 목록을 다시 읽습니다. 폼이 저장한 뒤 올려 줍니다. */
  refreshToken?: number;
  onEdit: (promotion: AdminPromotion) => void;
  onCreate: () => void;
  onUnauthorized: () => void;
  className?: string;
}

/**
 * 배너 목록
 *
 * 노출 기간 순이 아니라 우선순위 순으로 봅니다. 같은 자리에 여러 개가
 * 걸렸을 때 실제로 위에 뜨는 순서가 그것이고, 운영자가 확인하고 싶은 것도
 * 그 순서입니다.
 */
export const PromotionList: React.FC<PromotionListProps> = ({
  refreshToken = 0,
  onEdit,
  onCreate,
  onUnauthorized,
  className = '',
}) => {
  const [promotions, setPromotions] = useState<AdminPromotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await listPromotions();
      setPromotions(
        [...rows].sort(
          (a, b) => b.priority - a.priority || (b.created_at ?? '').localeCompare(a.created_at ?? ''),
        ),
      );
    } catch (err) {
      if (err instanceof AdminAuthError) onUnauthorized();
      setError(describeError(err));
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const remove = async (promotion: AdminPromotion) => {
    // 삭제하면 그 배너에 달린 집계 이벤트도 함께 사라집니다(ON DELETE CASCADE).
    // 되돌릴 방법이 없으므로 제목을 보여 주고 한 번 묻습니다.
    const confirmed = window.confirm(
      `'${promotion.title}' 배너를 삭제합니다.\n집계 기록도 함께 지워지며 되돌릴 수 없습니다.`,
    );
    if (!confirmed) return;

    setDeletingId(promotion.id);
    setError(null);
    try {
      await deletePromotion(promotion.id);
      setPromotions((current) => current.filter((item) => item.id !== promotion.id));
    } catch (err) {
      if (err instanceof AdminAuthError) onUnauthorized();
      setError(describeError(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className={className} aria-label="배너 목록">
      <header className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-semibold text-base">배너</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={isLoading}
            aria-label="목록 새로 고침"
            className="p-2 rounded-md border border-border text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />새 배너
          </button>
        </div>
      </header>

      {error && (
        <p className="text-sm text-red-700 dark:text-red-300 mb-3" role="alert">
          {error}
        </p>
      )}

      {isLoading && promotions.length === 0 && (
        <p className="text-sm text-muted-foreground">불러오는 중입니다...</p>
      )}

      {!isLoading && promotions.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          등록된 배너가 없습니다. &lsquo;새 배너&rsquo;로 첫 배너를 만들어 보세요.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {promotions.map((promotion) => (
          <li
            key={promotion.id}
            className="p-3 rounded-lg border border-border bg-card text-card-foreground"
          >
            <div className="flex gap-3">
              {promotion.image_url && (
                <img
                  src={promotion.image_url}
                  alt=""
                  className="w-16 h-16 rounded-md object-cover bg-muted shrink-0"
                  loading="lazy"
                />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <h3 className="font-semibold text-sm min-w-0 break-words">{promotion.title}</h3>
                  <PromotionStatusBadge promotion={promotion} />
                </div>

                {promotion.body && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{promotion.body}</p>
                )}

                <dl className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  <div className="flex gap-1">
                    <dt>자리</dt>
                    <dd className="text-foreground">
                      {promotion.placement === 'home' ? '홈' : '스코어카드'}
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>우선순위</dt>
                    <dd className="text-foreground">{promotion.priority}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>기간</dt>
                    {/* NULL은 '즉시'와 '무기한'입니다. 빈칸으로 두면 설정을 빠뜨린 것처럼 보입니다. */}
                    <dd className="text-foreground">
                      {promotion.starts_at ? formatDateTime(promotion.starts_at) : '즉시'}
                      {' ~ '}
                      {promotion.ends_at ? formatDateTime(promotion.ends_at) : '무기한'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={() => onEdit(promotion)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted/40 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                수정
              </button>
              <button
                type="button"
                onClick={() => void remove(promotion)}
                disabled={deletingId === promotion.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deletingId === promotion.id ? '삭제 중' : '삭제'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
