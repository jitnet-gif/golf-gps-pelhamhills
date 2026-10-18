import React from 'react';
import {
  PELHAM_HILLS_BOOK,
  PELHAM_HILLS_PAR,
  PELHAM_HILLS_TEES,
  PELHAM_HILLS_TOTALS,
  type BookHole,
  type TeeSet,
} from '@/data/pelhamHillsBook';
import type { Scorecard } from '@/db';
import { playerTotals, type PlayerTotals } from '@/lib/scorecard';
import { scoreResult, type ScoreResult } from '@/lib/roundSummary';
import { TeeSwatch } from './TeeSelector';

export interface CellTarget {
  player: number;
  hole: number;
}

/** Short enough for a 3.4rem column at 390 px, long enough to read. */
const SHORT_LABEL: Record<TeeSet, string> = {
  blue: 'Blue',
  white: 'White',
  whiteYellow: 'W/Y',
  yellow: 'Yellow',
  yellowRed: 'Y/R',
  red: 'Red',
};

/** Marked up the way a card is by hand: circles under par, boxes over. */
const MARK: Record<ScoreResult, string> = {
  eagle: 'rounded-full ring-2 ring-primary',
  birdie: 'rounded-full ring-1 ring-primary',
  par: '',
  bogey: 'ring-1 ring-foreground/50',
  doubleOrWorse: 'ring-2 ring-foreground/70',
};

type Segment = 'out' | 'in' | 'total';

const HALVES: Record<
  'front' | 'back',
  { caption: string; holes: BookHole[]; totals: { label: string; segment: Segment; width: string }[] }
> = {
  front: {
    caption: 'Front nine',
    holes: PELHAM_HILLS_BOOK.filter((h) => h.holeNumber <= 9),
    totals: [{ label: 'OUT', segment: 'out', width: '2.3rem' }],
  },
  back: {
    caption: 'Back nine',
    holes: PELHAM_HILLS_BOOK.filter((h) => h.holeNumber > 9),
    totals: [
      { label: 'IN', segment: 'in', width: '2.1rem' },
      { label: 'TOT', segment: 'total', width: '2.3rem' },
    ],
  },
};

const LABEL_WIDTH = '3.4rem';
const GRID = 'border border-border';
const LABEL = `${GRID} px-1 text-left whitespace-nowrap overflow-hidden`;
const SMALL = `${GRID} h-5 px-0 text-[10px] leading-none`;

const playerTotal = (t: PlayerTotals, segment: Segment) =>
  segment === 'out' ? t.out : segment === 'in' ? t.in : t.total;

export const playerLabel = (name: string, index: number) =>
  name.trim() || `Player ${index + 1}`;

interface ScorecardTablesProps {
  card: Scorecard;
  /** History and the admin list draw the card without letting it be written on. */
  readOnly?: boolean;
  selected?: CellTarget | null;
  onCellClick?: (target: CellTarget) => void;
  onTeeClick?: (tee: TeeSet) => void;
  className?: string;
}

const NineTable: React.FC<ScorecardTablesProps & { half: 'front' | 'back' }> = ({
  half,
  card,
  readOnly,
  selected,
  onCellClick,
  onTeeClick,
}) => {
  const { caption, holes, totals } = HALVES[half];
  const writable = !readOnly && !!onCellClick;
  const teeClickable = !readOnly && !!onTeeClick;

  return (
    <table className="w-full table-fixed border-collapse text-center tabular-nums">
      <caption className="pb-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {caption}
      </caption>
      <colgroup>
        <col style={{ width: LABEL_WIDTH }} />
        {holes.map((h) => (
          <col key={h.holeNumber} />
        ))}
        {totals.map((t) => (
          <col key={t.label} style={{ width: t.width }} />
        ))}
      </colgroup>

      <thead>
        <tr className="bg-primary text-primary-foreground">
          <th scope="col" className={`${LABEL} h-6 text-[10px] font-semibold`}>
            Hole
          </th>
          {holes.map((h) => (
            <th key={h.holeNumber} scope="col" className={`${GRID} h-6 px-0 text-xs font-bold`}>
              {h.holeNumber}
            </th>
          ))}
          {totals.map((t) => (
            <th key={t.label} scope="col" className={`${GRID} h-6 px-0 text-[10px] font-bold`}>
              {t.label}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {/* The six tee rows, as printed. The one being played is picked out,
            and tapping another changes the tees for the whole card. */}
        {PELHAM_HILLS_TEES.map((tee) => {
          const played = tee.id === card.teeSet;
          const label = (
            <span className="flex items-center gap-1">
              <TeeSwatch teeSet={tee.id} marker={tee.marker} size="sm" />
              <span className="truncate">{SHORT_LABEL[tee.id]}</span>
            </span>
          );
          return (
            <tr
              key={tee.id}
              className={played ? 'bg-primary/10 font-semibold text-foreground' : 'text-muted-foreground'}
            >
              <th scope="row" className={`${LABEL} h-5 text-[10px] font-medium`}>
                {teeClickable ? (
                  <button
                    type="button"
                    onClick={() => onTeeClick?.(tee.id)}
                    aria-pressed={played}
                    aria-label={`Play from the ${tee.label} tees`}
                    // The size is repeated on the button itself: index.css sets
                    // every phone button to 16px, which beats the cell's size.
                    className="w-full text-[10px]"
                  >
                    {label}
                  </button>
                ) : (
                  label
                )}
              </th>
              {holes.map((h) => (
                <td key={h.holeNumber} className={SMALL}>
                  {h.yards[tee.id]}
                </td>
              ))}
              {totals.map((t) => (
                <td key={t.label} className={SMALL}>
                  {PELHAM_HILLS_TOTALS[tee.id][t.segment]}
                </td>
              ))}
            </tr>
          );
        })}

        {/* The players' rows - where the card has its blank lines. */}
        {card.players.map((player, pi) => {
          const name = playerLabel(player.name, pi);
          const sums = playerTotals(player.scores);
          return (
            <tr key={pi} className="bg-background">
              <th scope="row" className={`${LABEL} h-8 text-xs font-semibold text-foreground`}>
                <span className="block truncate">{name}</span>
              </th>
              {holes.map((h) => {
                const score = player.scores[h.holeNumber - 1] ?? null;
                const isSelected = selected?.player === pi && selected.hole === h.holeNumber;
                const mark =
                  score === null ? null : (
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center ${MARK[scoreResult(score, h.par)]}`}
                    >
                      {score}
                    </span>
                  );
                return (
                  <td
                    key={h.holeNumber}
                    className={`${GRID} h-8 p-0 ${isSelected ? 'bg-accent/20 ring-2 ring-inset ring-accent' : ''}`}
                  >
                    {writable ? (
                      <button
                        type="button"
                        onClick={() => onCellClick?.({ player: pi, hole: h.holeNumber })}
                        aria-label={`Hole ${h.holeNumber}, ${name}: ${score ?? 'no score'}`}
                        className="flex h-8 w-full items-center justify-center text-sm font-semibold hover:bg-accent/10"
                      >
                        {mark}
                      </button>
                    ) : (
                      <span className="flex h-8 items-center justify-center text-sm font-semibold">
                        {mark}
                      </span>
                    )}
                  </td>
                );
              })}
              {totals.map((t) => (
                <td key={t.label} className={`${GRID} h-8 px-0 text-xs font-bold`}>
                  {playerTotal(sums, t.segment) ?? ''}
                </td>
              ))}
            </tr>
          );
        })}

        <tr className="bg-muted font-semibold">
          <th scope="row" className={`${LABEL} h-5 text-[10px]`}>
            Par
          </th>
          {holes.map((h) => (
            <td key={h.holeNumber} className={`${SMALL} text-[11px]`}>
              {h.par}
            </td>
          ))}
          {totals.map((t) => (
            <td key={t.label} className={`${SMALL} text-[11px]`}>
              {PELHAM_HILLS_PAR[t.segment]}
            </td>
          ))}
        </tr>

        <tr className="text-muted-foreground">
          <th scope="row" className={`${LABEL} h-5 text-[10px] font-medium`}>
            Handicap
          </th>
          {holes.map((h) => (
            <td key={h.holeNumber} className={SMALL}>
              {h.handicap}
            </td>
          ))}
          {totals.map((t) => (
            <td key={t.label} className={SMALL} />
          ))}
        </tr>
      </tbody>
    </table>
  );
};

/**
 * The club's printed card, front and back nine, with the players written in:
 * six tee rows, up to four player rows, par and handicap - in the card's order.
 * Sized to fit a 390 px phone without scrolling sideways.
 */
export const ScorecardTables: React.FC<ScorecardTablesProps> = ({ className = '', ...props }) => (
  <div className={`space-y-3 ${className}`}>
    <NineTable half="front" {...props} />
    <NineTable half="back" {...props} />
  </div>
);
