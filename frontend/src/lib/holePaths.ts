import { db, type HolePath } from '@/db';
import { haversineMetres } from '@/lib/geo';
import { supabase } from '@/lib/supabase';
import type { FairwayPoint, Hole } from '@/data/pelhamHills';

export type { HolePath };

/**
 * Hole layout edits made in /admin/map: where a hole's tee-to-pin line bends
 * to follow the fairway, and - when the course data filed a tee and pin under
 * the wrong number - which tee and pin a hole number really owns.
 *
 * Drawing and numbering only. Nothing here ever feeds a distance - that is
 * still the pin survey's job alone (see lib/pinSurvey.ts). A pin moved here is
 * moved between numbers on satellite imagery, not stood on, and the two live in
 * separate tables so one can never pass for the other.
 *
 * Every row holds final values ("hole 2 is here"), never instructions ("swap 2
 * and 5"). Once an export has been pasted into the course data, a row still on
 * the device agrees with it instead of moving the hole a second time.
 *
 * An edit is written on this device first and then uploaded to `hole_edits`
 * (migration 0007) by the map editor's account (migration 0030); every player's
 * map reads that shared copy and keeps it for offline play. See pullHoleEdits /
 * pushHoleEdits below.
 */

export type HoleEdit = Pick<HolePath, 'waypoints' | 'tee' | 'pin' | 'length'>;

export const holePathId = (courseId: string, holeNumber: number): string =>
  `${courseId}:${holeNumber}`;

export const loadHolePaths = async (courseId: string): Promise<HolePath[]> => {
  try {
    return await db.holePaths.where('courseId').equals(courseId).toArray();
  } catch {
    return [];
  }
};

/**
 * Merge `patch` into this hole's row. Read-modify-write, like saveSurveyPoint:
 * a waypoint drag sends the waypoints alone, and must not wipe the tee and pin
 * a renumbering left in the same row. An empty waypoint list is kept - it is a
 * line set back to straight.
 */
export const saveHoleEdit = async (
  courseId: string,
  holeNumber: number,
  patch: Partial<HoleEdit>
): Promise<HolePath> => {
  const id = holePathId(courseId, holeNumber);
  // One transaction, so two edits landing together (a tee dropped while a bend
  // is saved) are applied one after the other instead of the second writing
  // over the first from the same stale read.
  return db.transaction('rw', db.holePaths, async () => {
    const existing = await db.holePaths.get(id);
    const row: HolePath = {
      waypoints: [],
      ...existing,
      ...patch,
      id,
      courseId,
      holeNumber,
      updatedAt: new Date().toISOString(),
    };
    await db.holePaths.put(row);
    return row;
  });
};

const layoutOf = (hole: Hole): HoleEdit => ({
  tee: [hole.teeLatitude, hole.teeLongitude],
  pin: [hole.latitude, hole.longitude],
  length: hole.length,
  waypoints: hole.path ?? [],
});

/**
 * Give each hole number the other's tee, pin, length and line.
 *
 * Swapping, never assigning, keeps the numbering a permutation: every tee and
 * pin stays owned by exactly one hole. `a` and `b` are the holes as currently
 * shown (edits applied), so a second swap undoes the first. One transaction, so
 * a failure cannot leave one half of the swap written.
 */
export const swapHoleLayouts = (
  courseId: string,
  a: Hole,
  b: Hole
): Promise<HolePath[]> =>
  db.transaction('rw', db.holePaths, () =>
    Promise.all([
      saveHoleEdit(courseId, a.holeNumber, layoutOf(b)),
      saveHoleEdit(courseId, b.holeNumber, layoutOf(a)),
    ])
  );

/** Drop this device's edit, so the hole draws from the course data again. */
export const clearHolePath = async (
  courseId: string,
  holeNumber: number
): Promise<void> => {
  await db.holePaths.delete(holePathId(courseId, holeNumber));
};

/** Drop every edit for the course - the way back from any tangle of swaps. */
export const clearAllHoleEdits = async (courseId: string): Promise<void> => {
  await db.holePaths.where('courseId').equals(courseId).delete();
};

/**
 * The course with this device's edits laid over it. Par and handicap stay with
 * the number - the club's card owns those - while tee, pin, length and line
 * move with the layout.
 */
export const applyHoleEdits = (
  holes: Hole[],
  edits: ReadonlyMap<number, HolePath>
): Hole[] =>
  edits.size === 0
    ? holes
    : holes.map((hole) => {
        const edit = edits.get(hole.holeNumber);
        if (!edit) return hole;
        return {
          ...hole,
          ...(edit.pin && { latitude: edit.pin[0], longitude: edit.pin[1] }),
          ...(edit.tee && { teeLatitude: edit.tee[0], teeLongitude: edit.tee[1] }),
          ...(edit.length != null && { length: edit.length }),
          path: edit.waypoints,
        };
      });

// ---------------------------------------------------------------------------
// The shared copy: hole_edits (migration 0007)
// ---------------------------------------------------------------------------

/** Not on the server yet: never uploaded, or changed since it was. */
export const isPendingEdit = (p: HolePath): boolean =>
  !p.syncedAt || p.syncedAt < p.updatedAt;

export type ServerProblem =
  | 'unavailable'
  | 'signedOut'
  | 'notAdmin'
  | 'missingTable'
  | 'network'
  | 'other';

interface HoleEditRow {
  course_id: string;
  hole_number: number;
  waypoints: unknown;
  tee: unknown;
  pin: unknown;
  length: number | string | null;
  updated_at: string;
}

const COLUMNS = 'course_id, hole_number, waypoints, tee, pin, length, updated_at';

const asPoint = (v: unknown): FairwayPoint | undefined =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? [v[0] as number, v[1] as number]
    : undefined;

/** Postgres and JS write the same instant differently; keep JS's form. */
const iso = (value: string): string => {
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t).toISOString();
};

const fromRow = (r: HoleEditRow): HolePath => {
  const at = iso(r.updated_at);
  const tee = asPoint(r.tee);
  const pin = asPoint(r.pin);
  const length = r.length === null || r.length === undefined ? NaN : Number(r.length);
  return {
    id: holePathId(r.course_id, r.hole_number),
    courseId: r.course_id,
    holeNumber: r.hole_number,
    waypoints: Array.isArray(r.waypoints)
      ? r.waypoints.map(asPoint).filter((p): p is FairwayPoint => !!p)
      : [],
    ...(tee ? { tee } : {}),
    ...(pin ? { pin } : {}),
    ...(Number.isFinite(length) ? { length } : {}),
    updatedAt: at,
    syncedAt: at,
  };
};

const toRow = (p: HolePath) => ({
  course_id: p.courseId,
  hole_number: p.holeNumber,
  waypoints: p.waypoints,
  tee: p.tee ?? null,
  pin: p.pin ?? null,
  length: p.length ?? null,
  updated_at: p.updatedAt,
});

/** A Supabase error in the words the admin screens explain. Shared with lib/appSettings. */
export const problemOf = (error: { code?: string; message?: string } | null | undefined): ServerProblem => {
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  if (code === 'PGRST205' || code === '42P01' || /schema cache|does not exist/i.test(message)) {
    return 'missingTable';
  }
  if (code === '42501' || /row-level security|permission denied/i.test(message)) return 'notAdmin';
  if (/fetch|network/i.test(message)) return 'network';
  return 'other';
};

/**
 * Take the shared edits into this device's copy, which is what the map draws
 * and what it still has offline.
 *
 * An edit made here and not uploaded yet is kept over the server's - that is
 * how lines drawn before the server existed survive until an admin sends them.
 * A row the server no longer has is dropped: an admin removed it elsewhere.
 * `rows` is null when the server could not be read, and then nothing local has
 * been touched.
 */
export const pullHoleEdits = async (
  courseId: string
): Promise<{ rows: HolePath[] | null; problem: ServerProblem | null }> => {
  if (!supabase) return { rows: null, problem: 'unavailable' };
  try {
    const { data, error } = await supabase
      .from('hole_edits')
      .select(COLUMNS)
      .eq('course_id', courseId);
    if (error) return { rows: null, problem: problemOf(error) };

    const server = new Map(
      ((data ?? []) as HoleEditRow[]).map((r) => [r.hole_number, fromRow(r)])
    );
    await db.transaction('rw', db.holePaths, async () => {
      const local = await db.holePaths.where('courseId').equals(courseId).toArray();
      const mine = new Map(local.map((r) => [r.holeNumber, r]));
      for (const row of local) {
        if (!isPendingEdit(row) && !server.has(row.holeNumber)) await db.holePaths.delete(row.id);
      }
      for (const [holeNumber, row] of server) {
        const own = mine.get(holeNumber);
        if (!own || !isPendingEdit(own)) await db.holePaths.put(row);
      }
    });
    return { rows: await loadHolePaths(courseId), problem: null };
  } catch (err) {
    return { rows: null, problem: problemOf(err as { message?: string }) };
  }
};

/**
 * Upload every edit on this device the server does not have. Needs a
 * signed-in admin; anyone else gets `notAdmin` from the database itself.
 */
export const pushHoleEdits = async (
  courseId: string
): Promise<{ pushed: number; problem: ServerProblem | null }> => {
  if (!supabase) return { pushed: 0, problem: 'unavailable' };
  const pending = (await loadHolePaths(courseId)).filter(isPendingEdit);
  if (!pending.length) return { pushed: 0, problem: null };
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { pushed: 0, problem: 'signedOut' };

    const { error } = await supabase
      .from('hole_edits')
      .upsert(pending.map(toRow), { onConflict: 'course_id,hole_number', defaultToNull: false });
    if (error) return { pushed: 0, problem: problemOf(error) };

    await db.transaction('rw', db.holePaths, async () => {
      for (const sent of pending) {
        const current = await db.holePaths.get(sent.id);
        // A point moved while the upload was in flight stays pending.
        if (current && current.updatedAt === sent.updatedAt) {
          await db.holePaths.update(sent.id, { syncedAt: sent.updatedAt });
        }
      }
    });
    return { pushed: pending.length, problem: null };
  } catch (err) {
    return { pushed: 0, problem: problemOf(err as { message?: string }) };
  }
};

/** Is this the account named in map_editors (migration 0030)? The server decides. */
export const mapEditorStatus = async (): Promise<'admin' | 'notAdmin' | 'error'> => {
  if (!supabase) return 'error';
  try {
    const { data, error } = await supabase.rpc('is_map_editor');
    if (error) return 'error';
    return data === true ? 'admin' : 'notAdmin';
  } catch {
    return 'error';
  }
};

/**
 * Remove holes' shared edits - the whole course's when `holeNumbers` is left
 * out. Callers drop their local rows only after this succeeds, so a delete
 * that did not happen never looks like one that did.
 */
export const deleteServerHoleEdits = async (
  courseId: string,
  holeNumbers?: number[]
): Promise<ServerProblem | null> => {
  if (!supabase) return 'unavailable';
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return 'signedOut';
    // Row security turns a non-admin's delete into "0 rows", not an error.
    if ((await mapEditorStatus()) !== 'admin') return 'notAdmin';

    let query = supabase.from('hole_edits').delete().eq('course_id', courseId);
    if (holeNumbers) query = query.in('hole_number', holeNumbers);
    const { error } = await query;
    return error ? problemOf(error) : null;
  } catch (err) {
    return problemOf(err as { message?: string });
  }
};

/** Two coordinates that are the same point, to the 7 places the data is written in. */
export const samePoint = (a: FairwayPoint, b: FairwayPoint): boolean =>
  Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;

/**
 * Hole numbers that share one pin. Empty unless a renumbering went wrong - a
 * per-hole revert after a swap, say - and cheap enough to check every render.
 */
export const sharedPins = (holes: Hole[]): number[][] => {
  const byPin = new Map<string, number[]>();
  for (const hole of holes) {
    const key = `${hole.latitude.toFixed(7)},${hole.longitude.toFixed(7)}`;
    byPin.set(key, [...(byPin.get(key) ?? []), hole.holeNumber]);
  }
  return [...byPin.values()].filter((numbers) => numbers.length > 1);
};

/** Metres along the line, point to point. */
export const pathLengthMetres = (line: FairwayPoint[]): number =>
  line.reduce(
    (sum, point, i) =>
      i === 0 ? 0 : sum + haversineMetres(line[i - 1][0], line[i - 1][1], point[0], point[1]),
    0
  );

/**
 * The point `fraction` of the way along the line, by distance - 0.5 is the
 * middle of the hole as walked, wherever its bends are.
 */
export const pointAlong = (line: FairwayPoint[], fraction: number): FairwayPoint => {
  const target = pathLengthMetres(line) * fraction;
  let walked = 0;
  for (let i = 1; i < line.length; i += 1) {
    const [a, b] = [line[i - 1], line[i]];
    const step = haversineMetres(a[0], a[1], b[0], b[1]);
    if (walked + step >= target && step > 0) {
      const t = (target - walked) / step;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += step;
  }
  return line[line.length - 1];
};

/**
 * The segment of `line` a new point belongs on - the one it sits closest to,
 * as the index of that segment's first end.
 *
 * Flat maths is enough at the scale of one hole. Longitude is scaled by the
 * cosine of the latitude so a degree east and a degree north weigh the same.
 */
export const nearestSegment = (line: FairwayPoint[], p: FairwayPoint): number => {
  const k = Math.cos((p[0] * Math.PI) / 180);
  let best = 0;
  let bestDistance = Infinity;

  for (let i = 0; i < line.length - 1; i += 1) {
    const [ay, ax] = [line[i][0], line[i][1] * k];
    const [by, bx] = [line[i + 1][0], line[i + 1][1] * k];
    const [py, px] = [p[0], p[1] * k];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
    const distance = (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
};

/**
 * The edits as source to paste into pelhamHills.ts, and as SQL for Supabase.
 *
 * Either one puts them in front of every player; the SQL does it without a
 * redeploy, because the app already reads `holes` with `select=*`. A renumbered
 * hole needs the tee columns from migration 0002, which the live database does
 * not have yet - the SQL says so up front rather than failing on someone later.
 */
export const exportHolePaths = (paths: HolePath[]): string => {
  const done = [...paths].sort((a, b) => a.holeNumber - b.holeNumber);
  if (done.length === 0) return '// No fairway lines edited on this device.';

  const c = (n: number) => Number(n.toFixed(7));
  const points = (p: HolePath) => p.waypoints.map(([lat, lng]) => [c(lat), c(lng)]);

  const source = done.map((p) => {
    const fields: string[] = [];
    if (p.pin) fields.push(`latitude: ${c(p.pin[0])}, longitude: ${c(p.pin[1])},`);
    if (p.tee) fields.push(`teeLatitude: ${c(p.tee[0])}, teeLongitude: ${c(p.tee[1])},`);
    if (p.length != null) fields.push(`length: ${Math.round(p.length)},`);
    fields.push(`path: [${points(p).map(([lat, lng]) => `[${lat}, ${lng}]`).join(', ')}],`);
    return `  ${p.holeNumber}: ${fields.join(' ')}`;
  });

  const sql = done.map((p) => {
    const set: string[] = [];
    if (p.pin) set.push(`pin_gps_lat = ${c(p.pin[0])}`, `pin_gps_lng = ${c(p.pin[1])}`);
    if (p.tee) set.push(`tee_gps_lat = ${c(p.tee[0])}`, `tee_gps_lng = ${c(p.tee[1])}`);
    if (p.length != null) set.push(`length = ${Math.round(p.length)}`);
    set.push(`fairway_path = '${JSON.stringify(points(p))}'::jsonb`);
    return (
      `UPDATE public.holes SET ${set.join(', ')} ` +
      `WHERE hole_number = ${p.holeNumber} AND course_id = ` +
      `(SELECT id FROM public.courses WHERE name = 'Pelham Hills Golf Club');`
    );
  });

  const renumbered = done.some((p) => p.tee);

  return [
    '// Fairway lines drawn in /admin/map - final values, safe to apply twice. `path: []` is a straight line.',
    '// Either replace these fields on each hole in PELHAM_HILLS_HOLES (data/pelhamHills.ts) and deploy,',
    ...source,
    '',
    renumbered
      ? '-- or run these in Supabase. They need migrations 0002 (tee columns) AND 0005 (fairway_path) applied first - the live database has neither yet:'
      : '-- or, with migrations/0005_add_fairway_path.sql applied, run these in Supabase:',
    ...sql,
  ].join('\n');
};
