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
  bounds: [[42.9791935, -79.3067482], [42.9887396, -79.2945831]],
  numbers: [
    { holeNumber: 1, lat: 42.9844211, lng: -79.3011916 },
    { holeNumber: 2, lat: 42.9822878, lng: -79.3003396 },
    { holeNumber: 3, lat: 42.9819142, lng: -79.3024543 },
    { holeNumber: 4, lat: 42.9827153, lng: -79.3033676 },
    { holeNumber: 5, lat: 42.9834490, lng: -79.3020865 },
    { holeNumber: 6, lat: 42.9854698, lng: -79.3053782 },
    { holeNumber: 7, lat: 42.9875717, lng: -79.3047468 },
    { holeNumber: 8, lat: 42.9856949, lng: -79.3039132 },
    { holeNumber: 9, lat: 42.9861989, lng: -79.3031225 },
    { holeNumber: 10, lat: 42.9853888, lng: -79.2979490 },
    { holeNumber: 11, lat: 42.9847497, lng: -79.2983535 },
    { holeNumber: 12, lat: 42.9838090, lng: -79.2990646 },
    { holeNumber: 13, lat: 42.9816937, lng: -79.2994201 },
    { holeNumber: 14, lat: 42.9812391, lng: -79.2982432 },
    { holeNumber: 15, lat: 42.9823508, lng: -79.2971460 },
    { holeNumber: 16, lat: 42.9839260, lng: -79.2969437 },
    { holeNumber: 17, lat: 42.9860594, lng: -79.2957055 },
    { holeNumber: 18, lat: 42.9867615, lng: -79.2983781 },
  ],
} as const;
