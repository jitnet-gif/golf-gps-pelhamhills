// The scorecard as data: making a card, reading its totals, and checking what
// comes back from the server. No storage and no network here - see
// hooks/useScorecard and lib/scorecardSync for those.
//
// Par and handicap are read from the printed book, never kept on the card, so
// a card written today still totals correctly if a hole is corrected later.

import { PELHAM_HILLS_BOOK, PELHAM_HILLS_TEES } from '@/data/pelhamHillsBook';
import type { TeeSet } from '@/data/pelhamHillsBook';
import type { Scorecard, ScorecardPlayer } from '@/db';

export const HOLE_COUNT = 18;
/** The printed card has four player rows. */
export const MAX_PLAYERS = 4;
/** Highest number the entry pad offers; anything above is a pick-up anyway. */
export const MAX_STROKES = 15;
const NAME_LIMIT = 24;

const PAR_BY_HOLE = new Map(PELHAM_HILLS_BOOK.map((h) => [h.holeNumber, h.par]));

/** Today on the phone's own calendar - a round at 7pm is not tomorrow's in UTC. */
export const localDate = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * A uuid for a new card. randomUUID needs a secure context and a recent
 * browser; the fallback covers an old in-app browser without either.
 */
export const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const blankScores = (): (number | null)[] =>
  Array.from({ length: HOLE_COUNT }, () => null);

/** The name the first row starts with: the account's, or a plain "Me". */
export const defaultPlayerName = (email: string | null | undefined): string => {
  const local = email?.split('@')[0]?.trim();
  return local ? local.slice(0, NAME_LIMIT) : 'Me';
};

export const newScorecard = (
  courseId: string,
  teeSet: TeeSet,
  firstPlayer: string,
  ownerId: string | null = null
): Scorecard => {
  const now = new Date().toISOString();
  return {
    id: newId(),
    courseId,
    playedOn: localDate(),
    teeSet,
    players: [{ name: firstPlayer, scores: blankScores() }],
    ownerId,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
  };
};

export const hasAnyScore = (card: Scorecard): boolean =>
  card.players.some((p) => p.scores.some((s) => s !== null));

/** Changed since the server last took a copy - or the server never had one. */
export const isDirty = (card: Scorecard): boolean =>
  card.syncedAt === null || card.syncedAt < card.updatedAt;

export interface PlayerTotals {
  out: number | null;
  in: number | null;
  total: number | null;
  holesPlayed: number;
  /** Against the par of the holes played, so a half-finished card reads honestly. */
  toPar: number | null;
}

const sum = (scores: (number | null)[], from: number, to: number) => {
  let total = 0;
  let played = 0;
  let par = 0;
  for (let i = from; i < to; i += 1) {
    const s = scores[i];
    if (s !== null && s !== undefined) {
      total += s;
      played += 1;
      par += PAR_BY_HOLE.get(i + 1) ?? 0;
    }
  }
  return { total, played, par };
};

export const playerTotals = (scores: (number | null)[]): PlayerTotals => {
  const front = sum(scores, 0, 9);
  const back = sum(scores, 9, HOLE_COUNT);
  const played = front.played + back.played;
  return {
    out: front.played ? front.total : null,
    in: back.played ? back.total : null,
    total: played ? front.total + back.total : null,
    holesPlayed: played,
    toPar: played ? front.total + back.total - (front.par + back.par) : null,
  };
};

/** The first row as the hole -> strokes map the rest of the app reads. */
export const scoresToMap = (scores: (number | null)[] | undefined): Map<number, number> => {
  const map = new Map<number, number>();
  scores?.forEach((s, i) => {
    if (s !== null) map.set(i + 1, s);
  });
  return map;
};

const cleanScore = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20
    ? value
    : null;

export const cleanName = (value: unknown, fallback: string): string => {
  const name = typeof value === 'string' ? value.trim().slice(0, NAME_LIMIT) : '';
  return name || fallback;
};

/**
 * Players as stored anywhere - the server's jsonb included - reduced to what
 * the card can draw: one to four rows of exactly 18 boxes. A malformed row is
 * repaired rather than rejected, so one bad field never hides a whole round.
 */
export const normalisePlayers = (value: unknown): ScorecardPlayer[] => {
  const rows = Array.isArray(value) ? value.slice(0, MAX_PLAYERS) : [];
  const players = rows.map((row, i) => {
    const r = (row ?? {}) as { name?: unknown; scores?: unknown };
    const raw = Array.isArray(r.scores) ? r.scores : [];
    return {
      name: cleanName(r.name, i === 0 ? 'Me' : `Player ${i + 1}`),
      scores: Array.from({ length: HOLE_COUNT }, (_, h) => cleanScore(raw[h])),
    };
  });
  return players.length ? players : [{ name: 'Me', scores: blankScores() }];
};

export const isTeeSet = (value: unknown): value is TeeSet =>
  PELHAM_HILLS_TEES.some((t) => t.id === value);

/** "Thu, 11 Sep 2026" - parsed as a calendar day, not as UTC midnight. */
export const formatPlayedOn = (playedOn: string): string => {
  const [y, m, d] = playedOn.split('-').map(Number);
  if (!y || !m || !d) return playedOn;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};
