import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { startAuth } from '@/lib/auth';
import { syncNow } from '@/lib/scorecardSync';
import type { TeeSet } from '@/data/pelhamHillsBook';
import { useScorecard } from './useScorecard';

/**
 * Keeps today's card and the account in step, and uploads when there is a
 * reason to: signing in, coming back online, coming back to the app. Edits
 * schedule their own upload (useScorecard).
 *
 * Mounted once, by the golf page.
 */
export const useScorecardSync = (courseId: string, teeSet: TeeSet) => {
  const accountReady = useAppStore((s) => s.accountReady);
  const accountId = useAppStore((s) => s.account?.id ?? null);
  const isOnline = useAppStore((s) => s.isOnline);
  const { openToday } = useScorecard();

  useEffect(() => {
    startAuth();
  }, []);

  // Signing in can bring today's card from another phone, and signing out must
  // take the account's card off the screen - so the card is chosen again on
  // either side of the upload.
  useEffect(() => {
    if (!accountReady) return;
    let alive = true;
    (async () => {
      await openToday(courseId, teeSet);
      await syncNow();
      if (alive) await openToday(courseId, teeSet);
    })();
    return () => {
      alive = false;
    };
    // The tee only seeds a brand-new card; changing it is not a reason to sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountReady, accountId, courseId, openToday]);

  useEffect(() => {
    if (isOnline && accountReady) void syncNow();
  }, [isOnline, accountReady]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
};
