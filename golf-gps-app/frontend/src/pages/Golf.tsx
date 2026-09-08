import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'wouter';
import { useGPS, useScorecard } from '@/hooks';
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
} from '@/components';
import { Menu, X, TrendingUp } from 'lucide-react';
import { PELHAM_HILLS, PELHAM_HILLS_HOLES } from '@/data/pelhamHills';
import { fetchCourseData, type CourseData } from '@/lib/courseData';
import type { TeeSet } from '@/data/pelhamHillsBook';
import { isRoundComplete } from '@/lib/roundSummary';
import { loadSurveys } from '@/lib/pinSurvey';

// Render from the bundled copy immediately, then swap in Supabase's rows when
// they land. The map is useful on the first frame and never blanks out if the
// network is gone - which, on a fairway, it often is.
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
  const [viewMode, setViewMode] = useState<'map' | 'scorecard'>('map');
  // Start out tracking the player; picking a hole hands the frame to that hole.
  const [followGps, setFollowGps] = useState(true);

  // Which scorecard column the player is playing. White is the club's standard
  // men's card; everything else is a selector in the side menu.
  const [teeSet, setTeeSet] = useState<TeeSet>('white');
  // The round summary is shown once the 18th score lands, and can be dismissed
  // back to the card - dismissing must not make it pop up again on every render.
  const [summaryDismissed, setSummaryDismissed] = useState(false);

  const [{ course, holes }, setCourseData] = useState<CourseData>(BUNDLED);

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

  const { isTracking, startTracking, stopTracking } = useGPS();
  const { createRound, currentRound } = useScorecard();
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
    if (courseId) {
      setCurrentCourseId(courseId);
      // Initialize round
      if (!currentRound) {
        createRound(courseId, 18);
      }
    }
  }, [courseId, setCurrentCourseId, currentRound, createRound]);

  // Seed the store so the map draws hole 1 - the panel below already shows it,
  // and MapContent reads the selection from the store, not from this page.
  useEffect(() => {
    if (selectedHoleNumber === null) {
      selectHole(holes[0].holeNumber);
    }
    // Once, on entry - later changes are the user's own hole picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Auto-start GPS tracking
    if (!isTracking) {
      startTracking();
    }

    return () => {
      // Keep tracking while user is on golf page
    };
  }, [isTracking, startTracking]);

  // The round is over when all 18 holes carry a score. Surfacing the card is the
  // point of keeping score, so the app goes there by itself rather than waiting
  // for a player walking off the 18th green to find the tab.
  const scores = useAppStore((s) => s.scores);
  const roundComplete = useMemo(() => isRoundComplete(scores), [scores]);

  useEffect(() => {
    if (roundComplete && !summaryDismissed) setViewMode('scorecard');
  }, [roundComplete, summaryDismissed]);

  const handleHoleSelect = (hole: number) => {
    if (holes.some((h) => h.holeNumber === hole)) {
      selectHole(hole);
      setFollowGps(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{course.name}</h1>
          <p className="text-xs text-muted-foreground">
            {course.location} · Par {course.par} · {course.holes} holes
          </p>
        </div>

        <div className="flex items-center gap-2">
          <OnlineStatus />
          <SyncStatus />

          <button
            onClick={() => setShowSideMenu(!showSideMenu)}
            className="p-2 hover:bg-accent rounded-lg"
          >
            {showSideMenu ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 flex flex-col">
          {viewMode === 'map' ? (
            <>
              {/* Map view */}
              <div className="flex-1 overflow-hidden">
                <HoleMap
                  courseId={courseId || course.id}
                  holes={holes}
                  center={center}
                  zoom={16}
                  followGps={followGps}
                  onHoleClick={handleHoleSelect}
                />
              </div>

              {/* Live yardage to the green, from the book when the pin is not
                  surveyed - see PIN_COORDINATES_VERIFIED. */}
              <GreenDistances
                holeNumber={selectedHole.holeNumber}
                tee={teeSet}
                className="border-t border-border px-4 py-3"
              />

              {/* Hole-by-hole guide */}
              <HoleGuide
                holeNumber={selectedHole.holeNumber}
                holeCount={holes.length}
                teeSet={teeSet}
                followGps={followGps}
                onSelectHole={handleHoleSelect}
                onToggleFollow={() => setFollowGps((on) => !on)}
              />
            </>
          ) : (
            <>
              {/* Scorecard view */}
              <div className="flex-1 overflow-y-auto p-4">
                {roundComplete && !summaryDismissed && (
                  <RoundSummary
                    scores={scores}
                    teeSet={teeSet}
                    courseName={course.name}
                    onClose={() => setSummaryDismissed(true)}
                    className="mb-4"
                  />
                )}

                <ScoreCard courseId={courseId} />

                {/* 배너는 스코어카드 아래에만 둡니다. 지도 화면은 거리를 보는
                    곳이라 무엇으로도 가리지 않습니다. */}
                <PromoBanner placement="scorecard" className="mt-4 mx-auto" />
              </div>
            </>
          )}

          {/* Bottom navigation */}
          <div className="border-t border-border bg-card p-3 flex gap-2">
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

        {/* Side menu */}
        {showSideMenu && (
          <div className="w-80 border-l border-border bg-card overflow-y-auto flex flex-col">
            <div className="flex-1 p-4 space-y-6">
              {/* Which card you are playing - drives every yardage on screen */}
              <div>
                <h2 className="text-sm font-semibold mb-3">Tees</h2>
                <TeeSelector value={teeSet} onChange={setTeeSet} />
              </div>

              {/* The selected hole's page from the club's printed book */}
              <HoleCard holeNumber={selectedHole.holeNumber} teeSet={teeSet} />

              {/* The club's own commentary for this hole, read aloud */}
              <HoleNarration
                holeNumber={selectedHole.holeNumber}
                teeSet={teeSet}
              />

              {/* Capture this hole's pin on site - the only thing that turns
                  live distances on, hole by hole */}
              <PinSurveyor
                courseId={courseId || course.id}
                holeNumber={selectedHole.holeNumber}
              />

              {/* Pull the basemap down before teeing off */}
              <OfflineCourse courseId={courseId || course.id} holes={holes} />

              {/* And the recorded voice that reads the holes */}
              <OfflineNarration />

              {/* Spoken course introduction */}
              <CourseIntro />

              {/* Scorecard in sidebar */}
              <div>
                <h2 className="text-sm font-semibold mb-3">Progress</h2>
                <ScoreCard compact={true} />
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
