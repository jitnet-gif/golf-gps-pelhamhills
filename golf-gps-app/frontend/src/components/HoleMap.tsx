import React, { useEffect, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  Circle,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAppStore } from '@/store/appStore';
import { useMapTiles } from '@/hooks';

// Fix default marker icons for Vite
const DefaultIcon = L.icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const CurrentLocationIcon = L.icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iY3VycmVudENvbG9yIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI4IiBmaWxsPSIjMmU3ZDMyIi8+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iNCIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
});

const PinIcon = L.icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2VmNDQ0NiIgZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyYzAgNyAxMCAxNCAxMCAxNHMxMC03IDEwLTE0YzAtNS41Mi00LjQ4LTEwLTEwLTEwem0wIDE2Yy0zLjMxIDAtNi0yLjY5LTYtNnMyLjY5LTYgNi02IDYgMi42OSA2IDYtMi42OSA2LTYgNnoiLz48L3N2Zz4=',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

L.Marker.prototype.options.icon = DefaultIcon;

interface HoleMapProps {
  courseId: string;
  holes?: {
    holeNumber: number;
    latitude: number;
    longitude: number;
    par: number;
    handicap?: number;
  }[];
  center?: { lat: number; lng: number };
  zoom?: number;
  onHoleClick?: (hole: number) => void;
}

const MapContent: React.FC<{
  holes?: HoleMapProps['holes'];
  onHoleClick?: (hole: number) => void;
  courseId: string;
  tileUrl: string;
}> = ({ holes, onHoleClick, courseId, tileUrl }) => {
  const map = useMap();
  const { gpsPosition, selectedHole } = useAppStore((state) => ({
    gpsPosition: state.gpsPosition,
    selectedHole: state.uiState.selectedHole,
  }));

  // Center map on GPS position when available
  useEffect(() => {
    if (gpsPosition) {
      map.setView(
        [gpsPosition.latitude, gpsPosition.longitude],
        map.getZoom()
      );
    }
  }, [gpsPosition, map]);

  // Highlight selected hole
  useEffect(() => {
    if (selectedHole && holes) {
      const hole = holes.find((h) => h.holeNumber === selectedHole);
      if (hole) {
        map.setView([hole.latitude, hole.longitude], 18);
      }
    }
  }, [selectedHole, holes, map]);

  return (
    <>
      <TileLayer
        url={tileUrl}
        attribution="© Golf GPS"
        maxZoom={20}
        crossOrigin="anonymous"
      />

      {/* Current location marker */}
      {gpsPosition && (
        <>
          <Marker
            position={[gpsPosition.latitude, gpsPosition.longitude]}
            icon={CurrentLocationIcon}
          >
            <Popup>
              Current Location
              <br />
              Accuracy: ±{Math.round(gpsPosition.accuracy)}m
            </Popup>
          </Marker>
          <Circle
            center={[gpsPosition.latitude, gpsPosition.longitude]}
            radius={gpsPosition.accuracy}
            pathOptions={{
              color: 'blue',
              fillColor: 'blue',
              fillOpacity: 0.1,
            }}
          />
        </>
      )}

      {/* Hole pins */}
      {holes &&
        holes.map((hole) => (
          <Marker
            key={hole.holeNumber}
            position={[hole.latitude, hole.longitude]}
            icon={PinIcon}
            eventHandlers={{
              click: () => onHoleClick?.(hole.holeNumber),
            }}
          >
            <Popup>
              <div className="text-sm">
                <strong>Hole {hole.holeNumber}</strong>
                <br />
                Par {hole.par}
                {hole.handicap && <> (HCP {hole.handicap})</>}
              </div>
            </Popup>
          </Marker>
        ))}
    </>
  );
};

export const HoleMap: React.FC<HoleMapProps> = ({
  courseId,
  holes,
  center = { lat: 40.0, lng: -74.0 },
  zoom = 16,
  onHoleClick,
}) => {
  const { getTileUrl } = useMapTiles({ courseId });

  const tileUrl = useMemo(() => getTileUrl(0, 0, 0), [getTileUrl]);

  return (
    <div className="w-full h-full rounded-lg overflow-hidden border border-border">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
        scrollWheelZoom={true}
      >
        <MapContent
          holes={holes}
          onHoleClick={onHoleClick}
          courseId={courseId}
          tileUrl={tileUrl}
        />
      </MapContainer>
    </div>
  );
};
