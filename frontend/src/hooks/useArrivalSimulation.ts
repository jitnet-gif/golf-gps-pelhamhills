import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { ARRIVAL_DEFAULTS, type ArrivalHole } from '@/lib/holeArrival';
import { haversineMetres, METRES_TO_YARDS } from '@/lib/geo';

/**
 * Operators only: put this phone on a tee - or on the walk to one - without
 * going there.
 *
 * It feeds GPS fixes into the store and lets the real machinery decide, so what
 * it exercises is exactly what a round uses: the arrival detector's dwell and
 * armed holes, the next-tee guidance card and its spoken cues, the auto
 * narration and the arrival notice. Nothing downstream knows the fixes are made
 * up.
 *
 * Fixes carry timestamps two seconds apart, as a phone's would, and both the
 * detector and the guidance measure time by those rather than by a clock - so
 * the fast run can compress the 20 s dwell into two seconds and still be judged
 * exactly as a real one. The real-pace run spaces them two seconds apart in
 * wall time too, which is how to see the "stay put" message the way a player
 * does.
 *
 * It lives on the page, not in the menu panel that starts it. On a phone the
 * menu covers the map, and a walk is only worth simulating if the map, the
 * guidance card and the arrival notice can be watched while it happens - so the
 * run must survive the menu closing, and the page shows its own Stop.
 *
 * Real GPS is held back while a run feeds fixes (see useGPS): a fix from a desk
 * kilometres away would break the dwell every second. That hold must never
 * outlive the run - it is released in a finally, by stop(), and when the page
 * unmounts, because a phone that silently stops tracking its player is the worst
 * thing this app could do on a course.
 */

export interface SimulationRun {
  holeNumber: number;
  /** 'walk' starts from the previous hole's green; 'tee' stands on the tee. */
  kind: 'tee' | 'walk';
  phase: 'walking' | 'waiting';
  /** Yards still to walk to the tee; 0 once there. */
  yardsLeft: number;
  /** Simulated time spent standing on the tee so far. */
  waitedMs: number;
}

export interface SimulationStart {
  tee: ArrivalHole;
  /** Where the walk begins - the previous hole's green. null stands on the tee. */
  from: { latitude: number; longitude: number } | null;
  realPace: boolean;
}

/** A phone's watchPosition cadence, roughly - what the detector expects. */
const FIX_MS = 2000;

/** Walking pace, 1.4 m/s, over one fix. */
const WALK_METRES_PER_FIX = 2.8;

/** What a simulated fix admits to - well inside both modules' 25 m limit. */
const ACCURACY_METRES = 5;

/**
 * Pause between injected fixes in the fast run. Not a nicety: the hooks read
 * only the newest fix in the store, so fixes set within one tick collapse into
 * a single render and a dwell never completes. Keep it above zero.
 */
const FAST_STEP_MS = 150;

/**
 * Inside this distance the walk slows to CUE_STEP_MS a fix. The guidance speaks
 * at 100 and 50 yards, and speaking cancels whatever is still being said - at
 * the fast pace those two cues would land a second apart and the operator would
 * hear half of each. Further out there is nothing to hear, so a long walk is
 * not made to crawl.
 */
const CUE_ZONE_YARDS = 130;
const CUE_STEP_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Point = { latitude: number; longitude: number };

/** A straight line at walking pace, the start included and the tee excluded. */
const walkPoints = (from: Point, to: Point): Point[] => {
  const metres = haversineMetres(from.latitude, from.longitude, to.latitude, to.longitude);
  const steps = Math.max(1, Math.ceil(metres / WALK_METRES_PER_FIX));
  return Array.from({ length: steps }, (_, i) => ({
    latitude: from.latitude + ((to.latitude - from.latitude) * i) / steps,
    longitude: from.longitude + ((to.longitude - from.longitude) * i) / steps,
  }));
};

export const useArrivalSimulation = () => {
  const setGPSPosition = useAppStore((s) => s.setGPSPosition);
  const setSimulatingGps = useAppStore((s) => s.setSimulatingGps);

  const [run, setRun] = useState<SimulationRun | null>(null);
  /** The hole the last run reached the end of, whether or not it was announced. */
  const [finished, setFinished] = useState<number | null>(null);

  // Bumped by every start, stop and unmount; a loop whose id is stale stops.
  const runIdRef = useRef(0);

  useEffect(
    () => () => {
      runIdRef.current += 1;
      useAppStore.getState().setSimulatingGps(false);
    },
    []
  );

  const stop = useCallback(() => {
    runIdRef.current += 1;
    setSimulatingGps(false);
    setRun(null);
  }, [setSimulatingGps]);

  const start = useCallback(
    ({ tee, from, realPace }: SimulationStart) => {
      const runId = ++runIdRef.current;
      const kind = from ? 'walk' : 'tee';
      const teePoint = { latitude: tee.teeLatitude, longitude: tee.teeLongitude };
      const walk = from ? walkPoints(from, teePoint) : [];
      // One fix past the dwell, so the one that completes it is never the last.
      const waits = Math.ceil(ARRIVAL_DEFAULTS.dwellMs / FIX_MS) + 1;
      const t0 = Date.now();

      setSimulatingGps(true);
      setFinished(null);

      void (async () => {
        try {
          for (let i = 0; i <= walk.length + waits; i += 1) {
            if (runIdRef.current !== runId) return;

            const walking = i < walk.length;
            const at = walking ? walk[i] : teePoint;
            const yardsLeft = walking
              ? haversineMetres(at.latitude, at.longitude, tee.teeLatitude, tee.teeLongitude) *
                METRES_TO_YARDS
              : 0;

            setGPSPosition({ ...at, accuracy: ACCURACY_METRES, timestamp: t0 + i * FIX_MS });
            setRun({
              holeNumber: tee.holeNumber,
              kind,
              phase: walking ? 'walking' : 'waiting',
              yardsLeft,
              waitedMs: walking ? 0 : Math.min((i - walk.length) * FIX_MS, ARRIVAL_DEFAULTS.dwellMs),
            });

            await sleep(
              realPace
                ? FIX_MS
                : walking && yardsLeft <= CUE_ZONE_YARDS
                  ? CUE_STEP_MS
                  : FAST_STEP_MS
            );
          }
          if (runIdRef.current === runId) setFinished(tee.holeNumber);
        } finally {
          if (runIdRef.current === runId) {
            setSimulatingGps(false);
            setRun(null);
          }
        }
      })();
    },
    [setGPSPosition, setSimulatingGps]
  );

  return { run, finished, start, stop };
};
