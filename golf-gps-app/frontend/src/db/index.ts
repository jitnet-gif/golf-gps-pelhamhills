import Dexie, { type Table } from 'dexie';

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

export class GolfGpsDB extends Dexie {
  rounds!: Table<Round>;
  scores!: Table<Score>;
  syncQueue!: Table<SyncQueueItem>;
  tileMeta!: Table<TileMeta>;
  promotions!: Table<CachedPromotion>;
  pinSurveys!: Table<PinSurvey>;

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
  }
}

export const db = new GolfGpsDB();
