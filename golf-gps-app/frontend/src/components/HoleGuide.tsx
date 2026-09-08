import React from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Flag } from 'lucide-react';
import { bookHole, PELHAM_HILLS_TEES, type TeeSet } from '@/data/pelhamHillsBook';

interface HoleGuideProps {
  holeNumber: number;
  holeCount: number;
  /** Which scorecard column the yardage is quoted from. */
  teeSet: TeeSet;
  /** Whether the map is tracking the player rather than holding this hole. */
  followGps: boolean;
  onSelectHole: (holeNumber: number) => void;
  onToggleFollow: () => void;
}

/**
 * Hole navigation strip under the satellite map: which hole you are on, how it
 * scores, and how long it plays from the tee you picked.
 *
 * Par, stroke index and yardage come from the club's printed book, never from
 * the coordinate data - OpenStreetMap's tags for this course disagree with the
 * club's own card on 8 of 18 pars and on every handicap, and the panel a player
 * glances at while standing on the tee has to match the card in their pocket.
 *
 * The live distance readout deliberately lives in GreenDistances instead, which
 * checks whether the hole's pin has actually been surveyed. This strip must not
 * grow one of its own.
 */
export const HoleGuide: React.FC<HoleGuideProps> = ({
  holeNumber,
  holeCount,
  teeSet,
  followGps,
  onSelectHole,
  onToggleFollow,
}) => {
  const hole = bookHole(holeNumber);
  const prev = holeNumber > 1 ? holeNumber - 1 : null;
  const next = holeNumber < holeCount ? holeNumber + 1 : null;
  const teeLabel =
    PELHAM_HILLS_TEES.find((t) => t.id === teeSet)?.label ?? teeSet;

  return (
    <div className="border-t border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => prev && onSelectHole(prev)}
          disabled={prev === null}
          aria-label="Previous hole"
          className="p-1.5 rounded-lg bg-muted hover:bg-accent disabled:opacity-30 disabled:hover:bg-muted shrink-0"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <Flag className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xl font-bold">Hole {holeNumber}</span>
            <span className="text-xs text-muted-foreground">
              of {holeCount}
            </span>
          </div>

          {hole ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
              <span className="px-2 py-1 rounded-md bg-accent font-medium">
                Par {hole.par}
              </span>
              <span className="px-2 py-1 rounded-md bg-accent font-medium">
                Stroke {hole.handicap}
              </span>
              <span className="px-2 py-1 rounded-md bg-accent font-medium">
                {hole.yards[teeSet]} yds
                <span className="text-muted-foreground font-normal">
                  {' '}
                  · {teeLabel}
                </span>
              </span>
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Not in the printed yardage book.
            </p>
          )}

          <button
            onClick={onToggleFollow}
            aria-pressed={followGps}
            className={`mt-2 inline-flex items-center gap-1.5 text-xs ${
              followGps
                ? 'text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            {followGps ? 'Following my position' : 'Follow my position'}
          </button>
        </div>

        <button
          onClick={() => next && onSelectHole(next)}
          disabled={next === null}
          aria-label="Next hole"
          className="p-1.5 rounded-lg bg-muted hover:bg-accent disabled:opacity-30 disabled:hover:bg-muted shrink-0"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
