import {
  PELHAM_HILLS,
  PELHAM_HILLS_HOLES,
  type Hole,
} from '@/data/pelhamHills';

/**
 * Course and hole reads come straight from Supabase over PostgREST.
 *
 * The publishable key is safe in the client: `courses` and `holes` are
 * `FOR SELECT USING (true)` with `GRANT SELECT ... TO anon`, so this key can
 * only read reference data. Writes (rounds, scores) are gated on `auth.uid()`
 * and will fail RLS with this key — they need a signed-in session, so don't
 * route score saving through here.
 *
 * The bundled course data is the offline fallback. This is a PWA people open
 * standing on a fairway, so a failed request must not leave the map empty.
 */

const URL_BASE = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface Course {
  id: string;
  name: string;
  location: string;
  par: number;
  holes: number;
}

export interface CourseData {
  course: Course;
  holes: Hole[];
  /** True when the bundled copy was used instead of the network. */
  offline: boolean;
}

const FALLBACK: CourseData = {
  course: {
    id: PELHAM_HILLS.id,
    name: PELHAM_HILLS.name,
    location: PELHAM_HILLS.location,
    par: PELHAM_HILLS.par,
    holes: PELHAM_HILLS.holes,
  },
  holes: PELHAM_HILLS_HOLES,
  offline: true,
};

interface HoleRow {
  hole_number: number;
  par: number;
  handicap: number;
  length: number;
  pin_gps_lat: number | string;
  pin_gps_lng: number | string;
  tee_gps_lat?: number | string | null;
  tee_gps_lng?: number | string | null;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY as string },
    signal,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * Tee columns arrived in migration 0002. Against a database still on 0001 the
 * fields come back undefined, so fall back to the bundled tee rather than
 * dropping the tee marker and the hole's centreline off the map.
 */
function toHole(row: HoleRow): Hole {
  const bundled = PELHAM_HILLS_HOLES.find(
    (h) => h.holeNumber === row.hole_number
  );
  const tee =
    row.tee_gps_lat != null && row.tee_gps_lng != null
      ? { lat: Number(row.tee_gps_lat), lng: Number(row.tee_gps_lng) }
      : bundled
        ? { lat: bundled.teeLatitude, lng: bundled.teeLongitude }
        : null;

  return {
    holeNumber: row.hole_number,
    par: row.par,
    handicap: row.handicap,
    length: row.length,
    latitude: Number(row.pin_gps_lat),
    longitude: Number(row.pin_gps_lng),
    teeLatitude: tee ? tee.lat : Number(row.pin_gps_lat),
    teeLongitude: tee ? tee.lng : Number(row.pin_gps_lng),
  };
}

export async function fetchCourseData(
  courseName = PELHAM_HILLS.name,
  signal?: AbortSignal
): Promise<CourseData> {
  if (!URL_BASE || !KEY) return FALLBACK;

  try {
    const courses = await get<Course[]>(
      `courses?select=id,name,location,par,holes&name=eq.${encodeURIComponent(courseName)}&limit=1`,
      signal
    );
    const course = courses[0];
    if (!course) return FALLBACK;

    // `select=*` rather than naming columns: the tee fields only exist once
    // migration 0002 has run, and naming a missing column makes PostgREST
    // reject the whole request.
    const rows = await get<HoleRow[]>(
      `holes?select=*&course_id=eq.${course.id}&order=hole_number.asc`,
      signal
    );
    if (!rows.length) return FALLBACK;

    return { course, holes: rows.map(toHole), offline: false };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('Course fetch failed, using bundled data:', err);
    return FALLBACK;
  }
}

export async function fetchCourses(signal?: AbortSignal): Promise<Course[]> {
  if (!URL_BASE || !KEY) return [FALLBACK.course];
  try {
    const courses = await get<Course[]>(
      'courses?select=id,name,location,par,holes&order=name.asc',
      signal
    );
    return courses.length ? courses : [FALLBACK.course];
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('Course list fetch failed, using bundled data:', err);
    return [FALLBACK.course];
  }
}
