import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, LocateFixed, RefreshCw, Trash2, Users } from 'lucide-react';
import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL_TEMPLATE } from '@/lib/tiles';
import { PELHAM_HILLS_HOLES } from '@/data/pelhamHills';
import {
  fetchPlayersOnCourse,
  forgetPlayer,
  isStale,
  playerLabel,
  STALE_AFTER_MS,
  type PlayerOnCourse,
} from '@/lib/playerMonitor';

/**
 * 플레이어 모니터 - 지금 코스에 누가 어디 있는지
 *
 * 손님 폰이 30 초마다 자리를 올리고(lib/playerMonitor, 마이그레이션 0014),
 * 이 화면이 그것을 코스 지도 위에 그립니다. 프로 샵이 무전기 없이 "14번에
 * 누가 있나", "주문한 손님이 어디쯤인가" 를 보는 화면입니다.
 *
 * 자취는 그리지 않습니다. 표에도 기기당 한 줄만 있고, 지나온 길은 프로 샵이
 * 쓸 일도 없거니와 남겨 둘 이유도 없습니다.
 *
 * 15 초마다 다시 읽습니다. 손님 폰은 30 초마다 올리므로 그보다 자주 읽어도
 * 새 자리가 나오지는 않지만, 절반으로 잡아 두면 화면의 점이 한 주기를 통째로
 * 건너뛰지 않습니다.
 */

const REFRESH_MS = 15_000;

/** 코스 한가운데. 아직 아무도 없을 때 지도가 어디를 보고 있을지. */
const COURSE_CENTER: [number, number] = [
  PELHAM_HILLS_HOLES.reduce((sum, h) => sum + h.latitude, 0) / PELHAM_HILLS_HOLES.length,
  PELHAM_HILLS_HOLES.reduce((sum, h) => sum + h.longitude, 0) / PELHAM_HILLS_HOLES.length,
];

/**
 * 점 하나. Leaflet 기본 핀(파란 압정)은 스무 개가 겹치면 어디가 어딘지
 * 알 수 없어, 이름표를 단 작은 원으로 그립니다. 연락이 끊긴 카트는 회색입니다.
 */
const playerIcon = (label: string, stale: boolean, hole: number | null) =>
  L.divIcon({
    className: '',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-6px)">
        <div style="
          width:34px;height:34px;border-radius:9999px;
          display:flex;align-items:center;justify-content:center;
          font:700 13px/1 system-ui,sans-serif;color:#fff;
          background:${stale ? '#94a3b8' : '#16a34a'};
          border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)">
          ${hole ?? '·'}
        </div>
        <div style="
          margin-top:2px;padding:1px 6px;border-radius:9999px;max-width:110px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          font:600 11px/1.4 system-ui,sans-serif;
          background:rgba(15,23,42,.85);color:#fff">${escapeHtml(label)}</div>
      </div>`,
    iconSize: [34, 52],
    iconAnchor: [17, 26],
  });

/** divIcon 은 HTML 문자열이라, 손님이 카드에 적은 이름이 그대로 들어가면 안 됩니다. */
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );

/** 몇 분 전인지. 초 단위는 15 초마다 새로 그리는 화면에서 읽히지 않습니다. */
const sinceLabel = (iso: string, now: number): string => {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return '방금';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  return `${Math.round(minutes / 60)}시간 전`;
};

/**
 * 첫 화면에서만 전체가 들어오게 맞춥니다. 그 뒤로는 건드리지 않습니다 -
 * 15 초마다 지도가 제멋대로 움직이면 한 카트를 들여다볼 수가 없습니다.
 * "전체 보기" 버튼이 다시 맞추는 쪽입니다.
 */
function FitOnce({ players, fitToken }: { players: PlayerOnCourse[]; fitToken: number }) {
  const map = useMap();
  const done = useRef(-1);

  useEffect(() => {
    if (done.current === fitToken) return;
    if (players.length === 0) return;
    done.current = fitToken;
    const bounds = L.latLngBounds(players.map((p) => [p.latitude, p.longitude] as [number, number]));
    map.fitBounds(bounds.pad(0.25), { maxZoom: 18 });
  }, [players, fitToken, map]);

  return null;
}

export function PlayerMonitor() {
  const [players, setPlayers] = useState<PlayerOnCourse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [fitToken, setFitToken] = useState(0);

  const load = useCallback(async () => {
    try {
      const rows = await fetchPlayersOnCourse();
      setPlayers(rows);
      setError(null);
    } catch (e) {
      // 0014 를 아직 돌리지 않았을 때가 대부분입니다.
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const remove = async (id: string) => {
    // 줄 하나를 지우는 일이고, 그 폰이 아직 코스에 있으면 30 초 뒤에 다시
    // 나타납니다. 되돌릴 것이 없으니 따로 묻지 않습니다.
    try {
      await forgetPlayer(id);
      setPlayers((rows) => rows.filter((r) => r.deviceId !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '지우지 못했습니다.');
    }
  };

  const live = useMemo(() => players.filter((p) => !isStale(p, now)), [players, now]);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Users className="h-4 w-4" />
          코스 위의 손님
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
            {live.length}팀
          </span>
        </h2>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFitToken((n) => n + 1)}
            disabled={players.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            <LocateFixed className="h-4 w-4" />
            전체 보기
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            새로 고침
          </button>
        </div>
      </header>

      <p className="text-xs text-muted-foreground">
        손님 폰이 30초마다 자리를 보냅니다. 점 안의 숫자는 그 폰 화면에 떠 있는 홀이고,
        회색은 {Math.round(STALE_AFTER_MS / 60_000)}분 넘게 소식이 없는 카트입니다.
      </p>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
          <br />
          <span className="text-xs">
            이 화면이 비어 있으면 backend/migrations/0014_player_monitor.sql 을 먼저 실행하세요.
          </span>
        </p>
      )}

      <div className="h-[55vh] min-h-[320px] overflow-hidden rounded-lg border border-border">
        <MapContainer
          center={COURSE_CENTER}
          zoom={16}
          zoomSnap={0.25}
          maxZoom={TILE_MAX_ZOOM}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url={TILE_URL_TEMPLATE}
            attribution={TILE_ATTRIBUTION}
            maxZoom={TILE_MAX_ZOOM}
            maxNativeZoom={TILE_MAX_ZOOM}
            crossOrigin="anonymous"
          />
          <FitOnce players={players} fitToken={fitToken} />
          {players.map((player) => (
            <Marker
              key={player.deviceId}
              position={[player.latitude, player.longitude]}
              icon={playerIcon(playerLabel(player), isStale(player, now), player.holeNumber)}
            >
              <Tooltip direction="top" offset={[0, -24]}>
                {playerLabel(player)} · {player.holeNumber ? `${player.holeNumber}번 홀` : '홀 미상'}
                {' · '}
                {sinceLabel(player.updatedAt, now)}
              </Tooltip>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {players.length === 0 && !loading && !error && (
        <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          지금 코스에서 앱을 켜 둔 손님이 없습니다. 라운드가 시작되면 여기에 나타납니다.
        </p>
      )}

      {players.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {players.map((player) => {
            const stale = isStale(player, now);
            return (
              <li key={player.deviceId} className="flex items-center gap-3 p-3">
                <span
                  aria-hidden
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${
                    stale ? 'bg-slate-400' : 'bg-green-600'
                  }`}
                >
                  {player.holeNumber ?? '·'}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{playerLabel(player)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {player.holeNumber ? `${player.holeNumber}번 홀` : '홀 미상'}
                    {' · '}
                    {sinceLabel(player.updatedAt, now)}
                    {player.accuracy != null && ` · ±${Math.round(player.accuracy)}m`}
                    {stale && ' · 연결 끊김'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void remove(player.deviceId)}
                  aria-label={`${playerLabel(player)} 지우기`}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted/40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
