import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L, { type LeafletEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ChevronLeft, ChevronRight, ClipboardCopy, Download, ExternalLink, Presentation, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { PELHAM_HILLS, PELHAM_HILLS_HOLES, type FairwayPoint, type Hole } from '@/data/pelhamHills';
import { DRONE_ZONES, DRONE_ZONES_CHECKED, type ZoneLevel } from '@/data/droneZones';
import { fetchCourseData } from '@/lib/courseData';
import { earthKmz, earthKmzName, holeKmz, kmzName } from '@/lib/droneKmz';
import { cachedDroneRoutes, droneRoutesPending, fetchDroneRoutes, readDroneRoutes, saveDroneRoutes, type DroneRoutes } from '@/lib/droneRoutes';
import { applyHoleEdits, loadHolePaths, mapEditorStatus, nearestSegment, pullHoleEdits, type ServerProblem } from '@/lib/holePaths';
import { getLang, onLangChange } from '@/lib/i18n/engine';
import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL_TEMPLATE } from '@/lib/tiles';
import { useAppStore } from '@/store/appStore';
import {
  GREEN_COVERAGE,
  MISSION_SPEED,
  ZONE_LABEL,
  allWaypoints,
  batteryGroups,
  mmss,
  nearestAerodromes,
  planCourse,
  planHole,
  spotBetween,
  waypointCsv,
  type HolePlan,
  type RouteSpot,
  type Waypoint,
} from '@/lib/dronePlan';

/** 지도 위 색. 위성 사진 위에서 읽혀야 해서 테마와 상관없이 고정입니다. */
const ROUTE = '#ffb547';
const CAMERA = '#5fd4ff';
const ALERT = '#ef4444';
const PICKED = '#ffffff';

/** 한 홀의 웨이포인트 상한. 폰 화면에서 점과 손잡이가 겹치지 않을 만큼만 둡니다. */
const MAX_POINTS = 10;

const SERVER_MESSAGE: Record<ServerProblem, string> = {
  unavailable: '이 빌드에는 서버 연결이 없어 이 기기에만 저장됩니다.',
  signedOut: '이 기기에만 저장했습니다. 코스 지도 탭에서 코스 지도 수정 계정으로 로그인하면 다른 기기에도 보입니다.',
  notAdmin: '이 기기에만 저장했습니다. 이 계정은 코스 지도 수정 계정으로 지정되지 않아 서버에 올릴 수 없습니다.',
  missingTable: '이 기기에만 저장했습니다. 서버에 app_settings 표가 없습니다 (0007_hole_edits.sql).',
  network: '이 기기에만 저장했습니다. 인터넷이 연결된 뒤 이 탭을 다시 열면 올립니다.',
  other: '이 기기에만 저장했습니다. 서버에 올리지 못했습니다.',
};

const ZONE_BADGE: Record<ZoneLevel, string> = {
  2: 'bg-red-600 text-white',
  1: 'bg-red-500/15 text-red-700 dark:text-red-300',
  3: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  0: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

const badges = new Map<string, L.DivIcon>();

/** 같은 모양은 같은 아이콘을 줍니다. 새 아이콘이 오면 Leaflet 이 마커를 다시 그려 끌던 점을 놓칩니다. */
const badge = (id: string, color: string, ring: boolean, beside = false) => {
  const key = `${id}|${color}|${ring}|${beside}`;
  let icon = badges.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<div style="width:24px;height:24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 12px/1 ui-monospace,monospace;color:#0b120d;background:${color};border:2px solid ${ring ? ALERT : '#0b120d'};box-shadow:0 1px 3px rgba(0,0,0,.5)">${id}</div>`,
      iconSize: [24, 24],
      iconAnchor: beside ? [-12, 12] : [12, 12],
    });
    badges.set(key, icon);
  }
  return icon;
};

/** 구간 가운데 손잡이. 흐리게 둬서 끌면 생기는 점으로 읽히게 합니다. 상자가 커야 손가락으로 집힙니다. */
const MidpointIcon = L.divIcon({
  className: '',
  html: '<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;opacity:.8"><div style="width:10px;height:10px;border-radius:9999px;background:#fff;border:2px solid #0b120d"></div></div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const pointOf = (e: LeafletEvent): FairwayPoint => {
  const { lat, lng } = (e.target as L.Marker).getLatLng();
  return [lat, lng];
};

const spotOf = ({ label, at, altitude, gimbal }: Waypoint): RouteSpot => ({ label, at, altitude, gimbal });

const holeNumberIcon = (n: number) =>
  L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 11px/1 ui-monospace,monospace;color:#0b120d;background:${ROUTE};border:2px solid #0b120d;cursor:pointer">${n}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const latLng = (p: FairwayPoint) => `${p[0].toFixed(6)}, ${p[1].toFixed(6)}`;
const gmaps = (p: FairwayPoint) => `https://www.google.com/maps/search/?api=1&query=${p[0].toFixed(6)},${p[1].toFixed(6)}`;

/** 보기가 바뀔 때만 맞춥니다. 점을 옮길 때마다 맞추면 끌던 점이 손가락 밑에서 달아납니다. */
function FitTo({ target, points }: { target: number; points: FairwayPoint[] }) {
  const map = useMap();
  const latest = useRef(points);
  latest.current = points;
  useEffect(() => {
    if (latest.current.length) map.fitBounds(L.latLngBounds(latest.current), { padding: [24, 24], maxZoom: 18 });
  }, [map, target]);
  return null;
}

/** 전체 보기에서는 비워 둡니다 - 둘러보다 누른 자리에 점이 생기면 안 됩니다. */
function MapClicks({ onClick }: { onClick?: (p: FairwayPoint) => void }) {
  useMapEvents({ click: (e) => onClick?.([e.latlng.lat, e.latlng.lng]) });
  return null;
}

function ZoneTag({ zone }: { zone: ZoneLevel | null }) {
  if (zone == null) return <span className="text-xs text-muted-foreground">-</span>;
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${ZONE_BADGE[zone]}`}>{ZONE_LABEL[zone]}</span>;
}

/** 이 값들은 DJI Fly 화면 이름입니다. 앱 버전과 언어에 따라 조금 다를 수 있습니다. */
const FLY_SETTINGS: [string, string][] = [
  ['앱 설정: 카메라 화면 오른쪽 위 ··· ▸ 안전', '최대 고도 120m, 장애물 회피 동작은 우회 또는 브레이크'],
  ['점마다: 패널에서 웨이포인트 번호를 탭', '위 표의 고도·기수·짐벌, 속도 7m/s, 카메라 동작은 ① 녹화 시작, 마지막 점 녹화 중지, 나머지 없음'],
  ['경로 전체: 패널에서 다음(Next)을 탭', '전체 속도 7m/s, 비행 종료는 호버, 신호 끊김은 RTH, 시작점은 ①'],
  ['저장: 패널 왼쪽 위 목록 아이콘 ▸ 라이브러리', '연필로 홀 이름을 넣습니다. GO 를 누르면 업로드 후 바로 출발합니다.'],
  ['이륙', '고도는 이륙 지점 기준입니다. 저장한 경로는 처음과 같은 높이에서 이륙하세요.'],
];

/**
 * 드론 촬영 (DJI Mini 4 Pro)
 *
 * 18홀을 한 홀씩 찍는 비행 계획입니다. 홀을 고르면 웨이포인트·고도·짐벌 각도와,
 * 각 점이 DJI 비행 구역 어디에 드는지가 나옵니다. 관리자는 이 값을 DJI Fly 의
 * 웨이포인트에 옮겨 적고, 호프 가이드(나레이션 슬라이드)로 순서를 익힙니다.
 *
 * 홀을 고르면 지도에서 웨이포인트를 고칩니다. 조작은 코스 지도와 같지만 데이터는
 * 따로입니다 - 여기서 고친 경로는 선수 지도를 바꾸지 않고, 코스 지도의 선을 고쳐도
 * 저장한 경로는 움직이지 않습니다(lib/droneRoutes).
 *
 * 고치는 것은 코스 지도 수정 계정(0030)만 합니다. 다른 계정은 계획을 보고 내려받기만
 * 합니다 - 현장에서 경로를 읽는 일은 누구나 해야 하기 때문입니다.
 */
export function DroneAdmin() {
  const account = useAppStore((s) => s.account);
  const [canEdit, setCanEdit] = useState(false);
  const [rawHoles, setRawHoles] = useState<Hole[]>(PELHAM_HILLS_HOLES);
  const holePaths = useAppStore((s) => s.holePaths);
  const setHolePaths = useAppStore((s) => s.setHolePaths);
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [routes, setRoutes] = useState<DroneRoutes>(cachedDroneRoutes);
  // 고른 점의 순서. 다른 홀로 가면 지웁니다 - 엉뚱한 점이 지워지면 안 됩니다.
  const [picked, setPicked] = useState<number | null>(null);
  // 끄는 동안의 선. 점 자체는 놓을 때 한 번만 저장합니다.
  const [preview, setPreview] = useState<FairwayPoint[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [routeProblem, setRouteProblem] = useState<ServerProblem | null>(null);
  // 끌던 것을 놓으면 브라우저가 그 밑의 지도에 누름도 하나 보냅니다(마우스).
  const lastDrop = useRef(0);
  const lang = useSyncExternalStore(onLangChange, getLang);

  // 선수 화면과 같은 순서: 번들 좌표로 바로 그리고, Supabase 행이 오면 바꿉니다.
  useEffect(() => {
    const ac = new AbortController();
    fetchCourseData(undefined, ac.signal)
      .then((d) => {
        if (!ac.signal.aborted) setRawHoles(d.holes);
      })
      .catch(() => {
        /* fetchCourseData가 이미 번들로 물러섭니다 */
      });
    return () => ac.abort();
  }, []);

  // 코스 지도 탭에서 고친 티·핀. 자동 경로의 기준으로만 씁니다 - 고친 경로는 따라오지 않습니다.
  useEffect(() => {
    let alive = true;
    loadHolePaths(PELHAM_HILLS.id)
      .then((rows) => {
        if (alive) setHolePaths(rows);
        return pullHoleEdits(PELHAM_HILLS.id);
      })
      .then(({ rows }) => {
        if (alive && rows) setHolePaths(rows);
      });
    return () => {
      alive = false;
    };
  }, [setHolePaths]);

  // 올리지 못한 수정은 서버 사본에 덮이지 않게 두고, 수정 계정으로 열 때 올립니다.
  // 다른 계정은 그 수정을 지우지 않고 서버 경로를 봅니다 - 올라가지 못한 경로로 날면 안 됩니다.
  useEffect(() => {
    let alive = true;
    const showShared = (shared: DroneRoutes | null) => {
      if (alive && shared) setRoutes(shared);
    };
    setCanEdit(false);
    setRouteProblem(null);
    void mapEditorStatus().then((status) => {
      if (!alive) return;
      const editor = status === 'admin';
      setCanEdit(editor);
      if (!droneRoutesPending()) void fetchDroneRoutes().then(showShared);
      else if (!editor) void readDroneRoutes().then(showShared);
      else {
        void saveDroneRoutes(cachedDroneRoutes()).then((problem) => {
          if (alive) setRouteProblem(problem);
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [account]);

  useEffect(() => {
    setPicked(null);
    setPreview(null);
    setNotice(null);
  }, [selected, canEdit]);

  const holes = useMemo(() => applyHoleEdits(rawHoles, holePaths), [rawHoles, holePaths]);
  const plans = useMemo(() => holes.map((h) => planHole(h, routes[h.holeNumber])), [holes, routes]);
  const groups = useMemo(() => batteryGroups(plans), [plans]);
  const aerodromes = useMemo(() => nearestAerodromes(plans), [plans]);
  const course = useMemo(() => planCourse(plans), [plans]);
  const hits = useMemo(() => {
    const byLevel = new Map<ZoneLevel, { hole: number; id: string }[]>();
    if (course.shot.zone != null) byLevel.set(course.shot.zone, [{ hole: 0, id: course.shot.id }]);
    for (const p of plans) {
      for (const w of allWaypoints(p)) {
        if (w.zone == null) continue;
        byLevel.set(w.zone, [...(byLevel.get(w.zone) ?? []), { hole: p.hole.holeNumber, id: w.id }]);
      }
    }
    return byLevel;
  }, [plans, course]);
  const total = plans.reduce((n, p) => n + allWaypoints(p).length, 1);
  const blocked = (hits.get(2)?.length ?? 0) + (hits.get(1)?.length ?? 0);

  const plan = selected ? plans.find((p) => p.hole.holeNumber === selected) ?? null : null;
  const bounds = useMemo<FairwayPoint[]>(
    () => (plan ? [...plan.heroView, ...plan.greenView, ...plan.route.map((w) => w.at)] : plans.flatMap((p) => p.line)),
    [plan, plans]
  );
  const enhanced = DRONE_ZONES.filter((z) => z.level === 3 && z.rings);

  const spots = plan ? plan.route.map(spotOf) : [];
  const line = spots.map((p) => p.at);
  const full = spots.length >= MAX_POINTS;

  const keep = (next: DroneRoutes) => {
    if (!canEdit) return;
    setRoutes(next);
    setPreview(null);
    void saveDroneRoutes(next).then(setRouteProblem);
  };
  const commit = (next: RouteSpot[]) => keep({ ...routes, [selected]: next });

  const insertAt = (i: number, at: FairwayPoint) => {
    if (full) {
      setNotice(`웨이포인트는 한 홀에 ${MAX_POINTS}개까지입니다. 점을 끌어서 옮기거나, 지운 뒤 다시 찍으세요.`);
      setPreview(null);
      return;
    }
    setNotice(null);
    commit([...spots.slice(0, i + 1), spotBetween(spots[i], spots[i + 1], at), ...spots.slice(i + 1)]);
    setPicked(i + 1);
  };

  const addPoint = (at: FairwayPoint) => {
    if (Date.now() - lastDrop.current < 700) return;
    insertAt(nearestSegment(line, at), at);
  };

  const removeAt = (i: number) => {
    setPicked(null);
    if (spots.length <= 2) {
      setNotice('경로에는 점이 두 개는 있어야 합니다.');
      return;
    }
    setNotice(null);
    commit(spots.filter((_, k) => k !== i));
  };

  const resetRoute = () => {
    const { [selected]: _dropped, ...rest } = routes;
    keep(rest);
    setPicked(null);
    setNotice(null);
  };

  // Delete·Backspace 로도 지웁니다. 입력칸에서 누른 키는 건드리지 않습니다.
  useEffect(() => {
    if (!plan || picked === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeAt(picked);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const copyCsv = (p: HolePlan) => {
    const text = waypointCsv(p);
    navigator.clipboard.writeText(text).then(
      () => setCopied('복사했습니다'),
      () => setCopied('복사하지 못했습니다. 아래 표를 보고 옮겨 적으세요.')
    );
  };

  const saveKmz = (bytes: Uint8Array<ArrayBuffer>, name: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.google-earth.kmz' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const downloadKmz = (p: HolePlan) => saveKmz(holeKmz(p), kmzName(p));
  const downloadEarth = (list: HolePlan[]) => saveKmz(earthKmz(list, list.length > 1 ? course : undefined), earthKmzName(list));

  const step = (d: number) => {
    const n = ((selected - 1 + d + plans.length) % plans.length) + 1;
    setSelected(n);
    setCopied(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">드론 촬영 계획</p>
          <span className="ml-auto text-xs text-muted-foreground">DJI Mini 4 Pro</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {canEdit
            ? '홀마다 조망 사진(H), 플라이스루 영상(①부터), 그린 탑다운(G)을 찍습니다. 홀을 고르면 지도에서 웨이포인트를 고칠 수 있습니다. 코스 지도와 조작은 같지만 따로 저장되어 선수 지도에는 영향이 없습니다.'
            : '홀마다 조망 사진(H), 플라이스루 영상(①부터), 그린 탑다운(G)을 찍습니다. 경로는 코스 지도 수정 계정으로만 고칠 수 있습니다. 로그인은 코스 지도 탭에서 합니다.'}
        </p>
        <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="홀 선택">
          {[0, ...plans.map((p) => p.hole.holeNumber)].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setSelected(n);
                setCopied(null);
              }}
              aria-current={selected === n ? 'true' : undefined}
              className={`min-w-9 px-2.5 py-1.5 rounded-md text-xs font-medium tabular-nums whitespace-nowrap ${
                selected === n ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:bg-muted/40'
              }`}
            >
              {n === 0 ? '전체' : n}
            </button>
          ))}
        </nav>
      </section>

      {plan && canEdit && (
        <p className="text-xs text-muted-foreground">
          지도를 누르면 가장 가까운 구간에 점이 생깁니다 ({MAX_POINTS}개까지). 번호 점을 끌어 옮기고, 선 중간의 흰 점을 끌거나 누르면 그 자리에 점이 하나 더 생깁니다. 점을 두 번 누르거나(폰은 길게 누르기), 눌러서 고른 뒤 삭제 버튼을 누르면 지워집니다.
        </p>
      )}
      {notice && (
        <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
          {notice}
        </p>
      )}

      <div className="relative rounded-lg overflow-hidden border border-border h-[55vh] min-h-[320px]">
        {plan && picked !== null && (
          <button
            type="button"
            onClick={() => removeAt(picked)}
            className="absolute top-2 right-2 z-[1000] inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-red-600 text-white text-sm font-medium shadow-md hover:bg-red-700"
          >
            <Trash2 className="w-4 h-4" />
            선택한 점 삭제
          </button>
        )}
        <MapContainer
          center={[PELHAM_HILLS.center.lat, PELHAM_HILLS.center.lng]}
          zoom={16}
          maxZoom={TILE_MAX_ZOOM}
          doubleClickZoom={false}
          className="h-full w-full"
        >
          <TileLayer url={TILE_URL_TEMPLATE} attribution={TILE_ATTRIBUTION} maxZoom={TILE_MAX_ZOOM} />
          <FitTo target={selected} points={bounds} />
          <MapClicks onClick={plan && canEdit ? addPoint : undefined} />
          {enhanced.map((z, i) => (
            <Polygon
              key={i}
              positions={z.rings!}
              pathOptions={{ color: ALERT, weight: 1.5, dashArray: '6 4', fillOpacity: 0.12 }}
            />
          ))}
          {plans.map((p) => (
            <Polyline
              key={p.hole.holeNumber}
              positions={p.line}
              pathOptions={{ color: '#ffffff', weight: plan ? 1.5 : 2.5, opacity: plan && p !== plan ? 0.35 : 0.85, dashArray: plan === p ? '3 4' : undefined }}
            />
          ))}
          {!plan && (
            <>
              <Polygon positions={course.view} interactive={false} pathOptions={{ color: CAMERA, weight: 1.5, dashArray: '6 4', fillOpacity: 0.08 }} />
              {/* 티 위의 자리라 홀 번호 옆에 둡니다 - 겹치면 번호를 누를 수 없습니다. */}
              <Marker position={course.shot.at} icon={badge('C', CAMERA, course.shot.zone === 3 || course.shot.zone === 1 || course.shot.zone === 2, true)} interactive={false} />
            </>
          )}
          {!plan &&
            plans.map((p) => (
              <Marker
                key={`n${p.hole.holeNumber}`}
                position={p.line[0]}
                icon={holeNumberIcon(p.hole.holeNumber)}
                eventHandlers={{ click: () => setSelected(p.hole.holeNumber) }}
              />
            ))}
          {plan && (
            <>
              <Polygon positions={plan.heroView} pathOptions={{ color: CAMERA, weight: 1.5, dashArray: '6 4', fillOpacity: 0.08 }} />
              <Polygon positions={plan.greenView} pathOptions={{ color: CAMERA, weight: 1.5, fillOpacity: 0.15 }} />
              <Polyline positions={preview ?? line} interactive={false} pathOptions={{ color: ROUTE, weight: 4 }} />
              <Marker position={plan.hero.at} icon={badge('H', CAMERA, plan.hero.zone === 3 || plan.hero.zone === 1 || plan.hero.zone === 2)} interactive={false} />
              {canEdit &&
                !full &&
                line.slice(0, -1).map((a, i) => {
                  const b = line[i + 1];
                  const mid: FairwayPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
                  return (
                    // 점 개수를 key에 넣습니다. 끼워 넣은 뒤에는 손잡이가 새 구간마다 새로 생겨야 합니다.
                    <Marker
                      key={`mid-${i}-${line.length}`}
                      position={mid}
                      icon={MidpointIcon}
                      draggable
                      eventHandlers={{
                        click: () => insertAt(i, mid),
                        drag: (e) => setPreview([...line.slice(0, i + 1), pointOf(e), ...line.slice(i + 1)]),
                        dragend: (e) => {
                          lastDrop.current = Date.now();
                          insertAt(i, pointOf(e));
                        },
                      }}
                    />
                  );
                })}
              {plan.route.map((w, i) => (
                <Marker
                  key={`wp-${i}`}
                  position={w.at}
                  icon={badge(w.id, picked === i ? PICKED : ROUTE, w.zone === 3 || w.zone === 1 || w.zone === 2)}
                  draggable={canEdit}
                  zIndexOffset={1000}
                  eventHandlers={
                    canEdit
                      ? {
                          click: () => setPicked(i),
                          dblclick: () => removeAt(i),
                          contextmenu: () => removeAt(i),
                          drag: (e) => setPreview(line.map((p, k) => (k === i ? pointOf(e) : p))),
                          dragend: (e) => {
                            lastDrop.current = Date.now();
                            commit(spots.map((s, k) => (k === i ? { ...s, at: pointOf(e) } : s)));
                            setPicked(i);
                          },
                        }
                      : {}
                  }
                />
              ))}
            </>
          )}
          {aerodromes.map((a) => (
            <CircleMarker key={a.id} center={a.at} radius={7} pathOptions={{ color: '#0b120d', weight: 2, fillColor: CAMERA, fillOpacity: 1 }} />
          ))}
        </MapContainer>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        주황 선 = 비행 경로, 흰 점선 = 코스 선(참고용), 하늘색 = 카메라에 찍히는 땅, 빨간 점선 = 강화 경고 구역, 하늘색 점 = 공항·헬기장, C = 코스 전경
      </p>
      {plan && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">
            {plan.edited ? '고친 경로' : '자동 경로'} · 웨이포인트 {plan.route.length}개
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={resetRoute}
              disabled={!plan.edited}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4" />자동 경로로
            </button>
          )}
          {routeProblem && <p className="w-full text-xs text-amber-700 dark:text-amber-400">{SERVER_MESSAGE[routeProblem]}</p>}
        </div>
      )}

      {plan ? (
        <HoleCard
          plan={plan}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onCopy={() => copyCsv(plan)}
          onKmz={() => downloadKmz(plan)}
          onEarth={() => downloadEarth([plan])}
          copied={copied}
        />
      ) : (
        <>
          <section aria-label="코스 전경" className="rounded-lg border border-border p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">코스 전경 (C)</p>
              <ZoneTag zone={course.shot.zone} />
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{mmss(course.seconds)}</span>
            </div>
            <p className="text-sm">{`${course.shot.label} · ${course.shot.altitude}m · 기수 ${course.shot.heading}° · 짐벌 ${course.shot.gimbal}°`}</p>
            <p className="font-mono text-xs">{latLng(course.shot.at)}</p>
            <p className="text-xs text-muted-foreground">
              {`18홀이 이 자리에서 ${course.span}° 안에 듭니다. 사진 한 장(가로 70°)으로는 다 담기지 않아 파노라마로 찍습니다. 이 자리에서 이륙해 곧장 올라가, 기수와 짐벌로 구도를 본 뒤 사진 ▸ 파노라마 ▸ 180° 로 한 번 찍습니다. 배터리 계획 시간과 따로입니다.`}
            </p>
            <a
              href={gmaps(course.shot.at)}
              target="_blank"
              rel="noopener"
              className="self-start inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
            >
              <ExternalLink className="w-4 h-4" />이륙 지점 지도
            </a>
          </section>

          <section aria-label="KMZ 내보내기" className="rounded-lg border border-border p-3 flex flex-col gap-2">
            <p className="text-sm font-medium">KMZ 내보내기</p>
            <p className="text-xs text-muted-foreground">
              18홀의 코스 선과 비행 경로를 구글 어스에서 봅니다. DJI Fly 에 넣는 KMZ 는 홀을 골라 한 홀씩 내려받습니다.
            </p>
            <button
              type="button"
              onClick={() => downloadEarth(plans)}
              className="self-start inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
            >
              <Download className="w-4 h-4" />18홀 구글 어스 KMZ
            </button>
          </section>

          <section aria-label="비행 구역" className="rounded-lg border border-border p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <TriangleAlert className="w-4 h-4 text-orange-500" />
              <p className="text-sm font-medium">비행 구역 확인</p>
              <span className="ml-auto text-xs text-muted-foreground">DJI GEO · {DRONE_ZONES_CHECKED}</span>
            </div>
            <p className={`text-sm font-medium ${blocked ? 'text-red-600' : 'text-green-700 dark:text-green-400'}`}>
              {blocked ? `금지·승인 구역에 드는 웨이포인트가 ${blocked}개 있습니다. 계획을 옮겨야 합니다.` : '금지·승인 구역에 드는 웨이포인트는 없습니다.'}
            </p>
            <ul className="text-sm flex flex-col gap-1.5">
              {([3, 0] as ZoneLevel[]).map((level) => {
                const list = hits.get(level) ?? [];
                return (
                  <li key={level} className="flex flex-wrap items-baseline gap-2">
                    <ZoneTag zone={level} />
                    <span className="tabular-nums">
                      {list.length} / {total}
                    </span>
                    {level === 3 && list.length > 0 && (
                      <span className="text-muted-foreground">
                        {[...new Set(list.map((h) => h.hole))]
                          .map((n) => (n ? `${n}번 ${list.filter((h) => h.hole === n).map((h) => h.id).join('·')}` : '코스 전경'))
                          .join(', ')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              강화 경고 구역은 들어갈 때 DJI Fly 에서 확인을 눌러야 합니다 - 웨이포인트 비행이 거기서 멈출 수 있으니 이륙 전에 눌러 두세요. 경고 구역은 메시지만 뜹니다.
            </p>
            <ul className="text-xs text-muted-foreground flex flex-col gap-0.5">
              {aerodromes.map((a) => (
                <li key={a.id} className="tabular-nums">
                  {a.kind === 'airport' ? '공항' : '헬기장'} {a.id} ({a.name}) - 가장 가까운 곳 {a.hole}번 {a.waypoint},{' '}
                  {(a.metres / 1000).toFixed(2)}km
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              구역은 바뀔 수 있습니다. 촬영 당일 DJI Fly 와 NAV Drone 앱으로 다시 확인하세요. 표준 배터리(250g 미만)로만 찍습니다.
            </p>
          </section>

          <section aria-label="배터리" className="rounded-lg border border-border p-3 flex flex-col gap-2">
            <p className="text-sm font-medium">배터리 {groups.length}개 · 코스 순서</p>
            <div className="flex flex-col gap-1 text-sm">
              {groups.map((g, i) => (
                <div key={i} className="flex items-baseline gap-3">
                  <span className="font-mono text-primary w-7">B{i + 1}</span>
                  <span className="flex flex-wrap gap-1">
                    {g.holes.map((n) => (
                      <button key={n} type="button" onClick={() => setSelected(n)} className="underline underline-offset-2">
                        {n}번
                      </button>
                    ))}
                  </span>
                  <span className="ml-auto font-mono text-muted-foreground tabular-nums">{mmss(g.seconds)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              한 개에 20분까지(표준 배터리 34분 중 바람·이동 여유를 뺌). 프로 샵에서 조종하지 않습니다 - 캐나다는 드론을 눈으로 직접 봐야 하므로, 카트로 홀마다 가서 티 뒤 40m(①)에서 이륙합니다.
            </p>
          </section>

          <section aria-label="호프 가이드" className="rounded-lg border border-border p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Presentation className="w-4 h-4 text-primary" />
              <p className="text-sm font-medium">호프 가이드</p>
              <span className="ml-auto text-xs text-muted-foreground">ElevenLabs Hope · 10장</span>
            </div>
            <p className="text-xs text-muted-foreground">
              경로 넣는 법, 조종 위치, 배터리, 비행 구역, 체크리스트를 호프가 한국어·영어로 읽어 줍니다. 피치와 속도를 바꿀 수 있습니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowGuide((v) => !v)}
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                {showGuide ? '가이드 닫기' : '여기서 보기'}
              </button>
              <a
                href={`/admin/drone-guide.html?lang=${lang}`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
              >
                <ExternalLink className="w-4 h-4" />새 창으로
              </a>
            </div>
            {showGuide && (
              <iframe
                title="호프 드론 가이드"
                src={`/admin/drone-guide.html?lang=${lang}`}
                className="w-full h-[80vh] rounded-md border border-border"
                allow="autoplay"
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function HoleCard({
  plan,
  onPrev,
  onNext,
  onCopy,
  onKmz,
  onEarth,
  copied,
}: {
  plan: HolePlan;
  onPrev: () => void;
  onNext: () => void;
  onCopy: () => void;
  onKmz: () => void;
  onEarth: () => void;
  copied: string | null;
}) {
  const h = plan.hole;
  const lastPoint = String.fromCodePoint(0x2460 + plan.route.length - 1);
  const row = (w: Waypoint) => (
    <tr key={w.id} className="border-t border-border">
      <td className="py-1.5 pr-2 font-mono">{w.id}</td>
      <td className="py-1.5 pr-2">{w.label}</td>
      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{w.altitude}m</td>
      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{w.gimbal}°</td>
      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{w.heading}°</td>
      <td className="py-1.5 pr-2">
        <ZoneTag zone={w.zone} />
      </td>
      <td className="py-1.5 font-mono text-xs whitespace-nowrap">{latLng(w.at)}</td>
    </tr>
  );
  const warned = allWaypoints(plan).filter((w) => w.zone != null && w.zone !== 0);

  return (
    <section aria-label="홀 계획" className="rounded-lg border border-border p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onPrev} aria-label="이전 홀" className="p-1.5 rounded-md border border-border">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="text-base font-semibold">
          {h.holeNumber}번 홀 · Par {h.par}
        </p>
        <button type="button" onClick={onNext} aria-label="다음 홀" className="p-1.5 rounded-md border border-border">
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {Math.round(plan.length)}m · {Math.round(plan.bearing)}° · {mmss(plan.seconds)}
        </span>
      </div>

      {warned.length > 0 && (
        <p className="text-sm rounded-md px-3 py-2 bg-orange-500/10 text-orange-800 dark:text-orange-200">
          {warned.map((w) => w.id).join('·')} 이(가) {ZONE_LABEL[warned[0].zone!]}에 듭니다. 이륙 전에 DJI Fly 에서 확인을 눌러 두세요.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground text-left">
              <th className="pb-1 pr-2 font-medium">#</th>
              <th className="pb-1 pr-2 font-medium">지점</th>
              <th className="pb-1 pr-2 font-medium text-right">고도</th>
              <th className="pb-1 pr-2 font-medium text-right">짐벌</th>
              <th className="pb-1 pr-2 font-medium text-right">기수</th>
              <th className="pb-1 pr-2 font-medium">구역</th>
              <th className="pb-1 font-medium">위도, 경도</th>
            </tr>
          </thead>
          <tbody>
            {row(plan.hero)}
            {plan.route.map(row)}
            {row(plan.green)}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        H 와 G 는 직접 날려 한 장씩 찍습니다. ①~{lastPoint} 는 DJI Fly ▸ 웨이포인트에서 지도에 같은 자리를 찍고 고도·짐벌·기수를 넣습니다 (속도 {MISSION_SPEED}m/s, ①에서 녹화 시작, {lastPoint}에서 녹화 중지). 그린 한 장에 약 {GREEN_COVERAGE.across}×{GREEN_COVERAGE.along}m 가 담깁니다.
      </p>

      <details className="rounded-lg border border-border p-3 text-xs">
        <summary className="cursor-pointer text-sm font-medium">DJI Fly 어디에 넣나요</summary>
        <dl className="mt-2 flex flex-col gap-2">
          {FLY_SETTINGS.map(([where, what]) => (
            <div key={where}>
              <dt className="font-medium">{where}</dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="text-xs text-muted-foreground">
        KMZ 는 DJI Fly 에서 저장한 빈 경로 파일을 덮어쓰는 비공식 방법입니다. 앱에서 경로가 맞게 보이는지 확인하고, 처음에는 한 홀만 시험 비행하세요.
      </p>

      <a
        href={`/admin/kmz-guide.html?lang=${getLang()}`}
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2"
      >
        <Presentation className="w-4 h-4" />KMZ 넣는 법 (호프 가이드)
      </a>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={gmaps(plan.route[0].at)}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
        >
          <ExternalLink className="w-4 h-4" />이륙 지점 지도
        </a>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
        >
          <ClipboardCopy className="w-4 h-4" />웨이포인트 CSV 복사
        </button>
        <button
          type="button"
          onClick={onKmz}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
        >
          <Download className="w-4 h-4" />DJI Fly KMZ
        </button>
        <button
          type="button"
          onClick={onEarth}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
        >
          <Download className="w-4 h-4" />구글 어스 KMZ
        </button>
        {copied && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {copied}
          </span>
        )}
      </div>
    </section>
  );
}
