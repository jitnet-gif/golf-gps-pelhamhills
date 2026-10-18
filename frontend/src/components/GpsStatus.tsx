import React, { useState } from 'react';
import { ExternalLink, LocateFixed, LocateOff, RotateCcw, X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

/** KakaoTalk's in-app browser - it blocks location unless the page leaves it. */
const inKakaoTalk = () => typeof navigator !== 'undefined' && /KAKAOTALK/i.test(navigator.userAgent);

/** KakaoTalk's own way out: opens the page in the phone's default browser. */
const kakaoExternal = () =>
  `kakaotalk://web/openExternal?url=${encodeURIComponent(window.location.href)}`;

interface GpsStatusProps {
  /** Start looking again - useGPS.startTracking. */
  onRetry: () => void;
  /**
   * The player's GPS switch (components/GpsToggle). False is not a fault: the
   * pill has to say so, or a switched-off phone shows "Finding GPS" for four
   * hours - gpsPosition and gpsProblem are both null in that state.
   */
  enabled?: boolean;
  /** Turn it back on from the pill, without going through the side menu. */
  onEnable?: () => void;
}

/**
 * The GPS pill beside Online and Synced: the fix and its accuracy, or - when
 * there is none - why, as a button that opens what to do about it.
 *
 * Before this, a phone whose browser blocked location, or that had no fix,
 * showed "Finding you..." for ever and nothing else; the club could not tell
 * a blocked permission from a bad signal.
 */
export const GpsStatus: React.FC<GpsStatusProps> = ({ onRetry, enabled = true, onEnable }) => {
  const fix = useAppStore((s) => s.gpsPosition);
  const problem = useAppStore((s) => s.gpsProblem);
  const [open, setOpen] = useState(false);

  const pill = 'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap';

  // Off by choice. Shown plainly, and tapping it is the quickest way back -
  // the switch in the side menu is three taps away.
  if (!enabled) {
    return (
      <button
        type="button"
        onClick={onEnable}
        disabled={!onEnable}
        aria-label="Turn GPS on"
        className={`${pill} bg-muted text-muted-foreground`}
      >
        <LocateOff className="w-3.5 h-3.5" />
        GPS off
      </button>
    );
  }

  if (!problem) {
    return fix ? (
      <div className={`${pill} bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300`}>
        <LocateFixed className="w-3.5 h-3.5" />
        GPS ±{Math.round(fix.accuracy)} m
      </div>
    ) : (
      <div className={`${pill} bg-muted text-muted-foreground`}>
        <LocateFixed className="w-3.5 h-3.5 animate-pulse" />
        Finding GPS
      </div>
    );
  }

  const label = problem === 'denied' ? 'Location off' : 'No GPS';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`${pill} ${
          problem === 'denied'
            ? 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300'
            : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
        }`}
      >
        <LocateOff className="w-3.5 h-3.5" />
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/50 p-3 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Location help"
            className="w-full max-w-md rounded-xl border border-border bg-card p-4 text-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold">
                {problem === 'denied'
                  ? 'Location is off for this site'
                  : problem === 'unavailable'
                    ? 'No GPS signal yet'
                    : 'This browser cannot share your location'}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1 hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {problem === 'denied' && (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Tap the lock or ⓘ beside the web address.</li>
                <li>
                  Open <b>Permissions</b> → <b>Location</b> → <b>Allow</b>.
                </li>
                <li>Come back here and tap Try again.</li>
                <li>
                  iPhone: Settings → Privacy &amp; Security → Location Services → Safari Websites →{' '}
                  <b>While Using the App</b>.
                </li>
              </ol>
            )}
            {problem === 'unavailable' && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  Check that <b>Location</b> is on for the phone, with <b>precise</b> (high accuracy)
                  location for the browser.
                </li>
                <li>Step out from under roofs and trees - GPS needs open sky.</li>
                <li>It keeps trying by itself; Try again starts over.</li>
              </ul>
            )}

            {(inKakaoTalk() || problem === 'unsupported') && (
              <p className="mt-3 text-muted-foreground">
                KakaoTalk&apos;s browser often blocks location. Open this page in Chrome or Safari:
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {problem !== 'unsupported' && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  <RotateCcw className="h-4 w-4" />
                  Try again
                </button>
              )}
              {inKakaoTalk() && (
                <a
                  href={kakaoExternal()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open in browser
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
