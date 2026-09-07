import { useCallback, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { db, type Round, type Score, type SyncQueueItem } from '@/db';

export const useScorecard = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    currentRound,
    scores,
    setCurrentRound,
    setScore,
    setSyncStatus,
  } = useAppStore();

  /**
   * Create a new round
   */
  const createRound = useCallback(
    async (courseId: string, holes: number = 18): Promise<Round | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const newRound: Round = {
          id: `${courseId}-${Date.now()}`,
          courseId,
          date: new Date().toISOString(),
          holes: Array.from({ length: holes }, (_, i) => ({
            holeNumber: i + 1,
          })),
        };

        await db.rounds.add(newRound);

        // Add to sync queue
        await db.syncQueue.add({
          type: 'round',
          payload: newRound,
          timestamp: new Date().toISOString(),
          attempts: 0,
        });

        setCurrentRound(newRound);
        return newRound;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create round';
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [setCurrentRound]
  );

  /**
   * Load an existing round
   */
  const loadRound = useCallback(async (roundId: string): Promise<Round | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const round = await db.rounds.get(roundId);
      if (!round) {
        setError('Round not found');
        return null;
      }

      // Load scores for this round
      const roundScores = await db.scores
        .where('roundId')
        .equals(roundId)
        .toArray();

      // Populate store with scores
      roundScores.forEach((score) => {
        setScore(score.hole, score.score);
      });

      setCurrentRound(round);
      return round;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load round';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [setCurrentRound, setScore]);

  /**
   * Save score for a hole
   */
  const saveScore = useCallback(
    async (holeNumber: number, score: number): Promise<boolean> => {
      if (!currentRound) {
        setError('No active round');
        return false;
      }

      try {
        // Save to store immediately for UI responsiveness
        setScore(holeNumber, score);

        // Save to database
        const scoreRecord: Score = {
          roundId: currentRound.id,
          hole: holeNumber,
          score,
          timestamp: new Date().toISOString(),
        };

        await db.scores.add(scoreRecord);

        // Add to sync queue
        await db.syncQueue.add({
          type: 'score',
          payload: scoreRecord,
          timestamp: new Date().toISOString(),
          attempts: 0,
        });

        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save score';
        setError(message);
        return false;
      }
    },
    [currentRound, setScore]
  );

  /**
   * Get all rounds for a course
   */
  const getRoundsForCourse = useCallback(
    async (courseId: string): Promise<Round[]> => {
      try {
        return await db.rounds
          .where('courseId')
          .equals(courseId)
          .toArray();
      } catch (err) {
        console.error('Failed to get rounds:', err);
        return [];
      }
    },
    []
  );

  /**
   * Get all pending syncs
   */
  const getPendingSyncs = useCallback(
    async (): Promise<SyncQueueItem[]> => {
      try {
        return await db.syncQueue.toArray();
      } catch (err) {
        console.error('Failed to get sync queue:', err);
        return [];
      }
    },
    []
  );

  /**
   * Mark sync as completed
   */
  const completedSync = useCallback(async (id: number): Promise<boolean> => {
    try {
      await db.syncQueue.delete(id);
      return true;
    } catch (err) {
      console.error('Failed to mark sync as complete:', err);
      return false;
    }
  }, []);

  /**
   * Increment retry count for sync
   */
  const incrementSyncRetry = useCallback(
    async (id: number, maxRetries: number = 3): Promise<boolean> => {
      try {
        const item = await db.syncQueue.get(id);
        if (!item) return false;

        if (item.attempts >= maxRetries) {
          await db.syncQueue.delete(id);
          return false; // Max retries exceeded, delete item
        }

        await db.syncQueue.update(id, {
          attempts: item.attempts + 1,
        });
        return true;
      } catch (err) {
        console.error('Failed to increment sync retry:', err);
        return false;
      }
    },
    []
  );

  /**
   * Delete a round
   */
  const deleteRound = useCallback(async (roundId: string): Promise<boolean> => {
    try {
      // Delete scores
      await db.scores.where('roundId').equals(roundId).delete();

      // Delete round
      await db.rounds.delete(roundId);

      if (currentRound?.id === roundId) {
        setCurrentRound(null);
      }

      return true;
    } catch (err) {
      console.error('Failed to delete round:', err);
      return false;
    }
  }, [currentRound?.id, setCurrentRound]);

  return {
    // State
    currentRound,
    scores,
    isLoading,
    error,

    // Round management
    createRound,
    loadRound,
    deleteRound,
    getRoundsForCourse,

    // Score management
    saveScore,

    // Sync management
    getPendingSyncs,
    completedSync,
    incrementSyncRetry,
  };
};
