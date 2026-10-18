import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Bell, BellOff, Loader2, Megaphone, Send } from 'lucide-react';
import {
  fetchStaffNotices,
  sendStaffNotice,
  staffStatus,
  type StaffNotice,
  type StaffStatus,
} from '@/lib/staffNotices';
import { setProShopAlerts } from '@/lib/foodOrders';
import { isPushSupported, subscribeToPush } from '@/lib/push';

/**
 * 직원 공지 (마이그레이션 0019)
 *
 * 두 가지를 합니다. 받는 쪽과 보내는 쪽입니다:
 *
 *   - **이 기기로 받기** - 직원 명부에 있는 사람이면 누구나. 주문 알림과 같은
 *     토픽('proshop')이라 이 스위치 하나가 둘 다 켭니다.
 *   - **전 직원에게 보내기** - can_broadcast 가 켜진 사람에게만 보입니다.
 *     클럽이 Francis 와 Sam 을 그렇게 지정했습니다.
 *
 * 관리자 화면 안이 아니라 카운터 화면(/fnb) 위쪽에 답니다. 공지를 받는 직원이
 * 관리자 계정일 필요는 없고, 관리자로 만들면 메뉴 가격과 손님 위치까지 딸려
 * 열리기 때문입니다 - 공지 하나 받자고 치를 값이 아닙니다.
 *
 * 손님 발송과 헷갈릴 여지를 없애려고 토픽은 서버가 못박습니다. 이 화면에는
 * 받는 사람을 고르는 칸이 아예 없습니다.
 */
export function StaffNotices() {
  const [status, setStatus] = useState<StaffStatus | null>(null);
  const [notices, setNotices] = useState<StaffNotice[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState<'off' | 'on' | 'busy'>('off');

  const refresh = useCallback(async () => {
    const next = await staffStatus();
    setStatus(next);
    if (next.isStaff) setNotices(await fetchStaffNotices());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const takeAlerts = async () => {
    setAlerts('busy');
    setNote('');
    setError('');
    try {
      const subscription = await subscribeToPush();
      const failed = await setProShopAlerts(subscription.endpoint, true);
      if (failed) {
        setAlerts('off');
        setError(
          failed === 'notAdmin'
            ? '이 계정은 직원으로 등록되지 않았습니다. 관리자에게 이름을 올려 달라고 하세요.'
            : '알림을 켜지 못했습니다.'
        );
        return;
      }
      setAlerts('on');
      setNote('이 기기로 직원 공지와 새 주문 알림을 받습니다.');
    } catch (err) {
      setAlerts('off');
      const code = err instanceof Error ? err.message : '';
      setError(
        code === 'PERMISSION_DENIED'
          ? '브라우저에서 알림이 꺼져 있습니다. 사이트 설정에서 허용해 주세요.'
          : code === 'PUSH_UNSUPPORTED'
            ? '이 브라우저는 알림을 지원하지 않습니다. 아이폰·아이패드는 홈 화면에 추가한 뒤에 됩니다.'
            : '알림을 켜지 못했습니다.'
      );
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || sending) return;
    // 전 직원의 잠금 화면에 뜨고, 뜬 뒤에는 무를 수 없습니다.
    if (!window.confirm(`전 직원에게 보냅니다.\n\n${title}\n${body}\n\n보낼까요?`)) return;

    setSending(true);
    setError('');
    setNote('');
    try {
      await sendStaffNotice(title.trim(), body.trim());
      setTitle('');
      setBody('');
      setNote('보냈습니다. 몇 초 뒤 직원 폰에 뜹니다.');
      setNotices(await fetchStaffNotices());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '보내지 못했습니다.');
    } finally {
      setSending(false);
    }
  };

  if (!status) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        직원 권한을 확인하는 중...
      </p>
    );
  }

  if (status.notInstalled) {
    return (
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
        직원 공지가 아직 서버에 없습니다. Supabase SQL Editor 에서
        <b> 0019_staff_notices.sql</b> 을 실행하고, 맨 아래에서 직원을 지정해 주세요.
      </p>
    );
  }

  if (!status.isStaff) return null;

  const field = 'h-11 w-full rounded-md border border-border bg-background px-3 text-base';

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Megaphone className="h-4 w-4" />
          직원 공지
        </h2>
        {isPushSupported() && (
          <button
            type="button"
            onClick={() => void takeAlerts()}
            disabled={alerts === 'busy'}
            className={`inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium disabled:opacity-50 ${
              alerts === 'on' ? 'bg-primary text-primary-foreground' : 'border border-border'
            }`}
          >
            {alerts === 'busy' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : alerts === 'on' ? (
              <Bell className="h-4 w-4" />
            ) : (
              <BellOff className="h-4 w-4" />
            )}
            {alerts === 'on' ? '이 기기 알림 켜짐' : '이 기기로 받기'}
          </button>
        )}
      </div>

      {status.canBroadcast ? (
        <form onSubmit={send} className="flex flex-col gap-2">
          <label className="text-sm font-medium">
            제목
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
              placeholder="오늘 4시 카트 점검"
              className={`${field} mt-1`}
            />
          </label>
          <label className="text-sm font-medium">
            내용 (선택)
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="9번 홀 뒤 주차장으로 카트 모아 주세요."
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base"
            />
          </label>
          <button
            type="submit"
            disabled={sending || !title.trim()}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            전 직원에게 보내기
          </button>
          <p className="text-xs text-muted-foreground">
            직원 폰에만 갑니다. 손님에게는 가지 않습니다 - 받는 사람은 서버가 정하고 이
            화면에서 고를 수 없습니다.
          </p>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          공지를 받는 계정입니다. 보내는 것은 클럽이 지정한 사람만 할 수 있습니다.
        </p>
      )}

      {note && <p className="text-sm text-green-700 dark:text-green-400">{note}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {notices.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">최근 공지</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {notices.map((notice) => (
              <li key={notice.id} className="p-2">
                <p className="text-sm font-medium">{notice.title}</p>
                {notice.body && (
                  <p className="text-xs text-muted-foreground">{notice.body}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {new Date(notice.createdAt).toLocaleString()}
                  {' · '}
                  {/* 몇 대에 닿았는지. 'pending' 은 아직 발송 함수가 가져가기
                      전이라는 뜻이고, 몇 초면 바뀝니다. */}
                  {notice.status === 'sent'
                    ? `${notice.delivered ?? 0}대 도착`
                    : notice.status === 'pending'
                      ? '보내는 중'
                      : notice.status}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
