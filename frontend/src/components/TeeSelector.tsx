import React, { useId } from 'react';
import { Check } from 'lucide-react';
import {
  PELHAM_HILLS_TEES,
  PELHAM_HILLS_TOTALS,
  type TeeMarker,
  type TeeSet,
} from '@/data/pelhamHillsBook';

/**
 * The physical paint on the tee markers, not theme colours - a white tee is
 * white in both themes, so the swatch carries its own contrast ring rather than
 * relying on the surface behind it.
 */
const MARKER_FILL: Record<TeeMarker, string> = {
  blue: '#1d4ed8',
  white: '#ffffff',
  yellow: '#f5c518',
  red: '#dc2626',
};

/**
 * A tee set printed as two colours ("White/Yellow") is one marker in the book's
 * table but two paints on the course, so the swatch is split rather than
 * picking a winner.
 */
const SPLIT_FILLS: Partial<Record<TeeSet, [TeeMarker, TeeMarker]>> = {
  whiteYellow: ['white', 'yellow'],
  yellowRed: ['yellow', 'red'],
};

interface TeeSwatchProps {
  teeSet: TeeSet;
  marker: TeeMarker;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Size is a prop rather than an overridable class: Tailwind emits `w-2.5`
 * before `w-3.5`, so a smaller width passed in through className would lose to
 * the base one no matter which order the strings are concatenated in.
 */
const SWATCH_SIZE: Record<'sm' | 'md', string> = {
  sm: 'w-2.5 h-2.5',
  md: 'w-3.5 h-3.5',
};

export const TeeSwatch: React.FC<TeeSwatchProps> = ({
  teeSet,
  marker,
  size = 'md',
  className = '',
}) => {
  const split = SPLIT_FILLS[teeSet];
  const background = split
    ? `linear-gradient(135deg, ${MARKER_FILL[split[0]]} 0 50%, ${MARKER_FILL[split[1]]} 50% 100%)`
    : MARKER_FILL[marker];

  // The white marker is a white dot on a near-white surface in light mode, so
  // the outline is what makes it a swatch at all - it has to hold at 10px.
  return (
    <span
      aria-hidden="true"
      style={{ background }}
      className={`inline-block ${SWATCH_SIZE[size]} rounded-full ring-1 ring-foreground/45 shrink-0 ${className}`}
    />
  );
};

interface TeeSelectorProps {
  value: TeeSet;
  onChange: (t: TeeSet) => void;
  className?: string;
}

/**
 * Choose which of the six columns on the club's scorecard the app plays from.
 *
 * Native radios keep arrow-key selection and screen-reader grouping for free;
 * they are only hidden visually so the coloured row can be the control.
 */
export const TeeSelector: React.FC<TeeSelectorProps> = ({
  value,
  onChange,
  className = '',
}) => {
  const groupName = useId();

  return (
    <fieldset className={className}>
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
        Tees
      </legend>

      <div className="flex flex-col gap-0.5">
        {PELHAM_HILLS_TEES.map((tee) => {
          const selected = tee.id === value;

          return (
            <label
              key={tee.id}
              className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer border transition-colors focus-within:ring-2 focus-within:ring-primary ${
                selected
                  ? 'border-primary bg-primary/10'
                  : 'border-transparent hover:bg-muted'
              }`}
            >
              <input
                type="radio"
                name={groupName}
                value={tee.id}
                checked={selected}
                onChange={() => onChange(tee.id)}
                className="sr-only"
              />

              <TeeSwatch teeSet={tee.id} marker={tee.marker} />

              <span
                className={`flex-1 text-sm truncate ${
                  selected ? 'font-semibold' : 'font-medium'
                }`}
              >
                {tee.label}
              </span>

              <span className="text-xs tabular-nums text-muted-foreground">
                {PELHAM_HILLS_TOTALS[tee.id].total} yds
              </span>

              {/* Colour alone must not be the only cue that a row is chosen. */}
              <Check
                className={`w-3.5 h-3.5 shrink-0 text-primary ${
                  selected ? '' : 'invisible'
                }`}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};
