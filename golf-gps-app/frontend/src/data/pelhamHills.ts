// Pelham Hills Golf Club - 196 Webber Road, Pelham (Welland), ON L3B 5N8
// Source: OpenStreetMap way 56217508 (ODbL). par/handicap from golf=hole tags,
// pin positions from golf=pin nodes, length measured along hole centrelines.
// Replace with the API response once the backend is live.

export interface Hole {
  holeNumber: number;
  par: number;
  handicap: number;
  length: number;      // metres, tee to pin along centreline
  latitude: number;    // pin
  longitude: number;   // pin
  teeLatitude: number;
  teeLongitude: number;
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
  { holeNumber:  1, par: 5, handicap:  8, length: 424, latitude: 42.9848712, longitude: -79.2964241, teeLatitude: 42.9867767, teeLongitude: -79.3009328 },
  { holeNumber:  2, par: 4, handicap:  2, length: 287, latitude: 42.9844924, longitude: -79.3002131, teeLatitude: 42.9844693, teeLongitude: -79.2968544 },
  { holeNumber:  3, par: 3, handicap: 14, length: 125, latitude: 42.9837016, longitude: -79.2986088, teeLatitude: 42.9841492, teeLongitude: -79.3000214 },
  { holeNumber:  4, par: 5, handicap: 18, length: 392, latitude: 42.9801354, longitude: -79.2993226, teeLatitude: 42.9835456, teeLongitude: -79.2981148 },
  { holeNumber:  5, par: 4, handicap:  6, length: 336, latitude: 42.9811010, longitude: -79.2965137, teeLatitude: 42.9798868, teeLongitude: -79.2986809 },
  { holeNumber:  6, par: 4, handicap: 10, length: 289, latitude: 42.9834304, longitude: -79.2974607, teeLatitude: 42.9811120, teeLongitude: -79.2958587 },
  { holeNumber:  7, par: 3, handicap: 12, length: 121, latitude: 42.9841256, longitude: -79.2961747, teeLatitude: 42.9838398, teeLongitude: -79.2976146 },
  { holeNumber:  8, par: 4, handicap: 16, length: 298, latitude: 42.9871936, longitude: -79.2962567, teeLatitude: 42.9845292, teeLongitude: -79.2958245 },
  { holeNumber:  9, par: 4, handicap:  4, length: 281, latitude: 42.9869009, longitude: -79.2996796, teeLatitude: 42.9876177, teeLongitude: -79.2965523 },
  { holeNumber: 10, par: 4, handicap:  1, length: 338, latitude: 42.9832999, longitude: -79.3011038, teeLatitude: 42.9863438, teeLongitude: -79.3010870 },
  { holeNumber: 11, par: 3, handicap: 15, length: 157, latitude: 42.9814791, longitude: -79.2997647, teeLatitude: 42.9827074, teeLongitude: -79.3007131 },
  { holeNumber: 12, par: 5, handicap:  3, length: 427, latitude: 42.9822931, longitude: -79.3054001, teeLatitude: 42.9813220, teeLongitude: -79.3003284 },
  { holeNumber: 13, par: 4, handicap: 11, length: 322, latitude: 42.9825092, longitude: -79.3013989, teeLatitude: 42.9830509, teeLongitude: -79.3052841 },
  { holeNumber: 14, par: 3, handicap: 13, length: 170, latitude: 42.9839714, longitude: -79.3026284, teeLatitude: 42.9827975, teeLongitude: -79.3012926 },
  { holeNumber: 15, par: 5, handicap:  5, length: 477, latitude: 42.9872487, longitude: -79.3056709, teeLatitude: 42.9834798, teeLongitude: -79.3034185 },
  { holeNumber: 16, par: 3, handicap: 17, length: 122, latitude: 42.9874497, longitude: -79.3041946, teeLatitude: 42.9876180, teeLongitude: -79.3056757 },
  { holeNumber: 17, par: 4, handicap:  9, length: 307, latitude: 42.9846818, longitude: -79.3038477, teeLatitude: 42.9874356, teeLongitude: -79.3036566 },
  { holeNumber: 18, par: 4, handicap:  7, length: 334, latitude: 42.9877109, longitude: -79.3024831, teeLatitude: 42.9847944, teeLongitude: -79.3034122 },
];
