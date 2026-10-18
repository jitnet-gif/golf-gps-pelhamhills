import { useEffect, useState } from 'react';
import { Check, Image as ImageIcon, Satellite } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import {
  cachedFullMapStyle,
  fetchFullMapStyle,
  saveFullMapStyle,
  type FullMapStyle,
} from '@/lib/appSettings';
import type { ServerProblem } from '@/lib/holePaths';
import { COURSE_MAP_OVERLAY } from '@/data/courseMap';

const PROBLEM: Record<ServerProblem, string> = {
  unavailable: '이 빌드에는 서버 연결이 없어 바꿀 수 없습니다.',
  signedOut: '바꾸려면 아래 ‘모든 폰에 반영’ 칸에서 관리자 계정으로 로그인하세요.',
  notAdmin: '이 계정은 관리자로 지정되지 않아 바꿀 수 없습니다 (0006 SQL 맨 아래 관리자 지정).',
  missingTable: '서버에 app_settings 표가 없습니다. 0007_hole_edits.sql 을 SQL Editor 에서 실행해 주세요.',
  network: '인터넷 연결이 없어 저장하지 못했습니다.',
  other: '저장하지 못했습니다. 잠시 후 다시 눌러 주세요.',
};

const OPTIONS: { id: FullMapStyle; title: string; detail: string }[] = [
  { id: 'satellite', title: '신시스템 지도', detail: '위성 사진 + 홀 점선. 번호를 누르면 그 홀로 갑니다.' },
  {
    id: 'printed',
    title: '현시스템 지도',
    detail: '클럽 코스 안내도만 흰 바탕에 보여 줍니다 (위성 지도 없이). 내 위치 점이 안내도 위에 나오고, 번호를 누르면 그 홀로 갑니다.',
  },
];

/**
 * 고객 전체 맵 고르기
 *
 * 선수 화면의 'Full map' 버튼이 무엇을 보여 줄지 정합니다. 서버(app_settings)에
 * 저장되어 모든 고객 폰이 따릅니다 - 폰은 전체 맵을 열 때마다 다시 확인합니다.
 */
export function FullMapStylePicker() {
  const account = useAppStore((s) => s.account);
  const [style, setStyle] = useState<FullMapStyle>(cachedFullMapStyle);
  const [saving, setSaving] = useState<FullMapStyle | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchFullMapStyle().then((s) => {
      if (alive && s) setStyle(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const choose = async (next: FullMapStyle) => {
    if (next === style || saving) return;
    setSaving(next);
    setMessage(null);
    const problem = await saveFullMapStyle(next);
    setSaving(null);
    if (problem) {
      setMessage({ tone: 'error', text: PROBLEM[problem] });
      return;
    }
    setStyle(next);
    setMessage({
      tone: 'ok',
      text: '저장했습니다. 아래 지도에 고른 전체 맵을 미리 보여 드립니다. 고객 폰은 Full map을 열 때(열려 있으면 다시 누를 때) 바뀝니다.',
    });
  };

  return (
    <section aria-label="고객 전체 맵" className="rounded-lg border border-border p-3 flex flex-col gap-2">
      <p className="text-sm font-medium">고객 전체 맵</p>
      <p className="text-xs text-muted-foreground">
        선수 화면의 &apos;Full map&apos; 버튼이 보여 줄 지도입니다. 모든 고객 폰에 같이 적용됩니다.
      </p>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="전체 맵 종류">
        {OPTIONS.map((option) => {
          const active = option.id === style;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => void choose(option.id)}
              aria-pressed={active}
              disabled={saving !== null}
              className={`flex flex-col items-stretch gap-1.5 rounded-lg border p-2 text-left transition-colors disabled:opacity-60 ${
                active ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/40'
              }`}
            >
              <span className="flex h-20 items-center justify-center overflow-hidden rounded-md bg-muted">
                {option.id === 'printed' ? (
                  <img src={COURSE_MAP_OVERLAY.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Satellite className="h-8 w-8 text-muted-foreground" />
                )}
              </span>
              <span className="flex items-center gap-1 text-sm font-semibold">
                {active ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : option.id === 'printed' ? (
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                ) : null}
                {option.title}
                {saving === option.id && <span className="text-xs font-normal"> 저장 중...</span>}
              </span>
              <span className="text-[11px] leading-snug text-muted-foreground">{option.detail}</span>
            </button>
          );
        })}
      </div>

      {!account && !message && (
        <p className="text-xs text-muted-foreground">{PROBLEM.signedOut}</p>
      )}
      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-xs ${message.tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-400'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
