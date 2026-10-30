import { useEffect, useState, type FormEvent } from 'react';
import { Award, Car, Gift, Loader2, Search, Stamp, Ticket, Undo2 } from 'lucide-react';
import { staffStatus } from '@/lib/staffNotices';
import {
  addCouponStamp,
  giveSouvenir,
  lookupCouponHolder,
  redeemFreeCart,
  redeemFreeRound,
  ROUNDS_PER_GIFT,
  STAMPS_PER_FREE,
  undoCouponEntry,
  type CouponHolder,
} from '@/lib/couponBook';

/**
 * 쿠폰북 도장 (마이그레이션 0023)
 *
 * 도장은 티 시트에서 체크인할 때 저절로 찍힙니다(0027). 이 화면은 그 밖의 경우 -
 * 앱 계정과 예약이 이어지지 않은 손님 - 에 손으로 찍는 곳입니다. 손님이 폰의
 * /coupons 화면에 뜬 여섯 자리 코드를 보여 주면 여기에 칩니다. 이메일로도 찾습니다.
 * 회원은 도장이 없습니다(0026) - 찾으면 '회원' 표시가 붙고 도장 버튼이 잠깁니다.
 *
 * 직원 명부(0019)에 있으면 누구나 씁니다 - 계산하는 사람이 찍는 것이라
 * 관리자일 필요가 없습니다. 하루 한 번, 30분 안에만 되돌리기 같은 규칙은
 * 전부 서버가 지키고, 이 화면은 서버가 한 말을 그대로 보여 줍니다.
 */
export function CouponDesk() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [holder, setHolder] = useState<CouponHolder | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void staffStatus().then((s) => setIsStaff(s.isStaff));
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNote('');
    setError('');
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const find = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    void run(async () => {
      const found = await lookupCouponHolder(q);
      setHolder(found);
      if (!found) setError('그 코드(이메일)로 된 쿠폰북이 없습니다. 손님 폰의 코드를 다시 확인해 주세요.');
    });
  };

  const stamp = () =>
    holder &&
    run(async () => {
      const next = await addCouponStamp(holder);
      setHolder(next);
      const base =
        next.onCard === 0
          ? `도장 ${STAMPS_PER_FREE}개 완성 - 무료 라운드 1회가 생겼습니다.`
          : `도장을 찍었습니다 (${next.onCard}/${STAMPS_PER_FREE}).`;
      // 친구 소개로 온 손님의 첫 도장이면 소개한 사람에게 카트 무료가 쌓였습니다(0025).
      setNote(
        next.referralRewarded
          ? `${base} 소개한 ${next.referralRewarded} 님에게 카트 무료 1회가 적립되었습니다.`
          : base
      );
    });

  const redeem = () => {
    if (!holder) return;
    if (!window.confirm(`${holder.email ?? '이 손님'} 의 무료 라운드 1회를 사용합니다. 진행할까요?`)) return;
    void run(async () => {
      setHolder(await redeemFreeRound(holder));
      setNote('무료 라운드를 사용 처리했습니다. 그린피를 받지 마세요.');
    });
  };

  const redeemCart = () => {
    if (!holder) return;
    if (!window.confirm(`${holder.email ?? '이 손님'} 의 카트 무료 1회를 사용합니다. 진행할까요?`)) return;
    void run(async () => {
      setHolder(await redeemFreeCart(holder));
      setNote('카트 무료를 사용 처리했습니다. 카트비를 받지 마세요.');
    });
  };

  const souvenir = () => {
    if (!holder) return;
    if (!window.confirm(`${holder.email ?? '이 손님'} 에게 ${ROUNDS_PER_GIFT}라운드 기념품을 건넸다고 적습니다. 진행할까요?`)) return;
    void run(async () => {
      setHolder(await giveSouvenir(holder));
      setNote('기념품 증정을 기록했습니다.');
    });
  };

  const undo = () => {
    if (!holder) return;
    if (!window.confirm('이 손님의 가장 최근 기록 하나를 지웁니다. 진행할까요?')) return;
    void run(async () => {
      setHolder(await undoCouponEntry(holder));
      setNote('되돌렸습니다.');
    });
  };

  // 직원이 아니면 자리를 차지하지 않습니다. 서버도 어차피 거절합니다.
  if (!isStaff) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        <Ticket className="h-4 w-4 text-primary" />
        쿠폰북 · 라운드 {STAMPS_PER_FREE}번에 1번 무료
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">
        체크인하면 자동으로 찍힙니다. 자동으로 안 찍힌 손님만 여기서 찍으세요. 무료 라운드는 체크인 전에 사용 처리하세요.
      </p>

      <form onSubmit={find} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="손님 코드 6자리 또는 이메일"
          autoCapitalize="characters"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-lg uppercase tracking-widest outline-none placeholder:font-sans placeholder:text-sm placeholder:normal-case placeholder:tracking-normal focus:ring-2 focus:ring-green-500"
        />
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="inline-flex h-11 items-center gap-1 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          찾기
        </button>
      </form>

      {holder && (
        <div className="mt-3 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              {holder.email ?? '(이메일 없음)'}
              {holder.isMember && (
                <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">
                  회원 · 도장 없음
                </span>
              )}
            </p>
            <p className="font-mono text-sm text-muted-foreground">{holder.code}</p>
          </div>

          <div className="mt-2 flex gap-1" aria-label={`도장 ${holder.onCard}/${STAMPS_PER_FREE}`}>
            {Array.from({ length: STAMPS_PER_FREE }, (_, i) => (
              <span
                key={i}
                className={`h-5 flex-1 rounded-sm ${i < holder.onCard ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
          <p className="mt-1 text-sm">
            도장 <b className="tabular-nums">{holder.onCard}/{STAMPS_PER_FREE}</b>
            {' · '}남은 무료{' '}
            <b className={`tabular-nums ${holder.freeLeft > 0 ? 'text-green-700 dark:text-green-300' : ''}`}>
              {holder.freeLeft}회
            </b>
            {' · '}카트 무료{' '}
            <b className={`tabular-nums ${holder.cartsLeft > 0 ? 'text-sky-700 dark:text-sky-300' : ''}`}>
              {holder.cartsLeft}회
            </b>
            <span className="text-muted-foreground"> · 누적 {holder.rounds}라운드, 사용 {holder.redeemed}회</span>
          </p>
          {holder.giftDue > 0 ? (
            <p className="mt-1 text-sm font-semibold text-pink-700 dark:text-pink-300">
              {ROUNDS_PER_GIFT}라운드 기념품 {holder.giftDue}개 증정 대기 - 건네고 아래 버튼을 누르세요.
            </p>
          ) : (
            !holder.isMember && (
              <p className="mt-1 text-xs text-muted-foreground">
                기념품까지 {holder.roundsToGift}라운드 (100라운드마다 1개, 받은 기념품 {holder.giftsGiven}개)
              </p>
            )
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void stamp()}
              disabled={busy || holder.stampedToday || holder.isMember}
              className="inline-flex h-11 items-center gap-1.5 rounded-md bg-green-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Stamp className="h-4 w-4" />
              {holder.isMember ? '회원은 도장 없음' : holder.stampedToday ? '오늘 적립 완료' : '도장 찍기'}
            </button>
            <button
              type="button"
              onClick={redeem}
              disabled={busy || holder.freeLeft < 1}
              className="inline-flex h-11 items-center gap-1.5 rounded-md bg-amber-500 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Gift className="h-4 w-4" />
              무료 라운드 사용
            </button>
            <button
              type="button"
              onClick={redeemCart}
              disabled={busy || holder.cartsLeft < 1}
              className="inline-flex h-11 items-center gap-1.5 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Car className="h-4 w-4" />
              카트 무료 사용
            </button>
            {holder.giftDue > 0 && (
              <button
                type="button"
                onClick={souvenir}
                disabled={busy}
                className="inline-flex h-11 items-center gap-1.5 rounded-md bg-pink-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                <Award className="h-4 w-4" />
                기념품 줬음
              </button>
            )}
            <button
              type="button"
              onClick={undo}
              disabled={busy || holder.history.length === 0}
              className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" />
              되돌리기
            </button>
          </div>
        </div>
      )}

      {note && <p role="status" className="mt-2 text-sm text-primary">{note}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </section>
  );
}
