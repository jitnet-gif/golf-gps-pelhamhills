import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

/**
 * Shown on the card while the phone's storage is not answering (useScorecard
 * gave up waiting). The card still works; what the player needs to know is
 * that it is not being kept yet, and the one thing that usually frees it.
 */
export const StorageNotice: React.FC = () => {
  const stuck = useAppStore((s) => s.storageStuck);
  if (!stuck) return null;
  return (
    <div
      role="status"
      className="flex gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-2.5 text-xs leading-snug"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p>
        <span className="font-semibold">Scores are on this screen only for now</span> - the
        phone&apos;s storage is not answering. Another tab of this app is usually holding it:
        close the app&apos;s other tabs, or restart the browser. This card is kept as soon as
        the storage answers.
      </p>
    </div>
  );
};
