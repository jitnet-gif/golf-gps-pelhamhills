import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Circle as RecordIcon, Save, Square, Trash2, Undo2 } from 'lucide-react';
import { CLUBHOUSE, OSM_CART_PATHS } from '@/data/cartPaths';
import { PELHAM_HILLS, type FairwayPoint } from '@/data/pelhamHills';
import { METRES_TO_YARDS } from '@/lib/geo';
import { formatDateTime } from '@/lib/adminApi';
import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL_TEMPLATE } from '@/lib/tiles';
import {
  addTrackFix,
  deleteCartPath,
  loadCachedCartPaths,
  pullCartPaths,
  RECORD_MAX_ACCURACY_METRES,
  saveCartPath,
  simplifyTrack,
  trackMetres,
  type RecordedCartPath,
  type Track,
} from '@/lib/cartPaths';
import type { ServerProblem } from '@/lib/holePaths';

const COURSE_ID = PELHAM_HILLS.id;

const PROBLEM: Record<ServerProblem, string> = {
  unavailable: '이 빌드에는 서버 연결이 없어 저장할 수 없습니다.',
  signedOut: '저장하려면 위 코스 지도 편집 아래에서 관리자 계정으로 로그인해 주세요.',
  notAdmin: '이 계정은 관리자로 지정되지 않아 저장할 수 없습니다 (0006 SQL 맨 아래 관리자 지정).',
  missingTable: '서버에 cart_paths 표가 없습니다. 0011_cart_paths.sql 을 SQL Editor 에서 실행해 주세요.',
  network: '인터넷 연결이 없어 저장하지 못했습니다. 녹화한 길은 화면에 남아 있으니 연결되면 다시 저장을 누르세요.',
  other: '저장하지 못했습니다. 잠시 후 다시 눌러 주세요.',
};

const yards = (m: number) => Math.round(m * METRES_TO_YARDS);

type WakeLockLike = { release: () => Promise<void> };

/** 녹화 중에는 지도가 카트를 따라갑니다. 손으로 움직이면 멈춥니다. */
function FollowTrack({ at, on }: { at: FairwayPoint | null; on: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (on && at) map.panTo(at, { animate: true, duration: 0.3 });
  }, [map, at, on]);
  return null;
}

/**
 * 카트 길 녹화
 *
 * 휴대폰을 들고 카트로 길을 한 번 달리면 그 길이 저장되고, 모든 선수 폰의 카트
 * 네비게이션(Hole out)이 그 길을 따라 안내합니다. OpenStreetMap 의 카트 길은
 * 20조각으로 끊겨 있고 13~15번 홀 주변에는 아예 없어서, 지금은 끊긴 곳을 점선
 * 직선으로 잇습니다. 달린 길이 쌓일수록 점선이 줄어듭니다.
 *
 * 한 번에 길 한 줄을 녹화합니다 - 갈림길에서 멈추고 저장한 뒤 다음 줄을 새로
 * 시작하면 됩니다. 앞 줄의 끝과 6m 안에서 시작한 줄은 앱이 자동으로 이어 붙입니다.
 */
export function CartPathRecorder() {
  const [saved, setSaved] = useState<RecordedCartPath[]>(() => loadCachedCartPaths(COURSE_ID));
  const [track, setTrack] = useState<Track>({ points: [], lastAt: null });
  const [recording, setRecording] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [skippedVague, setSkippedVague] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [follow, setFollow] = useState(true);
  // 지도는 필요할 때만 엽니다 - 위 코스 지도 편집과 위성 지도 두 장을 한꺼번에 받지 않게.
  const [mapOpen, setMapOpen] = useState(false);
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<WakeLockLike | null>(null);

  useEffect(() => {
    let alive = true;
    void pullCartPaths(COURSE_ID).then(({ rows, problem }) => {
      if (!alive) return;
      if (rows) setSaved(rows);
      if (problem === 'missingTable') setMessage({ tone: 'error', text: PROBLEM.missingTable });
    });
    return () => {
      alive = false;
    };
  }, []);

  const stopWatching = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
    setRecording(false);
  }, []);

  useEffect(() => stopWatching, [stopWatching]);

  const start = async () => {
    setMessage(null);
    if (!('geolocation' in navigator)) {
      setMessage({ tone: 'error', text: '이 브라우저는 위치를 알려 주지 않습니다.' });
      return;
    }
    setTrack({ points: [], lastAt: null });
    setSkippedVague(0);
    setFollow(true);
    setRecording(true);
    // 화면이 꺼지면 위치도 멈춥니다. 되는 브라우저에서는 녹화하는 동안 화면을 켜 둡니다.
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockLike> } };
      wakeLock.current = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      /* 화면 켜 두기를 못 하는 브라우저 - 녹화는 그대로 합니다 */
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        setAccuracy(fix.accuracy);
        setTrack((current) => {
          const { track: next, skipped } = addTrackFix(current, fix);
          if (skipped === 'vague') setSkippedVague((n) => n + 1);
          return next;
        });
      },
      (err) => {
        setMessage({
          tone: 'error',
          text:
            err.code === err.PERMISSION_DENIED
              ? '위치 권한이 꺼져 있습니다. 브라우저 설정에서 위치를 허용해 주세요.'
              : 'GPS 신호를 받지 못하고 있습니다. 하늘이 트인 곳으로 가 보세요.',
        });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  };

  const simplified = useMemo(() => simplifyTrack(track.points), [track.points]);
  const length = trackMetres(track.points);
  const canSave = !recording && simplified.length >= 2 && length >= 15;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const { row, problem } = await saveCartPath(COURSE_ID, simplified);
    setBusy(false);
    if (problem || !row) {
      setMessage({ tone: 'error', text: PROBLEM[problem ?? 'other'] });
      return;
    }
    setSaved((rows) => [...rows, row]);
    setTrack({ points: [], lastAt: null });
    setMessage({ tone: 'ok', text: `길을 저장했습니다 (${yards(row.metres)}야드). 선수 폰은 다음에 앱을 열 때 받습니다.` });
  };

  const remove = async (path: RecordedCartPath) => {
    if (!window.confirm(`${formatDateTime(path.createdAt)} 에 녹화한 ${yards(path.metres)}야드 길을 지울까요?`)) return;
    setBusy(true);
    const problem = await deleteCartPath(COURSE_ID, path.id);
    setBusy(false);
    if (problem) {
      setMessage({ tone: 'error', text: PROBLEM[problem] });
      return;
    }
    setSaved((rows) => rows.filter((r) => r.id !== path.id));
  };

  const last = track.points[track.points.length - 1] ?? null;
  const showMap = mapOpen || recording || track.points.length > 0;

  return (
    <section aria-labelledby="cart-recorder-title" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 id="cart-recorder-title" className="text-base font-semibold">
          카트 길 녹화
        </h2>
        <p className="text-sm text-muted-foreground">
          휴대폰을 들고 카트로 길을 한 번 달리면, 선수 폰의 카트 네비게이션이 그 길을 따라 안내합니다.
          갈림길마다 멈추고 저장한 뒤 다음 길을 새로 녹화하세요.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!recording ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            <RecordIcon className="h-4 w-4" fill="currentColor" />
            {track.points.length ? '새로 녹화' : '녹화 시작'}
          </button>
        ) : (
          <button
            type="button"
            onClick={stopWatching}
            className="inline-flex h-11 items-center gap-2 rounded-md bg-neutral-900 px-4 text-sm font-semibold text-white"
          >
            <Square className="h-4 w-4" fill="currentColor" />
            녹화 멈춤
          </button>
        )}
        {canSave && (
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              저장
            </button>
            <button
              type="button"
              onClick={() => setTrack({ points: [], lastAt: null })}
              disabled={busy}
              className="inline-flex h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium"
            >
              <Undo2 className="h-4 w-4" />
              버리기
            </button>
          </>
        )}
      </div>

      <p className="text-sm tabular-nums" role="status" aria-live="polite">
        {recording ? (
          <>
            <span className="font-semibold text-red-600">● 녹화 중</span> · {yards(length)}야드 · 점 {track.points.length}개
            {accuracy !== null && <> · GPS ±{Math.round(accuracy)}m</>}
            {accuracy !== null && accuracy > RECORD_MAX_ACCURACY_METRES && (
              <span className="text-amber-700 dark:text-amber-400"> (흐려서 건너뜀)</span>
            )}
          </>
        ) : track.points.length ? (
          <>녹화한 길 {yards(length)}야드 · 저장하면 점 {simplified.length}개로 줄여 올립니다.</>
        ) : (
          <>저장된 길 {saved.length}줄 · OpenStreetMap 길 {OSM_CART_PATHS.length}줄</>
        )}
        {skippedVague > 0 && !recording && track.points.length > 0 && <> · 흐린 위치 {skippedVague}번 건너뜀</>}
      </p>

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${message.tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-400'}`}
        >
          {message.text}
        </p>
      )}

      {!showMap && (
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="inline-flex h-10 w-fit items-center rounded-md border border-border px-3 text-sm font-medium"
        >
          길 지도 보기
        </button>
      )}
      {showMap && (
      <>
      <div
        className="h-[50vh] min-h-[280px] overflow-hidden rounded-lg border border-border"
        onPointerDown={() => recording && setFollow(false)}
      >
        <MapContainer center={last ?? CLUBHOUSE} zoom={17} maxZoom={TILE_MAX_ZOOM} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url={TILE_URL_TEMPLATE}
            attribution={TILE_ATTRIBUTION}
            maxZoom={TILE_MAX_ZOOM}
            maxNativeZoom={TILE_MAX_ZOOM}
            crossOrigin="anonymous"
          />
          {OSM_CART_PATHS.map((line) => (
            <Polyline key={line.id} positions={line.points} pathOptions={{ color: '#e5e7eb', weight: 3, opacity: 0.8, dashArray: '4 6' }} />
          ))}
          {saved.map((line) => (
            <Polyline key={line.id} positions={line.points} pathOptions={{ color: '#38bdf8', weight: 5, opacity: 0.95 }} />
          ))}
          {track.points.length > 1 && (
            <Polyline positions={track.points} pathOptions={{ color: '#ef4444', weight: 5, opacity: 1 }} />
          )}
          {last && <CircleMarker center={last} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }} />}
          <FollowTrack at={last} on={recording && follow} />
        </MapContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        회색 점선: OpenStreetMap 길 · 파란 선: 저장된 길 · 빨간 선: 지금 녹화 중인 길
        {recording && !follow && (
          <>
            {' '}·{' '}
            <button type="button" className="font-medium text-primary underline" onClick={() => setFollow(true)}>
              카트 따라가기
            </button>
          </>
        )}
      </p>
      </>
      )}

      {saved.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {saved.map((path) => (
            <li key={path.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {formatDateTime(path.createdAt)} · {yards(path.metres)}야드 · 점 {path.points.length}개
              </span>
              <button
                type="button"
                onClick={() => void remove(path)}
                disabled={busy}
                aria-label="이 길 지우기"
                className="grid h-9 w-9 place-items-center rounded-md text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
