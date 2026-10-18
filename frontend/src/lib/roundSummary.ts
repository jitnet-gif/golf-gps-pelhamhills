// The card the club prints, computed from the scores the player entered.
//
// Every structural figure is read from the printed book rather than summed from
// a list kept here: par and handicap per hole from PELHAM_HILLS_BOOK, the
// OUT/IN/TOTAL par from PELHAM_HILLS_PAR, the tee yardages from
// PELHAM_HILLS_TOTALS. That way the card can never drift from the one the
// player is holding, even if a hole is corrected in the book later.
//
// Nothing here touches a coordinate, so nothing here needs isPinVerified() -
// this module is safe to trust in a way the distance readouts are not.

import {
  PELHAM_HILLS_BOOK,
  PELHAM_HILLS_PAR,
  PELHAM_HILLS_TEES,
  PELHAM_HILLS_TOTALS,
} from '@/data/pelhamHillsBook';
import type { BookHole, TeeSet } from '@/data/pelhamHillsBook';

/**
 * The five boxes a club card tallies. An albatross falls in `eagle` - the card
 * prints no better box, and the book's longest hole makes one a rumour anyway.
 */
export type ScoreResult = 'eagle' | 'birdie' | 'par' | 'bogey' | 'doubleOrWorse';

/** The three totals columns printed across the bottom of the card. */
export type Segment = 'out' | 'in' | 'total';

export interface HoleLine {
  holeNumber: number;
  par: number;
  handicap: number;
  /** This hole's yardage from the tee set being played. */
  yards: number;
  /** Null until the player enters a score for the hole. */
  score: number | null;
  toPar: number | null;
  result: ScoreResult | null;
}

export interface SegmentTotals {
  segment: Segment;
  /** Par for the whole segment, as printed. */
  par: number;
  /** Yardage for the whole segment from the tee set played, as printed. */
  yards: number;
  /** Strokes taken so far in the segment; null while it is untouched. */
  score: number | null;
  holesPlayed: number;
  holeCount: number;
  /**
   * Par of the scored holes only. `toPar` is measured against this, not the
   * printed par, so a half-finished nine reads honestly instead of nine under.
   */
  parPlayed: number;
  toPar: number | null;
}

export interface ScoreTally {
  eagles: number;
  birdies: number;
  pars: number;
  bogeys: number;
  doublesOrWorse: number;
}

export interface RoundSummary {
  teeSet: TeeSet;
  /** The tee set's printed name, e.g. 'White/Yellow'. */
  teeLabel: string;
  /** The tee set's printed 18-hole yardage. */
  teeTotalYards: number;
  /** All 18 holes in card order, scored or not. */
  holes: HoleLine[];
  /** The two printed nines, split once here so no caller re-slices them. */
  frontLines: HoleLine[];
  backLines: HoleLine[];
  front: SegmentTotals;
  back: SegmentTotals;
  /** Carries the round's score, par played and to-par figure. */
  total: SegmentTotals;
  holesPlayed: number;
  complete: boolean;
  tally: ScoreTally;
}

/**
 * The store accepts any number for a hole, and nothing distinguishes "not yet
 * played" from a stray 0 - both are blanks on a card.
 */
const readScore = (scores: Map<number, number>, holeNumber: number): number | null => {
  const raw = scores.get(holeNumber);
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.round(raw)
    : null;
};

export const scoreResult = (score: number, par: number): ScoreResult => {
  const diff = score - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0) return 'par';
  if (diff === 1) return 'bogey';
  return 'doubleOrWorse';
};

/** 'E', '+4', '-1' - the way a leaderboard writes it. */
export const formatToPar = (toPar: number | null): string => {
  if (toPar === null) return '--';
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
};

const holeLine = (
  hole: BookHole,
  scores: Map<number, number>,
  teeSet: TeeSet
): HoleLine => {
  const score = readScore(scores, hole.holeNumber);
  return {
    holeNumber: hole.holeNumber,
    par: hole.par,
    handicap: hole.handicap,
    yards: hole.yards[teeSet],
    score,
    toPar: score === null ? null : score - hole.par,
    result: score === null ? null : scoreResult(score, hole.par),
  };
};

const segmentTotals = (
  lines: HoleLine[],
  segment: Segment,
  teeSet: TeeSet
): SegmentTotals => {
  const played = lines.filter((line) => line.score !== null);
  const score = played.length
    ? played.reduce((sum, line) => sum + (line.score ?? 0), 0)
    : null;
  const parPlayed = played.reduce((sum, line) => sum + line.par, 0);

  return {
    segment,
    par: PELHAM_HILLS_PAR[segment],
    yards: PELHAM_HILLS_TOTALS[teeSet][segment],
    score,
    holesPlayed: played.length,
    holeCount: lines.length,
    parPlayed,
    toPar: score === null ? null : score - parPlayed,
  };
};

const tallyResults = (lines: HoleLine[]): ScoreTally => {
  const tally: ScoreTally = {
    eagles: 0,
    birdies: 0,
    pars: 0,
    bogeys: 0,
    doublesOrWorse: 0,
  };

  for (const line of lines) {
    switch (line.result) {
      case 'eagle':
        tally.eagles += 1;
        break;
      case 'birdie':
        tally.birdies += 1;
        break;
      case 'par':
        tally.pars += 1;
        break;
      case 'bogey':
        tally.bogeys += 1;
        break;
      case 'doubleOrWorse':
        tally.doublesOrWorse += 1;
        break;
      default:
        break;
    }
  }

  return tally;
};

/** Every hole in the book carries a score - the round can be signed off. */
export const isRoundComplete = (scores: Map<number, number>): boolean =>
  PELHAM_HILLS_BOOK.every((hole) => readScore(scores, hole.holeNumber) !== null);

export const computeRoundSummary = (
  scores: Map<number, number>,
  teeSet: TeeSet
): RoundSummary => {
  const holes = PELHAM_HILLS_BOOK.map((hole) => holeLine(hole, scores, teeSet));
  const front = holes.filter((line) => line.holeNumber <= 9);
  const back = holes.filter((line) => line.holeNumber > 9);
  const total = segmentTotals(holes, 'total', teeSet);
  const tee = PELHAM_HILLS_TEES.find((option) => option.id === teeSet);

  return {
    teeSet,
    teeLabel: tee?.label ?? teeSet,
    teeTotalYards: tee?.totalYards ?? PELHAM_HILLS_TOTALS[teeSet].total,
    holes,
    frontLines: front,
    backLines: back,
    front: segmentTotals(front, 'out', teeSet),
    back: segmentTotals(back, 'in', teeSet),
    total,
    holesPlayed: total.holesPlayed,
    complete: total.holesPlayed === holes.length,
    tally: tallyResults(holes),
  };
};
