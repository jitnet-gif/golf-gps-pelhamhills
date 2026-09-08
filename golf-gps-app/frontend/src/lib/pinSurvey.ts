import { db, type PinSurvey, type SurveyedPoint } from '@/db';

export type { PinSurvey, SurveyedPoint };

/**
 * On-course pin survey: reading and writing the coordinates a player captured
 * by standing on the pin and the tee.
 *
 * Why this exists at all: the coordinates bundled with the app came from
 * OpenStreetMap, whose tags for this course disagree with the club's own card
 * on 8 of 18 pars and on every handicap, so no hole's pin is known to belong to
 * the hole number the club uses. Until a hole is surveyed the app shows the
 * printed yardage and says the pin is unsurveyed - see
 * PIN_COORDINATES_VERIFIED in pelhamHillsBook.ts. A row written here is what
 * turns the live distances on, for that hole only.
 */

/** A fix looser than this is worse than the yardage printed on the card. */
export const GOOD_FIX_METRES = 10;

export const surveyId = (courseId: string, holeNumber: number): string =>
  `${courseId}:${holeNumber}`;

export const loadSurveys = async (courseId: string): Promise<PinSurvey[]> => {
  try {
    return await db.pinSurveys.where('courseId').equals(courseId).toArray();
  } catch {
    return [];
  }
};

/**
 * Record one captured point, leaving the other one alone - the pin and the tee
 * are captured minutes and a few hundred yards apart.
 */
export const saveSurveyPoint = async (
  courseId: string,
  holeNumber: number,
  which: 'pin' | 'tee',
  point: SurveyedPoint
): Promise<PinSurvey> => {
  const id = surveyId(courseId, holeNumber);
  const existing = await db.pinSurveys.get(id);
  const next: PinSurvey = {
    ...(existing ?? { id, courseId, holeNumber }),
    [which]: point,
  };
  await db.pinSurveys.put(next);
  return next;
};

export const clearSurvey = async (
  courseId: string,
  holeNumber: number
): Promise<void> => {
  await db.pinSurveys.delete(surveyId(courseId, holeNumber));
};

/**
 * The captures as source someone can paste into pelhamHills.ts, plus the
 * PIN_COORDINATES_VERIFIED flips they justify.
 *
 * Captures live in one phone's IndexedDB until they are written into the repo,
 * and clearing site data would throw away an 18-hole walk. Exporting is how the
 * survey stops being disposable.
 */
export const exportSurveys = (surveys: PinSurvey[]): string => {
  const done = [...surveys].sort((a, b) => a.holeNumber - b.holeNumber);
  if (done.length === 0) return '// No holes surveyed yet.';

  const coord = (n: number) => n.toFixed(7);
  const lines = done.map((s) => {
    const parts = [`  ${s.holeNumber}:`];
    if (s.pin) {
      parts.push(
        `latitude: ${coord(s.pin.latitude)}, longitude: ${coord(s.pin.longitude)},`
      );
    }
    if (s.tee) {
      parts.push(
        `teeLatitude: ${coord(s.tee.latitude)}, teeLongitude: ${coord(s.tee.longitude)},`
      );
    }
    const acc = [
      s.pin ? `pin ±${Math.round(s.pin.accuracy)}m` : 'pin MISSING',
      s.tee ? `tee ±${Math.round(s.tee.accuracy)}m` : 'tee MISSING',
    ].join(', ');
    return `${parts.join(' ')}   // ${acc}`;
  });

  // Only a hole with a pin can be trusted for distances; the tee only draws the
  // centreline, so its absence must not flip the flag.
  const verified = done
    .filter((s) => s.pin)
    .map((s) => `  ${s.holeNumber}: true,`);

  return [
    '// Surveyed on site. Paste the coordinates into PELHAM_HILLS_HOLES,',
    '// then set these holes true in PIN_COORDINATES_VERIFIED.',
    ...lines,
    '',
    '// PIN_COORDINATES_VERIFIED',
    ...(verified.length ? verified : ['  // (no hole has a pin captured yet)']),
  ].join('\n');
};
