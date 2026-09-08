import { useCallback, useEffect, useRef, useState } from 'react';
import { narrationClips } from '@/data/narrationAudio';
import { buildHoleScriptParts } from '@/lib/narrationScript';
import type { TeeSet } from '@/data/pelhamHillsBook';
import { useTTS } from './useTTS';

/**
 * Reads a hole aloud, preferring the recorded ElevenLabs clips and falling back
 * to the browser's own voice.
 *
 * Why both: the recorded voice is the one worth listening to for four hours, but
 * it is a file, and a file can be missing - not yet generated, evicted from the
 * cache, or simply never downloaded before the player walked out of signal. The
 * Web Speech engine needs no network at all, so it is what stands behind every
 * clip rather than an error message. See useTTS for its platform quirks.
 *
 * A hole is two clips (card figures, then the club's commentary - see
 * narrationScript.ts for why they are cut separately). They are played through
 * ONE audio element with its src swapped, not two elements: iOS unlocks the
 * element that was played from a user gesture, and a second element calling
 * play() from an `ended` handler is outside any gesture and gets refused. The
 * second clip is warmed with fetch() while the first plays, so swapping the src
 * hits the cache instead of the network.
 */

export type NarrationSource = 'recorded' | 'browser';

export interface HoleNarrationState {
  isSupported: boolean;
  isSpeaking: boolean;
  isPaused: boolean;
  /** `hole-{n}-{tee}`, or null when nothing is playing. */
  speakingId: string | null;
  /** What is actually producing sound right now. */
  source: NarrationSource | null;
  error: string | null;
  /** Must be called from a user gesture - both engines refuse otherwise. */
  play: (holeNumber: number, teeSet: TeeSet) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

export const narrationId = (holeNumber: number, teeSet: TeeSet): string =>
  `hole-${holeNumber}-${teeSet}`;

/** True when this hole has recorded clips on the manifest. */
export const hasRecordedNarration = (holeNumber: number, teeSet: TeeSet): boolean =>
  narrationClips(holeNumber, teeSet).length > 0;

export function useHoleNarration(): HoleNarrationState {
  const tts = useTTS();

  const [audioId, setAudioId] = useState<string | null>(null);
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Bumped on every play/stop so callbacks from an abandoned run are ignored -
  // the same guard useTTS uses, and for the same reason.
  const runIdRef = useRef(0);

  const stopAudio = useCallback(() => {
    runIdRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      // Detach the source so a half-downloaded clip stops occupying the
      // connection; the element itself is kept, because it is the one iOS
      // unlocked.
      audio.removeAttribute('src');
      audio.load();
    }
    setAudioId(null);
    setIsAudioPaused(false);
  }, []);

  const stop = useCallback(() => {
    stopAudio();
    tts.stop();
  }, [stopAudio, tts]);

  const play = useCallback(
    (holeNumber: number, teeSet: TeeSet) => {
      const parts = buildHoleScriptParts(holeNumber, teeSet);
      if (!parts) return;

      const id = narrationId(holeNumber, teeSet);
      const clips = narrationClips(holeNumber, teeSet);
      const texts = [parts.card, parts.description];

      // Whatever was running belongs to the hole the player just left.
      stopAudio();
      tts.stop();
      setAudioError(null);

      /** Read the script from clip `from` onwards with the browser voice. */
      const fallbackFrom = (from: number, reason: string) => {
        stopAudio();
        setAudioError(reason);
        tts.speak(texts.slice(from).join('\n\n'), { id });
      };

      if (clips.length === 0) {
        tts.speak(texts.join('\n\n'), { id });
        return;
      }

      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.preload = 'auto';

      runIdRef.current += 1;
      const runId = runIdRef.current;
      const isStale = () => runId !== runIdRef.current;

      const startClip = (index: number) => {
        if (isStale()) return;

        audio.onended = () => {
          if (isStale()) return;
          if (index + 1 < clips.length) {
            startClip(index + 1);
          } else {
            setAudioId(null);
            setIsAudioPaused(false);
          }
        };

        audio.onerror = () => {
          if (isStale()) return;
          // Offline with nothing cached, or a clip that never made it into the
          // build. Speak the rest rather than stopping mid-hole.
          fallbackFrom(index, 'clip-unavailable');
        };

        audio.src = clips[index].url;
        audio.currentTime = 0;

        void audio
          .play()
          .then(() => {
            if (isStale()) return;
            setAudioId(id);
            setIsAudioPaused(false);
            // Pull the next clip into the cache while this one is being heard,
            // so the src swap at `ended` does not stall on the network.
            const next = clips[index + 1];
            if (next) void fetch(next.url).catch(() => undefined);
          })
          .catch((cause: unknown) => {
            if (isStale()) return;
            const name = cause instanceof Error ? cause.name : 'play-failed';
            fallbackFrom(index, name);
          });
      };

      startClip(0);
    },
    [stopAudio, tts]
  );

  const pause = useCallback(() => {
    if (audioId) {
      audioRef.current?.pause();
      setIsAudioPaused(true);
      return;
    }
    tts.pause();
  }, [audioId, tts]);

  const resume = useCallback(() => {
    if (audioId) {
      void audioRef.current?.play().catch(() => undefined);
      setIsAudioPaused(false);
      return;
    }
    tts.resume();
  }, [audioId, tts]);

  // The element outlives React's tree the way speechSynthesis does, so silence
  // it on the way out.
  useEffect(
    () => () => {
      runIdRef.current += 1;
      audioRef.current?.pause();
    },
    []
  );

  return {
    // There is always a voice: an audio element if the clips are there, the
    // speech engine if they are not. Only a browser with neither is unsupported.
    isSupported: typeof Audio !== 'undefined' || tts.isSupported,
    isSpeaking: audioId !== null || tts.isSpeaking,
    isPaused: audioId !== null ? isAudioPaused : tts.isPaused,
    speakingId: audioId ?? tts.speakingId,
    source: audioId !== null ? 'recorded' : tts.isSpeaking ? 'browser' : null,
    // The audio error is only worth showing if the fallback failed too - on its
    // own it means "the recorded clip was missing", which the player heard us
    // recover from.
    error: tts.error ?? (tts.isSpeaking ? null : audioError),
    play,
    stop,
    pause,
    resume,
  };
}
