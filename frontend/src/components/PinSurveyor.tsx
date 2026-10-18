import React, { useCallback, useMemo, useState } from 'react';
import { Check, ClipboardCopy, Crosshair, MapPin, Trash2, TriangleAlert } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import {
  GOOD_FIX_METRES,
  clearSurvey,
  exportSurveys,
  saveSurveyPoint,
} from '@/lib/pinSurvey';
import { PELHAM_HILLS_BOOK } from '@/data/pelhamHillsBook';

interface PinSurveyorProps {
  courseId: string;
  holeNumber: number;
  className?: string;
}

const HOLE_COUNT = PELHAM_HILLS_BOOK.length;

/**
 * Capture this hole's pin and tee by standing on them.
 *
 * The coordinates shipped with the app came from OpenStreetMap and are not
 * known to belong to the hole numbers the club uses, so no hole shows a live
 * distance until someone surveys it. This is that someone's tool: walk to the
 * pin, tap, and this hole's distances switch on.
 *
 * The fix is taken from the current GPS position at the moment of the tap - no
 * averaging, so what you see in the accuracy line is exactly what gets stored.
 */
export const PinSurveyor: React.FC<PinSurveyorProps> = ({
  courseId,
  holeNumber,
  className = '',
}) => {
  const gpsPosition = useAppStore((s) => s.gpsPosition);
  const surveys = useAppStore((s) => s.pinSurveys);
  const setPinSurvey = useAppStore((s) => s.setPinSurvey);
  const removePinSurvey = useAppStore((s) => s.removePinSurvey);

  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydration deliberately does NOT live here. This panel only exists while the
  // side menu is open, and the distance readout on the map reads the same store:
  // loading here would leave yesterday's survey invisible until the player
  // happened to open the menu. Golf.tsx loads it once per course instead.

  const survey = surveys.get(holeNumber);
  const surveyedCount = useMemo(
    () => [...surveys.values()].filter((s) => s.pin).length,
    [surveys]
  );

  const capture = useCallback(
    async (which: 'pin' | 'tee') => {
      if (!gpsPosition) return;
      setError(null);
      try {
        const saved = await saveSurveyPoint(courseId, holeNumber, which, {
          latitude: gpsPosition.latitude,
          longitude: gpsPosition.longitude,
          accuracy: gpsPosition.accuracy,
          capturedAt: new Date().toISOString(),
        });
        setPinSurvey(saved);
      } catch {
        setError('Could not save the fix to this device.');
      }
    },
    [courseId, holeNumber, gpsPosition, setPinSurvey]
  );

  const discard = useCallback(async () => {
    try {
      await clearSurvey(courseId, holeNumber);
      removePinSurvey(holeNumber);
    } catch {
      setError('Could not clear this hole.');
    }
  }, [courseId, holeNumber, removePinSurvey]);

  const copyExport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportSurveys([...surveys.values()]));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard is not available here.');
    }
  }, [surveys]);

  const loose = gpsPosition && gpsPosition.accuracy > GOOD_FIX_METRES;

  const point = (which: 'pin' | 'tee') => {
    const p = which === 'pin' ? survey?.pin : survey?.tee;
    return (
      <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-accent/50">
        <div className="min-w-0">
          <div className="text-xs font-medium capitalize">{which}</div>
          {p ? (
            <div className="text-[10px] text-muted-foreground truncate">
              {p.latitude.toFixed(6)}, {p.longitude.toFixed(6)} · ±
              {Math.round(p.accuracy)}m ·{' '}
              {new Date(p.capturedAt).toLocaleDateString()}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">Not captured</div>
          )}
        </div>
        <button
          onClick={() => capture(which)}
          disabled={!gpsPosition}
          className="shrink-0 py-1 px-2 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {p ? 'Re-capture' : 'Capture'}
        </button>
      </div>
    );
  };

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <MapPin className="w-4 h-4" />
        Survey hole {holeNumber}
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {surveyedCount}/{HOLE_COUNT} pinned
        </span>
      </h2>

      <p className="text-[10px] text-muted-foreground mb-2">
        Stand on the spot and capture. The pin switches this hole&apos;s live
        distances on; the tee only draws the line on the map.
      </p>

      <div className="space-y-2">
        {point('pin')}
        {point('tee')}
      </div>

      <div className="mt-2 text-[10px] flex items-start gap-1.5">
        <Crosshair className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
        {gpsPosition ? (
          <span className={loose ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'}>
            Current fix ±{Math.round(gpsPosition.accuracy)}m
            {loose
              ? ` - looser than ±${GOOD_FIX_METRES}m. Wait for it to tighten, or the stored pin will be worse than the printed yardage.`
              : ''}
          </span>
        ) : (
          <span className="text-muted-foreground">Acquiring GPS signal…</span>
        )}
      </div>

      {loose && (
        <p className="mt-1 text-[10px] flex items-start gap-1.5 text-amber-600 dark:text-amber-500">
          <TriangleAlert className="w-3 h-3 mt-0.5 shrink-0" />
          Capturing is still allowed - the accuracy is stored with the fix so a
          bad one can be spotted and redone.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={copyExport}
          disabled={surveys.size === 0}
          className="flex-1 py-2 px-3 rounded-lg text-xs font-medium bg-muted hover:bg-accent disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy all captures'}
        </button>
        {survey && (
          <button
            onClick={discard}
            aria-label={`Clear hole ${holeNumber} survey`}
            className="py-2 px-3 rounded-lg bg-muted hover:bg-accent"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        Captures live only on this device. Copy them into the course data before
        clearing site data, or the walk is lost.
      </p>

      {error && <p className="mt-2 text-[10px] text-destructive">{error}</p>}
    </div>
  );
};
