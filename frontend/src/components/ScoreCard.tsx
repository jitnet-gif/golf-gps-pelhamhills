import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FilePlus, History, Trash2, UserPlus, X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useScorecard } from '@/hooks/useScorecard';
import { PELHAM_HILLS_BOOK, PELHAM_HILLS_TEES, type TeeSet } from '@/data/pelhamHillsBook';
import type { Scorecard } from '@/db';
import {
  formatPlayedOn,
  hasAnyScore,
  HOLE_COUNT,
  localDate,
  MAX_PLAYERS,
  MAX_STROKES,
  playerTotals,
} from '@/lib/scorecard';
import { formatToPar } from '@/lib/roundSummary';
import { syncNow } from '@/lib/scorecardSync';
import { StorageNotice } from './StorageNotice';
import { ScorecardTables, playerLabel, type CellTarget } from './ScorecardTables';
import { AccountBar } from './AccountPanel';

const teeLabel = (tee: TeeSet) => PELHAM_HILLS_TEES.find((t) => t.id === tee)?.label ?? tee;

/** "Kim 84 (+13)" - one player's line in the history list. */
const playerLine = (card: Scorecard) =>
  card.players
    .map((p, i) => {
      const t = playerTotals(p.scores);
      return `${playerLabel(p.name, i)} ${t.total ?? '-'}${t.toPar === null ? '' : ` (${formatToPar(t.toPar)})`}`;
    })
    .join(' · ');

// ---------------------------------------------------------------------------
// Entry pad
// ---------------------------------------------------------------------------

const STROKES = Array.from({ length: MAX_STROKES }, (_, i) => i + 1);

const ScorePad: React.FC<{
  card: Scorecard;
  target: CellTarget;
  onPick: (score: number | null) => void;
  onTarget: (target: CellTarget | null) => void;
}> = ({ card, target, onPick, onTarget }) => {
  const hole = PELHAM_HILLS_BOOK.find((h) => h.holeNumber === target.hole) ?? PELHAM_HILLS_BOOK[0];
  const current = card.players[target.player]?.scores[target.hole - 1] ?? null;

  return (
    <div
      role="dialog"
      aria-label={`Score for hole ${hole.holeNumber}`}
      className="fixed inset-x-0 bottom-0 z-[1150] border-t border-border bg-card px-3 pt-2 shadow-[0_-4px_16px_rgba(0,0,0,0.15)] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onTarget({ ...target, hole: Math.max(1, target.hole - 1) })}
            disabled={target.hole === 1}
            aria-label="Previous hole"
            className="rounded-lg p-2 hover:bg-accent disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 text-center">
            <div className="text-base font-bold">Hole {hole.holeNumber}</div>
            <div className="text-xs text-muted-foreground">
              Par {hole.par} · Handicap {hole.handicap}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onTarget({ ...target, hole: Math.min(HOLE_COUNT, target.hole + 1) })}
            disabled={target.hole === HOLE_COUNT}
            aria-label="Next hole"
            className="rounded-lg p-2 hover:bg-accent disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => onTarget(null)}
            aria-label="Close score pad"
            className="ml-1 rounded-lg bg-muted p-2 hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Whose box - the player chips double as a view of this hole's scores. */}
        <div className="mt-2 flex gap-1 overflow-x-auto">
          {card.players.map((p, i) => {
            const s = p.scores[target.hole - 1];
            const active = i === target.player;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onTarget({ ...target, player: i })}
                aria-pressed={active}
                className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-xs font-medium ${
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                }`}
              >
                {playerLabel(p.name, i)} {s ?? '-'}
              </button>
            );
          })}
        </div>

        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {STROKES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onPick(n)}
              aria-pressed={current === n}
              className={`h-11 rounded-lg text-lg font-semibold tabular-nums ${
                current === n
                  ? 'bg-primary text-primary-foreground'
                  : n === hole.par
                    ? 'bg-primary/10 text-foreground ring-1 ring-primary'
                    : 'bg-muted text-foreground hover:bg-accent'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onPick(null)}
          disabled={current === null}
          className="mt-1.5 h-9 w-full rounded-lg bg-muted text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          Clear this box
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

const PlayersEditor: React.FC<{ card: Scorecard }> = ({ card }) => {
  const { renamePlayer, addPlayer, removePlayer } = useScorecard();

  return (
    <section aria-label="Players" className="space-y-2 rounded-lg border border-border bg-card p-3">
      <h3 className="text-xs font-semibold">
        Players ({card.players.length}/{MAX_PLAYERS})
      </h3>
      {card.players.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={p.name}
            onChange={(e) => void renamePlayer(i, e.target.value)}
            placeholder={`Player ${i + 1}`}
            aria-label={`Player ${i + 1} name`}
            maxLength={24}
            className="input-field min-w-0 flex-1 py-1.5"
          />
          {i > 0 && (
            <button
              type="button"
              onClick={() => {
                const scored = p.scores.some((s) => s !== null);
                if (!scored || window.confirm(`Remove ${playerLabel(p.name, i)} and their scores?`)) {
                  void removePlayer(i);
                }
              }}
              aria-label={`Remove ${playerLabel(p.name, i)}`}
              className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      {card.players.length < MAX_PLAYERS && (
        <button
          type="button"
          onClick={() => void addPlayer()}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-muted py-2 text-sm font-medium hover:bg-accent"
        >
          <UserPlus className="h-4 w-4" />
          Add a player
        </button>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const ScorecardHistory: React.FC<{
  currentId: string | null;
  onBack: () => void;
  onEdit: (card: Scorecard) => void;
}> = ({ currentId, onBack, onEdit }) => {
  const { listHistory } = useScorecard();
  const account = useAppStore((s) => s.account);
  const [cards, setCards] = useState<Scorecard[] | null>(null);
  const [open, setOpen] = useState<Scorecard | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listHistory().then((list) => {
        if (alive) setCards(list);
      });
    void load();
    // Signed in, the server may hold rounds played on another phone.
    if (account) void syncNow().then(load);
    return () => {
      alive = false;
    };
  }, [account, listHistory]);

  if (open) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setOpen(null)}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary"
        >
          <ChevronLeft className="h-4 w-4" />
          All rounds
        </button>
        <div>
          <h2 className="text-sm font-semibold">{formatPlayedOn(open.playedOn)}</h2>
          <p className="text-xs text-muted-foreground">{teeLabel(open.teeSet)} tees</p>
        </div>
        <ScorecardTables card={open} readOnly />
        <button
          type="button"
          onClick={() => onEdit(open)}
          className="w-full rounded-lg bg-muted py-2 text-sm font-medium hover:bg-accent"
        >
          Edit this card
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to the card
      </button>
      <h2 className="text-sm font-semibold">My rounds</h2>
      {!account && (
        <p className="text-xs text-muted-foreground">
          Showing rounds kept on this phone. Sign in to see rounds saved from other phones too.
        </p>
      )}
      {cards === null ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rounds yet. Every card you write on is kept here by the day you played.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Rounds by date">
          {cards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => (card.id === currentId ? onBack() : setOpen(card))}
                className="w-full rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/10"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{formatPlayedOn(card.playedOn)}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {card.id === currentId ? 'On screen · ' : ''}
                    {teeLabel(card.teeSet)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{playerLine(card)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

interface ScoreCardProps {
  /** Just the account holder's total, for the side menu. */
  compact?: boolean;
  /** Compact only: go to the full card. */
  onOpen?: () => void;
  /** Tapping a tee row plays the card from those tees. */
  onTeeChange?: (tee: TeeSet) => void;
}

export const ScoreCard: React.FC<ScoreCardProps> = ({ compact = false, onOpen, onTeeChange }) => {
  const { scorecard: card, setHoleScore, startNewCard, openCard } = useScorecard();
  const [target, setTarget] = useState<CellTarget | null>(null);
  const [mode, setMode] = useState<'card' | 'history'>('card');

  // A box that no longer exists - its player removed, another card opened.
  useEffect(() => {
    if (target && (!card || target.player >= card.players.length)) setTarget(null);
  }, [card, target]);

  if (!card) {
    return <div className="p-4 text-center text-sm text-muted-foreground">Opening your card...</div>;
  }

  const mine = playerTotals(card.players[0]?.scores ?? []);

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div>
          <div className="text-xs text-muted-foreground">Score</div>
          <div className="text-2xl font-bold tabular-nums">{mine.total ?? '--'}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Holes</div>
          <div className="text-2xl font-bold tabular-nums">
            {mine.holesPlayed}/{HOLE_COUNT}
          </div>
        </div>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Open card
          </button>
        )}
      </div>
    );
  }

  if (mode === 'history') {
    return (
      <ScorecardHistory
        currentId={card.id}
        onBack={() => setMode('card')}
        onEdit={(picked) => {
          openCard(picked);
          setMode('card');
        }}
      />
    );
  }

  const pick = (score: number | null) => {
    if (!target) return;
    void setHoleScore(target.player, target.hole, score);
    if (score === null) return;
    // On to the next box a group fills in: the next player on this hole, then
    // the first player on the next.
    if (target.player + 1 < card.players.length) {
      setTarget({ player: target.player + 1, hole: target.hole });
    } else if (target.hole < HOLE_COUNT) {
      setTarget({ player: 0, hole: target.hole + 1 });
    } else {
      setTarget(null);
    }
  };

  const isToday = card.playedOn === localDate();

  return (
    <div className="space-y-3" aria-label="Scorecard">
      <AccountBar />
      <StorageNotice />

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{isToday ? "Today's card" : 'Card'}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {formatPlayedOn(card.playedOn)} · {teeLabel(card.teeSet)} tees
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setTarget(null);
            setMode('history');
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <History className="h-3.5 w-3.5" />
          My rounds
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              !hasAnyScore(card) ||
              window.confirm('Start a new card? This one stays in My rounds.')
            ) {
              setTarget(null);
              startNewCard();
            }
          }}
          aria-label="Start a new card"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <FilePlus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      <ScorecardTables
        card={card}
        selected={target}
        onCellClick={setTarget}
        onTeeClick={onTeeChange}
      />

      <p className="text-[11px] text-muted-foreground">
        Tap a box to write a score. Tap a tee to change the tees you are playing.
      </p>

      <PlayersEditor card={card} />

      {/* Room to scroll the last rows out from under the pad. */}
      {target && <div aria-hidden="true" className="h-72" />}
      {target && <ScorePad card={card} target={target} onPick={pick} onTarget={setTarget} />}
    </div>
  );
};
