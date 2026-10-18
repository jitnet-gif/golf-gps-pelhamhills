import React, { useEffect } from 'react';
import { Flag, Home, X } from 'lucide-react';
import type { DriveDestination } from '@/hooks/useCartNavigation';

interface DestinationPickerProps {
  /** The hole just finished - its next tee is the first choice. */
  holeNumber: number;
  holeCount: number;
  onPick: (destination: DriveDestination) => void;
  onClose: () => void;
}

/**
 * "Hole out" asks where to drive: the next tee by default, any other tee (a
 * group sent to the 10th, a skipped hole), or the clubhouse - lunch at the turn,
 * or the round is over.
 */
export const DestinationPicker: React.FC<DestinationPickerProps> = ({ holeNumber, holeCount, onPick, onClose }) => {
  const next = holeNumber < holeCount ? holeNumber + 1 : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const big =
    'flex h-14 w-full items-center gap-3 rounded-xl px-4 text-left text-base font-bold shadow-sm transition-colors';

  return (
    <div className="fixed inset-0 z-[1300] flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="destination-title"
        className="relative w-full max-w-md rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-card-foreground shadow-2xl sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 id="destination-title" className="text-lg font-bold leading-tight">
              Hole {holeNumber} out - where to?
            </h2>
            <p className="text-xs text-muted-foreground">Cart navigation along the cart paths</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel"
            className="grid h-10 w-10 place-items-center rounded-full bg-muted hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {next !== null && (
            <button
              type="button"
              onClick={() => onPick({ kind: 'tee', holeNumber: next })}
              className={`${big} bg-primary text-primary-foreground hover:opacity-90`}
            >
              <Flag className="h-5 w-5 shrink-0" fill="currentColor" />
              Next: hole {next} tee
            </button>
          )}
          <button
            type="button"
            onClick={() => onPick({ kind: 'clubhouse' })}
            className={`${big} ${
              next === null ? 'bg-primary text-primary-foreground hover:opacity-90' : 'bg-muted hover:bg-accent'
            }`}
          >
            <Home className="h-5 w-5 shrink-0" />
            Clubhouse
          </button>
        </div>

        <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Another tee</p>
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: holeCount }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onPick({ kind: 'tee', holeNumber: n })}
              aria-label={`Hole ${n} tee`}
              className={`h-11 rounded-lg text-base font-bold tabular-nums ${
                n === holeNumber ? 'border border-border text-muted-foreground' : 'bg-muted hover:bg-accent'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
