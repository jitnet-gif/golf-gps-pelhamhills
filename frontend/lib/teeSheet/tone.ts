// 플레이어 톤(색)의 단일 소유자.
//
// 왜 별도 파일인가: 일간 시트(WeekGrid 의 day 브랜치)와 예약 상세 패널이
// 같은 플레이어를 서로 다른 색으로 그리면 사용자는 "다른 예약"으로 오해한다.
// 그래서 색 판정 규칙은 오직 여기 한 곳에만 둔다. 화면 쪽에서는 절대
// ratePlan / type 을 다시 들여다보고 색을 고르지 않는다.
//
// 색 체계가 두 개라는 점을 반드시 기억할 것:
//   1) `booking.color` ("blue" | "gold" | "gray") 는 여전히 **주간 뷰**의
//      COLOR_CLASS 막대 색을 결정한다. 이건 예약 단위 색이다.
//   2) **일간 시트**에서는 셀 배경이 플레이어 단위 톤(아래 PlayerTone)이며,
//      booking.color 중에서는 "blue" 만 의미가 있다 — GolfNow 같은 외부
//      온라인 채널 예약 표시. "gold"/"gray" 는 일간 시트에서 무시된다.
// 다음 사람이 두 체계를 헷갈리지 않도록 여기 명시해 둔다.

import type { Player, TeeBooking } from "@/lib/teeSheet/types";

export type PlayerTone = "member" | "full" | "guest" | "online";

/**
 * 우선순위 규칙 (위에서 먼저 맞는 것으로 결정):
 *   1. booking.color === "blue"  → "online"  (예약 전체가 온라인/외부 채널)
 *   2. player.type === "Guest"   → "guest"
 *   3. player.ratePlan 이 "Full Member" 로 시작 → "full"
 *   4. 그 외                      → "member"
 *
 * 1번이 플레이어 단위 규칙보다 위에 있는 이유: 온라인 채널 예약은 정산 주체가
 * 클럽이 아니라 채널이므로, 그 안의 개별 요금제보다 "어디서 들어온 예약인가"가
 * 프런트 데스크에 더 중요한 정보다.
 */
export function playerTone(booking: TeeBooking, player: Player): PlayerTone {
  if (booking.color === "blue") return "online";
  if (player.type === "Guest") return "guest";
  if (player.ratePlan.trim().startsWith("Full Member")) return "full";
  return "member";
}

/** Chronogolf 스크린샷에서 샘플링한 실제 색. Tailwind 가 스캔할 수 있도록 리터럴로 둔다. */
export const TONE_CLASS: Record<PlayerTone, string> = {
  member: "bg-[#e3bfd4] text-[#2b1f27]",
  full: "bg-[#d6219b] text-white",
  guest: "bg-[#ffd400] text-[#1d232b]",
  online: "bg-[#0a58ca] text-white",
};

/** 플레이어가 죽은 상태(취소/노쇼)인지 — 셀에 취소선을 그을지 결정한다. */
export function isDeadPlayer(player: Player): boolean {
  return player.cancelled || player.no_show;
}

/**
 * 이름 표기는 Chronogolf 방식인 `Lastname, Firstname`.
 * Guest 는 이름 대신 "Guest" 를 이탤릭으로 — 아직 신원이 없는 자리라는 뜻이다.
 *
 * 이름이 하나도 없으면 "Guest" 다. 예전에는 "Player" 였는데, 이름 없는 자리를
 * 부르는 말이 화면마다 달라졌다 — 서버도(`pelham_tee_name`) 빈 이름을 "Guest" 로
 * 채우고, 격자의 Guest 칸도 그렇게 읽는다. 한 단어로 통일한다.
 */
export function playerLabel(player: Player): string {
  const last = player.lastName.trim();
  const first = player.firstName.trim();
  if (last && first) return `${last}, ${first}`;
  return last || first || player.name.trim() || GUEST_NAME;
}

/** 이름이 없는 자리를 부르는 이름. 서버의 `pelham_tee_name` 과 같은 값이어야 한다. */
export const GUEST_NAME = "Guest";

/**
 * 격자 막대(주간 뷰)에 찍히는 예약 이름. 대표자(첫 플레이어) 이름을 그대로 쓴다.
 *
 * 예약의 `title` 은 서버 필수값이라 만들 때 한 번 정해지는데, 그 뒤 상세 패널에서
 * 이름을 고쳐도 자동으로 따라가지 않는다(서버에 동기화 규칙이 없다). 그래서
 * "지금 이름이라면 title 이 무엇이어야 하는가" 를 이 함수 하나로 정해 두고,
 * 상세 패널이 이름을 저장할 때 같은 값으로 title 도 맞춘다.
 */
export function reservationTitle(players: Player[]): string {
  const lead = players[0];
  return lead ? playerLabel(lead) : GUEST_NAME;
}
