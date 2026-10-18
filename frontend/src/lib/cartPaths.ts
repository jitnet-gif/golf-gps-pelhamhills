import type { FairwayPoint } from '@/data/pelhamHills';
import type { CartPathLine } from '@/data/cartPaths';
import { haversineMetres } from '@/lib/geo';
import { supabase } from '@/lib/supabase';
import { isScorecardAdmin } from '@/lib/scorecardSync';
import { problemOf, type ServerProblem } from '@/lib/holePaths';

/**
 * Cart paths an admin drove with the recorder in /admin/map (table cart_paths,
 * migration 0011), laid over OpenStreetMap's for the cart navigation.
 *
 * Every phone reads them without signing in and keeps the last copy in
 * localStorage, so a round that starts with no signal still routes along them.
 * localStorage rather than IndexedDB on purpose: a new Dexie table means a
 * version upgrade, and an old tab holding the database blocks that upgrade -
 * the "Opening your card..." hang this app has already had once.
 */

export interface RecordedCartPath extends CartPathLine {
  courseId: string;
  metres: number;
  createdAt: string;
}

const cacheKey = (courseId: string) => `golf.cartPaths.${courseId}`;

const asPoint = (v: unknown): FairwayPoint | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? [v[0] as number, v[1] as number]
    : null;

interface CartPathRow {
  id: string;
  course_id: string;
  points: unknown;
  metres: number | string;
  created_at: string;
}

const fromRow = (r: CartPathRow): RecordedCartPath | null => {
  const points = Array.isArray(r.points) ? r.points.map(asPoint).filter((p): p is FairwayPoint => !!p) : [];
  if (points.length < 2) return null;
  return { id: r.id, courseId: r.course_id, points, metres: Number(r.metres), createdAt: r.created_at };
};

export const loadCachedCartPaths = (courseId: string): RecordedCartPath[] => {
  try {
    const raw = localStorage.getItem(cacheKey(courseId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((p): p is RecordedCartPath => !!p && Array.isArray(p.points) && p.points.length >= 2)
      : [];
  } catch {
    return [];
  }
};

const cache = (courseId: string, rows: RecordedCartPath[]) => {
  try {
    localStorage.setItem(cacheKey(courseId), JSON.stringify(rows));
  } catch {
    /* no storage: the paths are fetched again next visit */
  }
};

/** The shared paths, cached on the phone. `rows` is null when the server could not be read. */
export const pullCartPaths = async (
  courseId: string
): Promise<{ rows: RecordedCartPath[] | null; problem: ServerProblem | null }> => {
  if (!supabase) return { rows: null, problem: 'unavailable' };
  try {
    const { data, error } = await supabase
      .from('cart_paths')
      .select('id, course_id, points, metres, created_at')
      .eq('course_id', courseId)
      .order('created_at', { ascending: true });
    if (error) return { rows: null, problem: problemOf(error) };
    const rows = ((data ?? []) as CartPathRow[]).map(fromRow).filter((r): r is RecordedCartPath => !!r);
    cache(courseId, rows);
    return { rows, problem: null };
  } catch (err) {
    return { rows: null, problem: problemOf(err as { message?: string }) };
  }
};

const signedInAdmin = async (): Promise<ServerProblem | null> => {
  if (!supabase) return 'unavailable';
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return 'signedOut';
  // Row security turns a non-admin's delete into "0 rows", not an error.
  return (await isScorecardAdmin()) ? null : 'notAdmin';
};

export const saveCartPath = async (
  courseId: string,
  points: FairwayPoint[]
): Promise<{ row: RecordedCartPath | null; problem: ServerProblem | null }> => {
  try {
    const problem = await signedInAdmin();
    if (problem || !supabase) return { row: null, problem: problem ?? 'unavailable' };
    const { data, error } = await supabase
      .from('cart_paths')
      .insert({ course_id: courseId, points, metres: Math.round(trackMetres(points) * 10) / 10 })
      .select('id, course_id, points, metres, created_at')
      .single();
    if (error) return { row: null, problem: problemOf(error) };
    const row = fromRow(data as CartPathRow);
    if (row) cache(courseId, [...loadCachedCartPaths(courseId).filter((r) => r.id !== row.id), row]);
    return { row, problem: null };
  } catch (err) {
    return { row: null, problem: problemOf(err as { message?: string }) };
  }
};

export const deleteCartPath = async (courseId: string, id: string): Promise<ServerProblem | null> => {
  try {
    const problem = await signedInAdmin();
    if (problem || !supabase) return problem ?? 'unavailable';
    const { error } = await supabase.from('cart_paths').delete().eq('id', id);
    if (error) return problemOf(error);
    cache(courseId, loadCachedCartPaths(courseId).filter((r) => r.id !== id));
    return null;
  } catch (err) {
    return problemOf(err as { message?: string });
  }
};

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export const trackMetres = (points: FairwayPoint[]): number => {
  let m = 0;
  for (let i = 1; i < points.length; i += 1) {
    m += haversineMetres(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return m;
};

/** Fixes vaguer than this are not written into a path. */
export const RECORD_MAX_ACCURACY_METRES = 15;
/** A new point once the cart has moved this far - closer ones are the same spot jittering. */
export const RECORD_MIN_STEP_METRES = 4;
/** A jump this far between two fixes a few seconds apart is a bad fix, not a cart. */
const RECORD_MAX_SPEED_MPS = 12;

export interface TrackFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export interface Track {
  points: FairwayPoint[];
  /** When the last point was taken - for telling a cart from a bad fix. */
  lastAt: number | null;
}

export type TrackSkip = 'vague' | 'still' | 'jump';

/**
 * The track with this fix added - or unchanged, with why, when the fix is too
 * vague, too close to the last point, or further from it than a cart can go.
 */
export const addTrackFix = (track: Track, fix: TrackFix): { track: Track; skipped: TrackSkip | null } => {
  if (fix.accuracy > RECORD_MAX_ACCURACY_METRES) return { track, skipped: 'vague' };
  const point: FairwayPoint = [fix.latitude, fix.longitude];
  const last = track.points[track.points.length - 1];
  if (last) {
    const step = haversineMetres(last[0], last[1], point[0], point[1]);
    if (step < RECORD_MIN_STEP_METRES) return { track, skipped: 'still' };
    const seconds = Math.max(1, (fix.timestamp - (track.lastAt ?? fix.timestamp)) / 1000);
    if (step / seconds > RECORD_MAX_SPEED_MPS) return { track, skipped: 'jump' };
  }
  return { track: { points: [...track.points, point], lastAt: fix.timestamp }, skipped: null };
};

/** Douglas-Peucker: drops points that sit within `tolerance` metres of the line through their neighbours. */
export const simplifyTrack = (points: FairwayPoint[], tolerance = 1.5): FairwayPoint[] => {
  if (points.length <= 2) return points;
  const origin = points[0];
  const kx = 111_320 * Math.cos((origin[0] * Math.PI) / 180);
  const xy = points.map((p) => [(p[1] - origin[1]) * kx, (p[0] - origin[0]) * 110_574]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let farD = tolerance;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const len = Math.hypot(bx - ax, by - ay);
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = xy[i];
      const d = len
        ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len
        : Math.hypot(px - ax, py - ay);
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
};
