"use client";

// 티 시트 화면 셸. 실제 동작은 useTeeSheet 컨트롤러와 각 패널 컴포넌트가 담당한다.
//
// 사이드바 마크업과 메뉴 배열은 여기 있었지만 `AdminShell` 로 옮겼다. 복사본이던 시절
// 이 화면의 사이드바는 `hidden lg:block` 이라 휴대폰에서는 메뉴가 통째로 사라졌고,
// 티 시트를 열면 다른 어드민 화면으로 갈 방법이 뒤로 가기밖에 없었다.
// 이 페이지는 `fill` 모드를 쓴다 — 페이지 자체는 스크롤하지 않고 격자/상세만 스크롤한다.
import { useCallback, useMemo, useRef, useState } from "react";

import AdminShell from "../../components/admin/AdminShell";
import BookingDialog, { SEATS_PER_TEE_TIME } from "../../components/teesheet/BookingDialog";
import DateNav from "../../components/teesheet/DateNav";
import ReservationDetail from "../../components/teesheet/ReservationDetail";
import WeekGrid from "../../components/teesheet/WeekGrid";
import { useTeeSheet } from "../../hooks/useTeeSheet";
import { GUEST_NAME } from "@/lib/teeSheet/tone";

export default function TeeSheetPage() {
  const controller = useTeeSheet();
  // 컨트롤러 객체는 useMemo 지만 bookings·busy·toasts 에 딸려 있어 변경 한 번마다
  // 새로 만들어진다. 아래 콜백이 통째로 그 객체에 의존하면 격자(셀 버튼 수백 개)가
  // 그때마다 다시 그려지므로, 쓰는 것만 꺼내 쓴다 — 이 넷은 useCallback 으로 고정이다.
  const { bookings, createBooking, focusedDate, select, setFocusedDate, slots } = controller;
  // 다이얼로그는 이제 **막다른 길을 막는 용도**로만 남는다 (아래 addReservation 참고).
  const [dialogOpen, setDialogOpen] = useState(false);
  // 예전에는 빈 칸이 넘겨주는 날짜·시각을 ref 에 담아 뒀는데, 그 ref 를 렌더 중에
  // 읽는 바람에 react-hooks/refs 가 걸렸다. 지금 시드는 "보고 있는 날짜" 하나뿐이라
  // 그냥 계산하면 된다.
  const dialogSeed = useMemo(() => ({ date: focusedDate }), [focusedDate]);

  // 격자의 빈 칸(`+`)은 더 이상 다이얼로그를 띄우지 않는다. 예약 한 건을 그 자리에
  // 바로 만들고 곧장 선택해서, 아래 상세 패널이 그대로 열리게 한다 — 클릭 한 번에
  // 이름·요금제·결제를 편집하는 그 화면이다. 상세 패널은 이미 플레이어 단위 자동
  // 저장(debounce)이라 다이얼로그가 하던 "폼을 채우고 Create" 단계가 통째로 필요 없다.
  //
  // 빈 칸은 좌석이 남은 자리에만 그려지므로 정원 검사는 여기서 다시 하지 않는다.
  // 남의 브라우저가 먼저 채워 경합이 나면 서버의 require_capacity 가 막고
  // controller 가 에러 토스트를 띄운다 (createBooking 이 null 을 돌려준다).
  //
  // 중복 생성만 막는다. `controller.busy` 를 보면 안 된다 — 상세 패널의 이름 입력이
  // 0.7초마다 patchPlayer 를 날리며 같은 busy 를 켜므로, 이름을 치다가 다른 칸을
  // 누르면 아무 일도 일어나지 않는 "눌렀는데 안 나오는" 상태가 된다. 그건 지금
  // 고치려는 바로 그 증상이다. 막아야 할 건 이 칸의 더블클릭뿐이다.
  const creatingRef = useRef(false);
  const createAt = useCallback(
    async (date: string, time: string) => {
      if (creatingRef.current) return;
      creatingRef.current = true;

      try {
        // 상세 패널의 티 타임 드롭다운은 controller.slots(= focusedDate 의 슬롯)에서
        // 나온다. 주간 뷰에서 다른 날 칸을 눌렀다면 시트를 그 날로 옮겨야 방금 만든
        // 예약과 슬롯 목록이 같은 날을 가리킨다 (다이얼로그도 같은 일을 했다).
        if (date !== focusedDate) setFocusedDate(date);

        // 이름 없는 자리는 "Guest" 다. title 은 서버 필수값이고 주간 뷰 막대에 찍히는
        // 이름이라 비워 둘 수 없는데, 서버도 빈 이름의 플레이어를 "Guest" 로 채우므로
        // (`pelham_tee_name`) 둘을 같은 말로 맞춘다. 상세 패널에서 이름을 적으면
        // 플레이어와 title 이 같이 바뀐다 (ReservationDetail 의 commitPlayer 참고).
        //
        // 빈 플레이어 한 명을 같이 만든다: 0명짜리 예약은 좌석을 잡지 않아서
        // 누른 칸이 그대로 `+` 로 남고, 격자 대신 off-grid 줄에 떨어진다.
        //
        // `type` 은 반드시 "Existing Customer" 로 넘긴다. 서버 기본값인 "Guest" 로 두면
        // 일 시트 셀이 `player.type === "Guest"` 를 보고 이름 대신 늘 <em>Guest</em> 를
        // 그린다(WeekGrid) — 직원이 이름을 다 적어도 격자는 영영 "Guest" 다.
        // 이름 없는 자리를 Guest 로 부르는 일은 playerLabel 의 폴백이 이미 한다.
        const created = await createBooking({
          date,
          time,
          title: GUEST_NAME,
          players: [{ firstName: "", lastName: "", type: "Existing Customer" }],
        });

        // 실패하면 controller 가 이미 토스트를 띄웠다. 여기서는 아무것도 열지 않는다.
        if (created) select(created.id);
      } finally {
        creatingRef.current = false;
      }
    },
    [createBooking, focusedDate, select, setFocusedDate],
  );

  /**
   * 보고 있는 날짜에서 **자리가 남은 가장 이른 티 타임**. 없으면 null.
   *
   * 취소된 예약은 좌석을 잡지 않는다 (백엔드의 정원 계산과 같은 규칙).
   * 슬롯은 분 단위로 정렬해서 본다 — "6:58 AM" 같은 라벨을 문자열로 비교하면
   * 오전 10시가 오전 7시보다 앞에 온다.
   */
  const firstFreeTime = useMemo(() => {
    const taken = new Map<string, number>();
    for (const booking of bookings) {
      if (booking.date !== focusedDate || booking.status === "cancelled") continue;
      taken.set(booking.time, (taken.get(booking.time) ?? 0) + booking.players.length);
    }
    return (
      [...slots]
        .sort((a, b) => a.minutes - b.minutes)
        .find((slot) => (taken.get(slot.time) ?? 0) < SEATS_PER_TEE_TIME)?.time ?? null
    );
  }, [bookings, focusedDate, slots]);

  /**
   * 상단바의 Add. 격자의 빈 칸과 같은 결과를 내야 한다 — 창을 띄우지 않고 예약을
   * 만들어 아래 상세 패널을 연다. 다른 점은 누른 자리가 없다는 것뿐이라, 그 날의
   * 첫 빈 타임을 대신 고른다. 타임이 틀렸으면 패널 안의 날짜·티 타임 드롭다운으로
   * 바로 옮길 수 있다.
   *
   * 그 날이 꽉 찼거나 슬롯이 아직 안 왔으면 다이얼로그를 연다. 버튼이 아무 반응도
   * 없는 것보다 낫고, 거기서는 다른 날짜를 고를 수 있다.
   */
  const addReservation = useCallback(() => {
    if (firstFreeTime) void createAt(focusedDate, firstFreeTime);
    else setDialogOpen(true);
  }, [createAt, firstFreeTime, focusedDate]);

  // 한 화면 고정: 페이지 자체는 절대 스크롤하지 않고, 티 시트와 상세 패널이
  // 각자 내부에서만 스크롤한다. 그래야 예약을 클릭했을 때 격자와 상세가 동시에 보인다.
  return (
    <AdminShell
      actions={
        // 레퍼런스에서는 파란 Add 버튼이 상단바 오른쪽 끝에 있다. 예전에는 티 시트가
        // 자기 헤더 줄을 하나 더 그려서 거기 달았는데, 그래서 화면 머리가 세 겹이었다.
        <button
          className="inline-flex min-h-11 items-center gap-1 bg-[#4533ff] px-4 text-xs font-bold text-white lg:min-h-0 lg:py-1.5"
          onClick={addReservation}
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
            <WeekGrid controller={controller} onCreateAt={createAt} />
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
        initial={dialogSeed}
        onClose={() => setDialogOpen(false)}
        open={dialogOpen}
      />
    </AdminShell>
  );
}
