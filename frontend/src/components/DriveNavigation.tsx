import React from 'react';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Home,
  SatelliteDish,
  Undo2,
  Volume2,
  X,
} from 'lucide-react';
import { METRES_TO_YARDS } from '@/lib/geo';
import { stepWords, type Turn } from '@/lib/cartRoute';
import type { DriveReading } from '@/hooks/useCartNavigation';

const TURN_ICON: Record<Turn, React.ElementType> = {
  straight: ArrowUp,
  'slight-left': ArrowUpLeft,
  'slight-right': ArrowUpRight,
  left: CornerUpLeft,
  right: CornerUpRight,
  'u-turn': Undo2,
};

interface DriveNavigationProps {
  reading: DriveReading;
  onEnd: () => void;
  /** Says the next instruction again. Absent when the phone has no voice. */
  onSpeak?: (text: string) => void;
}

/**
 * The cart drive as a satnav shows it (the club's ask, "운전자 네비게이션"):
 * the next turn big, how far to it, and the rest of the way underneath. Solid,
 * not see-through, for the same reason as the walk banner - the satellite photo
 * under the words was the club's complaint about that one.
 *
 * Where the route has no mapped cart path the banner says so: the dashed line
 * on the map is a straight line, not a road.
 */
export const DriveNavigation: React.FC<DriveNavigationProps> = ({ reading, onEnd, onSpeak }) => {
  const { status, target, progress } = reading;
  const DestIcon = target.holeNumber === null ? Home : Flag;

  let icon: React.ReactNode;
  let headline: React.ReactNode;
  let spoken = '';

  if (status === 'arrived') {
    icon = <DestIcon className="h-8 w-8 text-yellow-300" />;
    headline = <p className="text-lg font-bold leading-tight">You have arrived</p>;
  } else if (status === 'no-fix' || !progress) {
    icon = <SatelliteDish className="h-7 w-7 animate-pulse text-white/70" />;
    headline = <p className="text-sm font-semibold leading-tight">Waiting for GPS to plan the route</p>;
  } else if (progress.next && progress.toNext !== null) {
    const Icon = progress.next.change === 'leave-path' && progress.next.turn === 'straight' ? ArrowUp : TURN_ICON[progress.next.turn];
    const toNext = Math.round(progress.toNext * METRES_TO_YARDS);
    const words = stepWords(progress.next);
    icon = <Icon className="h-9 w-9 text-yellow-300" strokeWidth={2.5} />;
    headline = (
      <>
        <p className="text-3xl font-black leading-none tabular-nums">
          {toNext}
          <span className="ml-1 text-sm font-semibold text-white/70">yds</span>
        </p>
        <p className="mt-1 text-base font-bold leading-tight">{words}</p>
      </>
    );
    spoken = `In ${toNext} yards, ${words.charAt(0).toLowerCase()}${words.slice(1)}.`;
  } else {
    icon = <DestIcon className="h-8 w-8 text-yellow-300" />;
    headline = (
      <>
        <p className="text-3xl font-black leading-none tabular-nums">
          {reading.remainingYards}
          <span className="ml-1 text-sm font-semibold text-white/70">yds</span>
        </p>
        <p className="mt-1 text-base font-bold leading-tight">Straight on to the {target.label.toLowerCase()}</p>
      </>
    );
    spoken = `${reading.remainingYards} yards to the ${target.label.toLowerCase()}.`;
  }

  return (
    <div
      role="status"
      aria-label="Cart navigation"
      data-testid="drive-banner"
      className="absolute left-14 right-2 top-2 z-[1000] rounded-xl bg-neutral-950 px-3 py-2.5 text-white shadow-lg"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-white/10">{icon}</span>
        <div className="min-w-0 flex-1">{headline}</div>
        {onSpeak && spoken && (
          <button
            type="button"
            onClick={() => onSpeak(spoken)}
            aria-label="Say the next instruction"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15"
          >
            <Volume2 className="h-5 w-5" />
          </button>
        )}
      </div>

      {status === 'ok' && progress?.onDirect && (
        <p className="mt-2 rounded-md bg-amber-400/15 px-2 py-1 text-xs font-medium text-amber-200">
          No cart path on the map here - the dashed line is straight across. Watch for water and greens.
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm text-white/85" data-testid="drive-summary">
          <span className="font-semibold text-white">{target.label}</span>
          {status === 'ok' && reading.remainingYards !== null && (
            <>
              {' '}· {reading.remainingYards} yds · {reading.minutes} min
            </>
          )}
        </p>
        <button
          type="button"
          onClick={onEnd}
          aria-label={status === 'arrived' ? 'Close navigation' : 'End navigation'}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-white/15 px-3 text-sm font-semibold"
        >
          <X className="h-4 w-4" />
          {status === 'arrived' ? 'Done' : 'End'}
        </button>
      </div>
    </div>
  );
};
