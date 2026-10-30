# Tee and pin survey

`pelham-hills-tee-pin.csv` is the club's Google Earth project "Pelham Hills Tee
and Pin coordinates" (exported 2026-10-17), one row per placemark: hole, marker
(`blue`, `white`, `yellow`, `red`, `pin`), latitude, longitude.

- Hole numbers are the project's, which the club confirmed are its own. The
  printed yardage book and course map number the nines the other way round.
- Hole 11 has no pin in the project.
- Placed on satellite imagery, not stood on.

Where it went:

- `frontend/src/data/pelhamHills.ts` - pin and white tee per hole (the app keeps
  one tee per hole).
- `backend/migrations/0022_google_earth_tee_pin.sql` - the same into Supabase
  `holes`.
- `scripts/georef-course-map.py` - re-run after any change here; it bends the
  printed course map onto these points and prints `COURSE_MAP_OVERLAY` for
  `frontend/src/data/courseMap.ts`.
