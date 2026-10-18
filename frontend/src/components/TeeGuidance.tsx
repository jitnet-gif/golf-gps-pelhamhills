import React from 'react';
import { Compass, Flag, Navigation, SatelliteDish } from 'lucide-react';
import type { GuidanceReading } from '@/lib/teeGuidance';

const PREFERENCE_KEY = 'golf.guidance.nextTee';

/**
 * Whether the player has asked to be walked to the next tee. Persisted for the
 * same reason the narration switch is: it is a preference about how the round is
 * played, not about this page load. Default off - the app has never volunteered
 * a direction, and the first one should be asked for.
 */
export const loadTeeGuidancePreference = (): boolean => {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === 'on';
  } catch {
    // Private mode, or storage disabled. Off is the safe reading.
    return false;
  }
};

export const saveTeeGuidancePreference = (enabled: boolean): void => {
  try {
    localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* the preference simply will not survive the session */
  }
};

interface TeeGuidanceProps {
  reading: GuidanceReading;
  className?: string;
}

/**
 * The strip that points at the next tee while the player walks to it.
 *
 * The compass point is the headline and the turn is the aside, which is the
 * reverse of how a car satnav reads and is deliberate: the bearing is true
 * whichever way the phone is being held, and the turn is only there on the fixes
 * that earned a heading (see rule 2 in lib/teeGuidance.ts). Promoting the turn
 * would leave a hole in the middle of the card every time the player stopped.
 *
 * Yards, not metres, because GreenDistances sits directly above this on the same
 * screen and two units on one screen is how somebody clubs off the wrong number.
 */
export const TeeGuidance: React.FC<TeeGuidanceProps> = ({
  reading,
  className = '',
}) => {
  const { status, holeNumber, yards, bearing, compass, turn } = reading;

  if (status === 'arrived') {
    return (
      <div
        role="status"
        className={`flex items-center gap-3 border-t border-border px-4 py-2 ${className}`}
      >
        <Flag className="w-4 h-4 shrink-0 text-primary" />
        <p className="text-sm">
          <span className="font-semibold">Hole {holeNumber} tee</span>
          <span className="text-muted-foreground"> · you are here</span>
        </p>
      </div>
    );
  }

  if (status !== 'ok' || yards === null || compass === null) {
    return (
      <div
        role="status"
        className={`flex items-center gap-3 border-t border-border px-4 py-2 ${className}`}
      >
        <SatelliteDish className="w-4 h-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {status === 'no-fix'
            ? `Waiting for a position before pointing at the hole ${holeNumber} tee.`
            : `The last fix was too vague to measure from. Holding the last direction to hole ${holeNumber}.`}
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      className={`flex items-center gap-3 border-t border-border px-4 py-2 ${className}`}
    >
      <Navigation
        className="w-5 h-5 shrink-0 text-primary transition-transform"
        // The needle points along the bearing. It is drawn against north rather
        // than against the player, because the phone does not know which way the
        // player is facing - the same reason `turn` is allowed to be absent.
        style={{ transform: `rotate(${bearing ?? 0}deg)` }}
        aria-hidden
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="text-muted-foreground">To hole </span>
          <span className="font-semibold">{holeNumber}</span>
          <span className="text-muted-foreground"> tee · </span>
          <span className="text-xl font-bold tabular-nums">{Math.round(yards)}</span>
          <span className="text-muted-foreground"> yds</span>
        </p>

        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Compass className="w-3 h-3 shrink-0" />
          {compass} ({Math.round(bearing ?? 0)}&deg;)
          {turn ? ` · ${turn}` : ' · walk on and a turn will appear'}
        </p>
      </div>
    </div>
  );
};

interface TeeGuidanceToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** From useTeeGuidance - must be called inside this component's tap. */
  unlock: () => void;
  /** The tee currently being walked to, if any. */
  targetHole: number | null;
  className?: string;
}

/**
 * The switch that arms next-tee guidance, and the only place its voice can be
 * paid for.
 *
 * The tap is spent on unlock() immediately, exactly as AutoNarration does, and
 * for exactly the same reason: the moment a cue is due is a GPS fix halfway down
 * the 12th fairway, and there is no gesture anywhere near it.
 */
export const TeeGuidanceToggle: React.FC<TeeGuidanceToggleProps> = ({
  enabled,
  onChange,
  unlock,
  targetHole,
  className = '',
}) => (
  <div className={className}>
    <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
      <Navigation className="w-4 h-4" />
      Walk to the next tee
    </h2>

    <button
      onClick={() => {
        if (!enabled) unlock();
        onChange(!enabled);
      }}
      aria-pressed={enabled}
      className={`w-full py-2 px-3 rounded-lg text-sm font-medium ${
        enabled
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'bg-muted text-muted-foreground hover:bg-accent'
      }`}
    >
      {enabled ? 'On - pointing at the next tee' : 'Off - tap to turn on'}
    </button>

    <p className="text-[10px] text-muted-foreground mt-2">
      {enabled
        ? targetHole !== null
          ? `Walking you to the hole ${targetHole} tee. It calls out as you set off, then at 100 and 50 yards.`
          : 'Starts once this hole has a score, or from the button on the map.'
        : 'A bearing and a distance to the next tee - not a route. There are no cart paths in the course data, so it points rather than steers.'}
    </p>
  </div>
);
