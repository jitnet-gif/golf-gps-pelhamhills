import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import {
  useGPS,
  useScorecard,
  useScorecardSync,
  useHoleNarration,
  useHoleArrival,
  useTeeGuidance,
} from '@/hooks';
import { useAppStore } from '@/store/appStore';
import {
  HoleMap,
  HoleGuide,
  ScoreCard,
  OnlineStatus,
  SyncStatus,
  CourseIntro,
  OfflineCourse,
  OfflineNarration,
  PromoBanner,
  TeeSelector,
  HoleCard,
  GreenDistances,
  HoleNarration,
  RoundSummary,
  PinSurveyor,
  AutoNarration,
  ArrivalNotice,
  loadAutoNarrationPreference,
  saveAutoNarrationPreference,
  TeeGuidanceToggle,
  ArrivalSimulator,
  loadTeeGuidancePreference,
  saveTeeGuidancePreference,
  RoundStartGate,
  HoleAd,
} from '@/components';
import { Menu, X, TrendingUp, PenLine, FlaskConical, Square, Map as MapIcon, Flag, ClipboardList, Volume2, Car, UtensilsCrossed } from 'lucide-react';
import { PELHAM_HILLS, PELHAM_HILLS_HOLES, type FairwayPoint, type Hole } from '@/data/pelhamHills';
import { fetchCourseData, type CourseData } from '@/lib/courseData';
import { REPORT_INTERVAL_MS, reportPosition } from '@/lib/playerMonitor';
import type { TeeSet } from '@/data/pelhamHillsBook';
import { isRoundComplete } from '@/lib/roundSummary';
import { loadSurveys } from '@/lib/pinSurvey';
import { applyHoleEdits, loadHolePaths, pullHoleEdits } from '@/lib/holePaths';
import { FairwayDistance } from '@/components/FairwayDistance';
import { PinTab } from '@/components/PinTab';
import { HoleSheet } from '@/components/HoleSheet';
import { GpsStatus } from '@/components/GpsStatus';
import { loadNavStyle, saveNavStyle, WalkNavigation, type NavStyle } from '@/components/WalkNavigation';
import { haversineMetres } from '@/lib/geo';
import { readFairway } from '@/lib/fairwayDistance';
import { getAdminKey } from '@/lib/adminApi';
import { cachedFullMapStyle, fetchFullMapStyle, type FullMapStyle } from '@/lib/appSettings';
import { nextTee } from '@/lib/teeGuidance';
import { narrationId } from '@/hooks/useHoleNarration';
import { useArrivalSimulation } from '@/hooks/useArrivalSimulation';
import { driveTarget, useCartNavigation, type DriveDestination, type DriveReading } from '@/hooks/useCartNavigation';
import { DriveNavigation } from '@/components/DriveNavigation';
import { DestinationPicker } from '@/components/DestinationPicker';
import { OSM_CART_PATHS } from '@/data/cartPaths';
import { hasHoleAd, holeAdFor } from '@/data/holeAds';
import { stopCallout } from '@/lib/calloutVoice';
import { loadCachedCartPaths, pullCartPaths, type RecordedCartPath } from '@/lib/cartPaths';
import { routeLegs } from '@/lib/cartRoute';
import type { DriveOnMap } from '@/components/HoleMap';

// Render from the bundled copy immediately, then swap in Supabase's rows when
// they land. The map is useful on the first frame and never blanks out if the
// network is gone - which, on a fairway, it often is.
/**
 * Room the hole screen's overlays take over the map, for framing a hole clear of
 * them: the pin tab's corner at the top, the hole bar and the buttons above it at
 * the bottom.
 */
const HOLE_SCREEN_INSETS = { top: 40, bottom: 124 };
/**
 * From 640 px wide - a phone on its side, a desktop - the hole bar floats in the
 * bottom corner instead of spanning the map, and a sideways phone's map is too
 * short to give up the room: the hole is framed on the whole map.
 */
const WIDE_SCREEN_INSETS = { top: 0, bottom: 0 };
const WIDE_QUERY = '(min-width: 640px)';

/** sessionStorage: the hole on screen, for coming back to it after a reload. */
const SELECTED_HOLE_KEY = 'golf.selectedHole';

/** Within this of the hole's tee marker, the player is on that tee - a tee box and a few paces. */
const ON_TEE_METRES = 40;

/**
 * On the hole already: on its tee, or near enough its line (tee, bends, pin) to
 * be playing it - lib/fairwayDistance's own measure of "on the fairway".
 */
const isOnHole = (hole: Hole, fix: { latitude: number; longitude: number }): boolean => {
  const line: FairwayPoint[] = [
    [hole.teeLatitude, hole.teeLongitude],
    ...(hole.path ?? []),
    [hole.latitude, hole.longitude],
  ];
  return readFairway(line, [fix.latitude, fix.longitude]).onLine;
};

/**
 * useState that survives the page being reloaded in the same tab.
 *
 * A phone discards a tab left in the background to free memory - KakaoTalk's
 * browser, Android and iOS all do - and reloads it when the player comes back.
 * The club saw that as the app "refreshing" to the start: the scorecard back
 * to the map, the walk to the next tee gone. sessionStorage lives exactly as
 * long as the tab, so each screen comes back as it was left, and a new tab
 * still starts fresh.
 */
function useTabState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* storage blocked or garbled - start from the default */
    }
    return initial;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* the screen simply will not survive a reload */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

const BUNDLED: CourseData = {
  course: {
    id: PELHAM_HILLS.id,
    name: PELHAM_HILLS.name,
    location: PELHAM_HILLS.location,
    par: PELHAM_HILLS.par,
    holes: PELHAM_HILLS.holes,
  },
  holes: PELHAM_HILLS_HOLES,
  offline: true,
};

export default function Golf() {
  const { courseId } = useParams<{ courseId: string }>();
  const [showSideMenu, setShowSideMenu] = useState(false);
  const [viewMode, setViewMode] = useTabState<'map' | 'scorecard'>('golf.viewMode', 'map');
  // Start out tracking the player; picking a hole hands the frame to that hole.
  const [followGps, setFollowGps] = useTabState('golf.followGps', true);
  // Every hole's line and number at once, from the button beside the course
  // name. Pressing it again, or picking a hole, goes back to that hole.
  const [courseView, setCourseView] = useTabState('golf.courseView', false);
  // What that full map is: the satellite one with every line, or the club's
  // printed course map - an admin's choice for every phone (lib/appSettings).
  // The last answer is kept on the phone, for opening it with no signal.
  const [fullMapStyle, setFullMapStyle] = useState<FullMapStyle>(cachedFullMapStyle);
  useEffect(() => {
    let alive = true;
    fetchFullMapStyle().then((style) => {
      if (alive && style) setFullMapStyle(style);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Which scorecard column the player is playing. White is the club's standard
  // men's card; everything else is a selector in the side menu.
  const [teeSet, setTeeSet] = useState<TeeSet>('white');
  // The round summary is shown once the 18th score lands, and can be dismissed
  // back to the card - dismissing must not make it pop up again on every render.
  const [summaryDismissed, setSummaryDismissed] = useState(false);

  // Reading holes aloud on GPS arrival. On unless the player has turned it off:
  // the start card's tap (RoundStartGate) is what buys the browser's permission
  // to make a sound, so narration no longer has to sell its own - see
  // AutoNarration.
  const [autoNarration, setAutoNarration] = useState(loadAutoNarrationPreference);
  // The hole the detector last announced, kept so the notice can offer a tap
  // when the browser declined to play it by itself.
  const [announcedHole, setAnnouncedHole] = useState<number | null>(null);
  // Whether that announcement was ever actually heard. Playing and having played
  // are different states, and only the third - never started - is a failure.
  const [announcedHolePlayed, setAnnouncedHolePlayed] = useState(false);

  // Whether this phone is allowed to ask where it is. Always, now.
  //
  // This was a switch in the side menu (components/GpsToggle), on by default.
  // The club asked for it forced: a round played with it off is an app that
  // looks broken, and the pro shop's player monitor cannot see a cart that
  // never reports. What that removes is a real escape hatch - a phone low on
  // battery on the 14th, a player who only wants the printed yardages - so if
  // the club wants it back, putting <GpsToggle> back in the menu and this back
  // on loadGpsPreference() is the whole change.
  //
  // It forces the app's own switch, not the browser's permission. A phone that
  // refuses location still refuses it, and GpsStatus is what says so.
  const gpsEnabled = true;

  // Whether the start card has been through. Per tab, not per phone: a reload
  // in the same tab must not ask again, and a new tab must.
  //
  // Only the card is remembered here, never the audio permission it bought.
  // That permission belongs to the document, and a reload is a new document -
  // narration.isUnlocked is the live answer, and the first tap of any kind buys
  // it back (the effect below).
  const [roundStarted, setRoundStarted] = useTabState('golf.roundStarted', false);

  // The club's offer on screen now (the 8th and the 17th - see data/holeAds),
  // and which of those two the player is currently on.
  //
  // `adArmedFor` used to be a list of holes already done this round, so each
  // offer was heard once and never again. The club asked for it the other way:
  // on the 8th, it speaks. Every arrival, not the first one of the round - a
  // player who walks back for a ball, or plays the front nine twice, is on the
  // 8th again and the pro shop's offer is just as true the second time.
  //
  // It is still one per visit, not one per fix. A player standing on that tee
  // sends a fix a second and every one of them is still the 8th; this holds the
  // hole they are on, and only clears when they have actually left it.
  const [adHole, setAdHole] = useTabState<number | null>('golf.adHole', null);
  const [adArmedFor, setAdArmedFor] = useTabState<number | null>('golf.adArmedFor', null);

  // Pointing the way to the next tee. Persisted, and still default-off - unlike
  // narration, which the club turned on for everyone: a voice reading the hole
  // is the guide people came for, a voice steering them off it is not. See
  // TeeGuidance.
  const [teeGuidance, setTeeGuidance] = useState(loadTeeGuidancePreference);
  // The hole a player asked to be walked away from without writing a score.
  // Holing out is the honest signal that the walk has begun, but a player who
  // does not keep score never sends it, so the card offers a button instead.
  const [walkingFrom, setWalkingFrom] = useTabState<number | null>('golf.walkingFrom', null);
  // The hole a player picked while somewhere else - the green before, the car
  // park. Until they reach it, the page walks them to its tee (the bar, the
  // line on the map, the column); on its tee or fairway it goes back to the pin.
  const [headingTo, setHeadingTo] = useTabState<number | null>('golf.headingTo', null);
  // "Hole out": where the cart is being driven - a tee or the clubhouse - along
  // the cart paths. Kept over a reload like the walk, since a discarded tab on
  // the way to the next tee is exactly when a player comes back to the app.
  const [drive, setDrive] = useTabState<DriveDestination | null>('golf.drive', null);
  const [pickingDestination, setPickingDestination] = useState(false);
  // How a walk to a tee is shown - the big card or the whole-screen map - the
  // player's pick, kept on the phone (WalkNavigation).
  const [navStyle, setNavStyle] = useState<NavStyle>(loadNavStyle);
  // The compass bearing at the top of the turned map - the walk's arrow points
  // on that map, not on a north-up one.
  const [mapBearing, setMapBearing] = useState(0);
  // The hole bar pulled up over the map, and the words behind the map's speak
  // button (FairwayDistance fills it).
  const [sheetOpen, setSheetOpen] = useState(false);
  const sayDistance = useRef<(() => void) | null>(null);
  const [wideScreen, setWideScreen] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWideScreen(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  // A walk the player ended by hand, by the hole it started from, so it does
  // not start again on the next fix.
  const [navDismissed, setNavDismissed] = useTabState<number | null>('golf.navDismissed', null);
  // The green an operator's simulated walk set off from. Guidance points from it
  // for the length of the walk, whatever the player's own switch says.
  const [simWalkFrom, setSimWalkFrom] = useState<number | null>(null);

  const [{ course, holes: courseHoles }, setCourseData] = useState<CourseData>(BUNDLED);

  // Layout edits an operator made in /admin/map on this device - redrawn lines
  // and renumbered holes - laid over the course data before anything reads it,
  // so the map, the arrival geofence and the offline download all agree. Other
  // devices have no edits and see the course data unchanged.
  const holePaths = useAppStore((s) => s.holePaths);
  const holes = useMemo(
    () => applyHoleEdits(courseHoles, holePaths),
    [courseHoles, holePaths]
  );

  useEffect(() => {
    const ac = new AbortController();
    fetchCourseData(undefined, ac.signal)
      .then((d) => {
        if (!ac.signal.aborted) setCourseData(d);
      })
      .catch(() => {
        /* fetchCourseData already falls back; keep the bundled copy */
      });
    return () => ac.abort();
  }, []);

  // Surveyed pins decide whether the map shows a live distance or the printed
  // yardage, so they load with the page - not with the side menu that captures
  // them, or a player who surveyed yesterday would open on the 1st tee and be
  // told the pin is unsurveyed.
  const setPinSurveys = useAppStore((s) => s.setPinSurveys);
  useEffect(() => {
    let alive = true;
    loadSurveys(courseId || PELHAM_HILLS.id).then((rows) => {
      if (alive) setPinSurveys(rows);
    });
    return () => {
      alive = false;
    };
  }, [courseId, setPinSurveys]);

  // Fairway lines an operator drew in /admin/map on this device. Loaded with the
  // page for the same reason as the surveys: the map draws them on the first
  // hole, not only after the editor has been opened in this session.
  const setHolePaths = useAppStore((s) => s.setHolePaths);
  // The copy kept on this phone draws first - it is all there is offline - and
  // the shared one an admin uploaded (hole_edits) replaces it when it arrives.
  useEffect(() => {
    let alive = true;
    const id = courseId || PELHAM_HILLS.id;
    loadHolePaths(id)
      .then((rows) => {
        if (alive) setHolePaths(rows);
        return pullHoleEdits(id);
      })
      .then(({ rows }) => {
        if (alive && rows) setHolePaths(rows);
      });
    return () => {
      alive = false;
    };
  }, [courseId, setHolePaths]);

  // /admin is not linked for players (see App.tsx). The map editor link shows
  // only in a tab that already holds the admin key.
  const [isOperator] = useState(() => getAdminKey() !== null);

  const { isTracking, startTracking, stopTracking } = useGPS({ enabled: gpsEnabled });
  const { setTee } = useScorecard();
  const setCurrentCourseId = useAppStore((s) => s.setCurrentCourseId);
  const selectHole = useAppStore((s) => s.setSelectedHole);

  // The map reads the selection straight from the store, so this page keeps no
  // copy of its own - two sources would let the two views drift apart.
  const selectedHoleNumber = useAppStore((s) => s.uiState.selectedHole);
  const selectedHole = useMemo(
    () => holes.find((h) => h.holeNumber === selectedHoleNumber) ?? holes[0],
    [holes, selectedHoleNumber]
  );

  // Frame the whole course on entry. Derived from the holes themselves so this
  // page carries no course-specific coordinates of its own.
  const center = useMemo(() => {
    const lats = holes.flatMap((h) => [h.latitude, h.teeLatitude]);
    const lngs = holes.flatMap((h) => [h.longitude, h.teeLongitude]);
    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
  }, [holes]);

  useEffect(() => {
    if (courseId) setCurrentCourseId(courseId);
  }, [courseId, setCurrentCourseId]);

  // Today's card: the one already started if there is one, uploaded to the
  // account when signed in. Keyed on the address, not on the course row - that
  // row's id changes when Supabase's copy replaces the bundled one.
  useScorecardSync(courseId || PELHAM_HILLS.id, teeSet);

  // The card remembers its tees, so reopening it mid-round puts every yardage
  // back on the tees being played rather than on White.
  const cardTee = useAppStore((s) => s.scorecard?.teeSet);
  useEffect(() => {
    if (cardTee) setTeeSet(cardTee);
  }, [cardTee]);

  const handleTeeChange = useCallback(
    (tee: TeeSet) => {
      setTeeSet(tee);
      void setTee(tee);
    },
    [setTee]
  );

  // Seed the store so the map draws hole 1 - the panel below already shows it,
  // and MapContent reads the selection from the store, not from this page.
  // A reload in the same tab - a pull-to-refresh the page could not block, an
  // in-app browser's own refresh button - comes back to the hole it left rather
  // than to the 1st. index.css blocks the gesture where the browser allows it.
  useEffect(() => {
    if (selectedHoleNumber === null) {
      let remembered: number | null = null;
      try {
        remembered = Number(sessionStorage.getItem(SELECTED_HOLE_KEY)) || null;
      } catch {
        /* storage disabled - start on the 1st */
      }
      selectHole(
        remembered !== null && holes.some((h) => h.holeNumber === remembered)
          ? remembered
          : holes[0].holeNumber
      );
    }
    // Once, on entry - later changes are the user's own hole picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedHoleNumber === null) return;
    try {
      sessionStorage.setItem(SELECTED_HOLE_KEY, String(selectedHoleNumber));
    } catch {
      /* the hole simply will not survive a reload */
    }
  }, [selectedHoleNumber]);

  useEffect(() => {
    // Start tracking by itself. The switch is kept in the test even though it
    // is now a constant: it is what makes this effect's shape right, and the
    // day GPS is optional again nothing here has to change.
    if (gpsEnabled && !isTracking) {
      startTracking();
    }

    return () => {
      // Keep tracking while user is on golf page
    };
  }, [gpsEnabled, isTracking, startTracking]);

  // The round is over when all 18 holes carry a score. Surfacing the card is the
  // point of keeping score, so the app goes there by itself rather than waiting
  // for a player walking off the 18th green to find the tab.
  const scores = useAppStore((s) => s.scores);
  const roundComplete = useMemo(() => isRoundComplete(scores), [scores]);

  useEffect(() => {
    if (roundComplete && !summaryDismissed) setViewMode('scorecard');
  }, [roundComplete, summaryDismissed]);

  // ---------------------------------------------------------------------------
  // The club's offers on the 8th and the 17th
  // ---------------------------------------------------------------------------

  /**
   * Bring up the offer for this hole. On the 8th and the 17th it goes up, full
   * stop - no switch of the player's turns it off, and nothing about earlier in
   * the round stops it.
   *
   * Three things call this, and they have to, because none of them covers the
   * round on its own: reaching the tee (GPS, whatever the narration switch
   * says), picking the hole by hand, and simply being on the hole's fairway (a
   * player who opened the app on the 8th and never tapped anything).
   */
  const adArmedRef = useRef(adArmedFor);
  adArmedRef.current = adArmedFor;

  /**
   * When each offer was last given, so that a boundary does not become a
   * stutter.
   *
   * isOnHole() is a hard yes/no against the hole's corridor with no margin in
   * it, and a phone reports ±10 m. A player sitting near the edge of the 8th
   * flips on/off/on between fixes, and "speak on every arrival" would read them
   * the same line over and over. A real second visit - walking back for a ball,
   * playing the front nine twice - is minutes away, never seconds.
   *
   * A ref, not tab state: a reload re-announcing is harmless, and `adArmedFor`
   * already survives one.
   */
  const adLastGivenRef = useRef<Record<number, number>>({});
  const AD_REPEAT_COOLDOWN_MS = 3 * 60_000;

  const offerHoleAd = useCallback(
    (holeNumber: number) => {
      if (!hasHoleAd(holeNumber)) return;
      // Already up for this visit. The next fix from the same tee is not a new
      // arrival, and re-showing the card would restart the voice over itself.
      if (adArmedRef.current === holeNumber) return;
      const last = adLastGivenRef.current[holeNumber];
      if (last && Date.now() - last < AD_REPEAT_COOLDOWN_MS) return;
      adLastGivenRef.current[holeNumber] = Date.now();
      adArmedRef.current = holeNumber;
      setAdArmedFor(holeNumber);
      setAdHole(holeNumber);
    },
    [setAdArmedFor, setAdHole]
  );

  /** Ready to speak again next time they reach one. Leaves the card alone. */
  const rearmHoleAd = useCallback(() => {
    if (adArmedRef.current === null) return;
    adArmedRef.current = null;
    setAdArmedFor(null);
  }, [setAdArmedFor]);

  /**
   * Actually walked off the hole, by the phone's reckoning rather than a tap.
   *
   * The card comes down with the arming, and it has to: HoleAd speaks once per
   * appearance, so a card still on screen from the last visit is a card that
   * stays quiet on the next one. It is also what this card always claimed to do
   * - sit above the hole bar "until they close it or walk to the next hole".
   *
   * Only position calls this. Tapping hole 9 to look at its yardage while
   * standing on the 8th is not leaving the 8th, and it must not snatch the
   * offer away before it has been read.
   */
  const leftHoleAd = useCallback(() => {
    if (adArmedRef.current === null) return;
    adArmedRef.current = null;
    setAdArmedFor(null);
    setAdHole(null);
  }, [setAdArmedFor, setAdHole]);

  // Being on the 8th or the 17th at all, tee to green. The detector that
  // announces holes only runs when narration or guidance is on, and the club
  // wants these two heard by every player, so they get their own test against
  // the fix rather than riding on that one.
  const gpsFix = useAppStore((s) => s.gpsPosition);
  useEffect(() => {
    if (!gpsFix) return;
    const on = holes.find((hole) => hasHoleAd(hole.holeNumber) && isOnHole(hole, gpsFix));
    if (on) {
      offerHoleAd(on.holeNumber);
    } else {
      // Walked off it. This is what makes a second visit speak again - without
      // it the first arrival would be the only one of the round.
      leftHoleAd();
    }
  }, [gpsFix, holes, offerHoleAd, leftHoleAd]);

  // ---------------------------------------------------------------------------
  // Telling the pro shop where this cart is
  // ---------------------------------------------------------------------------

  /**
   * Post the position every half minute, for /admin > 플레이어 (migration 0014).
   *
   * On a timer rather than on every fix: fixes arrive about once a second, and
   * the pro shop is looking at a map, not a stopwatch. The timer reads the
   * latest of everything through a ref, so a new fix - or the player finally
   * typing a name on the card - does not restart the interval.
   *
   * It fails silently by design. See lib/playerMonitor: a club that has not run
   * 0014 must not show a player an error about a screen in the back office.
   */
  const account = useAppStore((s) => s.account);
  const cardPlayerName = useAppStore((s) => s.scorecard?.players?.[0]?.name ?? null);
  const monitorLatest = useRef({
    gpsFix,
    holeNumber: selectedHoleNumber,
    courseId: courseId || PELHAM_HILLS.id,
    // 'Me' is what the card calls a player who never typed anything, so it
    // names nobody on a screen showing twenty carts - send it as no name.
    playerName: cardPlayerName && cardPlayerName !== 'Me' ? cardPlayerName : null,
    playerEmail: account?.email ?? null,
  });
  monitorLatest.current = {
    gpsFix,
    holeNumber: selectedHoleNumber,
    courseId: courseId || PELHAM_HILLS.id,
    playerName: cardPlayerName && cardPlayerName !== 'Me' ? cardPlayerName : null,
    playerEmail: account?.email ?? null,
  };

  // Only whether there is a fix at all restarts the timer - not the fix itself,
  // which changes every second.
  const hasFix = gpsFix !== null;
  useEffect(() => {
    // Not before Start. The start card is where the player is told the pro shop
    // can see their cart (RoundStartGate), and a fix arrives while that card is
    // still up - GPS is forced on and starts tracking on mount. Reporting
    // before the tap would put the telling after the thing it tells about.
    if (!hasFix || !roundStarted) return;
    const send = () => {
      const now = monitorLatest.current;
      if (!now.gpsFix) return;
      void reportPosition({
        courseId: now.courseId,
        latitude: now.gpsFix.latitude,
        longitude: now.gpsFix.longitude,
        accuracy: now.gpsFix.accuracy,
        holeNumber: now.holeNumber,
        playerName: now.playerName,
        playerEmail: now.playerEmail,
      });
    };

    // The first one goes as soon as there is a fix to send, not half a minute
    // after the round starts - a cart that appears on the monitor thirty
    // seconds late is a cart the pro shop calls about.
    send();
    const timer = setInterval(send, REPORT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasFix, roundStarted]);

  const handleHoleSelect = (hole: number) => {
    if (holes.some((h) => h.holeNumber === hole)) {
      selectHole(hole);
      setFollowGps(false);
      // Picking a hole - a number on the course view included - is going to it.
      setCourseView(false);
      // ...and says where the player is: that tee is the one listened for next.
      arrival.armFrom(hole);
      // "Next hole" from the green is "take me there": walk them to its tee.
      // Already on its tee or fairway, there is nothing to walk to.
      const picked = holes.find((h) => h.holeNumber === hole);
      const fix = useAppStore.getState().gpsPosition;
      setHeadingTo(picked && fix && !isOnHole(picked, fix) ? hole : null);
      setWalkingFrom(null);
      setNavDismissed(null);
      // Going to the 8th or the 17th by hand is the only signal there is with
      // GPS switched off - and picking any other hole is leaving it, which is
      // what lets a later return speak again.
      if (!hasHoleAd(hole)) rearmHoleAd();
      offerHoleAd(hole);
    }
  };

  // The course view holds still, so it stops following the player; coming back
  // frames the hole on screen (HoleMap) and leaves following off until asked.
  const toggleCourseView = () => {
    if (!courseView) {
      setFollowGps(false);
      // Ask again on the way in, so an admin's switch reaches a phone that has
      // had the app open all round.
      void fetchFullMapStyle().then((style) => style && setFullMapStyle(style));
    }
    setCourseView(!courseView);
    setViewMode('map');
  };

  // ---------------------------------------------------------------------------
  // Narration, and the GPS arrival that can start it
  // ---------------------------------------------------------------------------

  // One engine for the page. The side-menu panel is handed this rather than
  // building its own, because the menu is closed for most of a round and an
  // arrival must still have something to play through - see HoleNarration.
  const narration = useHoleNarration();

  // The browser only lets a tee's arrival make a sound after a tap on this
  // page, and a reload - which is how a player comes back to a tab the phone
  // discarded - spends that. So the first tap of any kind buys it back.
  // 'click', not 'pointerdown': a touch's pointerdown is not a gesture that
  // may start audio on Android or iOS.
  //
  // This used to wait for automatic narration to be on. It cannot any more:
  // the club's offers on the 8th and the 17th are read to everyone, including
  // the players who went to Manual - so the ones who most need this listener
  // were the ones it was never attached for.
  const { isUnlocked: narrationUnlocked, unlock: unlockNarration } = narration;
  useEffect(() => {
    if (narrationUnlocked) return;
    const onTap = () => void unlockNarration();
    document.addEventListener('click', onTap, { once: true, capture: true });
    return () => document.removeEventListener('click', onTap, { capture: true });
  }, [narrationUnlocked, unlockNarration]);

  // A hole is only a candidate for arrival if its tee is a real tee. toHole()
  // in lib/courseData falls back to the pin when a row carries no tee columns,
  // which is right for drawing a marker and wrong for a geofence: it would
  // announce the hole to a player standing on its green.
  const arrivalHoles = useMemo(
    () =>
      holes.filter(
        (h) => h.teeLatitude !== h.latitude || h.teeLongitude !== h.longitude
      ),
    [holes]
  );

  const handleArrival = useCallback(
    (holeNumber: number) => {
      selectHole(holeNumber);
      setFollowGps(true);
      setCourseView(false);
      setAnnouncedHole(holeNumber);
      setAnnouncedHolePlayed(false);
      // Reaching this tee is the end of the walk that was being guided; the next
      // one does not begin until this hole is done with.
      setWalkingFrom(null);
      setSimWalkFrom(null);
      setHeadingTo(null);
      setNavDismissed(null);
      // The detector also runs for guidance alone, and a player who armed the
      // voice once and then switched narration off must not be read to anyway.
      // Without an unlock this would be refused in silence, and the notice's
      // play button is the honest version of that. With one, it just plays.
      if (autoNarration && narration.isUnlocked) narration.play(holeNumber, teeSet);
      // The club's offer is not the narration switch's to refuse - it goes up
      // on the 8th and the 17th either way.
      offerHoleAd(holeNumber);
    },
    [autoNarration, narration, offerHoleAd, selectHole, teeSet]
  );

  // Guidance needs the detector running too: reaching the tee is what ends a
  // walk, and it is the arrival that clears the card. Tracking position was
  // never narration's property - it only looked that way while narration was the
  // only thing asking for it.
  // An operator's simulated arrival (useArrivalSimulation) runs this same detector,
  // so it has to be listening for the length of the run, even in Manual.
  const simulatingGps = useAppStore((s) => s.simulatingGps);
  const arrival = useHoleArrival(arrivalHoles, handleArrival, {
    // GPS off means no fixes, so the detector has nothing to chew on anyway -
    // but saying so here keeps the switch's meaning in one place rather than
    // relying on an empty store.
    enabled: simulatingGps || (gpsEnabled && (autoNarration || teeGuidance)),
  });

  // Opening the app is a pick too: the hole on screen - the 1st, or the one
  // this tab was last on - is the tee listened for, not every tee at once. With
  // all eighteen armed, a player waiting by the 10th tee (50 m from the 1st)
  // heard "Hole 10" and then never heard the 1st.
  const { armFrom: armArrivalFrom } = arrival;
  const armedOnEntry = useRef(false);
  useEffect(() => {
    if (armedOnEntry.current || selectedHoleNumber === null) return;
    armedOnEntry.current = true;
    armArrivalFrom(selectedHoleNumber);
  }, [selectedHoleNumber, armArrivalFrom]);

  // Standing on this hole's own tee is starting it, not walking away from it: a
  // score already on the card for it must not send the player to the next tee.
  const onThisTee = useAppStore((s) =>
    s.gpsPosition
      ? haversineMetres(
          s.gpsPosition.latitude,
          s.gpsPosition.longitude,
          selectedHole.teeLatitude,
          selectedHole.teeLongitude
        ) <= ON_TEE_METRES
      : false
  );

  // A walk starts when the hole on screen is finished with: a score written on
  // it, or the player saying so. Without that gate the card would be pointing at
  // the next tee while its owner still had a club in their hands on this one.
  // Walking to a picked hole ends on reaching it - its tee, or its fairway for
  // a player who cut straight across.
  const onSelectedHole = useAppStore((s) =>
    s.gpsPosition ? isOnHole(selectedHole, s.gpsPosition) : false
  );
  useEffect(() => {
    if (onSelectedHole) setHeadingTo(null);
  }, [onSelectedHole]);
  const headingHere = headingTo !== null && headingTo === selectedHole.holeNumber;

  // Walking to the picked hole's tee first; otherwise the next tee once this
  // hole is done with. The guidance points at the tee after `walkFrom`, so a
  // walk to hole N's tee is "from" N - 1 (hole 1's from 0).
  const playerWalkFrom = headingHere
    ? selectedHole.holeNumber - 1
    : teeGuidance &&
        !onThisTee &&
        (scores.has(selectedHole.holeNumber) || walkingFrom === selectedHole.holeNumber)
      ? selectedHole.holeNumber
      : null;
  // Cart paths: OpenStreetMap's, plus the ones an admin drove with the recorder
  // in /admin/map - the phone's last copy first, the server's when it answers.
  const cartCourseId = courseId || PELHAM_HILLS.id;
  const [recordedPaths, setRecordedPaths] = useState<RecordedCartPath[]>(() => loadCachedCartPaths(cartCourseId));
  useEffect(() => {
    let alive = true;
    void pullCartPaths(cartCourseId).then(({ rows }) => {
      if (alive && rows) setRecordedPaths(rows);
    });
    return () => {
      alive = false;
    };
  }, [cartCourseId]);
  const cartLines = useMemo(() => [...OSM_CART_PATHS, ...recordedPaths], [recordedPaths]);
  const target = useMemo(() => driveTarget(drive, holes), [drive, holes]);
  const cart = useCartNavigation(target, cartLines);
  const driving = target !== null;

  // Driving somewhere is the whole of the navigation: the walk to the next tee
  // steps aside until the drive ends.
  const walkFrom = driving
    ? null
    : simWalkFrom ?? (playerWalkFrom !== null && playerWalkFrom === navDismissed ? null : playerWalkFrom);

  // The walk to a picked tee is shown whatever the switch says - the player
  // asked for it with the tap - but only spoken with the switch on.
  const guidance = useTeeGuidance(arrivalHoles, walkFrom, {
    speak: teeGuidance || simulatingGps,
  });

  // A walk to a tee in progress: the navigation shows, the map draws the way
  // there, and in the whole-screen style the hole column steps aside.
  const walking = guidance.reading !== null && guidance.tee !== null;
  const fullScreenNav = driving || (walking && navStyle === 'map');
  // The hole screen's own layer over the map - not over the full map, and not
  // under the whole-screen navigation, which has the map to itself.
  const holeOverlays = !courseView && !fullScreenNav;
  // On the way to a tee the walk's figures are the ones that matter.
  const pinTabShown = holeOverlays && !walking;
  const chooseNavStyle = (style: NavStyle) => {
    setNavStyle(style);
    saveNavStyle(style);
  };
  const driveReading: DriveReading | null = target
    ? cart.reading ?? {
        status: 'no-fix',
        target,
        route: null,
        routeId: 0,
        progress: null,
        remainingYards: null,
        minutes: null,
      }
    : null;
  const driveRoute = cart.reading?.route ?? null;
  // A new route object comes with every reroute and only then.
  const driveLegs = useMemo(() => (driveRoute ? routeLegs(driveRoute) : []), [driveRoute]);
  const driveOnMap: DriveOnMap | null = target
    ? {
        targetKey: target.key,
        legs: driveLegs,
        heading: cart.reading?.progress?.heading ?? null,
        destination: target.point,
        label: target.label,
      }
    : null;

  const startDrive = (destination: DriveDestination) => {
    setPickingDestination(false);
    setSheetOpen(false);
    setCourseView(false);
    setViewMode('map');
    setWalkingFrom(null);
    setHeadingTo(null);
    setNavDismissed(null);
    setDrive(destination);
  };
  const endDrive = () => setDrive(null);

  // At a tee the hole comes back on screen; the "arrived" banner stays a moment
  // and goes by itself. At the clubhouse it waits for Done.
  const arrivedHole = driveReading?.status === 'arrived' ? target?.holeNumber ?? null : null;
  const { armFrom: armDriveArrival } = arrival;
  useEffect(() => {
    if (arrivedHole === null) return;
    selectHole(arrivedHole);
    setFollowGps(true);
    armDriveArrival(arrivedHole);
    const done = window.setTimeout(() => setDrive(null), 5000);
    return () => window.clearTimeout(done);
    // Once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedHole]);

  const endWalk = () => {
    setNavDismissed(walkFrom);
    setHeadingTo(null);
    setWalkingFrom(null);
  };

  const setTeeGuidanceEnabled = useCallback((enabled: boolean) => {
    setTeeGuidance(enabled);
    saveTeeGuidancePreference(enabled);
    if (!enabled) setWalkingFrom(null);
  }, []);

  const setAutoNarrationEnabled = useCallback((enabled: boolean) => {
    setAutoNarration(enabled);
    saveAutoNarrationPreference(enabled);
    if (!enabled) setAnnouncedHole(null);
  }, []);

  // The announced hole is playing right now if the engine says so, and has been
  // heard if it ever did - the engine only reports the former, and it stops
  // reporting it the moment the clip ends.
  const announcedIsPlaying =
    announcedHole !== null &&
    narration.speakingId === narrationId(announcedHole, teeSet);

  useEffect(() => {
    if (announcedIsPlaying) setAnnouncedHolePlayed(true);
  }, [announcedIsPlaying]);

  // A hole the player chose to hear is a hole the detector must not announce
  // again - and the first such tap is also how a player who started on the 10th
  // tee tells it where the round began.
  const playNarration = useCallback(
    (holeNumber: number, tee: TeeSet) => {
      arrival.markPlayed(holeNumber);
      narration.play(holeNumber, tee);
    },
    [arrival, narration]
  );

  const menuNarration = { ...narration, play: playNarration };

  // An operator's simulated arrival must reach a hole the detector is watching,
  // and it only ever watches the next hole or two. So the round is moved to just
  // before the chosen hole - and hole 1 gets a genuinely fresh round, the cold
  // start a player's first tee really is, rather than a shortcut around it.
  const { reset: resetArrival, markPlayed: markArrivalPlayed } = arrival;
  const prepareSimulatedArrival = useCallback(
    (holeNumber: number) => {
      resetArrival();
      if (holeNumber !== arrivalHoles[0]?.holeNumber) markArrivalPlayed(holeNumber - 1);
    },
    [arrivalHoles, resetArrival, markArrivalPlayed]
  );

  const simulation = useArrivalSimulation();
  const simulationRunning = simulation.run !== null;

  // A walk's directions end with the walk - arrival clears them in
  // handleArrival, and a run stopped short of the tee clears them here.
  useEffect(() => {
    if (!simulationRunning) setSimWalkFrom(null);
  }, [simulationRunning]);

  const startSimulation = (holeNumber: number, walk: boolean, realPace: boolean) => {
    const tee = arrivalHoles.find((h) => h.holeNumber === holeNumber);
    if (!tee) return;

    // A walk sets off from the green of the hole before, standing where a
    // player putting out there would.
    const previous = walk
      ? holes
          .filter((h) => h.holeNumber < holeNumber)
          .sort((a, b) => b.holeNumber - a.holeNumber)[0]
      : undefined;
    if (walk && !previous) return;

    // Both voices are paid for inside this tap - the narration's audio and the
    // directions' speech - for the reason AutoNarration and TeeGuidanceToggle
    // give: the moment either speaks is a GPS fix, nowhere near a gesture.
    void narration.unlock();
    if (walk) guidance.unlock();

    prepareSimulatedArrival(holeNumber);

    if (previous) {
      selectHole(previous.holeNumber);
      setFollowGps(true);
      setSimWalkFrom(previous.holeNumber);
    }

    simulation.start({
      tee,
      from: previous ? { latitude: previous.latitude, longitude: previous.longitude } : null,
      realPace,
    });
  };

  return (
    // 100dvh, not h-screen: on a phone 100vh is taller than what is visible while
    // the address bar is showing, so the bottom of the page - the Map/Scorecard
    // buttons - sat under the browser chrome and the map lost that height.
    <div className="h-[100dvh] flex flex-col bg-background text-foreground overflow-hidden">
      {/* The round does not begin until it is tapped. That tap is the only
          gesture anywhere near the 8th tee, and it is what buys the right to
          speak the club's offers there and on the 17th - see RoundStartGate.
          The page is built underneath it meanwhile, so the map is ready. */}
      {!roundStarted && (
        <RoundStartGate
          courseName={course.name}
          unlock={narration.unlock}
          onStart={() => setRoundStarted(true)}
        />
      )}

      {/* Header. The course name gets the whole first row. Sharing one row with
          the status pills and the menu squeezed it to one word per line on a
          phone, and the header took a third of the screen the map needed. */}
      {/* A phone turned on its side (`short`: landscape, under 500 px tall) has
          height to spare nowhere. The header folds into one row and takes the
          Map/Scorecard switch from the bottom bar, which goes away - the map
          gets about 340 px of a 390 px screen instead of 250. */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 border-b border-border bg-card px-4 py-2 short:py-1">
          <div className="col-start-1 row-start-1 min-w-0 flex items-center gap-2">
            <h1 className="text-lg font-bold leading-tight truncate short:text-base">{course.name}</h1>

            {/* The whole course with every hole's number and line; pressed
                again, back to the hole on screen. */}
            <button
              onClick={toggleCourseView}
              aria-pressed={courseView}
              className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
                courseView
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground hover:bg-accent'
              }`}
            >
              {courseView ? (
                <>
                  <Flag className="w-3.5 h-3.5" />
                  Back to hole {selectedHole.holeNumber}
                </>
              ) : (
                <>
                  <MapIcon className="w-3.5 h-3.5" />
                  Full map
                </>
              )}
            </button>

            <div
              role="group"
              aria-label="View"
              className="hidden short:inline-flex shrink-0 rounded-lg bg-muted p-0.5"
            >
              {(['map', 'scorecard'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    viewMode === mode
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {mode === 'map' ? 'Map' : 'Scorecard'}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setShowSideMenu(!showSideMenu)}
            aria-label={showSideMenu ? 'Close menu' : 'Open menu'}
            className="col-start-3 row-start-1 p-2 -mr-2 hover:bg-accent rounded-lg shrink-0"
          >
            {showSideMenu ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>

        <p className="col-start-1 row-start-2 min-w-0 text-xs text-muted-foreground truncate short:hidden">
          {course.location} · Par {course.par} · {course.holes} holes
        </p>
        {/* One set of status pills: under the menu upright, beside the switch sideways. */}
        <div className="col-start-2 col-span-2 row-start-2 justify-self-end flex items-center gap-1.5 short:col-span-1 short:row-start-1">
          {/* No `enabled`/`onEnable`: GPS cannot be switched off any more, so the
              only thing left for the pill to report is the browser's answer. */}
          <GpsStatus onRetry={startTracking} />
          <OnlineStatus />
          <SyncStatus />
        </div>
      </header>

      {/* The club's offer for this hole (the 8th, the 17th). Under the header
          rather than over the map: a card a player has to move to see the pin
          is a card they learn to close without reading. It reads itself aloud
          - see HoleAd - which is what the start card's tap paid for. */}
      {adHole !== null && holeAdFor(adHole) && (
        <HoleAd
          // A fresh card per appearance: HoleAd speaks once per mount, and the
          // 8th coming round a second time has to be a second card. adHole
          // alone is enough - walking off sets it to null, so a return is a
          // real null -> 8 remount. Keying on adArmedFor too would mount twice
          // on the way in, because the two are separate state writes.
          key={adHole}
          ad={holeAdFor(adHole)!}
          canSpeak={narration.isUnlocked}
          // Silence whatever is talking first - and that is two different
          // things. narration.stop() cancels the speech engine, which is where
          // a hole's commentary lives; a yardage callout is a baked clip in an
          // audio element, and cancel() does nothing to one of those. Without
          // stopCallout() the offer talks over the callout and a player on the
          // 17th hears both at once.
          onBeforeSpeak={() => {
            narration.stop();
            stopCallout();
          }}
          onClose={() => setAdHole(null)}
          className="mx-3 mt-2 shrink-0"
        />
      )}

      <div className="relative flex flex-1 overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 flex flex-col">
          {viewMode === 'map' ? (
            <>
              {/* Map view, Hole19-style (the club's ask): the map is the whole
                  screen and the hole sits on it - the pin's yardage in the top
                  corner, the aim's on the left edge, tools down the right, the
                  hole number along the bottom. What used to be the column beside
                  the map is the sheet that bar pulls up. */}
              <div className="flex-1 min-h-0 flex">
                <div className="relative flex-1 min-w-0 overflow-hidden">
                  {driveReading && (
                    <DriveNavigation
                      reading={driveReading}
                      onEnd={endDrive}
                      onSpeak={
                        cart.isSupported
                          ? (text) => cart.speak(text, { lang: 'en-US', id: 'cart-navigation' })
                          : undefined
                      }
                    />
                  )}
                  {!driving && fullScreenNav && guidance.reading && (
                    <WalkNavigation
                      reading={guidance.reading}
                      style="map"
                      mapBearing={mapBearing}
                      onStyle={chooseNavStyle}
                      onEnd={endWalk}
                    />
                  )}
                  <HoleMap
                    courseId={courseId || course.id}
                    holes={holes}
                    center={center}
                    zoom={16}
                    followGps={followGps}
                    courseView={courseView}
                    printedMap={fullMapStyle === 'printed'}
                    walkTo={walking ? guidance.tee : null}
                    drive={driveOnMap}
                    // The whole-screen banner's height, so the player is kept below it.
                    walkTopInset={driving ? 170 : fullScreenNav ? 150 : 0}
                    onHoleClick={handleHoleSelect}
                    onBearingChange={setMapBearing}
                    holeOverlays={holeOverlays}
                    insets={wideScreen ? WIDE_SCREEN_INSETS : HOLE_SCREEN_INSETS}
                    toolbarTop={pinTabShown ? 76 : 8}
                    toolbar={
                      <button
                        type="button"
                        onClick={() => setViewMode('scorecard')}
                        aria-label="Open the scorecard"
                        title="Scorecard"
                        className="grid h-11 w-11 place-items-center rounded-xl text-white hover:bg-white/10"
                      >
                        <ClipboardList className="h-5 w-5" />
                      </button>
                    }
                  />

                  {pinTabShown && (
                    <PinTab
                      key={selectedHole.holeNumber}
                      hole={selectedHole}
                      teeSet={teeSet}
                      className="absolute right-0 top-0 z-[900]"
                    />
                  )}

                  {holeOverlays && (
                    <HoleSheet
                      holeNumber={selectedHole.holeNumber}
                      holeCount={holes.length}
                      onSelectHole={handleHoleSelect}
                      open={sheetOpen}
                      onToggle={() => setSheetOpen((o) => !o)}
                      actions={
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => sayDistance.current?.()}
                            aria-label="Say the distance"
                            className="flex h-12 items-center gap-2 rounded-full bg-slate-900/95 px-4 text-sm font-semibold text-white shadow-lg"
                          >
                            <Volume2 className="h-5 w-5" />
                            Yardage
                          </button>
                          {/* Done with the hole: pick where the cart goes next. The tap
                              also buys the browser's permission for the turn-by-turn voice. */}
                          <button
                            type="button"
                            onClick={() => {
                              cart.unlock();
                              setPickingDestination(true);
                            }}
                            className="flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground shadow-lg"
                          >
                            <Car className="h-5 w-5" />
                            Hole out
                          </button>
                          {/* The pro shop, from the same bar. Until now the only way
                              in was the offer card on the 8th and the 17th, which is
                              two holes out of eighteen and gone once it is closed -
                              a player who wants a drink on the 5th had nowhere to
                              tap. Ten minutes to the counter is the club's promise
                              (see pages/Food), so it has to be reachable all round.
                              
                              The knife and fork with no word beside it, because a
                              third labelled pill does not fit: this row shares 390 px
                              with the sheet's own button, and "Yardage" and "Hole
                              out" already spend 240 of it. Labelling this one would
                              push one of those off the screen. */}
                          <Link
                            href="/food"
                            aria-label="F&amp;B order from the pro shop"
                            title="F&amp;B order"
                            className="grid h-12 w-12 place-items-center rounded-full bg-amber-600 text-white shadow-lg hover:opacity-90"
                          >
                            <UtensilsCrossed className="h-5 w-5" />
                          </Link>
                        </div>
                      }
                    >
                      <HoleGuide
                        hideTitle
                        holeNumber={selectedHole.holeNumber}
                        holeCount={holes.length}
                        teeSet={teeSet}
                        followGps={followGps}
                        onSelectHole={handleHoleSelect}
                        onToggleFollow={() => {
                          setCourseView(false);
                          setFollowGps((on) => !on);
                        }}
                        autoNarration={autoNarration}
                        // unlock() is called synchronously inside this tap, the same
                        // bargain the side menu's control makes - see AutoNarration.
                        onChooseNarration={(auto) => {
                          if (auto) void narration.unlock();
                          setAutoNarrationEnabled(auto);
                        }}
                        // Yards to the pin along the hole, on every hole, from the
                        // pin as the map has it - "about" until it is surveyed.
                        // Mounted while the sheet is down: it speaks by itself.
                        lead={
                          <FairwayDistance
                            hole={selectedHole}
                            narrationBusy={narration.isSpeaking}
                            onBeforeSpeak={narration.stop}
                            toTee={walking ? guidance.reading : null}
                            sayRef={sayDistance}
                          />
                        }
                      >
                        {/* Live yardage to the green, from the book when the pin is
                            not surveyed - see PIN_COORDINATES_VERIFIED. */}
                        <GreenDistances
                          compact
                          holeNumber={selectedHole.holeNumber}
                          tee={teeSet}
                          className="border-t border-border pt-2.5"
                        />
                      </HoleGuide>
                    </HoleSheet>
                  )}
                </div>
              </div>

              {/* An operator's simulation in progress, and the way to end it
                  with the menu closed - the menu is where it was started, and
                  on a phone the menu covers everything this run is showing. */}
              {simulation.run && (
                <div
                  role="status"
                  aria-label="Simulation in progress"
                  className="flex items-center gap-3 border-t border-dashed border-amber-500/60 bg-amber-500/10 px-4 py-2"
                >
                  <FlaskConical className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-500" />
                  <p className="flex-1 min-w-0 text-xs">
                    <span className="font-semibold">Simulation</span>
                    {simulation.run.phase === 'walking'
                      ? ` · walking to the hole ${simulation.run.holeNumber} tee, ${Math.round(simulation.run.yardsLeft)} yds to go`
                      : ` · standing on the hole ${simulation.run.holeNumber} tee, ${simulation.run.waitedMs / 1000} / 20 s`}
                  </p>
                  <button
                    onClick={simulation.stop}
                    aria-label="Stop the simulation"
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-accent flex items-center gap-1.5"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Stop
                  </button>
                </div>
              )}

              {/* What GPS decided, and a way to hear it if the browser would
                  not play it unprompted */}
              {autoNarration && announcedHole !== null && (
                <ArrivalNotice
                  holeNumber={announcedHole}
                  isPlaying={announcedIsPlaying}
                  hasPlayed={announcedHolePlayed}
                  onPlay={() => playNarration(announcedHole, teeSet)}
                  onStop={narration.stop}
                  onDismiss={() => setAnnouncedHole(null)}
                />
              )}

              {pickingDestination && (
                <DestinationPicker
                  holeNumber={selectedHole.holeNumber}
                  holeCount={holes.length}
                  onPick={startDrive}
                  onClose={() => setPickingDestination(false)}
                />
              )}

              {/* Which way the next tee is, for the walk there */}
              {walking && guidance.reading && navStyle === 'card' && (
                <WalkNavigation
                  reading={guidance.reading}
                  style="card"
                  mapBearing={mapBearing}
                  onStyle={chooseNavStyle}
                  onEnd={endWalk}
                />
              )}

              {/* Guidance is armed but this hole has no score on it yet. One tap
                  is the player saying they are done with it - see walkingFrom. */}
              {teeGuidance &&
                guidance.reading === null &&
                nextTee(arrivalHoles, selectedHole.holeNumber) !== null && (
                  <button
                    onClick={() => {
                      guidance.unlock();
                      setWalkingFrom(selectedHole.holeNumber);
                    }}
                    className="border-t border-border px-4 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
                  >
                    Done with hole {selectedHole.holeNumber} - walk me to the next
                    tee
                  </button>
                )}
            </>
          ) : (
            <>
              {/* Scorecard view. Narrow side padding on a phone: the printed
                  card is 12 columns wide and every pixel goes to its boxes. */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-3 sm:p-4">
                {roundComplete && !summaryDismissed && (
                  <RoundSummary
                    scores={scores}
                    teeSet={teeSet}
                    courseName={course.name}
                    onClose={() => setSummaryDismissed(true)}
                    className="mb-4"
                  />
                )}

                <ScoreCard onTeeChange={handleTeeChange} />

                {/* 배너는 스코어카드 아래에만 둡니다. 지도 화면은 거리를 보는
                    곳이라 무엇으로도 가리지 않습니다. */}
                <PromoBanner placement="scorecard" className="mt-4 mx-auto" />
              </div>
            </>
          )}

          {/* Bottom navigation */}
          <div className="border-t border-border bg-card p-3 flex gap-2 short:hidden">
            <button
              onClick={() => setViewMode('map')}
              className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors ${
                viewMode === 'map'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              Map
            </button>
            <button
              onClick={() => setViewMode('scorecard')}
              className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors ${
                viewMode === 'scorecard'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              Scorecard
            </button>
          </div>
        </div>

        {/* Side menu. On a phone it covers the map rather than sitting beside
            it: side by side, a 390 px screen left the map and the hole's
            information a third of the width each and neither readable. The menu
            button opens it and the same button hands the screen back to the map.
            It is an overlay rather than a swap so the map stays mounted and
            sized underneath - Leaflet does not notice a container that was
            hidden and shown again, and would come back half grey. The z-index
            clears Leaflet's controls, which sit at 1000. */}
        {showSideMenu && (
          <div className="absolute inset-0 z-[1100] w-full bg-card overflow-y-auto overscroll-contain flex flex-col md:static md:z-auto md:w-80 md:border-l md:border-border">
            <div className="flex-1 p-4 space-y-6">
              {/* Food from the pro shop, ordered from the fairway for a
                  pickup time. The hole on screen goes with the order. */}
              <Link
                href="/food"
                className="flex h-12 items-center gap-3 rounded-xl bg-primary px-4 text-base font-bold text-primary-foreground"
              >
                <UtensilsCrossed className="h-5 w-5 shrink-0" />
                Order food from the pro shop
              </Link>

              {/* Which card you are playing - drives every yardage on screen */}
              <div>
                <h2 className="text-sm font-semibold mb-3">Tees</h2>
                <TeeSelector value={teeSet} onChange={handleTeeChange} />
              </div>

              {/* The selected hole's page from the club's printed book */}
              <HoleCard holeNumber={selectedHole.holeNumber} teeSet={teeSet} />

              {/* Hand the reading over to GPS - and buy the audio permission
                  that lets it speak without a tap */}
              <AutoNarration
                enabled={autoNarration}
                onChange={setAutoNarrationEnabled}
                unlock={narration.unlock}
                candidateHole={arrival.candidateHole}
              />

              {/* And the other half of the round: the walk to the next tee */}
              <TeeGuidanceToggle
                enabled={teeGuidance}
                onChange={setTeeGuidanceEnabled}
                unlock={guidance.unlock}
                targetHole={guidance.tee?.holeNumber ?? null}
              />

              {/* Stand on a tee without going there, and hear what a player
                  would - operators only */}
              {isOperator && arrivalHoles.length > 0 && (
                <ArrivalSimulator
                  holes={arrivalHoles}
                  currentHole={selectedHole.holeNumber}
                  autoNarration={autoNarration}
                  announced={arrival.announced}
                  run={simulation.run}
                  finished={simulation.finished}
                  onStart={startSimulation}
                  onStop={simulation.stop}
                  className="rounded-lg border border-dashed border-border p-3"
                />
              )}

              {/* The club's own commentary for this hole, read aloud */}
              <HoleNarration
                holeNumber={selectedHole.holeNumber}
                teeSet={teeSet}
                narration={menuNarration}
              />

              {/* Capture this hole's pin on site - the only thing that turns
                  live distances on, hole by hole */}
              <PinSurveyor
                courseId={courseId || course.id}
                holeNumber={selectedHole.holeNumber}
              />

              {/* Straight to this hole in the fairway line editor - operators only */}
              {isOperator && (
                <Link
                  href={`/admin/map?hole=${selectedHole.holeNumber}`}
                  className="w-full py-2 px-3 rounded-lg text-xs font-medium bg-muted hover:bg-accent flex items-center justify-center gap-1.5"
                >
                  <PenLine className="w-3.5 h-3.5" />
                  Edit hole {selectedHole.holeNumber}&apos;s fairway line
                </Link>
              )}

              {/* Pull the basemap down before teeing off */}
              <OfflineCourse courseId={courseId || course.id} holes={holes} />

              {/* And the recorded voice that reads the holes */}
              <OfflineNarration />

              {/* Spoken course introduction */}
              <CourseIntro />

              {/* Scorecard in sidebar */}
              <div>
                <h2 className="text-sm font-semibold mb-3">Progress</h2>
                <ScoreCard
                  compact
                  onOpen={() => {
                    setViewMode('scorecard');
                    if (window.matchMedia('(max-width: 767px)').matches) setShowSideMenu(false);
                  }}
                />
              </div>

              {/* Hole list */}
              <div>
                <h2 className="text-sm font-semibold mb-3">Holes</h2>
                <div className="space-y-2">
                  {holes.map((hole) => (
                    <button
                      key={hole.holeNumber}
                      onClick={() => {
                        handleHoleSelect(hole.holeNumber);
                        setViewMode('map');
                        // On a phone the menu covers the map, so picking a hole
                        // goes back to it. Beside the map there is nothing to
                        // uncover, and the menu stays for the next pick.
                        if (window.matchMedia('(max-width: 767px)').matches) {
                          setShowSideMenu(false);
                        }
                      }}
                      className={`w-full p-2 rounded-lg text-left text-sm transition-colors ${
                        selectedHole?.holeNumber === hole.holeNumber
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-accent'
                      }`}
                    >
                      <div className="font-medium">
                        Hole {hole.holeNumber}
                        <span className="float-right text-xs">Par {hole.par}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Statistics
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-accent text-center">
                    <div className="text-xs text-muted-foreground">Holes</div>
                    <div className="text-lg font-bold">
                      {holes.length}/18
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-accent text-center">
                    <div className="text-xs text-muted-foreground">Score</div>
                    <div className="text-lg font-bold">--</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Close button */}
            <div className="p-3 border-t border-border">
              <button
                onClick={() => setShowSideMenu(false)}
                className="w-full py-2 px-3 text-sm font-medium bg-muted rounded-lg hover:bg-accent"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
