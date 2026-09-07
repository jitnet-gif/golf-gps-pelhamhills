import React from 'react';

export interface LeaderboardEntry {
  id: string;
  playerName: string;
  score: number;
  holes: number;
  courseId: string;
  timestamp: string;
}

interface LeaderboardProps {
  entries?: LeaderboardEntry[];
  courseId?: string;
  isLoading?: boolean;
}

/**
 * Leaderboard component (Phase 2 stub)
 * Shows top scores and player rankings for a golf course.
 *
 * TODO (Phase 2):
 * - Implement real-time score sync from backend
 * - Add player profiles and statistics
 * - Add filtering by date range and player
 * - Add social features (comments, reactions)
 */
export const Leaderboard: React.FC<LeaderboardProps> = ({
  entries = [],
  courseId,
  isLoading = false,
}) => {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Leaderboard</h2>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          Loading leaderboard...
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No scores yet</p>
          <p className="text-xs mt-1">Leaderboard feature coming in Phase 2</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries
            .sort((a, b) => a.score - b.score)
            .map((entry, index) => (
              <div
                key={entry.id}
                className="flex items-center justify-between p-3 rounded-lg bg-card border border-border"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary">
                      {index + 1}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      {entry.playerName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.holes} holes
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-primary">
                    {entry.score}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
