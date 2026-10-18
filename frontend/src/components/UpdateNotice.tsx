import React, { useState } from 'react';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { useAppUpdate } from '@/hooks';

/**
 * The only part of an update a player ever sees.
 *
 * Checking and downloading are silent by design - a new version is the app's
 * business, not the player's, and on most screens it simply goes in
 * (useAppUpdate). This strip exists for the screens where it cannot: mid-round,
 * at the counter, or in the middle of surveying a pin, where a reload would
 * cost something. There it offers the tap and otherwise stays out of the way.
 *
 * Sits above the map but below the score keypad and the modals, and can be
 * waved off: an update that waits is not worth covering the 7th green for.
 */
export const UpdateNotice: React.FC = () => {
  const { status, canApplyNow, apply } = useAppUpdate();
  const [dismissed, setDismissed] = useState(false);

  const applying = status === 'applying';
  const waiting = status === 'ready' && !canApplyNow && !dismissed;

  if (!applying && !waiting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[max(5rem,calc(env(safe-area-inset-bottom)+4.5rem))] z-[1140] flex justify-center px-3"
    >
      <div className="pointer-events-auto flex max-w-md items-center gap-2 rounded-full border border-border bg-card/95 py-2 pl-3 pr-2 text-sm shadow-lg backdrop-blur">
        {applying ? (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            <span className="font-medium">Updating the app…</span>
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
            {/* At 390px the pill is 358px wide and the row - icon, label,
                button, dismiss - fills it exactly, so the second half of the
                label only appears where there is room for it. */}
            <span className="min-w-0 truncate">
              <span className="font-medium">New version ready</span>
              <span className="hidden text-muted-foreground sm:inline"> · downloaded</span>
            </span>
            <button
              type="button"
              onClick={apply}
              className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
            >
              Update
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Not now"
              className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
