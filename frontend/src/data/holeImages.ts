/**
 * Pictures of each hole, cut from the club's printed yardage book - the same
 * book pelhamHillsBook.ts transcribes, so the drawing a player sees matches the
 * card in their pocket. scripts/crop-yardage-book.py makes them from the scans
 * and says which scan is which hole.
 *
 * Two per hole: the illustrated layout (tees, hazards, yardage markers, green
 * inset), which is portrait and suits the narrow column beside the map, and the
 * aerial photo from the top of the facing page, which is a wide strip.
 *
 * They are served from public/ and cached by the service worker once seen, not
 * precached - a first visit should not spend 1.8 MB before the player has asked
 * for anything. OfflineCourse fetches them with the map, so a course downloaded
 * before a round has them too.
 */

/** Pixel size of every layout drawing, for holding its space before it loads. */
export const HOLE_LAYOUT_SIZE = { width: 540, height: 989 } as const;

/** Pixel size of every aerial photo strip. */
export const HOLE_PHOTO_SIZE = { width: 960, height: 341 } as const;

export interface HolePictureSet {
  layout: string;
  photo: string;
}

const HOLES_WITH_PICTURES = 18;

export const holePictures = (holeNumber: number): HolePictureSet | null =>
  Number.isInteger(holeNumber) && holeNumber >= 1 && holeNumber <= HOLES_WITH_PICTURES
    ? {
        layout: `/holes/hole-${holeNumber}-layout.webp`,
        photo: `/holes/hole-${holeNumber}-photo.webp`,
      }
    : null;

/** Every picture, for downloading the course before a round. */
export const ALL_HOLE_PICTURE_URLS: string[] = Array.from(
  { length: HOLES_WITH_PICTURES },
  (_, i) => holePictures(i + 1)!
).flatMap((set) => [set.layout, set.photo]);
