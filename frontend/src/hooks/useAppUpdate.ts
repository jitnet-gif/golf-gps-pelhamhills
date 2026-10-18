import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'wouter';
import {
  applyAppUpdate,
  checkForAppUpdate,
  getAppUpdateState,
  startAppUpdates,
  subscribeToAppUpdate,
  type AppUpdateState,
} from '@/lib/appUpdate';

/**
 * Screens where a reload would cost the player something they cannot get back
 * by tapping again:
 *
 *   /golf/*  a round - GPS watch, the hole they are standing on, an unsaved
 *            stroke being tapped in.
 *   /fnb     the counter screen, which is left on all day and may be halfway
 *            through taking a payment.
 *   /admin*  a map being drawn or a pin being surveyed on site.
 *
 * Everywhere else the update goes in by itself. Here it waits for a tap, and
 * the next visit to the home screen takes it anyway.
 */
const BUSY_ROUTES = [/^\/golf\//, /^\/fnb\b/, /^\/admin\b/];

export interface AppUpdate extends AppUpdateState {
  /** True when the current screen lets an update go in without asking. */
  canApplyNow: boolean;
  /** Take the downloaded version now (reloads the page). */
  apply: () => void;
  /** Ask for a new version right now, throttle and all ignored. */
  checkNow: () => void;
}

/**
 * The app's own updates, from the player's side.
 *
 * Checking and downloading happen on their own (src/lib/appUpdate.ts); what
 * this hook adds is the one decision that needs to know about the app: whether
 * the screen in front of the player can survive a reload.
 */
export const useAppUpdate = (): AppUpdate => {
  const state = useSyncExternalStore(subscribeToAppUpdate, getAppUpdateState, getAppUpdateState);
  const [location] = useLocation();

  useEffect(() => {
    // Dev has no generated worker - registering /sw.js there only gets the SPA
    // fallback back as HTML and an error in the console. `vite preview` builds
    // for production, so the update path is still testable locally.
    if (import.meta.env.PROD) startAppUpdates();
  }, []);

  const canApplyNow = !BUSY_ROUTES.some((route) => route.test(location));

  useEffect(() => {
    if (state.status === 'ready' && canApplyNow) applyAppUpdate();
  }, [state.status, canApplyNow]);

  const apply = useCallback(() => applyAppUpdate(), []);
  const checkNow = useCallback(() => {
    void checkForAppUpdate({ force: true });
  }, []);

  return { ...state, canApplyNow, apply, checkNow };
};
