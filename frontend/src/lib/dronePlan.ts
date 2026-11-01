/**
 * 드론 촬영 계획 (DJI Mini 4 Pro, 2026-10-29)
 *
 * 홀마다 세 가지를 찍습니다: 티 뒤 110m 에서 홀 전체를 보는 조망 사진(H),
 * 티 뒤에서 그린 위까지 날아가는 플라이스루 영상(①~⑤), 핀 위 45m 에서 수직으로
 * 찍는 그린 사진(G). 좌표는 선수 화면과 같은 홀 데이터에서 매번 계산하므로,
 * 코스 지도 탭에서 티·핀을 옮기면 계획도 따라 옮겨 갑니다.
 *
 * 페어웨이 꺾임점(path)이 있는 홀은 낙구 지점과 그린 앞을 그 선 위에 놓고, 꺾임점
 * 마다 웨이포인트를 하나씩 끼워 넣습니다 - 직선으로 두면 도그렉 홀에서 숲 위로
 * 지나갑니다. 꺾임점이 없는 홀은 ①~⑤ 그대로입니다.
 *
 * 홀 전체 탑다운은 계획에 없습니다. 120m 안에 홀이 다 들어오려면 홀이 약 127m
 * 이하여야 하는데, 가장 짧은 16번도 129m 입니다.
 */

import type { FairwayPoint, Hole } from '@/data/pelhamHills';
import { DRONE_ZONES, NEARBY_AERODROMES, type DroneZone, type ZoneLevel } from '@/data/droneZones';
import { bearingDegrees, haversineMetres } from '@/lib/geo';
import { pathLengthMetres, pointAlong } from '@/lib/holePaths';

/** 24mm 상당, 4:3 센서 대각 82.1° → 가로 69.75° × 세로 55.2°. */
const FOV_LONG = 69.75;
const FOV_SHORT = 55.2;
export const MAX_ALTITUDE = 120;
export const MISSION_SPEED = 7;
/** 표준 배터리 34분 중 바람·이동·여유를 빼고 한 개에 쓰는 시간. */
const BATTERY_SECONDS = 20 * 60;

const HERO_BACK = 60;
const HERO_ALT = 110;
const GREEN_ALT = 45;
/** 꺾임점이 낙구 지점·그린 앞과 이만큼 가까우면 점을 더 만들지 않습니다 (m). */
const BEND_GAP = 20;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const EARTH_RADIUS_M = 6371000;

/** p 에서 bearing 방향으로 metres 만큼 간 점. */
export function destination(p: FairwayPoint, bearing: number, metres: number): FairwayPoint {
  const φ1 = rad(p[0]);
  const λ1 = rad(p[1]);
  const θ = rad(bearing);
  const δ = metres / EARTH_RADIUS_M;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [deg(φ2), deg(λ2)];
}

const dist = (a: FairwayPoint, b: FairwayPoint) => haversineMetres(a[0], a[1], b[0], b[1]);
const bearing = (a: FairwayPoint, b: FairwayPoint) => bearingDegrees(a[0], a[1], b[0], b[1]);

/** 중심 c, 방향 b 의 직사각형 네 꼭짓점 (카메라에 찍히는 땅). */
export function footprint(c: FairwayPoint, b: number, along: number, across: number): FairwayPoint[] {
  const f = destination(c, b, along / 2);
  const r = destination(c, b + 180, along / 2);
  return [
    destination(f, b - 90, across / 2),
    destination(f, b + 90, across / 2),
    destination(r, b + 90, across / 2),
    destination(r, b - 90, across / 2),
  ];
}

// ---------------------------------------------------------------------------
// 비행 구역
// ---------------------------------------------------------------------------

export const ZONE_LABEL: Record<ZoneLevel, string> = {
  2: '금지 구역',
  1: '승인 구역',
  3: '강화 경고 구역',
  0: '경고 구역',
};

/** 위험한 것이 앞. 한 점이 여러 구역에 들면 이 순서로 가장 앞의 것을 씁니다. */
const SEVERITY: ZoneLevel[] = [2, 1, 3, 0];

function inRing(p: FairwayPoint, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inZone = (p: FairwayPoint, z: DroneZone): boolean =>
  z.rings ? z.rings.some((r) => inRing(p, r)) : !!z.circle && dist(p, z.circle.center) <= z.circle.radius;

/** 이 점이 드는 가장 엄한 구역 등급, 어디에도 안 들면 null. */
export function zoneLevelAt(p: FairwayPoint): ZoneLevel | null {
  const levels = new Set(DRONE_ZONES.filter((z) => inZone(p, z)).map((z) => z.level));
  return SEVERITY.find((l) => levels.has(l)) ?? null;
}

// ---------------------------------------------------------------------------
// 홀 계획
// ---------------------------------------------------------------------------

export interface Waypoint {
  /** 'H', '1'…, 'G' */
  id: string;
  label: string;
  at: FairwayPoint;
  altitude: number;
  gimbal: number;
  heading: number;
  zone: ZoneLevel | null;
}

export interface HolePlan {
  hole: Hole;
  /** 티 → 꺾임점 → 핀 */
  line: FairwayPoint[];
  length: number;
  bearing: number;
  hero: Waypoint;
  /** 조망 사진의 화각 (부채꼴) */
  heroView: FairwayPoint[];
  /** 플라이스루 ①부터. 꺾임점이 있는 홀은 ⑤보다 많습니다. */
  route: Waypoint[];
  green: Waypoint;
  greenView: FairwayPoint[];
  routeMetres: number;
  routeSeconds: number;
  /** 이착륙·조망·그린까지 합한 이 홀의 비행 시간 */
  seconds: number;
}

export function planHole(hole: Hole): HolePlan {
  const tee: FairwayPoint = [hole.teeLatitude, hole.teeLongitude];
  const pin: FairwayPoint = [hole.latitude, hole.longitude];
  const line = [tee, ...(hole.path ?? []), pin];
  const length = pathLengthMetres(line);
  const b = bearing(tee, pin);

  const landing = hole.par === 3 ? 0.5 : Math.min(230 / length, 0.6);
  const short = Math.max(0, 1 - 35 / length);
  // [지점, 티에서 선을 따라 간 거리, 위치, 고도, 짐벌]
  const stops: [string, number, FairwayPoint, number, number][] = [
    ['티 위', 0, tee, 35, -20],
    [hole.par === 3 ? '홀 중간' : '낙구 지점', landing * length, pointAlong(line, landing), 45, -25],
    ['그린 앞 35m', short * length, pointAlong(line, short), 30, -40],
    ['그린 위', length, pin, 30, -90],
  ];
  const bends = (hole.path ?? []).flatMap((at, i): (typeof stops)[number][] => {
    const along = pathLengthMetres(line.slice(0, i + 2));
    if (stops.some(([, metres]) => Math.abs(metres - along) < BEND_GAP)) return [];
    // 고도와 짐벌은 앞뒤 점 사이에서 거리만큼 옮겨 갑니다.
    const after = stops.findIndex(([, metres]) => metres > along);
    const [, fromAt, , fromAlt, fromGimbal] = stops[after - 1];
    const [, toAt, , toAlt, toGimbal] = stops[after];
    const t = (along - fromAt) / (toAt - fromAt);
    return [[
      `꺾이는 점 ${i + 1}`,
      along,
      at,
      Math.round(fromAlt + (toAlt - fromAlt) * t),
      Math.round(fromGimbal + (toGimbal - fromGimbal) * t),
    ]];
  });
  const spots: [string, FairwayPoint, number, number][] = [
    ['티 뒤 40m (출발)', destination(tee, b + 180, 40), 20, -10],
    ...[...stops, ...bends]
      .sort((p, q) => p[1] - q[1])
      .map(([label, , at, altitude, gimbal]): [string, FairwayPoint, number, number] => [label, at, altitude, gimbal]),
  ];
  const route: Waypoint[] = spots.map(([label, at, altitude, gimbal], i) => {
    // 기수는 다음 점을 봅니다. 마지막 점은 들어온 방향 그대로.
    const next = spots[i + 1]?.[1];
    const prev = spots[i - 1]?.[1];
    const heading = next ? bearing(at, next) : prev ? bearing(prev, at) : b;
    return { id: String(i + 1), label, at, altitude, gimbal, heading: Math.round(heading), zone: zoneLevelAt(at) };
  });

  let routeMetres = 0;
  for (let i = 1; i < route.length; i++) {
    routeMetres += Math.hypot(dist(route[i - 1].at, route[i].at), route[i].altitude - route[i - 1].altitude);
  }
  const routeSeconds = routeMetres / MISSION_SPEED + route.length * 3;

  // 조망: 티 앞과 그린이 세로 화각 안에 같이 들어오도록 그 사이를 겨눕니다.
  const heroAt = destination(tee, b + 180, HERO_BACK);
  const near = deg(Math.atan(HERO_ALT / HERO_BACK));
  const far = deg(Math.atan(HERO_ALT / (HERO_BACK + length)));
  const hero: Waypoint = {
    id: 'H',
    label: '전체 조망 사진',
    at: heroAt,
    altitude: HERO_ALT,
    gimbal: -Math.round((near + far) / 2),
    heading: Math.round(b),
    zone: zoneLevelAt(heroAt),
  };
  const reach = HERO_BACK + length + 40;
  const heroView = [heroAt, destination(heroAt, b - FOV_LONG / 2, reach), destination(heroAt, b + FOV_LONG / 2, reach)];

  const green: Waypoint = {
    id: 'G',
    label: '그린 탑다운',
    at: pin,
    altitude: GREEN_ALT,
    gimbal: -90,
    heading: Math.round(b),
    zone: zoneLevelAt(pin),
  };
  const greenView = footprint(
    pin,
    b,
    2 * GREEN_ALT * Math.tan(rad(FOV_SHORT / 2)),
    2 * GREEN_ALT * Math.tan(rad(FOV_LONG / 2))
  );

  const seconds = 60 + (2 * HERO_ALT) / 5 + 40 + routeSeconds + 60;
  return { hole, line, length, bearing: b, hero, heroView, route, green, greenView, routeMetres, routeSeconds, seconds };
}

/** 그린 탑다운 한 장에 담기는 땅 (가로 × 세로, m). */
export const GREEN_COVERAGE = {
  across: Math.round(2 * GREEN_ALT * Math.tan(rad(FOV_LONG / 2))),
  along: Math.round(2 * GREEN_ALT * Math.tan(rad(FOV_SHORT / 2))),
};

/** 코스 순서대로 배터리 하나에 20분까지 묶습니다. */
export function batteryGroups(plans: HolePlan[]): { holes: number[]; seconds: number }[] {
  const groups: { holes: number[]; seconds: number }[] = [];
  for (const p of plans) {
    const last = groups[groups.length - 1];
    if (last && last.seconds + p.seconds <= BATTERY_SECONDS) {
      last.holes.push(p.hole.holeNumber);
      last.seconds += p.seconds;
    } else {
      groups.push({ holes: [p.hole.holeNumber], seconds: p.seconds });
    }
  }
  return groups;
}

export const allWaypoints = (p: HolePlan): Waypoint[] => [p.hero, ...p.route, p.green];

/** 가장 가까운 비행장과 그 웨이포인트. */
export function nearestAerodromes(plans: HolePlan[]) {
  return NEARBY_AERODROMES.map((a) => {
    let best = { metres: Infinity, hole: 0, waypoint: '' };
    for (const p of plans) {
      for (const w of allWaypoints(p)) {
        const m = dist(w.at, a.at);
        if (m < best.metres) best = { metres: m, hole: p.hole.holeNumber, waypoint: w.id };
      }
    }
    return { ...a, ...best };
  });
}

export function waypointCsv(p: HolePlan): string {
  const rows = ['wp,label,lat,lon,alt_m,heading_deg,gimbal_deg,speed_ms,zone'];
  for (const w of p.route) {
    rows.push(
      [w.id, w.label, w.at[0].toFixed(7), w.at[1].toFixed(7), w.altitude, w.heading, w.gimbal, MISSION_SPEED, w.zone ?? ''].join(',')
    );
  }
  return rows.join('\n');
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
