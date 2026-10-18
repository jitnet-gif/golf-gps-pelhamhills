import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useFairwayDistance } from '@/hooks/useFairwayDistance';
import { useAppStore } from '@/store/appStore';
import { bookHole, PELHAM_HILLS_TEES, type TeeSet } from '@/data/pelhamHillsBook';
import type { Hole } from '@/data/pelhamHills';

/** Back, centre and front of the green as three bars - the tab's "more" sign. */
const GreenBars: React.FC = () => (
  <svg aria-hidden viewBox="0 0 24 20" className="h-5 w-6 shrink-0 text-emerald-500" fill="currentColor">
    <rect x="0" y="0" width="24" height="4" rx="2" />
    <rect x="3" y="8" width="18" height="4" rx="2" />
    <rect x="6" y="16" width="12" height="4" rx="2" />
  </svg>
);

const Row: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between gap-2">
    <dt className="text-slate-500">{label}</dt>
    <dd className={`tabular-nums ${strong ? 'text-lg font-black' : 'font-bold'}`}>{value}</dd>
  </div>
);

interface PinTabProps {
  hole: Hole;
  /** Which card column the yardage falls back to before the phone finds the player. */
  teeSet: TeeSet;
  className?: string;
}

/**
 * The pin's yardage in the top corner of the map, the way Hole19 shows it (the
 * club's ask), opening to back, centre and front of the green.
 *
 * The figure is FairwayDistance's - along the hole, round a dogleg - so the tab,
 * the voice and the sheet below never disagree. Front and back split the book's
 * green depth either side of it, as useHoleDistances does for a surveyed pin;
 * until the pin is surveyed every figure carries the "≈".
 */
export const PinTab: React.FC<PinTabProps> = ({ hole, teeSet, className = '' }) => {
  const reading = useFairwayDistance(hole);
  const gpsProblem = useAppStore((s) => s.gpsProblem);
  const book = bookHole(hole.holeNumber);
  const [open, setOpen] = useState(false);

  const along = reading.status === 'ok' && reading.along !== null ? Math.round(reading.along) : null;
  const straight = reading.straight !== null ? Math.round(reading.straight) : null;
  const card = book ? book.yards[teeSet] : null;
  const figure = along ?? card;
  if (figure === null) return null;

  const approx = along !== null && reading.approx;
  const mark = approx ? '≈' : '';
  const half = book ? Math.round(book.greenDepth / 2) : null;
  const teeLabel = PELHAM_HILLS_TEES.find((t) => t.id === teeSet)?.label ?? teeSet;

  return (
    <div className={`flex w-48 flex-col items-end ${className}`}>
      <button
        type="button"
        data-testid="pin-tab"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        aria-label={
          along !== null
            ? `${approx ? 'About ' : ''}${along} yards to the pin`
            : `Card ${card} yards`
        }
        className="flex w-full items-center justify-end gap-2 rounded-bl-3xl bg-white py-1.5 pl-4 pr-2.5 text-slate-900 shadow-lg"
      >
        {along === null && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Card</span>
        )}
        <GreenBars />
        <span className="flex items-start leading-none">
          {approx && <span className="mt-1.5 text-xl font-bold text-amber-500">≈</span>}
          <span className="text-[44px] font-black tabular-nums tracking-tight">{figure}</span>
          <span className="ml-0.5 mt-1 text-sm font-bold text-slate-400">yd</span>
        </span>
        <ChevronDown
          aria-hidden
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <dl
          data-testid="pin-tab-details"
          className="mr-2 mt-1.5 w-44 space-y-1 rounded-2xl bg-white p-3 text-sm text-slate-900 shadow-lg"
        >
          {along !== null && half !== null && (
            <>
              <Row label="Back" value={`${mark}${along + half}`} />
              <Row label="Centre" value={`${mark}${along}`} strong />
              <Row label="Front" value={`${mark}${Math.max(0, along - half)}`} />
            </>
          )}
          {along !== null && reading.bends.length > 0 && (
            <Row label="To the bend" value={`${Math.round(reading.bends[0].yards)}`} />
          )}
          {along !== null && straight !== null && along - straight >= 5 && (
            <Row label="Straight" value={`${mark}${straight}`} />
          )}
          {card !== null && <Row label={`Card · ${teeLabel}`} value={`${card}`} />}
          {approx && (
            <p className="pt-1 text-[11px] leading-snug text-amber-600">≈ pin from the map, not surveyed</p>
          )}
          {along === null && (
            <p className="pt-1 text-[11px] leading-snug text-slate-500">
              {reading.status === 'far'
                ? 'You are away from this hole.'
                : gpsProblem === 'denied'
                  ? 'Location is off for this site. Tap "Location off" at the top to turn it on.'
                  : gpsProblem === 'unavailable'
                    ? 'No GPS signal yet. Step out into the open - it keeps trying.'
                    : gpsProblem === 'unsupported'
                      ? 'This browser cannot share your location.'
                      : 'Finding you for the pin distance...'}
            </p>
          )}
        </dl>
      )}
    </div>
  );
};
