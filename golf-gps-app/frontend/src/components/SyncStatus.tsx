import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useScorecard } from '@/hooks';
import { Cloud, CloudOff, AlertCircle } from 'lucide-react';

export const SyncStatus: React.FC = () => {
  const { syncStatus } = useAppStore();
  const { getPendingSyncs } = useScorecard();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const checkPending = async () => {
      const pending = await getPendingSyncs();
      setPendingCount(pending.length);
    };

    checkPending();
    const interval = setInterval(checkPending, 5000);

    return () => clearInterval(interval);
  }, [getPendingSyncs]);

  if (syncStatus === 'idle' && pendingCount === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950">
        <Cloud className="w-4 h-4" />
        Synced
      </div>
    );
  }

  if (syncStatus === 'syncing') {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950">
        <Cloud className="w-4 h-4 animate-pulse" />
        Syncing...
      </div>
    );
  }

  if (syncStatus === 'error') {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950">
        <AlertCircle className="w-4 h-4" />
        Sync failed
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-950">
        <CloudOff className="w-4 h-4" />
        {pendingCount} pending
      </div>
    );
  }

  return null;
};
