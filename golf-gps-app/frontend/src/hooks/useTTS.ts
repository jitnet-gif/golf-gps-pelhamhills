import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Web Speech API narration.
 *
 * Chosen over a cloud voice because the OS engine works with no network, which is
 * the point of this app - see useOfflineMode. Watch the platform quirks:
 * - iOS Safari only starts speech from inside a user gesture, so never autoplay.
 * - Chrome cuts off long utterances, so text is chunked to sentence-sized pieces.
 * - speechSynthesis is a page-global singleton, so we cancel on unmount.
 * - onend does not fire reliably after cancel(), so state is reset by hand.
 */

const MAX_CHUNK_LENGTH = 180;

/** Splits text into utterance-sized chunks, preferring sentence boundaries. */
export function splitIntoChunks(text: string, maxLength = MAX_CHUNK_LENGTH): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let buffer = '';

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) chunks.push(trimmed);
    buffer = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      flush();
      // A single sentence longer than the limit: break it on word boundaries.
      let line = '';
      for (const word of sentence.split(/\s+/)) {
        if (line && line.length + word.length + 1 > maxLength) {
          chunks.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) chunks.push(line);
    } else if (buffer.length + sentence.length > maxLength) {
      flush();
      buffer = sentence;
    } else {
      buffer += sentence;
    }
  }
  flush();

  return chunks;
}

export interface SpeakOptions {
  /** Caller-supplied tag echoed back as `speakingId`, so a list can show what is playing. */
  id?: string;
  lang?: string;
  rate?: number;
  pitch?: number;
}

export function useTTS(defaultLang = 'en-US') {
  const [isSupported] = useState(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window
  );
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const queueRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  // Bumped on every speak/stop so callbacks from a cancelled run are ignored.
  const runIdRef = useRef(0);
  const optionsRef = useRef<SpeakOptions>({});
  const isPausedRef = useRef(false);

  // getVoices() is empty until the engine loads them on Chrome.
  useEffect(() => {
    if (!isSupported) return;

    const synth = window.speechSynthesis;
    const readVoices = () => setVoices(synth.getVoices());

    readVoices();
    synth.addEventListener('voiceschanged', readVoices);
    return () => synth.removeEventListener('voiceschanged', readVoices);
  }, [isSupported]);

  const resetState = useCallback(() => {
    queueRef.current = [];
    indexRef.current = 0;
    isPausedRef.current = false;
    setIsSpeaking(false);
    setIsPaused(false);
    setSpeakingId(null);
  }, []);

  const pickVoice = useCallback(
    (lang: string) => {
      const prefix = lang.split('-')[0];
      return (
        voices.find((v) => v.lang === lang) ??
        voices.find((v) => v.lang.startsWith(prefix)) ??
        null
      );
    },
    [voices]
  );

  const speakNext = useCallback(
    (runId: number) => {
      if (runId !== runIdRef.current) return;

      if (indexRef.current >= queueRef.current.length) {
        resetState();
        return;
      }
      const chunk = queueRef.current[indexRef.current];

      const { lang = defaultLang, rate = 0.95, pitch = 1 } = optionsRef.current;
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = lang;
      utterance.rate = rate;
      utterance.pitch = pitch;

      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;

      utterance.onend = () => {
        if (runId !== runIdRef.current) return;
        indexRef.current += 1;
        speakNext(runId);
      };

      utterance.onerror = (event) => {
        if (runId !== runIdRef.current) return;
        // 'interrupted'/'canceled' just mean we called cancel() ourselves.
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        setError(event.error || 'speech-failed');
        runIdRef.current += 1;
        resetState();
      };

      window.speechSynthesis.speak(utterance);
    },
    [defaultLang, pickVoice, resetState]
  );

  /** Must be called from a user gesture - iOS Safari refuses otherwise. */
  const speak = useCallback(
    (text: string, options: SpeakOptions = {}) => {
      if (!isSupported || !text.trim()) return;

      window.speechSynthesis.cancel();
      // cancel() leaves the engine's paused flag set, which would silently swallow
      // everything queued below. resume() on a running engine is a no-op.
      window.speechSynthesis.resume();
      runIdRef.current += 1;
      const runId = runIdRef.current;

      setError(null);
      optionsRef.current = options;
      queueRef.current = splitIntoChunks(text);
      indexRef.current = 0;
      isPausedRef.current = false;
      setIsPaused(false);
      setIsSpeaking(true);
      setSpeakingId(options.id ?? null);

      speakNext(runId);
    },
    [isSupported, speakNext]
  );

  const stop = useCallback(() => {
    if (!isSupported) return;
    runIdRef.current += 1;
    window.speechSynthesis.cancel();
    resetState();
  }, [isSupported, resetState]);

  const pause = useCallback(() => {
    if (!isSupported || !isSpeaking) return;
    window.speechSynthesis.pause();
    isPausedRef.current = true;
    setIsPaused(true);
  }, [isSupported, isSpeaking]);

  const resume = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.resume();
    isPausedRef.current = false;
    setIsPaused(false);
  }, [isSupported]);

  // Chrome pauses the engine on its own after ~15s of speech; a periodic resume()
  // while we are meant to be speaking is a no-op otherwise.
  useEffect(() => {
    if (!isSupported || !isSpeaking) return;

    const keepAlive = window.setInterval(() => {
      if (!isPausedRef.current) window.speechSynthesis.resume();
    }, 10000);

    return () => window.clearInterval(keepAlive);
  }, [isSupported, isSpeaking]);

  // speechSynthesis outlives the component, so silence it on the way out.
  useEffect(() => {
    if (!isSupported) return;
    return () => {
      runIdRef.current += 1;
      window.speechSynthesis.cancel();
    };
  }, [isSupported]);

  return {
    isSupported,
    isSpeaking,
    isPaused,
    speakingId,
    error,
    voices,
    speak,
    stop,
    pause,
    resume,
  };
}
