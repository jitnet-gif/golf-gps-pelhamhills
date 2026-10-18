import type { FairwayPoint } from '@/data/pelhamHills';
import type { CartPathLine } from '@/data/cartPaths';
import { bearingDegrees, haversineMetres } from './geo';

/**
 * Driving a cart from where the player is to a tee or the clubhouse, along the
 * cart paths where the map has them.
 *
 * The paths are OpenStreetMap's plus any an admin drove with the recorder in
 * /admin/map. OSM's come in pieces - 20 of them at Pelham Hills, 40 to 380 m
 * apart, none round holes 13-15 - so a route is allowed to leave a path and go
 * straight: to the first path, across a gap to another piece, and from the last
 * path to the destination. Those legs are marked `direct` and drawn dashed, so
 * nobody takes a straight line across a pond for a road.
 *
 * A straight leg costs OFF_PATH_COST times its length, so a route keeps to the
 * path unless the path wanders more than that. Inside one connected piece a
 * route never cuts across: the path is the way there. Only between pieces, and
 * to and from the ends, may it go straight.
 *
 * Offline and pure - nothing here reads the store or the network, so a drive
 * can be replayed without a phone. ~900 path points make the whole search a
 * few milliseconds, which is why a simple O(n^2) Dijkstra is enough.
 */

/** A straight metre counts as this many path metres. */
export const OFF_PATH_COST = 1.8;
/** Two path points closer than this are one junction. */
export const JOIN_METRES = 6;
/** A path ending this close to another path's side joins it there (a T-junction). */
export const TEE_JOIN_METRES = 10;
/** No straight leg between two pieces of path longer than this. */
export const MAX_GAP_METRES = 450;
/** Carts at Pelham Hills: about 12 km/h once paths, bridges and people are allowed for. */
export const CART_METRES_PER_MINUTE = 200;

export type LegKind = 'path' | 'direct';

export interface CartGraph {
  points: FairwayPoint[];
  /** Metres east and north of the first point - flat enough across one course. */
  xy: Array<[number, number]>;
  /** Neighbour -> metres along the path. */
  adj: Array<Map<number, number>>;
  /** Which connected piece of path each point is on. */
  piece: number[];
}

const planar = (origin: FairwayPoint) => {
  const kx = 111_320 * Math.cos((origin[0] * Math.PI) / 180);
  const ky = 110_574;
  return (p: FairwayPoint): [number, number] => [(p[1] - origin[1]) * kx, (p[0] - origin[0]) * ky];
};

const metres = (a: FairwayPoint, b: FairwayPoint) => haversineMetres(a[0], a[1], b[0], b[1]);

export const buildCartGraph = (lines: CartPathLine[]): CartGraph => {
  const usable = lines.filter((l) => l.points.length >= 2);
  const points: FairwayPoint[] = [];
  const xy: Array<[number, number]> = [];
  const adj: Array<Map<number, number>> = [];
  if (!usable.length) return { points, xy, adj, piece: [] };

  const toXY = planar(usable[0].points[0]);
  const grid = new Map<string, number[]>();
  const cellOf = (x: number, y: number) => [Math.floor(x / JOIN_METRES), Math.floor(y / JOIN_METRES)];

  const addNode = (p: FairwayPoint): number => {
    const id = points.length;
    const at = toXY(p);
    points.push(p);
    xy.push(at);
    adj.push(new Map());
    const [cx, cy] = cellOf(at[0], at[1]);
    const key = `${cx}:${cy}`;
    grid.set(key, [...(grid.get(key) ?? []), id]);
    return id;
  };

  const nodeAt = (p: FairwayPoint): number => {
    const [x, y] = toXY(p);
    const [cx, cy] = cellOf(x, y);
    let best = -1;
    let bestD = JOIN_METRES;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const id of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const d = Math.hypot(xy[id][0] - x, xy[id][1] - y);
          if (d <= bestD) {
            bestD = d;
            best = id;
          }
        }
      }
    }
    return best >= 0 ? best : addNode(p);
  };

  const link = (a: number, b: number) => {
    if (a === b) return;
    const m = metres(points[a], points[b]);
    adj[a].set(b, m);
    adj[b].set(a, m);
  };
  const unlink = (a: number, b: number) => {
    adj[a].delete(b);
    adj[b].delete(a);
  };

  const ends: number[] = [];
  for (const line of usable) {
    const ids = line.points.map(nodeAt);
    for (let i = 1; i < ids.length; i += 1) link(ids[i - 1], ids[i]);
    ends.push(ids[0], ids[ids.length - 1]);
  }

  // A path that stops at the side of another - drawn a few metres short, or
  // meeting it mid-segment - joins it where it touches.
  for (const end of ends) {
    if (adj[end].size !== 1) continue;
    const [ex, ey] = xy[end];
    let best: { a: number; b: number; t: number; d: number } | null = null;
    for (let a = 0; a < points.length; a += 1) {
      for (const b of adj[a].keys()) {
        if (b < a || a === end || b === end || adj[end].has(a) || adj[end].has(b)) continue;
        const [ax, ay] = xy[a];
        const [bx, by] = xy[b];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = len2 ? Math.max(0, Math.min(1, ((ex - ax) * (bx - ax) + (ey - ay) * (by - ay)) / len2)) : 0;
        const d = Math.hypot(ax + t * (bx - ax) - ex, ay + t * (by - ay) - ey);
        if (d <= TEE_JOIN_METRES && (!best || d < best.d)) best = { a, b, t, d };
      }
    }
    if (!best) continue;
    const { a, b, t } = best;
    const lenAB = Math.hypot(xy[b][0] - xy[a][0], xy[b][1] - xy[a][1]);
    if (t * lenAB <= JOIN_METRES) link(end, a);
    else if ((1 - t) * lenAB <= JOIN_METRES) link(end, b);
    else {
      const p: FairwayPoint = [
        points[a][0] + t * (points[b][0] - points[a][0]),
        points[a][1] + t * (points[b][1] - points[a][1]),
      ];
      const mid = addNode(p);
      unlink(a, b);
      link(a, mid);
      link(mid, b);
      link(end, mid);
    }
  }

  const piece = new Array<number>(points.length).fill(-1);
  let pieces = 0;
  for (let start = 0; start < points.length; start += 1) {
    if (piece[start] !== -1) continue;
    const stack = [start];
    piece[start] = pieces;
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of adj[u].keys()) {
        if (piece[v] === -1) {
          piece[v] = pieces;
          stack.push(v);
        }
      }
    }
    pieces += 1;
  }

  return { points, xy, adj, piece };
};

export interface CartRoute {
  points: FairwayPoint[];
  /** kinds[i] is the stretch from points[i] to points[i + 1]. */
  kinds: LegKind[];
  /** Metres from the start to each point. */
  cum: number[];
  metres: number;
}

/** The route split where it leaves or rejoins a path - for drawing. */
export const routeLegs = (route: CartRoute): Array<{ kind: LegKind; points: FairwayPoint[] }> => {
  const legs: Array<{ kind: LegKind; points: FairwayPoint[] }> = [];
  route.kinds.forEach((kind, i) => {
    const last = legs[legs.length - 1];
    if (last && last.kind === kind) last.points.push(route.points[i + 1]);
    else legs.push({ kind, points: [route.points[i], route.points[i + 1]] });
  });
  return legs;
};

const withCumulative = (points: FairwayPoint[], kinds: LegKind[]): CartRoute => {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + metres(points[i - 1], points[i]));
  return { points, kinds, cum, metres: cum[cum.length - 1] };
};

export const routeCart = (graph: CartGraph, from: FairwayPoint, to: FairwayPoint): CartRoute => {
  const n = graph.points.length;
  const S = n;
  const T = n + 1;
  const at = (i: number): FairwayPoint => (i === S ? from : i === T ? to : graph.points[i]);
  const dist = new Float64Array(n + 2).fill(Infinity);
  const prev = new Int32Array(n + 2).fill(-1);
  const prevKind: LegKind[] = new Array(n + 2).fill('direct');
  const done = new Uint8Array(n + 2);
  dist[S] = 0;

  const relax = (u: number, v: number, cost: number, kind: LegKind) => {
    if (done[v] || dist[u] + cost >= dist[v]) return;
    dist[v] = dist[u] + cost;
    prev[v] = u;
    prevKind[v] = kind;
  };

  for (;;) {
    let u = -1;
    for (let i = 0; i < n + 2; i += 1) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === T) break;
    done[u] = 1;
    const here = at(u);
    relax(u, T, metres(here, to) * OFF_PATH_COST, 'direct');
    if (u === S) {
      for (let v = 0; v < n; v += 1) relax(u, v, metres(here, graph.points[v]) * OFF_PATH_COST, 'direct');
      continue;
    }
    for (const [v, m] of graph.adj[u]) relax(u, v, m, 'path');
    for (let v = 0; v < n; v += 1) {
      if (graph.piece[v] === graph.piece[u] || done[v]) continue;
      const gap = metres(here, graph.points[v]);
      if (gap <= MAX_GAP_METRES) relax(u, v, gap * OFF_PATH_COST, 'direct');
    }
  }

  const chain: number[] = [];
  for (let v = T; v !== -1; v = prev[v]) chain.push(v);
  chain.reverse();
  const points = chain.map(at);
  const kinds = chain.slice(1).map((v) => prevKind[v]);
  // A start or finish right on a path is not a leg worth drawing.
  while (points.length > 2 && kinds[0] === 'direct' && metres(points[0], points[1]) < 3) {
    points.splice(1, 1);
    kinds.splice(0, 1);
  }
  const last = points.length - 1;
  if (points.length > 2 && kinds[last - 1] === 'direct' && metres(points[last - 1], points[last]) < 3) {
    points.splice(last - 1, 1);
    kinds.splice(last - 1, 1);
  }
  return withCumulative(points, kinds);
};

/** The point `d` metres along the route. */
export const pointAtDistance = (route: CartRoute, d: number): FairwayPoint => {
  const { points, cum } = route;
  if (d <= 0) return points[0];
  if (d >= route.metres) return points[points.length - 1];
  let i = 1;
  while (cum[i] < d) i += 1;
  const span = cum[i] - cum[i - 1];
  const t = span ? (d - cum[i - 1]) / span : 0;
  return [
    points[i - 1][0] + t * (points[i][0] - points[i - 1][0]),
    points[i - 1][1] + t * (points[i][1] - points[i - 1][1]),
  ];
};

export type Turn = 'straight' | 'slight-left' | 'slight-right' | 'left' | 'right' | 'u-turn';

export interface RouteStep {
  /** Metres along the route. */
  at: number;
  turn: Turn;
  /** The path ends here and the way goes straight on (or back onto a path). */
  change: 'leave-path' | 'join-path' | null;
}

/** How far either side of a corner its direction is measured - past GPS-sized wiggles. */
const CORNER_LOOK_METRES = 12;
const TURN_MIN_DEGREES = 30;
const STEP_MERGE_METRES = 15;

const signedGap = (from: number, to: number) => ((to - from + 540) % 360) - 180;

const turnOf = (delta: number): Turn => {
  const a = Math.abs(delta);
  if (a < TURN_MIN_DEGREES) return 'straight';
  if (a >= 150) return 'u-turn';
  if (a < 60) return delta < 0 ? 'slight-left' : 'slight-right';
  return delta < 0 ? 'left' : 'right';
};

/** The corners worth announcing, and where the route leaves or joins a path. */
export const routeSteps = (route: CartRoute): RouteStep[] => {
  const steps: Array<RouteStep & { weight: number }> = [];
  for (let i = 1; i < route.points.length - 1; i += 1) {
    const at = route.cum[i];
    if (at < 5 || route.metres - at < 5) continue;
    const before = pointAtDistance(route, at - CORNER_LOOK_METRES);
    const after = pointAtDistance(route, at + CORNER_LOOK_METRES);
    const vertex = route.points[i];
    const delta = signedGap(
      bearingDegrees(before[0], before[1], vertex[0], vertex[1]),
      bearingDegrees(vertex[0], vertex[1], after[0], after[1])
    );
    const turn = turnOf(delta);
    const change =
      route.kinds[i - 1] === route.kinds[i] ? null : route.kinds[i] === 'direct' ? 'leave-path' : 'join-path';
    if (turn === 'straight' && !change) continue;
    const step = { at, turn, change, weight: Math.abs(delta) + (change ? 1000 : 0) } as RouteStep & { weight: number };
    const last = steps[steps.length - 1];
    if (last && at - last.at < STEP_MERGE_METRES) {
      if (step.weight > last.weight) steps[steps.length - 1] = { ...step, change: step.change ?? last.change };
      else last.change = last.change ?? step.change;
    } else {
      steps.push(step);
    }
  }
  return steps.map(({ at, turn, change }) => ({ at, turn, change }));
};

export interface RouteProgress {
  /** How far the player is from the route line. */
  offRoute: number;
  /** Metres along the route to the point nearest the player. */
  along: number;
  remaining: number;
  next: RouteStep | null;
  /** Metres to `next`. */
  toNext: number | null;
  /** The way the route runs just ahead - what the map turns to face. */
  heading: number | null;
  /** The stretch under the player has no mapped path. */
  onDirect: boolean;
}

/**
 * Where the player is on the route. `hint` is the last `along`: on a route that
 * doubles back past itself the nearer stretch ahead wins over one already driven.
 */
export const followRoute = (
  route: CartRoute,
  steps: RouteStep[],
  here: FairwayPoint,
  hint = 0
): RouteProgress => {
  const toXY = planar(route.points[0]);
  const [px, py] = toXY(here);
  let best = { score: Infinity, d: Infinity, along: 0, seg: 0 };
  for (let i = 1; i < route.points.length; i += 1) {
    const [ax, ay] = toXY(route.points[i - 1]);
    const [bx, by] = toXY(route.points[i]);
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0;
    const d = Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py);
    const along = route.cum[i - 1] + t * (route.cum[i] - route.cum[i - 1]);
    const score = d + (along < hint - 30 ? 25 : 0);
    if (score < best.score) best = { score, d, along, seg: i - 1 };
  }
  const remaining = Math.max(0, route.metres - best.along);
  const next = steps.find((s) => s.at > best.along + 3) ?? null;
  const ahead = pointAtDistance(route, best.along + 25);
  const from = pointAtDistance(route, best.along);
  return {
    offRoute: best.d,
    along: best.along,
    remaining,
    next,
    toNext: next ? next.at - best.along : null,
    heading: remaining > 3 && metres(from, ahead) > 1 ? bearingDegrees(from[0], from[1], ahead[0], ahead[1]) : null,
    onDirect: route.kinds[best.seg] === 'direct',
  };
};

export const TURN_WORDS: Record<Turn, string> = {
  straight: 'Continue straight',
  'slight-left': 'Bear left',
  'slight-right': 'Bear right',
  left: 'Turn left',
  right: 'Turn right',
  'u-turn': 'Turn around',
};

/** What a step tells the driver, in a few words. */
export const stepWords = (step: RouteStep): string => {
  if (step.change === 'leave-path') {
    return step.turn === 'straight' ? 'Path ends - head straight on' : `${TURN_WORDS[step.turn]} off the path`;
  }
  if (step.change === 'join-path') {
    return step.turn === 'straight' ? 'Join the cart path' : `${TURN_WORDS[step.turn]} onto the cart path`;
  }
  return TURN_WORDS[step.turn];
};
