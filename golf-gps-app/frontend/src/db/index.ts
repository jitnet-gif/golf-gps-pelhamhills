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

export class GolfGpsDB extends Dexie {
  rounds!: Table<Round>;
  scores!: Table<Score>;
  syncQueue!: Table<SyncQueueItem>;
  tileMeta!: Table<TileMeta>;
  promotions!: Table<CachedPromotion>;

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
  }
}

export const db = new GolfGpsDB();
