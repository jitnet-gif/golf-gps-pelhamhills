/**
 * 클럽 영업시간 — 홈페이지의 "Visit" 표와 푸터 요약이 **같은 배열**을 읽는다.
 *
 * 왜 모듈로 뺐는가: 시간이 바뀌면 사람은 눈에 띄는 큰 표만 고치고 푸터의 작은
 * 글씨는 잊는다. 그러면 같은 페이지 안에서 두 가지 영업시간이 동시에 보인다.
 * `lib/nav.ts` 의 `CLUB` 이 주소·전화를 한 곳에 모은 것과 같은 이유다.
 */

export type ClubHours = {
  label: string;
  value: string;
  /** 푸터의 좁은 칸에도 올릴 만큼 중요한 줄인지. false 면 홈의 표에만 나온다. */
  primary: boolean;
};

export const clubHours: ClubHours[] = [
  { label: "Pro Shop", value: "Daily 6:30 - Dark", primary: true },
  { label: "Snack Bar", value: "Monday - Sunday 10:00am - 6:00pm", primary: true },
  { label: "PH Indoor Golf", value: "Wednesday - Sunday 2:00pm - 10:00pm", primary: true },
  { label: "Monday - Tuesday", value: "Indoor Golf Closed", primary: false },
];
