import { useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { db, type Scorecard } from '@/db';
import type { TeeSet } from '@/data/pelhamHillsBook';
import {
  blankScores,
  defaultPlayerName,
  hasAnyScore,
  HOLE_COUNT,
  localDate,
  MAX_PLAYERS,
  newScorecard,
} from '@/lib/scorecard';
import { refreshPending, scheduleSync } from '@/lib/scorecardSync';
import { TimeoutError, withTimeout } from '@/lib/timeout';

const NAME_LIMIT = 24;

/**
 * Longest the card waits on the phone's storage before opening without it.
 * A frozen tab of an older version holding the database left the Scorecard on
 * "Opening your card..." for good - the read neither answered nor failed.
 */
const STORAGE_WAIT_MS = 2000;

/** Say so on the card, and stop saying so once the storage answers. */
const storageDidNotAnswer = (read: PromiseLike<unknown>) => {
  const { setStorageStuck } = useAppStore.getState();
  setStorageStuck(true);
  read.then(
    () => setStorageStuck(false),
    () => undefined
  );
};

/** May the signed-in account (or nobody) write on this card? */
const usable = (card: Scorecard, accountId: string | null) =>
  card.ownerId === null || card.ownerId === accountId;

/**
 * The card being written on, kept on the phone first and uploaded when signed
 * in (lib/scorecardSync).
 *
 * Every change is read from the store at the moment it is made, not from this
 * render's copy: four players' scores go in with quick taps, and a closure
 * holding the card from one tap ago would quietly drop the one before.
 */
export const useScorecard = () => {
  const scorecard = useAppStore((s) => s.scorecard);

  const update = useCallback(async (change: (card: Scorecard) => Scorecard) => {
    const { scorecard: current, setScorecard } = useAppStore.getState();
    if (!current) return;
    // Strictly later than the last version, even within one millisecond, so the
    // sync can always tell an edit from the copy the server already has.
    let stamp = new Date().toISOString();
    if (stamp <= current.updatedAt) {
      stamp = new Date(Date.parse(current.updatedAt) + 1).toISOString();
    }
    const next = { ...change(current), updatedAt: stamp };
    setScorecard(next);
    try {
      await db.scorecards.put(next);
    } catch (err) {
      console.error('Failed to keep the scorecard on this phone:', err);
    }
    void refreshPending();
    scheduleSync();
  }, []);

  /**
   * Today's card for this course: the one already started, or a fresh one.
   * Opening the app mid-round comes back to the same card - it used to start a
   * new empty round on every visit.
   */
  const openToday = useCallback(
    async (courseId: string, teeSet: TeeSet): Promise<Scorecard> => {
      const { account } = useAppStore.getState();
      const accountId = account?.id ?? null;
      const today = localDate();

      let stored: Scorecard | undefined;
      let read: PromiseLike<Scorecard[]> | undefined;
      try {
        read = db.scorecards.where('playedOn').equals(today).toArray();
        stored = (await withTimeout(read, STORAGE_WAIT_MS, 'storage'))
          .filter((c) => c.courseId === courseId && usable(c, accountId))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      } catch (err) {
        if (err instanceof TimeoutError && read) storageDidNotAnswer(read);
        /* IndexedDB unavailable or silent - fall through to a card held in memory */
      }

      const { scorecard: latest, setScorecard } = useAppStore.getState();
      if (stored) {
        // The one on screen may be ahead of its own stored copy by a write.
        if (latest?.id === stored.id) return latest;
        setScorecard(stored);
        return stored;
      }

      if (
        latest &&
        latest.courseId === courseId &&
        latest.playedOn === today &&
        usable(latest, accountId)
      ) {
        // An untouched card started before the account was known takes the
        // account's name rather than staying "Me".
        const first = latest.players[0];
        if (!hasAnyScore(latest) && latest.players.length === 1 && first.name === 'Me' && account?.email) {
          const renamed = { ...latest, players: [{ ...first, name: defaultPlayerName(account.email) }] };
          setScorecard(renamed);
          return renamed;
        }
        return latest;
      }

      const card = newScorecard(courseId, teeSet, defaultPlayerName(account?.email));
      setScorecard(card);
      return card;
    },
    []
  );

  /** Put a card from the history back on screen, to finish or correct it. */
  const openCard = useCallback((card: Scorecard) => {
    useAppStore.getState().setScorecard(card);
  }, []);

  /** A second card for the same day - the same group, a fresh set of boxes. */
  const startNewCard = useCallback(() => {
    const { scorecard: current, account, setScorecard } = useAppStore.getState();
    if (!current) return;
    const card = newScorecard(current.courseId, current.teeSet, defaultPlayerName(account?.email));
    card.players = current.players.map((p) => ({ name: p.name, scores: blankScores() }));
    setScorecard(card);
  }, []);

  const setHoleScore = useCallback(
    (player: number, hole: number, score: number | null) =>
      update((card) => ({
        ...card,
        players: card.players.map((p, i) =>
          i === player
            ? { ...p, scores: p.scores.map((s, h) => (h === hole - 1 ? score : s)) }
            : p
        ),
      })),
    [update]
  );

  const renamePlayer = useCallback(
    (player: number, name: string) =>
      update((card) => ({
        ...card,
        players: card.players.map((p, i) =>
          i === player ? { ...p, name: name.slice(0, NAME_LIMIT) } : p
        ),
      })),
    [update]
  );

  const addPlayer = useCallback(
    () =>
      update((card) =>
        card.players.length >= MAX_PLAYERS
          ? card
          : {
              ...card,
              players: [
                ...card.players,
                { name: `Player ${card.players.length + 1}`, scores: blankScores() },
              ],
            }
      ),
    [update]
  );

  /** The first row is the account holder's own and stays. */
  const removePlayer = useCallback(
    (player: number) =>
      update((card) =>
        player === 0
          ? card
          : { ...card, players: card.players.filter((_, i) => i !== player) }
      ),
    [update]
  );

  const setTee = useCallback(
    (teeSet: TeeSet) => {
      const current = useAppStore.getState().scorecard;
      if (!current || current.teeSet === teeSet) return;
      return update((card) => ({ ...card, teeSet }));
    },
    [update]
  );

  /**
   * Cards with at least one score, newest day first: this account's, and any
   * written while signed out. Another account's cards on a shared phone stay
   * out of sight.
   */
  const listHistory = useCallback(async (): Promise<Scorecard[]> => {
    const accountId = useAppStore.getState().account?.id ?? null;
    let read: PromiseLike<Scorecard[]> | undefined;
    try {
      read = db.scorecards.toArray();
      return (await withTimeout(read, STORAGE_WAIT_MS, 'storage'))
        .filter((c) => usable(c, accountId) && hasAnyScore(c))
        .sort(
          (a, b) =>
            b.playedOn.localeCompare(a.playedOn) || b.updatedAt.localeCompare(a.updatedAt)
        );
    } catch (err) {
      if (err instanceof TimeoutError && read) storageDidNotAnswer(read);
      return [];
    }
  }, []);

  return {
    scorecard,
    holeCount: HOLE_COUNT,
    openToday,
    openCard,
    startNewCard,
    setHoleScore,
    renamePlayer,
    addPlayer,
    removePlayer,
    setTee,
    listHistory,
  };
};
