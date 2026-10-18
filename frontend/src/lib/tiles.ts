/**
 * The basemap the whole app shares: Esri World Imagery unless VITE_TILE_URL
 * overrides it.
 *
 * Two things about this URL shape bite if you forget them:
 * - Leaflet wants a {z}/{x}/{y} template, and Esri serves {z}/{y}/{x} - note
 *   the swapped order.
 * - Esri tiles carry no file extension (.../tile/18/96340/73326), so anything
 *   matching tiles by ".png" - a service worker cache rule, say - matches
 *   nothing at all.
 */
export const TILE_URL_TEMPLATE =
  import.meta.env.VITE_TILE_URL ||
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const TILE_ATTRIBUTION =
  'Imagery © Esri, Maxar, Earthstar Geographics';

/**
 * Deepest zoom the map will ask for. Held at 19 (~0.3 m/px, plenty for a hole)
 * so that everything a player can reach on screen is also everything the
 * offline download covers - z20 would quadruple the download to ~17 MB for
 * detail nobody reads off a fairway.
 */
export const TILE_MAX_ZOOM = 19;

/** Shallowest zoom worth storing: the whole course in one screen. */
export const TILE_MIN_ZOOM = 15;

/**
 * Runtime cache the service worker stores tiles in. Must stay in step with the
 * `cacheName` of the tile rule in vite.config.ts.
 */
export const TILE_CACHE_NAME = 'tile-cache';

/** Resolve the template for one tile - the URL Leaflet itself would request. */
export const tileUrl = (z: number, x: number, y: number): string =>
  TILE_URL_TEMPLATE.replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));

export interface TileBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Bounding box around a set of points, padded by `pad` degrees (0.0009 ~ 100 m)
 * so the download reaches a little past the outermost tee and pin.
 *
 * Non-finite coordinates are dropped rather than propagated: one null tee from
 * the API would otherwise turn every bound into NaN, and a NaN bound produces a
 * tile pyramid that is silently empty.
 */
export const boundsFor = (
  points: { lat: number; lng: number }[],
  pad = 0.0009
): TileBounds | null => {
  const lats = points.map((p) => p.lat).filter(Number.isFinite);
  const lngs = points.map((p) => p.lng).filter(Number.isFinite);
  if (lats.length === 0 || lngs.length === 0) return null;

  return {
    north: Math.max(...lats) + pad,
    south: Math.min(...lats) - pad,
    east: Math.max(...lngs) + pad,
    west: Math.min(...lngs) - pad,
  };
};
