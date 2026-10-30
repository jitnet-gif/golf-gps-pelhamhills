import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { BadgeCheck, Gift, Loader2, RefreshCw, Search, Tag, Ticket } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { startAuth } from '@/lib/auth';
import { AccountForm } from '@/components/AccountPanel';
import {
  discountLabel,
  fetchCampaignCoupons,
  fetchIssued,
  findGuests,
  issueToGuest,
  money,
  saveCampaignCoupon,
  voidIssued,
  walletAccess,
  type CampaignCoupon,
  type GuestAccount,
  type IssuedItem,
  type IssueRequest,
} from '@/lib/wallet';

type Kind = 'gift' | 'coupon' | 'campaign';

const STATE_LABEL: Record<string, string> = {
  active: '사용 가능',
  spent: '다 씀',
  used: '사용함',
  expired: '만료',
  void: '무효',
  paused: '멈춤',
  scheduled: '예정',
  used_up: '다 씀',
};

const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : '처리하지 못했습니다.');

/** 달러 입력 → 센트. 잘못되면 null. */
const toCents = (text: string): number | null => {
  const value = Number(text.replace(/[$,\s]/g, ''));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
};

/**
 * 쿠폰·기프트카드 탭 (pelhamhills 0121)
 *
 * 매니저가 손님 앱 계정으로 기프트카드·개인 쿠폰을 보내고, 공용 캠페인 쿠폰(PROMO-)을 만듭니다. 장부는 프로 샵과
 * 하나라 여기서 만든 카드도 프로 샵 계산서에서 그대로 찍힙니다. 보이는 사람은 프로 샵에서 기프트카드를 발행할 수
 * 있는 매니저와 같습니다(proshop@ 공용 계정 제외) - 탭 자체를 서버(gps_wallet_access)가 정합니다.
 *
 * 돈이 나가는 일이라 발행은 한 번 더 확인합니다. 사유는 서버가 필수로 받습니다.
 */
export function WalletAdmin() {
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    startAuth();
  }, []);

  useEffect(() => {
    let alive = true;
    setAllowed(null);
    if (!account) return;
    walletAccess().then((yes) => {
      if (alive) setAllowed(yes);
    });
    return () => {
      alive = false;
    };
  }, [account]);

  if (!accountReady) return <p className="text-sm text-muted-foreground">불러오는 중...</p>;
  if (!account) {
    return (
      <section className="max-w-sm rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-base font-semibold">매니저 로그인</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          프로 샵에서 기프트카드를 발행하는 매니저 계정(같은 이메일·비밀번호)으로 로그인하세요.
        </p>
        <AccountForm />
      </section>
    );
  }
  if (allowed === null) return <p className="text-sm text-muted-foreground">확인 중…</p>;
  if (!allowed) {
    return (
      <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        이 계정은 기프트카드·쿠폰을 발행할 수 없습니다. 프로 샵에서 기프트카드를 발행하는 매니저 계정만 쓸 수 있습니다
        (공용 proshop 계정 제외). 서버에 0121 이 아직 없을 수도 있습니다.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <IssuePanel onIssued={() => setRefresh((n) => n + 1)} />
      <IssuedList refresh={refresh} />
      <CampaignList refresh={refresh} />
    </div>
  );
}

function Card({ title, icon, actions, children }: { title: string; icon: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="flex-1 text-base font-semibold">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

function IssuePanel({ onIssued }: { onIssued: () => void }) {
  const [kind, setKind] = useState<Kind>('gift');
  const [guest, setGuest] = useState<GuestAccount | null>(null);
  // 기프트카드
  const [amount, setAmount] = useState('25');
  const [giftKind, setGiftKind] = useState<'complimentary' | 'sold'>('complimentary');
  // 개인 쿠폰
  const [discountKind, setDiscountKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('20');
  const [days, setDays] = useState('60');
  const [couponName, setCouponName] = useState('');
  // 캠페인 쿠폰
  const [code, setCode] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [perPlayer, setPerPlayer] = useState(false);
  const [expires, setExpires] = useState('');
  const [limit, setLimit] = useState('');

  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);

  const cents = toCents(kind === 'gift' ? amount : value);
  const discountValue = discountKind === 'percent' ? Math.round(Number(value)) : cents;
  const needsGuest = kind !== 'campaign';
  const blockedMember = kind === 'coupon' && guest?.isMember === true;

  const summary =
    kind === 'gift'
      ? `${guest?.name ?? guest?.email}에게 ${cents ? money(cents) : '?'} 기프트카드(${giftKind === 'sold' ? '판매' : '무료'})`
      : kind === 'coupon'
        ? `${guest?.name ?? guest?.email}에게 개인 쿠폰 ${discountValue ? discountLabel(discountKind, discountValue) : '?'}, ${days}일`
        : `캠페인 쿠폰 PROMO-${code.toUpperCase() || '?'} · ${discountValue ? discountLabel(discountKind, discountValue) : '?'}`;

  const ready =
    (!needsGuest || guest !== null) &&
    !blockedMember &&
    (kind === 'campaign' ? /^[A-Za-z0-9]{3,16}$/.test(code) && campaignName.trim() !== '' : note.trim() !== '') &&
    (kind === 'gift' ? cents !== null : discountValue !== null && discountValue > 0 && !(discountKind === 'percent' && discountValue > 100));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (kind === 'campaign') {
        const saved = await saveCampaignCoupon({
          code: code.toUpperCase(),
          name: campaignName.trim(),
          kind: discountKind,
          value: discountValue as number,
          per_player: discountKind === 'amount' && perPlayer,
          expires_on: expires || null,
          usage_limit: limit ? Number(limit) : null,
        });
        setMessage({ tone: 'ok', text: `${saved.barcode} 를 만들었습니다. 문자·배너로 보낼 수 있습니다.` });
        setCode('');
        setCampaignName('');
      } else {
        const request: IssueRequest =
          kind === 'gift'
            ? { type: 'gift', ownerId: guest!.ownerId, amount: cents as number, kind: giftKind, note: note.trim() }
            : {
                type: 'coupon',
                ownerId: guest!.ownerId,
                name: couponName.trim(),
                discountKind,
                value: discountValue as number,
                days: Number(days) || 60,
                note: note.trim(),
              };
        const issued = await issueToGuest(request);
        setMessage({ tone: 'ok', text: `${issued.barcode} 발행 — ${guest!.email} 앱의 지갑에 바로 보입니다.` });
        setNote('');
      }
      onIssued();
    } catch (failure) {
      setMessage({ tone: 'error', text: errorText(failure) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Card icon={<Gift className="h-4 w-4 text-primary" />} title="발행">
      <form className="flex flex-col gap-3 text-sm" onSubmit={submit}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="종류">
          {(
            [
              ['gift', '기프트카드'],
              ['coupon', '개인 쿠폰'],
              ['campaign', '캠페인 쿠폰'],
            ] as [Kind, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={kind === id}
              onClick={() => {
                setKind(id);
                setConfirming(false);
              }}
              className={`rounded-md px-3 py-1.5 font-medium ${
                kind === id ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {kind === 'gift'
            ? '금액만큼 어느 계산서에서든 결제에 씁니다. 만료 없음, 한 장 $5,000 까지. 회원도 받을 수 있습니다.'
            : kind === 'coupon'
              ? '손님 한 명에게 묶인 한 번짜리 그린피 할인(% 는 한 사람 몫). 만료일이 있습니다. 회원은 받지 않습니다.'
              : '여러 사람이 같이 쓰는 코드(PROMO-). 프로 샵 Promotions 와 같은 목록입니다.'}
        </p>

        {needsGuest && <GuestPicker guest={guest} onPick={(next) => { setGuest(next); setConfirming(false); }} />}

        {kind === 'gift' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">금액 ($)</span>
              <input id="wallet-amount" className="input-field" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setConfirming(false); }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">종류</span>
              <select id="wallet-gift-kind" className="input-field" value={giftKind} onChange={(e) => { setGiftKind(e.target.value as 'sold' | 'complimentary'); setConfirming(false); }}>
                <option value="complimentary">무료 (보상·선물)</option>
                <option value="sold">판매 (돈 받음)</option>
              </select>
            </label>
          </div>
        )}

        {kind !== 'gift' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">할인</span>
              <select id="wallet-discount-kind" className="input-field" value={discountKind} onChange={(e) => { setDiscountKind(e.target.value as 'percent' | 'amount'); setConfirming(false); }}>
                <option value="percent">% 할인</option>
                <option value="amount">$ 할인</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{discountKind === 'percent' ? '퍼센트' : '금액 ($)'}</span>
              <input id="wallet-value" className="input-field" inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setConfirming(false); }} />
            </label>
          </div>
        )}

        {kind === 'coupon' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">쓸 수 있는 날 수</span>
              <input id="wallet-days" className="input-field" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">손님에게 보일 이름 (선택)</span>
              <input id="wallet-coupon-name" className="input-field" maxLength={60} placeholder="Rain check — 9 holes" value={couponName} onChange={(e) => setCouponName(e.target.value)} />
            </label>
          </div>
        )}

        {kind === 'campaign' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">코드 (영문·숫자 3–16자)</span>
              <input id="wallet-code" className="input-field font-mono uppercase" maxLength={16} placeholder="WKPM" value={code} onChange={(e) => { setCode(e.target.value.replace(/\s/g, '')); setConfirming(false); }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">이름</span>
              <input id="wallet-campaign-name" className="input-field" maxLength={60} placeholder="Weekday afternoon" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">만료일 (선택)</span>
              <input id="wallet-expires" className="input-field" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">사용 한도 (선택)</span>
              <input id="wallet-limit" className="input-field" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} />
            </label>
            {discountKind === 'amount' && (
              <label className="col-span-2 flex items-center gap-2">
                <input id="wallet-per-player" type="checkbox" checked={perPlayer} onChange={(e) => setPerPlayer(e.target.checked)} />
                <span>한 사람마다 할인 (끄면 계산서당 한 번)</span>
              </label>
            )}
          </div>
        )}

        {kind !== 'campaign' && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">사유 (필수 — 누가 어떻게 냈는지, 또는 무엇 때문인지)</span>
            <input id="wallet-note" className="input-field" maxLength={200} placeholder="10/25 전화 불만 — 카트 고장" value={note} onChange={(e) => { setNote(e.target.value); setConfirming(false); }} />
          </label>
        )}

        {blockedMember && (
          <p className="text-xs text-amber-700 dark:text-amber-300">회원은 회원권으로 쳐서 할인 쿠폰을 받지 않습니다. 기프트카드는 됩니다.</p>
        )}

        {confirming && (
          <p role="status" className="rounded-md border-2 border-amber-500 bg-amber-500/10 p-2 text-sm font-medium">
            확인: {summary}. 발행하면 손님 앱에 바로 보이고, 지우지 않고 무효로만 할 수 있습니다.
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!ready || busy}
            className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? '발행 중…' : confirming ? '네, 발행' : kind === 'campaign' ? '쿠폰 만들기…' : '발행하고 손님 앱으로 보내기…'}
          </button>
          {confirming && (
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-2">
              취소
            </button>
          )}
        </div>
        {message && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-primary'}>
            {message.text}
          </p>
        )}
      </form>
    </Card>
  );
}

function GuestPicker({ guest, onPick }: { guest: GuestAccount | null; onPick: (guest: GuestAccount | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GuestAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const search = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    setError('');
    try {
      setResults(await findGuests(query.trim()));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  if (guest) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-primary bg-primary/5 p-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{guest.name ?? guest.email}</p>
          <p className="truncate text-xs text-muted-foreground">
            {guest.email}
            {guest.couponCode ? ` · ${guest.couponCode}` : ''}
            {guest.isMember ? ' · 회원' : ''}
          </p>
        </div>
        <button type="button" onClick={() => onPick(null)} className="rounded-md border border-border px-2 py-1 text-xs">
          바꾸기
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {/* 바깥 발행 폼 안이라 form 을 겹치지 않고 Enter 만 받습니다. */}
      <div className="flex gap-2">
        <input
          id="wallet-guest-search"
          className="input-field min-w-0 flex-1"
          placeholder="받는 손님 — 이메일, 이름, 쿠폰북 코드"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search(e);
          }}
        />
        <button type="button" onClick={(e) => void search(e)} disabled={busy || query.trim().length < 2} className="inline-flex items-center gap-1 rounded-md border border-border px-3 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          찾기
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      {results && results.length === 0 && (
        <p className="text-xs text-muted-foreground">앱 계정을 못 찾았습니다. 손님이 GPS 앱에 가입한 이메일로 찾아 보세요.</p>
      )}
      {results && results.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {results.map((row) => (
            <li key={row.ownerId}>
              <button type="button" onClick={() => onPick(row)} className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/40">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{row.name ?? row.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.email}
                    {row.couponCode ? ` · ${row.couponCode}` : ''}
                  </span>
                </span>
                {row.isMember && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-primary">
                    <BadgeCheck className="h-3.5 w-3.5" />회원
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IssuedList({ refresh }: { refresh: number }) {
  const [items, setItems] = useState<IssuedItem[] | null>(null);
  const [error, setError] = useState('');
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setItems(await fetchIssued());
    } catch (failure) {
      setError(errorText(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  const doVoid = async (item: IssuedItem) => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await voidIssued(item, reason.trim());
      setVoiding(null);
      setReason('');
      await load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      icon={<Ticket className="h-4 w-4 text-primary" />}
      title="손님 앱으로 보낸 것"
      actions={
        <button type="button" onClick={() => void load()} aria-label="새로고침" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40">
          <RefreshCw className="h-4 w-4" />
        </button>
      }
    >
      {error && <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {!items ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 없습니다.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {items.map((item) => (
            <li key={item.code} className="flex flex-col gap-1 py-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {item.type === 'gift'
                    ? `기프트카드 ${money(item.balance)} / ${money(item.amount)}`
                    : `${item.name} · ${discountLabel(item.discountKind, item.value)}`}
                </span>
                <span className={`shrink-0 text-xs ${item.state === 'active' ? 'text-primary' : 'text-muted-foreground'}`}>
                  {STATE_LABEL[item.state] ?? item.state}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                <span className="font-mono">{item.barcode}</span> · {item.ownerEmail ?? '-'} · {item.issuedOn}
                {item.type === 'coupon' && item.expiresOn ? ` → ${item.expiresOn}` : ''} · {item.issuedBy ?? ''}
              </span>
              {item.note && <span className="text-xs">사유: {item.note}</span>}
              {item.voidReason && <span className="text-xs text-red-700 dark:text-red-300">무효 사유: {item.voidReason}</span>}
              {item.state === 'active' &&
                (voiding === item.code ? (
                  <div className="flex gap-2">
                    <input
                      id={`void-${item.code}`}
                      className="input-field min-w-0 flex-1 py-1"
                      placeholder="무효 사유 (필수)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <button type="button" disabled={busy || !reason.trim()} onClick={() => void doVoid(item)} className="rounded-md bg-red-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                      무효로
                    </button>
                    <button type="button" onClick={() => setVoiding(null)} className="rounded-md border border-border px-2 py-1 text-xs">
                      취소
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { setVoiding(item.code); setReason(''); }} className="self-start text-xs text-red-700 underline dark:text-red-300">
                    무효로…
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CampaignList({ refresh }: { refresh: number }) {
  const [items, setItems] = useState<CampaignCoupon[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchCampaignCoupons().then(
      (rows) => {
        if (alive) setItems(rows);
      },
      (failure) => {
        if (alive) setError(errorText(failure));
      }
    );
    return () => {
      alive = false;
    };
  }, [refresh]);

  return (
    <Card icon={<Tag className="h-4 w-4 text-primary" />} title="캠페인 쿠폰 (PROMO-)">
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {!items && !error ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : items && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 없습니다.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {(items ?? []).map((item) => (
            <li key={item.code} className="flex items-center gap-2 py-1.5">
              <span className="font-mono text-xs">{item.barcode}</span>
              <span className="min-w-0 flex-1 truncate">
                {item.name} · {discountLabel(item.kind, item.value)}
                {item.kind === 'amount' && item.per_player ? ' / 1인' : ''}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.used}
                {item.usage_limit ? `/${item.usage_limit}` : ''}회 · {STATE_LABEL[item.state] ?? item.state}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
