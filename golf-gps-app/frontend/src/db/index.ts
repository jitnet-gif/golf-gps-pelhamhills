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

  constructor() {
    super('GolfGpsDB');
    this.version(1).stores({
      rounds: 'id, courseId, date',
      scores: '++id, roundId, hole, timestamp',
      syncQueue: '++id, type, timestamp',
      tileMeta: '++id, courseId, lastUpdated',
    });
  }
}

export const db = new GolfGpsDB();
