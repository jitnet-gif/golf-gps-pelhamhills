/**
 * App updates: find the new version, download it, take it when it is safe to.
 *
 * A phone that has installed this app keeps running whatever it downloaded the
 * first time. The browser re-checks the worker on its own, but only on a
 * navigation and at most once a day - and this app is opened from the home
 * screen at the first tee and left open for four hours, which is exactly the
 * shape that check misses. So the page asks for itself.
 *
 * The three moments are kept apart on purpose:
 *
 *   check     registration.update(), on a timer, when the phone comes back out
 *             of a pocket, and when the signal returns.
 *   download  the browser's, not ours: an update found by that check installs
 *             itself in the background and then waits.
 *   take      a reload, which throws away the running page. useAppUpdate picks
 *             the moment - it knows what screen the player is on; this module
 *             only knows how.
 *
 * vite.config.ts is the other half of this: registerType 'prompt' is what makes
 * "waits" true. With autoUpdate the worker would skipWaiting into control of a
 * page mid-round and drop the precache underneath it.
 */

/** The worker vite-plugin-pwa generates, at the root scope. */
const SW_URL = '/sw.js';

/**
 * How often an open page asks. Fifteen minutes is roughly three holes: often
 * enough that a fix deployed in the morning reaches the afternoon groups, rare
 * enough to be nothing next to a round of map tiles.
 */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * The floor between two checks, whatever asked for them. visibilitychange fires
 * every time the phone leaves a pocket, and on the course that is every few
 * minutes with the worst signal of the day.
 */
const MIN_CHECK_GAP_MS = 5 * 60 * 1000;

/**
 * If the waiting worker never reports that it took over, reload anyway. It has
 * already been told to skip waiting, so the next load gets the new version
 * either way; this only stops the pill from sticking on "Updating".
 */
const TAKEOVER_TIMEOUT_MS = 6000;

export type AppUpdateStatus =
  /** No service worker in this browser, or registration failed. */
  | 'unsupported'
  /** Running the newest version we know of. */
  | 'idle'
  /** Asking the server whether there is a newer one. */
  | 'checking'
  /** There is, and it is downloading itself now. */
  | 'downloading'
  /** Downloaded and waiting - a reload is all that is left. */
  | 'ready'
  /** Reloading into it. */
  | 'applying';

export interface AppUpdateState {
  status: AppUpdateStatus;
  /** When the last check finished, as epoch ms; null until one has. */
  checkedAt: number | null;
}

let state: AppUpdateState = { status: 'idle', checkedAt: null };
const listeners = new Set<() => void>();

let registration: ServiceWorkerRegistration | null = null;
let started = false;
let lastCheck = 0;
/**
 * Set only when we ourselves told a waiting worker to take over. The first
 * worker a device installs also changes the controller (clientsClaim), and
 * reloading the page out from under a player who has just arrived would be a
 * poor greeting.
 */
let takingOver = false;

const setState = (patch: Partial<AppUpdateState>) => {
  const next = { ...state, ...patch };
  if (next.status === state.status && next.checkedAt === state.checkedAt) return;
  state = next;
  listeners.forEach((listener) => listener());
};

export const getAppUpdateState = (): AppUpdateState => state;

export const subscribeToAppUpdate = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Follow a worker through its install.
 *
 * A worker that reaches 'installed' with nothing controlling the page is the
 * first one on this device - an install, not an update, and there is nothing
 * for the player to take.
 */
const watchInstalling = (worker: ServiceWorker | null) => {
  if (!worker) return;

  const settle = () => {
    if (worker.state === 'installed') {
      setState({ status: navigator.serviceWorker.controller ? 'ready' : 'idle' });
      worker.removeEventListener('statechange', settle);
    } else if (worker.state === 'activated' || worker.state === 'redundant') {
      // Activated straight through means it was the first one here; redundant
      // means the install lost - a newer worker, or a precache that failed.
      // Either way nothing is waiting to be taken.
      if (state.status !== 'applying') setState({ status: 'idle' });
      worker.removeEventListener('statechange', settle);
    }
  };

  if (navigator.serviceWorker.controller) setState({ status: 'downloading' });
  worker.addEventListener('statechange', settle);
  // It may already have finished between updatefound and this line.
  settle();
};

/**
 * Ask the server whether there is a newer worker.
 *
 * `force` is the player tapping "Check for updates": it skips the throttle but
 * not the offline gate, because update() rejects with no network and a rejected
 * check reads exactly like "you are up to date".
 */
export const checkForAppUpdate = async (options?: { force?: boolean }): Promise<void> => {
  if (!registration) return;
  // Something is already downloaded, or going in; another check learns nothing.
  if (state.status === 'ready' || state.status === 'downloading' || state.status === 'applying') {
    return;
  }
  if (!navigator.onLine) return;

  const now = Date.now();
  if (!options?.force && now - lastCheck < MIN_CHECK_GAP_MS) return;
  lastCheck = now;

  if (state.status === 'idle') setState({ status: 'checking' });
  try {
    await registration.update();
  } catch {
    // No signal on the 7th, or the server had a moment. The next trigger asks
    // again; nothing here is worth a word to the player.
  } finally {
    // updatefound may have moved us on to 'downloading' meanwhile - leave that.
    setState({
      checkedAt: Date.now(),
      status: state.status === 'checking' ? 'idle' : state.status,
    });
  }
};

/**
 * Take the downloaded version: tell the waiting worker to stop waiting, and
 * reload once it has control, so the page and its worker are the same version.
 */
export const applyAppUpdate = (): void => {
  const waiting = registration?.waiting;
  if (!waiting) {
    // Either nothing is waiting - nothing to do - or it took over while we were
    // deciding, in which case a reload is exactly what is missing.
    if (state.status === 'ready') window.location.reload();
    return;
  }

  takingOver = true;
  setState({ status: 'applying' });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  window.setTimeout(() => {
    if (!takingOver) return;
    takingOver = false;
    window.location.reload();
  }, TAKEOVER_TIMEOUT_MS);
};

/**
 * Register the worker and start asking. Safe to call from every mount: only the
 * first call does anything.
 */
export const startAppUpdates = (): void => {
  if (started) return;
  started = true;

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    setState({ status: 'unsupported' });
    return;
  }

  // Was a worker already in charge when this page loaded? A controller change
  // means two different things depending on the answer, and only one of them is
  // a reason to reload.
  let hadController = navigator.serviceWorker.controller != null;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (takingOver) {
      takingOver = false;
      window.location.reload();
      return;
    }

    if (!hadController) {
      // The first worker on this device claiming the page. Nothing changed
      // underneath us, and reloading on a player who has just arrived would be
      // a poor greeting.
      hadController = true;
      return;
    }

    // Someone else took the update - a second tab of this app, usually. This
    // page is now running last version's JavaScript against this version's
    // precache, so it is due a reload as much as the tab that tapped; let the
    // usual decision make it (useAppUpdate reloads here, or waits for a tap
    // mid-round).
    setState({ status: 'ready' });
  });

  // updateViaCache: 'none' because the worker pulls in /push-sw.js with
  // importScripts. Browsers already bypass the HTTP cache for the worker script
  // itself on an update check, but not for what it imports, and a push handler
  // served from a day-old cache is a push handler that no longer matches the
  // server.
  navigator.serviceWorker
    .register(SW_URL, { scope: '/', updateViaCache: 'none' })
    .then((reg) => {
      registration = reg;
      // Registering is itself a check; do not immediately make another.
      lastCheck = Date.now();
      setState({ checkedAt: lastCheck });

      // A version may have been downloaded and left waiting by an earlier
      // visit - the common case for a home-screen app reopened the next day.
      if (reg.waiting && navigator.serviceWorker.controller) {
        setState({ status: 'ready' });
      } else if (reg.installing) {
        watchInstalling(reg.installing);
      }

      reg.addEventListener('updatefound', () => watchInstalling(reg.installing));
    })
    .catch(() => {
      // A blocked worker - private mode, some in-app browsers - is not
      // something a player can act on: the app works, it just cannot update
      // itself without a manual reload.
      setState({ status: 'unsupported' });
    });

  const askIfVisible = () => {
    if (document.visibilityState === 'visible') void checkForAppUpdate();
  };

  document.addEventListener('visibilitychange', askIfVisible);
  window.addEventListener('focus', askIfVisible);
  window.addEventListener('online', () => void checkForAppUpdate());
  window.setInterval(() => void checkForAppUpdate(), CHECK_INTERVAL_MS);
};

export const APP_UPDATE_CHECK_INTERVAL_MS = CHECK_INTERVAL_MS;
