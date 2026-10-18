import React, { useEffect, useState } from 'react';
import { FlaskConical, Navigation, Play, Square } from 'lucide-react';
import { ARRIVAL_DEFAULTS, type ArrivalHole } from '@/lib/holeArrival';
import type { SimulationRun } from '@/hooks/useArrivalSimulation';

interface ArrivalSimulatorProps {
  /** The holes the arrival detector watches - the page's arrivalHoles. */
  holes: ArrivalHole[];
  /** The hole on screen. The simulator offers the one after it. */
  currentHole: number;
  autoNarration: boolean;
  /** Holes the detector has announced this round, oldest first. */
  announced: number[];
  /** The page's run, from useArrivalSimulation. */
  run: SimulationRun | null;
  finished: number | null;
  /**
   * Called inside the tap, so the page can pay for both voices there.
   * `walk` starts from the previous hole's green with directions on.
   */
  onStart: (holeNumber: number, walk: boolean, realPace: boolean) => void;
  onStop: () => void;
  className?: string;
}

/**
 * Operators only: the controls for useArrivalSimulation. The run itself belongs
 * to the page, so it carries on when this menu closes - the map shows its own
 * Stop for that.
 */
export const ArrivalSimulator: React.FC<ArrivalSimulatorProps> = ({
  holes,
  currentHole,
  autoNarration,
  announced,
  run,
  finished,
  onStart,
  onStop,
  className = '',
}) => {
  const numbers = holes.map((h) => h.holeNumber);
  const suggested = numbers.find((n) => n > currentHole) ?? numbers[0];

  const [chosen, setChosen] = useState<number | null>(null);
  const [realPace, setRealPace] = useState(false);

  // Arriving selects the hole, which moves the suggestion on to the next one -
  // pressing again walks the course. A run that ends also clears a hand-picked
  // hole, even one whose arrival left the hole on screen unchanged.
  useEffect(() => {
    setChosen(null);
  }, [currentHole, finished]);

  const target = chosen ?? suggested;
  const previous = numbers.filter((n) => n < target).pop() ?? null;
  const running = run !== null;

  const dwellSeconds = ARRIVAL_DEFAULTS.dwellMs / 1000;

  return (
    <div role="group" aria-label="Simulate arrival" className={className}>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <FlaskConical className="w-4 h-4" />
        Simulate arrival
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">operator</span>
      </h2>

      {/* Wraps: in a narrow menu the hole picker and the button do not fit side
          by side. */}
      <div className="flex flex-wrap gap-2">
        <select
          value={target}
          onChange={(e) => setChosen(Number(e.target.value))}
          disabled={running}
          aria-label="Hole to arrive at"
          className="shrink-0 px-2 py-2 rounded-lg border border-border bg-background text-sm"
        >
          {numbers.map((n) => (
            <option key={n} value={n}>
              Hole {n}
            </option>
          ))}
        </select>

        {running ? (
          <button
            onClick={onStop}
            aria-label="Stop the simulation"
            className="flex-1 basis-40 min-w-0 py-2 px-3 rounded-lg text-sm font-medium bg-muted hover:bg-accent flex items-center justify-center gap-2"
          >
            <Square className="w-4 h-4" />
            Stop
          </button>
        ) : (
          <button
            onClick={() => onStart(target, false, realPace)}
            className="flex-1 basis-40 min-w-0 py-2 px-3 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 flex items-center justify-center gap-2 text-center"
          >
            <Play className="w-4 h-4" />
            Arrive at hole {target}
          </button>
        )}
      </div>

      {/* The walk there, with the next-tee directions on - whatever the
          player's own guidance switch says. The first hole has no green
          before it to walk from. */}
      <button
        onClick={() => onStart(target, true, realPace)}
        disabled={running || previous === null}
        className="mt-2 w-full py-2 px-3 rounded-lg text-sm font-medium border border-primary text-primary hover:bg-primary/10 disabled:opacity-40 disabled:hover:bg-transparent flex items-center justify-center gap-2 text-center"
      >
        <Navigation className="w-4 h-4 shrink-0" />
        {previous === null
          ? `Walk to hole ${target} - no green before it`
          : `Walk to hole ${target} with directions`}
      </button>
      {previous !== null && (
        <p className="mt-1 text-[10px] text-muted-foreground text-center">
          From the hole {previous} green to the hole {target} tee, then {dwellSeconds} s on the tee.
        </p>
      )}

      <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={realPace}
          onChange={(e) => setRealPace(e.target.checked)}
          disabled={running}
        />
        Real pace (walking speed, {dwellSeconds} s on the tee)
      </label>

      <p className="mt-2 text-xs" role="status">
        {run !== null
          ? run.phase === 'walking'
            ? `Walking to hole ${run.holeNumber}'s tee... ${Math.round(run.yardsLeft)} yds to go`
            : `Standing on hole ${run.holeNumber}'s tee... ${run.waitedMs / 1000} / ${dwellSeconds} s`
          : finished !== null
            ? announced.includes(finished)
              ? `Arrived at hole ${finished}.`
              : `The detector did not announce hole ${finished}.`
            : ''}
      </p>

      {!autoNarration && (
        <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-500">
          Narration is Manual, so an arrival selects the hole without speaking. Choose
          Auto above to hear it.
        </p>
      )}

      <p className="mt-1 text-[10px] text-muted-foreground">
        Real GPS is paused while it runs. It keeps running with this menu closed, so
        you can watch the map - Stop is under the map too. It also moves the round on
        to this hole, the way arriving there for real would.
      </p>
    </div>
  );
};
