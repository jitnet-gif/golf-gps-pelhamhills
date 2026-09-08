import { useCallback } from 'react';
import { db } from '@/db';
import {
  TILE_CACHE_NAME,
  TILE_MAX_ZOOM,
  TILE_MIN_ZOOM,
  tileUrl,
  type TileBounds,
} from '@/lib/tiles';

/**
 * Tile bookkeeping for offline play: which tiles a course needs, pulling them
 * down before the round, and checking they are still there afterwards.
 *
 * The URLs come from the same basemap the map renders (Esri World Imagery by
 * default) - an earlier version pointed at an R2 bucket nobody serves, so a
 * warmed cache would never have matched a tile Leaflet actually asked for.
 */
export interface UseMapTilesOptions {
  courseId: string;
  fallbackToCache?: boolean;
}

export interface TileProgress {
  done: number;
  total: number;
  failed: number;
}

export interface PrefetchOptions {
  minZoom?: number;
  maxZoom?: number;
  /** Parallel requests. Six is what a browser gives one host anyway. */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: TileProgress) => void;
}

export const useMapTiles = ({
  courseId,
  fallbackToCache = true,
}: UseMapTilesOptions) => {
  /**
   * The URL Leaflet requests for the given z/x/y - what to prefetch, and what
   * to look for in the cache.
   */
  const getTileUrl = useCallback(
    (z: number, x: number, y: number): string => tileUrl(z, x, y),
    []
  );

  /**
   * Check if tiles are cached locally for this course
   */
  const checkTilesInCache = useCallback(async (): Promise<boolean> => {
    if (!fallbackToCache) return false;

    try {
      const tileMeta = await db.tileMeta
        .where('courseId')
        .equals(courseId)
        .first();
      return !!tileMeta && tileMeta.tiles.length > 0;
    } catch {
      return false;
    }
  }, [courseId, fallbackToCache]);

  /**
   * Record which tiles were pulled down, and when.
   */
  const cacheTilesForCourse = useCallback(
    async (tileUrls: string[]): Promise<void> => {
      try {
        const existing = await db.tileMeta
          .where('courseId')
          .equals(courseId)
          .first();
        await db.tileMeta.put({
          ...(existing?.id != null ? { id: existing.id } : {}),
          courseId,
          tiles: tileUrls,
          lastUpdated: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Failed to cache tiles:', error);
      }
    },
    [courseId]
  );

  /**
   * Get cached tiles for a course
   */
  const getCachedTiles = useCallback(async (): Promise<string[]> => {
    try {
      const tileMeta = await db.tileMeta
        .where('courseId')
        .equals(courseId)
        .first();
      return tileMeta?.tiles ?? [];
    } catch {
      return [];
    }
  }, [courseId]);

  /** When the recorded download finished, if there is one. */
  const getLastDownloaded = useCallback(async (): Promise<string | null> => {
    try {
      const tileMeta = await db.tileMeta
        .where('courseId')
        .equals(courseId)
        .first();
      return tileMeta?.lastUpdated ?? null;
    } catch {
      return null;
    }
  }, [courseId]);

  /**
   * Calculate tile pyramid for a given bounding box
   * Returns array of {z, x, y} coordinates
   */
  const calculateTilePyramid = useCallback(
    (
      bounds: TileBounds,
      minZoom: number = TILE_MIN_ZOOM,
      maxZoom: number = TILE_MAX_ZOOM
    ): { z: number; x: number; y: number }[] => {
      const tiles: { z: number; x: number; y: number }[] = [];
      const { north, south, east, west } = bounds;
      if (![north, south, east, west].every(Number.isFinite)) return tiles;

      for (let z = minZoom; z <= maxZoom; z++) {
        // floor on both ends: these are tile indices, so the tile containing
        // the east edge is floor(x), not ceil(x) - ceil pulled in a spurious
        // extra row and column at every zoom.
        const xMin = Math.floor(long2tile(west, z));
        const xMax = Math.floor(long2tile(east, z));
        const yMin = Math.floor(lat2tile(north, z));
        const yMax = Math.floor(lat2tile(south, z));

        for (let x = xMin; x <= xMax; x++) {
          for (let y = yMin; y <= yMax; y++) {
            tiles.push({ z, x, y });
          }
        }
      }

      return tiles;
    },
    []
  );

  /** Every tile URL the course needs, shallowest zoom first. */
  const tileUrlsForBounds = useCallback(
    (bounds: TileBounds, minZoom?: number, maxZoom?: number): string[] =>
      calculateTilePyramid(bounds, minZoom, maxZoom).map((t) =>
        tileUrl(t.z, t.x, t.y)
      ),
    [calculateTilePyramid]
  );

  /**
   * Pull the whole course down so the map works with no signal.
   *
   * The requests go out as ordinary CORS fetches and the service worker's
   * CacheFirst route is what stores them - the same path Leaflet's
   * `<img crossorigin="anonymous">` takes, so the cached responses are ones the
   * map can actually paint. A `no-cors` fetch would cache opaque responses that
   * look present and render as blanks.
   */
  const prefetchTiles = useCallback(
    async (
      bounds: TileBounds,
      {
        minZoom = TILE_MIN_ZOOM,
        maxZoom = TILE_MAX_ZOOM,
        concurrency = 6,
        signal,
        onProgress,
      }: PrefetchOptions = {}
    ): Promise<TileProgress> => {
      const urls = tileUrlsForBounds(bounds, minZoom, maxZoom);
      const total = urls.length;
      let done = 0;
      let failed = 0;
      let next = 0;

      const worker = async () => {
        while (next < total) {
          if (signal?.aborted) return;
          const url = urls[next++];

          try {
            const res = await fetch(url, { signal });
            // Drain the body so the transfer - and the worker's cache write -
            // actually completes before the next tile starts.
            await res.blob();
            if (!res.ok) failed++;
          } catch {
            if (signal?.aborted) return;
            failed++;
          }

          done++;
          onProgress?.({ done, total, failed });
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, total) }, worker)
      );

      // Record every tile the course needs, not just the ones that succeeded -
      // verifyCachedTiles is what tells the user whether the set is complete.
      // Written on the way out of a cancelled run too, so a stopped download
      // reports the tiles it did manage rather than reading as untouched.
      await cacheTilesForCourse(urls);

      if (signal?.aborted) {
        throw new DOMException('Tile prefetch aborted', 'AbortError');
      }

      return { done, total, failed };
    },
    [tileUrlsForBounds, cacheTilesForCourse]
  );

  /**
   * How much of the recorded download is still in the cache. Entries expire and
   * the cache evicts, so a stored record is a claim, not proof.
   */
  const verifyCachedTiles = useCallback(async (): Promise<TileProgress> => {
    const urls = await getCachedTiles();
    const empty = { done: 0, total: urls.length, failed: 0 };
    if (urls.length === 0 || typeof caches === 'undefined') return empty;

    try {
      // One pass over the cache keys rather than a `match` per tile: hundreds
      // of matches on a menu toggle is a lot of work for a phone, and `match`
      // would also miss entries stored under a `Vary` header, under-reporting a
      // download that is in fact complete.
      const cache = await caches.open(TILE_CACHE_NAME);
      const stored = new Set((await cache.keys()).map((req) => req.url));
      const done = urls.reduce((n, url) => n + (stored.has(url) ? 1 : 0), 0);
      return { done, total: urls.length, failed: urls.length - done };
    } catch {
      return empty;
    }
  }, [getCachedTiles]);

  return {
    getTileUrl,
    checkTilesInCache,
    cacheTilesForCourse,
    getCachedTiles,
    getLastDownloaded,
    calculateTilePyramid,
    tileUrlsForBounds,
    prefetchTiles,
    verifyCachedTiles,
    courseId,
  };
};

// Helper functions to convert lat/lng to tile coordinates
function long2tile(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}

function lat2tile(lat: number, z: number): number {
  return (
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
      ) /
        Math.PI) /
      2) *
    Math.pow(2, z)
  );
}
