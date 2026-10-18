import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useTTS } from './useTTS';
import {
  blankReading,
  initialGuidanceState,
  nextTee,
  stepGuidance,
  type GuidanceOptions,
  type GuidanceReading,
  type GuidanceState,
  type GuidanceTee,
} from '@/lib/teeGuidance';

/**
 * Feeds the store's GPS fixes into the next-tee guidance and reads its cues out
 * loud. All of the judgement lives in lib/teeGuidance.ts; this is the wiring
 * that gives it a clock, a subscription and a voice.
 *
 * The opposite bargain to useHoleArrival on re-rendering: the arrival detector
 * mirrors only the candidate hole into state because a screen showing a
 * countdown is not what it is for, whereas this hook's whole output *is* a
 * countdown, so every believed fix publishes a reading. The anchor and the
 * spoken-band bookkeeping still live in a ref - a walk produces a fix a second,
 * and none of that is drawn.
 */

export interface TeeGuidance {
  /** The tee being walked to, or null when nothing is being guided. */
  tee: GuidanceTee | null;
  /** Distance, direction and turn, refreshed on every fix. */
  reading: GuidanceReading | null;
  /** Spend a tap on the speech engine so a later cue is allowed to be heard. */
  unlock: () => void;
}

export const useTeeGuidance = (
  holes: GuidanceTee[],
  /** The hole just finished. null switches guidance off. */
  fromHole: number | null,
  {
    speak = true,
    ...options
  }: Partial<GuidanceOptions> & { speak?: boolean } = {}
): TeeGuidance => {
  const gpsPosition = useAppStore((s) => s.gpsPosition);
  const tts = useTTS();

  const tee = useMemo(
    () => (fromHole === null ? null : nextTee(holes, fromHole)),
    [holes, fromHole]
  );

  const stateRef = useRef<GuidanceState>(initialGuidanceState);
  const [reading, setReading] = useState<GuidanceReading | null>(null);

  // Kept in a ref so the effect below does not restart - and every restart of
  // it would re-speak the band the player is already in.
  const speakRef = useRef(tts.speak);
  useEffect(() => {
    speakRef.current = tts.speak;
  }, [tts.speak]);

  // A new target is a new walk: the previous walk's heading was measured on the
  // way somewhere else, and its spoken bands belong to a distance that no longer
  // means anything.
  const targetHole = tee?.holeNumber ?? null;
  useEffect(() => {
    stateRef.current = initialGuidanceState;
    setReading(null);
  }, [targetHole]);

  const optionsKey = JSON.stringify(options);

  useEffect(() => {
    if (!tee) return;

    if (!gpsPosition) {
      setReading((prev) =>
        prev?.status === 'no-fix' ? prev : blankReading(tee.holeNumber, 'no-fix')
      );
      return;
    }

    const step = stepGuidance(
      stateRef.current,
      gpsPosition,
      tee,
      JSON.parse(optionsKey) as Partial<GuidanceOptions>
    );

    stateRef.current = step.state;
    setReading(step.reading);

    // The arrival cue is deliberately never spoken. Reaching the tee is what
    // useHoleArrival announces, and on a phone with narration armed that
    // announcement starts within the same second - speechSynthesis is one global
    // engine, so speaking here would cancel the hole being read. The card still
    // shows the arrival; only the voice stays out of the way.
    if (step.cue && speak && step.reading.status === 'ok') {
      speakRef.current(step.cue, { id: `tee-guidance-${tee.holeNumber}` });
    }
    // holes is rebuilt on every course-data swap; the tee it resolves to is what
    // matters, and that is in the dependency list as targetHole.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsPosition, targetHole, optionsKey, speak]);

  return { tee, reading, unlock: tts.unlock };
};
