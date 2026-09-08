"use client";

// 티 시트 화면 셸. 실제 동작은 useTeeSheet 컨트롤러와 각 패널 컴포넌트가 담당한다.
//
// 사이드바 마크업과 메뉴 배열은 여기 있었지만 `AdminShell` 로 옮겼다. 복사본이던 시절
// 이 화면의 사이드바는 `hidden lg:block` 이라 휴대폰에서는 메뉴가 통째로 사라졌고,
// 티 시트를 열면 다른 어드민 화면으로 갈 방법이 뒤로 가기밖에 없었다.
// 이 페이지는 `fill` 모드를 쓴다 — 페이지 자체는 스크롤하지 않고 격자/상세만 스크롤한다.
import { useCallback, useRef, useState } from "react";

import AdminShell from "../../components/admin/AdminShell";
import BookingDialog from "../../components/teesheet/BookingDialog";
import DateNav from "../../components/teesheet/DateNav";
import OrchestrationPanel from "../../components/teesheet/OrchestrationPanel";
import ReservationDetail from "../../components/teesheet/ReservationDetail";
import WeekGrid from "../../components/teesheet/WeekGrid";
import { useTeeSheet } from "../../hooks/useTeeSheet";

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
    <AdminShell fill title="Tee Sheet">
        {/* 암시적 컬럼 트랙도 minmax(0,1fr) 로 못박는다 (위와 같은 이유).
            행: 헤더(auto) / 티 시트(남는 높이 전부) / Operations(auto) / 상세(auto).
            minmax(0,1fr) 이어야 티 시트 칸이 내용 높이만큼 부풀지 않고 내부 스크롤한다. */}
        {/* 예약을 고르면 헤더 아래 공간을 티 시트와 상세가 반씩 나눠 갖는다(둘 다 1fr).
            고정 vh 상한을 쓰면 화면이 낮을 때 티 시트가 4행까지 눌린다.
            고르기 전에는 하단이 auto 라서 티 시트가 화면 전체를 쓴다. */}
        <section
          className={`grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] ${
            controller.selected
              ? "grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)]"
              : "grid-rows-[auto_minmax(0,1fr)_auto]"
          }`}
        >
          {/* DateNav 은 Fragment 로 header + 툴바 + 토스트를 반환한다. 감싸지 않으면
              각각이 별도 grid 아이템이 되어 행 배정이 밀리고, minmax(0,1fr) 트랙에
              걸린 툴바가 0 높이로 눌려 사라진다. */}
          <div className="min-w-0">
            <DateNav controller={controller} onAdd={openBlankDialog} />
          </div>

          <section className="min-h-0 min-w-0 overflow-hidden">
            <WeekGrid controller={controller} onCreateAt={openDialogAt} />
          </section>

          {/* Operations 와 상세 패널은 하나의 하단 영역을 공유하고 그 안에서만 스크롤한다.
              따로 두면 Operations 를 펼쳤을 때(펼침 상태가 localStorage 에 남는다)
              티 시트가 100px 남짓까지 짓눌린다. 이 상한이 티 시트의 최소 높이를 보장하므로,
              예약을 선택해도 위의 티 시트는 항상 보인다.
              예약을 고르기 전에는 상세 패널을 아예 렌더하지 않아 티 시트가 화면 전체를 쓴다. */}
          {/* 상한은 화면 절반: 예약을 고르지 않았는데 Operations 를 펼쳐둔 경우에도
              하단이 티 시트를 절반 밑으로 밀어내지 못하게 막는다.
              `max-h-1/2`(=50%) 를 쓰면 안 된다 — 이 칸은 `auto` 트랙이라 백분율 상한이
              화면이 아니라 **자기 콘텐츠 높이**를 기준으로 풀려서, 접힌 Operations 바가
              늘 절반만 보이고 잘렸다. AdminShell 의 fill 이 화면 높이(100dvh)를 고정하므로
              50vh 가 "화면 절반" 이라는 원래 의도 그대로다. */}
          <div className="max-h-[50vh] min-h-0 overflow-y-auto">
            <div className="px-3 pt-1.5 pb-1.5">
              <OrchestrationPanel controller={controller} />
            </div>
            {controller.selected ? <ReservationDetail controller={controller} /> : null}
          </div>
        </section>

      <BookingDialog
        controller={controller}
        initial={dialogSeed.current}
        onClose={() => setDialogOpen(false)}
        open={dialogOpen}
      />
    </AdminShell>
  );
}
