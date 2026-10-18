import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SatelliteDish, Volume2 } from 'lucide-react';
import { useTTS } from '@/hooks/useTTS';
import { useFairwayDistance, type FairwayDistance as Reading } from '@/hooks/useFairwayDistance';
import { useAppStore } from '@/store/appStore';
import { haversineMetres } from '@/lib/geo';
import {
  hasCalloutVoice,
  playCallout,
  unlockCalloutVoice,
  type CalloutParts,
} from '@/lib/calloutVoice';
import type { Hole } from '@/data/pelhamHills';
import type { GuidanceReading } from '@/lib/teeGuidance';

const AUTO_KEY = 'golf-gps.distance-callouts';
/** Standing this long is "stopped to play a shot". */
const STILL_MS = 5000;
/** A callout the player already heard is not repeated for less than this. */
const CHANGE_YARDS = 10;
/**
 * Inside this the player is putting, not choosing a club, and a voice reading
 * "12 yards to the pin" over a putt is noise. Everything further out - fairway,
 * rough, trees, bunker - is a shot worth a number.
 */
const PUTTING_YARDS = 15;

/**
 * On unless this phone has turned it off. The club asked for the yardage to be
 * spoken at every stop out on the hole ("무조건 ... 멈추면 야디지 얘기해줘"), so
 * a player who never finds the switch still hears it; one who turns it off is
 * remembered.
 */
const loadAuto = (): boolean => {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
};

const saveAuto = (on: boolean) => {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {
    /* the switch simply starts off next time */
  }
};

/** What is said. Short enough to hear over the wind; "about" when the pin is. */
export const calloutText = (d: Reading): string | null => {
  if (d.status !== 'ok' || d.along === null || d.straight === null) return null;
  const along = Math.round(d.along);
  const straight = Math.round(d.straight);
  const lead = `${d.approx ? 'About ' : ''}${along} yards to the pin`;
  if (!d.onLine) return `${lead} in a straight line.`;
  // On a dogleg the corner is the number the tee shot is played to.
  const bend = d.bends.length ? `, ${Math.round(d.bends[0].yards)} to the bend` : '';
  if (along - straight >= CHANGE_YARDS) return `${lead} along the fairway${bend}, ${straight} straight.`;
  return `${lead}${bend}.`;
};

/**
 * The same callout as `calloutText`, cut into the pieces the baked caddie voice
 * is made of. Kept beside it so the words and the clips never drift apart.
 */
export const calloutParts = (d: Reading): CalloutParts | null => {
  if (d.status !== 'ok' || d.along === null || d.straight === null) return null;
  const along = Math.round(d.along);
  const straight = Math.round(d.straight);
  if (!d.onLine) return { about: d.approx, yards: along, tail: 'straight' };
  const bendYards = d.bends.length ? Math.round(d.bends[0].yards) : null;
  const farOffStraight = along - straight >= CHANGE_YARDS;
  return {
    about: d.approx,
    yards: along,
    tail: farOffStraight ? 'fairway' : 'pin',
    bendYards,
    straightYards: farOffStraight ? straight : null,
  };
};

interface FairwayDistanceProps {
  hole: Hole;
  /** Hole narration is playing - an automatic callout waits for it to finish. */
  narrationBusy?: boolean;
  /** Called before a tapped callout, to stop narration it would talk over. */
  onBeforeSpeak?: () => void;
  /**
   * The player picked this hole from somewhere else and is being walked to its
   * tee: show that walk instead of the pin, which starts at the tee.
   */
  toTee?: GuidanceReading | null;
  /** Filled with "say it now", for the speak button on the map. */
  sayRef?: React.MutableRefObject<(() => void) | null>;
  className?: string;
}

/**
 * Yards to the pin from where the player stands, along the hole, for the narrow
 * column beside the map - with a button that says it, and a voice that says it
 * by itself once the player has stood still for a few seconds.
 *
 * That voice is on by default. Only a stop is announced, never a stride: a
 * player walking to the ball does not want a voice every ten yards, and one
 * standing over it does. On the fairway the number follows the hole; in the
 * rough, past OFF_LINE_METRES from the line, it is the straight distance and
 * says so. On the green it says nothing - see PUTTING_YARDS.
 *
 * A browser will not speak until the page has been tapped once, so the first
 * tap anywhere pays for every callout after it (the effect below).
 */
export const FairwayDistance: React.FC<FairwayDistanceProps> = ({
  hole,
  narrationBusy = false,
  onBeforeSpeak,
  toTee = null,
  sayRef,
  className = '',
}) => {
  const reading = useFairwayDistance(hole);
  const gps = useAppStore((s) => s.gpsPosition);
  const gpsProblem = useAppStore((s) => s.gpsProblem);
  const { speak, unlock, isSupported } = useTTS('en-US');
  const [auto, setAuto] = useState(loadAuto);
  const text = calloutText(reading);

  // The timer reads the newest figures, not the ones it was started with.
  const latest = useRef({ reading, text, narrationBusy, toTee });
  latest.current = { reading, text, narrationBusy, toTee };

  // Where the player came to a halt, and whether that halt is still to be told.
  const anchor = useRef<{ lat: number; lon: number; since: number } | null>(null);
  const armed = useRef(false);
  const lastSpoken = useRef<{ hole: number; yards: number } | null>(null);

  useEffect(() => {
    if (!gps) return;
    const a = anchor.current;
    // A still phone's fix wanders by a few metres; a walker covers 6-7 in 5 s.
    const radius = Math.min(8, Math.max(4, (gps.accuracy ?? 8) / 2));
    if (!a || haversineMetres(a.lat, a.lon, gps.latitude, gps.longitude) > radius) {
      anchor.current = { lat: gps.latitude, lon: gps.longitude, since: Date.now() };
      armed.current = true;
    }
  }, [gps]);

  // Picking another hole while standing still is worth a callout of its own.
  useEffect(() => {
    armed.current = true;
  }, [hole.holeNumber]);

  /**
   * The caddie's voice first (ElevenLabs clips on the phone), the speech engine
   * when it cannot - a yardage past the longest hole, a browser that will not
   * play mp3, a build with no clips baked yet.
   */
  const say = useCallback(
    (words: string, parts?: CalloutParts | null) => {
      onBeforeSpeak?.();
      const spoken = parts ?? null;
      if (spoken && hasCalloutVoice()) {
        void playCallout(spoken).then((played) => {
          if (!played) speak(words, { lang: 'en-US', id: 'fairway-distance' });
        });
        return;
      }
      speak(words, { lang: 'en-US', id: 'fairway-distance' });
    },
    [onBeforeSpeak, speak]
  );

  // The map's speak button says whatever this readout would.
  const spoken = toTee
    ? toTee.yards !== null
      ? `Hole ${toTee.holeNumber} tee, ${Math.round(toTee.yards)} yards.`
      : null
    : text;
  useEffect(() => {
    if (!sayRef) return;
    const parts = toTee ? null : calloutParts(reading);
    sayRef.current = (isSupported || hasCalloutVoice()) && spoken ? () => say(spoken, parts) : null;
    return () => {
      sayRef.current = null;
    };
    // `reading` changes with every fix; the button says whatever it reads now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sayRef, isSupported, spoken, say, reading, toTee]);

  useEffect(() => {
    if (!auto || !(isSupported || hasCalloutVoice())) return;
    const timer = window.setInterval(() => {
      const a = anchor.current;
      const { reading: r, text: words, narrationBusy: busy, toTee: walking } = latest.current;
      // On the way to a tee the pin is not the number that matters yet.
      if (walking) return;
      if (!armed.current || !a || !words || r.along === null) return;
      // Putting, not playing a shot.
      if (r.along < PUTTING_YARDS) return;
      if (Date.now() - a.since < STILL_MS) return;
      // Never over the hole's narration, or over anything else being read.
      if (busy || window.speechSynthesis.speaking) return;
      armed.current = false;
      const yards = Math.round(r.along);
      const last = lastSpoken.current;
      if (last && last.hole === hole.holeNumber && Math.abs(last.yards - yards) < CHANGE_YARDS) return;
      lastSpoken.current = { hole: hole.holeNumber, yards };
      const parts = calloutParts(r);
      if (parts && hasCalloutVoice()) {
        void playCallout(parts).then((played) => {
          if (!played) speak(words, { lang: 'en-US', id: 'fairway-distance' });
        });
        return;
      }
      speak(words, { lang: 'en-US', id: 'fairway-distance' });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [auto, isSupported, hole.holeNumber, speak]);

  // A switch left on from last time: iOS speaks unprompted only after a tap on
  // this page, so the first tap anywhere pays for it. 'click', because a
  // touch's pointerdown does not count as that tap on iOS or Android.
  useEffect(() => {
    if (!auto) return;
    const onTap = () => {
      unlock();
      void unlockCalloutVoice();
    };
    document.addEventListener('click', onTap, { once: true, capture: true });
    return () => document.removeEventListener('click', onTap, { capture: true });
  }, [auto, unlock]);

  const toggleAuto = () => {
    const next = !auto;
    setAuto(next);
    saveAuto(next);
    if (!next) return;
    // Said inside the tap: it confirms the switch and, on iOS, is what allows
    // the later callouts to make a sound at all.
    void unlockCalloutVoice();
    if (text && reading.along !== null) {
      lastSpoken.current = { hole: hole.holeNumber, yards: Math.round(reading.along) };
      armed.current = false;
      // The engine says this one: the baked clips have no "callouts on" in them,
      // and the confirmation is the point of the tap.
      say(`Distance callouts on. ${text}`);
    } else {
      unlock();
    }
  };

  const autoSwitch = isSupported ? (
    <button
      type="button"
      role="switch"
      aria-checked={auto}
      onClick={toggleAuto}
      className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ${
        auto ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
      }`}
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${auto ? 'bg-primary' : 'bg-muted-foreground/50'}`}
      />
      Speak when I stop
    </button>
  ) : null;

  if (toTee) {
    const teeYards = toTee.yards !== null ? Math.round(toTee.yards) : null;
    const teeWords =
      teeYards !== null ? `Hole ${toTee.holeNumber} tee, ${teeYards} yards.` : null;
    return (
      <div className={`flex flex-col items-center text-center ${className}`}>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Walk to the tee
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="flex items-baseline gap-0.5"
            aria-label={`${teeYards ?? 'Unknown'} yards to the hole ${toTee.holeNumber} tee`}
            data-testid="tee-yards"
          >
            <span className="text-3xl font-bold leading-none tabular-nums text-primary">
              {teeYards ?? '--'}
            </span>
            <span className="text-xs text-muted-foreground">yd</span>
          </div>
          {isSupported && teeWords && (
            <button
              type="button"
              onClick={() => say(teeWords)}
              aria-label="Say the distance to the tee"
              className="rounded-full bg-muted p-1.5 text-foreground hover:bg-accent"
            >
              <Volume2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Hole {toTee.holeNumber} tee{toTee.compass ? ` · ${toTee.compass}` : ''}
        </div>
        <div className="text-[10px] leading-snug text-muted-foreground">
          The pin distance starts at the tee.
        </div>
        {autoSwitch}
      </div>
    );
  }

  if (reading.status === 'no-fix') {
    return (
      <div className={`flex flex-col items-center text-center ${className}`}>
        {/* Why there is no distance, when the phone has said why - the header's
            GPS button has the way to fix it. */}
        <p
          className={`flex items-center gap-1.5 text-xs ${
            gpsProblem ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
          }`}
        >
          <SatelliteDish className={`h-3.5 w-3.5 shrink-0 ${gpsProblem ? '' : 'animate-pulse'}`} />
          {gpsProblem === 'denied'
            ? 'Location is off for this site. Tap "Location off" at the top to turn it on.'
            : gpsProblem === 'unavailable'
              ? 'No GPS signal yet. Step out into the open - it keeps trying.'
              : gpsProblem === 'unsupported'
                ? 'This browser cannot share your location.'
                : 'Finding you for the pin distance...'}
        </p>
        {autoSwitch}
      </div>
    );
  }

  if (reading.status === 'far' || reading.along === null || reading.straight === null) {
    return (
      <div className={`flex flex-col items-center text-center ${className}`}>
        <p className="text-xs text-muted-foreground">
          You are away from hole {hole.holeNumber}
          {reading.straight !== null && (
            <>
              {' '}- its pin is {reading.approx ? 'about ' : ''}
              {Math.round(reading.straight)} yd off.
            </>
          )}
        </p>
        {autoSwitch}
      </div>
    );
  }

  const along = Math.round(reading.along);
  const straight = Math.round(reading.straight);

  return (
    <div className={`flex flex-col items-center text-center ${className}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {reading.onLine ? 'To pin · fairway' : 'To pin · straight'}
      </div>
      <div className="flex items-center gap-1.5">
        <div
          className="flex items-baseline gap-0.5"
          aria-label={`${reading.approx ? 'About ' : ''}${along} yards to the pin`}
          data-testid="fairway-yards"
        >
          {reading.approx && (
            <span className="text-lg font-bold leading-none text-amber-600 dark:text-amber-400">≈</span>
          )}
          <span className="text-3xl font-bold leading-none tabular-nums text-primary">{along}</span>
          <span className="text-xs text-muted-foreground">yd</span>
        </div>
        {isSupported && text && (
          <button
            type="button"
            onClick={() => say(text)}
            aria-label="Say the distance to the pin"
            className="rounded-full bg-muted p-1.5 text-foreground hover:bg-accent"
          >
            <Volume2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {reading.bends.length > 0 && (
        <div className="text-[11px] font-medium text-foreground" data-testid="bend-yards">
          To the bend {Math.round(reading.bends[0].yards)}
        </div>
      )}
      {reading.onLine && along - straight >= 5 && (
        <div className="text-[11px] text-muted-foreground">Straight {straight}</div>
      )}
      {!reading.onLine && (
        <div className="text-[11px] leading-snug text-muted-foreground">Off the fairway line</div>
      )}
      {reading.approx && (
        <div className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
          ≈ pin from the map, not surveyed
        </div>
      )}
      {autoSwitch}
    </div>
  );
};
