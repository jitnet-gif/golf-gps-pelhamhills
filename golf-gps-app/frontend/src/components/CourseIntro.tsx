import React from 'react';
import { Volume2, Pause, Play, Square } from 'lucide-react';
import { useTTS } from '@/hooks';
import {
  PELHAM_HILLS_INFO,
  PELHAM_HILLS_INFO_LANG,
  PELHAM_HILLS_INFO_SCRIPT,
  PELHAM_HILLS_INFO_SOURCE,
} from '@/data/courseInfo';

const ALL_ID = 'all';

/**
 * Reads the club's course introduction aloud. Playback always starts from a tap -
 * iOS Safari refuses speech outside a user gesture.
 */
export function CourseIntro() {
  const { isSupported, isSpeaking, isPaused, speakingId, error, speak, stop, pause, resume } =
    useTTS(PELHAM_HILLS_INFO_LANG);

  if (!isSupported) {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Volume2 className="w-4 h-4" />
          Course Info
        </h2>
        <p className="text-xs text-muted-foreground">
          This browser cannot read the course introduction aloud.
        </p>
      </div>
    );
  }

  const playAll = () => speak(PELHAM_HILLS_INFO_SCRIPT, { id: ALL_ID });

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Volume2 className="w-4 h-4" />
        Course Info
      </h2>

      <div className="flex gap-2 mb-3">
        <button
          onClick={speakingId === ALL_ID ? stop : playAll}
          className="flex-1 py-2 px-3 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 flex items-center justify-center gap-2"
        >
          {speakingId === ALL_ID ? (
            <>
              <Square className="w-4 h-4" />
              Stop
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Play intro
            </>
          )}
        </button>

        {isSpeaking && (
          <button
            onClick={isPaused ? resume : pause}
            aria-label={isPaused ? 'Resume narration' : 'Pause narration'}
            className="py-2 px-3 rounded-lg bg-muted hover:bg-accent"
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {PELHAM_HILLS_INFO.map((section) => {
          const active = speakingId === section.id;
          return (
            <div
              key={section.id}
              className={`p-2 rounded-lg ${active ? 'bg-primary/10' : 'bg-accent/50'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium">{section.title}</span>
                <button
                  onClick={() => (active ? stop() : speak(section.body, { id: section.id }))}
                  aria-label={active ? `Stop ${section.title}` : `Play ${section.title}`}
                  className={`p-1 rounded ${active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {active ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{section.body}</p>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-xs text-destructive mt-2">Narration failed: {error}</p>
      )}

      <p className="text-[10px] text-muted-foreground mt-2">
        Text courtesy of{' '}
        <a href={PELHAM_HILLS_INFO_SOURCE} target="_blank" rel="noreferrer" className="underline">
          pelhamhills.com
        </a>
      </p>
    </div>
  );
}
