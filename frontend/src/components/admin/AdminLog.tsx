import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Presentation, RefreshCw, Search } from 'lucide-react';
import { listLog, type AdminLogRow } from '@/lib/adminSession';

/**
 * 직원 행동 기록 (migration 0032)
 *
 * 누가(직원 ID 이름 또는 이메일) 언제 무엇을 했는지. 운영 화면과 직원 화면에서 서버에 쓴 것은
 * 데이터베이스가 직접 적으므로, 화면을 거치지 않은 쓰기도 남습니다. 이메일로 들어온 관리자만 봅니다.
 */
const ACTION: Record<string, string> = {
  login: '로그인',
  login_failed: '로그인 실패',
  logout: '로그아웃',
  open: '운영 화면 열기',
  insert: '추가',
  update: '수정',
  delete: '삭제',
};

const TARGET: Record<string, string> = {
  admin: '운영 화면',
  email: '이메일 로그인',
  promotions: '배너',
  push_campaigns: '예약 발송',
  hole_edits: '코스 지도(홀)',
  cart_paths: '카트 길',
  app_settings: '앱 설정',
  food_orders: '주문',
  menu_items: '메뉴',
  staff_members: '직원 명부',
  scorecard_admins: '관리자 명단',
  map_editors: '지도 담당 명단',
  coupon_books: '쿠폰북',
  coupon_entries: '쿠폰 도장',
  coupon_referrals: '추천',
  checkin_tags: '체크인 태그',
  nfc_checkins: '체크인',
  gps_profiles: '회원·게스트',
  holes: '홀',
  courses: '코스',
};

const PAGE = 100;

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

function summary(row: AdminLogRow): string {
  const d = row.detail;
  if (!d) return '';
  if (row.action === 'update') {
    if (d._truncated) return `바뀐 칸: ${((d.columns as string[]) ?? []).join(', ')}`;
    return Object.entries(d)
      .map(([k, v]) => {
        const [before, after] = Array.isArray(v) ? v : [undefined, v];
        return `${k}: ${short(before)} → ${short(after)}`;
      })
      .join(' · ');
  }
  if (row.action === 'login_failed') return String(d.reason ?? '');
  if (row.action === 'insert' || row.action === 'delete') {
    if (d._truncated) return '';
    const pick = ['title', 'name', 'status', 'key', 'item_name', 'display_name'].find((k) => d[k] != null);
    return pick ? `${pick}: ${short(d[pick])}` : '';
  }
  return '';
}

function short(value: unknown): string {
  if (value === null || value === undefined) return '없음';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export function AdminLog() {
  const [rows, setRows] = useState<AdminLogRow[]>([]);
  const [actor, setActor] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async (before?: number) => {
    setBusy(true);
    setError('');
    try {
      const next = await listLog({ before, actor: query, limit: PAGE });
      setRows((prev) => (before ? [...prev, ...next] : next));
      setMore(next.length === PAGE);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '기록을 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setQuery(actor);
  };

  return (
    <section aria-label="직원 기록" className="flex flex-col gap-3">
      <a
        href="/admin/staff-login-guide.html"
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-2"
      >
        <Presentation className="w-4 h-4" />직원 ID 로그인 안내 (호프 가이드)
      </a>

      <div className="flex items-center gap-2">
        <form onSubmit={search} className="flex flex-1 items-center gap-2">
          <input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="직원 이름 또는 이메일"
            className="min-w-0 flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm"
          />
          <button type="submit" className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-border text-sm">
            <Search className="h-4 w-4" />
            찾기
          </button>
        </form>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="새로고침"
          className="inline-flex items-center px-3 py-2 rounded-md border border-border text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-300 p-2 text-sm text-red-700 dark:border-red-900 dark:text-red-300">
          {error}
        </p>
      )}

      {!error && !busy && rows.length === 0 && <p className="text-sm text-muted-foreground">기록이 없습니다.</p>}

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => setOpen(open === row.id ? null : row.id)}
              className="w-full px-3 py-2 text-left hover:bg-muted/30"
            >
              <div className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{when(row.at)}</span>
                <span className="truncate font-medium" data-no-translate>
                  {row.actor}
                </span>
                {row.via === 'pin' && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">ID</span>}
                <span
                  className={`ml-auto shrink-0 text-xs ${
                    row.action === 'delete' || row.action === 'login_failed' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
                  }`}
                >
                  {ACTION[row.action] ?? row.action}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground" data-no-translate>
                {[TARGET[row.target ?? ''] ?? row.target, row.row_key, summary(row)].filter(Boolean).join(' · ')}
              </div>
            </button>
            {open === row.id && (
              <pre className="mx-3 mb-2 max-h-64 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-4">
                {JSON.stringify(
                  { 계정: row.actor_email, ip: row.ip, ...((row.detail as object) ?? {}) },
                  null,
                  2,
                )}
              </pre>
            )}
          </li>
        ))}
      </ul>

      {more && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(rows[rows.length - 1]?.id)}
          className="self-center px-4 py-2 rounded-md border border-border text-sm disabled:opacity-50"
        >
          더 보기
        </button>
      )}
    </section>
  );
}
