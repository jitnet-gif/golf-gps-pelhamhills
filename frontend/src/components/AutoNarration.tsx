import React, { useState } from 'react';
import { Radio, Loader2 } from 'lucide-react';

const PREFERENCE_KEY = 'golf.narration.auto';

/**
 * Whether this phone reads each hole out on arrival.
 *
 * **Auto unless the player chose Manual.** It used to be the other way round,
 * on the argument that the tap choosing Auto was also the tap that bought the
 * browser's permission to make a sound. The round's start card buys that
 * permission now (see RoundStartGate), for the club's offers on the 8th and the
 * 17th, so the reason for starting silent has gone - and a guide nobody found
 * the switch for is a guide nobody heard.
 *
 * An explicit Manual is still remembered: this reads a stored 'off', not the
 * absence of a stored 'on', so a player who turned it off keeps it off.
 */
export const loadAutoNarrationPreference = (): boolean => {
  try {
    // Anything other than a stored 'off' is auto, including nothing stored.
    return localStorage.getItem(PREFERENCE_KEY) !== 'off';
  } catch {
    // Private mode, or storage disabled. Auto is the default, and stays it.
    return true;
  }
};

export const saveAutoNarrationPreference = (enabled: boolean): void => {
  try {
    localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* the preference simply will not survive the session */
  }
};

interface AutoNarrationProps {
  /** True for automatic, false for manual. */
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** From useHoleNarration - must be called inside this component's tap. */
  unlock: () => Promise<boolean>;
  /** The hole the detector is currently dwelling on, if any. */
  candidateHole: number | null;
  className?: string;
}

/**
 * Narration mode: manual (tap Play on a hole) or automatic (each hole is read
 * when the player reaches its tee and stays a moment).
 *
 * Choosing automatic is a tap, and that tap is spent immediately on unlock() -
 * not saved for later, because "later" is a GPS fix on the 4th tee and there is
 * no gesture anywhere near it. If the browser refuses, the control says so
 * rather than switching over and going quiet for four hours.
 */
export const AutoNarration: React.FC<AutoNarrationProps> = ({
  enabled,
  onChange,
  unlock,
  candidateHole,
  className = '',
}) => {
  const [isArming, setIsArming] = useState(false);
  const [refused, setRefused] = useState(false);

  const chooseManual = () => {
    if (!enabled) return;
    onChange(false);
    setRefused(false);
  };

  const chooseAuto = async () => {
    if (enabled) return;
    setIsArming(true);
    const unlocked = await unlock();
    setIsArming(false);
    setRefused(!unlocked);
    // Automatic even when the unlock failed: arrivals still select the hole and
    // offer a tap, which is better than a control that refuses to move.
    onChange(true);
  };

  const option = (active: boolean) =>
    `py-2 px-3 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
    }`;

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Radio className="w-4 h-4" />
        Narration
      </h2>

      <div role="radiogroup" aria-label="Narration mode" className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted">
        <button role="radio" aria-checked={!enabled} onClick={chooseManual} className={option(!enabled)}>
          Manual
        </button>
        <button
          role="radio"
          aria-checked={enabled}
          onClick={chooseAuto}
          disabled={isArming}
          className={option(enabled)}
        >
          {isArming && <Loader2 className="w-4 h-4 animate-spin" />}
          Auto
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground mt-2">
        {enabled
          ? candidateHole !== null
            ? `Reaching hole ${candidateHole} - stay put and it will start.`
            : 'Each hole is read once, when you arrive at its tee and stay a moment.'
          : 'Tap Play on a hole to hear it. Choosing Auto plays a silent clip, which is what lets the phone speak later without a tap.'}
      </p>

      {enabled && (
        <p className="text-[10px] text-muted-foreground mt-1">
          On by default - switch to Manual for a quiet round.
        </p>
      )}

      {refused && (
        <p className="text-xs text-destructive mt-2">
          This browser would not grant audio without a tap. Arrivals will offer a
          play button instead.
        </p>
      )}
    </div>
  );
};
