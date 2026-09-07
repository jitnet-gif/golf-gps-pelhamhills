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
}

export const useGPS = (options: UseGPSOptions = {}) => {
  const {
    enableHighAccuracy = true,
    timeout = 10000,
    maximumAge = 0,
  } = options;

  const { setGPSPosition } = useAppStore();
  const filterRef = useRef<GPSKalmanFilter>(new GPSKalmanFilter());
  const [error, setError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      return;
    }

    setIsTracking(true);
    setError(null);

    const handleSuccess = (position: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = position.coords;

      // Initialize filter on first position
      if (watchIdRef.current === null) {
        filterRef.current.initialize(latitude, longitude);
      }

      // Apply Kalman filter
      const filtered = filterRef.current.update({
        lat: latitude,
        lng: longitude,
        accuracy,
      });

      setGPSPosition({
        latitude: filtered.lat,
        longitude: filtered.lng,
        accuracy: accuracy,
        timestamp: position.timestamp,
      });
    };

    const handleError = (error: GeolocationPositionError) => {
      setError(`GPS error: ${error.message}`);
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy,
        timeout,
        maximumAge,
      }
    );
  }, [enableHighAccuracy, timeout, maximumAge, setGPSPosition]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    setGPSPosition(null);
  }, [setGPSPosition]);

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
