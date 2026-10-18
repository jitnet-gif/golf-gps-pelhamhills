import { useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { PELHAM_HILLS_HOLES } from '@/data/pelhamHills';
import { bookHole, isPinVerified } from '@/data/pelhamHillsBook';
import { haversineYards, bearingDegrees } from '@/lib/geo';

/**
 * front / centre / back are only ever numbers when status is 'ok'. They are
 * nullable rather than absent so a consumer can destructure without narrowing
 * first, and null - never 0 - is what says "there is no honest number here".
 */
export interface HoleDistances {
  /**
   * 'unsurveyed' - the pin coordinate is not known to belong to this hole.
   * 'no-fix'     - the pin is trusted but the device has no position yet.
   */
  status: 'ok' | 'no-fix' | 'unsurveyed';
  /** Yards from the player to the front edge of the green. */
  front: number | null;
  /** Yards from the player to the pin. */
  centre: number | null;
  /** Yards from the player to the back edge of the green. */
  back: number | null;
  /** Degrees clockwise from true north, player towards pin. */
  bearing: number | null;
}

const UNSURVEYED: HoleDistances = {
  status: 'unsurveyed',
  front: null,
  centre: null,
  back: null,
  bearing: null,
};

/**
 * Front, centre and back of the green from wherever the player is standing.
 *
 * The pin coordinate is treated as the centre of the green, and the book's
 * green depth - a front-to-back figure measured along the hole's own axis - is
 * split half either side of it along the player-to-pin line. That is exact only
 * when the approach comes in straight down the hole; from an angle it flatters
 * the front number slightly. It is the honest approximation available from a
 * single pin coordinate and one depth, and is why these are called front and
 * back rather than surveyed edges.
 *
 * There is still deliberately no advance-to-the-next-hole-by-*pin* here. With no
 * verified pin on any hole, matching a position against greens would confidently
 * move the player to the wrong hole; it stays out until the pins are surveyed.
 * Arriving at a hole is decided on tees instead, and only for the hole that
 * comes next - see lib/holeArrival.ts for why that is a different bargain.
 */
export const useHoleDistances = (holeNumber: number): HoleDistances => {
  const gpsPosition = useAppStore((state) => state.gpsPosition);
  const surveyedPin = useAppStore(
    (state) => state.pinSurveys.get(holeNumber)?.pin
  );

  return useMemo(() => {
    const book = bookHole(holeNumber);
    if (!book) return UNSURVEYED;

    // Provenance is checked before anything is measured: a pin that nobody has
    // stood on must not produce a number even when the maths would happily give
    // one. A pin captured on site is the only thing that earns a distance -
    // isPinVerified covers holes whose coordinates were later written into the
    // source file and vouched for there.
    const pin = surveyedPin
      ? { latitude: surveyedPin.latitude, longitude: surveyedPin.longitude }
      : isPinVerified(holeNumber)
        ? PELHAM_HILLS_HOLES.find((h) => h.holeNumber === holeNumber)
        : undefined;

    if (!pin) return UNSURVEYED;

    if (!gpsPosition) {
      return { status: 'no-fix', front: null, centre: null, back: null, bearing: null };
    }

    const centre = haversineYards(
      gpsPosition.latitude,
      gpsPosition.longitude,
      pin.latitude,
      pin.longitude
    );
    const halfDepth = book.greenDepth / 2;

    return {
      status: 'ok',
      // A player standing on the green would otherwise read a negative front.
      front: Math.max(0, centre - halfDepth),
      centre,
      back: centre + halfDepth,
      bearing: bearingDegrees(
        gpsPosition.latitude,
        gpsPosition.longitude,
        pin.latitude,
        pin.longitude
      ),
    };
  }, [holeNumber, gpsPosition, surveyedPin]);
};
