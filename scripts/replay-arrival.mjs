#!/usr/bin/env node
/**
 * Walks a round past the hole-arrival detector and checks what it announces.
 *
 * The detector in frontend/src/lib/holeArrival.ts decides, from GPS fixes, that
 * a player has reached a tee - and a voice then reads that hole out loud. It is
 * the one piece of this app whose mistakes are only reachable by being
 * somewhere, which makes it the piece least likely to be tried before it ships.
 * So it was written as a fold over fixes, with no clock and no I/O of its own,
 * and this script is what that buys: a round, a cart driven past a tee, a phone
 * with a wandering fix - all replayed at a desk.
 *
 *   node scripts/replay-arrival.mjs
 *
 * Exits non-zero if any scenario announces something it should not. Change a
 * radius or a dwell in ARRIVAL_DEFAULTS and run this before believing it.
 */

import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FRONTEND = join(ROOT, 'frontend');

// The detector is TypeScript importing a sibling module, so it needs one pass
// through a bundler before node can load it. esbuild is already here as a vite
// dependency; its JS API is used rather than its CLI because spawning a .cmd
// shim is its own small Windows adventure.
const require = createRequire(import.meta.url);
let esbuild;
try {
  esbuild = await import(pathToFileURL(require.resolve('esbuild')).href);
} catch {
  console.error('esbuild not found - run npm install first');
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'arrival-'));
const bundle = join(workDir, 'holeArrival.mjs');
await esbuild.build({
  entryPoints: [join(FRONTEND, 'src/lib/holeArrival.ts')],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  logLevel: 'error',
});

const { stepArrival, initialArrivalState, markAnnounced, ARRIVAL_DEFAULTS } =
  await import(pathToFileURL(bundle).href);

// ---------------------------------------------------------------------------
// The course, read from the same file the app ships
// ---------------------------------------------------------------------------

const HOLE_ROW =
  /holeNumber:\s*(\d+), par: (\d+), handicap:\s*(\d+), length: (\d+), latitude: ([-\d.]+), longitude: ([-\d.]+), teeLatitude: ([-\d.]+), teeLongitude: ([-\d.]+)/g;

const HOLES = [
  ...readFileSync(join(FRONTEND, 'src/data/pelhamHills.ts'), 'utf8').matchAll(HOLE_ROW),
].map((m) => ({
  holeNumber: +m[1],
  latitude: +m[5],
  longitude: +m[6],
  teeLatitude: +m[7],
  teeLongitude: +m[8],
}));

if (HOLES.length !== 18) {
  console.error(`expected 18 holes in pelhamHills.ts, parsed ${HOLES.length}`);
  process.exit(1);
}

const hole = (n) => HOLES.find((h) => h.holeNumber === n);
const tee = (h) => ({ lat: h.teeLatitude, lng: h.teeLongitude });
const pin = (h) => ({ lat: h.latitude, lng: h.longitude });

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const metres = (lat1, lon1, lat2, lon2) => {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const between = (p, q, t = 0.5) => ({
  lat: p.lat + (q.lat - p.lat) * t,
  lng: p.lng + (q.lng - p.lng) * t,
});

const METRES_PER_DEGREE = 111320;
const FIX_MS = 2000; // watchPosition on a phone, roughly
const WALK_MPS = 1.4;

// ---------------------------------------------------------------------------
// A walk
// ---------------------------------------------------------------------------

/** A round in progress: feed it movement, then ask what was announced. */
function walker({ announced = [], noiseMetres = 0, seed = 42 } = {}) {
  let state = announced.reduce(markAnnounced, initialArrivalState);
  let time = Date.parse('2026-09-08T09:00:00Z');
  let rng = seed;
  const fired = [];

  // Deterministic, so a failure can be looked at twice.
  const noise = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return ((rng / 0x7fffffff - 0.5) * 2 * noiseMetres) / METRES_PER_DEGREE;
  };

  const fix = (lat, lng, accuracy, at) => {
    const step = stepArrival(
      state,
      {
        latitude: lat + noise(),
        longitude: lng + noise(),
        accuracy,
        timestamp: at ?? (time += FIX_MS),
      },
      HOLES
    );
    state = step.state;
    if (step.arrivedAt !== null) fired.push(step.arrivedAt);
  };

  return {
    /** Stay on a spot, as a group does on a tee or a green. */
    stand(p, seconds, accuracy = 8) {
      for (let i = 0; i < (seconds * 1000) / FIX_MS; i++) fix(p.lat, p.lng, accuracy);
      return this;
    },
    /** Travel from one point to another at `mps`. */
    go(p, q, mps = WALK_MPS, accuracy = 8) {
      const steps = Math.max(
        1,
        Math.round(metres(p.lat, p.lng, q.lat, q.lng) / ((mps * FIX_MS) / 1000))
      );
      for (let i = 1; i <= steps; i++) {
        const at = between(p, q, i / steps);
        fix(at.lat, at.lng, accuracy);
      }
      return this;
    },
    /** One fix with a timestamp of your choosing - for misbehaving clocks. */
    fixAt(p, at, accuracy = 8) {
      fix(p.lat, p.lng, accuracy, at);
      return this;
    },
    get now() {
      return time;
    },
    get fired() {
      return fired;
    },
  };
}

/** A whole round walked in order, tee to green, eighteen times. */
const playRound = (noiseMetres) => {
  const w = walker({ noiseMetres });
  const first = hole(1);
  w.stand({ lat: first.teeLatitude - 0.0011, lng: first.teeLongitude }, 10);
  for (const h of HOLES) {
    w.go({ lat: h.teeLatitude + 0.0002, lng: h.teeLongitude }, tee(h))
      .stand(tee(h), 90)
      .go(tee(h), pin(h))
      .stand(pin(h), 120);
  }
  return w.fired;
};

// ---------------------------------------------------------------------------
// What it should, and should not, say
// ---------------------------------------------------------------------------

const results = [];
const scenario = (name, fired, expected) =>
  results.push({ ok: String(fired) === String(expected), name, fired, expected });

const ALL_EIGHTEEN = HOLES.map((h) => h.holeNumber);

scenario('a round walked in order announces all eighteen', playRound(0), ALL_EIGHTEEN);
scenario('the same round through 6 m of GPS wander', playRound(6), ALL_EIGHTEEN);
scenario('and through 8 m', playRound(8), ALL_EIGHTEEN);

// Starting somewhere other than the 1st tee. Every hole is armed until one has
// been announced, so the walk in has to be unambiguous on its own.
scenario(
  'a back-nine start is picked up from the 10th tee',
  walker()
    .go({ lat: hole(10).teeLatitude + 0.001, lng: hole(10).teeLongitude }, tee(hole(10)))
    .stand(tee(hole(10)), 90)
    .go(tee(hole(10)), pin(hole(10)))
    .stand(pin(hole(10)), 100)
    .go(pin(hole(10)), tee(hole(11)))
    .stand(tee(hole(11)), 90).fired,
  [10, 11]
);

// That same walk passes 13 m from the 1st tee, and takes long enough doing it to
// out-wait the dwell. Staying put, not staying near, is what counts as arrival.
scenario(
  'walking past the 1st tee to reach the 10th announces only the 10th',
  walker()
    .go({ lat: hole(10).teeLatitude + 0.001, lng: hole(10).teeLongitude }, tee(hole(10)))
    .stand(tee(hole(10)), 90).fired,
  [10]
);

scenario(
  'a cart driven past the 5th tee announces nothing',
  walker().go(
    { lat: hole(5).teeLatitude + 0.0009, lng: hole(5).teeLongitude },
    { lat: hole(5).teeLatitude - 0.0009, lng: hole(5).teeLongitude },
    6
  ).fired,
  []
);

scenario(
  'a 40 s pause on the walk in, still 60 m short of the tee, announces nothing',
  (() => {
    const pause = between(pin(hole(9)), tee(hole(10)), 1 - 60 / 130);
    return walker({ announced: [9] })
      .go(pin(hole(9)), pause)
      .stand(pause, 40)
      .go(pause, tee(hole(10))).fired;
  })(),
  []
);

scenario(
  'fixes that admit to 40 m of error announce nothing',
  walker().stand(tee(hole(1)), 180, 40).fired,
  []
);

// The 14th tee is 33 m from the 13th green - the tightest pair on the property.
scenario(
  'putting out on the 13th does not announce the 14th early',
  walker({ announced: [13], noiseMetres: 8 }).stand(pin(hole(13)), 150).fired,
  []
);

scenario(
  'a hole already read is not read again on the way back past it',
  walker({ announced: [7] }).stand(tee(hole(7)), 120).fired,
  []
);

scenario(
  'one hole skipped is still picked up',
  walker({ announced: [2] }).stand(tee(hole(4)), 90).fired,
  [4]
);

scenario(
  'two holes skipped is past the look-ahead, so it stays quiet',
  walker({ announced: [2] }).stand(tee(hole(6)), 90).fired,
  []
);

// Tees 11 and 14 are 48 m apart. On a cold start both are armed, and a spot
// between them belongs to neither.
scenario(
  'a cold start between the 11th and 14th tees stays silent',
  walker().stand(between(tee(hole(11)), tee(hole(14))), 150).fired,
  []
);

scenario(
  'a standing player with a noisy fix stream is announced eventually',
  walker({ announced: [5], noiseMetres: 8 }).stand(tee(hole(6)), 180, 10).fired,
  [6]
);

// A tab resumed from the background can hand back a fix stamped before the one
// that opened the dwell. Without a guard, that dwell never completes again.
scenario(
  'a backwards clock jump restarts the dwell rather than stalling it',
  (() => {
    const w = walker({ announced: [6] });
    const spot = tee(hole(7));
    w.stand(spot, 6);
    const jumped = w.now - 300000;
    for (let i = 0; i <= 15; i++) w.fixAt(spot, jumped + i * 2000);
    return w.fired;
  })(),
  [7]
);

// ---------------------------------------------------------------------------

rmSync(workDir, { recursive: true, force: true });

console.log(
  `arrival: within ${ARRIVAL_DEFAULTS.radiusMetres} m of a tee for ` +
    `${ARRIVAL_DEFAULTS.dwellMs / 1000} s without drifting ` +
    `${ARRIVAL_DEFAULTS.stationaryRadiusMetres} m, on fixes better than ` +
    `${ARRIVAL_DEFAULTS.maxAccuracyMetres} m, with ${ARRIVAL_DEFAULTS.lookAhead} holes armed\n`
);

for (const { ok, name, fired, expected } of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        announced [${fired}], expected [${expected}]`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(
  failed === 0
    ? `\nall ${results.length} scenarios behaved as intended`
    : `\n${failed} of ${results.length} scenarios did not`
);
process.exit(failed === 0 ? 0 : 1);
