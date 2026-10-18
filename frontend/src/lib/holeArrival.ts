import { haversineMetres } from './geo';

/**
 * Deciding, from a stream of GPS fixes, that the player has walked onto a tee.
 *
 * Read useHoleDistances first: it refuses to advance the hole by position
 * because no pin in pelhamHills.ts has been surveyed, and a confidently wrong
 * hole is worse than no hole. That objection is about *pins* and about *silently
 * moving the player's selection*. This detector is a different bargain, and it
 * is only honest because of the three rules below.
 *
 * 1. It matches on tees, not pins. Tee coordinates come from the OSM hole
 *    centrelines and are the start of a hole rather than a green somewhere in
 *    the middle of one, so a fix near one means something specific.
 *
 * 2. It only ever arms the next hole or two, never all eighteen. The measured
 *    separations at Pelham Hills say why: the closest pair of tees on the
 *    property is 48 m apart (11 and 14), and hole 14's tee is 33 m from hole
 *    13's green. Nearest-of-eighteen matching would announce hole 14 to a
 *    player putting out on 13, and hole 1 to a player on the 10th tee 50 m
 *    away. Arming only what comes next collapses both: 13 to 14 is the walk the
 *    player is actually making, and hole 1 is never a candidate after hole 9.
 *
 * 3. When two armed tees are in range at once it announces neither. That
 *    happens on a cold start, where every hole is armed because we do not know
 *    where the round began. Saying nothing costs a tap; saying the wrong hole
 *    costs the player's trust in every number on the screen.
 *
 * Nothing here reads or writes anything - it is a fold over fixes, so a round
 * can be replayed through it without a device.
 */

export interface ArrivalHole {
  holeNumber: number;
  teeLatitude: number;
  teeLongitude: number;
}

export interface ArrivalFix {
  latitude: number;
  longitude: number;
  /** Metres, as the Geolocation API reports it. */
  accuracy: number;
  /** Epoch milliseconds. */
  timestamp: number;
}

export interface ArrivalOptions {
  /** How close to the tee marker counts as standing on the tee. */
  radiusMetres: number;
  /** How long the player must stay inside it before the hole is announced. */
  dwellMs: number;
  /**
   * How far the player may drift from where the dwell began and still be
   * considered to have stayed put. Time inside the circle is not enough on its
   * own: a 60 m circle takes 43 s to cross at walking pace, so a player merely
   * walking past a tee on the way to their own would out-wait the dwell.
   */
  stationaryRadiusMetres: number;
  /** Fixes vaguer than this are dropped rather than believed. */
  maxAccuracyMetres: number;
  /** How many holes past the last announced one stay armed. */
  lookAhead: number;
}

/**
 * 30 m is a tee box plus a few paces, and it is under the 33 m that separates
 * the tightest tee/green pair, so the previous green is outside it.
 *
 * 20 s of dwell, held within 20 m of one spot, is the difference between
 * arriving and passing through. Players walk past tees on the way to their own
 * - the path from the clubhouse to the 10th tee goes within 13 m of the 1st -
 * and carts drive past them constantly. Walking covers 28 m in those 20 s, so
 * the drift limit is what a moving player fails; a standing one only fails it
 * on a bad fix, and pays for that with another 20 s rather than a wrong hole.
 *
 * A fix that admits to 25 m of error cannot tell a 30 m circle from its
 * surroundings, so it is not allowed to vote.
 */
export const ARRIVAL_DEFAULTS: ArrivalOptions = {
  radiusMetres: 30,
  dwellMs: 20000,
  stationaryRadiusMetres: 20,
  maxAccuracyMetres: 25,
  lookAhead: 2,
};

export interface ArrivalState {
  /** The armed hole being dwelt on, with the time and place the dwell began. */
  candidate: {
    holeNumber: number;
    since: number;
    latitude: number;
    longitude: number;
  } | null;
  /** Holes announced this round, oldest first. The last one sets what is armed. */
  announced: number[];
  /**
   * A hole the player picked by hand (see armFrom): it and the ones after it,
   * up to lookAhead, are armed instead of what follows the last announcement.
   */
  armedFrom?: number | null;
}

export const initialArrivalState: ArrivalState = Object.freeze({
  candidate: null,
  announced: [],
  armedFrom: null,
});

export interface ArrivalStep {
  state: ArrivalState;
  /** The hole to announce, on the one fix that completes a dwell. */
  arrivedAt: number | null;
}

/**
 * The holes a fix is allowed to match. Empty announced list means we do not know
 * where the round started, so everything is armed and rule 3 does the work.
 */
export const armedHoles = (
  state: ArrivalState,
  holes: ArrivalHole[],
  lookAhead: number = ARRIVAL_DEFAULTS.lookAhead
): ArrivalHole[] => {
  const announced = new Set(state.announced);
  const unannounced = holes.filter((h) => !announced.has(h.holeNumber));

  const from = state.armedFrom;
  if (from != null) {
    return unannounced.filter((h) => h.holeNumber >= from && h.holeNumber < from + lookAhead);
  }

  const last = state.announced[state.announced.length - 1];
  if (last === undefined) return unannounced;

  return unannounced.filter(
    (h) => h.holeNumber > last && h.holeNumber <= last + lookAhead
  );
};

/** Fold one fix into the detector. Pure: same inputs, same outputs, no clock. */
export const stepArrival = (
  state: ArrivalState,
  fix: ArrivalFix,
  holes: ArrivalHole[],
  options: Partial<ArrivalOptions> = {}
): ArrivalStep => {
  const {
    radiusMetres,
    dwellMs,
    stationaryRadiusMetres,
    maxAccuracyMetres,
    lookAhead,
  } = { ...ARRIVAL_DEFAULTS, ...options };

  // A fix we do not believe is not evidence of leaving either - hold the dwell
  // and wait for one that is.
  if (!(fix.accuracy <= maxAccuracyMetres)) {
    return { state, arrivedAt: null };
  }

  const inRange = armedHoles(state, holes, lookAhead).filter(
    (h) =>
      haversineMetres(
        fix.latitude,
        fix.longitude,
        h.teeLatitude,
        h.teeLongitude
      ) <= radiusMetres
  );

  // Nothing in range, or two tees equally plausible: no candidate, no guess.
  if (inRange.length !== 1) {
    return {
      state: state.candidate === null ? state : { ...state, candidate: null },
      arrivedAt: null,
    };
  }

  const holeNumber = inRange[0].holeNumber;

  const anchor = {
    holeNumber,
    since: fix.timestamp,
    latitude: fix.latitude,
    longitude: fix.longitude,
  };

  const candidate = state.candidate;

  // A different hole, or the same one from a spot far enough away to be a walk
  // rather than a wait: either way the dwell starts again from here.
  //
  // A fix older than the anchor restarts it too. Device clocks are not ours -
  // a tab resumed from the background can hand back a fix stamped before the
  // one that opened the dwell, and the subtraction below would then go negative
  // and stay negative for as long as the player stood still, which is exactly
  // as long as they were waiting to hear the hole.
  if (
    candidate?.holeNumber !== holeNumber ||
    fix.timestamp < candidate.since ||
    haversineMetres(
      fix.latitude,
      fix.longitude,
      candidate.latitude,
      candidate.longitude
    ) > stationaryRadiusMetres
  ) {
    return { state: { ...state, candidate: anchor }, arrivedAt: null };
  }

  if (fix.timestamp - candidate.since < dwellMs) {
    return { state, arrivedAt: null };
  }

  return {
    state: {
      candidate: null,
      announced: [...state.announced, holeNumber],
      armedFrom: null,
    },
    arrivedAt: holeNumber,
  };
};

/**
 * The player picked this hole by hand - on the map, with the arrows, or by
 * opening the app on it. That is the player saying where they are, so it and
 * the next are armed, and anything announced from it onwards is forgotten.
 *
 * Without this, one wrong announcement stuck: a player who waited by the 10th
 * tee (50 m from the 1st) before teeing off heard "Hole 10", after which only
 * 11 and 12 were armed - picking hole 1 by hand never brought it back, and the
 * 1st tee was never read.
 */
export const armFrom = (state: ArrivalState, holeNumber: number): ArrivalState => ({
  candidate: null,
  announced: state.announced.filter((n) => n < holeNumber),
  armedFrom: holeNumber,
});

/**
 * Record a hole as already announced without a fix - what a manual tap on
 * "Play hole 7" means. It keeps the auto-trigger from repeating a hole the
 * player just chose to hear, and re-arms the sequence from there, which is how
 * a player who starts on the 10th tee tells the detector where the round began.
 */
export const markAnnounced = (
  state: ArrivalState,
  holeNumber: number
): ArrivalState =>
  state.announced[state.announced.length - 1] === holeNumber && state.armedFrom == null
    ? state
    : {
        candidate: null,
        announced: [
          ...state.announced.filter((n) => n !== holeNumber),
          holeNumber,
        ],
        armedFrom: null,
      };
