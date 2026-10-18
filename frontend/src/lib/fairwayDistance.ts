import type { FairwayPoint } from '@/data/pelhamHills';
import { haversineMetres } from './geo';

/**
 * How far the pin is from where the player stands, the way the hole is played.
 *
 * A dogleg is played round its bend, not over the trees, so the figure that
 * matters follows the hole's line (tee, the bends drawn in /admin/map, pin):
 * straight to the next point of the line ahead of the player, then along the
 * line to the pin. On the last stretch that is simply the straight distance.
 *
 * "Ahead" comes from laying the player on the nearest stretch of the line. A
 * player in the trees well away from it would be laid onto it all the same and
 * told a length that is not theirs to play, so beyond OFF_LINE_METRES the
 * answer is the straight distance, and says so.
 */
export const OFF_LINE_METRES = 40;

export interface FairwayReading {
  /** Metres to the pin along the hole: to the next point ahead, then the line. */
  alongMetres: number;
  /** Metres to the pin as the crow flies. */
  straightMetres: number;
  /** How far the player stands from the hole's line. */
  offLineMetres: number;
  /** Near enough to the line for the along figure to be the player's own. */
  onLine: boolean;
  /** The way the along figure was measured: the player first, the pin last. */
  route: FairwayPoint[];
}

const metres = (a: FairwayPoint, b: FairwayPoint) => haversineMetres(a[0], a[1], b[0], b[1]);

/** `line` runs tee first, pin last, with any bends between. */
export const readFairway = (line: FairwayPoint[], player: FairwayPoint): FairwayReading => {
  const pin = line[line.length - 1];
  const straight = metres(player, pin);

  // Flat metres about the player - plenty at the size of one hole.
  const k = Math.cos((player[0] * Math.PI) / 180);
  const xy = (p: FairwayPoint) => [(p[1] - player[1]) * k * 111_320, (p[0] - player[0]) * 111_320];

  let nearest = 0;
  let offLine = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, ay] = xy(line[i]);
    const [bx, by] = xy(line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < offLine) {
      offLine = d;
      nearest = i;
    }
  }

  if (line.length < 2 || offLine > OFF_LINE_METRES) {
    return {
      alongMetres: straight,
      straightMetres: straight,
      offLineMetres: Number.isFinite(offLine) ? offLine : 0,
      onLine: false,
      route: [player, pin],
    };
  }

  const ahead = line.slice(nearest + 1);
  let along = metres(player, ahead[0]);
  for (let i = 1; i < ahead.length; i += 1) along += metres(ahead[i - 1], ahead[i]);

  return {
    // Never shorter than the straight line, whatever rounding the flat maths did.
    alongMetres: Math.max(along, straight),
    straightMetres: straight,
    offLineMetres: offLine,
    onLine: true,
    route: [player, ...ahead],
  };
};
