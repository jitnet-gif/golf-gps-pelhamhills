import { useCallback, useMemo } from 'react';
import { db } from '@/db';

/**
 * Generates R2 tile URLs for Cloudflare R2 bucket.
 * Falls back to offline cache when available.
 *
 * Tile URL format: https://<bucket-endpoint>/tiles/<courseId>/<z>/<x>/<y>.png
 */
export interface UseMapTilesOptions {
  courseId: string;
  r2BucketUrl?: string;
  fallbackToCache?: boolean;
}

export const useMapTiles = ({
  courseId,
  r2BucketUrl = import.meta.env.VITE_R2_BUCKET_URL || '',
  fallbackToCache = true,
}: UseMapTilesOptions) => {
  /**
   * Generate tile URL for the given z/x/y coordinates
   * Returns R2 URL or cached tile path
   */
  const getTileUrl = useCallback(
    (z: number, x: number, y: number): string => {
      return `${r2BucketUrl}/tiles/${courseId}/${z}/${x}/${y}.png`;
    },
    [courseId, r2BucketUrl]
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
   * Cache tiles for offline access
   */
  const cacheTilesForCourse = useCallback(
    async (tileUrls: string[]): Promise<void> => {
      try {
        await db.tileMeta.put({
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

  /**
   * Calculate tile pyramid for a given bounding box
   * Returns array of {z, x, y} coordinates
   */
  const calculateTilePyramid = useCallback(
    (
      bounds: {
        north: number;
        south: number;
        east: number;
        west: number;
      },
      minZoom: number = 16,
      maxZoom: number = 18
    ): { z: number; x: number; y: number }[] => {
      const tiles: { z: number; x: number; y: number }[] = [];

      for (let z = minZoom; z <= maxZoom; z++) {
        const { north, south, east, west } = bounds;
        const xMin = long2tile(west, z);
        const xMax = long2tile(east, z);
        const yMin = lat2tile(north, z);
        const yMax = lat2tile(south, z);

        for (let x = Math.floor(xMin); x <= Math.ceil(xMax); x++) {
          for (let y = Math.floor(yMin); y <= Math.ceil(yMax); y++) {
            tiles.push({ z, x, y });
          }
        }
      }

      return tiles;
    },
    []
  );

  return {
    getTileUrl,
    checkTilesInCache,
    cacheTilesForCourse,
    getCachedTiles,
    calculateTilePyramid,
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
