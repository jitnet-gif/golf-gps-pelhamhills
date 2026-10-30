import { useState, useSyncExternalStore } from 'react';
import { ExternalLink, Presentation } from 'lucide-react';
import { getLang, onLangChange } from '@/lib/i18n/engine';

/**
 * CCTV
 *
 * 클럽 Hikvision 녹화기를 어드민에서 보는 일의 준비 탭입니다. 실시간 화면은 go2rtc 를
 * 설치한 뒤에 붙습니다. 지금은 연결 구조와 준비물을 호프 가이드로 안내합니다.
 */
export function CctvAdmin() {
  const lang = useSyncExternalStore(onLangChange, getLang);
  const [showGuide, setShowGuide] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm rounded-md px-3 py-2 bg-amber-500/10 text-amber-800 dark:text-amber-200">
        아직 카메라가 연결되지 않았습니다. 녹화기 정보를 받으면 여기에 실시간 그리드가 들어옵니다.
      </p>

      <section aria-label="호프 가이드" className="rounded-lg border border-border p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Presentation className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">호프 가이드</p>
          <span className="ml-auto text-xs text-muted-foreground">ElevenLabs Hope Natural · 6장</span>
        </div>
        <p className="text-xs text-muted-foreground">
          연결 구조, 모니터 상태, 화질, 진행 순서, 준비물을 호프가 한국어·영어로 읽어 줍니다. 피치와 속도를 바꿀 수 있고, 한/영 키로 언어를 바꿉니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            {showGuide ? '가이드 닫기' : '여기서 보기'}
          </button>
          <a
            href={`/admin/cctv-guide.html?lang=${lang}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
          >
            <ExternalLink className="w-4 h-4" />새 창으로
          </a>
        </div>
        {showGuide && (
          <iframe
            title="호프 CCTV 가이드"
            src={`/admin/cctv-guide.html?lang=${lang}`}
            className="w-full h-[80vh] rounded-md border border-border"
            allow="autoplay"
          />
        )}
      </section>
    </div>
  );
}
