import { useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { isPinVerified } from '@/data/pelhamHillsBook';
import type { FairwayPoint, Hole } from '@/data/pelhamHills';
import { haversineMetres, METRES_TO_YARDS } from '@/lib/geo';
import { readFairway } from '@/lib/fairwayDistance';

export interface FairwayDistance {
  /**
   * 'no-fix' - no position yet.
   * 'far'    - further from this pin than anyone playing the hole could be.
   */
  status: 'ok' | 'no-fix' | 'far';
  /** Yards to the pin along the hole - see lib/fairwayDistance. */
  along: number | null;
  /** Yards to the pin in a straight line. */
  straight: number | null;
  onLine: boolean;
  /**
   * The pin is where the course data or /admin/map puts it, not where somebody
   * stood on the green. Every figure from it is shown and spoken as "about".
   */
  approx: boolean;
  /** The line the along figure follows, player first. */
  route: FairwayPoint[] | null;
  /**
   * The bends still ahead on that line, nearest first, each with how far it is
   * from the player along the line - "to the corner" on a dogleg.
   */
  bends: FairwayBend[];
}

export interface FairwayBend {
  at: FairwayPoint;
  /** Yards from the player to this bend, along the line. */
  yards: number;
}

/** The longest hole is 477 m; nobody playing one stands further than this. */
const FAR_YARDS = 700;

/**
 * Yards to the pin from the player, following the hole's line, on every hole.
 *
 * Unlike useHoleDistances this answers with a pin nobody has stood on - the
 * club's call, so a player gets a figure on all 18 - and the `approx` flag is
 * how that stays honest. It is kept apart from useHoleDistances on purpose:
 * that hook's refusal is what the green's front/back figures rest on.
 */
/** What the measurement reads off a hole - the map's copy of a hole has it too. */
export type FairwayHole = Pick<
  Hole,
  'holeNumber' | 'latitude' | 'longitude' | 'teeLatitude' | 'teeLongitude' | 'path'
>;

export const useFairwayDistance = (hole: FairwayHole | undefined): FairwayDistance => {
  const gpsPosition = useAppStore((s) => s.gpsPosition);
  const surveyedPin = useAppStore((s) =>
    hole ? s.pinSurveys.get(hole.holeNumber)?.pin : undefined
  );

  return useMemo(() => {
    const approx = !surveyedPin && !(hole && isPinVerified(hole.holeNumber));
    const empty = { along: null, straight: null, onLine: false, approx, route: null, bends: [] };
    if (!hole || !gpsPosition) return { status: 'no-fix', ...empty };

    const pin: FairwayPoint = surveyedPin
      ? [surveyedPin.latitude, surveyedPin.longitude]
      : [hole.latitude, hole.longitude];
    const line: FairwayPoint[] = [
      [hole.teeLatitude, hole.teeLongitude],
      ...(hole.path ?? []),
      pin,
    ];
    const reading = readFairway(line, [gpsPosition.latitude, gpsPosition.longitude]);
    const along = reading.alongMetres * METRES_TO_YARDS;
    const straight = reading.straightMetres * METRES_TO_YARDS;

    // Every point between the player and the pin on the route is a bend ahead.
    const bends: FairwayBend[] = [];
    let run = 0;
    for (let i = 1; i < reading.route.length - 1; i += 1) {
      const [a, b] = [reading.route[i - 1], reading.route[i]];
      run += haversineMetres(a[0], a[1], b[0], b[1]);
      bends.push({ at: b, yards: run * METRES_TO_YARDS });
    }

    return {
      status: straight > FAR_YARDS ? 'far' : 'ok',
      along,
      straight,
      onLine: reading.onLine,
      approx,
      route: reading.route,
      bends,
    };
  }, [hole, gpsPosition, surveyedPin]);
};
