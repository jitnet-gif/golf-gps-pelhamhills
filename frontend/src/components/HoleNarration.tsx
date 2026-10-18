import React, { useEffect, useMemo, useRef } from 'react';
import { Volume2, Play, Pause, Square } from 'lucide-react';
import { narrationId, type HoleNarrationState } from '@/hooks/useHoleNarration';
import { buildHoleScript, narrationDescriptionId } from '@/lib/narrationScript';
import { NARRATION_DESCRIPTIONS } from '@/data/narrationAudio';
import { NARRATION_CAST, type NarrationCharacter } from '@/data/narrationCast';
import type { TeeSet } from '@/data/pelhamHillsBook';

interface HoleNarrationProps {
  holeNumber: number;
  teeSet: TeeSet;
  /**
   * The page's one playback engine, passed in rather than created here.
   *
   * This panel lives inside the side menu, which is unmounted for most of a
   * round, while narration is also started by GPS arrival from the page itself.
   * A hook instance per consumer would mean an audio element per consumer - two
   * voices able to read two different holes over each other, and only the page's
   * surviving to be stopped.
   */
  narration: HoleNarrationState;
  className?: string;
}

/**
 * The character reading this hole - but only once their voice is really the one
 * on the recorded clip. Until a hole has been re-baked with its cast voice, the
 * old recording is still what plays, and naming a character over someone else's
 * voice would be a small lie on screen.
 */
const narrationGuide = (holeNumber: number): NarrationCharacter | null => {
  const character = NARRATION_CAST[holeNumber];
  const clip = NARRATION_DESCRIPTIONS[narrationDescriptionId(holeNumber)];
  return character && clip?.voiceId === character.voiceId ? character : null;
};

/**
 * Reads a hole to a player standing on the tee, from a tap on this panel. The
 * other way it starts is GPS arrival, which the page handles - and which is only
 * able to make a sound because choosing Auto in AutoNarration spent a tap on the
 * browser's audio permission first. Nothing here plays without one or the other:
 * both the recorded clips and the browser voice refuse a first sound that no
 * gesture ever asked for.
 *
 * The commentary is quoted from the club's printed yardage book and nothing else is
 * added to it, so the script doubles as the on-screen text for players who would
 * rather read than listen. buildHoleScript is what both the screen and the
 * ElevenLabs generator read from - see lib/narrationScript.ts. Each hole has its
 * own voice (data/narrationCast.ts); the character is named here, never in the
 * audio.
 */
export const HoleNarration: React.FC<HoleNarrationProps> = ({
  holeNumber,
  teeSet,
  narration,
  className = '',
}) => {
  const { isSupported, isSpeaking, isPaused, speakingId, source, error, play, stop, pause, resume } =
    narration;

  const script = useMemo(() => buildHoleScript(holeNumber, teeSet), [holeNumber, teeSet]);
  const paragraphs = useMemo(() => script.split('\n\n'), [script]);
  const guide = narrationGuide(holeNumber);

  const thisHoleId = narrationId(holeNumber, teeSet);
  const isThisHole = speakingId === thisHoleId;

  // Walking to the next hole - or switching tees - makes the queued script stale.
  // Silence it rather than let the player hear the hole they just left.
  //
  // Keyed on the script rather than written as an unmount cleanup: the engine now
  // belongs to the page, so this panel disappearing (the side menu closing) is no
  // longer a reason to stop anything, but the hole changing under it still is.
  const spokenScriptRef = useRef<string | null>(null);
  useEffect(() => {
    if (isThisHole) spokenScriptRef.current = script;
  }, [isThisHole, script]);

  useEffect(() => {
    if (spokenScriptRef.current !== null && spokenScriptRef.current !== script) {
      spokenScriptRef.current = null;
      stop();
    }
  }, [script, stop]);

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

      {guide && (
        <p className="mt-1 text-xs text-muted-foreground">
          Your guide: <span className="font-medium text-foreground">{guide.name}</span> · {guide.vibe}
        </p>
      )}

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
