import React, { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import { useGPS, useScorecard } from '@/hooks';
import { useAppStore } from '@/store/appStore';
import {
  HoleMap,
  DistanceIndicator,
  ScoreCard,
  OnlineStatus,
  SyncStatus,
} from '@/components';
import { Menu, X, MapPin, TrendingUp } from 'lucide-react';

// Mock holes data - replace with API call
const MOCK_HOLES = [
  {
    holeNumber: 1,
    latitude: 40.0,
    longitude: -74.0,
    par: 4,
    handicap: 5,
  },
  {
    holeNumber: 2,
    latitude: 40.001,
    longitude: -74.001,
    par: 3,
    handicap: 15,
  },
  {
    holeNumber: 3,
    latitude: 40.002,
    longitude: -74.002,
    par: 5,
    handicap: 1,
  },
];

export default function Golf() {
  const { courseId } = useParams<{ courseId: string }>();
  const [showSideMenu, setShowSideMenu] = useState(false);
  const [viewMode, setViewMode] = useState<'map' | 'scorecard'>('map');
  const [selectedHole, setSelectedHole] = useState<
    (typeof MOCK_HOLES)[0] | null
  >(MOCK_HOLES[0]);

  const { isTracking, startTracking, stopTracking } = useGPS();
  const { createRound, currentRound } = useScorecard();
  const { setCurrentCourseId, setSelectedHole: selectHole } = useAppStore();

  useEffect(() => {
    if (courseId) {
      setCurrentCourseId(courseId);
      // Initialize round
      if (!currentRound) {
        createRound(courseId, 18);
      }
    }
  }, [courseId, setCurrentCourseId, currentRound, createRound]);

  useEffect(() => {
    // Auto-start GPS tracking
    if (!isTracking) {
      startTracking();
    }

    return () => {
      // Keep tracking while user is on golf page
    };
  }, [isTracking, startTracking]);

  const handleHoleSelect = (hole: number) => {
    const found = MOCK_HOLES.find((h) => h.holeNumber === hole);
    if (found) {
      setSelectedHole(found);
      selectHole(hole);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Golf GPS</h1>
          <p className="text-xs text-muted-foreground">Course {courseId}</p>
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
                  courseId={courseId || '1'}
                  holes={MOCK_HOLES}
                  center={{ lat: 40.0, lng: -74.0 }}
                  zoom={16}
                  onHoleClick={handleHoleSelect}
                />
              </div>

              {/* Bottom info bar with distance */}
              {selectedHole && (
                <div className="border-t border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <MapPin className="w-5 h-5 text-primary" />
                      <div>
                        <div className="text-sm font-semibold">
                          Hole {selectedHole.holeNumber}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Par {selectedHole.par}
                        </div>
                      </div>
                    </div>
                    <DistanceIndicator
                      pin={{
                        latitude: selectedHole.latitude,
                        longitude: selectedHole.longitude,
                        holeNumber: selectedHole.holeNumber,
                      }}
                      className="text-right"
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Scorecard view */}
              <div className="flex-1 overflow-y-auto p-4">
                <ScoreCard courseId={courseId} />
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
              {/* Scorecard in sidebar */}
              <div>
                <h2 className="text-sm font-semibold mb-3">Progress</h2>
                <ScoreCard compact={true} />
              </div>

              {/* Hole list */}
              <div>
                <h2 className="text-sm font-semibold mb-3">Holes</h2>
                <div className="space-y-2">
                  {MOCK_HOLES.map((hole) => (
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
                      {MOCK_HOLES.length}/18
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
