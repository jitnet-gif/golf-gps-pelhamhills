import React from 'react';
import { ChevronLeft, ChevronRight, Flag, LayoutGrid } from 'lucide-react';
import { bookHole } from '@/data/pelhamHillsBook';

interface HoleSheetProps {
  holeNumber: number;
  holeCount: number;
  onSelectHole: (holeNumber: number) => void;
  open: boolean;
  onToggle: () => void;
  /** Buttons on the map just above the bar, bottom left. */
  actions?: React.ReactNode;
  /** What pulling the bar up shows: the hole's pictures, commentary and switches. */
  children: React.ReactNode;
}

/**
 * The bar along the bottom of the map, the way Hole19 has it (the club's ask):
 * previous hole, the hole number with its par and stroke index, next hole.
 * Tapping it pulls up what used to be the column beside the map.
 *
 * The details are hidden, not unmounted, when the sheet is down: FairwayDistance
 * in there keeps listening for the player to stop, and speaks by itself.
 */
export const HoleSheet: React.FC<HoleSheetProps> = ({
  holeNumber,
  holeCount,
  onSelectHole,
  open,
  onToggle,
  actions,
  children,
}) => {
  const book = bookHole(holeNumber);
  const prev = holeNumber > 1 ? holeNumber - 1 : null;
  const next = holeNumber < holeCount ? holeNumber + 1 : null;
  const step =
    'grid h-11 w-11 shrink-0 place-items-center rounded-xl text-primary hover:bg-accent disabled:opacity-30';

  return (
    <aside
      aria-label="Hole information"
      // Never taller than the map: on a phone held sideways the map is ~200 px
      // high, and a sheet growing past its top took the bar - and the way to
      // close it - off the screen. The details scroll inside instead.
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[900] flex max-h-full flex-col sm:bottom-3 sm:left-auto sm:right-3 sm:max-h-[calc(100%-1.5rem)] sm:w-[22rem]"
    >
      {/* With the sheet up these buttons have their twins inside it (the bar,
          the speaker), and on a sideways phone they would sit on the pin tab. */}
      {!open && (
      <div className="flex shrink-0 items-end justify-between gap-2 px-2 pb-2">
        <div className="pointer-events-auto">{actions}</div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="hole-sheet-details"
          aria-label={open ? 'Hide hole details' : 'Show hole details'}
          className="pointer-events-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-900/95 text-white shadow-lg"
        >
          <LayoutGrid className="h-5 w-5" />
        </button>
      </div>
      )}

      <div className="pointer-events-auto flex min-h-0 flex-col rounded-t-2xl bg-card text-card-foreground shadow-[0_-4px_16px_rgba(0,0,0,0.18)] sm:rounded-2xl">
        <div aria-hidden onClick={onToggle} className="flex shrink-0 cursor-pointer justify-center pb-0.5 pt-2">
          <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
        </div>
        <div className="flex shrink-0 items-center gap-1 px-2 pb-2">
          <button
            type="button"
            onClick={() => prev && onSelectHole(prev)}
            disabled={prev === null}
            aria-label="Previous hole"
            className={step}
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            data-testid="hole-bar"
            aria-label={`Hole ${holeNumber}${book ? `, par ${book.par}, stroke index ${book.handicap}` : ''}`}
            className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl py-1 hover:bg-accent"
          >
            <Flag className="h-6 w-6 shrink-0 text-primary" fill="currentColor" />
            <span className="text-4xl font-black leading-none tabular-nums">{holeNumber}</span>
            {book && (
              <span className="text-left text-sm font-semibold leading-tight text-muted-foreground">
                Par {book.par}
                <br />
                S.I. {book.handicap}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => next && onSelectHole(next)}
            disabled={next === null}
            aria-label="Next hole"
            className={step}
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        </div>
        <div
          id="hole-sheet-details"
          hidden={!open}
          className="max-h-[55vh] min-h-0 overflow-y-auto overscroll-contain border-t border-border"
        >
          {children}
        </div>
      </div>
    </aside>
  );
};
