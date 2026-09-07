import React, { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useScorecard } from '@/hooks';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface ScoreCardProps {
  courseId?: string;
  compact?: boolean;
}

export const ScoreCard: React.FC<ScoreCardProps> = ({
  courseId,
  compact = false,
}) => {
  const { currentRound, scores, setSelectedHole, setShowScoreSheet } =
    useAppStore();
  const { saveScore } = useScorecard();
  const [expandedHole, setExpandedHole] = useState<number | null>(null);
  const [holeScores, setHoleScores] = useState<Record<number, string>>({});

  if (!currentRound) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No active round
      </div>
    );
  }

  const holes = currentRound.holes || [];
  const handleScoreChange = (hole: number, value: string) => {
    setHoleScores((prev) => ({
      ...prev,
      [hole]: value,
    }));
  };

  const handleSaveScore = async (hole: number) => {
    const value = holeScores[hole];
    if (value && /^\d+$/.test(value)) {
      const score = parseInt(value, 10);
      if (score > 0 && score < 15) {
        await saveScore(hole, score);
        setHoleScores((prev) => {
          const next = { ...prev };
          delete next[hole];
          return next;
        });
        setExpandedHole(null);
      }
    }
  };

  const totalScore = Array.from(scores.values()).reduce((a, b) => a + b, 0);
  const completedHoles = scores.size;

  if (compact) {
    return (
      <div className="flex items-center justify-between p-3 bg-card rounded-lg border border-border">
        <div>
          <div className="text-sm text-muted-foreground">Score</div>
          <div className="text-2xl font-bold">{totalScore || '--'}</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Progress</div>
          <div className="text-2xl font-bold">
            {completedHoles}/{holes.length}
          </div>
        </div>
        <button
          onClick={() => setShowScoreSheet(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90"
        >
          Edit
        </button>
      </div>
    );
  }

  // Full scorecard view
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 p-3 bg-card rounded-lg border border-border">
        <div>
          <div className="text-xs text-muted-foreground">Total Score</div>
          <div className="text-2xl font-bold text-primary">
            {totalScore || '--'}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Progress</div>
          <div className="text-2xl font-bold">
            {completedHoles}/{holes.length}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        {holes.map((hole) => {
          const score = scores.get(hole.holeNumber);
          const isExpanded = expandedHole === hole.holeNumber;
          const inputValue = holeScores[hole.holeNumber] ?? '';

          return (
            <div
              key={hole.holeNumber}
              className="border border-border rounded-lg overflow-hidden bg-card"
            >
              <button
                onClick={() => {
                  setExpandedHole(isExpanded ? null : hole.holeNumber);
                  setSelectedHole(hole.holeNumber);
                }}
                className="w-full flex items-center justify-between p-3 hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-sm font-semibold text-primary">
                      {hole.holeNumber}
                    </span>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-medium">Hole {hole.holeNumber}</div>
                    {score && (
                      <div className="text-xs text-muted-foreground">
                        Score: {score}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {score && (
                    <div className="text-lg font-bold text-green-600">
                      {score}
                    </div>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5" />
                  ) : (
                    <ChevronDown className="w-5 h-5" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border p-3 space-y-3 bg-accent/30">
                  <div>
                    <label className="text-sm font-medium block mb-2">
                      Enter Score
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="14"
                      value={inputValue}
                      onChange={(e) =>
                        handleScoreChange(hole.holeNumber, e.target.value)
                      }
                      placeholder="0"
                      className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveScore(hole.holeNumber);
                        }
                      }}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveScore(hole.holeNumber)}
                      disabled={!inputValue}
                      className="flex-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setExpandedHole(null)}
                      className="flex-1 px-3 py-2 bg-muted text-muted-foreground rounded-lg text-sm font-medium hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
