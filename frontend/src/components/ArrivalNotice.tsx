import React from 'react';
import { Volume2, Play, Square, X } from 'lucide-react';

interface ArrivalNoticeProps {
  /** The hole the player has just been announced as reaching. */
  holeNumber: number;
  /** True while this hole's narration is actually making a sound. */
  isPlaying: boolean;
  /**
   * True once it has made a sound at all, even if it has since finished.
   *
   * Without this the strip would flip back to "tap to hear it" the moment the
   * narration ended, telling a player who had just listened to the whole thing
   * that nothing had played.
   */
  hasPlayed: boolean;
  onPlay: () => void;
  onStop: () => void;
  onDismiss: () => void;
  className?: string;
}

/**
 * The strip that appears when GPS decides the player has reached a tee.
 *
 * It is not decoration. Auto-play can be refused - by an autoplay policy that
 * ignored the unlock, by a clip that is not cached with no signal to fetch it -
 * and the refusal is silent by nature. Showing the hole either way turns that
 * silence into a button: if the narration started, this says so; if it never
 * did, the tap is right here and costs the player one press instead of a walk
 * through the side menu.
 */
export const ArrivalNotice: React.FC<ArrivalNoticeProps> = ({
  holeNumber,
  isPlaying,
  hasPlayed,
  onPlay,
  onStop,
  onDismiss,
  className = '',
}) => (
  <div
    role="status"
    className={`flex items-center gap-3 bg-primary/10 border-t border-border px-4 py-2 ${className}`}
  >
    <Volume2 className="w-4 h-4 shrink-0 text-primary" />

    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium truncate">Hole {holeNumber}</p>
      <p className="text-[10px] text-muted-foreground truncate">
        {isPlaying
          ? 'Reading it now'
          : hasPlayed
            ? 'Read - tap to hear it again'
            : 'Not playing - tap to hear it'}
      </p>
    </div>

    <button
      onClick={isPlaying ? onStop : onPlay}
      className="py-1.5 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5 shrink-0"
    >
      {isPlaying ? (
        <>
          <Square className="w-3.5 h-3.5" />
          Stop
        </>
      ) : (
        <>
          <Play className="w-3.5 h-3.5" />
          {hasPlayed ? 'Again' : 'Play'}
        </>
      )}
    </button>

    <button
      onClick={onDismiss}
      aria-label={`Dismiss the hole ${holeNumber} notice`}
      className="p-1 rounded-lg hover:bg-accent shrink-0"
    >
      <X className="w-4 h-4" />
    </button>
  </div>
);
