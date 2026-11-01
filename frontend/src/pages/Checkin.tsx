import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { CheckCircle2, ChevronLeft, IdCard, Loader2, Navigation, XCircle } from 'lucide-react';
import { AccountForm } from '@/components/AccountPanel';
import { useAppStore } from '@/store/appStore';
import { startAuth } from '@/lib/auth';
import { nfcCheckin, type CheckinResult } from '@/lib/nfcCheckin';
import { PELHAM_HILLS } from '@/data/pelhamHills';

/**
 * NFC 체크인 (/checkin?t=<태그 토큰>)
 *
 * 카운터 스티커에 폰을 대면 열리는 화면입니다. 로그인되어 있으면 열리자마자
 * 체크인하고, 아니면 로그인 폼을 띄운 뒤 로그인하는 즉시 체크인합니다 - 손님이
 * 버튼을 한 번 더 누를 일이 없게.
 *
 * 체크인은 같은 화면을 다시 열어도 안전합니다(서버가 'already' 로 답함).
 */
export default function Checkin() {
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  const tag = new URLSearchParams(window.location.search).get('t') ?? '';
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 같은 계정으로 두 번 부르지 않도록. 스트릭트 모드의 이중 effect 도 여기서 걸립니다.
  const triedFor = useRef<string | null>(null);

  useEffect(() => {
    startAuth();
  }, []);

  useEffect(() => {
    if (!account || !tag || triedFor.current === account.id) return;
    triedFor.current = account.id;
    setBusy(true);
    setError('');
    nfcCheckin(tag)
      .then(setResult)
      .catch((failure) =>
        setError(failure instanceof Error ? failure.message : 'Could not check in.')
      )
      .finally(() => setBusy(false));
  }, [account, tag]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4 pb-12">
      <header className="flex items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1.5 text-sm font-medium text-primary hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" />
          Home
        </Link>
        <h1 className="min-w-0 flex-1 text-center text-lg font-bold">Check in</h1>
        <span className="w-16" />
      </header>

      {!tag ? (
        <p className="rounded-xl border border-border bg-card p-4 text-center text-sm">
          Tap your phone on the check-in tag at the pro shop counter.
        </p>
      ) : !accountReady ? (
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      ) : !account ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-sm">
            Sign in with the <b>email you booked with</b> - you&apos;ll be checked in right away.
          </p>
          <AccountForm />
        </section>
      ) : busy ? (
        <p className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Checking you in...
        </p>
      ) : error ? (
        <section className="rounded-xl border-2 border-red-500/50 bg-red-500/10 p-5 text-center">
          <XCircle className="mx-auto h-10 w-10 text-red-600" />
          <p className="mt-2 font-semibold">Not checked in</p>
          <p className="mt-1 text-sm">{error}</p>
          <p className="mt-3 text-xs text-muted-foreground">Signed in as {account.email}</p>
        </section>
      ) : result ? (
        <>
          <section className="rounded-xl border-2 border-green-600 bg-green-600/10 p-5 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
            <p className="mt-2 text-xl font-bold">
              {result.status === 'already' ? "You're already checked in" : "You're checked in"}
            </p>
            <p className="mt-1 text-3xl font-black tabular-nums">{result.booking.time}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.booking.players} player{result.booking.players === 1 ? '' : 's'}
              {result.booking.holes ? ` · ${result.booking.holes} holes` : ''}
              {result.booking.cartCount ? ` · ${result.booking.cartCount} cart${result.booking.cartCount === 1 ? '' : 's'}` : ''}
            </p>
          </section>

          <p className="flex items-start gap-2 rounded-xl border border-border bg-card p-3 text-sm">
            <IdCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {result.idOnFile
              ? 'Your ID photo is on file - the pro shop sees it on their screen.'
              : 'No ID photo on file. Please show your photo ID at the counter.'}
          </p>

          <Link
            href={`/golf/${PELHAM_HILLS.id}`}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground"
          >
            <Navigation className="h-5 w-5" />
            Open course GPS
          </Link>
        </>
      ) : null}
    </main>
  );
}
