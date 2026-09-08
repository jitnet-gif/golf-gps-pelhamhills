import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Headphones, Loader2 } from 'lucide-react';
import {
  allNarrationUrls,
  NARRATION_AUDIO_TOTAL_BYTES,
  NARRATION_CACHE_NAME,
} from '@/data/narrationAudio';
import { useAppStore } from '@/store/appStore';

/**
 * Pulls the recorded hole narration down before the round.
 *
 * Kept apart from OfflineCourse rather than folded into it: tiles are counted
 * from a bounding box and stored under their own cache with its own eviction
 * budget, and merging the two progress bars would mean one failure mode
 * reporting for both. A player who only wants the map should be able to skip
 * ~5 MB of audio, and a player on the range with the map already saved should
 * be able to fetch just the voice.
 *
 * The clips also arrive on their own through the service worker's CacheFirst
 * rule the first time a hole is played with signal; this button is the same
 * bargain as the map one, for the car park rather than the 7th tee.
 */

type Status = 'checking' | 'idle' | 'downloading' | 'ready' | 'partial' | 'error';

interface Progress {
  done: number;
  total: number;
  failed: number;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * The service worker is what stores the clips, so a download is pointless until
 * it controls the page - the same check OfflineCourse makes, and for the same
 * first-visit window.
 */
const serviceWorkerReady = async (): Promise<boolean> => {
  if (!('serviceWorker' in navigator)) return false;
  try {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    return false;
  }
  return navigator.serviceWorker.controller != null;
};

/** How many of the manifest's clips are actually in the cache right now. */
const countCached = async (urls: string[]): Promise<number> => {
  if (!('caches' in window)) return 0;
  try {
    const cache = await caches.open(NARRATION_CACHE_NAME);
    const present = await Promise.all(
      urls.map((url) => cache.match(url).then((hit) => (hit ? 1 : 0)))
    );
    return present.reduce<number>((sum, hit) => sum + hit, 0);
  } catch {
    return 0;
  }
};

export const OfflineNarration: React.FC = () => {
  const isOnline = useAppStore((s) => s.isOnline);

  const [status, setStatus] = useState<Status>('checking');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The manifest is a build-time constant, so the URL list never changes at
  // runtime - read it once rather than on every render.
  const urlsRef = useRef<string[]>(allNarrationUrls());
  const total = urlsRef.current.length;

  useEffect(() => {
    let alive = true;

    (async () => {
      if (total === 0) {
        if (alive) setStatus('idle');
        return;
      }
      const cached = await countCached(urlsRef.current);
      if (!alive) return;
      setProgress({ done: cached, total, failed: 0 });
      if (cached === 0) setStatus('idle');
      else setStatus(cached === total ? 'ready' : 'partial');
    })();

    return () => {
      alive = false;
    };
  }, [total]);

  const download = useCallback(async () => {
    if (!(await serviceWorkerReady())) {
      setStatus('error');
      setMessage('Reload the app once, then try again - the offline worker is not running yet.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setMessage(null);
    setProgress({ done: 0, total, failed: 0 });
    setStatus('downloading');

    let done = 0;
    let failed = 0;

    // Four at a time: enough to saturate a car-park connection without
    // starving whatever else the page is doing. The service worker's
    // CacheFirst route is what actually stores each response - we only have to
    // ask for it once.
    const queue = [...urlsRef.current];
    const worker = async () => {
      for (let url = queue.shift(); url; url = queue.shift()) {
        if (controller.signal.aborted) return;
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) throw new Error(String(response.status));
          done += 1;
        } catch (error) {
          if ((error as DOMException)?.name === 'AbortError') return;
          failed += 1;
        }
        setProgress({ done, total, failed });
      }
    };

    await Promise.all(Array.from({ length: 4 }, worker));
    abortRef.current = null;

    if (controller.signal.aborted) {
      const cached = await countCached(urlsRef.current);
      setProgress({ done: cached, total, failed: 0 });
      setStatus(cached > 0 ? 'partial' : 'idle');
      setMessage('Download stopped.');
      return;
    }

    setStatus(failed > 0 ? 'partial' : 'ready');
    if (failed > 0) {
      setMessage(
        `${failed} of ${total} clips did not download. The rest are saved; run it again on a better connection.`
      );
    }
  }, [total]);

  const cancel = () => abortRef.current?.abort();

  // Nothing has been generated yet - say so rather than offering a button that
  // downloads an empty list.
  if (total === 0) {
    return (
      <div>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Headphones className="w-4 h-4" />
          Offline narration
        </h2>
        <p className="text-xs text-muted-foreground">
          No recorded clips in this build. Holes are read by the browser voice, which
          needs no download.
        </p>
      </div>
    );
  }

  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Headphones className="w-4 h-4" />
        Offline narration
      </h2>

      {status === 'downloading' ? (
        <div className="space-y-2">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {progress?.done ?? 0} / {total} clips
            </span>
            <button
              onClick={cancel}
              className="px-2 py-1 rounded-md bg-muted hover:bg-accent font-medium"
            >
              Stop
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Keep this tab open. Closing the menu is fine.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            {status === 'ready' && (
              <span className="flex items-center gap-1.5 text-primary font-medium">
                <Check className="w-3.5 h-3.5" />
                All 18 holes saved for offline
              </span>
            )}
            {status === 'partial' && (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                Incomplete - {progress?.done ?? 0} of {total} clips
              </span>
            )}
            {status === 'error' && (
              <span className="flex items-center gap-1.5 text-destructive font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                Download failed
              </span>
            )}
            {(status === 'idle' || status === 'checking') && (
              <span className="text-muted-foreground">
                {total} clips · about {megabytes(NARRATION_AUDIO_TOTAL_BYTES)}
              </span>
            )}
          </div>

          <button
            onClick={download}
            disabled={status === 'checking' || !isOnline}
            className="w-full py-2 px-3 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Headphones className="w-4 h-4" />
            {status === 'ready' || status === 'partial'
              ? 'Download again'
              : 'Download hole narration'}
          </button>

          {!isOnline && (
            <p className="text-[10px] text-muted-foreground">
              Offline right now - reconnect to download. Holes still play in the browser
              voice.
            </p>
          )}

          {message && <p className="text-[10px] text-muted-foreground">{message}</p>}
        </div>
      )}
    </div>
  );
};
