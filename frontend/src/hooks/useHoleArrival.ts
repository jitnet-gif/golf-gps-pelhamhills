import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import {
  armFrom as armFromHole,
  initialArrivalState,
  markAnnounced,
  stepArrival,
  type ArrivalHole,
  type ArrivalOptions,
  type ArrivalState,
} from '@/lib/holeArrival';

/**
 * Feeds the store's GPS fixes into the arrival detector and reports the moment a
 * hole is reached. All of the judgement lives in lib/holeArrival.ts; this is the
 * wiring that gives it a clock and a subscription.
 *
 * The detector's state is a ref, not React state: it changes on every fix, and a
 * player walking a fairway produces one a second. Only the small part a screen
 * would draw - which hole is being dwelt on - is mirrored into state, so a
 * re-render happens when the candidate changes rather than when the player moves.
 *
 * This sees the newest fix in the store rather than a queue of every fix, so two
 * arriving inside one render pass would lose the earlier one. That costs nothing:
 * the dwell is measured from the anchor fix's own timestamp, not by counting
 * fixes, so a dropped one neither lengthens nor shortens it. It is also why the
 * detector takes the timestamp from the fix instead of reading a clock - the same
 * walk replays identically whether it arrives live or all at once.
 */

export interface HoleArrivalState {
  /** The hole currently being dwelt on, before the dwell is complete. */
  candidateHole: number | null;
  /** Holes announced so far this round, oldest first. */
  announced: number[];
  /**
   * Record a hole as announced without waiting for a fix - what a manual tap
   * means. It also re-arms the sequence from that hole, so a player who starts
   * on the 10th tee taps once and is tracked from there.
   */
  markPlayed: (holeNumber: number) => void;
  /**
   * Watch for this hole's tee (and the next): the player picked it by hand, so
   * that is where they are - see armFrom in lib/holeArrival.
   */
  armFrom: (holeNumber: number) => void;
  /** Forget the round: nothing announced, no candidate. */
  reset: () => void;
}

export const useHoleArrival = (
  holes: ArrivalHole[],
  onArrive: (holeNumber: number) => void,
  { enabled = true, ...options }: Partial<ArrivalOptions> & { enabled?: boolean } = {}
): HoleArrivalState => {
  const gpsPosition = useAppStore((s) => s.gpsPosition);

  const stateRef = useRef<ArrivalState>(initialArrivalState);
  const [mirror, setMirror] = useState<{ candidateHole: number | null; announced: number[] }>(
    { candidateHole: null, announced: [] }
  );

  // Kept in a ref so a caller may pass an inline arrow without restarting the
  // detector - and restarting it would drop a dwell already half elapsed.
  const onArriveRef = useRef(onArrive);
  useEffect(() => {
    onArriveRef.current = onArrive;
  }, [onArrive]);

  const publish = useCallback((next: ArrivalState) => {
    stateRef.current = next;
    setMirror((prev) =>
      prev.candidateHole === (next.candidate?.holeNumber ?? null) &&
      prev.announced.length === next.announced.length
        ? prev
        : {
            candidateHole: next.candidate?.holeNumber ?? null,
            announced: next.announced,
          }
    );
  }, []);

  const optionsKey = JSON.stringify(options);

  useEffect(() => {
    if (!enabled || !gpsPosition) return;

    const { state, arrivedAt } = stepArrival(
      stateRef.current,
      gpsPosition,
      holes,
      JSON.parse(optionsKey) as Partial<ArrivalOptions>
    );

    publish(state);
    if (arrivedAt !== null) onArriveRef.current(arrivedAt);
    // holes is rebuilt on every course-data swap; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, gpsPosition, holes, optionsKey, publish]);

  // Switching the feature off mid-round clears the half-finished dwell but keeps
  // what has already been announced, so switching it back on does not replay the
  // front nine.
  useEffect(() => {
    if (!enabled && stateRef.current.candidate !== null) {
      publish({ ...stateRef.current, candidate: null });
    }
  }, [enabled, publish]);

  const markPlayed = useCallback(
    (holeNumber: number) => publish(markAnnounced(stateRef.current, holeNumber)),
    [publish]
  );

  const armFrom = useCallback(
    (holeNumber: number) => publish(armFromHole(stateRef.current, holeNumber)),
    [publish]
  );

  const reset = useCallback(() => publish(initialArrivalState), [publish]);

  return {
    candidateHole: mirror.candidateHole,
    announced: mirror.announced,
    markPlayed,
    armFrom,
    reset,
  };
};
