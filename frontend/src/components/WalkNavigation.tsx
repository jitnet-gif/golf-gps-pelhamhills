import React from 'react';
import { ArrowUp, Flag, SatelliteDish, Volume2, X } from 'lucide-react';
import { useTTS } from '@/hooks/useTTS';
import type { GuidanceReading, Turn } from '@/lib/teeGuidance';

/**
 * How the walk to a tee is shown - the player's pick, kept on the phone:
 * - card: a big card under the map, the hole column still beside it
 * - map:  the map across the whole screen with a banner on top
 */
export type NavStyle = 'card' | 'map';

const STYLE_KEY = 'golf.nav.style';

export const loadNavStyle = (): NavStyle => {
  try {
    return localStorage.getItem(STYLE_KEY) === 'map' ? 'map' : 'card';
  } catch {
    return 'card';
  }
};

export const saveNavStyle = (style: NavStyle) => {
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {
    /* the pick simply does not survive the visit */
  }
};

const TURN_ANGLE: Record<Turn, number> = {
  'straight on': 0,
  'bear left': -45,
  'bear right': 45,
  'turn left': -90,
  'turn right': 90,
  'turn around': 180,
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The arrow shows the turn once the walk has earned a heading (lib/teeGuidance
 * rule 2). Before that the phone does not know which way the player faces, so it
 * points the way to the tee on the map - which turns to face that tee, so mostly
 * straight up - and says the compass point in words.
 */
const arrowAngle = (r: GuidanceReading, mapBearing: number) => {
  const angle = r.turn ? TURN_ANGLE[r.turn] : (r.bearing ?? 0) - mapBearing;
  return ((angle + 540) % 360) - 180;
};

interface WalkNavigationProps {
  reading: GuidanceReading;
  style: NavStyle;
  onStyle: (style: NavStyle) => void;
  /** Stop being walked there - the player knows the way, or changed their mind. */
  onEnd: () => void;
  /** The compass bearing at the top of the map (0 = north up). */
  mapBearing?: number;
}

const useWords = (reading: GuidanceReading) => {
  const { status, holeNumber, yards, compass, bearing, turn } = reading;
  if (status === 'arrived') return { ok: false as const, text: `Hole ${holeNumber} tee · you are here` };
  if (status !== 'ok' || yards === null || compass === null) {
    return {
      ok: false as const,
      text:
        status === 'no-fix'
          ? `Waiting for a position before pointing at the hole ${holeNumber} tee.`
          : `The last fix was too vague to measure from. Holding the last direction to hole ${holeNumber}.`,
    };
  }
  const y = Math.round(yards);
  return {
    ok: true as const,
    yards: y,
    how: turn ? capitalise(turn) : 'Walk on and a turn will appear',
    where: `${compass} (${Math.round(bearing ?? 0)}°)`,
    spoken: `Hole ${holeNumber} tee, ${y} yards${turn ? `, ${turn}` : ''}.`,
  };
};

const StyleSwitch: React.FC<{ style: NavStyle; onStyle: (s: NavStyle) => void; dark?: boolean }> = ({
  style,
  onStyle,
  dark = false,
}) => (
  <div
    role="radiogroup"
    aria-label="Navigation view"
    className={`inline-flex rounded-lg p-0.5 text-xs font-medium ${dark ? 'bg-white/15' : 'bg-muted'}`}
  >
    {(['card', 'map'] as NavStyle[]).map((s) => {
      const on = s === style;
      return (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={on}
          onClick={() => onStyle(s)}
          className={`rounded-md px-2.5 py-1 ${
            on
              ? dark
                ? 'bg-white text-black'
                : 'bg-background text-foreground shadow-sm'
              : dark
                ? 'text-white/80'
                : 'text-muted-foreground'
          }`}
        >
          {s === 'card' ? 'Card' : 'Map'}
        </button>
      );
    })}
  </div>
);

const EndButton: React.FC<{ onEnd: () => void; dark?: boolean }> = ({ onEnd, dark = false }) => (
  <button
    type="button"
    onClick={onEnd}
    aria-label="End navigation"
    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium ${
      dark ? 'bg-white/15 text-white' : 'bg-muted text-foreground hover:bg-accent'
    }`}
  >
    <X className="h-3.5 w-3.5" />
    End
  </button>
);

/**
 * The walk to a tee as a satnav would show it: which way, how far, and a voice
 * on request. Replaces the one-line strip; the strip's rule stands - the turn is
 * only claimed on fixes that earned a heading.
 */
export const WalkNavigation: React.FC<WalkNavigationProps> = ({
  reading,
  style,
  onStyle,
  onEnd,
  mapBearing = 0,
}) => {
  const { speak, isSupported } = useTTS('en-US');
  const words = useWords(reading);
  const dark = style === 'map';

  const arrow = words.ok ? (
    <span
      className={`grid shrink-0 place-items-center rounded-full ${
        dark ? 'h-12 w-12 bg-white/15' : 'h-16 w-16 bg-primary/15'
      }`}
    >
      <ArrowUp
        aria-hidden
        className={`${dark ? 'h-8 w-8 text-yellow-300' : 'h-10 w-10 text-primary'} transition-transform duration-500`}
        style={{ transform: `rotate(${arrowAngle(reading, mapBearing)}deg)` }}
      />
    </span>
  ) : reading.status === 'arrived' ? (
    <Flag className={`h-6 w-6 shrink-0 ${dark ? 'text-yellow-300' : 'text-primary'}`} />
  ) : (
    <SatelliteDish className="h-6 w-6 shrink-0 animate-pulse text-muted-foreground" />
  );

  const body = words.ok ? (
    <div className="min-w-0 flex-1">
      <p className={`font-bold leading-none tabular-nums ${dark ? 'text-2xl' : 'text-3xl'}`}>
        {words.yards}
        <span className={`ml-1 text-sm font-medium ${dark ? 'text-white/70' : 'text-muted-foreground'}`}>yds</span>
      </p>
      <p className="mt-1 text-sm font-semibold">To hole {reading.holeNumber} tee</p>
      <p className={`text-xs ${dark ? 'text-white/80' : 'text-muted-foreground'}`}>
        {words.how} · {words.where}
      </p>
    </div>
  ) : (
    <p className={`min-w-0 flex-1 text-sm ${dark ? 'text-white/90' : ''}`}>{words.text}</p>
  );

  const voice =
    words.ok && isSupported ? (
      <button
        type="button"
        onClick={() => speak(words.spoken, { lang: 'en-US', id: 'walk-navigation' })}
        aria-label="Say the way to the tee"
        className={`shrink-0 rounded-full p-2 ${dark ? 'bg-white/15 text-white' : 'bg-muted text-foreground hover:bg-accent'}`}
      >
        <Volume2 className="h-5 w-5" />
      </button>
    ) : null;

  if (style === 'map') {
    return (
      <div
        role="status"
        aria-label="Walk to the tee"
        data-testid="nav-banner"
        // Right of the zoom buttons, which stay usable underneath. Solid, not
        // see-through: the satellite photo showing through under the words
        // was the club's complaint ("레이어 겹치는 ... 이미지 사진은 보이지 않도록").
        className="absolute left-14 right-2 top-2 z-[1000] rounded-xl bg-neutral-950 px-3 py-2 text-white shadow-lg"
      >
        <div className="flex items-center gap-3">
          {arrow}
          {body}
          {voice}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <StyleSwitch style={style} onStyle={onStyle} dark />
          <EndButton onEnd={onEnd} dark />
        </div>
      </div>
    );
  }

  return (
    <section
      role="status"
      aria-label="Walk to the tee"
      data-testid="nav-card"
      className="border-t border-border bg-card px-4 py-3"
    >
      <div className="flex items-center gap-4">
        {arrow}
        {body}
        {voice}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <StyleSwitch style={style} onStyle={onStyle} />
        <EndButton onEnd={onEnd} />
      </div>
    </section>
  );
};
