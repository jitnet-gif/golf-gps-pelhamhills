import { create } from 'zustand';
import type { PinSurvey } from '@/db';

export interface Round {
  id: string;
  courseId: string;
  date: string;
  holes: { holeNumber: number; score?: number; timestamp?: string }[];
}

export interface GPSPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export interface SyncQueueItem {
  type: 'score' | 'round' | 'tile-meta';
  payload: Record<string, unknown>;
  timestamp: string;
  id?: string;
}

interface AppState {
  currentRound: Round | null;
  scores: Map<number, number>; // hole number -> score
  gpsPosition: GPSPosition | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  isOnline: boolean;
  currentCourseId: string | null;
  /**
   * Pins and tees surveyed on site, by hole number. A hole present here is a
   * hole whose live distances are trustworthy; every other hole falls back to
   * the printed yardage. Hydrated from Dexie, kept here so a capture re-renders
   * the distance readout immediately.
   */
  pinSurveys: Map<number, PinSurvey>;
  uiState: {
    selectedHole: number | null;
    showScoreSheet: boolean;
    showSettings: boolean;
  };

  // Actions
  setCurrentRound: (round: Round | null) => void;
  setScore: (holeNumber: number, score: number) => void;
  setGPSPosition: (position: GPSPosition | null) => void;
  setPinSurveys: (surveys: PinSurvey[]) => void;
  setPinSurvey: (survey: PinSurvey) => void;
  removePinSurvey: (holeNumber: number) => void;
  setSyncStatus: (status: 'idle' | 'syncing' | 'error') => void;
  setIsOnline: (online: boolean) => void;
  setCurrentCourseId: (courseId: string | null) => void;
  setSelectedHole: (hole: number | null) => void;
  setShowScoreSheet: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  resetRound: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentRound: null,
  scores: new Map(),
  gpsPosition: null,
  syncStatus: 'idle',
  isOnline: typeof navigator !== 'undefined' && navigator.onLine,
  currentCourseId: null,
  pinSurveys: new Map(),
  uiState: {
    selectedHole: null,
    showScoreSheet: false,
    showSettings: false,
  },

  setCurrentRound: (round) => set({ currentRound: round }),
  setScore: (holeNumber, score) =>
    set((state) => {
      const newScores = new Map(state.scores);
      newScores.set(holeNumber, score);
      return { scores: newScores };
    }),
  setGPSPosition: (position) => set({ gpsPosition: position }),
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
  setSyncStatus: (status) => set({ syncStatus: status }),
  setIsOnline: (online) => set({ isOnline: online }),
  setCurrentCourseId: (courseId) => set({ currentCourseId: courseId }),
  setSelectedHole: (hole) =>
    set((state) => ({
      uiState: { ...state.uiState, selectedHole: hole },
    })),
  setShowScoreSheet: (show) =>
    set((state) => ({
      uiState: { ...state.uiState, showScoreSheet: show },
    })),
  setShowSettings: (show) =>
    set((state) => ({
      uiState: { ...state.uiState, showSettings: show },
    })),
  resetRound: () =>
    set({
      currentRound: null,
      scores: new Map(),
      currentCourseId: null,
    }),
}));
