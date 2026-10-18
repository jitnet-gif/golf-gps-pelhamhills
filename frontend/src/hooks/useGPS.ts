import { useEffect, useCallback, useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';

interface KalmanState {
  latitude: number;
  longitude: number;
  latitudeCovariance: number;
  longitudeCovariance: number;
}

/**
 * Scalar Kalman filter for GPS position smoothing.
 * Filters lat/lng independently using measurement variance from GeolocationPosition.coords.accuracy
 */
class GPSKalmanFilter {
  private stateX: KalmanState = {
    latitude: 0,
    longitude: 0,
    latitudeCovariance: 1,
    longitudeCovariance: 1,
  };

  private processNoise = 0.00001; // Process noise (system uncertainty)

  constructor() {}

  update(
    measurement: { lat: number; lng: number; accuracy: number }
  ): { lat: number; lng: number } {
    const { lat, lng, accuracy } = measurement;

    // Measurement noise (from GPS accuracy in meters, convert to degrees)
    const measurementNoise = Math.max(
      (accuracy / 111320) * (accuracy / 111320),
      0.00000001
    );

    // Latitude update
    const latPriorCov = this.stateX.latitudeCovariance + this.processNoise;
    const latKalmanGain =
      latPriorCov / (latPriorCov + measurementNoise);
    this.stateX.latitude +=
      latKalmanGain * (lat - this.stateX.latitude);
    this.stateX.latitudeCovariance =
      (1 - latKalmanGain) * latPriorCov;

    // Longitude update
    const lngPriorCov =
      this.stateX.longitudeCovariance + this.processNoise;
    const lngKalmanGain =
      lngPriorCov / (lngPriorCov + measurementNoise);
    this.stateX.longitude +=
      lngKalmanGain * (lng - this.stateX.longitude);
    this.stateX.longitudeCovariance =
      (1 - lngKalmanGain) * lngPriorCov;

    return {
      lat: this.stateX.latitude,
      lng: this.stateX.longitude,
    };
  }

  initialize(lat: number, lng: number): void {
    this.stateX.latitude = lat;
    this.stateX.longitude = lng;
    this.stateX.latitudeCovariance = 1;
    this.stateX.longitudeCovariance = 1;
  }
}

export interface UseGPSOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  /**
   * Whether this phone may be asked where it is at all. Default true, and the
   * round page pins it there - the club forced GPS on (see pages/Golf.tsx).
   *
   * It stays a real option because the hook starts the watch again by itself in
   * two places - when the browser's location permission changes, and when the
   * tab comes back to the front - so anything that ever wants tracking off must
   * be able to say so here rather than only at the call site.
   */
  enabled?: boolean;
}

/**
 * The phone's position, smoothed, into the store - and, when there is none,
 * why not (store.gpsProblem), so the screen can say so instead of "finding
 * you" for ever.
 *
 * The error used to be kept in this hook's own state, which nothing read: a
 * player whose browser blocked location (KakaoTalk's in-app browser does, by
 * default) or whose phone had no fix saw the same endless "Finding you...".
 */
export const useGPS = (options: UseGPSOptions = {}) => {
  const {
    enableHighAccuracy = true,
    timeout = 15000,
    maximumAge = 0,
    enabled = true,
  } = options;

  // Read inside callbacks that must see the current answer rather than the one
  // they closed over - the permission and visibility listeners below.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const setGPSPosition = useAppStore((s) => s.setGPSPosition);
  const setGpsProblem = useAppStore((s) => s.setGpsProblem);
  const filterRef = useRef<GPSKalmanFilter>(new GPSKalmanFilter());
  // Whether the filter has been seeded. This used to test watchIdRef, which
  // watchPosition has already set by the time any fix arrives - so the filter
  // was never seeded and began every round at 0°, 0°.
  const seededRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  const clearWatch = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  /** Start - or start again, which is what "Try again" is. */
  const startTracking = useCallback(() => {
    // Switched off by the player. Not an error and not a problem to report -
    // the pill says "GPS off" and the switch is how it comes back.
    if (!enabledRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation not supported');
      setGpsProblem('unsupported');
      return;
    }

    clearWatch();
    setIsTracking(true);
    setError(null);

    const handleSuccess = (position: GeolocationPosition) => {
      // An operator is walking a simulated arrival through the detector (see
      // useArrivalSimulation). A real fix from a desk kilometres away would reset
      // its dwell every second, so real fixes wait until the run has finished.
      if (useAppStore.getState().simulatingGps) return;

      const { latitude, longitude, accuracy } = position.coords;

      if (!seededRef.current) {
        filterRef.current.initialize(latitude, longitude);
        seededRef.current = true;
      }

      const filtered = filterRef.current.update({
        lat: latitude,
        lng: longitude,
        accuracy,
      });

      if (useAppStore.getState().gpsProblem) setGpsProblem(null);
      setGPSPosition({
        latitude: filtered.lat,
        longitude: filtered.lng,
        accuracy: accuracy,
        timestamp: position.timestamp,
      });
    };

    const handleError = (err: GeolocationPositionError) => {
      setError(`GPS error: ${err.message}`);
      if (err.code === err.PERMISSION_DENIED) {
        setGpsProblem('denied');
      } else if (!useAppStore.getState().gpsPosition) {
        // A timeout or a lost fix only counts while there is no position at
        // all. Mid-round one missed fix is not worth a warning; the last stands,
        // and the watch carries on trying.
        setGpsProblem('unavailable');
      }
    };

    watchIdRef.current = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy,
      timeout,
      maximumAge,
    });
  }, [enableHighAccuracy, timeout, maximumAge, setGPSPosition, setGpsProblem]);

  const stopTracking = useCallback(() => {
    clearWatch();
    setIsTracking(false);
    setGPSPosition(null);
    setError(null);
    // A refused permission from before the switch was turned off is no longer
    // what is wrong - the switch is - and leaving it set would show the player
    // a location-help sheet they cannot act on.
    setGpsProblem(null);
  }, [setGPSPosition, setGpsProblem]);

  // Location turned back on in the browser's settings: start again, no reload.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let alive = true;
    const onChange = () => {
      if (!status) return;
      if (!enabledRef.current) return;
      if (status.state === 'denied') setGpsProblem('denied');
      else if (useAppStore.getState().gpsProblem) startTracking();
    };
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((s) => {
        if (!alive) return;
        status = s;
        s.addEventListener('change', onChange);
      })
      .catch(() => {
        /* no Permissions API - "Try again" and coming back to the tab still work */
      });
    return () => {
      alive = false;
      status?.removeEventListener('change', onChange);
    };
  }, [startTracking, setGpsProblem]);

  // Coming back from the phone's settings is coming back to this tab.
  useEffect(() => {
    const onVisible = () => {
      if (!enabledRef.current) return;
      if (document.visibilityState === 'visible' && useAppStore.getState().gpsProblem) {
        startTracking();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [startTracking]);

  // Turned off mid-round: drop the watch here rather than trusting every caller
  // to remember. Turning it back on is the caller's to do (Golf.tsx's effect).
  useEffect(() => {
    if (!enabled && watchIdRef.current !== null) stopTracking();
  }, [enabled, stopTracking]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return {
    isTracking,
    error,
    startTracking,
    stopTracking,
  };
};
