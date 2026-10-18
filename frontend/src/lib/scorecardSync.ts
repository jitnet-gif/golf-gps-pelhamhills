// Moving cards between this phone and the `scorecards` table (migration 0006).
//
// The phone's copy is the one being written on, so it wins while it has
// unsent changes; the server's copy wins otherwise - that is how a card played
// on one phone shows up in the history on another.

import { db, type Scorecard } from '@/db';
import { useAppStore } from '@/store/appStore';
import { supabase } from './supabase';
import { hasAnyScore, isDirty, isTeeSet, normalisePlayers } from './scorecard';
import { TimeoutError, withTimeout } from './timeout';

/** A sync never holds "Syncing..." longer than this - see lib/timeout. */
const STORAGE_WAIT_MS = 3000;
const SYNC_WAIT_MS = 25_000;

export interface ScorecardRow {
  id: string;
  owner_id: string;
  owner_email: string | null;
  course_id: string;
  played_on: string;
  tee_set: string;
  players: unknown;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, owner_id, owner_email, course_id, played_on, tee_set, players, created_at, updated_at';

/** Postgres and JS write the same instant differently; compare the instant. */
const iso = (value: string): string => {
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t).toISOString();
};

export const fromRow = (row: ScorecardRow): Scorecard => {
  const updatedAt = iso(row.updated_at);
  return {
    id: row.id,
    courseId: row.course_id,
    playedOn: row.played_on,
    teeSet: isTeeSet(row.tee_set) ? row.tee_set : 'white',
    players: normalisePlayers(row.players),
    ownerId: row.owner_id,
    ownerEmail: row.owner_email,
    createdAt: iso(row.created_at),
    updatedAt,
    syncedAt: updatedAt,
  };
};

/** Cards this account may upload: its own, and any written while signed out. */
const belongsTo = (card: Scorecard, userId: string | null) =>
  card.ownerId === null || card.ownerId === userId;

const unsent = async (userId: string | null): Promise<Scorecard[]> =>
  (await withTimeout(db.scorecards.toArray(), STORAGE_WAIT_MS, 'storage')).filter(
    (c) => belongsTo(c, userId) && hasAnyScore(c) && isDirty(c)
  );

/** Refresh the header's "N pending" from what is actually waiting. */
export const refreshPending = async () => {
  const { account, setSyncState } = useAppStore.getState();
  try {
    const waiting = account ? (await unsent(account.id)).length : 0;
    setSyncState({ pending: waiting });
  } catch {
    /* IndexedDB unavailable - the count stays as it was */
  }
};

const describe = (error: unknown): string => {
  if (error instanceof TimeoutError) {
    return error.what === 'storage'
      ? "This phone's storage is not answering."
      : 'The server took too long.';
  }
  const e = error as { code?: string; message?: string };
  // The table is not there until migration 0006 has been run.
  if (e?.code === 'PGRST205' || e?.code === '42P01' || /does not exist|schema cache/i.test(e?.message ?? '')) {
    return 'Cloud save is not set up yet.';
  }
  if (/fetch|network/i.test(e?.message ?? '')) return 'No connection.';
  return e?.message || 'Could not reach the server.';
};

const push = async (userId: string) => {
  const cards = await unsent(userId);
  if (!cards.length || !supabase) return;

  const rows = cards.map((c) => ({
    id: c.id,
    course_id: c.courseId,
    played_on: c.playedOn,
    tee_set: c.teeSet,
    players: c.players,
    updated_at: c.updatedAt,
  }));
  // owner_id and owner_email are left to the column defaults (auth.uid() and
  // the signed-in email), so a card can only ever be filed under its uploader.
  const { error } = await supabase
    .from('scorecards')
    .upsert(rows, { onConflict: 'id', defaultToNull: false });
  if (error) throw error;

  await db.transaction('rw', db.scorecards, async () => {
    for (const sent of cards) {
      const current = await db.scorecards.get(sent.id);
      if (!current) continue;
      // A score written while the upload was in flight keeps the card dirty.
      await db.scorecards.update(sent.id, {
        ownerId: userId,
        ...(current.updatedAt === sent.updatedAt ? { syncedAt: sent.updatedAt } : {}),
      });
    }
  });
};

const pull = async (userId: string) => {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('scorecards')
    .select(COLUMNS)
    .eq('owner_id', userId)
    .order('played_on', { ascending: false })
    .limit(500);
  if (error) throw error;

  const rows = (data ?? []) as ScorecardRow[];
  await db.transaction('rw', db.scorecards, async () => {
    for (const row of rows) {
      const incoming = fromRow(row);
      const local = await db.scorecards.get(row.id);
      if (!local || (!isDirty(local) && local.updatedAt < incoming.updatedAt)) {
        await db.scorecards.put(incoming);
      }
    }
  });

  // The card on screen may be one the server just replaced.
  const { scorecard, setScorecard } = useAppStore.getState();
  if (scorecard) {
    const fresh = await db.scorecards.get(scorecard.id);
    if (fresh && fresh.updatedAt !== scorecard.updatedAt && !isDirty(scorecard)) setScorecard(fresh);
  }
};

let running: Promise<void> | null = null;
let again = false;

/**
 * Upload what is waiting, then take the server's copies. One run at a time; a
 * request that lands mid-run schedules exactly one more, so the last score
 * written is never left behind.
 */
export const syncNow = async (): Promise<void> => {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    const { account, isOnline, setSyncState } = useAppStore.getState();
    if (!supabase || !account) {
      setSyncState({ status: 'idle', error: null, pending: 0 });
      return;
    }
    if (!isOnline) {
      await refreshPending();
      return;
    }
    setSyncState({ status: 'syncing' });
    try {
      await withTimeout(
        (async () => {
          await push(account.id);
          await pull(account.id);
        })(),
        SYNC_WAIT_MS,
        'server'
      );
      setSyncState({ status: 'idle', error: null });
    } catch (err) {
      setSyncState({ status: 'error', error: describe(err) });
    }
    await refreshPending();
  })();
  try {
    await running;
  } finally {
    running = null;
    if (again) {
      again = false;
      void syncNow();
    }
  }
};

let timer: ReturnType<typeof setTimeout> | null = null;

/** Sync shortly after the last change - one upload for a flurry of taps. */
export const scheduleSync = (delayMs = 1500) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delayMs);
};

/** Is the signed-in account on the admin list? False on any failure. */
export const isScorecardAdmin = async (): Promise<boolean> => {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('is_scorecard_admin');
  return !error && data === true;
};

/**
 * Every card the account may read - all of them for an admin, its own
 * otherwise (RLS decides, not this query). Newest first.
 */
export const fetchScorecards = async (
  playedOn: string | null
): Promise<{ cards: Scorecard[]; error: string | null }> => {
  if (!supabase) return { cards: [], error: 'Supabase is not configured.' };
  let query = supabase
    .from('scorecards')
    .select(COLUMNS)
    .order('played_on', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(500);
  if (playedOn) query = query.eq('played_on', playedOn);
  const { data, error } = await query;
  if (error) return { cards: [], error: describe(error) };
  return { cards: ((data ?? []) as ScorecardRow[]).map(fromRow), error: null };
};
