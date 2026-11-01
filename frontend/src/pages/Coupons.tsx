import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { Award, BadgeCheck, Car, ChevronLeft, ChevronRight, Gift, IdCard, Loader2, RefreshCw, Share2, Ticket, Users, WifiOff, X } from 'lucide-react';
import { AccountForm } from '@/components/AccountPanel';
import { useAppStore } from '@/store/appStore';
import { startAuth } from '@/lib/auth';
import {
  CouponError,
  fetchMyCouponBook,
  setReferrer,
  ROUNDS_PER_GIFT,
  STAMP_LOGO,
  STAMPS_PER_FREE,
  type CouponBook,
  type CouponEntry,
} from '@/lib/couponBook';
import { code128Svg } from '@/lib/barcode';
import { discountLabel, fetchMyWallet, money, WalletError, type Wallet, type WalletItem } from '@/lib/wallet';
import { fetchMyProfile, membershipLabel, type MemberCard, type MyProfile } from '@/lib/membership';

const ENTRY_LABEL: Record<CouponEntry['kind'], string> = {
  stamp: 'Round stamped',
  redeem: 'Free round used',
  cart_credit: 'Free cart earned - friend played',
  cart_redeem: 'Free cart used',
  gift: `${ROUNDS_PER_GIFT}-round souvenir received`,
};

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * 지갑 (/coupons) - 맨 위에 기프트카드와 잔액, 그 아래 개인 쿠폰과 만료일(pelhamhills 0121), 맨 아래에 쿠폰북
 * (라운드 10번에 1번 무료, 회원은 제외 - 0026). 카드나 쿠폰을 누르면 바코드가 화면 가득 뜨고, 프로 샵이 계산서에서
 * 그대로 찍습니다. 다 쓴 카드·지난 쿠폰은 '지난 것'으로 접힙니다.
 *
 * 손님이 보는 화면입니다. 도장 판과 카운터에 보여 줄 코드뿐이고, 여기서 찍는
 * 버튼은 없습니다 - 도장은 티 시트에서 체크인할 때 서버가 찍습니다(0027).
 * 직원이 /fnb 에서 손으로 찍을 수도 있습니다(lib/couponBook).
 * 도장 한 칸은 클럽 로고입니다.
 */
export default function Coupons() {
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  const isOnline = useAppStore((s) => s.isOnline);
  const [book, setBook] = useState<CouponBook | null>(null);
  // 0121 을 아직 안 돌렸으면 null 로 두고 지갑 칸을 숨깁니다 - 쿠폰북은 그대로 보입니다.
  const [wallet, setWallet] = useState<Wallet | null>(null);
  // 0031 을 아직 안 돌렸으면 null 로 두고 멤버십 카드와 가입 안내를 숨깁니다.
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    startAuth();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const walletLoad = fetchMyWallet().then(setWallet, (failure) => {
      if (failure instanceof WalletError && failure.problem === 'missingTable') setWallet(null);
    });
    const profileLoad = fetchMyProfile().then(setProfile, () => setProfile(null));
    try {
      setBook(await fetchMyCouponBook());
      await Promise.all([walletLoad, profileLoad]);
    } catch (failure) {
      setError(
        failure instanceof CouponError && failure.problem === 'network'
          ? 'No connection - try again when you have signal.'
          : 'Could not open your coupon book. Try again in a moment.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account) void load();
    else {
      setBook(null);
      setWallet(null);
      setProfile(null);
    }
  }, [account, load]);

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
        <h1 className="min-w-0 flex-1 text-center text-lg font-bold">My wallet</h1>
        <button
          type="button"
          onClick={() => void load()}
          disabled={!account || loading}
          aria-label="Refresh"
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <p className="text-center text-sm text-muted-foreground">
        Gift cards and coupons from Pelham Hills show up here - tap one to show its barcode at
        the pro shop. Play {STAMPS_PER_FREE} rounds, get the next one <b className="text-foreground">free</b>.
        Every {ROUNDS_PER_GIFT} rounds, pick up a <b className="text-foreground">Pelham Hills souvenir</b>.
        You get a stamp automatically when you check in at the pro shop. Book with this
        account's email, or link your QR under <Link href="/me" className="underline">My QR</Link>,
        so we know it's you.
        <br />
        <span className="text-xs">Members play on their membership and don't collect stamps.</span>
      </p>

      {!accountReady ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      ) : !account ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-sm">Sign in to keep your stamps in your account.</p>
          <AccountForm />
          <p className="mt-3 text-center text-xs text-muted-foreground">
            New here?{' '}
            <Link href="/join" className="underline">
              Sign up as a member or guest
            </Link>
          </p>
        </section>
      ) : !book ? (
        error ? (
          <p role="alert" className="flex items-center justify-center gap-2 text-sm text-red-700 dark:text-red-300">
            {!isOnline && <WifiOff className="h-4 w-4" />}
            {error}
          </p>
        ) : (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        )
      ) : (
        <>
          {profile?.card && <MembershipCard card={profile.card} />}
          {profile && !profile.card && (!profile.kind || (profile.kind === 'member' && !profile.isMember)) && (
            <Link
              href="/join"
              className="flex items-center gap-3 rounded-xl border-2 border-primary bg-card p-4"
            >
              <IdCard className="h-8 w-8 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block font-bold">
                  {profile.kind === 'member' ? 'Add your new membership card' : 'Finish signing up'}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {profile.kind === 'member'
                    ? 'Your last card has ended.'
                    : profile.isMember
                      ? 'Add your membership card to this phone.'
                      : 'Add a membership card, or tell us your name for the coupon book.'}
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Link>
          )}
          {wallet && <WalletCards wallet={wallet} />}
          <CouponCard book={book} onChange={setBook} />
        </>
      )}
    </main>
  );
}

/** 멤버십 카드 (0031). 완납한 회원권이면 눌러서 바코드를 띄웁니다 - 계산서 베이 줄에서 찍습니다(pelhamhills 0151). */
function MembershipCard({ card }: { card: MemberCard }) {
  const [open, setOpen] = useState(false);
  const code = card.memberCode;
  const face = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-90">
        <IdCard className="h-4 w-4" />
        Membership card · {card.season}
      </span>
      <span className="text-2xl font-black">{card.memberName}</span>
      <span className="text-xs opacity-90">
        {membershipLabel(card.membershipType)}
        {card.memberNumber ? ` · Member #${card.memberNumber}` : ''}
        {card.expiresOn ? ` · Until ${dayOf(card.expiresOn)}` : ''}
      </span>
      {card.simHoursLeft > 0 && card.simExpiresOn && (
        <span className="text-xs opacity-90">
          {card.simHoursLeft} free simulator hour{card.simHoursLeft === 1 ? '' : 's'} left · Use by{' '}
          {dayOf(card.simExpiresOn)}
        </span>
      )}
      <span className="mt-1 font-mono text-[11px] opacity-80">
        {code ? `${code} · Tap to show barcode` : 'Your barcode comes once your membership is paid in full.'}
      </span>
    </>
  );
  const look = 'flex w-full flex-col gap-0.5 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 p-4 text-left text-white shadow-sm';

  return (
    <>
      {code ? (
        <button type="button" onClick={() => setOpen(true)} className={look}>
          {face}
        </button>
      ) : (
        <section aria-label="Membership card" className={look}>
          {face}
        </section>
      )}
      {open && code && (
        <BarcodeSheet
          title={`Membership card · ${card.memberName}`}
          barcode={code}
          note="Show this at the pro shop to use your free simulator hours."
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CouponCard({ book, onChange }: { book: CouponBook; onChange: (next: CouponBook) => void }) {
  const toGo = STAMPS_PER_FREE - book.onCard;

  return (
    <>
      <section className="rounded-xl border border-border bg-card p-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Your code
        </p>
        <p className="mt-1 font-mono text-4xl font-black tracking-[0.3em]">{book.code ?? '------'}</p>
        <p className="mt-1 text-xs text-muted-foreground">Show this at the pro shop</p>
      </section>

      {book.cartsLeft > 0 && (
        <section className="flex items-center gap-3 rounded-xl border-2 border-sky-600 bg-sky-600/10 p-4">
          <Car className="h-8 w-8 shrink-0 text-sky-700 dark:text-sky-300" />
          <div>
            <p className="font-bold text-sky-800 dark:text-sky-200">
              {book.cartsLeft} free cart{book.cartsLeft === 1 ? '' : 's'} saved
            </p>
            <p className="text-xs text-muted-foreground">
              Thanks for bringing friends! Show your code at the pro shop next time.
            </p>
          </div>
        </section>
      )}

      {book.freeLeft > 0 && (
        <section className="flex items-center gap-3 rounded-xl border-2 border-green-600 bg-green-600/10 p-4">
          <Gift className="h-8 w-8 shrink-0 text-green-700 dark:text-green-300" />
          <div>
            <p className="font-bold text-green-800 dark:text-green-200">
              {book.freeLeft} free round{book.freeLeft === 1 ? '' : 's'} ready
            </p>
            <p className="text-xs text-muted-foreground">Tell the pro shop when you check in.</p>
          </div>
        </section>
      )}

      {book.giftDue > 0 && (
        <section className="flex items-center gap-3 rounded-xl border-2 border-pink-600 bg-pink-600/10 p-4">
          <Award className="h-8 w-8 shrink-0 text-pink-700 dark:text-pink-300" />
          <div>
            <p className="font-bold text-pink-800 dark:text-pink-200">
              {book.rounds} rounds - a souvenir is waiting for you!
            </p>
            <p className="text-xs text-muted-foreground">Pick it up at the pro shop - show your code.</p>
          </div>
        </section>
      )}

      {book.isMember ? (
        <section className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
          <BadgeCheck className="h-8 w-8 shrink-0 text-primary" />
          <div>
            <p className="font-bold">You're a Pelham Hills member</p>
            <p className="text-xs text-muted-foreground">
              Your rounds are on your membership, so the stamp card is for public players.
              {book.freeLeft > 0 ? ' Free rounds you already earned are still yours.' : ''}
            </p>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-border bg-card p-4">
          <ol className="grid grid-cols-5 gap-3" aria-label={`${book.onCard} of ${STAMPS_PER_FREE} stamps`}>
            {Array.from({ length: STAMPS_PER_FREE }, (_, i) => {
              const filled = i < book.onCard;
              const last = i === STAMPS_PER_FREE - 1;
              return (
                <li
                  key={i}
                  className={`grid aspect-square place-items-center overflow-hidden rounded-full border-2 ${
                    filled
                      ? 'border-transparent bg-white'
                      : last
                        ? 'border-dashed border-green-600 text-green-700 dark:text-green-300'
                        : 'border-dashed border-border text-muted-foreground'
                  }`}
                >
                  {filled ? (
                    // 고무도장처럼 칸마다 조금씩 기울입니다.
                    <img
                      src={STAMP_LOGO}
                      alt="Pelham Hills stamp"
                      draggable={false}
                      className="h-full w-full object-contain"
                      style={{ transform: `rotate(${((i * 37) % 25) - 12}deg)` }}
                    />
                  ) : last ? (
                    <Gift className="h-5 w-5" />
                  ) : (
                    <span className="text-sm tabular-nums">{i + 1}</span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-center text-sm">
            {book.onCard === 0 && book.stamps === 0
              ? 'No stamps yet - your first round starts the card.'
              : `${toGo} more round${toGo === 1 ? '' : 's'} to your next free round.`}
          </p>
          {book.stampedToday && (
            <p className="mt-1 text-center text-xs text-primary">Stamped today ✓</p>
          )}
          <div className="mt-4 border-t border-border pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 font-medium">
                <Award className="h-3.5 w-3.5 text-pink-600" />
                {ROUNDS_PER_GIFT}-round souvenir
              </span>
              <span className="tabular-nums text-muted-foreground">
                {book.rounds % ROUNDS_PER_GIFT}/{ROUNDS_PER_GIFT}
              </span>
            </div>
            <div
              className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={ROUNDS_PER_GIFT}
              aria-valuenow={book.rounds % ROUNDS_PER_GIFT}
            >
              <div
                className="h-full rounded-full bg-pink-600"
                style={{ width: `${((book.rounds % ROUNDS_PER_GIFT) / ROUNDS_PER_GIFT) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              {book.roundsToGift} more round{book.roundsToGift === 1 ? '' : 's'} to your next souvenir
            </p>
          </div>
        </section>
      )}

      {book.canRefer && <InviteFriends book={book} onChange={onChange} />}

      {book.history.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">History</h2>
          <ul className="divide-y divide-border text-sm">
            {book.history.map((entry, i) => (
              <li key={i} className="flex items-center justify-between py-1.5">
                <span>{ENTRY_LABEL[entry.kind] ?? entry.kind}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{dateOf(entry.at)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {book.rounds} rounds played · {book.redeemed} free used
          </p>
        </section>
      )}
    </>
  );
}

/**
 * 친구 소개 (0025). 내 코드를 보내고, 친구가 첫 라운드 도장을 받으면 내게
 * 카트 무료 1회가 쌓입니다. 아직 첫 라운드 전이면 나를 소개한 친구의 코드를
 * 넣는 칸도 보입니다.
 */
function InviteFriends({ book, onChange }: { book: CouponBook; onChange: (next: CouponBook) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  const invite = `Play Pelham Hills with me! Get the Pelham Hills GPS app, open Coupon book and enter my code ${book.code} before your first round.`;

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text: invite, url: `${window.location.origin}/coupons` });
      } else {
        await navigator.clipboard.writeText(`${invite} ${window.location.origin}/coupons`);
        setMessage({ tone: 'info', text: 'Invite copied - paste it to your friend.' });
      }
    } catch {
      // 공유 창을 닫은 것. 할 일 없음.
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      onChange(await setReferrer(code));
      setMessage({ tone: 'info', text: 'Thanks! Your friend gets a free cart after your first round.' });
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : 'Could not save the code.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4 text-primary" />
        Invite a friend, ride free
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Send your code to a friend. When they play their first round, you get a{' '}
        <b className="text-foreground">free cart</b> for your next visit.
      </p>
      <button
        type="button"
        onClick={() => void share()}
        disabled={!book.code}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        <Share2 className="h-4 w-4" />
        Share my code {book.code}
      </button>
      {(book.friendsRewarded > 0 || book.friendsPending > 0) && (
        <p className="mt-2 text-xs text-muted-foreground">
          {book.friendsRewarded} friend{book.friendsRewarded === 1 ? '' : 's'} played
          {book.friendsPending > 0 ? ` · ${book.friendsPending} yet to play` : ''}
        </p>
      )}

      {book.canEnterReferral && (
        <form onSubmit={submit} className="mt-4 border-t border-border pt-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Invited by a friend? Enter their code before your first round.
          </label>
          <div className="mt-1 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={8}
              className="input-field min-w-0 flex-1 py-1.5 font-mono uppercase tracking-widest"
            />
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="rounded-lg bg-muted px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {busy ? '...' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`mt-2 text-xs ${message.tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-primary'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

const dayOf = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const isLive = (item: WalletItem) => item.state === 'active';

/** 기프트카드 → 쿠폰. 쓸 수 있는 것만 위에, 다 쓴 것·지난 것은 접어 둡니다. */
function WalletCards({ wallet }: { wallet: Wallet }) {
  const [shown, setShown] = useState<WalletItem | null>(null);
  const live = [...wallet.giftCards.filter(isLive), ...wallet.coupons.filter(isLive)];
  const past = [...wallet.giftCards, ...wallet.coupons].filter((item) => !isLive(item));

  if (live.length === 0 && past.length === 0) return null;
  return (
    <>
      {live.length > 0 && (
        <section aria-label="Gift cards and coupons" className="flex flex-col gap-3">
          {live.map((item) => (
            <WalletCard item={item} key={item.code} onOpen={() => setShown(item)} />
          ))}
        </section>
      )}
      {past.length > 0 && (
        <details className="rounded-xl border border-border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Past ({past.length})</summary>
          <ul className="mt-2 divide-y divide-border">
            {past.map((item) => (
              <li key={item.code} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">
                  {item.type === 'gift' ? `Gift card ${money(item.amount)}` : item.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {{ spent: 'Spent', used: 'Used', expired: 'Expired', void: 'Cancelled', active: '' }[item.state]}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {shown && (
        <BarcodeSheet
          title={
            shown.type === 'gift'
              ? `Gift card · ${money(shown.balance)} left`
              : `${shown.name} · ${discountLabel(shown.discountKind, shown.value)}`
          }
          barcode={shown.barcode}
          note={
            shown.type === 'gift'
              ? 'Anyone with this barcode can spend the card - keep it to yourself.'
              : undefined
          }
          onClose={() => setShown(null)}
        />
      )}
    </>
  );
}

function WalletCard({ item, onOpen }: { item: WalletItem; onOpen: () => void }) {
  const gift = item.type === 'gift';
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-col gap-0.5 rounded-xl p-4 text-left text-white shadow-sm ${
        gift ? 'bg-gradient-to-br from-green-700 to-green-900' : 'bg-gradient-to-br from-amber-600 to-amber-800'
      }`}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-90">
        {gift ? <Gift className="h-4 w-4" /> : <Ticket className="h-4 w-4" />}
        {gift ? 'Gift card' : 'Coupon · green fee'}
      </span>
      <span className="text-2xl font-black tabular-nums">
        {gift ? money(item.balance) : discountLabel(item.discountKind, item.value)}
      </span>
      <span className="text-xs opacity-90">
        {gift
          ? `${item.balance < item.amount ? `of ${money(item.amount)} · ` : ''}No expiry`
          : `${item.name} · Use by ${item.expiresOn ? dayOf(item.expiresOn) : '-'}`}
      </span>
      <span className="mt-1 font-mono text-[11px] opacity-80">{item.barcode} · Tap to show barcode</span>
    </button>
  );
}

/** 프로 샵 스캐너용 - 흰 바탕에 바코드를 화면 폭 가득. */
function BarcodeSheet({
  title,
  barcode,
  note,
  onClose,
}: {
  title: string;
  barcode: string;
  note?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Barcode ${barcode}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-6 text-black"
      onClick={onClose}
    >
      <p className="text-lg font-bold">{title}</p>
      <div
        className="h-32 w-full max-w-md [&>svg]:h-full [&>svg]:w-full"
        // 막대만 그린 SVG 문자열(lib/barcode). 바코드 값은 서버가 만든 GIFT-/CPN-/MEM- 코드뿐입니다.
        dangerouslySetInnerHTML={{ __html: code128Svg(barcode) }}
      />
      <p className="font-mono text-xl tracking-widest">{barcode}</p>
      <p className="text-center text-sm text-gray-600">
        Show this at the pro shop. Turn your screen brightness up if the scanner misses.
        {note ? ` ${note}` : ''}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium"
      >
        <X className="h-4 w-4" />
        Close
      </button>
    </div>
  );
}
