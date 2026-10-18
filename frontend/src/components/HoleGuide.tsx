import React from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Volume2, VolumeX } from 'lucide-react';
import { bookHole, PELHAM_HILLS_TEES, type TeeSet } from '@/data/pelhamHillsBook';
import { HolePictures } from './HolePictures';

interface HoleGuideProps {
  holeNumber: number;
  holeCount: number;
  /** Which scorecard column the yardage is quoted from. */
  teeSet: TeeSet;
  /** Whether the map is tracking the player rather than holding this hole. */
  followGps: boolean;
  onSelectHole: (holeNumber: number) => void;
  onToggleFollow: () => void;
  /** Automatic narration (read on arrival at the tee) rather than manual. */
  autoNarration: boolean;
  /**
   * Called from the tap itself. Choosing automatic has to spend that tap on the
   * audio unlock - see AutoNarration - so the caller must not defer it.
   */
  onChooseNarration: (auto: boolean) => void;
  /**
   * The pin distance from where the player stands, above the pictures: it is the
   * figure a player looks for first, and on a phone held sideways the pictures
   * alone fill the screen - see FairwayDistance.
   */
  lead?: React.ReactNode;
  /** The green's readout, placed under the pictures - see GreenDistances. */
  children?: React.ReactNode;
  /** The hole's name and previous/next are on the hole bar instead (HoleSheet). */
  hideTitle?: boolean;
}

/**
 * The column beside the satellite map: which hole you are on, how it scores, how
 * long it plays from the tee you picked, and the hole as the yardage book draws
 * it.
 *
 * It is a narrow column on purpose. The map is the thing a player reads on a
 * phone, and it keeps two thirds of the width and the full height; everything
 * here is laid out for about 130 px - one chip per line, labels that wrap.
 *
 * Par, stroke index and yardage come from the club's printed book, never from
 * the coordinate data - OpenStreetMap's tags for this course disagree with the
 * club's own card on 8 of 18 pars and on every handicap, and the panel a player
 * glances at while standing on the tee has to match the card in their pocket.
 *
 * The live distance readout deliberately lives in GreenDistances instead, which
 * checks whether the hole's pin has actually been surveyed. This column only
 * places it (as children); it must not grow one of its own.
 *
 * The narration switch sits here as well as in the side menu because the menu is
 * closed for most of a round, and auto versus manual is a choice players make on
 * the first tee, not one they go looking for.
 */
export const HoleGuide: React.FC<HoleGuideProps> = ({
  holeNumber,
  holeCount,
  teeSet,
  followGps,
  onSelectHole,
  onToggleFollow,
  autoNarration,
  onChooseNarration,
  lead,
  children,
  hideTitle = false,
}) => {
  const hole = bookHole(holeNumber);
  const prev = holeNumber > 1 ? holeNumber - 1 : null;
  const next = holeNumber < holeCount ? holeNumber + 1 : null;
  const teeLabel =
    PELHAM_HILLS_TEES.find((t) => t.id === teeSet)?.label ?? teeSet;

  const toggleClass = (on: boolean) =>
    `flex items-start gap-1.5 text-left text-xs leading-tight ${
      on ? 'text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
    }`;

  const stepClass =
    'p-1 rounded-md bg-muted hover:bg-accent disabled:opacity-30 disabled:hover:bg-muted shrink-0';

  return (
    <div className="px-2.5 py-2.5 space-y-2.5">
      {!hideTitle && (
      <div className="text-center">
        <span className="text-xl font-bold leading-tight">Hole {holeNumber}</span>
        <div className="mt-1 flex items-center justify-between">
          <button
            onClick={() => prev && onSelectHole(prev)}
            disabled={prev === null}
            aria-label="Previous hole"
            className={stepClass}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[11px] text-muted-foreground">of {holeCount}</span>
          <button
            onClick={() => next && onSelectHole(next)}
            disabled={next === null}
            aria-label="Next hole"
            className={stepClass}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      )}

      {hole ? (
        <div className="flex flex-wrap justify-center gap-1 text-[11px]">
          <span className="px-1.5 py-0.5 rounded-md bg-accent font-medium">
            Par {hole.par}
          </span>
          <span className="px-1.5 py-0.5 rounded-md bg-accent font-medium">
            Stroke {hole.handicap}
          </span>
          <span className="px-1.5 py-0.5 rounded-md bg-accent font-medium">
            {hole.yards[teeSet]} yds
            <span className="text-muted-foreground font-normal"> · {teeLabel}</span>
          </span>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground text-center">
          Not in the printed yardage book.
        </p>
      )}

      {lead}

      <HolePictures key={holeNumber} holeNumber={holeNumber} />

      {children}

      <div className="flex flex-col gap-2">
        <button onClick={onToggleFollow} aria-pressed={followGps} className={toggleClass(followGps)}>
          <Crosshair className="w-3.5 h-3.5 shrink-0" />
          {followGps ? 'Following my position' : 'Follow my position'}
        </button>

        <button
          onClick={() => onChooseNarration(!autoNarration)}
          aria-pressed={autoNarration}
          className={toggleClass(autoNarration)}
        >
          {autoNarration ? (
            <Volume2 className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <VolumeX className="w-3.5 h-3.5 shrink-0" />
          )}
          {autoNarration ? 'Narration: auto' : 'Narration: manual'}
        </button>
      </div>
    </div>
  );
};
