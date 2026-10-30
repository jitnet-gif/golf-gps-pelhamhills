/**
 * The club's printed whole-course map (현시스템 지도), laid on the satellite map.
 *
 * scripts/georef-course-map.py turns the yardage book's picture north-up, turns
 * its hole numbers back so they read, and bends it so each hole's drawn tee and
 * green sit on that hole's tee and pin in the course data. It prints this
 * constant: the picture's corners (south-west, north-east) and where each
 * printed number disc landed - the Full map puts a tap target on each, so a
 * number on the drawing is the way into its hole, as the badges are on the
 * satellite map.
 */
export const COURSE_MAP_OVERLAY = {
  url: '/course/course-map-geo.webp',
  bounds: [[42.9792681, -79.3067993], [42.9886908, -79.2945951]],
  numbers: [
    { holeNumber: 1, lat: 42.9853850, lng: -79.2979695 },
    { holeNumber: 2, lat: 42.9847459, lng: -79.2984108 },
    { holeNumber: 3, lat: 42.9838637, lng: -79.2991893 },
    { holeNumber: 4, lat: 42.9816899, lng: -79.2992567 },
    { holeNumber: 5, lat: 42.9812893, lng: -79.2981288 },
    { holeNumber: 6, lat: 42.9823785, lng: -79.2970255 },
    { holeNumber: 7, lat: 42.9839133, lng: -79.2968722 },
    { holeNumber: 8, lat: 42.9859701, lng: -79.2961735 },
    { holeNumber: 9, lat: 42.9867397, lng: -79.2982943 },
    { holeNumber: 10, lat: 42.9844353, lng: -79.3010343 },
    { holeNumber: 11, lat: 42.9822840, lng: -79.3002375 },
    { holeNumber: 12, lat: 42.9817574, lng: -79.3027139 },
    { holeNumber: 13, lat: 42.9824730, lng: -79.3039275 },
    { holeNumber: 14, lat: 42.9834092, lng: -79.3021560 },
    { holeNumber: 15, lat: 42.9855290, lng: -79.3052025 },
    { holeNumber: 16, lat: 42.9875049, lng: -79.3048102 },
    { holeNumber: 17, lat: 42.9856821, lng: -79.3037375 },
    { holeNumber: 18, lat: 42.9861951, lng: -79.3028855 },
  ],
} as const;
