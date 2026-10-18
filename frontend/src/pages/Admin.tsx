import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { KeyRound, LogOut } from 'lucide-react';
import {
  AdminAccountGate,
  CampaignPanel,
  CartPathRecorder,
  MenuAdmin,
  OrdersAdmin,
  PlayerMonitor,
  FairwayPathEditor,
  FullMapStylePicker,
  PromotionForm,
  PromotionList,
  ScorecardAdmin,
  StatsTable,
} from '@/components/admin';
import { clearAdminKey, getAdminKey, setAdminKey, type AdminPromotion } from '@/lib/adminApi';

type Tab = 'promotions' | 'stats' | 'campaigns' | 'scores' | 'map' | 'orders' | 'menu' | 'players';

const TABS: { id: Tab; label: string }[] = [
  // 라운드가 도는 동안 프로 샵이 제일 자주 여는 탭이라 맨 앞입니다.
  { id: 'players', label: '플레이어' },
  { id: 'promotions', label: '배너' },
  { id: 'stats', label: '성과' },
  { id: 'campaigns', label: '예약 발송' },
  { id: 'scores', label: '스코어' },
  { id: 'map', label: '코스 지도' },
  { id: 'orders', label: '주문' },
  { id: 'menu', label: '메뉴' },
];

/**
 * 코스 지도만 자기 주소(/admin/map)를 갖습니다. 플레이어 화면과 클럽 어드민
 * 사이드바가 그 주소로 곧장 들어오기 때문입니다. 나머지 탭은 주소를 바꾸지
 * 않던 그대로 둡니다.
 */
const MAP_PATH = '/admin/map';

/**
 * 운영자 화면
 *
 * 배너 등록, 성과 확인, 예약 발송, 스코어 조회, 코스 지도 수정을 한 화면에서
 * 합니다. 입구는 관리자 키이고, 서버에 쓰는 일은 모두 관리자로 지정된 회원
 * 계정으로 합니다 - 누가 관리자인지는 서버(scorecard_admins)가 정합니다.
 *
 * 휴대폰 폭을 기준으로 짰습니다. 운영자는 사무실 PC보다 클럽하우스에서
 * 휴대폰으로 여는 일이 많고, 배너를 급히 내려야 하는 순간은 대개 그때입니다.
 */
export default function Admin() {
  const [location, navigate] = useLocation();
  const [hasKey, setHasKey] = useState(() => getAdminKey() !== null);
  // 지도 주소로 들어온 것이 아니면 플레이어 모니터로 엽니다 - 라운드가 도는
  // 동안 운영 화면을 여는 이유가 대개 그것이기 때문입니다.
  const [tab, setTab] = useState<Tab>(() => (location.startsWith(MAP_PATH) ? 'map' : 'players'));

  const [editing, setEditing] = useState<AdminPromotion | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  // 폼이 저장하면 이 값을 올려 목록에게 다시 읽으라고 알립니다.
  const [refreshToken, setRefreshToken] = useState(0);

  /**
   * 지도 탭은 주소를 따라가고, 지도에서 나갈 때는 /admin 으로 되돌립니다.
   * 안 되돌리면 배너 탭을 보는데 주소는 /admin/map 이라, 새로고침하면 지도가 뜹니다.
   * 이미 지도에 있으면 주소를 건드리지 않습니다 - ?hole= 이 날아갑니다.
   */
  const selectTab = (id: Tab) => {
    setTab(id);
    const onMap = location.startsWith(MAP_PATH);
    if (id === 'map' && !onMap) navigate(MAP_PATH, { replace: true });
    if (id !== 'map' && onMap) navigate('/admin', { replace: true });
  };

  if (!hasKey) {
    return <AdminKeyGate onSubmit={() => setHasKey(true)} />;
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
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          <LogOut className="w-4 h-4" />키 지우기
        </button>
      </header>

      {/* 좁은 화면에서 탭이 줄바꿈되며 헤더 높이가 튀지 않게 옆으로 밀립니다. */}
      <nav className="flex gap-2 overflow-x-auto pb-1 mb-4" aria-label="관리 메뉴">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectTab(item.id)}
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
        <AdminAccountGate>
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
            />
          </div>
        </AdminAccountGate>
      )}

      {tab === 'players' && (
        <AdminAccountGate>
          <PlayerMonitor />
        </AdminAccountGate>
      )}

      {tab === 'stats' && (
        <AdminAccountGate>
          <StatsTable />
        </AdminAccountGate>
      )}

      {tab === 'campaigns' && (
        <AdminAccountGate>
          <CampaignPanel />
        </AdminAccountGate>
      )}

      {tab === 'scores' && <ScorecardAdmin />}

      {tab === 'orders' && (
        <AdminAccountGate>
          <OrdersAdmin />
        </AdminAccountGate>
      )}

      {tab === 'menu' && (
        <AdminAccountGate>
          <MenuAdmin />
        </AdminAccountGate>
      )}

      {tab === 'map' && (
        <div className="flex flex-col gap-4">
          <FullMapStylePicker />
          <FairwayPathEditor />
          <CartPathRecorder />
        </div>
      )}
    </main>
  );
}

/**
 * 관리자 키 입력
 *
 * 운영 화면의 입구입니다. 이 탭을 닫으면 지워지므로 공용 기기에서 열어 둔
 * 운영 화면이 다음 사람에게 넘어가지 않습니다.
 */
function AdminKeyGate({ onSubmit }: { onSubmit: () => void }) {
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
          운영 화면에 들어가는 키입니다. 이 탭을 닫으면 지워지므로, 공용 기기에서 써도
          다음 사람에게 넘어가지 않습니다.
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
