import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { ChevronLeft, Loader2, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { AccountForm } from '@/components/AccountPanel';
import { useAppStore } from '@/store/appStore';
import { startAuth } from '@/lib/auth';
import {
  customerQrUrl,
  fetchMyCard,
  linkMyCard,
  parseCustomerCode,
  type CustomerCard,
} from '@/lib/customerQr';

/**
 * 내 QR (/me?c=PHC-XXXXXXXXXX)
 *
 * 프로 샵이 준 QR 을 폰 카메라로 찍으면 열리는 화면입니다. 로그인 -> 생년월일
 * 확인 -> 내 QR 순서. 한 번 이어 두면 그 뒤로는 계정 막대의 My QR 로 바로 열립니다.
 *
 * 이미 이어진 계정으로 다른 코드의 주소를 열면 카드는 그대로 보여 주고, 새 코드로
 * 옮겨 이을지 아래에 묻습니다(가족 폰을 바꿔 쓰는 경우).
 */
export default function MyQr() {
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  const fromUrl = parseCustomerCode(new URLSearchParams(window.location.search).get('c'));
  // undefined = 아직 묻는 중, null = 이어진 손님 없음.
  const [card, setCard] = useState<CustomerCard | null | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  // 같은 계정으로 두 번 부르지 않도록. 스트릭트 모드의 이중 effect 도 여기서 걸립니다.
  const triedFor = useRef<string | null>(null);

  useEffect(() => {
    startAuth();
  }, []);

  useEffect(() => {
    if (!account || triedFor.current === account.id) return;
    triedFor.current = account.id;
    setCard(undefined);
    setLoadError('');
    fetchMyCard()
      .then(setCard)
      .catch((failure) => {
        setCard(null);
        setLoadError(failure instanceof Error ? failure.message : 'Could not load your QR.');
      });
  }, [account]);

  const offerLink = card === null || (!!card && !!fromUrl && fromUrl !== card.qrCode);

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
        <h1 className="min-w-0 flex-1 text-center text-lg font-bold">My QR</h1>
        <span className="w-16" />
      </header>

      {!accountReady ? (
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      ) : !account ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-sm">
            Sign in or create an account to keep your <b>Pelham Hills QR</b> on this phone. You
            only need to do this once.
          </p>
          <AccountForm />
        </section>
      ) : card === undefined ? (
        <p className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Opening your QR...
        </p>
      ) : (
        <>
          {loadError && (
            <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm">
              {loadError}
            </p>
          )}
          {card && <QrCard card={card} />}
          {offerLink && !loadError && (
            <LinkForm
              key={fromUrl ?? ''}
              initialCode={fromUrl}
              replacing={!!card}
              onLinked={setCard}
            />
          )}
          <p className="text-center text-xs text-muted-foreground">Signed in as {account.email}</p>
        </>
      )}
    </main>
  );
}

/** 이어진 손님의 카드: 이름, 회원 번호, 카운터에서 찍을 큰 QR. */
function QrCard({ card }: { card: CustomerCard }) {
  const [image, setImage] = useState('');

  useEffect(() => {
    if (!card.qrCode) return;
    let alive = true;
    // 카운터 스캐너가 화면 밝기에 상관없이 읽도록 크게, 여백은 최소로.
    QRCode.toDataURL(customerQrUrl(card.qrCode), { width: 640, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => alive && setImage(url))
      .catch(() => alive && setImage(''));
    return () => {
      alive = false;
    };
  }, [card.qrCode]);

  return (
    <section className="rounded-xl border-2 border-primary bg-card p-5 text-center">
      <p className="text-xl font-bold">{card.name ?? 'Pelham Hills guest'}</p>
      {card.memberNumber && (
        <p className="mt-0.5 text-sm text-muted-foreground">Member #{card.memberNumber}</p>
      )}
      {card.qrCode ? (
        <>
          <div className="mx-auto mt-4 aspect-square w-full max-w-[18rem] rounded-lg bg-white p-2">
            {image ? (
              <img src={image} alt={`QR code ${card.qrCode}`} className="h-full w-full" />
            ) : (
              <Loader2 className="m-auto h-full w-6 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="mt-2 font-mono text-lg font-semibold tracking-wider">{card.qrCode}</p>
          <p className="mt-2 text-sm">Show this at the pro shop to check in.</p>
        </>
      ) : (
        <p className="mt-3 text-sm">No QR code on file yet. Ask the pro shop to make one.</p>
      )}
    </section>
  );
}

/** QR 코드 + 생년월일로 계정을 손님에 잇습니다. 주소에 코드가 있으면 채워 둡니다. */
function LinkForm({
  initialCode,
  replacing,
  onLinked,
}: {
  initialCode: string | null;
  replacing: boolean;
  onLinked: (card: CustomerCard) => void;
}) {
  const [code, setCode] = useState(initialCode ?? '');
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parsed = parseCustomerCode(code);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed || !dob) return;
    setBusy(true);
    setError('');
    try {
      onLinked(await linkMyCard(parsed, dob));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not link your QR.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold">
            {replacing ? 'Link this QR code instead?' : 'Confirm your date of birth'}
          </p>
          <p className="text-xs text-muted-foreground">
            {replacing
              ? 'Your account will move to the QR code below.'
              : 'This links the QR code from the pro shop to your account.'}
          </p>
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">QR code</span>
        {initialCode ? (
          <p className="mt-0.5 font-mono font-semibold tracking-wider">{initialCode}</p>
        ) : (
          <input
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="PHC-XXXXXXXXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="input-field mt-0.5 w-full py-1.5 font-mono uppercase"
          />
        )}
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Date of birth</span>
        <input
          type="date"
          autoComplete="bday"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
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
        disabled={busy || !parsed || !dob}
        className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? 'Please wait...' : replacing ? 'Link this QR' : 'Show my QR'}
      </button>
    </form>
  );
}
