import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { LogOut } from 'lucide-react';
import {
  AdminAccountGate,
  AdminEntry,
  AdminLog,
  CampaignPanel,
  CartPathRecorder,
  CouponDesk,
  DroneAdmin,
  CctvAdmin,
  MenuAdmin,
  OrdersAdmin,
  PlayerMonitor,
  FairwayPathEditor,
  FullMapStylePicker,
  PromotionForm,
  PromotionList,
  ScorecardAdmin,
  StatsTable,
  WalletAdmin,
} from '@/components/admin';
import type { AdminPromotion } from '@/lib/adminApi';
import { endAdmin, isUnlocked, logAccess, whoami, type AdminWho } from '@/lib/adminSession';
import LangToggle from '@/lib/i18n/LangToggle';
import { startAuth } from '@/lib/auth';
import { staffStatus } from '@/lib/staffNotices';
import { walletAccess } from '@/lib/wallet';
import { useAppStore } from '@/store/appStore';

type Tab = 'promotions' | 'stats' | 'campaigns' | 'scores' | 'map' | 'drone' | 'cctv' | 'orders' | 'menu' | 'players' | 'coupons' | 'wallet' | 'log';

const TABS: { id: Tab; label: string }[] = [
  // 라운드가 도는 동안 프로 샵이 제일 자주 여는 탭이라 맨 앞입니다.
  { id: 'players', label: '플레이어' },
  { id: 'promotions', label: '배너' },
  { id: 'stats', label: '성과' },
  { id: 'campaigns', label: '예약 발송' },
  { id: 'scores', label: '스코어' },
  { id: 'map', label: '코스 지도' },
  // 드론 촬영 계획(2026-10-29). 코스 지도와 같은 홀 좌표를 씁니다.
  { id: 'drone', label: '드론 촬영' },
  // 클럽 Hikvision 녹화기 연결 준비(2026-10-30). 지금은 호프 가이드만 있습니다.
  { id: 'cctv', label: 'CCTV' },
  { id: 'orders', label: '주문' },
  { id: 'menu', label: '메뉴' },
  // /fnb 와 같은 쿠폰북 칸입니다 - 도장, 무료 라운드, 100라운드 기념품(0029). 직원 명부(0019)에 있어야 보입니다.
  { id: 'coupons', label: '쿠폰북' },
  // 프로 샵 기프트카드 매니저에게만 보입니다(pelhamhills 0121 gps_wallet_access).
  { id: 'wallet', label: '쿠폰·기프트카드' },
  // 직원 행동 기록(0032). 이메일로 들어온 관리자에게만 보입니다.
  { id: 'log', label: '기록' },
];

/**
 * 코스 지도와 CCTV 만 자기 주소(/admin/map, /admin/cctv)를 갖습니다. 플레이어
 * 화면과 클럽 어드민 사이드바가 그 주소로 곧장 들어오기 때문입니다. 나머지 탭은
 * 주소를 바꾸지 않던 그대로 둡니다.
 */
const MAP_PATH = '/admin/map';
const CCTV_PATH = '/admin/cctv';

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
  const [unlocked, setUnlockedState] = useState(isUnlocked);
  const enter = useCallback(() => setUnlockedState(true), []);
  // 지도·CCTV 주소로 들어온 것이 아니면 플레이어 모니터로 엽니다 - 라운드가 도는
  // 동안 운영 화면을 여는 이유가 대개 그것이기 때문입니다.
  const [tab, setTab] = useState<Tab>(() => {
    if (location.startsWith(MAP_PATH)) return 'map';
    return location.startsWith(CCTV_PATH) ? 'cctv' : 'players';
  });

  const [editing, setEditing] = useState<AdminPromotion | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  // 폼이 저장하면 이 값을 올려 목록에게 다시 읽으라고 알립니다.
  const [refreshToken, setRefreshToken] = useState(0);

  // 쿠폰·기프트카드 탭은 기프트카드를 발행할 수 있는 매니저 계정에만 보입니다. 코스 지도만 고치는 관리자와
  // 공용 proshop 계정에는 탭이 없습니다 - 판정은 서버가 합니다.
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  const [canIssue, setCanIssue] = useState(false);
  // 기록 탭(0032)과 머리의 '누구로 들어왔나'
  const [canSeeLog, setCanSeeLog] = useState(false);
  const [who, setWho] = useState<AdminWho | null>(null);
  // 쿠폰북 탭은 직원에게만 보입니다. CouponDesk 는 직원이 아니면 스스로 사라져, 탭만 남으면 빈 화면입니다.
  const [isStaff, setIsStaff] = useState(false);
  useEffect(() => {
    startAuth();
  }, []);
  useEffect(() => {
    let alive = true;
    if (!account) {
      setCanIssue(false);
      setIsStaff(false);
      setCanSeeLog(false);
      setWho(null);
      return;
    }
    logAccess().then((yes) => {
      if (alive) setCanSeeLog(yes);
    });
    whoami().then((w) => {
      if (alive) setWho(w);
    });
    walletAccess().then((yes) => {
      if (alive) setCanIssue(yes);
    });
    staffStatus().then((s) => {
      if (alive) setIsStaff(s.isStaff);
    });
    return () => {
      alive = false;
    };
  }, [account]);

  /**
   * 지도·CCTV 탭은 주소를 따라가고, 거기서 나갈 때는 /admin 으로 되돌립니다.
   * 안 되돌리면 배너 탭을 보는데 주소는 /admin/map 이라, 새로고침하면 지도가 뜹니다.
   * 이미 지도에 있으면 주소를 건드리지 않습니다 - ?hole= 이 날아갑니다.
   */
  const selectTab = (id: Tab) => {
    setTab(id);
    const onMap = location.startsWith(MAP_PATH);
    const onCctv = location.startsWith(CCTV_PATH);
    if (id === 'map' && !onMap) navigate(MAP_PATH, { replace: true });
    else if (id === 'cctv' && !onCctv) navigate(CCTV_PATH, { replace: true });
    else if (id !== 'map' && id !== 'cctv' && (onMap || onCctv)) navigate('/admin', { replace: true });
  };

  if (!accountReady) {
    return <main className="min-h-screen p-6 text-sm text-muted-foreground">불러오는 중...</main>;
  }

  // 이 탭에서 들어온 적이 없거나, 다른 탭·지도 탭에서 로그아웃해 계정이 없으면 입구로.
  if (!unlocked || !account) {
    return <AdminEntry onEnter={enter} />;
  }

  return (
    <main className="min-h-screen p-4 pb-16 max-w-3xl mx-auto">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold">운영 관리</h1>
        <span className="ml-auto min-w-0 truncate text-sm text-muted-foreground" data-no-translate>
          {who?.name ?? account.email}
        </span>
        <LangToggle className="px-3 py-2 rounded-md border border-border text-sm" />
        <button
          type="button"
          onClick={() => {
            setUnlockedState(false);
            void endAdmin();
          }}
          className="inline-flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          <LogOut className="w-4 h-4" />로그아웃
        </button>
      </header>

      {/* 좁은 화면에서 탭이 줄바꿈되며 헤더 높이가 튀지 않게 옆으로 밀립니다. */}
      <nav className="flex gap-2 overflow-x-auto pb-1 mb-4" aria-label="관리 메뉴">
        {TABS.filter(
          (item) =>
            (item.id !== 'wallet' || canIssue) && (item.id !== 'coupons' || isStaff) && (item.id !== 'log' || canSeeLog),
        ).map((item) => (
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

      {tab === 'coupons' && <CouponDesk />}

      {tab === 'wallet' && <WalletAdmin />}

      {tab === 'drone' && <DroneAdmin />}

      {tab === 'cctv' && <CctvAdmin />}

      {tab === 'log' && canSeeLog && <AdminLog />}

      {tab === 'map' && (
        <AdminAccountGate mapEditor>
          <div className="flex flex-col gap-4">
            <FullMapStylePicker />
            <FairwayPathEditor />
            <CartPathRecorder />
          </div>
        </AdminAccountGate>
      )}
    </main>
  );
}
