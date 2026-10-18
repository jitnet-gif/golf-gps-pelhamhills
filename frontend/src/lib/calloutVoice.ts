import { CALLOUT_CLIPS, CALLOUT_MAX_YARDS } from '@/data/calloutAudio';

/**
 * The yardage in the caddie's voice.
 *
 * The hole narration is ElevenLabs (data/narrationAudio.ts) and the yardage was
 * the phone's own robot next to it. A yardage cannot be baked as one file - the
 * number changes at every stop - so the numbers and the ends of the sentence are
 * baked separately (scripts/generate-callouts.mjs) and played back to back:
 *
 *   About | one hundred and forty two | yards to the pin.
 *
 * Everything is on the phone already, so it speaks on a fairway with no signal,
 * which is the whole point of this app. Anything the bank cannot say - a yardage
 * past the longest hole, a browser that will not play mp3, a clip still
 * downloading - falls back to the speech engine with the same words.
 */

export type CalloutTail = 'pin' | 'fairway' | 'straight';

export interface CalloutParts {
  /** The pin is off the map rather than surveyed: "About ...". */
  about: boolean;
  yards: number;
  tail: CalloutTail;
  /** Yards to the corner of a dogleg, when there is one ahead. */
  bendYards?: number | null;
  /** The straight-line figure, when it is far enough from the along-the-hole one. */
  straightYards?: number | null;
}

/**
 * The end of the sentence, closed or left open. Open when a bend or the
 * straight figure still has to be said - "to the pin. One fifty to the bend"
 * is two fragments where the words on screen are one sentence.
 */
const TAIL_ID: Record<CalloutTail, { closed: string; open: string }> = {
  pin: { closed: 'tail-pin', open: 'tail-pin-open' },
  fairway: { closed: 'tail-fairway', open: 'tail-fairway-open' },
  straight: { closed: 'tail-straight', open: 'tail-straight' },
};

const number = (yards: number): string | null => {
  const n = Math.round(yards);
  return n >= 1 && n <= CALLOUT_MAX_YARDS ? `n-${n}` : null;
};

/**
 * The clips that say this callout, in order - or null when the bank cannot say
 * it, which is the caller's cue to use the speech engine instead.
 */
export const calloutClipIds = (parts: CalloutParts): string[] | null => {
  const ids: string[] = [];
  if (parts.about) ids.push('about');
  const yards = number(parts.yards);
  if (!yards) return null;
  const more = parts.bendYards != null || parts.straightYards != null;
  ids.push(yards, more ? TAIL_ID[parts.tail].open : TAIL_ID[parts.tail].closed);
  if (parts.bendYards != null) {
    const bend = number(parts.bendYards);
    if (!bend) return null;
    ids.push(bend, parts.straightYards != null ? 'tail-bend-open' : 'tail-bend');
  }
  if (parts.straightYards != null) {
    const straight = number(parts.straightYards);
    if (!straight) return null;
    ids.push(straight, 'tail-straight-only');
  }
  return ids.every((id) => CALLOUT_CLIPS[id]) ? ids : null;
};

/** Is there a baked voice at all? A build without the clips falls back silently. */
export const hasCalloutVoice = (): boolean => Object.keys(CALLOUT_CLIPS).length > 0;

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

/**
 * One element, reused. A phone will only ever play one callout at a time, and an
 * element the player's first tap has already started is an element the browser
 * lets us play again without another tap - the same bargain the narration makes.
 */
let player: HTMLAudioElement | null = null;
let unlocked = false;
/** The run playing now, so a newer callout can cut an older one off. */
let run = 0;

const element = (): HTMLAudioElement | null => {
  if (typeof Audio === 'undefined') return null;
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
  }
  return player;
};

/**
 * Spend a tap on the audio element so later callouts are allowed to make a
 * sound. Called from the same handlers that unlock the narration.
 */
export const unlockCalloutVoice = async (): Promise<boolean> => {
  const audio = element();
  if (!audio || unlocked) return unlocked;
  try {
    // A silent, valid mp3 frame: playing it counts as the gesture.
    audio.src =
      'data:audio/mpeg;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA';
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    unlocked = true;
  } catch {
    unlocked = false;
  }
  return unlocked;
};

const playOne = (audio: HTMLAudioElement, url: string, mine: number): Promise<void> =>
  new Promise((resolve, reject) => {
    if (mine !== run) return resolve();
    const done = () => {
      audio.removeEventListener('ended', done);
      audio.removeEventListener('error', failed);
      resolve();
    };
    const failed = () => {
      audio.removeEventListener('ended', done);
      audio.removeEventListener('error', failed);
      reject(new Error(`callout clip failed: ${url}`));
    };
    audio.addEventListener('ended', done);
    audio.addEventListener('error', failed);
    audio.src = url;
    audio.currentTime = 0;
    audio.play().catch(failed);
  });

/**
 * Say a callout with the baked voice. Answers false when it could not - no
 * clips, no audio, or the browser refused - and the caller then speaks the same
 * words through the speech engine.
 */
export const playCallout = async (parts: CalloutParts): Promise<boolean> => {
  const ids = calloutClipIds(parts);
  const audio = element();
  if (!ids || !audio) return false;
  const mine = (run += 1);
  try {
    for (const id of ids) {
      if (mine !== run) return true; // a newer callout took over
      await playOne(audio, CALLOUT_CLIPS[id].url, mine);
    }
    return true;
  } catch {
    // Half a sentence is worse than none: stop, and let the caller say it all.
    audio.pause();
    return false;
  }
};

/** Cut a callout short - the hole narration is about to speak. */
export const stopCallout = () => {
  run += 1;
  player?.pause();
};
