import React, { useMemo } from 'react';
import { useAppStore } from '@/store/appStore';

interface Pin {
  latitude: number;
  longitude: number;
  holeNumber: number;
  name?: string;
}

interface DistanceIndicatorProps {
  pin: Pin;
  className?: string;
}

/**
 * Calculate distance between two points using Haversine formula.
 * Returns distance in yards.
 */
const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceInMeters = R * c;

  // Convert meters to yards
  return distanceInMeters * 1.09361;
};

/**
 * Calculate bearing between two points in degrees (0-360)
 */
const calculateBearing = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(dLon);

  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  bearing = (bearing + 360) % 360;
  return bearing;
};

const getCompassDirection = (bearing: number): string => {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(bearing / 22.5) % 16;
  return directions[index];
};

export const DistanceIndicator: React.FC<DistanceIndicatorProps> = ({
  pin,
  className = '',
}) => {
  const { gpsPosition } = useAppStore();

  const { distance, bearing, direction } = useMemo(() => {
    if (!gpsPosition) {
      return { distance: 0, bearing: 0, direction: 'N/A' };
    }

    const dist = calculateDistance(
      gpsPosition.latitude,
      gpsPosition.longitude,
      pin.latitude,
      pin.longitude
    );

    const bear = calculateBearing(
      gpsPosition.latitude,
      gpsPosition.longitude,
      pin.latitude,
      pin.longitude
    );

    const dir = getCompassDirection(bear);

    return {
      distance: dist,
      bearing: bear,
      direction: dir,
    };
  }, [gpsPosition, pin]);

  if (!gpsPosition) {
    return (
      <div className={`text-center text-sm text-muted-foreground ${className}`}>
        Acquiring GPS signal...
      </div>
    );
  }

  const yardage = Math.round(distance);

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <div className="text-4xl font-bold text-primary">
        {yardage}
        <span className="text-sm font-normal ml-1">yd</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {direction} ({Math.round(bearing)}°)
      </div>
      <div className="text-xs text-muted-foreground">
        ±{Math.round(gpsPosition.accuracy)}m accuracy
      </div>

      {/* Visual compass indicator */}
      <div className="relative w-16 h-16 border-2 border-border rounded-full mt-2 flex items-center justify-center">
        <div
          className="absolute w-0.5 h-6 bg-primary rounded-full origin-bottom"
          style={{ transform: `rotate(${bearing}deg)` }}
        />
        <div className="text-xs font-semibold text-muted-foreground">N</div>
      </div>
    </div>
  );
};
