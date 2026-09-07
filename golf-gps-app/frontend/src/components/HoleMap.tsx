import React, { useEffect, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
  Circle,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAppStore } from '@/store/appStore';

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

// White ring on a dark disc - stays readable against fairway green in the
// satellite imagery, and reads differently from the red pin.
const TeeIcon = L.icon({
  iconUrl:
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iOSIgZmlsbD0iIzExMTgyNyIgZmlsbC1vcGFjaXR5PSIwLjg1Ii8+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iOSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIzIiBmaWxsPSIjZmZmIi8+PC9zdmc+',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
});

L.Marker.prototype.options.icon = DefaultIcon;

/** Esri World Imagery serves real detail down to z20 over Pelham Hills. */
const MAX_ZOOM = 20;
/** Framing a 120 m par 3 would otherwise push past the crisp imagery. */
const HOLE_MAX_ZOOM = 19;

export interface MapHole {
  holeNumber: number;
  par: number;
  handicap?: number;
  /** Metres, tee to pin along the centreline. */
  length?: number;
  latitude: number;
  longitude: number;
  teeLatitude?: number;
  teeLongitude?: number;
}

interface HoleMapProps {
  courseId: string;
  holes?: MapHole[];
  center: { lat: number; lng: number };
  zoom?: number;
  /** Track the player instead of holding the frame on the selected hole. */
  followGps?: boolean;
  onHoleClick?: (hole: number) => void;
}

const MapContent: React.FC<{
  holes?: MapHole[];
  onHoleClick?: (hole: number) => void;
  courseId: string;
  tileUrl: string;
  followGps: boolean;
}> = ({ holes, onHoleClick, tileUrl, followGps }) => {
  const map = useMap();
  const gpsPosition = useAppStore((state) => state.gpsPosition);
  const selectedHole = useAppStore((state) => state.uiState.selectedHole);

  const activeHole = useMemo(
    () => holes?.find((h) => h.holeNumber === selectedHole) ?? null,
    [holes, selectedHole]
  );

  const teeLatLng = useMemo((): [number, number] | null => {
    if (!activeHole) return null;
    const { teeLatitude, teeLongitude } = activeHole;
    return teeLatitude != null && teeLongitude != null
      ? [teeLatitude, teeLongitude]
      : null;
  }, [activeHole]);

  // Re-centre on the player only in follow mode. Reading a hole means the map
  // has to hold still - a watchPosition stream would otherwise yank it back on
  // every fix.
  useEffect(() => {
    if (!followGps || !gpsPosition) return;
    map.setView([gpsPosition.latitude, gpsPosition.longitude], map.getZoom());
  }, [followGps, gpsPosition, map]);

  // Frame the selected hole so tee and pin are both on screen. Keyed on the
  // hole number, so a GPS tick never re-frames a hole the user has panned away
  // from.
  useEffect(() => {
    if (followGps || selectedHole === null) return;

    const hole = holes?.find((h) => h.holeNumber === selectedHole);
    if (!hole) return;

    if (hole.teeLatitude != null && hole.teeLongitude != null) {
      map.fitBounds(
        L.latLngBounds([
          [hole.teeLatitude, hole.teeLongitude],
          [hole.latitude, hole.longitude],
        ]),
        { padding: [48, 48], maxZoom: HOLE_MAX_ZOOM }
      );
    } else {
      map.setView([hole.latitude, hole.longitude], HOLE_MAX_ZOOM);
    }
  }, [followGps, selectedHole, holes, map]);

  return (
    <>
      <TileLayer
        url={tileUrl}
        attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics"
        maxZoom={MAX_ZOOM}
        maxNativeZoom={MAX_ZOOM}
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

      {/* Selected hole: the tee and its centreline to the pin */}
      {activeHole && teeLatLng && (
        <>
          <Polyline
            positions={[teeLatLng, [activeHole.latitude, activeHole.longitude]]}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              opacity: 0.9,
              dashArray: '8 8',
            }}
          />
          <Marker position={teeLatLng} icon={TeeIcon}>
            <Popup>
              <div className="text-sm">
                <strong>Hole {activeHole.holeNumber} tee</strong>
                {activeHole.length != null && (
                  <>
                    <br />
                    {Math.round(activeHole.length * 1.09361)} yds to the pin
                  </>
                )}
              </div>
            </Popup>
          </Marker>
        </>
      )}

      {/* Hole pins - the rest of the course fades back once a hole is picked */}
      {holes &&
        holes.map((hole) => (
          <Marker
            key={hole.holeNumber}
            position={[hole.latitude, hole.longitude]}
            icon={PinIcon}
            opacity={
              selectedHole === null || selectedHole === hole.holeNumber ? 1 : 0.45
            }
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

// Leaflet needs a {z}/{x}/{y} template, not a resolved URL. Esri World Imagery
// serves {z}/{y}/{x} - note the swapped order.
const TILE_URL =
  import.meta.env.VITE_TILE_URL ||
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const HoleMap: React.FC<HoleMapProps> = ({
  courseId,
  holes,
  center,
  zoom = 16,
  followGps = false,
  onHoleClick,
}) => {
  const tileUrl = TILE_URL;

  return (
    <div className="w-full h-full rounded-lg overflow-hidden border border-border">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        maxZoom={MAX_ZOOM}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
        scrollWheelZoom={true}
      >
        <MapContent
          holes={holes}
          onHoleClick={onHoleClick}
          courseId={courseId}
          tileUrl={tileUrl}
          followGps={followGps}
        />
      </MapContainer>
    </div>
  );
};
