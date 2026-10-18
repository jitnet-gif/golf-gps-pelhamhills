import { create } from 'zustand';
import type { HolePath, PinSurvey, Scorecard } from '@/db';
import { scoresToMap } from '@/lib/scorecard';

export interface GPSPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

/**
 * Why the phone has no position: location blocked for this site (the player,
 * or an in-app browser like KakaoTalk's, said no), no fix to be had (indoors,
 * location off for the phone), or a browser with no geolocation at all.
 */
export type GpsProblem = 'denied' | 'unavailable' | 'unsupported';

/** The signed-in Supabase account, as much of it as the app needs. */
export interface Account {
  id: string;
  email: string | null;
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  /** Cards with changes the server does not have yet. */
  pending: number;
  /** Why the last sync failed, in words a player can act on. */
  error: string | null;
}

interface AppState {
  /** The card being written on - today's, until another is opened. */
  scorecard: Scorecard | null;
  /**
   * The first row of that card (the account holder's) as hole -> strokes. The
   * round summary and the walk to the next tee read a player's own scores, so
   * they keep reading this rather than digging through the card.
   */
  scores: Map<number, number>;
  gpsPosition: GPSPosition | null;
  /**
   * Why there is no position, when there is none: location blocked for the
   * site, no fix to be had, or no geolocation at all. Null while a fix is
   * being waited for or once one has arrived - see useGPS.
   */
  gpsProblem: GpsProblem | null;
  syncStatus: SyncState['status'];
  syncPending: number;
  syncError: string | null;
  /** Null when signed out. `accountReady` is false until the session has been read. */
  account: Account | null;
  accountReady: boolean;
  /**
   * The phone's storage did not answer in time, so the card on screen is not
   * being kept on the phone yet - see useScorecard. Clears when it answers.
   */
  storageStuck: boolean;
  isOnline: boolean;
  currentCourseId: string | null;
  /**
   * Pins and tees surveyed on site, by hole number. A hole present here is a
   * hole whose live distances are trustworthy; every other hole falls back to
   * the printed yardage. Hydrated from Dexie, kept here so a capture re-renders
   * the distance readout immediately.
   */
  pinSurveys: Map<number, PinSurvey>;
  /**
   * Fairway lines drawn in /admin/map on this device, by hole number. Bends the
   * line on the map and nothing else - a waypoint is never a pin, and must not
   * sit in pinSurveys where it would switch live distances on.
   */
  holePaths: Map<number, HolePath>;
  /**
   * True while an operator's simulated arrival is feeding fixes. Real GPS fixes
   * are held back meanwhile (useGPS), and must never stay held back after the
   * run - useArrivalSimulation clears this in a finally, on stop and on unmount.
   */
  simulatingGps: boolean;
  setSimulatingGps: (on: boolean) => void;
  uiState: {
    selectedHole: number | null;
    showSettings: boolean;
  };

  // Actions
  setScorecard: (card: Scorecard | null) => void;
  setGPSPosition: (position: GPSPosition | null) => void;
  setGpsProblem: (problem: GpsProblem | null) => void;
  setPinSurveys: (surveys: PinSurvey[]) => void;
  setPinSurvey: (survey: PinSurvey) => void;
  removePinSurvey: (holeNumber: number) => void;
  setHolePaths: (paths: HolePath[]) => void;
  setHolePath: (path: HolePath) => void;
  removeHolePath: (holeNumber: number) => void;
  setSyncState: (state: Partial<SyncState>) => void;
  setAccount: (account: Account | null) => void;
  setStorageStuck: (stuck: boolean) => void;
  setIsOnline: (online: boolean) => void;
  setCurrentCourseId: (courseId: string | null) => void;
  setSelectedHole: (hole: number | null) => void;
  setShowSettings: (show: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  scorecard: null,
  scores: new Map(),
  gpsPosition: null,
  gpsProblem: null,
  syncStatus: 'idle',
  syncPending: 0,
  syncError: null,
  account: null,
  accountReady: false,
  storageStuck: false,
  isOnline: typeof navigator !== 'undefined' && navigator.onLine,
  currentCourseId: null,
  pinSurveys: new Map(),
  holePaths: new Map(),
  simulatingGps: false,
  setSimulatingGps: (on) => set({ simulatingGps: on }),
  uiState: {
    selectedHole: null,
    showSettings: false,
  },

  setScorecard: (card) =>
    set({ scorecard: card, scores: scoresToMap(card?.players[0]?.scores) }),
  setGPSPosition: (position) => set({ gpsPosition: position }),
  setGpsProblem: (problem) => set({ gpsProblem: problem }),
  setPinSurveys: (surveys) =>
    set({ pinSurveys: new Map(surveys.map((s) => [s.holeNumber, s])) }),
  setPinSurvey: (survey) =>
    set((state) => {
      const next = new Map(state.pinSurveys);
      next.set(survey.holeNumber, survey);
      return { pinSurveys: next };
    }),
  removePinSurvey: (holeNumber) =>
    set((state) => {
      const next = new Map(state.pinSurveys);
      next.delete(holeNumber);
      return { pinSurveys: next };
    }),
  setHolePaths: (paths) =>
    set({ holePaths: new Map(paths.map((p) => [p.holeNumber, p])) }),
  setHolePath: (path) =>
    set((state) => {
      const next = new Map(state.holePaths);
      next.set(path.holeNumber, path);
      return { holePaths: next };
    }),
  removeHolePath: (holeNumber) =>
    set((state) => {
      const next = new Map(state.holePaths);
      next.delete(holeNumber);
      return { holePaths: next };
    }),
  setSyncState: (s) =>
    set((state) => ({
      syncStatus: s.status ?? state.syncStatus,
      syncPending: s.pending ?? state.syncPending,
      syncError: s.error !== undefined ? s.error : state.syncError,
    })),
  setAccount: (account) => set({ account, accountReady: true }),
  setStorageStuck: (stuck) => set({ storageStuck: stuck }),
  setIsOnline: (online) => set({ isOnline: online }),
  setCurrentCourseId: (courseId) => set({ currentCourseId: courseId }),
  setSelectedHole: (hole) =>
    set((state) => ({
      uiState: { ...state.uiState, selectedHole: hole },
    })),
  setShowSettings: (show) =>
    set((state) => ({
      uiState: { ...state.uiState, showSettings: show },
    })),
}));
