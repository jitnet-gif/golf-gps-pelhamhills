// Pelham Hills Golf Club - 196 Webber Road, Pelham (Welland), ON L3B 5N8
//
// Pins and tees come from the club's Google Earth project "Pelham Hills Tee and
// Pin coordinates" (course-gps/pelham-hills-tee-pin.csv holds all four tees);
// the tee here is the white tee. Holes are numbered as that project numbers
// them, which the club confirmed is its own numbering. It is the printed
// yardage book's numbering with the nines the other way round, so hole N here
// is the book's page N+-9 - pelhamHillsBook.ts is filed the same way.
//
// Hole 11 has no pin in the project, so its pin is still OpenStreetMap's (way
// 56217508, ODbL). length is OSM's, metres along the hole's centreline.
// Placed on imagery, not stood on - see PIN_COORDINATES_VERIFIED.

/** One point on a hole's fairway line, [latitude, longitude]. */
export type FairwayPoint = [number, number];

export interface Hole {
  holeNumber: number;
  par: number;
  handicap: number;
  length: number;      // metres, tee to pin along centreline
  latitude: number;    // pin
  longitude: number;   // pin
  teeLatitude: number;
  teeLongitude: number;
  /**
   * Where the tee-to-pin line bends to follow the fairway, tee end first. The
   * tee and pin are not repeated - they have their own sources and move on
   * their own. Absent draws a straight line. Drawn in /admin/map, and used for
   * drawing only: nothing is measured against it.
   */
  path?: FairwayPoint[];
}

export const PELHAM_HILLS = {
  id: 'pelham-hills',
  name: 'Pelham Hills Golf Club',
  location: 'Pelham, Ontario, Canada',
  holes: 18,
  par: 71,
  center: { lat: 42.9837988, lng: -79.3007501 },
} as const;

export const PELHAM_HILLS_HOLES: Hole[] = [
  { holeNumber:  1, par: 5, handicap:  8, length: 424, latitude: 42.9848644, longitude: -79.2964008, teeLatitude: 42.9867890, teeLongitude: -79.3009216 },
  { holeNumber:  2, par: 4, handicap:  2, length: 287, latitude: 42.9844739, longitude: -79.3002091, teeLatitude: 42.9845416, teeLongitude: -79.2962150 },
  { holeNumber:  3, par: 3, handicap: 14, length: 125, latitude: 42.9836969, longitude: -79.2986115, teeLatitude: 42.9842198, teeLongitude: -79.3003112 },
  { holeNumber:  4, par: 4, handicap: 18, length: 392, latitude: 42.9801284, longitude: -79.2993280, teeLatitude: 42.9834257, teeLongitude: -79.2981540 },
  { holeNumber:  5, par: 4, handicap:  6, length: 336, latitude: 42.9810978, longitude: -79.2965069, teeLatitude: 42.9799442, teeLongitude: -79.2986171 },
  { holeNumber:  6, par: 4, handicap: 10, length: 289, latitude: 42.9834352, longitude: -79.2974376, teeLatitude: 42.9810309, teeLongitude: -79.2958628 },
  { holeNumber:  7, par: 3, handicap: 12, length: 121, latitude: 42.9841178, longitude: -79.2961687, teeLatitude: 42.9837288, teeLongitude: -79.2979619 },
  { holeNumber:  8, par: 4, handicap: 16, length: 298, latitude: 42.9871908, longitude: -79.2962411, teeLatitude: 42.9845227, teeLongitude: -79.2958179 },
  { holeNumber:  9, par: 4, handicap:  4, length: 281, latitude: 42.9868744, longitude: -79.2997055, teeLatitude: 42.9878200, teeLongitude: -79.2960284 },
  { holeNumber: 10, par: 4, handicap:  1, length: 338, latitude: 42.9833118, longitude: -79.3011269, teeLatitude: 42.9864196, teeLongitude: -79.3010763 },
  { holeNumber: 11, par: 4, handicap: 15, length: 157, latitude: 42.9814791, longitude: -79.2997647, teeLatitude: 42.9840324, teeLongitude: -79.3004578 },
  { holeNumber: 12, par: 5, handicap:  3, length: 427, latitude: 42.9822720, longitude: -79.3053916, teeLatitude: 42.9812892, teeLongitude: -79.3002111 },
  { holeNumber: 13, par: 4, handicap: 11, length: 322, latitude: 42.9824792, longitude: -79.3013747, teeLatitude: 42.9830750, teeLongitude: -79.3053472 },
  { holeNumber: 14, par: 3, handicap: 13, length: 170, latitude: 42.9839819, longitude: -79.3026301, teeLatitude: 42.9827683, teeLongitude: -79.3012514 },
  { holeNumber: 15, par: 5, handicap:  5, length: 477, latitude: 42.9872432, longitude: -79.3056218, teeLatitude: 42.9831922, teeLongitude: -79.3040602 },
  { holeNumber: 16, par: 3, handicap: 17, length: 122, latitude: 42.9873990, longitude: -79.3041568, teeLatitude: 42.9876085, teeLongitude: -79.3057181 },
  { holeNumber: 17, par: 4, handicap:  9, length: 307, latitude: 42.9846729, longitude: -79.3038394, teeLatitude: 42.9875949, teeLongitude: -79.3034094 },
  { holeNumber: 18, par: 4, handicap:  7, length: 334, latitude: 42.9877060, longitude: -79.3025428, teeLatitude: 42.9847295, teeLongitude: -79.3034007 },
];
