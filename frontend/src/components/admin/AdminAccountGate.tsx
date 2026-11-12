import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { startAuth } from '@/lib/auth';
import { adminStatus } from '@/lib/adminApi';
import { mapEditorStatus } from '@/lib/holePaths';
import { endAdmin } from '@/lib/adminSession';
import { AccountForm } from '@/components/AccountPanel';

/**
 * 배너·성과·예약 발송 앞의 관리자 확인
 *
 * 서버가 관리자 계정인지 보고 쓰기를 허락하므로(0009), 화면도 같은 기준으로
 * 먼저 거릅니다. 관리자가 아닌 계정에 배너 목록을 그대로 보여 주면 지금 노출
 * 중인 배너만 보여서 "나머지 배너가 사라졌다"로 읽힙니다.
 *
 * 스코어 탭과 같은 계정입니다. 한 번 로그인하면 모든 탭이 따릅니다.
 *
 * mapEditor 를 주면 관리자가 아니라 코스 지도 수정 계정(0030)을 봅니다.
 */
export function AdminAccountGate({
  children,
  mapEditor = false,
}: {
  children: ReactNode;
  mapEditor?: boolean;
}) {
  const readStatus = mapEditor ? mapEditorStatus : adminStatus;
  const role = mapEditor ? '코스 지도 수정 계정' : '관리자';
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  const [status, setStatus] = useState<'admin' | 'notAdmin' | 'error' | null>(null);

  useEffect(() => {
    startAuth();
  }, []);

  const check = useCallback(async () => {
    setStatus(null);
    setStatus(await readStatus());
  }, [readStatus]);

  useEffect(() => {
    setStatus(null);
    if (!account) return;
    let alive = true;
    readStatus().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, [account, readStatus]);

  if (!accountReady) return <p className="text-sm text-muted-foreground">불러오는 중...</p>;

  if (!account) {
    return (
      <section aria-label="관리자 로그인" className="max-w-sm rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-base font-semibold">{`${role} 로그인`}</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {mapEditor
            ? '코스 지도는 지정된 계정으로만 고칠 수 있습니다.'
            : '배너와 알림은 관리자로 지정된 회원 계정으로만 바꿀 수 있습니다. 스코어 탭과 같은 계정입니다.'}
        </p>
        <AccountForm locale="ko" />
      </section>
    );
  }

  const accountStrip = (note: ReactNode, tone: 'ok' | 'muted' | 'error') => (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      {tone === 'ok' && <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{account.email ?? '로그인됨'}</p>
        <p
          className={`text-xs ${tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'}`}
        >
          {note}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void endAdmin()}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
      >
        <LogOut className="h-3.5 w-3.5" />
        로그아웃
      </button>
    </div>
  );

  if (status === null) return accountStrip('권한 확인 중...', 'muted');

  if (status === 'notAdmin') {
    if (mapEditor) {
      // 코스 지도·드론 경로는 analysis@pelhamhills.ca 하나만 고칩니다(0030, 0032).
      // 숫자판으로 들어온 직원은 여기서 그 계정으로 바꿔 로그인합니다 - 로그아웃하면 입구로 돌아갑니다.
      return (
        <div className="flex flex-col gap-2">
          {accountStrip('코스 지도는 analysis@pelhamhills.ca 계정만 고칠 수 있습니다.', 'error')}
          <button
            type="button"
            onClick={() => void endAdmin()}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
          >
            analysis@pelhamhills.ca 로 로그인
          </button>
        </div>
      );
    }
    return accountStrip(
      `이 계정은 ${role}으로 지정되지 않았습니다. ${role}으로 다시 로그인해 주세요.`,
      'error',
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col gap-2">
        {accountStrip('권한을 확인하지 못했습니다. 인터넷 연결을 확인해 주세요.', 'error')}
        <button
          type="button"
          onClick={() => void check()}
          className="inline-flex items-center gap-1.5 self-start rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          <RefreshCw className="h-4 w-4" />
          다시 확인
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {accountStrip(role, 'ok')}
      {children}
    </div>
  );
}
