import { useCallback, useEffect, useRef, useState } from 'react';
import { IdCard, Loader2, Nfc, RefreshCw } from 'lucide-react';
import { staffStatus } from '@/lib/staffNotices';
import {
  canWriteNfc,
  checkinTagUrl,
  fetchCheckinFeed,
  fetchCheckinIdImage,
  fetchCheckinTags,
  writeCheckinTag,
  type CheckinFeedRow,
  type CheckinTag,
} from '@/lib/nfcCheckin';

const REFRESH_MS = 10000;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

/**
 * NFC 체크인 (마이그레이션 0024)
 *
 * 손님이 카운터 스티커에 폰을 대면 여기에 한 줄이 생기고, 가장 최근 손님은
 * 예약 때 올린 신분증 사진(pelhamhills 0082)이 펼쳐진 채로 뜹니다. 직원은
 * 사진과 얼굴을 보고 확인만 하면 됩니다.
 *
 * 티시트에는 이미 체크인으로 바뀌어 있습니다(같은 함수). 여기서 다시 누를 것은
 * 없습니다.
 *
 * 아래쪽 "태그" 는 스티커에 쓸 주소입니다. 안드로이드 Chrome 이면 버튼 하나로
 * 스티커에 바로 쓰고, 아이폰이면 NFC Tools 같은 앱에 주소를 붙여 넣어 씁니다.
 */
export function CheckinDesk() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [rows, setRows] = useState<CheckinFeedRow[]>([]);
  const [tags, setTags] = useState<CheckinTag[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string | null | 'loading'>>({});
  const [tagNote, setTagNote] = useState('');
  const newest = useRef<number | null>(null);

  const loadImage = useCallback(async (bookingId: string) => {
    setImages((m) => (bookingId in m ? m : { ...m, [bookingId]: 'loading' }));
    try {
      const url = await fetchCheckinIdImage(bookingId);
      setImages((m) => ({ ...m, [bookingId]: url }));
    } catch {
      setImages((m) => ({ ...m, [bookingId]: null }));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchCheckinFeed();
      setRows(next);
      setError('');
      // 새 체크인이 들어오면 그 손님을 펼칩니다 - 카운터 앞에 서 있는 사람입니다.
      const top = next[0];
      if (top && top.id !== newest.current) {
        newest.current = top.id;
        setOpen(top.bookingId);
        if (top.idOnFile) void loadImage(top.bookingId);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '체크인 목록을 받지 못했습니다.');
    }
  }, [loadImage]);

  useEffect(() => {
    void staffStatus().then((s) => setIsStaff(s.isStaff));
  }, []);

  useEffect(() => {
    if (!isStaff) return;
    void refresh();
    void fetchCheckinTags().then(setTags).catch(() => setTags([]));
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isStaff, refresh]);

  const toggle = (row: CheckinFeedRow) => {
    const next = open === row.bookingId ? null : row.bookingId;
    setOpen(next);
    if (next && row.idOnFile) void loadImage(row.bookingId);
  };

  const writeTag = async (token: string) => {
    setTagNote('폰 뒷면을 스티커에 대 주세요...');
    try {
      await writeCheckinTag(token);
      setTagNote('스티커에 썼습니다. 손님 폰으로 한 번 대 보세요.');
    } catch (failure) {
      setTagNote(failure instanceof Error ? failure.message : '쓰지 못했습니다.');
    }
  };

  if (!isStaff) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Nfc className="h-4 w-4 text-primary" />
          NFC 체크인 · 오늘
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="새로고침"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error && <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 NFC 로 체크인한 손님이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const image = images[row.bookingId];
            return (
              <li key={row.id} className="py-2">
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {clock(row.at)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{row.name ?? row.email}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      티 {row.time ?? '-'} · {row.players}명
                      {row.cartCount ? ` · 카트 ${row.cartCount}` : ''} · {row.email}
                    </span>
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${
                      row.idOnFile
                        ? 'bg-green-600/15 text-green-800 dark:text-green-200'
                        : 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
                    }`}
                  >
                    <IdCard className="h-3.5 w-3.5" />
                    {row.idOnFile ? 'ID 있음' : 'ID 확인 필요'}
                  </span>
                </button>

                {open === row.bookingId && (
                  <div className="mt-2 pl-16">
                    {!row.idOnFile ? (
                      <p className="text-sm text-amber-900 dark:text-amber-200">
                        예약 때 올린 신분증이 없습니다. 실물 신분증을 확인해 주세요.
                      </p>
                    ) : image === 'loading' || image === undefined ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : image ? (
                      <img
                        src={image}
                        alt={`${row.name ?? row.email} 신분증`}
                        className="max-h-80 w-full max-w-md rounded-md border border-border object-contain"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">사진을 받지 못했습니다.</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tags.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">카운터 NFC 스티커 주소</summary>
          {tags.map((tag) => (
            <div key={tag.token} className="mt-2 rounded-md border border-border p-2">
              <p className="font-medium">{tag.label}</p>
              <p className="break-all font-mono text-xs">{checkinTagUrl(tag.token)}</p>
              {canWriteNfc() ? (
                <button
                  type="button"
                  onClick={() => void writeTag(tag.token)}
                  className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  이 폰으로 스티커에 쓰기
                </button>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  안드로이드 Chrome 에서 이 화면을 열면 바로 쓸 수 있습니다. 아이폰은 NFC Tools 앱에서
                  위 주소를 URL 레코드로 쓰세요.
                </p>
              )}
            </div>
          ))}
          {tagNote && <p className="mt-2 text-xs text-primary">{tagNote}</p>}
        </details>
      )}
    </section>
  );
}
