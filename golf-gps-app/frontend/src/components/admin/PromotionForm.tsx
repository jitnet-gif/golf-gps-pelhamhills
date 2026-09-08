import React, { useEffect, useRef, useState } from 'react';
import { ImageOff, X } from 'lucide-react';
import {
  AdminAuthError,
  createPromotion,
  describeError,
  isoToLocalInput,
  localInputToIso,
  updatePromotion,
  type AdminPromotion,
  type PromotionInput,
  type PromotionPlacement,
} from '@/lib/adminApi';

interface FormState {
  title: string;
  body: string;
  imageUrl: string;
  linkUrl: string;
  placement: PromotionPlacement;
  priority: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
}

function toFormState(promotion: AdminPromotion | null): FormState {
  return {
    title: promotion?.title ?? '',
    body: promotion?.body ?? '',
    imageUrl: promotion?.image_url ?? '',
    linkUrl: promotion?.link_url ?? '',
    placement: promotion?.placement ?? 'home',
    // 숫자를 문자열로 들고 있습니다. number 상태로 두면 입력 중에 잠깐
    // 비는 칸이 0으로 튀어 지우고 다시 쓰기가 어렵습니다.
    priority: String(promotion?.priority ?? 0),
    startsAt: isoToLocalInput(promotion?.starts_at),
    endsAt: isoToLocalInput(promotion?.ends_at),
    active: promotion?.active ?? true,
  };
}

interface PromotionFormProps {
  /** null이면 새 배너, 값이 있으면 그 배너를 수정합니다. */
  promotion: AdminPromotion | null;
  onSaved: () => void;
  onCancel: () => void;
  onUnauthorized: () => void;
  className?: string;
}

/**
 * 배너 등록/수정 폼
 *
 * 등록과 수정이 같은 폼입니다. 화면이 둘이면 필드 하나를 추가할 때 한쪽에만
 * 넣고 넘어가는 일이 반드시 생깁니다.
 */
export const PromotionForm: React.FC<PromotionFormProps> = ({
  promotion,
  onSaved,
  onCancel,
  onUnauthorized,
  className = '',
}) => {
  const [form, setForm] = useState<FormState>(() => toFormState(promotion));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageBroken, setImageBroken] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);

  // 목록에서 '수정'을 누르면 폼은 목록 위에 그대로 남습니다. 휴대폰에서는
  // 화면 밖이라 아무 일도 안 일어난 것처럼 보여서, 폼으로 데려다줍니다.
  useEffect(() => {
    setForm(toFormState(promotion));
    setImageBroken(false);
    setError(null);
    rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [promotion]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const title = form.title.trim();
    if (!title) {
      setError('제목은 반드시 있어야 합니다.');
      return;
    }

    const startsAt = localInputToIso(form.startsAt);
    const endsAt = localInputToIso(form.endsAt);

    // DB에 promotions_window_valid 체크가 걸려 있습니다. 여기서 막지 않으면
    // 저장을 누른 뒤에야 영문 제약 이름이 담긴 500을 보게 됩니다.
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setError('종료 시각은 시작 시각보다 뒤여야 합니다.');
      return;
    }

    const input: PromotionInput = {
      title,
      // 빈 칸은 빈 문자열이 아니라 NULL입니다. 배너 쪽 코드가 'body가 있으면
      // 그린다'로 판단하는데, ''는 있는 값이라 빈 줄이 생깁니다.
      body: form.body.trim() || null,
      image_url: form.imageUrl.trim() || null,
      link_url: form.linkUrl.trim() || null,
      placement: form.placement,
      priority: Number(form.priority) || 0,
      starts_at: startsAt,
      ends_at: endsAt,
      active: form.active,
    };

    setIsSaving(true);
    setError(null);
    try {
      if (promotion) {
        await updatePromotion(promotion.id, input);
      } else {
        await createPromotion(input);
      }
      onSaved();
    } catch (err) {
      if (err instanceof AdminAuthError) onUnauthorized();
      setError(describeError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const labelClass = 'block text-sm font-medium mb-1';
  const inputClass =
    'w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <form
      ref={rootRef}
      onSubmit={submit}
      className={`p-4 rounded-lg border border-border bg-card text-card-foreground ${className}`}
    >
      <header className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-semibold text-base">{promotion ? '배너 수정' : '새 배너'}</h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="폼 닫기"
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex flex-col gap-4">
        <div>
          <label className={labelClass} htmlFor="promo-title">
            제목
          </label>
          <input
            id="promo-title"
            className={inputClass}
            value={form.title}
            onChange={(e) => update('title', e.target.value)}
            maxLength={120}
            required
            placeholder="주말 그린피 30% 할인"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="promo-body">
            내용
          </label>
          <textarea
            id="promo-body"
            className={`${inputClass} resize-y`}
            value={form.body}
            onChange={(e) => update('body', e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="이번 주 토·일 오후 티타임 한정"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="promo-image">
            이미지 주소
          </label>
          <input
            id="promo-image"
            type="url"
            className={inputClass}
            value={form.imageUrl}
            onChange={(e) => {
              update('imageUrl', e.target.value);
              setImageBroken(false);
            }}
            placeholder="https://..."
          />

          {/* 배너는 보이는 것이 전부입니다. 저장하고 앱을 열어 봐야 확인되면
              주소를 한 글자 틀린 것도 한참 뒤에 압니다. 여기서 바로 보여 줍니다. */}
          {form.imageUrl.trim() && (
            <div className="mt-2">
              {imageBroken ? (
                <p className="flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-300">
                  <ImageOff className="w-4 h-4 shrink-0" />
                  이미지를 불러올 수 없습니다. 주소를 확인해 주세요.
                </p>
              ) : (
                <img
                  src={form.imageUrl.trim()}
                  alt="배너 이미지 미리보기"
                  onError={() => setImageBroken(true)}
                  // 앱의 배너와 같은 비율로 잘라 봅니다. 원본 비율로 보여 주면
                  // 여기서는 멀쩡한 사진이 실제 배너에서 잘려 나갑니다.
                  className="w-full max-w-sm aspect-[2/1] object-cover rounded-md border border-border bg-muted"
                />
              )}
            </div>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="promo-link">
            클릭 시 이동할 주소
          </label>
          <input
            id="promo-link"
            type="url"
            className={inputClass}
            value={form.linkUrl}
            onChange={(e) => update('linkUrl', e.target.value)}
            placeholder="https://... (비워 두면 공지만 표시)"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="promo-placement">
              노출 자리
            </label>
            <select
              id="promo-placement"
              className={inputClass}
              value={form.placement}
              onChange={(e) => update('placement', e.target.value as PromotionPlacement)}
            >
              <option value="home">홈</option>
              <option value="scorecard">스코어카드</option>
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="promo-priority">
              우선순위
            </label>
            <input
              id="promo-priority"
              type="number"
              inputMode="numeric"
              className={inputClass}
              value={form.priority}
              onChange={(e) => update('priority', e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">높을수록 먼저 나옵니다.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="promo-starts">
              노출 시작
            </label>
            <input
              id="promo-starts"
              type="datetime-local"
              className={inputClass}
              value={form.startsAt}
              onChange={(e) => update('startsAt', e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">비워 두면 즉시 시작합니다.</p>
          </div>

          <div>
            <label className={labelClass} htmlFor="promo-ends">
              노출 종료
            </label>
            <input
              id="promo-ends"
              type="datetime-local"
              className={inputClass}
              value={form.endsAt}
              onChange={(e) => update('endsAt', e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">비워 두면 계속 노출합니다.</p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => update('active', e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          <span>노출함</span>
          <span className="text-muted-foreground text-xs">
            (기간을 그대로 두고 잠시 내릴 때 끕니다)
          </span>
        </label>

        {error && (
          <p className="text-sm text-red-700 dark:text-red-300" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isSaving ? '저장 중...' : promotion ? '수정 저장' : '배너 등록'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-border text-sm hover:bg-muted/40 transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </form>
  );
};
