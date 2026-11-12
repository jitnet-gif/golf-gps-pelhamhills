import { useEffect, useRef, useState } from 'react';
import { KeyRound, Mail, Presentation } from 'lucide-react';
import { AccountForm } from '@/components/AccountPanel';
import { PinPad } from './PinPad';
import { logEvent, pinSignIn, setUnlocked, whoami, type AdminWho } from '@/lib/adminSession';
import LangToggle from '@/lib/i18n/LangToggle';
import { useAppStore } from '@/store/appStore';

/**
 * 운영 화면 입구 - 클럽 어드민(pelhamhills.com/admin)과 같은 직원 ID 숫자판.
 *
 * - 직원: Pelham Shift 직원 ID 를 누릅니다. 누가 들어왔는지 서버가 적고, 이후 한 일도 그 이름으로 남습니다.
 * - 매니저·코스 지도 담당: "이메일로 로그인". 코스 지도는 analysis@pelhamhills.ca 만 고칠 수 있습니다.
 * - 이 기기에 이미 이메일 계정으로 로그인돼 있으면 "계속" 을 보여 줍니다. 숫자판 공용 계정이면 보여 주지
 *   않습니다 - 앞 사람 이름으로 기록이 남으면 안 되기 때문입니다.
 */
export function AdminEntry({ onEnter }: { onEnter: () => void }) {
  const account = useAppStore((s) => s.account);
  const [who, setWho] = useState<AdminWho | null>(null);
  const [emailMode, setEmailMode] = useState(false);
  const pinning = useRef(false);
  const accountAtOpen = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    setWho(null);
    if (!account) return;
    let alive = true;
    void whoami().then((w) => {
      if (alive) setWho(w);
    });
    return () => {
      alive = false;
    };
  }, [account]);

  // 이메일 칸을 연 뒤 계정이 바뀌면(로그인 성공) 그대로 들어갑니다.
  useEffect(() => {
    if (!emailMode) {
      accountAtOpen.current = undefined;
      return;
    }
    if (accountAtOpen.current === undefined) {
      accountAtOpen.current = account?.id ?? null;
      return;
    }
    if (account && account.id !== accountAtOpen.current && !pinning.current) {
      setUnlocked(true);
      void logEvent('login', 'email');
      onEnter();
    }
  }, [emailMode, account, onEnter]);

  const enterWithPin = async (code: string) => {
    pinning.current = true;
    try {
      await pinSignIn(code);
      onEnter();
    } finally {
      pinning.current = false;
    }
  };

  const canContinue = Boolean(account && who && !who.shared && who.via === 'email');

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm p-5 rounded-lg border border-border bg-card text-card-foreground">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-base">직원 ID 로 들어가기</h1>
          <LangToggle className="ml-auto px-2 py-1 rounded-md border border-border text-xs" />
        </div>
        <p className="text-sm text-muted-foreground mb-2">
          클럽 어드민과 같은 Pelham Shift 직원 ID(출퇴근 번호)를 누르세요. 운영 화면에서 한 일은 이 이름으로 기록됩니다.
        </p>

        <PinPad onSubmit={enterWithPin} />

        {canContinue && account && (
          <button
            type="button"
            onClick={() => {
              setUnlocked(true);
              void logEvent('open', 'admin');
              onEnter();
            }}
            className="w-full mt-4 px-4 py-2 rounded-md border border-border text-sm hover:bg-muted/40"
          >
            <span data-no-translate>{account.email}</span> 로 계속
          </button>
        )}

        <div className="mt-4 border-t border-border pt-3 flex flex-col gap-3">
        <a
          href="/admin/staff-login-guide.html"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-2"
        >
          <Presentation className="w-4 h-4" />직원 ID 로그인 안내 (호프 가이드)
        </a>

          {emailMode ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                매니저와 코스 지도 담당은 이메일로 들어옵니다. 코스 지도·드론 경로는 analysis@pelhamhills.ca 만 고칠 수 있습니다.
              </p>
              <AccountForm locale="ko" />
              <button
                type="button"
                onClick={() => setEmailMode(false)}
                className="self-start text-xs text-muted-foreground underline"
              >
                숫자판으로 돌아가기
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEmailMode(true)}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <Mail className="w-4 h-4" />
              매니저 · 이메일로 로그인
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
