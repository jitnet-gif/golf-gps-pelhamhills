import React, { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { LogOut, QrCode, UserRound } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { signIn, signOut, signUp, type AuthProblem } from '@/lib/auth';

type Locale = 'en' | 'ko';

const TEXT = {
  en: {
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signUp: 'Create account',
    wait: 'Please wait...',
    hint: 'New here? Enter an email and a password of 6+ characters, then Create account.',
    confirm: 'Account created. Confirm it from the email that was sent, then sign in.',
    problems: {
      invalid: 'Wrong email or password.',
      exists: 'That email already has an account - sign in instead.',
      weak: 'Use a password of at least 6 characters.',
      badEmail: 'That email address does not look right.',
      unconfirmed: 'This account has not been confirmed from its email yet.',
      rate: 'Too many tries - wait a minute and try again.',
      network: 'No connection - try again when you have signal.',
      unavailable: 'Accounts are not available in this build.',
      other: 'Could not sign in.',
    } satisfies Record<AuthProblem, string>,
  },
  ko: {
    email: '이메일',
    password: '비밀번호',
    signIn: '로그인',
    signUp: '가입하기',
    wait: '잠시만요...',
    hint: '처음이면 이메일과 6자 이상 비밀번호를 넣고 가입하기를 누르세요.',
    confirm: '가입되었습니다. 발송된 메일에서 확인한 뒤 로그인하세요.',
    problems: {
      invalid: '이메일 또는 비밀번호가 맞지 않습니다.',
      exists: '이미 가입된 이메일입니다. 로그인해 주세요.',
      weak: '비밀번호는 6자 이상이어야 합니다.',
      badEmail: '이메일 주소를 확인해 주세요.',
      unconfirmed: '아직 이메일 확인이 안 된 계정입니다.',
      rate: '시도가 너무 많습니다. 잠시 후 다시 해 주세요.',
      network: '인터넷 연결이 없습니다.',
      unavailable: '이 빌드에는 계정 기능이 없습니다.',
      other: '로그인하지 못했습니다.',
    } satisfies Record<AuthProblem, string>,
  },
};

/**
 * Email and password, one form for both signing in and signing up - a player
 * on the 1st tee should not have to find a second screen to make an account.
 */
export const AccountForm: React.FC<{ locale?: Locale; className?: string }> = ({
  locale = 'en',
  className = '',
}) => {
  const t = TEXT[locale];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  const run = async (mode: 'in' | 'up') => {
    const address = email.trim();
    if (!address || !password) return;
    setBusy(true);
    setMessage(null);
    const result = mode === 'in' ? await signIn(address, password) : await signUp(address, password);
    setBusy(false);
    if (!result.ok) {
      const base = t.problems[result.problem];
      setMessage({
        tone: 'error',
        text: result.problem === 'other' && result.detail ? `${base} (${result.detail})` : base,
      });
    } else if (result.needsConfirmation) {
      setMessage({ tone: 'info', text: t.confirm });
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run('in');
  };

  return (
    <form onSubmit={submit} className={`space-y-2 ${className}`} aria-label={t.signIn}>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">{t.email}</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input-field mt-0.5 w-full py-1.5"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">{t.password}</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-field mt-0.5 w-full py-1.5"
        />
      </label>

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-xs ${message.tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-primary'}`}
        >
          {message.text}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !email.trim() || !password}
          className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? t.wait : t.signIn}
        </button>
        <button
          type="button"
          onClick={() => void run('up')}
          disabled={busy || !email.trim() || !password}
          className="flex-1 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {t.signUp}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t.hint}</p>
    </form>
  );
};

/**
 * Above the card: who the scores are being saved for, and whether they have
 * reached the server - or, signed out, the offer to keep them in an account.
 */
export const AccountBar: React.FC<{ className?: string }> = ({ className = '' }) => {
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const syncPending = useAppStore((s) => s.syncPending);
  const syncError = useAppStore((s) => s.syncError);
  const [open, setOpen] = useState(false);

  if (!accountReady) return null;

  if (!account) {
    return (
      <section
        aria-label="Account"
        className={`rounded-lg border border-border bg-card p-3 ${className}`}
      >
        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            Scores are kept on this phone. Sign in to save them to your account and see
            them by date on any phone.
          </p>
          {!open && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              Sign in
            </button>
          )}
        </div>
        {open && <AccountForm className="mt-3" />}
      </section>
    );
  }

  const state =
    syncStatus === 'syncing'
      ? 'Saving...'
      : syncStatus === 'error'
        ? `Not saved: ${syncError ?? 'sync failed'}`
        : syncPending > 0
          ? `${syncPending} card${syncPending === 1 ? '' : 's'} waiting to upload`
          : 'Saved to your account';

  return (
    <section
      aria-label="Account"
      className={`flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 ${className}`}
    >
      <UserRound className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{account.email ?? 'Signed in'}</p>
        <p
          className={`truncate text-[11px] ${syncStatus === 'error' ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'}`}
        >
          {state}
        </p>
      </div>
      <Link
        href="/me"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2 py-1.5 text-xs font-medium hover:bg-accent"
      >
        <QrCode className="h-3.5 w-3.5" />
        My QR
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2 py-1.5 text-xs font-medium hover:bg-accent"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    </section>
  );
};
