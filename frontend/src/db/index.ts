import Dexie, { type Table } from 'dexie';
import type { TeeSet } from '@/data/pelhamHillsBook';
import { localDate, newId } from '@/lib/scorecard';

export interface Round {
  id: string;
  courseId: string;
  date: string;
  holes: { holeNumber: number; score?: number; timestamp?: string }[];
}

export interface Score {
  id?: number;
  roundId: string;
  hole: number;
  score: number;
  timestamp: string;
}

export interface SyncQueueItem {
  id?: number;
  type: 'score' | 'round' | 'tile-meta';
  payload: Record<string, unknown>;
  timestamp: string;
  attempts: number;
}

/**
 * 마지막으로 받아 온 배너. 통신이 끊긴 코스 위에서도 배너 자리가
 * 비어 보이지 않게 하려고 남깁니다. 이미지 자체는 서비스워커의
 * image-cache가 따로 들고 있습니다.
 */
export interface CachedPromotion {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  placement: 'home' | 'scorecard';
  priority: number;
  cachedAt: string;
}

export interface TileMeta {
  id?: number;
  courseId: string;
  tiles: string[]; // Array of tile URLs
  lastUpdated: string;
}

/**
 * One surveyed point, captured by standing on it. `accuracy` is the device's
 * own estimate in metres and is stored with the fix, because a coordinate is
 * only as good as the fix that produced it and a later reader has no other way
 * to tell a 3 m capture from a 40 m one.
 */
export interface SurveyedPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}

/**
 * Pin and tee for one hole, surveyed on site.
 *
 * This is what makes a hole's live distances trustworthy: the coordinates that
 * shipped with the app came from OpenStreetMap and are not known to belong to
 * the hole numbers the club uses, so nothing is measured against them. A row
 * here is a coordinate someone physically stood on.
 */
export interface PinSurvey {
  /** `${courseId}:${holeNumber}` - one row per hole per course. */
  id: string;
  courseId: string;
  holeNumber: number;
  pin?: SurveyedPoint;
  tee?: SurveyedPoint;
}

/**
 * A hole's layout as edited in /admin/map on this device: its fairway line,
 * and - once it has been renumbered - the tee and pin it now owns.
 *
 * Kept apart from pinSurveys on purpose. A survey is a coordinate someone stood
 * on and is what switches live distances on; these are points placed over
 * satellite imagery and only change what the map draws. Sharing a table would
 * let the second pass for the first.
 */
export interface HolePath {
  /** `${courseId}:${holeNumber}` - one row per hole per course. */
  id: string;
  courseId: string;
  holeNumber: number;
  /** [latitude, longitude] bends between tee and pin, tee end first. Empty is a straight line. */
  waypoints: [number, number][];
  /**
   * Set only by renumbering: the tee, pin and centreline length this number
   * took from another hole. Final values, not a reference to that hole, so the
   * row stays right after the edit has been written into the course data.
   * Additive to v4 - no index, so no new Dexie version.
   */
  tee?: [number, number];
  pin?: [number, number];
  length?: number;
  updatedAt: string;
  /**
   * updatedAt of the version the server (hole_edits, migration 0007) holds;
   * absent when it holds none. A row without it - every line drawn before the
   * server existed - is this device's own and is never dropped by a server read.
   * Additive, no index, so no new Dexie version.
   */
  syncedAt?: string;
}

/** One line of the card: a name and a box per hole, blank until played. */
export interface ScorecardPlayer {
  name: string;
  /** 18 boxes in hole order; null is a hole not yet written in. */
  scores: (number | null)[];
}

/**
 * One scorecard, the way the club prints it: up to four players on one card,
 * one tee set, one day. The first player is the account holder; companions are
 * names only. Mirrors a row of `scorecards` (migration 0006).
 *
 * Written here first and uploaded when signed in - the card is kept on a
 * fairway, where the network often is not.
 */
export interface Scorecard {
  /** uuid, made on the device so the card can exist before the server hears of it. */
  id: string;
  courseId: string;
  /** Local calendar date the round was played, YYYY-MM-DD. */
  playedOn: string;
  teeSet: TeeSet;
  players: ScorecardPlayer[];
  /** The account the card belongs to, once it has one; null for a signed-out card. */
  ownerId: string | null;
  /** Only filled in on cards read back from the server. */
  ownerEmail?: string | null;
  createdAt: string;
  updatedAt: string;
  /** updatedAt of the version the server has; null when it has none. */
  syncedAt: string | null;
}

export class GolfGpsDB extends Dexie {
  rounds!: Table<Round>;
  scores!: Table<Score>;
  syncQueue!: Table<SyncQueueItem>;
  tileMeta!: Table<TileMeta>;
  promotions!: Table<CachedPromotion>;
  pinSurveys!: Table<PinSurvey>;
  holePaths!: Table<HolePath>;
  scorecards!: Table<Scorecard>;

  constructor() {
    super('GolfGpsDB');
    this.version(1).stores({
      rounds: 'id, courseId, date',
      scores: '++id, roundId, hole, timestamp',
      syncQueue: '++id, type, timestamp',
      tileMeta: '++id, courseId, lastUpdated',
    });
    // v2: 배너 캐시 추가. 기존 스토어는 그대로 두므로 이미 깔린 앱의
    // 라운드/점수 데이터는 건드리지 않고 올라갑니다.
    this.version(2).stores({
      promotions: 'id, placement, priority',
    });
    // v3: on-course pin survey. Additive like v2 - an install mid-round keeps
    // its rounds, scores and cached tiles.
    this.version(3).stores({
      pinSurveys: 'id, courseId, holeNumber',
    });
    // v4: fairway lines drawn in /admin/map. Additive like v2 and v3, and a
    // store of its own rather than a field on pinSurveys - see HolePath.
    this.version(4).stores({
      holePaths: 'id, courseId, holeNumber',
    });
    // v5: scorecards, one row per card. Replaces rounds/scores/syncQueue, which
    // opened a new empty round on every visit and queued it for a server that
    // was never there - the "N pending" that only ever grew. Any hole actually
    // scored under the old tables moves onto a card; the queue is emptied, since
    // nothing in it could ever be delivered.
    this.version(5)
      .stores({
        scorecards: 'id, courseId, playedOn, updatedAt',
      })
      .upgrade(async (tx) => {
        const oldRounds: Round[] = await tx.table('rounds').toArray();
        const oldScores: Score[] = await tx.table('scores').toArray();

        // The old saveScore added a row per entry, so the latest one per hole wins.
        const byRound = new Map<string, Map<number, Score>>();
        for (const s of oldScores) {
          const holes = byRound.get(s.roundId) ?? new Map<number, Score>();
          const prev = holes.get(s.hole);
          if (!prev || prev.timestamp < s.timestamp) holes.set(s.hole, s);
          byRound.set(s.roundId, holes);
        }

        for (const round of oldRounds) {
          const holes = byRound.get(round.id);
          if (!holes || holes.size === 0) continue;
          const scores = Array.from({ length: 18 }, (_, i) => {
            const v = holes.get(i + 1)?.score;
            return typeof v === 'number' && v > 0 ? v : null;
          });
          const at = round.date || new Date().toISOString();
          await tx.table('scorecards').put({
            id: newId(),
            courseId: round.courseId,
            playedOn: localDate(new Date(at)),
            teeSet: 'white',
            players: [{ name: 'Me', scores }],
            ownerId: null,
            createdAt: at,
            updatedAt: at,
            syncedAt: null,
          } satisfies Scorecard);
        }

        await tx.table('syncQueue').clear();
      });
    // v6: the course data had the front and back nines swapped, and now numbers
    // the holes as the club does (see pelhamHills.ts). A line drawn in
    // /admin/map before that belongs to the ground it was drawn on, which now
    // carries the other nine's number, so a bends-only row moves with it
    // (2 -> 11, 11 -> 2). A row naming its own tee and pin already says where its
    // number is, and stays - and wins if a moving row would land on it.
    this.version(6)
      .stores({})
      .upgrade(async (tx) => {
        const table = tx.table('holePaths');
        const rows: HolePath[] = await table.where('courseId').equals('pelham-hills').toArray();
        const anchored = new Set(rows.filter((r) => r.tee || r.pin).map((r) => r.holeNumber));
        const moving = rows.filter((r) => !r.tee && !r.pin);
        for (const row of moving) await table.delete(row.id);
        for (const row of moving) {
          const to = row.holeNumber > 9 ? row.holeNumber - 9 : row.holeNumber + 9;
          if (anchored.has(to)) continue;
          const { syncedAt: _dropped, ...rest } = row;
          await table.put({ ...rest, holeNumber: to, id: `${row.courseId}:${to}` } satisfies HolePath);
        }
      });
  }
}

export const db = new GolfGpsDB();
