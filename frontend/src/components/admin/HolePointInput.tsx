import { useState, type FormEvent } from 'react';
import { Crosshair, LocateFixed } from 'lucide-react';
import type { FairwayPoint } from '@/data/pelhamHills';
import { haversineMetres } from '@/lib/geo';
import { captureGps, GpsCaptureError, parsePoint, type GpsProblem } from '@/lib/gpsCapture';

/** 이보다 흐린 GPS 는 한 번 더 묻습니다. 티 박스 하나, 그린 반쯤 되는 거리입니다. */
const WEAK_GPS_M = 15;
/** 지금 자리에서 이보다 먼 좌표는 오타로 봅니다 - 코스 끝에서 끝까지가 1km 남짓입니다. */
const TOO_FAR_M = 1500;

/**
 * 카카오톡 안의 브라우저. 위치를 막거나 늦게 주는 경우가 많아, 신호 탓이 아닌데도
 * '하늘이 트인 곳에서' 라는 말만 보게 됩니다 (클럽이 실제로 겪은 일).
 */
const inKakaoTalk = () => typeof navigator !== 'undefined' && /KAKAOTALK/i.test(navigator.userAgent);
/** 카카오톡이 제공하는 바깥 브라우저로 열기 - 휴대폰 기본 브라우저에서 이 주소를 엽니다. */
const kakaoExternal = () =>
  `kakaotalk://web/openExternal?url=${encodeURIComponent(window.location.href)}`;

const PROBLEM: Record<GpsProblem, string> = {
  unsupported: '이 브라우저는 위치를 알려 주지 않습니다.',
  denied: '위치 권한이 꺼져 있습니다. 브라우저(카카오톡이면 설정 > 앱 권한) 에서 위치를 허용해 주세요.',
  noSignal: 'GPS 신호를 받지 못했습니다. 하늘이 트인 곳에서 다시 눌러 주세요.',
};

const format = (p: FairwayPoint) => `${p[0].toFixed(7)}, ${p[1].toFixed(7)}`;

/**
 * 티나 핀 한 점을 정확히 넣는 칸
 *
 * 두 가지 길이 있습니다. 그 자리에 서서 '지금 내 위치로'를 누르거나, 다른 곳에서
 * 잰 좌표를 붙여 넣습니다. 지도에서 끄는 것보다 정확합니다 - 위성 사진은 몇 미터
 * 밀려 있기도 하고, 손가락은 그보다 더 굵습니다.
 */
export function HolePointInput({
  label,
  point,
  onSave,
}: {
  label: string;
  point: FairwayPoint;
  onSave: (next: FairwayPoint) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'gps' | 'text' | null>(null);
  // gps: the message is about reading the phone's position - inside KakaoTalk
  // it comes with the way out of KakaoTalk's browser.
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string; gps?: boolean } | null>(null);

  const save = async (next: FairwayPoint, how: string, kind: 'gps' | 'text') => {
    const away = haversineMetres(point[0], point[1], next[0], next[1]);
    if (away > TOO_FAR_M) {
      setMessage({ tone: 'error', text: `지금 위치에서 ${Math.round(away)}m 떨어진 좌표입니다. 숫자를 확인해 주세요.` });
      return;
    }
    setBusy(kind);
    try {
      await onSave(next);
      setMessage({ tone: 'ok', text: `${label}을(를) ${how} 옮겼습니다 (${Math.round(away)}m 이동).` });
      setText('');
    } finally {
      setBusy(null);
    }
  };

  const captureHere = async () => {
    setMessage(null);
    setBusy('gps');
    try {
      const { point: here, accuracy } = await captureGps();
      setBusy(null);
      if (
        accuracy > WEAK_GPS_M &&
        !window.confirm(`GPS 정확도가 ±${Math.round(accuracy)}m 로 낮습니다. 그래도 이 위치로 저장할까요?`)
      ) {
        setMessage({ tone: 'error', text: `저장하지 않았습니다 (정확도 ±${Math.round(accuracy)}m).` });
        return;
      }
      await save(here, `내 위치(정확도 ±${Math.round(accuracy)}m)로`, 'gps');
    } catch (err) {
      setBusy(null);
      setMessage({
        tone: 'error',
        text: err instanceof GpsCaptureError ? PROBLEM[err.problem] : '위치를 읽지 못했습니다.',
        gps: true,
      });
    }
  };

  const applyText = (event: FormEvent) => {
    event.preventDefault();
    const next = parsePoint(text);
    if (!next) {
      setMessage({ tone: 'error', text: '위도, 경도 두 숫자로 넣어 주세요. 예: 42.9814791, -79.2997647' });
      return;
    }
    void save(next, '입력한 좌표로', 'text');
  };

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={label}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{format(point)}</span>
      </div>

      <button
        type="button"
        onClick={() => void captureHere()}
        disabled={busy !== null}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        <LocateFixed className="h-4 w-4" />
        {busy === 'gps' ? 'GPS 읽는 중... (최대 10초)' : '지금 내 위치로'}
      </button>

      <form onSubmit={applyText} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          inputMode="decimal"
          placeholder="위도, 경도"
          aria-label={`${label} 좌표`}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <button
          type="submit"
          disabled={busy !== null || !text.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40 disabled:opacity-40"
        >
          <Crosshair className="h-4 w-4" />
          적용
        </button>
      </form>

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-xs ${message.tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-400'}`}
        >
          {message.text}
        </p>
      )}
      {message?.gps && inKakaoTalk() && (
        <p className="text-xs text-muted-foreground">
          카카오톡 안의 브라우저는 위치를 막거나 늦게 주는 경우가 많습니다.{' '}
          <a href={kakaoExternal()} className="font-medium text-primary underline">
            크롬/사파리로 열기
          </a>{' '}
          후 다시 눌러 주세요.
        </p>
      )}
    </div>
  );
}
