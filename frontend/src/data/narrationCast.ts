/**
 * Who reads each hole.
 *
 * Every hole has its own character: a different ElevenLabs voice with a bright,
 * upbeat delivery, so eighteen holes do not sound like one long recording and a
 * player half-listening on the tee can tell a new hole has started.
 *
 * One voice per hole, never per clip. A hole is two clips played back to back -
 * the card figures, then the club's commentary (see narrationScript.ts) - and
 * they have to sound like one person talking.
 *
 * Only the voice changes. The words are still the club's book, quoted verbatim
 * by narrationScript.ts; a character's name is shown on screen, never spoken.
 *
 * scripts/generate-narration.mjs reads this file as well as the app. A hole's
 * voice and settings are part of its clips' hash, so changing one character
 * re-bakes that hole on the next run and nothing else.
 */

export interface NarrationVoiceSettings {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
}

export interface NarrationCharacter {
  name: string;
  /** A few words on how they sound, shown under the play button. */
  vibe: string;
  voiceId: string;
  settings: NarrationVoiceSettings;
}

/**
 * Livelier than ElevenLabs' defaults: lower stability lets the delivery move, a
 * little style adds energy, and full speed keeps it brisk. Not further than
 * this - much below 0.4 stability the two clips of one hole start to sound like
 * two different takes, and the seam between them shows.
 */
export const CHEERFUL: NarrationVoiceSettings = {
  stability: 0.4,
  similarityBoost: 0.75,
  style: 0.3,
  speed: 1.0,
};

const character = (
  name: string,
  vibe: string,
  voiceId: string,
  settings: NarrationVoiceSettings = CHEERFUL
): NarrationCharacter => ({ name, vibe, voiceId, settings });

/**
 * ElevenLabs premade voices, all checked to synthesise on this account. Women and
 * men alternate so that neighbouring holes never share a register.
 */
export const NARRATION_CAST: Readonly<Record<number, NarrationCharacter>> = {
  1: character('Callum', 'a little mischievous', 'N2lVS1w4EtoT3dr4eOWO'),
  2: character('Alice', 'crisp and cheerful', 'Xb7hH8MSUJpSbSDYk0k2'),
  3: character('Roger', 'laid-back', 'CwhRBWXzGAHq8TQ4Fs17'),
  4: character('Sarah', 'confident', 'EXAVITQu4vr4xnSDxMaL'),
  5: character('Eric', 'smooth', 'cjVigY5qzO86Huf0OWal'),
  6: character('Charlotte', 'breezy', 'XB0fDUnXU5powFXDhCwa'),
  7: character('River', 'relaxed', 'SAz9YHcvj6GT2YYXdXww'),
  8: character('Daniel', 'the broadcaster', 'onwK4e9ZLuTAKqWW03F9'),
  9: character('George', 'storyteller for the finish', 'JBFqnCBsd6RMkjVDRZzb'),
  10: character('Jessica', 'bright and playful', 'cgSgspJ2msm6clMCkdW9'),
  11: character('Liam', 'full of energy', 'TX3LPaxmHKxFdv7VOQHJ'),
  12: character('Laura', 'upbeat and quirky', 'FGY2WhTYpPnrIDTdsKH5'),
  13: character('Charlie', 'easy-going Aussie', 'IKne3meq5aSn9XLyUdCD'),
  14: character('Matilda', 'friendly', 'XrExE9yKIg1WjnnlVkGX'),
  15: character('Will', 'sunny optimist', 'bIHbv24MWmeRgasZH58o'),
  16: character('Lily', 'warm and British', 'pFZP5JQG7iQjIQuC4Bku'),
  17: character('Chris', 'down-to-earth charm', 'iP95p4xoKVk53GoZ742B'),
  18: character('Aria', 'expressive', '9BWtsMINqrJLrRacOk9x'),
};
