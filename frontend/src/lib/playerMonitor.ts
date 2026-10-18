/**
 * Where the carts are: the phone's half of the pro shop's player monitor.
 *
 * Migration 0014. A phone on the course posts its position every half minute
 * through `report_player_position`, and /admin > 플레이어 draws those positions
 * on the course map. One row per phone, overwritten - this is "where is
 * everybody now", not a trail. Rows older than six hours are dropped by the
 * function itself.
 *
 * Two things this file will not do:
 *
 * - It never surfaces an error to the player. A club that has not run 0014
 *   yet, a phone with no signal on the 12th, a rate limit - none of that is
 *   the player's problem, and a round is no place for a toast about telemetry.
 *   Failures are counted here and readable from the console, nothing more.
 * - It never sends a position the player did not already have on screen. The
 *   fix comes from the store, which is the same fix the blue dot is drawn from.
 */

import { supabase } from './supabase';

/** How often a phone reports. The server drops anything faster than 10 s. */
export const REPORT_INTERVAL_MS = 30_000;

/**
 * Wilder than this and the point would sit in a hedge. A phone that has just
 * woken up reports 2000 m accuracy for a few seconds; drawing that on a hole
 * map tells the pro shop something false rather than nothing.
 */
const WORST_USEFUL_ACCURACY_M = 100;

const DEVICE_KEY = 'golf.monitor.deviceId';

/**
 * This phone's id for the monitor. Random, kept on the phone, and tied to
 * nothing else - it is how two carts stay two rows, not who anybody is. The
 * name and email beside it on the admin screen are the ones the player already
 * typed on their card or signed in with.
 */
export const deviceId = (): string => {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && saved.length >= 8) return saved;
    const made = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    // Private mode: a fresh id per page load. The row is still right, it just
    // does not survive a reload - and a duplicate ages out in six hours.
    return crypto.randomUUID();
  }
};

export interface PositionReport {
  courseId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  holeNumber?: number | null;
  playerName?: string | null;
  playerEmail?: string | null;
}

/**
 * Post one position. Resolves false when it was not sent or not accepted -
 * never throws, and never tells the player.
 */
export const reportPosition = async (report: PositionReport): Promise<boolean> => {
  if (!supabase) return false;
  if (report.accuracy != null && report.accuracy > WORST_USEFUL_ACCURACY_M) return false;

  try {
    const { data, error } = await supabase.rpc('report_player_position', {
      p_device_id: deviceId(),
      p_course_id: report.courseId,
      p_latitude: report.latitude,
      p_longitude: report.longitude,
      p_accuracy: report.accuracy ?? null,
      p_hole_number: report.holeNumber ?? null,
      p_player_name: report.playerName ?? null,
      p_player_email: report.playerEmail ?? null,
    });
    if (error) {
      // Most likely 0014 has not been run. Say it once, to the console.
      warnOnce(error.message);
      return false;
    }
    return data === true;
  } catch {
    return false;
  }
};

let warned = false;
const warnOnce = (message: string) => {
  if (warned) return;
  warned = true;
  console.warn(
    `[playerMonitor] position not recorded: ${message}. ` +
      'If this says the function is missing, run backend/migrations/0014_player_monitor.sql.'
  );
};

// ---------------------------------------------------------------------------
// The pro shop's half
// ---------------------------------------------------------------------------

export interface PlayerOnCourse {
  deviceId: string;
  courseId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  holeNumber: number | null;
  playerName: string | null;
  playerEmail: string | null;
  /** When this phone last reported. */
  updatedAt: string;
}

/** A row older than this is a cart that stopped reporting, not one on the 7th. */
export const STALE_AFTER_MS = 5 * 60_000;

export const isStale = (player: PlayerOnCourse, now = Date.now()): boolean =>
  now - new Date(player.updatedAt).getTime() > STALE_AFTER_MS;

/** How this phone is named on the monitor: their card, their login, or neither. */
export const playerLabel = (player: PlayerOnCourse): string =>
  player.playerName ||
  player.playerEmail ||
  `카트 ${player.deviceId.slice(0, 4).toUpperCase()}`;

/**
 * Everyone reporting right now, newest first. Signed in as an admin, or the
 * row-level policy returns an empty list rather than an error - which is why
 * the panel sits behind AdminAccountGate.
 */
export const fetchPlayersOnCourse = async (): Promise<PlayerOnCourse[]> => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('player_positions')
    .select(
      'device_id, course_id, latitude, longitude, accuracy, hole_number, player_name, player_email, updated_at'
    )
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    deviceId: row.device_id as string,
    courseId: row.course_id as string,
    latitude: row.latitude as number,
    longitude: row.longitude as number,
    accuracy: (row.accuracy as number | null) ?? null,
    holeNumber: (row.hole_number as number | null) ?? null,
    playerName: (row.player_name as string | null) ?? null,
    playerEmail: (row.player_email as string | null) ?? null,
    updatedAt: row.updated_at as string,
  }));
};

/** Drop one row - a cart that finished but whose phone is still on the property. */
export const forgetPlayer = async (id: string): Promise<void> => {
  if (!supabase) return;
  const { error } = await supabase.from('player_positions').delete().eq('device_id', id);
  if (error) throw new Error(error.message);
};
