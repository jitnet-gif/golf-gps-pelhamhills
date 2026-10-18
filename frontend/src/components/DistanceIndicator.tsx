import React, { useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { haversineYards, bearingDegrees, compassPoint } from '@/lib/geo';

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

export const DistanceIndicator: React.FC<DistanceIndicatorProps> = ({
  pin,
  className = '',
}) => {
  const { gpsPosition } = useAppStore();

  const { distance, bearing, direction } = useMemo(() => {
    if (!gpsPosition) {
      return { distance: 0, bearing: 0, direction: 'N/A' };
    }

    const dist = haversineYards(
      gpsPosition.latitude,
      gpsPosition.longitude,
      pin.latitude,
      pin.longitude
    );

    const bear = bearingDegrees(
      gpsPosition.latitude,
      gpsPosition.longitude,
      pin.latitude,
      pin.longitude
    );

    const dir = compassPoint(bear);

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
