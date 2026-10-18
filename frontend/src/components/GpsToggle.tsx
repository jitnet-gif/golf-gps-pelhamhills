import React from 'react';
import { LocateFixed, LocateOff } from 'lucide-react';

const PREFERENCE_KEY = 'golf.gps';

/**
 * Whether this phone follows the player around the course.
 *
 * **Not on screen at the moment.** The club asked for GPS forced on, so
 * pages/Golf.tsx pins it true and does not render this control. Everything here
 * still works; putting it back in the side menu and restoring the page's
 * `useState(loadGpsPreference)` is the whole of the way back.
 *
 * **On unless the player turned it off** - the opposite of the narration and
 * guidance switches, and deliberately so. Those two make a sound; this one is
 * what the app is for. A round that opens with no blue dot looks broken.
 *
 * Off is still worth having: a phone low on battery on the 14th, a player who
 * only wants the printed yardages, an in-app browser that will not grant
 * location anyway. With it off the app keeps every card, every map and every
 * printed distance - it simply stops asking the phone where it is.
 */
export const loadGpsPreference = (): boolean => {
  try {
    // Anything other than a stored 'off' is on, including nothing stored at all.
    return localStorage.getItem(PREFERENCE_KEY) !== 'off';
  } catch {
    // Private mode, or storage disabled. On is the default, and stays it.
    return true;
  }
};

export const saveGpsPreference = (enabled: boolean): void => {
  try {
    localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* the preference simply will not survive the session */
  }
};

interface GpsToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  className?: string;
}

export const GpsToggle: React.FC<GpsToggleProps> = ({ enabled, onChange, className = '' }) => {
  const option = (active: boolean) =>
    `py-2 px-3 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
    }`;

  return (
    <div className={className}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <LocateFixed className="h-4 w-4" />
        GPS
      </h2>

      <div role="radiogroup" aria-label="GPS" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <button
          role="radio"
          aria-checked={enabled}
          onClick={() => enabled || onChange(true)}
          className={option(enabled)}
        >
          <LocateFixed className="h-4 w-4" />
          On
        </button>
        <button
          role="radio"
          aria-checked={!enabled}
          onClick={() => enabled && onChange(false)}
          className={option(!enabled)}
        >
          <LocateOff className="h-4 w-4" />
          Off
        </button>
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        {enabled
          ? 'Live distances, the walk to the next tee, and holes announced as you reach them.'
          : 'Location off. Printed yardages only - no live distance, no arrival, no walking directions. Battery lasts longer.'}
      </p>
    </div>
  );
};
