/**
 * One careful GPS reading, for placing a tee or pin by standing on it.
 *
 * A phone's first fix is often its worst - tens of metres while it is still
 * finding satellites. So this listens for a while and keeps the most accurate
 * reading, stopping early once one is good enough to trust.
 */

import type { FairwayPoint } from '@/data/pelhamHills';

export interface GpsReading {
  point: FairwayPoint;
  /** Metres, as the phone reports it (68% confidence radius). */
  accuracy: number;
}

export type GpsProblem = 'unsupported' | 'denied' | 'noSignal';

/** Good enough to stop listening: a tee box or the middle of a green. */
const GOOD_ENOUGH_M = 5;
const LISTEN_MS = 10_000;

export class GpsCaptureError extends Error {
  constructor(public problem: GpsProblem) {
    super(problem);
    this.name = 'GpsCaptureError';
  }
}

export const captureGps = (): Promise<GpsReading> =>
  new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new GpsCaptureError('unsupported'));
      return;
    }

    let best: GeolocationPosition | null = null;
    let watchId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (timer !== null) clearTimeout(timer);
    };
    const finish = () => {
      stop();
      if (best) {
        resolve({
          point: [best.coords.latitude, best.coords.longitude],
          accuracy: best.coords.accuracy,
        });
      } else {
        reject(new GpsCaptureError('noSignal'));
      }
    };

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
        if (position.coords.accuracy <= GOOD_ENOUGH_M) finish();
      },
      (error) => {
        // A timeout after some readings still leaves the best of them.
        if (error.code === error.PERMISSION_DENIED) {
          stop();
          reject(new GpsCaptureError('denied'));
        } else if (!best) {
          stop();
          reject(new GpsCaptureError('noSignal'));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: LISTEN_MS }
    );
    timer = setTimeout(finish, LISTEN_MS);
  });

/**
 * "42.9814791, -79.2997647" - or with a space, or with the brackets a copy from
 * this screen gives. Null when it is not two plausible numbers.
 */
export const parsePoint = (text: string): FairwayPoint | null => {
  const numbers = text.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length !== 2) return null;
  const [lat, lng] = numbers.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
};
