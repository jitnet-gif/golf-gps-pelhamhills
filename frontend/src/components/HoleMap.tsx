import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  ImageOverlay,
  Pane,
  Marker,
  Popup,
  Polyline,
  useMap,
  Circle,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Flag } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { FairwayPoint } from '@/data/pelhamHills';
import { COURSE_MAP_OVERLAY } from '@/data/courseMap';
import { pointAlong } from '@/lib/holePaths';
import { useFairwayDistance, type FairwayDistance } from '@/hooks/useFairwayDistance';
import { bearingDegrees, haversineMetres, METRES_TO_YARDS } from '@/lib/geo';
import type { GuidanceTee } from '@/lib/teeGuidance';
import {
  TILE_ATTRIBUTION,
  TILE_MAX_ZOOM,
  TILE_URL_TEMPLATE,
} from '@/lib/tiles';

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

/**
 * A hole view turns so the pin is up (see HoleMap below). Anything with writing
 * or a top and bottom on it turns back by the same angle, so it stays upright
 * however the map lies. The variable is only set on a turned map; everywhere
 * else - the full map, the admin editor - it falls back to no turn at all.
 */
const UPRIGHT = 'rotate(var(--map-counter, 0deg))';

/**
 * The pin: a small flag on its stick, the foot of the stick on the hole. A
 * golfer reads a flag as the hole at a glance, and it covers far less of the
 * green than the map-pin drop it replaced - which, eighteen deep on the full
 * map, hid half the course. The stick is white on a dark edge so it shows on
 * fairway and rough alike. It stands up from its foot on a turned map.
 *
 * Exported, like TeeIcon, for the admin fairway editor, so both maps mark tee
 * and pin alike.
 */
export const PinIcon = L.divIcon({
  className: '',
  html:
    `<svg data-pin-flag xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 26" width="20" height="26" style="display:block;overflow:visible;transform:${UPRIGHT};transform-origin:5px 24px">` +
    '<ellipse cx="5" cy="24" rx="3.5" ry="1.6" fill="#111827" fill-opacity=".7"/>' +
    '<line x1="5" y1="24" x2="5" y2="2" stroke="#111827" stroke-width="3" stroke-linecap="round"/>' +
    '<line x1="5" y1="24" x2="5" y2="2" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M5.8 2.2 L18 6.6 L5.8 11 Z" fill="#ef4444" stroke="#ffffff" stroke-width="1" stroke-linejoin="round"/>' +
    '</svg>',
  iconSize: [20, 26],
  iconAnchor: [5, 24],
  popupAnchor: [4, -22],
});

/**
 * The tee: a "T" on a dark disc where the dashed line starts, so the line reads
 * from T to flag. White-edged to stay readable on the satellite imagery.
 */
const teeBadge = (size: number, font: number): L.DivIcon =>
  L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:800 ${font}px/1 system-ui,sans-serif;color:#ffffff;background:rgba(17,24,39,.9);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5);transform:${UPRIGHT}">T</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });

export const TeeIcon = teeBadge(22, 12);

/** Every tee at once on the full map, smaller so eighteen of them do not crowd. */
const SmallTeeIcon = teeBadge(16, 9);

/**
 * A finger-sized, see-through target over a number printed on the club's map:
 * the drawing already shows the number, this only makes it tappable.
 */
const PrintedNumberTarget = L.divIcon({
  className: '',
  html: '<div style="width:40px;height:40px;border-radius:9999px"></div>',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

/**
 * The aim's target: a white ring, round so it needs no turning - on the corner
 * of a dogleg or on the pin until the player taps somewhere else. Dragged by
 * the ring (see HoleMap's pointer handling).
 */
const MeasureTargetIcon = L.divIcon({
  className: '',
  html: '<div data-measure-target style="width:40px;height:40px;border-radius:9999px;border:3px solid #fff;background:rgba(255,255,255,.08);box-shadow:0 0 0 1px rgba(0,0,0,.35),inset 0 0 0 1px rgba(0,0,0,.25);cursor:grab"></div>',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

L.Marker.prototype.options.icon = DefaultIcon;

const holeLabelIcons = new Map<string, L.DivIcon>();

/**
 * A hole-number badge, shared with the admin fairway editor so both maps number
 * the course alike.
 *
 * - On a hole it hangs just above the tee, clear of the tee marker; zoomed in,
 *   there is no other badge to collide with.
 * - Over the whole course it sits on the middle of the dashed line. Tees cluster
 *   beside the previous green, so badges on the tees pile up four or five deep
 *   in the middle of the course; the middle of each line is apart from the rest
 *   and says at a glance which line it numbers.
 *
 * `active` is the hole on screen - yellow, so the player can find it in the
 * crowd. Built once per variant: a fresh icon every render would have Leaflet
 * swap all eighteen badges' DOM each time.
 */
export const holeLabelIcon = (holeNumber: number, active: boolean, onLine: boolean): L.DivIcon => {
  const key = `${holeNumber}:${active}:${onLine}`;
  let icon = holeLabelIcons.get(key);
  if (!icon) {
    const size = onLine ? 22 : 26;
    icon = L.divIcon({
      className: '',
      html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 ${onLine ? 11 : 12}px/1 system-ui,sans-serif;color:${active ? '#111827' : '#ffffff'};background:${active ? '#facc15' : 'rgba(17,24,39,.85)'};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5);transform:${UPRIGHT}">${holeNumber}</div>`,
      iconSize: [size, size],
      iconAnchor: onLine ? [size / 2, size / 2] : [size / 2, 40],
    });
    holeLabelIcons.set(key, icon);
  }
  return icon;
};

/**
 * Deepest zoom the map asks for, shared with the offline download so that
 * everything reachable on screen is also everything that gets cached.
 */
const MAX_ZOOM = TILE_MAX_ZOOM;
/** Framing a 120 m par 3 would otherwise push past the crisp imagery. */
const HOLE_MAX_ZOOM = TILE_MAX_ZOOM;
/**
 * Walking to a tee: about 110 m across the map beside the hole column, 170 m
 * across the whole-screen map - close enough to read the path underfoot, one
 * step short of the deepest imagery so a pinch in still has somewhere to go.
 */
const NAV_ZOOM = Math.min(18, TILE_MAX_ZOOM);

const PRINTED_BOUNDS = L.latLngBounds(
  COURSE_MAP_OVERLAY.bounds.map(([lat, lng]) => [lat, lng] as [number, number])
);

/**
 * The map turns in steps, not with every fix: GPS noise swings the line to the
 * pin a few degrees each second, and a map that never holds still is harder to
 * read than one a few degrees off.
 */
const TURN_STEP_DEGREES = 10;
/**
 * Within this of the pin (or of the tee being walked to) its direction is noise
 * - a step sideways on the green would spin the map - so the map holds still.
 */
const HOLD_NEAR_METRES = 20;
/** "Tap the map to measure" shows until the first target is placed on this phone. */
const MEASURE_HINT_KEY = 'golf.measure.hinted';

/**
 * Turning needs the frame's size in CSS (container query units) to size the
 * square the map is drawn on. A browser without them keeps the north-up map.
 */
const CAN_TURN =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('container-type', 'size');

/** The smaller angle between two bearings, in degrees. */
const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Turns a pixel offset by `degrees`, clockwise on screen. A map turned so
 * `bearing` is up draws map offset m at screen offset turn(m, -bearing), and the
 * screen offset s is map offset turn(s, bearing).
 */
const turn = (x: number, y: number, degrees: number): L.Point => {
  const r = (degrees * Math.PI) / 180;
  return L.point(x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r));
};

/**
 * fitBounds for a turned map. What has to fit is the box the points make on
 * screen once turned, inside the frame the player sees - Leaflet would fit a
 * north-up box into the larger square the turned map is drawn on.
 */
const fitTurned = (
  map: L.Map,
  points: FairwayPoint[],
  frame: L.Point,
  bearing: number,
  padding: number,
  maxZoom: number,
  insetTop = 0,
  insetBottom = 0
) => {
  const REF = 20;
  const onScreen = points.map((p) => {
    const q = map.project(p, REF);
    return turn(q.x, q.y, -bearing);
  });
  const xs = onScreen.map((p) => p.x);
  const ys = onScreen.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(
    maxX > minX ? Math.max(1, frame.x - 2 * padding) / (maxX - minX) : Infinity,
    maxY > minY ? Math.max(1, frame.y - insetTop - insetBottom - 2 * padding) / (maxY - minY) : Infinity
  );
  const fitted = Number.isFinite(scale) ? REF + Math.log2(scale) : maxZoom;
  const zoom = Math.max(map.getMinZoom(), Math.min(maxZoom, Math.floor(fitted * 4) / 4));
  // The middle of the hole goes in the middle of what the overlays leave
  // uncovered, not in the middle of the frame.
  const shift = ((insetTop - insetBottom) / 2) * 2 ** (REF - zoom);
  const middle = turn((minX + maxX) / 2, (minY + maxY) / 2 - shift, bearing);
  map.setView(map.unproject(middle, REF), zoom, { animate: false });
};

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
  /** Where the tee-to-pin line bends, tee end first. Absent draws it straight. */
  path?: FairwayPoint[];
}

/** Tee, bends, pin - or the pin alone for a hole that has no tee. */
const holeLine = (hole: MapHole): FairwayPoint[] =>
  hole.teeLatitude != null && hole.teeLongitude != null
    ? [[hole.teeLatitude, hole.teeLongitude], ...(hole.path ?? []), [hole.latitude, hole.longitude]]
    : [[hole.latitude, hole.longitude]];

const yardsBetween = (a: FairwayPoint, b: FairwayPoint) =>
  Math.round(haversineMetres(a[0], a[1], b[0], b[1]) * METRES_TO_YARDS);

const midpoint = (a: FairwayPoint, b: FairwayPoint): FairwayPoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

const lineYards = (line: FairwayPoint[]) => {
  let metres = 0;
  for (let i = 1; i < line.length; i += 1) {
    metres += haversineMetres(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
  }
  return Math.round(metres * METRES_TO_YARDS);
};

/**
 * A cart drive on the map (Hole out -> a tee or the clubhouse): the route along
 * the cart paths, solid where there is a path and dashed where it goes straight
 * across a gap, and the way it runs just ahead of the cart for turning the map.
 */
export interface DriveOnMap {
  /** One per destination - the map zooms in once per key, not per reroute. */
  targetKey: string;
  legs: Array<{ kind: 'path' | 'direct'; points: FairwayPoint[] }>;
  heading: number | null;
  destination: FairwayPoint;
  label: string;
}

/** Room the hole screen's own overlays take at the top and bottom of the map, in pixels. */
export interface MapInsets {
  top: number;
  bottom: number;
}

const NO_INSETS: MapInsets = { top: 0, bottom: 0 };

/**
 * Where the player is aiming, the way Hole19 draws it (the club's ask): a thin
 * line from the player - from the tee when they are not on the hole - to a
 * target, and on to the pin. The target is the one the player tapped, else the
 * corner of a dogleg, else the pin itself.
 */
interface Aim {
  origin: FairwayPoint;
  target: FairwayPoint;
  pin: FairwayPoint;
  line: FairwayPoint[];
  /** The line from the target on, for the yardage on that stretch. */
  afterTarget: FairwayPoint[];
  kind: 'target' | 'bend' | 'pin';
  /** Yards from the origin to the target - along the hole when it is the pin. */
  toTarget: number;
  /** Yards on from the target to the pin; null when the target is the pin. */
  toPin: number | null;
  /** The pin is where the map has it, not where somebody stood. */
  approx: boolean;
}

/** The yardage on the route line: dark pill, readable on grass and water. */
const routeLabelIcon = (text: string) =>
  L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<span data-route-label style="position:absolute;transform:translate(-50%,-50%) ${UPRIGHT};white-space:nowrap;background:rgba(0,0,0,.78);color:#facc15;font:700 13px/1.2 system-ui,sans-serif;padding:3px 8px;border-radius:9999px;box-shadow:0 1px 4px rgba(0,0,0,.4)">${text}</span>`,
  });

/** A measured leg to or from the target: white, so it is not read as the route. */
const measureLabelIcon = (text: string, leg: 'to-target' | 'to-pin') =>
  L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<span data-measure-label="${leg}" style="position:absolute;transform:translate(-50%,-50%) ${UPRIGHT};white-space:nowrap;background:#ffffff;color:#111827;font:700 13px/1.2 system-ui,sans-serif;padding:3px 8px;border-radius:9999px;box-shadow:0 1px 4px rgba(0,0,0,.45)">${text}</span>`,
  });

interface HoleMapProps {
  courseId: string;
  holes?: MapHole[];
  center: { lat: number; lng: number };
  zoom?: number;
  /** Track the player instead of holding the frame on the selected hole. */
  followGps?: boolean;
  /**
   * The whole course at once: every hole's dashed line and number. Leaving it
   * frames the selected hole again.
   */
  courseView?: boolean;
  /**
   * On the whole course, the club's printed map (현시스템 지도) instead of the
   * dashed lines - an admin's choice for every phone (lib/appSettings).
   */
  printedMap?: boolean;
  /**
   * A walk to a tee in progress (the next one, or a hole the player picked from
   * somewhere else): the line runs to that tee instead of along the fairway to
   * the pin, and the map follows the player, turned to face that tee.
   */
  walkTo?: GuidanceTee | null;
  /**
   * Pixels at the top of the map covered by the whole-screen navigation banner:
   * the player is kept below it, not underneath it.
   */
  walkTopInset?: number;
  /** A cart drive in progress - followed like a walk, drawn along its route. */
  drive?: DriveOnMap | null;
  onHoleClick?: (hole: number) => void;
  /**
   * The compass bearing at the top of the screen (0 = north up), for anything
   * drawn over the map that points the way - the walk's arrow.
   */
  onBearingChange?: (bearing: number) => void;
  /**
   * The hole screen's layer over the map, Hole19-style (the club's ask): the
   * aim's yardage tab on the left edge and the tool column on the right.
   */
  holeOverlays?: boolean;
  /** Pixels at the top and bottom of the map under the screen's own overlays. */
  insets?: MapInsets;
  /** Where the tool column starts, clear of the pin tab above it. */
  toolbarTop?: number;
  /** More buttons for the tool column, under "Zoom to the green". */
  toolbar?: React.ReactNode;
}

const MapContent: React.FC<{
  holes?: MapHole[];
  onHoleClick?: (hole: number) => void;
  courseId: string;
  tileUrl: string;
  followGps: boolean;
  courseView: boolean;
  printedMap: boolean;
  walkTo: GuidanceTee | null;
  walkTopInset: number;
  drive: DriveOnMap | null;
  activeHole: MapHole | null;
  teeLatLng: FairwayPoint | null;
  fairway: FairwayDistance;
  turned: boolean;
  bearing: number;
  frameRef: React.RefObject<HTMLDivElement>;
  aim: Aim | null;
  insets: MapInsets;
}> = ({
  holes,
  onHoleClick,
  tileUrl,
  followGps,
  courseView,
  printedMap,
  walkTo,
  walkTopInset,
  drive,
  activeHole,
  teeLatLng,
  turned,
  bearing,
  frameRef,
  aim,
  insets,
}) => {
  const map = useMap();
  const gpsPosition = useAppStore((state) => state.gpsPosition);
  const selectedHole = useAppStore((state) => state.uiState.selectedHole);
  const showPrinted = courseView && printedMap;

  // Read by the framing effects when they run, without making every step of
  // the turn re-frame a hole the player has panned.
  const bearingNow = useRef(bearing);
  bearingNow.current = bearing;

  // What the player sees of the map: the frame, not the larger square a turned
  // map is drawn on.
  const frameSize = () => {
    const frame = frameRef.current;
    return frame ? L.point(frame.clientWidth, frame.clientHeight) : map.getSize();
  };

  // `holes` arrive with this device's /admin/map edits already laid over them
  // (see applyHoleEdits in Golf.tsx), so every path here is the final one.
  const linePositions = useMemo(
    (): FairwayPoint[] | null => (activeHole && teeLatLng ? holeLine(activeHole) : null),
    [activeHole, teeLatLng]
  );

  // On the way to a picked hole: straight to its tee - there is no fairway
  // between holes to follow.
  const teeRoute: FairwayPoint[] | null =
    walkTo && gpsPosition && !drive
      ? [
          [gpsPosition.latitude, gpsPosition.longitude],
          [walkTo.teeLatitude, walkTo.teeLongitude],
        ]
      : null;
  const teeText =
    teeRoute && walkTo
      ? `Tee ${walkTo.holeNumber} · ${Math.round(
          haversineMetres(teeRoute[0][0], teeRoute[0][1], teeRoute[1][0], teeRoute[1][1]) *
            METRES_TO_YARDS
        )} yd`
      : null;
  const teeIcon = useMemo(() => (teeText ? routeLabelIcon(teeText) : null), [teeText]);
  // Zoomed in on the player, the middle of a long walk is off screen, so the
  // yardage rides the line a few paces ahead of them instead.
  const teeLabelAt = teeRoute
    ? Math.min(
        0.5,
        25 / Math.max(1, haversineMetres(teeRoute[0][0], teeRoute[0][1], teeRoute[1][0], teeRoute[1][1]))
      )
    : 0.5;

  // The aim's stretch from the target on to the pin.
  const driveLabelIcon = useMemo(() => (drive ? routeLabelIcon(drive.label) : null), [drive?.label]);
  // A walk to a tee and a cart drive are both "navigating": the map follows the
  // player instead of framing a hole.
  const navOn = !!walkTo || !!drive;

  const toPinText = aim && aim.toPin !== null ? `${aim.approx ? '≈' : ''}${aim.toPin} yd` : null;
  const toPinIcon = useMemo(
    () => (toPinText ? measureLabelIcon(toPinText, 'to-pin') : null),
    [toPinText]
  );

  // Leaflet measures its container once and only re-measures on a window
  // resize. The container changes size without one - the hole column steps
  // aside for the full map, the desktop side menu opens beside it - and a stale
  // size frames holes off-centre and leaves grey where tiles should be.
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  // With no satellite layer under the printed map, what shows round it and
  // through its cut-out paper is paper white - not Leaflet's grey.
  useEffect(() => {
    const el = map.getContainer();
    el.style.background = showPrinted ? '#ffffff' : '';
    return () => {
      el.style.background = '';
    };
  }, [map, showPrinted]);

  // Re-centre on the player only in follow mode. Reading a hole means the map
  // has to hold still - a watchPosition stream would otherwise yank it back on
  // every fix - and so does looking at the whole course.
  useEffect(() => {
    // On a walk to a tee the effects below follow the player instead.
    if (courseView || !followGps || !gpsPosition || navOn) return;
    map.setView([gpsPosition.latitude, gpsPosition.longitude], map.getZoom());
  }, [courseView, followGps, gpsPosition, map, navOn]);

  // Walking to a tee, satnav-style (the club's ask): zoomed in on the player
  // and following them, the dotted line running off ahead to the tee.
  //
  // The zoom is set once, when a walk starts; after that each fix only pans,
  // so a player who pinches out to see further keeps that zoom. The player sits
  // in the middle of what is left below the whole-screen banner, not under it -
  // "below" on screen, whichever way the map is turned.
  const walkTarget = drive ? `drive:${drive.targetKey}` : walkTo ? `walk:${walkTo.holeNumber}` : null;
  useEffect(() => {
    if (courseView || walkTarget === null) return;
    const fix = useAppStore.getState().gpsPosition;
    if (!fix) return;
    const lift = turn(0, walkTopInset / 2, bearingNow.current);
    const at = map.unproject(
      map.project([fix.latitude, fix.longitude], NAV_ZOOM).subtract(lift),
      NAV_ZOOM
    );
    map.setView(at, NAV_ZOOM, { animate: false });
    // Keyed on the walk itself; the follow below keeps up with the banner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseView, walkTarget, map]);

  useEffect(() => {
    if (courseView || !navOn || !gpsPosition) return;
    const follow = (animate: boolean) => {
      const z = map.getZoom();
      const lift = turn(0, walkTopInset / 2, bearing);
      const at = map.unproject(
        map.project([gpsPosition.latitude, gpsPosition.longitude], z).subtract(lift),
        z
      );
      map.panTo(at, { animate, duration: 0.4 });
    };
    follow(true);
    // The card arriving under the map (or the banner going) changes its size.
    // Re-centre then without animation: an animation cut short by a resize is
    // what once left the player off the top edge.
    const onResize = () => follow(false);
    map.on('resize', onResize);
    const settle = window.setTimeout(() => follow(false), 350);
    return () => {
      map.off('resize', onResize);
      window.clearTimeout(settle);
    };
  }, [courseView, navOn, gpsPosition, map, walkTopInset, bearing]);

  // Frame the selected hole so tee and pin are both on screen. Keyed on the
  // hole number, so a GPS tick never re-frames a hole the user has panned away
  // from - and on leaving the course view, which is how "back to the hole" lands
  // on the hole.
  useEffect(() => {
    // On a walk to a tee the frame belongs to the walk effects above (zoomed
    // in on the player); two frames racing each other left the player off
    // screen.
    // When the walk ends, walkTo goes null and this frames the hole again.
    if (courseView || selectedHole === null || navOn) return;
    // Following the player, the player is the frame - once there is a player
    // to follow. Until the first fix the hole is framed, not left at the
    // opening zoom; the follow then keeps this zoom.
    if (followGps && useAppStore.getState().gpsPosition) return;

    const hole = holes?.find((h) => h.holeNumber === selectedHole);
    if (!hole) return;

    // Coming back from the full map, the column has just returned and the map is
    // narrower than Leaflet last measured; the observer above is not called until
    // after this effect, so measure now or the hole is framed for the wrong width.
    map.invalidateSize();

    if (hole.teeLatitude != null && hole.teeLongitude != null) {
      // A dogleg can bend outside the box of its tee and pin, so the bends are
      // framed too. Turned pin-up, a hole runs up the screen - a phone's long
      // side - and is framed that way.
      if (turned) {
        fitTurned(map, holeLine(hole), frameSize(), bearingNow.current, 48, HOLE_MAX_ZOOM, insets.top, insets.bottom);
      } else {
        map.fitBounds(L.latLngBounds(holeLine(hole)), {
          paddingTopLeft: [48, 48 + insets.top],
          paddingBottomRight: [48, 48 + insets.bottom],
          maxZoom: HOLE_MAX_ZOOM,
        });
      }
    } else {
      map.setView([hole.latitude, hole.longitude], HOLE_MAX_ZOOM);
    }
    // frameSize reads a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseView, followGps, selectedHole, holes, map, navOn, turned, insets.top, insets.bottom]);

  // The whole course: every tee, bend and pin on screen - or the whole printed
  // map, whose paper reaches a little past the outermost tees.
  useEffect(() => {
    if (!courseView || !holes?.length) return;
    // The column has just stepped aside - measure the wider map first.
    map.invalidateSize();
    map.fitBounds(showPrinted ? PRINTED_BOUNDS : L.latLngBounds(holes.flatMap(holeLine)), {
      padding: showPrinted ? [4, 4] : [24, 24],
      maxZoom: HOLE_MAX_ZOOM,
    });
  }, [courseView, showPrinted, holes, map]);

  return (
    <>
      {/* 현시스템 (the printed map) is drawn on its own, without the satellite
          layer under it - the club's ask. Every other view keeps the tiles. */}
      {!showPrinted && (
        <TileLayer
          url={tileUrl}
          maxZoom={MAX_ZOOM}
          maxNativeZoom={MAX_ZOOM}
          crossOrigin="anonymous"
        />
      )}

      {/* The club's printed map, bent to lie on the ground it draws. Its own
          pane between the tiles (200) and the lines and circles (400), so the
          player's dot and its accuracy ring always sit on top of it. The paper
          round the course is see-through: the satellite map shows there. */}
      {showPrinted && (
        <Pane name="printed-course-map" style={{ zIndex: 350 }}>
          <ImageOverlay
            url={COURSE_MAP_OVERLAY.url}
            bounds={PRINTED_BOUNDS}
            alt="Pelham Hills Golf Club course map from the yardage book"
          />
        </Pane>
      )}

      {/* Popups are for the north-up full map only: Leaflet positions them
          itself, and on a turned map they would lie on their side. A hole's
          facts are in the column beside it anyway. */}

      {/* Current location marker */}
      {gpsPosition && (
        <>
          <Marker
            position={[gpsPosition.latitude, gpsPosition.longitude]}
            icon={CurrentLocationIcon}
          >
            {!turned && (
              <Popup>
                Current Location
                <br />
                Accuracy: ±{Math.round(gpsPosition.accuracy)}m
              </Popup>
            )}
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

      {/* Selected hole: the tee and its line down the fairway to the pin */}
      {!courseView && activeHole && teeLatLng && linePositions && (
        <>
          <Polyline
            positions={linePositions}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              opacity: 0.9,
              dashArray: '8 8',
            }}
          />
          <Marker position={teeLatLng} icon={TeeIcon}>
            {!turned && (
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
            )}
          </Marker>
        </>
      )}

      {/* From where the player stands to the pin, along the fairway, with how
          far that is. Only while the player is on this hole - from the car park
          it would be a line across the course. */}
      {!courseView && teeRoute && teeIcon && (
        <>
          <Polyline
            positions={teeRoute}
            interactive={false}
            pathOptions={{ color: '#facc15', weight: 4, opacity: 0.95, dashArray: '2 8', lineCap: 'round' }}
          />
          <Marker
            position={pointAlong(teeRoute, teeLabelAt)}
            icon={teeIcon}
            interactive={false}
            zIndexOffset={1500}
          />
        </>
      )}

      {/* The cart drive: blue along the cart paths, dashed yellow where the map
          has no path and the route goes straight across. */}
      {!courseView && drive && (
        <>
          {drive.legs.map((leg, i) =>
            leg.kind === 'path' ? (
              <Fragment key={`drive-${i}`}>
                <Polyline
                  positions={leg.points}
                  interactive={false}
                  pathOptions={{ color: '#0c4a6e', weight: 10, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
                />
                <Polyline
                  positions={leg.points}
                  interactive={false}
                  pathOptions={{ color: '#38bdf8', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }}
                />
              </Fragment>
            ) : (
              <Polyline
                key={`drive-${i}`}
                positions={leg.points}
                interactive={false}
                pathOptions={{ color: '#facc15', weight: 5, opacity: 0.95, dashArray: '2 10', lineCap: 'round' }}
              />
            )
          )}
          {driveLabelIcon && (
            <Marker position={drive.destination} icon={driveLabelIcon} interactive={false} zIndexOffset={1500} />
          )}
        </>
      )}

      {/* The aim: a thin white line from the player (or the tee) to the target
          and on to the pin, a ring on the target - Hole19's way of drawing a
          hole. How far to the target is the tab on the map's left edge. */}
      {aim && (
        <>
          <Polyline
            positions={aim.line}
            interactive={false}
            pathOptions={{ color: '#ffffff', weight: 2.5, opacity: 0.95 }}
          />
          {toPinIcon && (
            <Marker
              position={pointAlong(aim.afterTarget, 0.5)}
              icon={toPinIcon}
              interactive={false}
              zIndexOffset={1600}
            />
          )}
          <Marker
            position={aim.target}
            icon={MeasureTargetIcon}
            keyboard={false}
            title="Target - drag to move"
            zIndexOffset={1700}
          />
        </>
      )}

      {/* The printed map draws its own lines and numbers; each printed number
          gets a tap target so it is still the way into its hole. */}
      {showPrinted &&
        COURSE_MAP_OVERLAY.numbers.map((label) => (
          <Marker
            key={`printed-${label.holeNumber}`}
            position={[label.lat, label.lng]}
            icon={PrintedNumberTarget}
            zIndexOffset={2000}
            title={`Hole ${label.holeNumber}`}
            alt={`Hole ${label.holeNumber}`}
            eventHandlers={{ click: () => onHoleClick?.(label.holeNumber) }}
          />
        ))}

      {/* The whole course: each hole's line, numbered at its middle. A number
          is the way into its hole. */}
      {courseView &&
        !showPrinted &&
        holes?.map((hole) => {
          const line = holeLine(hole);
          const active = hole.holeNumber === selectedHole;
          return (
            <Fragment key={`course-${hole.holeNumber}`}>
              {line.length > 1 && (
                <>
                  <Polyline
                    positions={line}
                    interactive={false}
                    pathOptions={{
                      color: active ? '#facc15' : '#ffffff',
                      weight: active ? 3 : 2,
                      opacity: 0.9,
                      dashArray: '6 6',
                    }}
                  />
                  {/* Which end is the tee: every line reads from T to flag. */}
                  <Marker position={line[0]} icon={SmallTeeIcon} interactive={false} />
                </>
              )}
              <Marker
                position={line.length > 1 ? pointAlong(line, 0.5) : line[0]}
                icon={holeLabelIcon(hole.holeNumber, active, true)}
                zIndexOffset={2000}
                title={`Hole ${hole.holeNumber}`}
                eventHandlers={{ click: () => onHoleClick?.(hole.holeNumber) }}
              />
            </Fragment>
          );
        })}

      {/* Hole pins - the rest of the course fades back once a hole is picked.
          The printed map draws its own greens. */}
      {holes &&
        !showPrinted &&
        holes.map((hole) => (
          <Marker
            key={hole.holeNumber}
            position={[hole.latitude, hole.longitude]}
            icon={PinIcon}
            opacity={
              courseView || selectedHole === null || selectedHole === hole.holeNumber
                ? 1
                : 0.45
            }
            eventHandlers={{
              click: () => onHoleClick?.(hole.holeNumber),
            }}
          >
            {!turned && (
              <Popup>
                <div className="text-sm">
                  <strong>Hole {hole.holeNumber}</strong>
                  <br />
                  Par {hole.par}
                  {hole.handicap && <> (HCP {hole.handicap})</>}
                </div>
              </Popup>
            )}
          </Marker>
        ))}
    </>
  );
};

type Gesture = {
  pointerId: number;
  /** press: down, not yet moved far enough to be a drag. */
  mode: 'press' | 'pan' | 'target';
  x: number;
  y: number;
  /** Pressed on a pin or the player's dot: a tap there is theirs, not a target. */
  onMarker: boolean;
};

/**
 * The course map.
 *
 * On a hole the map turns so the pin is at the top of the screen, the way a
 * yardage book draws a hole (the club's ask): from where the player stands when
 * they are on the hole, from the tee when they are not, and towards the tee
 * being walked to on the way to the next hole. The full map stays north-up.
 *
 * Leaflet cannot turn a map, so the turn is CSS: the map is drawn on a square
 * big enough to cover the frame at any angle and the square is rotated. Leaflet
 * never knows, which is also why a turned map takes the gestures that depend
 * on screen positions away from it - one-finger drag, and a tap - and does the
 * turning of those itself. Pinch and wheel zoom stay Leaflet's, about the
 * middle of the screen.
 */
export const HoleMap: React.FC<HoleMapProps> = ({
  courseId,
  holes,
  center,
  zoom = 16,
  followGps = false,
  courseView = false,
  printedMap = false,
  walkTo = null,
  walkTopInset = 0,
  drive = null,
  onHoleClick,
  onBearingChange,
  holeOverlays = false,
  insets = NO_INSETS,
  toolbarTop = 8,
  toolbar,
}) => {
  const tileUrl = TILE_URL_TEMPLATE;
  const frameRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const gpsPosition = useAppStore((state) => state.gpsPosition);
  const selectedHole = useAppStore((state) => state.uiState.selectedHole);
  const turned = CAN_TURN && !courseView;

  const activeHole = useMemo(
    () => holes?.find((h) => h.holeNumber === selectedHole) ?? null,
    [holes, selectedHole]
  );

  const teeLatLng = useMemo((): FairwayPoint | null => {
    if (!activeHole) return null;
    const { teeLatitude, teeLongitude } = activeHole;
    return teeLatitude != null && teeLongitude != null
      ? [teeLatitude, teeLongitude]
      : null;
  }, [activeHole]);

  const routeHole = useMemo(
    () =>
      activeHole && teeLatLng
        ? { ...activeHole, teeLatitude: teeLatLng[0], teeLongitude: teeLatLng[1] }
        : undefined,
    [activeHole, teeLatLng]
  );
  const fairway = useFairwayDistance(routeHole);

  // Which way is up. Worked out during render so the frame for a new hole is
  // fitted to that hole's own turn, not the last hole's.
  const held = useRef({ key: '', value: 0 });
  const turnKey = !turned
    ? 'north'
    : drive
      ? `drive:${drive.targetKey}`
      : walkTo
        ? `walk:${walkTo.holeNumber}`
        : `hole:${selectedHole}`;
  const holeBearing =
    activeHole && teeLatLng
      ? bearingDegrees(teeLatLng[0], teeLatLng[1], activeHole.latitude, activeHole.longitude)
      : 0;
  let wanted: number | null;
  if (!turned) {
    wanted = 0;
  } else if (drive) {
    // The road just ahead of the cart is up, as on a car's satnav.
    wanted = drive.heading;
  } else if (walkTo) {
    wanted =
      gpsPosition &&
      haversineMetres(gpsPosition.latitude, gpsPosition.longitude, walkTo.teeLatitude, walkTo.teeLongitude) >
        HOLD_NEAR_METRES
        ? bearingDegrees(gpsPosition.latitude, gpsPosition.longitude, walkTo.teeLatitude, walkTo.teeLongitude)
        : null;
  } else if (!activeHole) {
    wanted = 0;
  } else if (gpsPosition && fairway.onLine) {
    wanted =
      haversineMetres(gpsPosition.latitude, gpsPosition.longitude, activeHole.latitude, activeHole.longitude) >
      HOLD_NEAR_METRES
        ? bearingDegrees(gpsPosition.latitude, gpsPosition.longitude, activeHole.latitude, activeHole.longitude)
        : null;
  } else {
    wanted = holeBearing;
  }
  const last = held.current;
  const fresh = last.key !== turnKey;
  const aimBearing = wanted ?? (fresh ? holeBearing : null);
  // Kept unwrapped (359 -> 361, not 359 -> 1) so the turn animates the short
  // way round.
  const bearing =
    aimBearing !== null && (fresh || angleGap(aimBearing, last.value) > TURN_STEP_DEGREES)
      ? last.value + (((aimBearing - last.value + 540) % 360) - 180)
      : last.value;
  useEffect(() => {
    held.current = { key: turnKey, value: bearing };
  }, [turnKey, bearing]);
  useEffect(() => {
    onBearingChange?.(bearing);
  }, [bearing, onBearingChange]);

  // Leaflet's own drag, double-tap and keyboard pan work in the map's
  // unturned pixels; turned, they would move the map the wrong way.
  useEffect(() => {
    if (!map) return;
    for (const handler of [map.dragging, map.doubleClickZoom, map.boxZoom, map.keyboard]) {
      if (turned) handler.disable();
      else handler.enable();
    }
    map.options.touchZoom = turned ? 'center' : true;
    map.options.scrollWheelZoom = turned ? 'center' : true;
  }, [map, turned]);

  // Aiming: on a hole, not on the way to one. Tapping a target of one's own
  // needs the turned map's tap handling.
  const aiming = !courseView && !walkTo && !drive && activeHole !== null && teeLatLng !== null;
  const measuring = turned && aiming;
  const [target, setTarget] = useState<FairwayPoint | null>(null);
  const walkHole = drive ? `drive:${drive.targetKey}` : walkTo ? walkTo.holeNumber : null;
  useEffect(() => {
    setTarget(null);
  }, [selectedHole, courseView, walkHole]);
  const [hinted, setHinted] = useState(() => {
    try {
      return localStorage.getItem(MEASURE_HINT_KEY) === '1';
    } catch {
      return false;
    }
  });
  const placeTarget = (at: FairwayPoint) => {
    setTarget(at);
    if (!hinted) {
      setHinted(true);
      try {
        localStorage.setItem(MEASURE_HINT_KEY, '1');
      } catch {
        // The hint shows again next time; nothing else depends on it.
      }
    }
  };

  const effInsets = holeOverlays ? insets : NO_INSETS;
  const onHole = fairway.status === 'ok' && fairway.route !== null;
  const aim = useMemo((): Aim | null => {
    if (!aiming || !activeHole) return null;
    const line = onHole && fairway.route ? fairway.route : holeLine(activeHole);
    if (line.length < 2) return null;
    const origin = line[0];
    const pin = line[line.length - 1];
    const { approx } = fairway;
    if (measuring && target) {
      return {
        origin,
        target,
        pin,
        line: [origin, target, pin],
        afterTarget: [target, pin],
        kind: 'target',
        toTarget: yardsBetween(origin, target),
        toPin: yardsBetween(target, pin),
        approx,
      };
    }
    if (line.length > 2) {
      return {
        origin,
        target: line[1],
        pin,
        line,
        afterTarget: line.slice(1),
        kind: 'bend',
        toTarget: yardsBetween(origin, line[1]),
        toPin: lineYards(line.slice(1)),
        approx,
      };
    }
    return {
      origin,
      target: pin,
      pin,
      line,
      afterTarget: [pin],
      kind: 'pin',
      toTarget: onHole && fairway.along !== null ? Math.round(fairway.along) : lineYards(line),
      toPin: null,
      approx,
    };
  }, [aiming, activeHole, onHole, fairway, measuring, target]);

  // The aim's yardage tab rides the left edge level with the middle of the
  // line to the target, as Hole19's does. Moved straight in the DOM on every
  // pan and zoom - a React render per finger move would stutter.
  const tabRef = useRef<HTMLDivElement>(null);
  const tabInputs = useRef({ aim, bearing, insets: effInsets });
  tabInputs.current = { aim, bearing, insets: effInsets };
  const placeTab = useCallback(() => {
    const el = tabRef.current;
    const frame = frameRef.current;
    const { aim: a, bearing: b, insets: ins } = tabInputs.current;
    if (!el || !frame || !map || !a) return;
    const cp = map.latLngToContainerPoint(midpoint(a.origin, a.target));
    const size = map.getSize();
    const onScreen = turn(cp.x - size.x / 2, cp.y - size.y / 2, -b);
    const h = frame.clientHeight;
    // Below the zoom buttons, above the hole bar.
    const y = Math.max(ins.top + 110, Math.min(h - ins.bottom - 40, h / 2 + onScreen.y));
    el.style.top = `${Math.round(y)}px`;
  }, [map]);
  useEffect(() => {
    if (!map) return;
    map.on('move zoom resize viewreset', placeTab);
    return () => {
      map.off('move zoom resize viewreset', placeTab);
    };
  }, [map, placeTab]);
  useEffect(() => {
    placeTab();
  });

  // The flag button: close in on the green, and back out to the whole hole.
  const [greenView, setGreenView] = useState(false);
  useEffect(() => {
    setGreenView(false);
  }, [selectedHole, courseView, walkHole]);
  const toggleGreen = () => {
    const frame = frameRef.current;
    if (!map || !activeHole || !frame) return;
    if (!greenView) {
      const pin: FairwayPoint = aim?.pin ?? [activeHole.latitude, activeHole.longitude];
      const z = HOLE_MAX_ZOOM;
      const lift = turn(0, (effInsets.top - effInsets.bottom) / 2, bearing);
      map.setView(map.unproject(map.project(pin, z).subtract(lift), z), z, { animate: false });
    } else {
      fitTurned(
        map,
        holeLine(activeHole),
        L.point(frame.clientWidth, frame.clientHeight),
        bearing,
        48,
        HOLE_MAX_ZOOM,
        effInsets.top,
        effInsets.bottom
      );
    }
    setGreenView(!greenView);
  };

  // Where on the ground a point on the screen is, on the turned map.
  const groundAt = (clientX: number, clientY: number): FairwayPoint | null => {
    const frame = frameRef.current;
    if (!map || !frame) return null;
    const box = frame.getBoundingClientRect();
    const offset = turn(clientX - (box.left + box.width / 2), clientY - (box.top + box.height / 2), bearing);
    const at = map.containerPointToLatLng(map.getSize().divideBy(2).add(offset));
    return [at.lat, at.lng];
  };

  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Set<number>());
  const swallowClick = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!turned || !map) return;
    swallowClick.current = false;
    // A primary pointer starts a new gesture, whatever was missed of the last.
    if (e.isPrimary) pointers.current.clear();
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1) {
      // Two fingers: a pinch, which is Leaflet's.
      gesture.current = null;
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target as Element;
    if (el.closest('button, a, [data-map-control]')) return;
    if (measuring && el.closest('[data-measure-target]')) {
      gesture.current = { pointerId: e.pointerId, mode: 'target', x: e.clientX, y: e.clientY, onMarker: true };
      frameRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    gesture.current = {
      pointerId: e.pointerId,
      mode: 'press',
      x: e.clientX,
      y: e.clientY,
      onMarker: !!el.closest('.leaflet-marker-icon.leaflet-interactive'),
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId || !map) return;
    if (g.mode === 'target') {
      const at = groundAt(e.clientX, e.clientY);
      if (at) setTarget(at);
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.mode === 'press') {
      if (Math.hypot(dx, dy) < 6) return;
      g.mode = 'pan';
      frameRef.current?.setPointerCapture(e.pointerId);
    }
    // The ground under the finger stays under it.
    const moved = turn(dx, dy, bearing);
    map.panBy([-moved.x, -moved.y], { animate: false });
    g.x = e.clientX;
    g.y = e.clientY;
    swallowClick.current = true;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.mode === 'target') {
      swallowClick.current = true;
      return;
    }
    if (g.mode === 'press' && !g.onMarker && measuring) {
      const at = groundAt(e.clientX, e.clientY);
      if (at) placeTarget(at);
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (gesture.current?.pointerId === e.pointerId) gesture.current = null;
  };

  // The click that ends a drag is not a tap on whatever was under it.
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  const showsTiles = !(courseView && printedMap);

  return (
    <div
      ref={frameRef}
      data-testid="map-frame"
      className="hole-map-frame relative w-full h-full overflow-hidden bg-background"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClickCapture={onClickCapture}
    >
      <div
        className={turned ? 'hole-map-turned' : 'hole-map-flat'}
        style={turned ? ({ '--map-counter': `${bearing}deg` } as React.CSSProperties) : undefined}
      >
        {/* zoomSnap 0.25: fitted to whole zoom levels the course shrinks to the
            middle third of a phone and the numbers crowd together. Tiles stretch
            to fractional zooms as they are. */}
        <MapContainer
          ref={setMap}
          center={[center.lat, center.lng]}
          zoom={zoom}
          zoomSnap={0.25}
          maxZoom={MAX_ZOOM}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          attributionControl={false}
          scrollWheelZoom={true}
        >
          <MapContent
            holes={holes}
            onHoleClick={onHoleClick}
            courseId={courseId}
            tileUrl={tileUrl}
            followGps={followGps}
            courseView={courseView}
            printedMap={printedMap}
            walkTo={walkTo}
            walkTopInset={walkTopInset}
            drive={drive}
            activeHole={activeHole}
            teeLatLng={teeLatLng}
            fairway={fairway}
            turned={turned}
            bearing={bearing}
            frameRef={frameRef}
            aim={aim}
            insets={effInsets}
          />
        </MapContainer>
      </div>

      {/* Zoom and credits sit on the frame, not on the map: on a turned map,
          Leaflet's own would turn with it. */}
      <div
        data-map-control
        className="absolute left-2.5 top-2.5 z-[800] flex flex-col overflow-hidden rounded-md border border-border bg-background shadow-md"
      >
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => map?.zoomIn()}
          className="flex h-9 w-9 items-center justify-center text-lg font-bold leading-none text-foreground hover:bg-accent"
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => map?.zoomOut()}
          className="flex h-9 w-9 items-center justify-center border-t border-border text-lg font-bold leading-none text-foreground hover:bg-accent"
        >
          −
        </button>
      </div>

      {holeOverlays && aim && (
        <div
          ref={tabRef}
          data-testid="target-tab"
          role="status"
          aria-label={`${aim.kind === 'pin' && aim.approx ? 'About ' : ''}${aim.toTarget} yards to the ${aim.kind}`}
          className="pointer-events-none absolute left-0 z-[800] -translate-y-1/2 bg-slate-900 py-1.5 pl-2.5 pr-7 text-white shadow-lg"
          style={{
            top: '50%',
            clipPath: 'polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)',
          }}
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
            {aim.kind === 'bend' ? 'To the bend' : aim.kind === 'target' ? 'To target' : 'To pin'}
          </div>
          <div className="flex items-start gap-0.5 leading-none">
            <span className="text-[32px] font-black tabular-nums">
              {aim.kind === 'pin' && aim.approx ? '≈' : ''}
              {aim.toTarget}
            </span>
            <span className="mt-0.5 text-xs font-bold text-white/70">yd</span>
          </div>
        </div>
      )}

      {holeOverlays && activeHole && (
        <div
          data-map-control
          className="absolute right-2 z-[800] flex flex-col items-center gap-0.5 rounded-2xl bg-slate-900/95 p-1 shadow-lg"
          style={{ top: toolbarTop }}
        >
          <button
            type="button"
            onClick={toggleGreen}
            aria-pressed={greenView}
            aria-label={greenView ? 'Show the whole hole' : 'Zoom to the green'}
            title={greenView ? 'Show the whole hole' : 'Zoom to the green'}
            className={`grid h-11 w-11 place-items-center rounded-xl text-white hover:bg-white/10 ${
              greenView ? 'bg-white/20' : ''
            }`}
          >
            <Flag className="h-5 w-5" fill="currentColor" />
          </button>
          {toolbar}
        </div>
      )}

      {measuring && target && (
        <button
          type="button"
          data-map-control
          onClick={() => setTarget(null)}
          style={{ bottom: effInsets.bottom + 24 }}
          className="absolute left-2 z-[800] rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white shadow"
        >
          Clear target
        </button>
      )}
      {measuring && !target && !hinted && (
        <p
          // Clear of the map credit along the same edge.
          style={{ bottom: effInsets.bottom + 24 }}
          className="pointer-events-none absolute left-2 z-[800] rounded-full bg-black/60 px-3 py-1 text-xs text-white"
        >
          Tap the map to measure
        </p>
      )}

      <p
        style={{ bottom: effInsets.bottom }}
        className="pointer-events-none absolute right-0 z-[800] bg-background/80 px-1 text-[10px] leading-4 text-muted-foreground"
      >
        Leaflet{showsTiles ? ` | ${TILE_ATTRIBUTION}` : ''}
      </p>
    </div>
  );
};
