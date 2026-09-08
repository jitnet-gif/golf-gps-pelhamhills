import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send, Trash2 } from 'lucide-react';
import {
  AdminAuthError,
  cancelCampaign,
  createCampaign,
  describeError,
  formatDateTime,
  listCampaigns,
  listPromotions,
  localInputToIso,
  type AdminPromotion,
  type Campaign,
  type CampaignInput,
  type CampaignStatus,
} from '@/lib/adminApi';

const STATUS_LABEL: Record<CampaignStatus, string> = {
  pending: '예약됨',
  sending: '발송 중',
  sent: '발송 완료',
  failed: '실패',
  canceled: '취소됨',
};

const STATUS_STYLE: Record<CampaignStatus, string> = {
  pending: 'bg-accent/10 text-accent',
  sending: 'bg-accent/10 text-accent',
  sent: 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300',
  failed: 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300',
  canceled: 'bg-muted text-muted-foreground',
};

interface CampaignPanelProps {
  onUnauthorized: () => void;
  className?: string;
}

/**
 * 예약 발송
 *
 * 알림은 한 번 나가면 되돌릴 수 없습니다. 그래서 이 화면은 '지금 보내기'가
 * 아니라 예약만 다룹니다 - 시각을 적는 동안 한 번 더 읽게 되고, 나가기
 * 전까지는 취소할 수 있습니다.
 */
export const CampaignPanel: React.FC<CampaignPanelProps> = ({ onUnauthorized, className = '' }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [promotions, setPromotions] = useState<AdminPromotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [promotionId, setPromotionId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 배너 목록은 '배너 선택'에 쓰입니다. 예약이 실패해도 배너 선택은
      // 살아 있어야 하므로 둘을 따로 기다리지 않고 함께 받습니다.
      const [nextCampaigns, nextPromotions] = await Promise.all([listCampaigns(), listPromotions()]);
      setCampaigns(
        [...nextCampaigns].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)),
      );
      setPromotions(nextPromotions);
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const iso = localInputToIso(scheduledAt);
    if (!iso) {
      setFormError('발송 시각을 정해 주세요.');
      return;
    }

    // 배너를 고르면 제목·내용은 배너에서 가져옵니다(서버가 채웁니다).
    // 둘 다 비면 보낼 내용이 없어 DB의 push_campaigns_has_content에 걸립니다.
    if (!promotionId && !title.trim()) {
      setFormError('제목을 쓰거나 배너를 선택해 주세요.');
      return;
    }

    const input: CampaignInput = {
      // 서버에는 항상 ISO 8601로 보냅니다. datetime-local 값에는 타임존이
      // 없어서 그대로 보내면 시차만큼 어긋난 시각에 나갑니다.
      scheduled_at: iso,
      promotion_id: promotionId || null,
      title: title.trim() || null,
      body: body.trim() || null,
      url: url.trim() || null,
    };

    setIsSaving(true);
    setFormError(null);
    try {
      await createCampaign(input);
      setPromotionId('');
      setTitle('');
      setBody('');
      setUrl('');
      setScheduledAt('');
      await load();
    } catch (err) {
      if (err instanceof AdminAuthError) onUnauthorized();
      setFormError(describeError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const cancel = async (campaign: Campaign) => {
    const when = formatDateTime(campaign.scheduled_at);
    const confirmed = window.confirm(`${when}에 나갈 예약을 취소합니다.\n계속할까요?`);
    if (!confirmed) return;

    setError(null);
    try {
      await cancelCampaign(campaign.id);
      await load();
    } catch (err) {
      if (err instanceof AdminAuthError) onUnauthorized();
      setError(describeError(err));
    }
  };

  const selectedPromotion = promotions.find((item) => item.id === promotionId) ?? null;
  const scheduledIso = localInputToIso(scheduledAt);
  const isPast = scheduledIso !== null && new Date(scheduledIso).getTime() < Date.now();

  const labelClass = 'block text-sm font-medium mb-1';
  const inputClass =
    'w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <section className={`flex flex-col gap-6 ${className}`} aria-label="예약 발송">
      <form onSubmit={submit} className="p-4 rounded-lg border border-border bg-card text-card-foreground">
        <h2 className="font-semibold text-base mb-4">새 예약</h2>

        <div className="flex flex-col gap-4">
          <div>
            <label className={labelClass} htmlFor="campaign-promotion">
              배너에서 가져오기
            </label>
            <select
              id="campaign-promotion"
              className={inputClass}
              value={promotionId}
              onChange={(e) => setPromotionId(e.target.value)}
            >
              <option value="">직접 작성</option>
              {promotions.map((promotion) => (
                <option key={promotion.id} value={promotion.id}>
                  {promotion.title}
                </option>
              ))}
            </select>
            {selectedPromotion && (
              <p className="text-xs text-muted-foreground mt-1">
                비워 둔 칸은 배너 내용으로 채워집니다. 아래에 쓰면 그쪽이 우선합니다.
              </p>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="campaign-title">
              제목
            </label>
            <input
              id="campaign-title"
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder={selectedPromotion ? selectedPromotion.title : '주말 그린피 30% 할인'}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="campaign-body">
              내용
            </label>
            <textarea
              id="campaign-body"
              className={`${inputClass} resize-y`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder={selectedPromotion?.body ?? '이번 주 토·일 오후 티타임 한정'}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="campaign-url">
              누르면 열릴 주소
            </label>
            <input
              id="campaign-url"
              className={inputClass}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={500}
              placeholder="/ (비워 두면 앱 첫 화면)"
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="campaign-scheduled">
              발송 시각
            </label>
            <input
              id="campaign-scheduled"
              type="datetime-local"
              className={inputClass}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              required
            />
            {isPast && (
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                지난 시각입니다. 이대로 저장하면 다음 발송 주기에 곧바로 나갑니다.
              </p>
            )}
          </div>

          {formError && (
            <p className="text-sm text-red-700 dark:text-red-300" role="alert">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {isSaving ? '등록 중...' : '예약 등록'}
          </button>
        </div>
      </form>

      <div>
        <header className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-base">예약 목록</h2>
          <button
            type="button"
            onClick={() => void load()}
            disabled={isLoading}
            aria-label="예약 목록 새로 고침"
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

        {isLoading && campaigns.length === 0 && (
          <p className="text-sm text-muted-foreground">불러오는 중입니다...</p>
        )}

        {!isLoading && campaigns.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">예약된 발송이 없습니다.</p>
        )}

        <ul className="flex flex-col gap-3">
          {campaigns.map((campaign) => {
            const promotion = promotions.find((item) => item.id === campaign.promotion_id) ?? null;

            return (
              <li
                key={campaign.id}
                className="p-3 rounded-lg border border-border bg-card text-card-foreground"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm break-words">
                      {/* 배너에서 가져온 예약은 제목 칸이 비어 있습니다. 그 자리에
                          '(제목 없음)'을 찍으면 내용 없는 예약처럼 보입니다. */}
                      {campaign.title ?? promotion?.title ?? '배너 내용 그대로'}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {formatDateTime(campaign.scheduled_at)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${STATUS_STYLE[campaign.status]}`}
                  >
                    {STATUS_LABEL[campaign.status]}
                  </span>
                </div>

                {(campaign.body ?? promotion?.body) && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {campaign.body ?? promotion?.body}
                  </p>
                )}

                {campaign.status === 'sent' && (
                  <p className="text-xs text-muted-foreground mt-2 tabular-nums">
                    {campaign.delivered ?? 0}대 전송 성공 / {campaign.attempted ?? 0}대 시도
                    {campaign.failed ? ` · 실패 ${campaign.failed}` : ''}
                  </p>
                )}

                {campaign.error && (
                  <p className="text-xs text-red-700 dark:text-red-300 mt-2 break-words">
                    {campaign.error}
                  </p>
                )}

                {/* 취소는 아직 안 나간 예약에만 됩니다. sending은 이미 발송이
                    시작된 상태라 되돌릴 수 없습니다. */}
                {campaign.status === 'pending' && (
                  <div className="flex justify-end mt-3">
                    <button
                      type="button"
                      onClick={() => void cancel(campaign)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      예약 취소
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};
