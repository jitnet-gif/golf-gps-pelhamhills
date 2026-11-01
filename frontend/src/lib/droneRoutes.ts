// Drone fly-through routes edited in the Drone tab, hole by hole. They have
// nothing to do with the course map's lines: moving a point here never touches
// a player's map, and a line redrawn in /admin/map never moves a saved route.
//
// One `drone_routes` row in `app_settings` (migration 0007), so the route planned
// at a desk is on the phone at the tee. The copy on this device is written first
// and stays pending until the course map editor account (migration 0030) has
// uploaded it; every other account only reads.

import type { FairwayPoint } from '@/data/pelhamHills';
import type { RouteSpot } from './dronePlan';
import { problemOf, type ServerProblem } from './holePaths';
import { supabase } from './supabase';

export type DroneRoutes = Record<number, RouteSpot[]>;

const ROUTES_KEY = 'drone_routes';
const CACHE_KEY = 'golf.droneRoutes';
const PENDING_KEY = 'golf.droneRoutes.pending';

const asPoint = (v: unknown): FairwayPoint | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? [v[0] as number, v[1] as number]
    : null;

const asSpot = (v: unknown): RouteSpot | null => {
  const s = v as Partial<RouteSpot> | null;
  const at = asPoint(s?.at);
  return at && typeof s?.altitude === 'number' && typeof s.gimbal === 'number'
    ? { label: typeof s.label === 'string' ? s.label : '추가 점', at, altitude: s.altitude, gimbal: s.gimbal }
    : null;
};

const asRoutes = (value: unknown): DroneRoutes => {
  const routes: DroneRoutes = {};
  if (!value || typeof value !== 'object') return routes;
  for (const [hole, spots] of Object.entries(value)) {
    if (!Array.isArray(spots)) continue;
    const clean = spots.map(asSpot).filter((s): s is RouteSpot => !!s);
    if (clean.length >= 2) routes[Number(hole)] = clean;
  }
  return routes;
};

export const cachedDroneRoutes = (): DroneRoutes => {
  try {
    return asRoutes(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'));
  } catch {
    return {};
  }
};

export const droneRoutesPending = (): boolean => {
  try {
    return localStorage.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
};

const remember = (routes: DroneRoutes, pending: boolean) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(routes));
    if (pending) localStorage.setItem(PENDING_KEY, '1');
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage blocked - the routes last as long as this screen */
  }
};

/** What the server holds, leaving this device's copy alone. Null when the server could not say. */
export const readDroneRoutes = async (): Promise<DroneRoutes | null> => {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', ROUTES_KEY)
      .maybeSingle();
    return error ? null : asRoutes(data?.value);
  } catch {
    return null;
  }
};

/** The shared routes, or null when the server could not say. An edit still pending here is kept. */
export const fetchDroneRoutes = async (): Promise<DroneRoutes | null> => {
  if (droneRoutesPending()) return null;
  const routes = await readDroneRoutes();
  if (routes) remember(routes, false);
  return routes;
};

/** Keep the routes on this device, then upload them. Needs the course map editor to reach the server. */
export const saveDroneRoutes = async (routes: DroneRoutes): Promise<ServerProblem | null> => {
  remember(routes, true);
  if (!supabase) return 'unavailable';
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return 'signedOut';
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        { key: ROUTES_KEY, value: routes, updated_at: new Date().toISOString() },
        { onConflict: 'key', defaultToNull: false }
      );
    if (error) return problemOf(error);
    remember(routes, false);
    return null;
  } catch (err) {
    return problemOf(err as { message?: string });
  }
};
