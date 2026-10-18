import {
  bearingDegrees,
  compassPoint,
  haversineMetres,
  METRES_TO_YARDS,
  type CompassPoint,
} from './geo';

/**
 * Walking the player from the green they have just putted out on to the tee of
 * the hole that follows.
 *
 * This is the half of the round the app had nothing to say about. holeArrival.ts
 * decides that the player *has reached* a tee; nothing pointed the way there,
 * and on a course whose 12th green sits 480 m from the 13th tee across two
 * fairways, that walk is the one moment a golfer actually wants a direction out
 * of a GPS.
 *
 * What it is not: turn-by-turn. There is no cart-path graph in the OpenStreetMap
 * extract this course's coordinates came from, and no routing service is
 * reachable anyway - the app is built to work with the phone in aeroplane mode,
 * which is the whole argument of useOfflineMode and useMapTiles. So this is a
 * bearing and a distance to a known point, which is what a caddie gives you, and
 * the card says as much rather than drawing a path that is not there.
 *
 * Three rules keep it honest, and they are the arrival detector's instincts
 * applied to the opposite problem:
 *
 * 1. It aims at a tee, never a pin. Tee coordinates come from the hole
 *    centrelines and mean something specific; the pins on this course are almost
 *    all unsurveyed, which is why useHoleDistances refuses to measure to them.
 *
 * 2. It will not say "left" unless it knows which way the player is facing. A
 *    phone reports no heading while it is carried in a hand, and course over
 *    ground derived from a Kalman-filtered position lags every turn. A relative
 *    turn is produced only once the player has covered enough ground for the
 *    direction to outvote the error in the fixes it was measured from. Until
 *    then the readout is a compass point, which is true whichever way you face.
 *
 * 3. Guidance ends where arrival begins. Inside the arrival radius the detector
 *    owns the moment, and a card still counting down "8 yards" at a player
 *    standing on the tee is noise.
 *
 * Nothing here reads or writes anything - it is a fold over fixes, so a walk can
 * be replayed through it without a device.
 */

export interface GuidanceTee {
  holeNumber: number;
  teeLatitude: number;
  teeLongitude: number;
}

export interface GuidanceFix {
  latitude: number;
  longitude: number;
  /** Metres, as the Geolocation API reports it. */
  accuracy: number;
  /** Epoch milliseconds. */
  timestamp: number;
}

/** Where the tee sits relative to the way the player is walking. */
export type Turn =
  | 'straight on'
  | 'bear left'
  | 'bear right'
  | 'turn left'
  | 'turn right'
  | 'turn around';

export interface GuidanceOptions {
  /** Fixes vaguer than this are dropped rather than believed. */
  maxAccuracyMetres: number;
  /** Inside this the arrival detector owns the moment and guidance stops. */
  arrivedMetres: number;
  /**
   * How far the player must move past the heading anchor, as a multiple of the
   * error the two fixes admit to, before the direction between them is believed.
   */
  movementFactor: number;
  /** An anchor older than this is a rest, not the start of a walk. */
  anchorStaleMs: number;
  /** Within this of dead ahead there is nothing useful to say about turning. */
  straightOnDegrees: number;
  /** Yardages worth speaking again on the way down. */
  cueBandsYards: number[];
}

/**
 * 25 m of claimed error is the arrival detector's limit, and it is the limit
 * here for the same reason: a fix that vague cannot tell one side of a fairway
 * from the other.
 *
 * 30 m matches ARRIVAL_DEFAULTS.radiusMetres exactly. The two numbers are a
 * handover rather than a coincidence - guidance must not still be counting down
 * inside the circle the detector is already watching.
 *
 * A phone walking at 1.4 m/s produces a fix a second, so consecutive fixes lie
 * about 1.4 m apart, and two fixes each claiming 8 m of error cannot possibly
 * agree on a direction. Holding one anchor until the player has covered 1.5x
 * their summed error - roughly 24 m, some twenty seconds of walking - is what
 * buys a heading worth speaking aloud. An anchor 90 s old is where somebody
 * stood over a putt, not where the walk began.
 *
 * 20 degrees either side of the line is about the width of a fairway at 60
 * yards; a turn call inside it would flap between left and right at every step.
 *
 * 100 and 50 yards are the two cues a walk of any length wants. Under 50 the tee
 * is in sight and the player does not need to be told about it again.
 */
export const GUIDANCE_DEFAULTS: GuidanceOptions = {
  maxAccuracyMetres: 25,
  arrivedMetres: 30,
  movementFactor: 1.5,
  anchorStaleMs: 90000,
  straightOnDegrees: 20,
  cueBandsYards: [100, 50],
};

export interface GuidanceState {
  /** The fix the current heading is being measured from. */
  anchor: GuidanceFix | null;
  /** Course over ground in degrees, once the walk has earned one. */
  heading: number | null;
  /**
   * The band already spoken, in yards: Infinity before the first cue, 0 once
   * arrival has been announced. Bands only ever descend, so a player pacing back
   * and forth across 100 yards is told about it once.
   */
  spokenBandYards: number;
}

export const initialGuidanceState: GuidanceState = Object.freeze({
  anchor: null,
  heading: null,
  spokenBandYards: Number.POSITIVE_INFINITY,
});

export interface GuidanceReading {
  /**
   * 'no-fix'     - nothing has been heard from the device yet.
   * 'unreliable' - the last fix was too vague to measure anything from.
   * 'arrived'    - inside the arrival radius; the detector has it from here.
   */
  status: 'ok' | 'no-fix' | 'unreliable' | 'arrived';
  /** The hole whose tee is being walked to. */
  holeNumber: number;
  /** Yards from the player to that tee. */
  yards: number | null;
  /** Degrees clockwise from true north, player towards tee. */
  bearing: number | null;
  /** The same bearing as a compass point, which needs no heading to be true. */
  compass: CompassPoint | null;
  /** Which way to turn - null until the walk has earned a heading. */
  turn: Turn | null;
}

export interface GuidanceStep {
  state: GuidanceState;
  reading: GuidanceReading;
  /** A sentence to speak, on the one fix that crosses into a new band. */
  cue: string | null;
}

/** A reading with no numbers in it. null - never 0 - is what says "no figure". */
export const blankReading = (
  holeNumber: number,
  status: GuidanceReading['status']
): GuidanceReading => ({
  status,
  holeNumber,
  yards: null,
  bearing: null,
  compass: null,
  turn: null,
});

/**
 * The direction from one fix to another, or null when the pair has not moved far
 * enough apart for that direction to mean anything.
 */
export const courseOverGround = (
  from: GuidanceFix,
  to: GuidanceFix,
  options: Pick<GuidanceOptions, 'movementFactor' | 'anchorStaleMs'> = GUIDANCE_DEFAULTS
): number | null => {
  const elapsed = to.timestamp - from.timestamp;
  if (elapsed <= 0 || elapsed > options.anchorStaleMs) return null;

  const moved = haversineMetres(
    from.latitude,
    from.longitude,
    to.latitude,
    to.longitude
  );

  // Each fix admits to an error of its own; a displacement smaller than their
  // sum is indistinguishable from both of them standing still and being wrong.
  if (moved < (from.accuracy + to.accuracy) * options.movementFactor) return null;

  return bearingDegrees(from.latitude, from.longitude, to.latitude, to.longitude);
};

/** Where the tee sits relative to the heading the player is walking on. */
export const relativeTurn = (
  heading: number,
  bearing: number,
  straightOnDegrees: number = GUIDANCE_DEFAULTS.straightOnDegrees
): Turn => {
  // Signed difference in (-180, 180]: negative is to the player's left.
  const delta = ((bearing - heading + 540) % 360) - 180;
  const magnitude = Math.abs(delta);

  if (magnitude <= straightOnDegrees) return 'straight on';
  if (magnitude >= 135) return 'turn around';
  if (magnitude <= 60) return delta < 0 ? 'bear left' : 'bear right';
  return delta < 0 ? 'turn left' : 'turn right';
};

/**
 * 'NNE' read out is three letters. Each character is a cardinal word and the
 * sixteen points are those words concatenated, so 'NNE' expands through 'NE'
 * into "north-northeast" without a second sixteen-row table to keep in step
 * with COMPASS_POINTS.
 */
const CARDINAL_WORDS: Record<string, string> = {
  N: 'north',
  E: 'east',
  S: 'south',
  W: 'west',
};

export const spokenCompass = (point: CompassPoint): string => {
  const words = [...point].map((letter) => CARDINAL_WORDS[letter]);
  return words.length === 3
    ? `${words[0]}-${words[1]}${words[2]}`
    : words.join('');
};

/**
 * What to say out loud. The turn is spoken only when there is one to trust -
 * rule 2 applied to speech, because a confident "bear right" that walks a player
 * into the trees costs more than saying nothing about turning at all.
 */
export const guidanceCue = (reading: GuidanceReading): string | null => {
  if (reading.status === 'arrived') return `Hole ${reading.holeNumber} tee.`;

  if (reading.status !== 'ok' || reading.yards === null || reading.compass === null) {
    return null;
  }

  const where = `Hole ${reading.holeNumber} tee, ${Math.round(reading.yards)} yards ${spokenCompass(reading.compass)}`;

  if (reading.turn === null || reading.turn === 'straight on') return `${where}.`;

  const turn = reading.turn[0].toUpperCase() + reading.turn.slice(1);
  return `${where}. ${turn}.`;
};

/**
 * The band a yardage has fallen into: the tightest one it is inside, and
 * Infinity when it is outside them all. Tightest rather than widest, or a player
 * at 60 yards would be recorded as having heard "100" and the 50-yard cue would
 * never come.
 */
const bandFor = (yards: number, bands: number[]): number => {
  const ascending = [...bands].sort((a, b) => a - b);
  for (const band of ascending) {
    if (yards <= band) return band;
  }
  return Number.POSITIVE_INFINITY;
};

/** Fold one fix into the guidance. Pure: same inputs, same outputs, no clock. */
export const stepGuidance = (
  state: GuidanceState,
  fix: GuidanceFix,
  tee: GuidanceTee,
  options: Partial<GuidanceOptions> = {}
): GuidanceStep => {
  const {
    maxAccuracyMetres,
    arrivedMetres,
    movementFactor,
    anchorStaleMs,
    straightOnDegrees,
    cueBandsYards,
  } = { ...GUIDANCE_DEFAULTS, ...options };

  // A fix we do not believe is not evidence of having stopped either - the
  // anchor and the heading are held, and we wait for one that is.
  if (!(fix.accuracy <= maxAccuracyMetres)) {
    return { state, reading: blankReading(tee.holeNumber, 'unreliable'), cue: null };
  }

  const metres = haversineMetres(
    fix.latitude,
    fix.longitude,
    tee.teeLatitude,
    tee.teeLongitude
  );

  if (metres <= arrivedMetres) {
    const reading = blankReading(tee.holeNumber, 'arrived');
    return {
      // Zero is a band nothing descends below, so arrival is spoken once even if
      // the player mills about on the tee for a while.
      state: { anchor: null, heading: null, spokenBandYards: 0 },
      reading,
      cue: state.spokenBandYards > 0 ? guidanceCue(reading) : null,
    };
  }

  // The anchor is replaced only once it has produced a heading. A slow walk
  // therefore accumulates distance against one point, instead of re-anchoring
  // every second and never covering enough ground to earn a direction at all.
  const anchor = state.anchor ?? fix;
  const measured = courseOverGround(anchor, fix, { movementFactor, anchorStaleMs });
  const heading = measured ?? state.heading;

  const bearing = bearingDegrees(
    fix.latitude,
    fix.longitude,
    tee.teeLatitude,
    tee.teeLongitude
  );

  const yards = metres * METRES_TO_YARDS;

  const reading: GuidanceReading = {
    status: 'ok',
    holeNumber: tee.holeNumber,
    yards,
    bearing,
    compass: compassPoint(bearing),
    turn: heading === null ? null : relativeTurn(heading, bearing, straightOnDegrees),
  };

  // The first believed fix of a walk always cues, whatever band it lands in: a
  // player who has just asked to be taken to the next tee wants to be told where
  // it is, not to walk 200 yards in silence waiting to cross 100. It is not
  // recorded as having spoken a band, so the bands below still each get their
  // turn - opening at 240 yards and calling 100 and 50 is three cues, which is
  // what a walk of that length is worth.
  //
  // "Has not spoken yet" is both halves: no anchor, and no band recorded. The
  // arrival branch below also clears the anchor, and without the second half a
  // player standing on the boundary of the 30 m circle - which at 8 m of
  // accuracy is most of them - would drift out, look like the start of a fresh
  // walk, and be told about the tee they are standing beside. Guidance stays
  // pointed at that tee for the twenty seconds the arrival dwell takes, so the
  // window is not a rare one.
  const opening =
    state.anchor === null &&
    state.spokenBandYards === Number.POSITIVE_INFINITY;
  const band = bandFor(yards, cueBandsYards);
  const crossed = opening || band < state.spokenBandYards;

  return {
    state: {
      // A stale anchor is dropped even when it never earned a heading: it marks
      // a rest, and measuring from it would call the player's direction wrong
      // for the whole of the rest of the walk.
      anchor:
        measured !== null || fix.timestamp - anchor.timestamp > anchorStaleMs
          ? fix
          : anchor,
      heading,
      spokenBandYards:
        crossed && band < state.spokenBandYards ? band : state.spokenBandYards,
    },
    reading,
    cue: crossed ? guidanceCue(reading) : null,
  };
};

/**
 * The tee to walk to after a given hole: the next one in the list, by number.
 *
 * Not the nearest unplayed tee. The closest pair of tees at Pelham Hills is 48 m
 * apart and hole 14's tee is 33 m from hole 13's green, so "nearest" would point
 * a player finishing the 13th at the 14th tee they are standing beside and call
 * the walk over before it started - the same trap armedHoles() exists to avoid.
 */
export const nextTee = (
  holes: GuidanceTee[],
  afterHole: number
): GuidanceTee | null =>
  holes
    .filter((h) => h.holeNumber > afterHole)
    .sort((a, b) => a.holeNumber - b.holeNumber)[0] ?? null;
