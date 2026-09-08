/**
 * 옛 시뮬레이터 예약 주소. 화면은 `app/book/indoor/page.tsx` 로 옮겨 갔지만
 * 이 주소는 죽이지 않는다 — 명함·전단·검색 결과에 `/simulator` 가 이미 나가 있고,
 * 정적 export 에는 리다이렉트를 걸 미들웨어도 rewrite 도 없다.
 *
 * `app/admin/page.tsx` 가 티 시트를 재수출하는 것과 같은 방식이다.
 */

export { default } from "../book/indoor/page";
