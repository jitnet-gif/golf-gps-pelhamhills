import React from 'react';
import {
  PELHAM_HILLS_TEES,
  bookHole,
  type TeeSet,
} from '@/data/pelhamHillsBook';
import { TeeSwatch } from '@/components/TeeSelector';

interface HoleCardProps {
  holeNumber: number;
  teeSet: TeeSet;
  className?: string;
}

/**
 * The hole's page out of the club's printed yardage book: how it is scored, how
 * long it plays from every tee, and the club's own words about how to play it.
 *
 * Everything here is printed data, so it is safe to state plainly - unlike the
 * GPS distances, none of it depends on the unverified hole coordinates.
 *
 * The book's tee carries and the unlabelled arrow figures near each green are
 * deliberately not shown: the printed page gives them no legend, and a number
 * without its landmark would be read as a distance to something.
 */
export const HoleCard: React.FC<HoleCardProps> = ({
  holeNumber,
  teeSet,
  className = '',
}) => {
  const hole = bookHole(holeNumber);

  if (!hole) {
    return (
      <div
        className={`p-4 rounded-xl border border-border text-sm text-muted-foreground ${className}`}
      >
        Hole {holeNumber} is not in the printed yardage book.
      </div>
    );
  }

  const selectedTee =
    PELHAM_HILLS_TEES.find((t) => t.id === teeSet) ?? PELHAM_HILLS_TEES[1];
  const otherTees = PELHAM_HILLS_TEES.filter((t) => t.id !== selectedTee.id);

  return (
    <article
      className={`rounded-xl border border-border overflow-hidden ${className}`}
    >
      <header className="flex items-end justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Hole
          </div>
          <div className="text-4xl font-bold leading-none">
            {hole.holeNumber}
          </div>
        </div>

        <dl className="flex gap-2 text-xs shrink-0">
          <div className="px-2.5 py-1.5 rounded-lg bg-muted text-center">
            <dt className="text-muted-foreground">Par</dt>
            <dd className="text-base font-bold leading-tight">{hole.par}</dd>
          </div>
          <div className="px-2.5 py-1.5 rounded-lg bg-muted text-center">
            <dt className="text-muted-foreground">Stroke index</dt>
            <dd className="text-base font-bold leading-tight">
              {hole.handicap}
            </dd>
          </div>
        </dl>
      </header>

      <div className="px-4 pt-4">
        <div className="flex items-baseline gap-2">
          <TeeSwatch
            teeSet={selectedTee.id}
            marker={selectedTee.marker}
            className="self-center"
          />
          <span className="text-sm font-medium">{selectedTee.label}</span>
        </div>
        <div className="mt-0.5 text-3xl font-bold text-primary tabular-nums">
          {hole.yards[selectedTee.id]}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            yds
          </span>
        </div>
      </div>

      {/* The other five columns stay visible: players regularly play a hole off
          a different marker than the set they entered. */}
      <dl className="mt-3 px-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {otherTees.map((tee) => (
          <div key={tee.id} className="flex items-center gap-2 min-w-0">
            <TeeSwatch teeSet={tee.id} marker={tee.marker} size="sm" />
            <dt className="flex-1 leading-tight text-muted-foreground">
              {tee.label}
            </dt>
            <dd className="tabular-nums font-medium">{hole.yards[tee.id]}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 px-4 text-xs text-muted-foreground">
        Green depth{' '}
        <span className="font-semibold text-foreground tabular-nums">
          {hole.greenDepth} yds
        </span>
      </p>

      {/* The commentary is why this panel exists - it gets the room to be read,
          verbatim and unclipped. */}
      <blockquote className="mt-4 px-4 pb-4 pt-3 border-t border-border text-[0.9375rem] leading-relaxed">
        {hole.description}
        <footer className="mt-2 text-xs text-muted-foreground not-italic">
          Pelham Hills yardage book
        </footer>
      </blockquote>
    </article>
  );
};
