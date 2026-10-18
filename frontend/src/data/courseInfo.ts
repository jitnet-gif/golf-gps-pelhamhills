// Pelham Hills Golf Club - the club's own course introduction, read aloud in-app.
// Source: https://pelhamhills.com/ and https://pelhamhills.com/about/ (fetched 2026-09-07).
//
// Every string below is quoted from the club's pages - the narration speaks in
// the club's voice and must only say what the club says. Keep all spoken copy in
// this file so a translated locale can be added as data, not as new component logic.
//
// This file is the course-level introduction only. The club's website carries no
// hole-by-hole commentary, but its printed yardage book does, and that text is
// transcribed in pelhamHillsBook.ts (PELHAM_HILLS_BOOK[].description) and spoken
// by the per-hole narration. So "the club publishes nothing hole-by-hole" is no
// longer a reason to leave hole narration out - just keep quoting, not writing.

export interface CourseInfoSection {
  id: string;
  title: string;
  /** Spoken verbatim by the text-to-speech guide. */
  body: string;
}

export const PELHAM_HILLS_INFO_SOURCE = 'https://pelhamhills.com/about/';

/** BCP 47 tag handed to SpeechSynthesisUtterance for this copy. */
export const PELHAM_HILLS_INFO_LANG = 'en-US';

export const PELHAM_HILLS_INFO: CourseInfoSection[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    body:
      'Pelham Hills Golf Club. Where Great Rounds Begin. Established in 1966, ' +
      'Pelham Hills Golf Club offers an 18-hole, parkland-style course in the heart ' +
      'of the Niagara Region. Defined by rolling terrain, mature trees, and natural ' +
      'water features woven throughout the landscape, the 6,900 yard, par 71 course ' +
      'offers a scenic and memorable round for all players.',
  },
  {
    id: 'amenities',
    title: 'On the course',
    body:
      'We offer a modern fleet of EZ-GO lithium electric power carts for all golfers ' +
      'and tournament bookings for up to 120 players with banquet-style meal and ' +
      'beverage services. Our on-course beverage cart is available for your ' +
      'convenience during your round, as well as our clubhouse snack-bar for ' +
      'delicious on-the-go options.',
  },
  {
    id: 'year-round',
    title: 'Year-round golf',
    body:
      'Golf does not stop when the weather changes, and neither do we. With our ' +
      'state-of-the-art golf simulators, restaurant, and bar, PH Indoor Golf offers ' +
      'year-round amenities for you to perfect your swing, sip, and socialize.',
  },
];

/** The whole introduction, in order, for the "Play all" control. */
export const PELHAM_HILLS_INFO_SCRIPT = PELHAM_HILLS_INFO.map((s) => s.body).join(' ');
