import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, DownloadCloud, Loader2 } from 'lucide-react';
import { useMapTiles, type TileProgress } from '@/hooks';
import { boundsFor, TILE_MAX_ZOOM, TILE_MIN_ZOOM } from '@/lib/tiles';
import { useAppStore } from '@/store/appStore';
import type { Hole } from '@/data/pelhamHills';

interface OfflineCourseProps {
  courseId: string;
  holes: Hole[];
}

type Status =
  | 'checking'
  | 'idle'
  | 'downloading'
  | 'ready'
  | 'partial'
  | 'error';

/** Measured Esri World Imagery tiles over this course run 4-14 KB. */
const AVG_TILE_BYTES = 10 * 1024;

const megabytes = (tiles: number) =>
  `${((tiles * AVG_TILE_BYTES) / 1024 / 1024).toFixed(1)} MB`;

/**
 * The service worker is what actually stores tiles, so a download is pointless
 * until it controls the page. On a first visit there is a window where it does
 * not yet - hence the check at click time rather than on mount.
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

/**
 * Pulls the whole course basemap down before the round.
 *
 * A round is four hours in a place where signal comes and goes, so the useful
 * moment for this is in the car park, not on the 7th tee.
 */
export const OfflineCourse: React.FC<OfflineCourseProps> = ({
  courseId,
  holes,
}) => {
  const isOnline = useAppStore((s) => s.isOnline);
  const { tileUrlsForBounds, prefetchTiles, verifyCachedTiles, getLastDownloaded } =
    useMapTiles({ courseId });

  const [status, setStatus] = useState<Status>('checking');
  const [progress, setProgress] = useState<TileProgress | null>(null);
  const [lastDownloaded, setLastDownloaded] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const bounds = useMemo(
    () =>
      boundsFor(
        holes.flatMap((h) => [
          { lat: h.latitude, lng: h.longitude },
          { lat: h.teeLatitude, lng: h.teeLongitude },
        ])
      ),
    [holes]
  );

  const total = useMemo(
    () => (bounds ? tileUrlsForBounds(bounds).length : 0),
    [bounds, tileUrlsForBounds]
  );

  // What is already on the device? A stored record is a claim - the cache
  // expires and evicts - so count what is actually still there.
  useEffect(() => {
    let alive = true;

    (async () => {
      const [verified, when] = await Promise.all([
        verifyCachedTiles(),
        getLastDownloaded(),
      ]);
      if (!alive) return;

      setLastDownloaded(when);
      if (verified.total === 0) {
        setStatus('idle');
        return;
      }
      setProgress(verified);
      setStatus(verified.done === verified.total ? 'ready' : 'partial');
    })();

    return () => {
      alive = false;
    };
  }, [verifyCachedTiles, getLastDownloaded]);

  const download = useCallback(async () => {
    if (!bounds) {
      setStatus('error');
      setMessage('This course has no usable hole coordinates.');
      return;
    }

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

    try {
      const result = await prefetchTiles(bounds, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      setProgress(result);
      setLastDownloaded(new Date().toISOString());
      setStatus(result.failed > 0 ? 'partial' : 'ready');
      if (result.failed > 0) {
        setMessage(
          `${result.failed} of ${result.total} tiles did not download. Run it again on a better connection.`
        );
      }
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') {
        const verified = await verifyCachedTiles();
        setProgress(verified);
        setStatus(verified.done > 0 ? 'partial' : 'idle');
        setMessage('Download stopped.');
      } else {
        setStatus('error');
        setMessage('Download failed. Check the connection and try again.');
      }
    } finally {
      abortRef.current = null;
    }
  }, [bounds, total, prefetchTiles, verifyCachedTiles]);

  const cancel = () => abortRef.current?.abort();

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <DownloadCloud className="w-4 h-4" />
        Offline map
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
              {progress?.done ?? 0} / {progress?.total ?? total} tiles
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
                Course saved for offline
              </span>
            )}
            {status === 'partial' && (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                Incomplete - {progress?.done ?? 0} of {progress?.total ?? total}{' '}
                tiles
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
                {total} tiles · about {megabytes(total)} · zoom {TILE_MIN_ZOOM}-
                {TILE_MAX_ZOOM}
              </span>
            )}
          </div>

          <button
            onClick={download}
            disabled={status === 'checking' || !isOnline || total === 0}
            className="w-full py-2 px-3 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <DownloadCloud className="w-4 h-4" />
            {status === 'ready' || status === 'partial'
              ? 'Download again'
              : 'Download course map'}
          </button>

          {!isOnline && (
            <p className="text-[10px] text-muted-foreground">
              Offline right now - reconnect to download.
            </p>
          )}

          {lastDownloaded && status !== 'error' && (
            <p className="text-[10px] text-muted-foreground">
              Last downloaded {new Date(lastDownloaded).toLocaleDateString()}
            </p>
          )}

          {message && (
            <p className="text-[10px] text-muted-foreground">{message}</p>
          )}
        </div>
      )}
    </div>
  );
};
