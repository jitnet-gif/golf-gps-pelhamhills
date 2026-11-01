import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { BadgeCheck, ChevronLeft, ChevronRight, IdCard, Loader2, Ticket } from 'lucide-react';
import { AccountForm } from '@/components/AccountPanel';
import { useAppStore } from '@/store/appStore';
import { startAuth } from '@/lib/auth';
import { STAMPS_PER_FREE } from '@/lib/couponBook';
import {
  fetchMyProfile,
  joinAsGuest,
  joinAsMember,
  type JoinKind,
  type MyProfile,
} from '@/lib/membership';

/**
 * 가입 (/join)
 *
 * 회원/비회원 고르기 -> 계정(이미 로그인했으면 건너뜀) -> 회원은 카드 등록, 비회원은 이름.
 * 끝나면 지갑(/coupons)으로 갑니다. 카드와 쿠폰북이 거기 있습니다.
 *
 * 비회원으로 가입한 뒤 회원이 되면 여기로 다시 와서 카드를 등록합니다 - 같은 프로필이 바뀝니다.
 */
export default function Join() {
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  const [, navigate] = useLocation();
  const [chosen, setChosen] = useState<JoinKind | null>(null);
  // undefined = 아직 묻는 중.
  const [profile, setProfile] = useState<MyProfile | null | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  // 같은 계정으로 두 번 부르지 않도록. 스트릭트 모드의 이중 effect 도 여기서 걸립니다.
  const triedFor = useRef<string | null>(null);

  useEffect(() => {
    startAuth();
  }, []);

  useEffect(() => {
    if (!account) {
      triedFor.current = null;
      setProfile(null);
      return;
    }
    if (triedFor.current === account.id) return;
    triedFor.current = account.id;
    setProfile(undefined);
    setLoadError('');
    fetchMyProfile()
      .then(setProfile)
      .catch((failure) => {
        setProfile(null);
        setLoadError(failure instanceof Error ? failure.message : 'Could not open sign-up.');
      });
  }, [account]);

  const done = () => navigate('/coupons');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4 pb-12">
      <header className="flex items-center gap-2">
        {chosen ? (
          <button
            type="button"
            onClick={() => setChosen(null)}
            className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1.5 text-sm font-medium text-primary hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        ) : (
          <Link
            href="/"
            className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1.5 text-sm font-medium text-primary hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
            Home
          </Link>
        )}
        <h1 className="min-w-0 flex-1 text-center text-lg font-bold">Sign up</h1>
        <span className="w-16" />
      </header>

      {loadError && (
        <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm">
          {loadError}
        </p>
      )}

      {!accountReady || profile === undefined ? (
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      ) : chosen && !account ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-sm">
            Sign in or create an account first. Your{' '}
            {chosen === 'member' ? 'membership card' : 'coupon book'} is kept in it.
          </p>
          <AccountForm />
        </section>
      ) : chosen === 'member' ? (
        <MemberForm onDone={done} />
      ) : chosen === 'guest' ? (
        <GuestForm onDone={done} />
      ) : profile?.kind ? (
        <Joined profile={profile} onRegisterCard={() => setChosen('member')} />
      ) : (
        <Choice isMember={profile?.isMember ?? false} onChoose={setChosen} />
      )}
    </main>
  );
}

const choice =
  'flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card p-4 text-left transition-colors hover:border-primary/50';

function Choice({ isMember, onChoose }: { isMember: boolean; onChoose: (kind: JoinKind) => void }) {
  return (
    <>
      <p className="text-center text-sm text-muted-foreground">
        {isMember ? "We found your membership - add your card to this phone." : 'Are you a Pelham Hills member?'}
      </p>
      <button type="button" onClick={() => onChoose('member')} className={choice}>
        <IdCard className="h-8 w-8 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">I'm a member</span>
          <span className="block text-sm text-muted-foreground">
            Add your membership card to this phone
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </button>
      {!isMember && (
        <button type="button" onClick={() => onChoose('guest')} className={choice}>
          <Ticket className="h-8 w-8 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">I'm not a member</span>
            <span className="block text-sm text-muted-foreground">
              Get a coupon book - play {STAMPS_PER_FREE} rounds, get 1 free
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </button>
      )}
    </>
  );
}

function Joined({ profile, onRegisterCard }: { profile: MyProfile; onRegisterCard: () => void }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 text-center">
      <BadgeCheck className="mx-auto h-8 w-8 text-primary" />
      <p className="mt-2 font-bold">You're signed up{profile.name ? `, ${profile.name}` : ''}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {profile.kind === 'member' ? 'Your membership card' : 'Your coupon book'} is in your wallet.
      </p>
      <Link
        href="/coupons"
        className="mt-3 block rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
      >
        Open my wallet
      </Link>
      {!profile.card && (
        <button
          type="button"
          onClick={onRegisterCard}
          className="mt-2 w-full rounded-lg bg-muted px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          {profile.kind === 'member' ? 'Add my new membership card' : 'I became a member - add my card'}
        </button>
      )}
    </section>
  );
}

function MemberForm({ onDone }: { onDone: () => void }) {
  const [card, setCard] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!card.trim()) return;
    setBusy(true);
    setError('');
    try {
      await joinAsMember(card, phone);
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not add your card.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <IdCard className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold">Add your membership card</p>
          <p className="text-xs text-muted-foreground">
            Your card code is in the email or text from the club. Enter the phone the club has
            for you. With a card code, this account's email can match instead.
          </p>
        </div>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Card code or member number</span>
        <input
          type="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="MEM-2027-A1B2C3"
          value={card}
          onChange={(e) => setCard(e.target.value)}
          className="input-field mt-0.5 w-full py-1.5 font-mono uppercase"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Phone</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input-field mt-0.5 w-full py-1.5"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !card.trim()}
        className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? 'Please wait...' : 'Add my card'}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        Got a QR code from the pro shop?{' '}
        <Link href="/me" className="underline">
          Use it instead
        </Link>
      </p>
    </form>
  );
}

function GuestForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await joinAsGuest(name, phone);
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not sign you up.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <Ticket className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold">Get your coupon book</p>
          <p className="text-xs text-muted-foreground">
            Book your tee times with this account's email and stamps add up on their own.
          </p>
        </div>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Full name</span>
        <input
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input-field mt-0.5 w-full py-1.5"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Phone (optional)</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input-field mt-0.5 w-full py-1.5"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? 'Please wait...' : 'Get my coupon book'}
      </button>
    </form>
  );
}
