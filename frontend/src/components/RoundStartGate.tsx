import React, { useState } from 'react';
import { Loader2, Play } from 'lucide-react';

/**
 * The card that stands in front of the round until the player taps Start.
 *
 * It exists for one reason: a mobile browser will not make a sound that no
 * gesture ever asked for, and the club's offers on the 8th and 17th tees are
 * announced from a GPS fix, where there is no gesture within two hours. This
 * tap is spent immediately on unlock() - the audio element and the speech
 * engine both - and that is what lets those two lines be heard at all.
 *
 * It is shown once per tab, not once per phone: a round is one tab, and the
 * permission it buys dies with the tab it was bought in. A player who reloads
 * in the same tab is not asked again (see Golf.tsx's useTabState).
 *
 * If the browser refuses, the round still starts. The offers fall back to a
 * play button on the card, the way an arrival already does.
 */

interface RoundStartGateProps {
  courseName: string;
  /** From useHoleNarration - must be called inside this component's tap. */
  unlock: () => Promise<boolean>;
  /** Start the round. Told whether sound was actually granted. */
  onStart: (unlocked: boolean) => void;
}

export const RoundStartGate: React.FC<RoundStartGateProps> = ({ courseName, unlock, onStart }) => {
  const [arming, setArming] = useState(false);

  const start = async () => {
    if (arming) return;
    setArming(true);
    // Deliberately inside the tap, and awaited: the answer decides whether the
    // 8th and 17th can speak by themselves or have to ask for another tap.
    let unlocked = false;
    try {
      unlocked = await unlock();
    } finally {
      setArming(false);
      onStart(unlocked);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Start the round"
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {courseName}
        </p>
        <h1 className="mt-2 text-2xl font-bold">Have a good round</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Tap Start and the course guide begins. On the 8th and the 17th the pro
          shop&apos;s offer is read aloud.
        </p>

        <button
          type="button"
          onClick={start}
          disabled={arming}
          className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {arming ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
          Start
        </button>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          That one tap is what lets the phone speak out on the course - a phone
          blocks any sound nobody touched the screen for.
        </p>

        {/* Said here because there is nowhere else left to say it. GPS used to
            be a switch in the side menu and is now always on, and while the
            round is running this phone tells the pro shop where the cart is
            (migration 0014). A player is owed that in plain words, before the
            round rather than after it. */}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          While you play, the pro shop can see your cart on the course map - so
          they know where to bring an order and how the field is moving. Where
          you are is kept only while you are out there, and dropped a few hours
          after you finish.
        </p>
      </div>
    </div>
  );
};
