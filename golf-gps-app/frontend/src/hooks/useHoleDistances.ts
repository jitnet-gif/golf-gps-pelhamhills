import { useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { PELHAM_HILLS_HOLES } from '@/data/pelhamHills';
import { bookHole, isPinVerified } from '@/data/pelhamHillsBook';

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

const METRES_TO_YARDS = 1.09361;

/**
 * Great-circle distance in yards. Matches the haversine in DistanceIndicator so
 * the two never disagree by a yard on the same pair of points.
 */
const haversineYards = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c * METRES_TO_YARDS;
};

/** Initial bearing from point 1 to point 2, in degrees (0-360). */
const bearingDegrees = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(dLon);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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
 * There is deliberately no advance-to-the-next-hole-by-position here. With no
 * verified pin on any hole, position matching would confidently move the player
 * to the wrong hole; it stays out until the pins are surveyed.
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
