import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { computeRoundSummary, formatToPar } from '@/lib/roundSummary';
import type {
  HoleLine,
  RoundSummary as Round,
  ScoreResult,
  ScoreTally,
  SegmentTotals,
} from '@/lib/roundSummary';
import type { TeeSet } from '@/data/pelhamHillsBook';

interface RoundSummaryProps {
  scores: Map<number, number>;
  teeSet: TeeSet;
  courseName: string;
  playedAt?: string;
  onClose?: () => void;
  className?: string;
}

/**
 * How a card is marked up by hand: a circle for under par, a box for over,
 * nothing for a par. Shape rather than colour, so it survives a phone screen in
 * sunlight and reads the same to a player who cannot tell green from red.
 */
const RESULT_MARK: Record<ScoreResult, string> = {
  eagle: 'rounded-full ring-2 ring-primary',
  birdie: 'rounded-full ring-1 ring-primary',
  par: '',
  bogey: 'ring-1 ring-foreground/40',
  doubleOrWorse: 'ring-2 ring-foreground/60',
};

const TALLY_ROW: { key: keyof ScoreTally; label: string }[] = [
  { key: 'eagles', label: 'Eagles' },
  { key: 'birdies', label: 'Birdies' },
  { key: 'pars', label: 'Pars' },
  { key: 'bogeys', label: 'Bogeys' },
  { key: 'doublesOrWorse', label: 'Doubles +' },
];

const yards = (value: number) => value.toLocaleString('en-US');

/** A date only earns a line on the card if it actually parses. */
const playedOn = (playedAt?: string): string | null => {
  if (!playedAt) return null;
  const parsed = new Date(playedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

// The tables scroll sideways on a phone with the hole-label column pinned, so
// they are laid out with `border-separate`: a collapsed table paints its borders
// itself and the pinned column would slide out from under its own rules.
// Every rule therefore sits on the cells, and the last row of each table draws
// the divider to the block below it.
const RULE = 'border-b border-border';
const headCell =
  'px-2 py-1.5 text-xs font-semibold text-muted-foreground whitespace-nowrap';
const rowLabel =
  'sticky left-0 z-10 px-2 py-1.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap';
const dataCell = 'px-2 py-1.5 text-sm tabular-nums whitespace-nowrap';

const ScoreCell: React.FC<{ line: HoleLine }> = ({ line }) => {
  if (line.score === null || line.result === null) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center font-semibold ${RESULT_MARK[line.result]}`}
    >
      {line.score}
    </span>
  );
};

/**
 * One printed nine: the holes across the top, the club's own par and handicap
 * rows beneath them, and the player's score last - with the OUT or IN column
 * closing the table exactly where the card puts it.
 */
const NineTable: React.FC<{
  caption: string;
  lines: HoleLine[];
  totals: SegmentTotals;
  totalLabel: string;
}> = ({ caption, lines, totals, totalLabel }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-center">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className={`${rowLabel} ${RULE} bg-muted`}>
            Hole
          </th>
          {lines.map((line) => (
            <th key={line.holeNumber} scope="col" className={`${headCell} ${RULE} bg-muted`}>
              {line.holeNumber}
            </th>
          ))}
          <th scope="col" className={`${headCell} ${RULE} bg-muted text-foreground`}>
            {totalLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row" className={`${rowLabel} ${RULE} bg-background`}>
            Yards
          </th>
          {lines.map((line) => (
            <td
              key={line.holeNumber}
              className={`${dataCell} ${RULE} text-muted-foreground`}
            >
              {line.yards}
            </td>
          ))}
          <td className={`${dataCell} ${RULE} font-semibold`}>{totals.yards}</td>
        </tr>

        <tr>
          <th scope="row" className={`${rowLabel} ${RULE} bg-background`}>
            Par
          </th>
          {lines.map((line) => (
            <td key={line.holeNumber} className={`${dataCell} ${RULE}`}>
              {line.par}
            </td>
          ))}
          <td className={`${dataCell} ${RULE} font-semibold`}>{totals.par}</td>
        </tr>

        <tr>
          <th scope="row" className={`${rowLabel} ${RULE} bg-background`}>
            HCP
          </th>
          {lines.map((line) => (
            <td
              key={line.holeNumber}
              className={`${dataCell} ${RULE} text-muted-foreground`}
            >
              {line.handicap}
            </td>
          ))}
          <td className={`${dataCell} ${RULE}`} />
        </tr>

        <tr>
          <th scope="row" className={`${rowLabel} ${RULE} bg-background text-foreground`}>
            Score
          </th>
          {lines.map((line) => (
            <td key={line.holeNumber} className={`${dataCell} ${RULE}`}>
              <ScoreCell line={line} />
            </td>
          ))}
          <td className={`${dataCell} ${RULE} font-bold`}>{totals.score ?? '-'}</td>
        </tr>
      </tbody>
    </table>
  </div>
);

/** The three totals columns the card closes with, score against par. */
const TotalsTable: React.FC<{ summary: Round }> = ({ summary }) => {
  const columns: { label: string; totals: SegmentTotals }[] = [
    { label: 'OUT', totals: summary.front },
    { label: 'IN', totals: summary.back },
    { label: 'TOTAL', totals: summary.total },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[20rem] border-separate border-spacing-0 text-center">
        <caption className="sr-only">Out, in and total</caption>
        <thead>
          <tr>
            <th scope="col" className={`${rowLabel} ${RULE} bg-muted`} />
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={`${headCell} ${RULE} bg-muted text-foreground`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className={`${rowLabel} ${RULE} bg-background`}>
              Yards
            </th>
            {columns.map((column) => (
              <td key={column.label} className={`${dataCell} ${RULE} text-muted-foreground`}>
                {yards(column.totals.yards)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className={`${rowLabel} ${RULE} bg-background`}>
              Par
            </th>
            {columns.map((column) => (
              <td key={column.label} className={`${dataCell} ${RULE}`}>
                {column.totals.par}
              </td>
            ))}
          </tr>
          <tr>
            <th
              scope="row"
              className={`${rowLabel} ${RULE} bg-background text-foreground`}
            >
              Score
            </th>
            {columns.map((column) => (
              <td key={column.label} className={`${dataCell} ${RULE} font-bold`}>
                {column.totals.score ?? '-'}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className={`${rowLabel} ${RULE} bg-background`}>
              To par
            </th>
            {columns.map((column) => (
              <td key={column.label} className={`${dataCell} ${RULE} font-semibold`}>
                {formatToPar(column.totals.toPar)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

/**
 * The finished round, laid out the way the club prints its card.
 *
 * Presentation only: every figure comes from the pure summary module, which
 * reads par, handicap and yardage out of the printed book. Nothing here is
 * derived from a coordinate, so the round total is one number in this app that
 * is safe to state plainly.
 */
export const RoundSummary: React.FC<RoundSummaryProps> = ({
  scores,
  teeSet,
  courseName,
  playedAt,
  onClose,
  className = '',
}) => {
  const summary = useMemo(() => computeRoundSummary(scores, teeSet), [scores, teeSet]);
  const date = playedOn(playedAt);
  const { total } = summary;

  return (
    <section
      className={`rounded-lg border border-border bg-background ${className}`}
      aria-label="Round summary"
    >
      <header className="flex items-start gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {courseName}
          </h2>

          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-5xl font-bold tabular-nums">{total.score ?? '--'}</span>
            <span
              className={`text-2xl font-semibold tabular-nums ${
                total.toPar !== null && total.toPar < 0 ? 'text-primary' : 'text-foreground'
              }`}
            >
              {formatToPar(total.toPar)}
            </span>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            {summary.teeLabel} tees · {yards(summary.teeTotalYards)} yds · par {total.par}
          </p>

          {date && <p className="mt-0.5 text-xs text-muted-foreground">{date}</p>}

          {!summary.complete && (
            <p className="mt-2 text-xs text-muted-foreground">
              {summary.holesPlayed} of {total.holeCount} holes scored - totals cover the
              holes played.
            </p>
          )}
        </div>

        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close round summary"
            className="shrink-0 rounded-lg bg-muted p-1.5 hover:opacity-90"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </header>

      <NineTable
        caption="Front nine, holes 1 to 9"
        lines={summary.frontLines}
        totals={summary.front}
        totalLabel="OUT"
      />
      <NineTable
        caption="Back nine, holes 10 to 18"
        lines={summary.backLines}
        totals={summary.back}
        totalLabel="IN"
      />
      <TotalsTable summary={summary} />

      <div className="flex flex-wrap gap-2 p-4">
        {TALLY_ROW.map(({ key, label }) => (
          <div
            key={key}
            className="flex min-w-[4.5rem] flex-1 flex-col items-center rounded-lg bg-muted px-2 py-2"
          >
            <span className="text-xl font-bold tabular-nums">{summary.tally[key]}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
};
