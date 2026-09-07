import React from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Flag } from 'lucide-react';
import { DistanceIndicator } from './DistanceIndicator';
import type { Hole } from '@/data/pelhamHills';

interface HoleGuideProps {
  hole: Hole;
  holeCount: number;
  /** Whether the map is tracking the player rather than holding this hole. */
  followGps: boolean;
  onSelectHole: (holeNumber: number) => void;
  onToggleFollow: () => void;
}

const yards = (metres: number) => Math.round(metres * 1.09361);

/**
 * Per-hole panel under the satellite map: how the hole is scored, how long it
 * plays from the tee, and how far the player still is from the pin.
 *
 * Everything here is derived from the surveyed hole data - the club publishes no
 * hole-by-hole commentary, so none is written for it.
 */
export const HoleGuide: React.FC<HoleGuideProps> = ({
  hole,
  holeCount,
  followGps,
  onSelectHole,
  onToggleFollow,
}) => {
  const prev = hole.holeNumber > 1 ? hole.holeNumber - 1 : null;
  const next = hole.holeNumber < holeCount ? hole.holeNumber + 1 : null;

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
            <span className="text-xl font-bold">Hole {hole.holeNumber}</span>
            <span className="text-xs text-muted-foreground">
              of {holeCount}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
            <span className="px-2 py-1 rounded-md bg-accent font-medium">
              Par {hole.par}
            </span>
            <span className="px-2 py-1 rounded-md bg-accent font-medium">
              HCP {hole.handicap}
            </span>
            <span className="px-2 py-1 rounded-md bg-accent font-medium">
              {yards(hole.length)} yds
              <span className="text-muted-foreground font-normal">
                {' '}
                · {hole.length} m
              </span>
            </span>
          </div>

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

        <DistanceIndicator
          pin={{
            latitude: hole.latitude,
            longitude: hole.longitude,
            holeNumber: hole.holeNumber,
          }}
          className="shrink-0"
        />

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
