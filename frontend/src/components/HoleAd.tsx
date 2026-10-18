import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { UtensilsCrossed, Volume2, X } from 'lucide-react';
import { useTTS } from '@/hooks';
import { HOLE_AD_LANG, type HoleAd as HoleAdCopy } from '@/data/holeAds';
import { holeAdClip } from '@/data/holeAdAudio';

/**
 * The club's offer on the 8th and 17th tees: food before the turn, a beer after
 * the round (see data/holeAds.ts for the words, which are the club's).
 *
 * It reads itself aloud when it appears, without waiting for the narration
 * switch - that switch is about the hole commentary, and the club wants these
 * two heard by everyone. Which is only possible because the round began with a
 * tap on the start card (RoundStartGate); where the browser refused it anyway,
 * the speaker button is the honest version of the same thing, and the words are
 * on screen either way.
 *
 * **It plays a baked clip, and only falls back to the speech engine.** That is
 * the fix for a line nobody could hear: the start card buys the right to play
 * an `<audio>` element, and `speechSynthesis` is a different engine that the
 * same tap does not reliably arm - on iOS especially, and on any phone with no
 * en-US voice installed it simply does nothing, silently. The yardage callouts
 * were already coming through the audio element, which is why those could be
 * heard and this could not. Now both are the same voice down the same path
 * (scripts/generate-hole-ads.mjs).
 *
 * It does not cover the map. A banner a player has to dismiss on the tee is a
 * banner they learn to dismiss before reading; this sits above the hole bar
 * until they close it or walk to the next hole.
 */

interface HoleAdProps {
  ad: HoleAdCopy;
  /**
   * Whether the round's start tap was granted. Not a gate any more - this card
   * always tries to speak, because the club asked for these two to be heard on
   * the 8th and the 17th without conditions. It is a retry signal: a tap that
   * lands after the first attempt failed makes it worth one more go.
   */
  canSpeak: boolean;
  /** Stop whatever else is talking (hole narration) before this does. */
  onBeforeSpeak?: () => void;
  onClose: () => void;
  className?: string;
}

export const HoleAd: React.FC<HoleAdProps> = ({
  ad,
  canSpeak,
  onBeforeSpeak,
  onClose,
  className = '',
}) => {
  const { isSupported, isSpeaking: isSpeakingTTS, speak, stop: stopTTS } = useTTS(HOLE_AD_LANG);
  const clip = holeAdClip(ad.holeNumber);

  // The element is kept for the life of the card, not made per play: the tap on
  // the start card unlocked *an* element, and a fresh one created later is
  // outside any gesture. One element, src swapped - the same bargain
  // useHoleNarration makes, and for the same reason.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingClip, setIsPlayingClip] = useState(false);

  // One reading per appearance. Without this, any re-render while the card is
  // up would start the line again over itself.
  //
  // Two refs, not one, because trying and being heard are different: an attempt
  // made before the browser granted audio produces nothing, and that hole still
  // deserves the second attempt the grant makes possible.
  const triedFor = useRef<number | null>(null);
  const heardFor = useRef<number | null>(null);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPlayingClip(false);
    stopTTS();
  }, [stopTTS]);

  /**
   * Say it. The clip if there is one, the speech engine if there is not - and
   * the speech engine again if the clip will not play, which is a phone that
   * cannot do mp3, a clip still downloading on a fairway, or an element the
   * browser refuses. Never both at once.
   */
  const say = useCallback(() => {
    onBeforeSpeak?.();

    const sayWithEngine = () => {
      if (!isSupported) return;
      speak(ad.body, { id: `hole-ad-${ad.holeNumber}`, lang: HOLE_AD_LANG });
    };

    if (!clip) {
      sayWithEngine();
      return;
    }

    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.preload = 'auto';
    audio.src = clip.url;
    audio.onplaying = () => {
      heardFor.current = ad.holeNumber;
    };
    audio.onended = () => setIsPlayingClip(false);
    audio.onerror = () => {
      setIsPlayingClip(false);
      sayWithEngine();
    };

    setIsPlayingClip(true);
    void audio.play().catch(() => {
      // Refused, or the file is not there. The words still have to be said.
      setIsPlayingClip(false);
      sayWithEngine();
    });
    // onBeforeSpeak is a fresh function each render and must not re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.body, ad.holeNumber, clip, isSupported, speak]);

  useEffect(() => {
    if (!clip && !isSupported) return;
    // Something is already coming out of the speaker. Whatever this effect
    // thinks it knows, it is not worth talking over.
    if (isPlayingClip) return;

    // Never tried for this hole: try, whatever the browser has granted. A
    // refused play() costs nothing and falls through to the speech engine, and
    // a card that stayed silent because a flag said it would be silent is the
    // bug this replaced.
    const firstGo = triedFor.current !== ad.holeNumber;
    // Tried, made no sound, and the tap has landed since. Worth one more.
    const worthRetry = canSpeak && heardFor.current !== ad.holeNumber;
    if (!firstGo && !worthRetry) return;

    triedFor.current = ad.holeNumber;
    say();
  }, [ad.holeNumber, canSpeak, clip, isPlayingClip, isSupported, say]);

  // The speech engine has no "it actually started" of its own that this can
  // watch, so its own speaking flag is the answer.
  useEffect(() => {
    if (isSpeakingTTS) heardFor.current = ad.holeNumber;
  }, [isSpeakingTTS, ad.holeNumber]);

  // Walking off the hole, or closing the card, stops the voice with it.
  useEffect(() => () => stop(), [stop]);

  const isSpeaking = isSpeakingTTS || isPlayingClip;

  const readAloud = () => {
    if (isSpeaking) {
      stop();
      return;
    }
    say();
  };

  return (
    <div
      className={`rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-lg dark:border-amber-700 dark:bg-amber-950 ${className}`}
      role="status"
    >
      <div className="flex items-start gap-2">
        <UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
            Hole {ad.holeNumber} · {ad.title}
          </p>
          <p className="mt-1 break-keep text-sm leading-snug text-amber-950 dark:text-amber-100">
            {ad.body}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <Link
          href="/food"
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 text-sm font-bold text-white hover:opacity-90"
        >
          <UtensilsCrossed className="h-4 w-4" />
          {ad.cta}
        </Link>
        {(isSupported || clip) && (
          <button
            type="button"
            onClick={readAloud}
            aria-label={isSpeaking ? 'Stop' : 'Read this aloud'}
            aria-pressed={isSpeaking}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-300 dark:border-amber-700 ${
              isSpeaking
                ? 'bg-amber-600 text-white'
                : 'bg-white text-amber-800 dark:bg-amber-900 dark:text-amber-200'
            }`}
          >
            <Volume2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};
