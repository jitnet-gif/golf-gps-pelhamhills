import {
  PELHAM_HILLS_BOOK,
  PELHAM_HILLS_PAR,
  PELHAM_HILLS_TOTALS,
  bookHole,
  isPinVerified,
  type TeeSet,
  type TeeYardages,
} from '@/data/pelhamHillsBook';
import { PELHAM_HILLS_HOLES } from '@/data/pelhamHills';

/**
 * The one place where the printed yardage book and the OpenStreetMap
 * coordinates are joined.
 *
 * The join is not trustworthy: OSM's tags disagree with the club's card on 8 of
 * 18 pars and on all 18 handicaps, so a lat/lng labelled "hole 3" is not known
 * to be hole 3's. Rather than leave every component to remember that, this
 * module hands back `pin` and `tee` as null unless `isPinVerified` says the
 * coordinates belong to that hole - a caller physically cannot render a
 * confident distance for an unsurveyed pin, because there is no number there to
 * render. Par, handicap, yardage, green depth and commentary come from the book
 * and are correct.
 *
 * Deliberately absent: any distance helper, and OSM's `length`. Both are
 * lat/lng-derived, and re-exposing them here would reopen the hole this module
 * exists to close.
 */

export type { TeeSet } from '@/data/pelhamHillsBook';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface HoleView {
  holeNumber: number;
  par: number;
  handicap: number;
  /** Yardage for the selected tee set - the number to put on screen. */
  yardsForTee: number;
  /** All six scorecard columns, for a tee comparison. */
  yards: TeeYardages;
  greenDepth: number;
  description: string;
  /** Null until the hole's coordinates are surveyed. Never a guess. */
  pin: LatLng | null;
  tee: LatLng | null;
  pinVerified: boolean;
}

export interface CourseView {
  teeSet: TeeSet;
  holes: HoleView[];
  yards: { out: number; in: number; total: number };
  par: typeof PELHAM_HILLS_PAR;
}

/**
 * @throws RangeError for a hole outside 1-18. All 18 are in the book, so a miss
 * is a caller bug, not a data condition worth widening the return type for.
 */
export const getHoleView = (
  holeNumber: number,
  teeSet: TeeSet = 'white'
): HoleView => {
  const book = bookHole(holeNumber);
  if (!book) {
    throw new RangeError(`Pelham Hills has no hole ${holeNumber}`);
  }

  // One call, used for both the flag and the null-ing, so the two cannot drift
  // apart and start reporting an unverified pin as a real position.
  const verified = isPinVerified(holeNumber);
  const geo = verified
    ? PELHAM_HILLS_HOLES.find((h) => h.holeNumber === holeNumber)
    : undefined;

  return {
    holeNumber: book.holeNumber,
    par: book.par,
    handicap: book.handicap,
    yardsForTee: book.yards[teeSet],
    // Copied, not shared: the book is the authority and a caller must not be
    // able to edit it through this view.
    yards: { ...book.yards },
    greenDepth: book.greenDepth,
    description: book.description,
    pin: geo ? { lat: geo.latitude, lng: geo.longitude } : null,
    tee: geo ? { lat: geo.teeLatitude, lng: geo.teeLongitude } : null,
    pinVerified: verified,
  };
};

export const getCourseView = (teeSet: TeeSet = 'white'): CourseView => ({
  teeSet,
  holes: PELHAM_HILLS_BOOK.map((h) => getHoleView(h.holeNumber, teeSet)),
  // Passed through from the card rather than summed from the holes: the printed
  // OUT/IN/TOTAL figures are what players compare against.
  yards: PELHAM_HILLS_TOTALS[teeSet],
  par: PELHAM_HILLS_PAR,
});

/**
 * Strokes a player of `courseHandicap` receives on a hole of stroke index
 * `handicap`, under standard allocation.
 *
 * Written as a division rather than the usual pair of comparisons so it keeps
 * working past 36, where a third stroke starts falling on the hardest holes.
 * A plus handicap gives strokes back rather than receiving them; that is not
 * modelled here, so it returns 0 rather than a negative count a caller would
 * have to defend against.
 */
export const strokesReceived = (
  handicap: number,
  courseHandicap: number
): number => {
  if (courseHandicap <= 0) return 0;
  return (
    Math.floor(courseHandicap / 18) + (handicap <= courseHandicap % 18 ? 1 : 0)
  );
};
