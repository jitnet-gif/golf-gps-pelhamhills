"use client";

// 티 시트 화면 셸. 실제 동작은 useTeeSheet 컨트롤러와 각 패널 컴포넌트가 담당한다.
import { useCallback, useRef, useState } from "react";

import BookingDialog from "../../components/teesheet/BookingDialog";
import DateNav from "../../components/teesheet/DateNav";
import OrchestrationPanel from "../../components/teesheet/OrchestrationPanel";
import ReservationDetail from "../../components/teesheet/ReservationDetail";
import WeekGrid from "../../components/teesheet/WeekGrid";
import { useTeeSheet } from "../../hooks/useTeeSheet";

const menuLinks: Array<[string, string]> = [
  ["Pelham Hills Golf Club", "/"],
  // 앱의 다른 페이지들이 모두 /admin 으로 링크하므로 규약을 맞춘다 (/admin 은 이 페이지를 재노출).
  ["Tee Sheet", "/admin"],
  ["Tee Times & Pricing", "/pricing"],
  ["Dynamic Pricing", "/dynamic-pricing"],
  ["Events", "/events"],
  ["Customers", "/customers"],
  ["Tour Operators", "/tour-operators"],
  ["Promotions", "/promotions"],
  ["Reports", "/reports"],
  ["Business Intelligence", "/business-intelligence"],
  ["Radar", "/radar"],
  ["Integrations", "/integrations"],
  ["Settings", "/settings"],
];

export default function TeeSheetPage() {
  const controller = useTeeSheet();
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogSeed = useRef<{ date?: string; time?: string }>({});

  const openBlankDialog = useCallback(() => {
    dialogSeed.current = { date: controller.focusedDate };
    setDialogOpen(true);
  }, [controller.focusedDate]);

  const openDialogAt = useCallback((date: string, time: string) => {
    dialogSeed.current = { date, time };
    setDialogOpen(true);
  }, []);

  // 한 화면 고정: 페이지 자체는 절대 스크롤하지 않고, 티 시트와 상세 패널이
  // 각자 내부에서만 스크롤한다. 그래야 예약을 클릭했을 때 격자와 상세가 동시에 보인다.
  return (
    <main className="h-screen overflow-hidden bg-[#f2f2f4] text-[#1f2328]">
      {/* 트랙을 minmax(0,1fr) 로 고정해야 한다. auto 트랙은 max-content 로 부풀어서
          안쪽 overflow-x-auto 컨테이너(격자 카드, 플레이어 카드 줄)의 내용 폭이
          페이지 전체를 좁은 화면에서 가로로 밀어낸다. */}
      <div className="grid h-full grid-cols-[minmax(0,1fr)] lg:grid-cols-[148px_minmax(0,1fr)]">
        <aside className="hidden overflow-y-auto bg-[#111315] text-white lg:block">
          <div className="border-b border-white/10 px-4 py-4 text-sm font-bold">lightspeed</div>
          <nav className="grid gap-1 px-2 py-3 text-xs">
            {menuLinks.map(([item, href]) => (
              <a
                className={`px-3 py-2 font-semibold ${item === "Tee Sheet" ? "bg-[#4533ff]" : "hover:bg-white/10"}`}
                href={href}
                key={item}
              >
                {item}
              </a>
            ))}
          </nav>
          <div className="mx-3 mt-4 bg-[#fffbd5] p-3 text-[11px] leading-5 text-[#2f2f21]">
            <p className="font-bold">Note</p>
            <p>John&apos;s Mobile #: 905-512-8755</p>
            <p>Login: Chronogolf</p>
            <p>Course: Pelham Hills</p>
          </div>
        </aside>

        {/* 암시적 컬럼 트랙도 minmax(0,1fr) 로 못박는다 (위와 같은 이유).
            행: 헤더(auto) / 티 시트(남는 높이 전부) / Operations(auto) / 상세(auto).
            minmax(0,1fr) 이어야 티 시트 칸이 내용 높이만큼 부풀지 않고 내부 스크롤한다. */}
        <section className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
          {/* DateNav 은 Fragment 로 header + 툴바 + 토스트를 반환한다. 감싸지 않으면
              각각이 별도 grid 아이템이 되어 행 배정이 밀리고, minmax(0,1fr) 트랙에
              걸린 툴바가 0 높이로 눌려 사라진다. */}
          <div className="min-w-0">
            <DateNav controller={controller} onAdd={openBlankDialog} />
          </div>

          <section className="min-h-0 min-w-0 overflow-hidden px-4 pt-3 pb-2">
            <WeekGrid controller={controller} onCreateAt={openDialogAt} />
          </section>

          {/* Operations 와 상세 패널은 하나의 하단 영역을 공유하고 그 안에서만 스크롤한다.
              따로 두면 Operations 를 펼쳤을 때(펼침 상태가 localStorage 에 남는다)
              티 시트가 100px 남짓까지 짓눌린다. 이 상한이 티 시트의 최소 높이를 보장한다. */}
          <div className="max-h-[52vh] min-h-0 overflow-y-auto">
            <div className="px-4 pb-2">
              <OrchestrationPanel controller={controller} />
            </div>
            <ReservationDetail controller={controller} />
          </div>
        </section>
      </div>

      <BookingDialog
        controller={controller}
        initial={dialogSeed.current}
        onClose={() => setDialogOpen(false)}
        open={dialogOpen}
      />
    </main>
  );
}
