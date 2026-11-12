import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { PinError } from '@/lib/adminSession';

/**
 * 직원 ID 숫자판 - 클럽 어드민(pelhamhills 의 PinPad)과 같은 동작입니다.
 *
 * 네 자리를 누르면 바로 확인합니다. 그 번호가 아무도 아니면(404) 조용히 기다립니다 - Shift ID 는
 * 4~8자리라서 다섯 자리 이상인 직원은 이어서 누르고 OK 를 누릅니다. OK 로 보낸 번호가 틀리면
 * 그때 문장을 띄웁니다. 키보드(숫자·Backspace·Enter)도 받습니다.
 */
const MIN = 4;
const MAX = 8;

export function PinPad({ onSubmit }: { onSubmit: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const codeRef = useRef('');
  const put = useCallback((next: string) => {
    codeRef.current = next;
    setCode(next);
  }, []);

  const submit = useCallback(
    async (value: string, auto: boolean) => {
      if (busyRef.current || value.length < MIN) return;
      busyRef.current = true;
      setBusy(true);
      setError('');
      try {
        await onSubmit(value);
        put('');
      } catch (cause) {
        const status = cause instanceof PinError ? cause.status : 0;
        if (auto && status === 404) return; // 더 긴 번호일 수 있습니다
        put('');
        setError(
          status === 404
            ? '직원 ID 가 맞지 않습니다.'
            : cause instanceof Error
              ? cause.message
              : '번호를 확인하지 못했습니다. 다시 눌러 주세요.',
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onSubmit, put],
  );

  const press = useCallback(
    (digit: string) => {
      if (busyRef.current || codeRef.current.length >= MAX) return;
      setError('');
      const next = codeRef.current + digit;
      put(next);
      if (next.length === MIN) void submit(next, true);
    },
    [put, submit],
  );

  const back = useCallback(() => {
    if (busyRef.current) return;
    put(codeRef.current.slice(0, -1));
  }, [put]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // 이메일 칸에 치는 숫자는 숫자판이 가져가지 않습니다.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') back();
      else if (event.key === 'Enter') void submit(codeRef.current, false);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, back, submit]);

  const key =
    'h-14 rounded-md bg-muted/60 text-xl font-bold text-foreground active:bg-muted disabled:opacity-50 transition-colors';

  return (
    <div>
      <div aria-label="직원 ID" className="flex h-12 items-center justify-center gap-3" role="status">
        {Array.from({ length: Math.max(MIN, code.length) }, (_, index) => (
          <span
            aria-hidden
            key={index}
            className={`h-3.5 w-3.5 rounded-full ${index < code.length ? 'bg-primary' : 'border-2 border-border'}`}
          />
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-center text-xs leading-5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : (
        <p className="mt-2 h-5 text-center text-xs text-muted-foreground">{busy ? '확인 중…' : ''}</p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button key={digit} type="button" className={key} disabled={busy} onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" aria-label="지우기" className={`${key} flex items-center justify-center`} disabled={busy} onClick={back}>
          <Delete className="h-5 w-5" />
        </button>
        <button type="button" className={key} disabled={busy} onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className="h-14 rounded-md bg-primary text-base font-bold text-primary-foreground disabled:opacity-50"
          disabled={busy || code.length < MIN}
          onClick={() => void submit(code, false)}
        >
          OK
        </button>
      </div>
    </div>
  );
}
