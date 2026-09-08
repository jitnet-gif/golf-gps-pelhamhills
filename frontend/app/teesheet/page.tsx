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
    <AdminShell
      actions={
        // 레퍼런스에서는 파란 Add 버튼이 상단바 오른쪽 끝에 있다. 예전에는 티 시트가
        // 자기 헤더 줄을 하나 더 그려서 거기 달았는데, 그래서 화면 머리가 세 겹이었다.
        <button
          className="inline-flex min-h-11 items-center gap-1 bg-[#4533ff] px-4 text-xs font-bold text-white lg:min-h-0 lg:py-1.5"
          onClick={openBlankDialog}
          type="button"
        >
          Add
          <span aria-hidden className="text-[9px] leading-none">
            &#9662;
          </span>
        </button>
      }
      fill
      title="Tee Sheet"
    >
        {/* 암시적 컬럼 트랙도 minmax(0,1fr) 로 못박는다 (위와 같은 이유).
            행: 헤더(auto) / 티 시트(남는 높이 전부) / 상세(auto).
            minmax(0,1fr) 이어야 티 시트 칸이 내용 높이만큼 부풀지 않고 내부 스크롤한다. */}
        {/* 하단은 언제나 `auto` — 상세 패널이 **자기 내용 높이**만 가져간다.
            예전에는 예약을 고르면 티 시트와 상세가 1fr 씩 반반으로 나눠 가졌는데,
            그러면 카드 넉 장이 400px 이 안 되는데도 늘 화면 절반을 먹어서 Discount ·
            Payment 줄과 노란 메모가 접힌 아래로 내려갔다. 티 시트가 절반 밑으로
            눌리는 것은 아래 `max-h-[50vh]` 가 막는다 — 그게 원래 이 1fr 의 역할이었다. */}
        <section className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
          {/* DateNav 은 Fragment 로 header + 툴바 + 토스트를 반환한다. 감싸지 않으면
              각각이 별도 grid 아이템이 되어 행 배정이 밀리고, minmax(0,1fr) 트랙에
              걸린 툴바가 0 높이로 눌려 사라진다. */}
          <div className="min-w-0">
            <DateNav controller={controller} />
          </div>

          <section className="min-h-0 min-w-0 overflow-hidden">
            <WeekGrid controller={controller} onCreateAt={openDialogAt} />
          </section>

          {/* 상세 패널은 하단 영역 안에서만 스크롤한다. 이 상한이 티 시트의 최소 높이를
              보장하므로, 예약을 선택해도 위의 티 시트는 항상 보인다.
              예약을 고르기 전에는 아예 렌더하지 않아 티 시트가 화면 전체를 쓴다.

              여기에는 Operations 바도 함께 있었지만 레퍼런스 화면에 없어서 뺐다
              (기능은 `/admin/integrations` 로 옮겼다 — 그 파일 머리말 참고).

              상한은 화면 절반이다. `max-h-1/2`(=50%) 를 쓰면 안 된다 — 이 칸은 `auto`
              트랙이라 백분율 상한이 화면이 아니라 **자기 콘텐츠 높이**를 기준으로 풀려서
              패널이 늘 절반만 보이고 잘렸다. AdminShell 의 fill 이 화면 높이(100dvh)를
              고정하므로 50vh 가 "화면 절반" 이라는 원래 의도 그대로다. */}
          <div className="max-h-[50vh] min-h-0 overflow-y-auto">
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
