import { useCallback, useState, type FormEvent } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { CampaignPanel, PromotionForm, PromotionList, StatsTable } from '@/components/admin';
import { clearAdminKey, getAdminKey, setAdminKey, type AdminPromotion } from '@/lib/adminApi';

type Tab = 'promotions' | 'stats' | 'campaigns';

const TABS: { id: Tab; label: string }[] = [
  { id: 'promotions', label: '배너' },
  { id: 'stats', label: '성과' },
  { id: 'campaigns', label: '예약 발송' },
];

/**
 * 운영자 화면
 *
 * 배너 등록, 성과 확인, 예약 발송을 한 화면에서 합니다. 로그인은 없고
 * 관리자 키 하나로 들어옵니다 - 이 앱에는 계정 개념 자체가 없습니다.
 *
 * 휴대폰 폭을 기준으로 짰습니다. 운영자는 사무실 PC보다 클럽하우스에서
 * 휴대폰으로 여는 일이 많고, 배너를 급히 내려야 하는 순간은 대개 그때입니다.
 */
export default function Admin() {
  const [hasKey, setHasKey] = useState(() => getAdminKey() !== null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('promotions');

  const [editing, setEditing] = useState<AdminPromotion | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  // 폼이 저장하면 이 값을 올려 목록에게 다시 읽으라고 알립니다.
  const [refreshToken, setRefreshToken] = useState(0);

  /**
   * 서버가 401을 돌려준 뒤
   *
   * adminApi가 저장된 키를 이미 지웠습니다. 화면도 같이 되돌려야 합니다 -
   * 틀린 키를 쥔 채로 버튼만 계속 눌리면 매번 같은 실패를 봅니다.
   */
  const handleUnauthorized = useCallback(() => {
    setHasKey(false);
    setNotice('관리자 키가 올바르지 않습니다. 다시 입력해 주세요.');
  }, []);

  if (!hasKey) {
    return <AdminKeyGate notice={notice} onSubmit={() => { setNotice(null); setHasKey(true); }} />;
  }

  return (
    <main className="min-h-screen p-4 pb-16 max-w-3xl mx-auto">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold">운영 관리</h1>
        <button
          type="button"
          onClick={() => {
            clearAdminKey();
            setHasKey(false);
            setNotice(null);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          <LogOut className="w-4 h-4" />키 지우기
        </button>
      </header>

      {/* 좁은 화면에서 세 개가 줄바꿈되며 헤더 높이가 튀지 않게 옆으로 밀립니다. */}
      <nav className="flex gap-2 overflow-x-auto pb-1 mb-4" aria-label="관리 메뉴">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? 'page' : undefined}
            className={`px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
              tab === item.id
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-muted-foreground hover:bg-muted/40'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'promotions' && (
        <div className="flex flex-col gap-6">
          {isFormOpen && (
            <PromotionForm
              promotion={editing}
              onSaved={() => {
                setIsFormOpen(false);
                setEditing(null);
                setRefreshToken((value) => value + 1);
              }}
              onCancel={() => {
                setIsFormOpen(false);
                setEditing(null);
              }}
              onUnauthorized={handleUnauthorized}
            />
          )}

          <PromotionList
            refreshToken={refreshToken}
            onCreate={() => {
              setEditing(null);
              setIsFormOpen(true);
            }}
            onEdit={(promotion) => {
              setEditing(promotion);
              setIsFormOpen(true);
            }}
            onUnauthorized={handleUnauthorized}
          />
        </div>
      )}

      {tab === 'stats' && <StatsTable onUnauthorized={handleUnauthorized} />}

      {tab === 'campaigns' && <CampaignPanel onUnauthorized={handleUnauthorized} />}
    </main>
  );
}

/**
 * 관리자 키 입력
 *
 * 키가 없으면 목록도 보여 주지 않습니다. 어차피 모든 요청이 401로 돌아오고,
 * 빈 목록을 먼저 보여 주면 '배너가 없다'와 '키가 없다'가 같은 화면이 됩니다.
 */
function AdminKeyGate({ notice, onSubmit }: { notice: string | null; onSubmit: () => void }) {
  const [value, setValue] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const key = value.trim();
    if (!key) return;

    setAdminKey(key);
    onSubmit();
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm p-5 rounded-lg border border-border bg-card text-card-foreground"
      >
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-base">관리자 키</h1>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          배너 관리와 알림 발송에 쓰는 키입니다. 이 탭을 닫으면 지워지므로, 공용 기기에서
          써도 다음 사람에게 넘어가지 않습니다.
        </p>

        <label className="sr-only" htmlFor="admin-key">
          관리자 키
        </label>
        <input
          id="admin-key"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoFocus
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />

        {notice && (
          <p className="text-sm text-red-700 dark:text-red-300 mt-3" role="alert">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={!value.trim()}
          className="w-full mt-4 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          들어가기
        </button>
      </form>
    </main>
  );
}
