import React from 'react';
import { useAppStore } from '@/store/appStore';
import { Cloud, CloudOff, AlertCircle } from 'lucide-react';

// Same compact pill as OnlineStatus. whitespace-nowrap keeps "3 pending" on one
// line - it used to wrap into two and make the whole header taller.
const PILL = 'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap';

/**
 * Whether the scorecards have reached the account. Signed out there is no
 * account to reach, so there is nothing to report - the card itself says
 * the scores are kept on the phone.
 */
export const SyncStatus: React.FC = () => {
  const account = useAppStore((s) => s.account);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const pendingCount = useAppStore((s) => s.syncPending);

  if (!account) return null;

  if (syncStatus === 'syncing') {
    return (
      <div className={`${PILL} text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950`}>
        <Cloud className="w-3.5 h-3.5 animate-pulse" />
        Syncing...
      </div>
    );
  }

  if (syncStatus === 'error') {
    return (
      <div className={`${PILL} text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950`}>
        <AlertCircle className="w-3.5 h-3.5" />
        Sync failed
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className={`${PILL} text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-950`}>
        <CloudOff className="w-3.5 h-3.5" />
        {pendingCount} pending
      </div>
    );
  }

  return (
    <div className={`${PILL} text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950`}>
      <Cloud className="w-3.5 h-3.5" />
      Synced
    </div>
  );
};
