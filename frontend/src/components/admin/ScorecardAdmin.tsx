import { useCallback, useEffect, useState } from 'react';
import { LogOut, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { startAuth, signOut } from '@/lib/auth';
import { fetchScorecards, isScorecardAdmin } from '@/lib/scorecardSync';
import { formatPlayedOn, localDate, playerTotals } from '@/lib/scorecard';
import { formatToPar } from '@/lib/roundSummary';
import { PELHAM_HILLS_TEES } from '@/data/pelhamHillsBook';
import type { Scorecard } from '@/db';
import { AccountForm } from '@/components/AccountPanel';
import { ScorecardTables, playerLabel } from '@/components/ScorecardTables';

/**
 * 스코어 조회
 *
 * 관리자 키가 아니라 회원 계정으로 봅니다. 카드가 계정별로 저장되고, 누가
 * 전체를 볼 수 있는지는 서버(RLS)가 scorecard_admins 표로 정하기 때문입니다.
 * 관리자로 지정되지 않은 계정은 자기 카드만 보입니다.
 */
export function ScorecardAdmin() {
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [day, setDay] = useState(localDate());
  const [allDays, setAllDays] = useState(false);
  const [cards, setCards] = useState<Scorecard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    startAuth();
  }, []);

  const load = useCallback(async () => {
    setCards(null);
    setError(null);
    const result = await fetchScorecards(allDays ? null : day);
    setCards(result.cards);
    setError(result.error);
  }, [allDays, day]);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    isScorecardAdmin().then((yes) => {
      if (alive) setIsAdmin(yes);
    });
    return () => {
      alive = false;
    };
  }, [account]);

  useEffect(() => {
    if (account) void load();
  }, [account, load]);

  if (!accountReady) return <p className="text-sm text-muted-foreground">불러오는 중...</p>;

  if (!account) {
    return (
      <section className="max-w-sm rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-base font-semibold">스코어 조회 로그인</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          관리자로 지정된 회원 계정으로 로그인하면 모든 회원의 스코어카드를 날짜별로 볼 수
          있습니다.
        </p>
        <AccountForm locale="ko" />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.email}</p>
          <p className="text-xs text-muted-foreground">
            {isAdmin === null
              ? '권한 확인 중...'
              : isAdmin
                ? '관리자 - 전체 회원의 카드가 보입니다'
                : '관리자로 지정되지 않은 계정 - 본인 카드만 보입니다 (0006 SQL 맨 아래 관리자 지정 참고)'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
        >
          <LogOut className="h-3.5 w-3.5" />
          로그아웃
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">날짜</span>
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value || localDate())}
            disabled={allDays}
            className="input-field py-1.5 disabled:opacity-50"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={allDays} onChange={(e) => setAllDays(e.target.checked)} />
          전체 날짜
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          <RefreshCw className="h-4 w-4" />
          새로고침
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error === 'Cloud save is not set up yet.'
            ? '서버에 scorecards 표가 아직 없습니다. 0006_scorecards.sql 을 SQL Editor 에서 실행해 주세요.'
            : error}
        </p>
      )}

      {cards === null ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : cards.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">
          {allDays ? '저장된 스코어카드가 없습니다.' : `${day} 에 저장된 스코어카드가 없습니다.`}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="스코어카드 목록">
          {cards.map((card) => {
            const open = openId === card.id;
            const tee = PELHAM_HILLS_TEES.find((t) => t.id === card.teeSet)?.label ?? card.teeSet;
            return (
              <li key={card.id} className="rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : card.id)}
                  aria-expanded={open}
                  className="w-full p-3 text-left"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{formatPlayedOn(card.playedOn)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{tee}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{card.ownerEmail ?? '(이메일 없음)'}</p>
                  <p className="mt-1 text-sm">
                    {card.players
                      .map((p, i) => {
                        const t = playerTotals(p.scores);
                        return `${playerLabel(p.name, i)} ${t.total ?? '-'}${
                          t.toPar === null ? '' : ` (${formatToPar(t.toPar)}, ${t.holesPlayed}홀)`
                        }`;
                      })
                      .join(' · ')}
                  </p>
                </button>
                {open && (
                  <div className="border-t border-border p-2">
                    <ScorecardTables card={card} readOnly />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
