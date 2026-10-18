import { bookHole, PELHAM_HILLS_TEES, type TeeSet } from '@/data/pelhamHillsBook';

/**
 * The words a player hears on the tee, and the words printed under the play
 * button. One module, because they must never differ.
 *
 * This lives apart from the component because `scripts/generate-narration.mjs`
 * imports it too: the ElevenLabs clips are cut from exactly this text, and the
 * manifest stores a hash of it. Edit a hole in pelhamHillsBook.ts and the hash
 * moves, which is how the generator knows a recorded clip has gone stale.
 */

export interface HoleScriptParts {
  /** Card figures - different for every tee, so 108 of these exist. */
  card: string;
  /** The club's commentary - the same for all six tees, so 18 of these exist. */
  description: string;
}

/**
 * The script as its two paragraphs.
 *
 * Split at the source rather than by the caller slicing on '\n\n', because the
 * generator bills per character: the commentary is identical across all six
 * tees, and cutting it once per hole instead of once per tee is the difference
 * between 14k and 37k characters for the same spoken words.
 *
 * Returns null for a hole the book does not cover - nothing is invented to fill
 * a gap.
 */
export function buildHoleScriptParts(
  holeNumber: number,
  teeSet: TeeSet
): HoleScriptParts | null {
  const hole = bookHole(holeNumber);
  if (!hole) return null;

  // The book's own column name for the tee, slash and all.
  const teeLabel = PELHAM_HILLS_TEES.find((tee) => tee.id === teeSet)?.label;
  const yardage = hole.yards[teeSet];

  return {
    card: [
      `Hole ${hole.holeNumber}. Par ${hole.par}, stroke index ${hole.handicap}.`,
      teeLabel
        ? `${yardage} yards from the ${teeLabel} tee.`
        : `${yardage} yards from the tee.`,
      `The green is ${hole.greenDepth} yards deep.`,
    ].join(' '),
    description: hole.description,
  };
}

/**
 * The whole spoken script for one hole: card figures, then the club's own words.
 *
 * The blank line separates the two paragraphs on screen; the browser TTS chunker
 * swallows it and the recorded clips are played back to back across it, so what
 * is spoken is exactly what is printed.
 *
 * Returns '' for a hole the book does not cover.
 */
export function buildHoleScript(holeNumber: number, teeSet: TeeSet): string {
  const parts = buildHoleScriptParts(holeNumber, teeSet);
  return parts ? `${parts.card}\n\n${parts.description}` : '';
}

/**
 * Filenames for the two clips a hole is read from.
 *
 * The tee is in the card's name and absent from the description's - that is the
 * whole point of the split, and it is why these ids are built here rather than
 * assembled by hand at each call site.
 *
 * Cache-busting is not by query string: a service worker rule matching on path
 * would serve yesterday's audio for a hole whose commentary was rewritten, so a
 * changed script is caught by the manifest hash instead (see narrationAudio.ts).
 */
export const narrationCardId = (holeNumber: number, teeSet: TeeSet): string =>
  `hole-${holeNumber}-${teeSet}-card`;

export const narrationDescriptionId = (holeNumber: number): string =>
  `hole-${holeNumber}-desc`;
