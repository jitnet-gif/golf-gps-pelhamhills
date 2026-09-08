import React, { useEffect, useMemo, useRef } from 'react';
import { Volume2, Play, Pause, Square } from 'lucide-react';
import { useHoleNarration, narrationId } from '@/hooks/useHoleNarration';
import { buildHoleScript } from '@/lib/narrationScript';
import type { TeeSet } from '@/data/pelhamHillsBook';

interface HoleNarrationProps {
  holeNumber: number;
  teeSet: TeeSet;
  className?: string;
}

/**
 * Reads a hole to a player standing on the tee. Playback always starts from a tap -
 * both the recorded clips and the browser voice refuse to start outside a user
 * gesture on iOS Safari.
 *
 * The commentary is quoted from the club's printed yardage book and nothing else is
 * added to it, so the script doubles as the on-screen text for players who would
 * rather read than listen. buildHoleScript is what both the screen and the
 * ElevenLabs generator read from - see lib/narrationScript.ts.
 */
export const HoleNarration: React.FC<HoleNarrationProps> = ({
  holeNumber,
  teeSet,
  className = '',
}) => {
  const { isSupported, isSpeaking, isPaused, speakingId, source, error, play, stop, pause, resume } =
    useHoleNarration();

  const script = useMemo(() => buildHoleScript(holeNumber, teeSet), [holeNumber, teeSet]);
  const paragraphs = useMemo(() => script.split('\n\n'), [script]);

  const thisHoleId = narrationId(holeNumber, teeSet);
  const isThisHole = speakingId === thisHoleId;

  // Read in an effect, not during render, so the cleanup below sees the value the
  // previous commit actually had.
  const wasSpeakingRef = useRef(false);
  useEffect(() => {
    wasSpeakingRef.current = isThisHole;
  }, [isThisHole]);

  // Walking to the next hole - or switching tees - makes the queued script stale.
  // Silence it rather than let the player hear the hole they just left.
  useEffect(
    () => () => {
      if (wasSpeakingRef.current) stop();
    },
    [script, stop]
  );

  const header = (
    <h2 className="text-sm font-semibold flex items-center gap-2">
      <Volume2 className="w-4 h-4" />
      Hole {holeNumber} narration
    </h2>
  );

  if (!script) {
    return (
      <div className={`space-y-2 ${className}`}>
        {header}
        <p className="text-xs text-muted-foreground">
          The yardage book has no page for hole {holeNumber}.
        </p>
      </div>
    );
  }

  if (!isSupported) {
    return (
      <div className={`space-y-2 ${className}`}>
        {header}
        <p className="text-xs text-muted-foreground">
          This browser cannot read the hole aloud. The full guide is below.
        </p>
        <HoleScript paragraphs={paragraphs} />
      </div>
    );
  }

  return (
    <div className={className}>
      {header}

      <div className="flex gap-2 my-3">
        <button
          onClick={isThisHole ? stop : () => play(holeNumber, teeSet)}
          className="flex-1 py-2 px-3 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 flex items-center justify-center gap-2"
        >
          {isThisHole ? (
            <>
              <Square className="w-4 h-4" />
              Stop
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Play hole {holeNumber}
            </>
          )}
        </button>

        {isThisHole && isSpeaking && (
          <button
            onClick={isPaused ? resume : pause}
            aria-label={isPaused ? 'Resume narration' : 'Pause narration'}
            className="py-2 px-3 rounded-lg bg-muted hover:bg-accent"
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
        )}
      </div>

      <HoleScript paragraphs={paragraphs} highlighted={isThisHole} />

      {error && <p className="text-xs text-destructive mt-2">Narration failed: {error}</p>}

      <p className="text-[10px] text-muted-foreground mt-2">
        Wording from the club&apos;s printed yardage book.
        {isThisHole && source === 'browser' && ' Recorded voice unavailable - reading it out here.'}
      </p>
    </div>
  );
};

const HoleScript: React.FC<{ paragraphs: string[]; highlighted?: boolean }> = ({
  paragraphs,
  highlighted = false,
}) => (
  <div className={`p-3 rounded-lg space-y-2 ${highlighted ? 'bg-primary/10' : 'bg-accent/50'}`}>
    {paragraphs.map((paragraph, index) => (
      <p
        key={index}
        className={
          index === 0
            ? 'text-xs font-medium leading-relaxed'
            : 'text-xs text-muted-foreground leading-relaxed'
        }
      >
        {paragraph}
      </p>
    ))}
  </div>
);
