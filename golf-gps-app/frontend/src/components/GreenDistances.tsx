import React from 'react';
import { Compass, Flag, MapPinOff, SatelliteDish } from 'lucide-react';
import { useHoleDistances } from '@/hooks/useHoleDistances';
import { bookHole, PELHAM_HILLS_TEES } from '@/data/pelhamHillsBook';
import type { TeeSet } from '@/data/pelhamHillsBook';

interface GreenDistancesProps {
  holeNumber: number;
  /** Which scorecard column the fallback yardage is quoted from. */
  tee?: TeeSet;
  className?: string;
}

const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

const compassPoint = (bearing: number): string =>
  COMPASS_POINTS[Math.round(bearing / 22.5) % 16];

const teeLabel = (tee: TeeSet): string =>
  PELHAM_HILLS_TEES.find((t) => t.id === tee)?.label ?? tee;

const HoleHeading: React.FC<{ holeNumber: number }> = ({ holeNumber }) => (
  <div className="flex items-baseline gap-2">
    <Flag className="w-4 h-4 text-primary shrink-0" />
    <span className="text-sm font-semibold">Hole {holeNumber}</span>
  </div>
);

/**
 * Front, centre and back of the green, or a plain statement of why there are no
 * numbers to show.
 *
 * The fallback states are the ones players will actually meet - no pin on this
 * course is surveyed yet - so they are written to read as a deliberate answer
 * rather than a failure: the card yardage is still correct and is shown, and the
 * live figure is named as unavailable instead of being quietly replaced.
 */
export const GreenDistances: React.FC<GreenDistancesProps> = ({
  holeNumber,
  tee = 'white',
  className = '',
}) => {
  const { status, front, centre, back, bearing } = useHoleDistances(holeNumber);
  const book = bookHole(holeNumber);

  const shell = `rounded-xl border border-border bg-card p-4 ${className}`;

  if (status === 'unsurveyed') {
    return (
      <div className={shell}>
        <HoleHeading holeNumber={holeNumber} />

        <div className="mt-3 flex gap-2.5">
          <MapPinOff className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="text-sm">
            <p className="font-medium">This hole&apos;s pin has not been surveyed.</p>
            {book ? (
              <p className="mt-1 text-muted-foreground">
                The yardage from the card is{' '}
                <span className="font-semibold text-foreground">
                  {teeLabel(tee)} {book.yards[tee]} yards
                </span>
                , green depth {book.greenDepth} yards.
              </p>
            ) : null}
            <p className="mt-1 text-muted-foreground">
              Live distance to the green is unavailable.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // A missing number under an 'ok' status would be a bug in the hook, but an
  // empty card is the one thing this component must never render, so it falls
  // back to the acquiring state rather than to nothing.
  const missingNumbers =
    front === null || centre === null || back === null || bearing === null;

  if (status === 'no-fix' || missingNumbers) {
    return (
      <div className={shell}>
        <HoleHeading holeNumber={holeNumber} />
        <div className="mt-3 flex items-center gap-2.5 text-sm text-muted-foreground">
          <SatelliteDish className="w-4 h-4 shrink-0 animate-pulse" />
          Acquiring GPS signal...
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="flex items-baseline justify-between gap-2">
        <HoleHeading holeNumber={holeNumber} />
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Compass className="w-3.5 h-3.5" />
          {compassPoint(bearing)} ({Math.round(bearing)}&deg;)
        </span>
      </div>

      <div className="mt-3 flex flex-col items-center">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Front {Math.round(front)}
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-5xl font-bold leading-none text-primary tabular-nums">
            {Math.round(centre)}
          </span>
          <span className="text-sm text-muted-foreground">yd</span>
        </div>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Centre
        </div>

        <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
          Back {Math.round(back)}
        </div>
      </div>
    </div>
  );
};
