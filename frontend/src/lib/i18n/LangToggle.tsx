import { useEffect, useSyncExternalStore } from 'react';
import { getLang, onLangChange, startI18n, toggleLang } from './engine';
import en from './en.json';

/**
 * 운영 화면을 한/영으로 바꾸는 버튼. 원문이 한국어라 영어 사전(`en.json`)만 있다.
 * 클럽 어드민의 Course Map 링크는 `?lang=` 을 붙여 열어서, 그쪽에서 고른 언어로 뜬다.
 */
export function startAdminI18n() {
  startI18n({ en, ko: async () => ({}) });
}

export default function LangToggle({ className = '' }: { className?: string }) {
  useEffect(startAdminI18n, []);
  const lang = useSyncExternalStore(onLangChange, getLang);
  return (
    <button
      type="button"
      onClick={toggleLang}
      translate="no"
      aria-label={lang === 'ko' ? 'Switch to English' : '한국어로 보기'}
      className={`shrink-0 font-semibold ${className}`}
    >
      <span className={lang === 'en' ? '' : 'opacity-50'}>EN</span>
      <span className="opacity-40"> / </span>
      <span className={lang === 'ko' ? '' : 'opacity-50'}>한</span>
    </button>
  );
}
