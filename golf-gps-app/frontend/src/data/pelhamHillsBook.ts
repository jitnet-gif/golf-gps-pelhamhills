// Pelham Hills Golf Club - the club's own printed yardage book.
//
// Transcribed from the scanned book (18 hole pages + the front/back nine
// scorecard spread). Every yardage column below was checked against the OUT,
// IN and TOTAL figures printed on the scorecard and all six columns add up:
//
//   Blue 3534 + 3369 = 6903    White        3270 + 3093 = 6363
//   White/Yellow     = 6002    Yellow       3002 + 2850 = 5852
//   Yellow/Red       = 5063    Red          2439 + 2441 = 4880
//   Par 36 + 35 = 71           Handicaps 1-18 each used exactly once
//
// This file is the authority for par, handicap, yardage and hole commentary.
// Coordinates live in pelhamHills.ts (surveyed from OpenStreetMap) - the two
// are joined by hole number, and that join is NOT safe to assume: see
// PELHAM_HILLS_BOOK_NOTES at the bottom.

/** The six columns printed on the scorecard, in printed order. */
export type TeeSet =
  | 'blue'
  | 'white'
  | 'whiteYellow'
  | 'yellow'
  | 'yellowRed'
  | 'red';

/** The four physical tee markers a player actually stands on. */
export type TeeMarker = 'blue' | 'white' | 'yellow' | 'red';

export interface TeeYardages {
  blue: number;
  white: number;
  whiteYellow: number;
  yellow: number;
  yellowRed: number;
  red: number;
}

/**
 * One of the distance callouts drawn on a hole diagram: the same landmark
 * measured from each of the four tees.
 *
 * The book prints these as four coloured dots with no caption, so the landmark
 * itself is unnamed here rather than guessed at - it is typically the carry to
 * or over the hazard the arrow touches.
 */
export interface TeeCarry {
  red: number;
  yellow: number;
  white: number;
  blue: number;
}

export interface BookHole {
  holeNumber: number;
  par: number;
  handicap: number;
  yards: TeeYardages;
  /** Green depth in yards, printed in the circle beside each diagram. */
  greenDepth: number;
  /** The club's own commentary, quoted verbatim - this is the spoken guide. */
  description: string;
  /** Distance callouts from the four tees, in the order the book draws them. */
  teeCarries: TeeCarry[];
  /**
   * The unlabelled arrow figures the book prints near the green - by yardage
   * book convention the distance from that hazard to the green, but the book
   * gives no legend, so they are kept as printed and not interpreted.
   */
  greenArrows: number[];
}

export const PELHAM_HILLS_TEES: {
  id: TeeSet;
  label: string;
  marker: TeeMarker;
  totalYards: number;
}[] = [
  { id: 'blue', label: 'Blue', marker: 'blue', totalYards: 6903 },
  { id: 'white', label: 'White', marker: 'white', totalYards: 6363 },
  { id: 'whiteYellow', label: 'White/Yellow', marker: 'white', totalYards: 6002 },
  { id: 'yellow', label: 'Yellow', marker: 'yellow', totalYards: 5852 },
  { id: 'yellowRed', label: 'Yellow/Red', marker: 'yellow', totalYards: 5063 },
  { id: 'red', label: 'Red', marker: 'red', totalYards: 4880 },
];

export const PELHAM_HILLS_BOOK: BookHole[] = [
  {
    holeNumber: 1,
    par: 4,
    handicap: 1,
    yards: { blue: 470, white: 435, whiteYellow: 370, yellow: 370, yellowRed: 243, red: 243 },
    greenDepth: 24,
    description:
      'Your tee shot must hit the fairway some length. You drive over a large pond ' +
      'to a fairway guarded by trees down both sides. Your approach shot is slightly ' +
      'elevated to a green that is protected everywhere. Aim for the fat part of the ' +
      'green. A par here is a very good score.',
    teeCarries: [
      { red: 93, yellow: 220, white: 285, blue: 320 },
      { red: 0, yellow: 170, white: 235, blue: 270 },
    ],
    greenArrows: [43],
  },
  {
    holeNumber: 2,
    par: 4,
    handicap: 15,
    yards: { blue: 350, white: 335, whiteYellow: 290, yellow: 290, yellowRed: 290, red: 253 },
    greenDepth: 28,
    description:
      'This is a simple par four. You get what you see on this hole with a bunker on the left.',
    teeCarries: [{ red: 153, yellow: 190, white: 235, blue: 250 }],
    greenArrows: [45],
  },
  {
    holeNumber: 3,
    par: 5,
    handicap: 3,
    yards: { blue: 561, white: 529, whiteYellow: 529, yellow: 501, yellowRed: 424, red: 424 },
    greenDepth: 33,
    description:
      'High numbers can be made here just as easily as a birdie. Driver not needed off ' +
      'tee. Keep the ball in play and when you lay up with your second shot remember ' +
      "you're hitting to a fairway, not a green. The ball will roll and the pond jaunts " +
      'out from the green to just short of the 100-yard marker.',
    teeCarries: [{ red: 174, yellow: 251, white: 279, blue: 311 }],
    greenArrows: [81, 50],
  },
  {
    holeNumber: 4,
    par: 4,
    handicap: 11,
    yards: { blue: 403, white: 361, whiteYellow: 361, yellow: 347, yellowRed: 347, red: 333 },
    greenDepth: 29,
    description:
      'Good driving hole with two large mounds right and the odd tree on the left. What ' +
      'makes this hole tough is the water hazard that runs in front of the green only ' +
      'six feet wide but tight to the green. Center of green is a good shot in here.',
    teeCarries: [{ red: 183, yellow: 197, white: 211, blue: 253 }],
    greenArrows: [22],
  },
  {
    holeNumber: 5,
    par: 3,
    handicap: 13,
    yards: { blue: 228, white: 187, whiteYellow: 170, yellow: 170, yellowRed: 146, red: 146 },
    greenDepth: 38,
    description:
      'One of the toughest par 3s you will play anywhere, especially from the tips. You ' +
      'have to carry a large pond that stretches from tee to green, large bunker on the ' +
      'left with a small forest on the right and a creek that runs behind, all protect ' +
      'this large green. Center of green, two putt and walk away.',
    teeCarries: [],
    greenArrows: [41],
  },
  {
    holeNumber: 6,
    par: 5,
    handicap: 5,
    yards: { blue: 576, white: 528, whiteYellow: 478, yellow: 478, yellowRed: 384, red: 384 },
    greenDepth: 33,
    description:
      'This hole is reachable in two for the longer hitters. The fairway runs out at the ' +
      '150 yard marker and a creek runs through the hole just outside the 100 yard maker. ' +
      'Be sure of your yardage when choosing what you want to do with your second shot.',
    teeCarries: [
      { red: 184, yellow: 278, white: 328, blue: 376 },
      { red: 84, yellow: 178, white: 228, blue: 276 },
    ],
    greenArrows: [50, 114],
  },
  {
    holeNumber: 7,
    par: 3,
    handicap: 17,
    yards: { blue: 164, white: 150, whiteYellow: 150, yellow: 139, yellowRed: 139, red: 120 },
    greenDepth: 24,
    description:
      'A pretty little hole with bunkers short, long and right of the green. A large ' +
      'willow tree protects the right side of this large but narrow green. This can be a ' +
      'tough hole for such a short hole depending on where they place the pin.',
    teeCarries: [],
    greenArrows: [27, 52],
  },
  {
    holeNumber: 8,
    par: 4,
    handicap: 9,
    yards: { blue: 374, white: 354, whiteYellow: 340, yellow: 340, yellowRed: 295, red: 295 },
    greenDepth: 25,
    description:
      'Depending on the wind you can carry the creek from the tee. From the white tee to ' +
      'carry the creek is 225 yards at the bridge. The green is elevated and plays half ' +
      'to one club longer than the yardage.',
    teeCarries: [
      { red: 195, yellow: 240, white: 254, blue: 274 },
      { red: 145, yellow: 190, white: 204, blue: 224 },
    ],
    greenArrows: [50],
  },
  {
    holeNumber: 9,
    par: 4,
    handicap: 7,
    yards: { blue: 408, white: 391, whiteYellow: 367, yellow: 367, yellowRed: 241, red: 241 },
    greenDepth: 32,
    description:
      'This is a good finishing hole for the front nine with, out of bounds down the ' +
      'entire right side and trees down the left. Hitting the fairway is important so you ' +
      'can attack the pin on this large green protected by a front bunker.',
    teeCarries: [
      { red: 191, yellow: 217, white: 241, blue: 258 },
      { red: 241, yellow: 267, white: 291, blue: 308 },
    ],
    greenArrows: [50],
  },
  {
    holeNumber: 10,
    par: 5,
    handicap: 8,
    yards: { blue: 530, white: 470, whiteYellow: 470, yellow: 450, yellowRed: 420, red: 420 },
    greenDepth: 30,
    description:
      'A good drive makes this par 5 starting hole reachable in two. A quality second ' +
      'shot is required since the green is protected by a gully, three bunkers and trees. ' +
      'If you cannot get there in two, lay up to a short iron and attack the pin.',
    teeCarries: [{ red: 170, yellow: 200, white: 220, blue: 280 }],
    greenArrows: [],
  },
  {
    holeNumber: 11,
    par: 4,
    handicap: 2,
    yards: { blue: 405, white: 378, whiteYellow: 355, yellow: 355, yellowRed: 314, red: 314 },
    greenDepth: 26,
    description:
      'Hitting the fairway from the tee is required with trees lurking on right and two ' +
      'large trees and lateral hazard on the left side with the green protected by a large ' +
      'valley. Make sure you hit enough club into the green or you can watch your ball ' +
      'roll all the way back down.',
    teeCarries: [{ red: 164, yellow: 205, white: 228, blue: 255 }],
    greenArrows: [50],
  },
  {
    holeNumber: 12,
    par: 3,
    handicap: 14,
    yards: { blue: 207, white: 180, whiteYellow: 154, yellow: 154, yellowRed: 154, red: 140 },
    greenDepth: 20,
    description:
      'A lateral hazard protects the left side on hole three. Being too aggressive and ' +
      'hitting at the pin when it is tucked to one side or the other can bring a large ' +
      'number into play. Hit the center of the green and leave yourself a birdie putt of ' +
      'no longer than 20-25 feet.',
    teeCarries: [],
    greenArrows: [],
  },
  {
    holeNumber: 13,
    par: 4,
    handicap: 18,
    yards: { blue: 473, white: 440, whiteYellow: 400, yellow: 400, yellowRed: 321, red: 321 },
    greenDepth: 25,
    description:
      'A short but not-easy par 5 with a narrow fairway, many trees and mounds on both ' +
      'sides. Small green protected by a pond on the left while a lateral hazard guards ' +
      'the right and back. A bad tee shot could bring a large number into play.',
    teeCarries: [
      { red: 71, yellow: 150, white: 190, blue: 223 },
      { red: 121, yellow: 200, white: 240, blue: 273 },
    ],
    greenArrows: [67, 50],
  },
  {
    holeNumber: 14,
    par: 4,
    handicap: 6,
    yards: { blue: 400, white: 385, whiteYellow: 366, yellow: 366, yellowRed: 327, red: 327 },
    greenDepth: 30,
    description:
      'Dogleg right with trees all the way down the right hand side between the fairway ' +
      'and green. Stay to the left side of the fairway, even if you do not hit the ball ' +
      'long enough, to go past the end of the trees. You will have a shot over the trees ' +
      'at the green from approximately 140 to 160 yards.',
    teeCarries: [{ red: 177, yellow: 216, white: 235, blue: 250 }],
    greenArrows: [],
  },
  {
    holeNumber: 15,
    par: 4,
    handicap: 10,
    yards: { blue: 386, white: 353, whiteYellow: 353, yellow: 328, yellowRed: 328, red: 258 },
    greenDepth: 30,
    description:
      'Short hole gives you a great chance for birdie here. Hit a club that will put you ' +
      'in the fairway, length off the tee is not your number one concern here, ball ' +
      'positioning is. There is trouble on both sides with a pond on the left and a large ' +
      'tree and valley on the right.',
    teeCarries: [{ red: 158, yellow: 228, white: 253, blue: 286 }],
    greenArrows: [],
  },
  {
    holeNumber: 16,
    par: 3,
    handicap: 12,
    yards: { blue: 187, white: 167, whiteYellow: 155, yellow: 155, yellowRed: 122, red: 122 },
    greenDepth: 22,
    description:
      'This hole plays uphill with a water hazard short and two grass bunkers in front. ' +
      'This tough little par 3 plays a half club longer, make sure you check out the flag ' +
      'for wind because you are protected from the wind on the tee.',
    teeCarries: [],
    greenArrows: [49],
  },
  {
    holeNumber: 17,
    par: 4,
    handicap: 16,
    yards: { blue: 396, white: 350, whiteYellow: 324, yellow: 324, yellowRed: 324, red: 295 },
    greenDepth: 31,
    description:
      'This is your risk/reward hole. You can hit the driver and try to hammer the ball ' +
      'all the way down to the green, but if you are not straight, you can be three off ' +
      'the tee right of you in stuck beside a tree left. Or, hit a club that will keep you ' +
      'in play 200-225 off the tee which will leave a wedge in to attack this pin and make ' +
      'your birdie.',
    teeCarries: [{ red: 195, yellow: 224, white: 250, blue: 296 }],
    greenArrows: [50],
  },
  {
    holeNumber: 18,
    par: 4,
    handicap: 4,
    yards: { blue: 385, white: 370, whiteYellow: 370, yellow: 318, yellowRed: 244, red: 244 },
    greenDepth: 34,
    description:
      'Great finishing hole. Your target is the 150 marker for your tee shot; trying to ' +
      'cut off the corner of the dogleg brings the trees into play. For the big hitter, ' +
      'the pond on the left is in play. Remember, the green is well protected. This is as ' +
      'close to an island green as you can get.',
    teeCarries: [
      { red: 144, yellow: 218, white: 270, blue: 285 },
      { red: 94, yellow: 168, white: 220, blue: 235 },
    ],
    greenArrows: [53],
  },
];

/** Out / In / Total for one tee set, as printed. */
export const PELHAM_HILLS_TOTALS: Record<TeeSet, { out: number; in: number; total: number }> = {
  blue: { out: 3534, in: 3369, total: 6903 },
  white: { out: 3270, in: 3093, total: 6363 },
  whiteYellow: { out: 3055, in: 2947, total: 6002 },
  yellow: { out: 3002, in: 2850, total: 5852 },
  yellowRed: { out: 2509, in: 2554, total: 5063 },
  red: { out: 2439, in: 2441, total: 4880 },
};

export const PELHAM_HILLS_PAR = { out: 36, in: 35, total: 71 } as const;

/**
 * Things the printed book contradicts itself about. Left as-is rather than
 * silently corrected, because the club's own card is what players compare against.
 *
 * - Hole 9: the hole page prints a red yardage of 341, the scorecard prints 241.
 *   The scorecard is used here - its 2439 front-nine red total only adds up with 241.
 * - Hole 13: the commentary calls it "a short but not-easy par 5" while both the
 *   hole page and the scorecard print Par 4 (Hcp 18). Par 4 is used.
 * - The unlabelled arrow figures near each green are recorded in `greenArrows`
 *   exactly as printed; the book supplies no legend for them.
 */
export const PELHAM_HILLS_BOOK_NOTES = [
  'Hole 9 red yardage: hole page 341 vs scorecard 241 - scorecard used (front-nine total checks out).',
  'Hole 13 commentary says par 5; scorecard and hole page both say par 4 - par 4 used.',
  'greenArrows are printed without a legend and are recorded verbatim, not interpreted.',
] as const;

export const bookHole = (holeNumber: number): BookHole | undefined =>
  PELHAM_HILLS_BOOK.find((h) => h.holeNumber === holeNumber);

/**
 * Whether a hole's pin and tee coordinates are known to belong to THAT hole.
 *
 * Right now: none of them. The coordinates in pelhamHills.ts came from
 * OpenStreetMap, and OSM's own tags for this course contradict the club's card
 * on 8 of 18 pars and on all 18 handicaps - OSM calls hole 1 a par 5 stroke 8,
 * the club calls it a par 4 stroke 1, and OSM even has two ways tagged ref=9.
 * Re-matching the geometry to the card by length does not converge either: the
 * best assignment puts a 133-yard par 3 on the club's 405-yard par 4.
 *
 * So the numbers are honest about their own provenance: yardages, par, handicap
 * and commentary come from the printed book and are correct; anything derived
 * from a lat/lng - distance to the pin, front/centre/back of the green,
 * advancing to the next hole by position - must check this map first and say
 * "pin not surveyed" rather than show a confident wrong number. A GPS that
 * reads 132 yards while the player stands on a 561-yard par 5 is worse than one
 * that reads nothing.
 *
 * To clear a hole: survey the pin and tee on site (or place them on the
 * satellite map), write the coordinates into pelhamHills.ts, and flip the flag.
 */
export const PIN_COORDINATES_VERIFIED: Readonly<Record<number, boolean>> =
  Object.freeze(
    Object.fromEntries(PELHAM_HILLS_BOOK.map((h) => [h.holeNumber, false]))
  );

export const isPinVerified = (holeNumber: number): boolean =>
  PIN_COORDINATES_VERIFIED[holeNumber] === true;
