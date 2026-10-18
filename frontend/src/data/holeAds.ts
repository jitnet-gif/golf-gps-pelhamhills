/**
 * The club's two on-course offers: food before the turn, a beer after the round.
 *
 * Kept here rather than in the `promotions` table because these two are fixed -
 * the club wrote them once, they name the holes they belong to, and they have to
 * appear on a fairway with no signal. A banner that needs a fetch is a banner
 * that is blank exactly where it is meant to work.
 *
 * The club wrote both lines in Korean; they are quoted under each entry below.
 * What ships is the club's meaning in English, because that is the language of
 * this app, of the pro shop's printed boards and of most of the tee sheet. If
 * the club ever wants the Korean back on screen, the words are right here and
 * `LANG` is the other half of the change.
 */

export interface HoleAd {
  /** The hole whose tee brings this up. */
  holeNumber: number;
  /** The heading on the card - never spoken. */
  title: string;
  /** The offer itself, on screen and in the voice. */
  body: string;
  /** The button that takes the player to /food. */
  cta: string;
}

/** What the voice reads these in. The rest of the app speaks en-US too. */
export const HOLE_AD_LANG = 'en-US';

export const HOLE_ADS: HoleAd[] = [
  {
    holeNumber: 8,
    // 배고프지 않으신가요? 시원한 음료와 음식을 즐길수 있는 절호의 기회
    // 지금 주문하셔서 9홀 끝나고 바로 픽업하세요
    title: 'Pick up after the 9th',
    body: 'Hungry? Here is your chance for a cold drink and something to eat. Order now and pick it up the moment you finish the 9th.',
    cta: 'Order now',
  },
  {
    holeNumber: 17,
    // 오늘의 나이스 플레이 골프 , 동료와 시원한 맥주 한잔의 여유 즐기세요?
    title: 'A cold beer to finish',
    body: 'Nice round of golf today. Why not take it easy with your playing partners over a cold beer?',
    cta: 'Order a beer',
  },
];

/** The offer for a hole, if it has one. */
export const holeAdFor = (holeNumber: number | null): HoleAd | null =>
  holeNumber === null ? null : (HOLE_ADS.find((ad) => ad.holeNumber === holeNumber) ?? null);

/** Whether this hole carries an offer - cheap enough to call on every fix. */
export const hasHoleAd = (holeNumber: number): boolean =>
  HOLE_ADS.some((ad) => ad.holeNumber === holeNumber);
