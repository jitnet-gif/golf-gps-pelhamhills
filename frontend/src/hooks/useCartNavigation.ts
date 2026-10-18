import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { CLUBHOUSE, type CartPathLine } from '@/data/cartPaths';
import type { FairwayPoint } from '@/data/pelhamHills';
import { haversineMetres, METRES_TO_YARDS } from '@/lib/geo';
import {
  buildCartGraph,
  CART_METRES_PER_MINUTE,
  followRoute,
  routeCart,
  routeSteps,
  stepWords,
  type CartRoute,
  type RouteProgress,
  type RouteStep,
} from '@/lib/cartRoute';
import { useTTS } from './useTTS';

/**
 * The cart drive after "Hole out": a route along the cart paths to a tee or the
 * clubhouse, where the player is on it, the next turn, and a voice for the
 * turns. The routing itself is lib/cartRoute; this gives it a GPS feed.
 */

export type DriveDestination = { kind: 'tee'; holeNumber: number } | { kind: 'clubhouse' };

export interface DriveTarget {
  /** Stable for one destination - the map zooms in once per key, not per reroute. */
  key: string;
  label: string;
  point: FairwayPoint;
  /** Within this of the point the drive is over. */
  arriveMetres: number;
  holeNumber: number | null;
}

/** A tee is small; the clubhouse is a building with a car park beside it. */
const ARRIVE_TEE_METRES = 25;
const ARRIVE_CLUBHOUSE_METRES = 40;

export const driveTarget = (
  destination: DriveDestination | null,
  holes: Array<{ holeNumber: number; teeLatitude: number; teeLongitude: number }>
): DriveTarget | null => {
  if (!destination) return null;
  if (destination.kind === 'clubhouse') {
    return { key: 'clubhouse', label: 'Clubhouse', point: CLUBHOUSE, arriveMetres: ARRIVE_CLUBHOUSE_METRES, holeNumber: null };
  }
  const hole = holes.find((h) => h.holeNumber === destination.holeNumber);
  return hole
    ? {
        key: `tee-${hole.holeNumber}`,
        label: `Hole ${hole.holeNumber} tee`,
        point: [hole.teeLatitude, hole.teeLongitude],
        arriveMetres: ARRIVE_TEE_METRES,
        holeNumber: hole.holeNumber,
      }
    : null;
};

/** Fixes vaguer than this move nothing - a 60 m circle cannot say which path the cart is on. */
const MAX_ACCURACY_METRES = 40;
/** Further than this from the route, on two fixes running, is a different way. */
const OFF_ROUTE_METRES = 35;
const REROUTE_GAP_MS = 5000;
/** A turn is announced once, this far before it. */
const CUE_METRES = 70;

export interface DriveReading {
  status: 'no-fix' | 'ok' | 'arrived';
  target: DriveTarget;
  route: CartRoute | null;
  /** Bumped on every new route, for anything keyed on the line drawn. */
  routeId: number;
  progress: RouteProgress | null;
  remainingYards: number | null;
  minutes: number | null;
}

const yards = (m: number) => Math.round(m * METRES_TO_YARDS);

export const useCartNavigation = (
  target: DriveTarget | null,
  lines: CartPathLine[],
  { speak = true }: { speak?: boolean } = {}
) => {
  const gpsPosition = useAppStore((s) => s.gpsPosition);
  const tts = useTTS('en-US');
  const graph = useMemo(() => buildCartGraph(lines), [lines]);

  const [reading, setReading] = useState<DriveReading | null>(null);
  const run = useRef({
    route: null as CartRoute | null,
    steps: [] as RouteStep[],
    routeId: 0,
    hint: 0,
    offCount: 0,
    routedAt: 0,
    arrived: false,
    cued: new Set<string>(),
  });

  const speakRef = useRef(tts.speak);
  useEffect(() => {
    speakRef.current = tts.speak;
  }, [tts.speak]);
  const say = (text: string) => {
    if (speak) speakRef.current(text, { lang: 'en-US', id: 'cart-navigation' });
  };

  const targetKey = target?.key ?? null;
  // A new destination - or new paths to route on - is a new drive.
  useEffect(() => {
    run.current = {
      route: null,
      steps: [],
      routeId: run.current.routeId + 1,
      hint: 0,
      offCount: 0,
      routedAt: 0,
      arrived: false,
      cued: new Set(),
    };
    setReading(null);
  }, [targetKey, graph]);

  useEffect(() => {
    if (!target) return;
    const r = run.current;
    const blank = (status: DriveReading['status']): DriveReading => ({
      status,
      target,
      route: r.route,
      routeId: r.routeId,
      progress: null,
      remainingYards: null,
      minutes: null,
    });

    if (r.arrived) return;
    if (!gpsPosition) {
      if (!r.route) setReading(blank('no-fix'));
      return;
    }
    if (gpsPosition.accuracy > MAX_ACCURACY_METRES && r.route) return;
    if (gpsPosition.accuracy > MAX_ACCURACY_METRES) {
      setReading(blank('no-fix'));
      return;
    }

    const here: FairwayPoint = [gpsPosition.latitude, gpsPosition.longitude];
    if (haversineMetres(here[0], here[1], target.point[0], target.point[1]) <= target.arriveMetres) {
      r.arrived = true;
      setReading(blank('arrived'));
      say(`You have arrived at the ${target.label.toLowerCase()}.`);
      return;
    }

    const plan = () => {
      r.route = routeCart(graph, here, target.point);
      r.steps = routeSteps(r.route);
      r.routeId += 1;
      r.hint = 0;
      r.offCount = 0;
      // Wall clock, not the fix: a cached or replayed fix can carry an old timestamp.
      r.routedAt = Date.now();
      r.cued = new Set();
    };

    if (!r.route) {
      plan();
      say(`Driving to the ${target.label.toLowerCase()}. ${yards(r.route!.metres)} yards.`);
    }

    let progress = followRoute(r.route!, r.steps, here, r.hint);
    if (progress.offRoute > OFF_ROUTE_METRES) {
      r.offCount += 1;
      const now = Date.now();
      if (r.offCount >= 2 && now - r.routedAt >= REROUTE_GAP_MS) {
        plan();
        progress = followRoute(r.route!, r.steps, here, 0);
        say('Rerouting.');
      }
    } else {
      r.offCount = 0;
    }
    r.hint = progress.along;

    const next = progress.next;
    if (next && progress.toNext !== null && progress.toNext <= CUE_METRES) {
      const cueKey = `${r.routeId}:${Math.round(next.at)}`;
      if (!r.cued.has(cueKey)) {
        r.cued.add(cueKey);
        const words = stepWords(next);
        say(progress.toNext < 15 ? `${words}.` : `In ${yards(progress.toNext)} yards, ${words.charAt(0).toLowerCase()}${words.slice(1)}.`);
      }
    }

    setReading({
      status: 'ok',
      target,
      route: r.route,
      routeId: r.routeId,
      progress,
      remainingYards: yards(progress.remaining),
      minutes: Math.max(1, Math.ceil(progress.remaining / CART_METRES_PER_MINUTE)),
    });
    // `say` reads refs; the target object is rebuilt with the same key on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsPosition, targetKey, graph, speak]);

  return { reading: target ? reading : null, unlock: tts.unlock, speak: tts.speak, isSupported: tts.isSupported };
};
