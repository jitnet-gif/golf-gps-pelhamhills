/**
 * Code 128 (subset B) 바코드 - 지갑의 기프트카드(GIFT-…)·개인 쿠폰(CPN-…)을 프로 샵 스캐너가 읽게 그립니다.
 *
 * pelhamhills `frontend/lib/retail/barcode.ts` 의 표와 체크섬을 그대로 옮겼습니다. 그쪽 표는 실제 해독기로
 * 전부 읽어 확인한 것입니다(2026-09-15, pyzbar) - 고치면 두 곳을 같이 고칩니다.
 */

/**
 * 기호 값 0–106 의 막대·공백 폭(모듈 단위). 막대부터 막대·공백을 번갈아 적는다.
 * 103/104/105 는 시작 A/B/C, 106 은 정지 기호(원소 7개, 13모듈)다.
 */
export const CODE128_PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_B = 104;
const STOP = 106;
/** 앞뒤로 비워 둘 모듈 수. 규격 최소값이다 — 좁으면 스캐너가 시작 기호를 못 찾는다. */
const QUIET_ZONE = 10;

/**
 * 문자열 → 기호 값 배열: `[시작 B, 데이터…, 체크섬, 정지]`.
 * 체크섬은 시작 값 + Σ(자리 번호 × 값) 을 103 으로 나눈 나머지다.
 * subset B 는 인쇄 가능한 ASCII(32–126)만 담는다. 그 밖의 글자는 던진다.
 */
export function code128Values(text: string): number[] {
  const data: number[] = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char.length !== 1 || code < 32 || code > 126) {
      throw new Error(`Code 128 B cannot encode ${JSON.stringify(char)}`);
    }
    data.push(code - 32);
  }
  let sum = START_B;
  data.forEach((value, index) => {
    sum += value * (index + 1);
  });
  return [START_B, ...data, sum % 103, STOP];
}

/**
 * 막대만 그린 SVG 문자열. 좌표 단위는 모듈이고, 인쇄 폭과 높이는 CSS 가 정한다
 * (`preserveAspectRatio="none"`). 사람이 읽는 번호는 호출하는 쪽이 아래에 따로 적는다.
 */
export function code128Svg(text: string): string {
  const widths = code128Values(text).flatMap((value) => [...CODE128_PATTERNS[value]].map(Number));
  const total = widths.reduce((sum, width) => sum + width, 0) + QUIET_ZONE * 2;
  const bars: string[] = [];
  let x = QUIET_ZONE;
  widths.forEach((width, index) => {
    // 모든 기호가 막대로 시작하고 원소 수가 짝수(정지 기호만 7개로 끝)라 짝수 번째가 막대다.
    if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="1"/>`);
    x += width;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 1" preserveAspectRatio="none" ` +
    `shape-rendering="crispEdges" aria-hidden="true">${bars.join("")}</svg>`
  );
}
