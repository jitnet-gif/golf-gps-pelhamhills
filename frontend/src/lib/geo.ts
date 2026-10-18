/**
 * The one great-circle calculation in the app.
 *
 * There were three copies of this before - in useHoleDistances, in
 * DistanceIndicator, and very nearly a fourth in the arrival detector. The
 * comment in useHoleDistances asked that they "never disagree by a yard on the
 * same pair of points", which is only enforceable if there is one of them.
 *
 * Metres are the base unit because that is what a GPS fix reports its accuracy
 * in and what a geofence radius is written in; yards are the golfer-facing
 * conversion on top.
 */

export const METRES_TO_YARDS = 1.09361;

const EARTH_RADIUS_M = 6371000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two coordinates, in metres. */
export const haversineMetres = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** The same distance, in yards. */
export const haversineYards = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => haversineMetres(lat1, lon1, lat2, lon2) * METRES_TO_YARDS;

/** Initial bearing from point 1 to point 2, in degrees clockwise from north. */
export const bearingDegrees = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
  const x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLon);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

/**
 * The sixteen points of the compass, clockwise from north. Two components had
 * grown a private copy of this table and its rounding - the same duplication the
 * header of this file exists to argue against - so it lives here with the
 * bearing it labels.
 */
export const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

export type CompassPoint = (typeof COMPASS_POINTS)[number];

/** The compass point a bearing in degrees rounds to. */
export const compassPoint = (bearing: number): CompassPoint =>
  COMPASS_POINTS[Math.round(((bearing % 360) + 360) % 360 / 22.5) % 16];
