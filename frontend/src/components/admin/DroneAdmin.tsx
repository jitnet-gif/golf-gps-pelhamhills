import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ChevronLeft, ChevronRight, ClipboardCopy, ExternalLink, Presentation, TriangleAlert } from 'lucide-react';
import { PELHAM_HILLS, PELHAM_HILLS_HOLES, type FairwayPoint, type Hole } from '@/data/pelhamHills';
import { DRONE_ZONES, DRONE_ZONES_CHECKED, type ZoneLevel } from '@/data/droneZones';
import { fetchCourseData } from '@/lib/courseData';
import { getLang, onLangChange } from '@/lib/i18n/engine';
import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL_TEMPLATE } from '@/lib/tiles';
import {
  GREEN_COVERAGE,
  MISSION_SPEED,
  ZONE_LABEL,
  allWaypoints,
  batteryGroups,
  mmss,
  nearestAerodromes,
  planHole,
  waypointCsv,
  type HolePlan,
  type Waypoint,
} from '@/lib/dronePlan';

/** 지도 위 색. 위성 사진 위에서 읽혀야 해서 테마와 상관없이 고정입니다. */
const ROUTE = '#ffb547';
const CAMERA = '#5fd4ff';
const ALERT = '#ef4444';

const ZONE_BADGE: Record<ZoneLevel, string> = {
  2: 'bg-red-600 text-white',
  1: 'bg-red-500/15 text-red-700 dark:text-red-300',
  3: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  0: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

const badge = (id: string, color: string, ring: boolean) =>
  L.divIcon({
    className: '',
    html: `<div style="width:24px;height:24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 12px/1 ui-monospace,monospace;color:#0b120d;background:${color};border:2px solid ${ring ? ALERT : '#0b120d'};box-shadow:0 1px 3px rgba(0,0,0,.5)">${id}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

const holeNumberIcon = (n: number) =>
  L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 11px/1 ui-monospace,monospace;color:#0b120d;background:${ROUTE};border:2px solid #0b120d;cursor:pointer">${n}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const latLng = (p: FairwayPoint) => `${p[0].toFixed(6)}, ${p[1].toFixed(6)}`;
const gmaps = (p: FairwayPoint) => `https://www.google.com/maps/search/?api=1&query=${p[0].toFixed(6)},${p[1].toFixed(6)}`;

function FitTo({ points }: { points: FairwayPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 18 });
  }, [map, points]);
  return null;
}

function ZoneTag({ zone }: { zone: ZoneLevel | null }) {
  if (zone == null) return <span className="text-xs text-muted-foreground">-</span>;
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${ZONE_BADGE[zone]}`}>{ZONE_LABEL[zone]}</span>;
}

/**
 * 드론 촬영 (DJI Mini 4 Pro)
 *
 * 18홀을 한 홀씩 찍는 비행 계획입니다. 홀을 고르면 웨이포인트·고도·짐벌 각도와,
 * 각 점이 DJI 비행 구역 어디에 드는지가 나옵니다. 관리자는 이 값을 DJI Fly 의
 * 웨이포인트에 옮겨 적고, 호프 가이드(나레이션 슬라이드)로 순서를 익힙니다.
 */
export function DroneAdmin() {
  const [holes, setHoles] = useState<Hole[]>(PELHAM_HILLS_HOLES);
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const lang = useSyncExternalStore(onLangChange, getLang);

  // 선수 화면과 같은 순서: 번들 좌표로 바로 그리고, Supabase 행이 오면 바꿉니다.
  useEffect(() => {
    const ac = new AbortController();
    fetchCourseData(undefined, ac.signal)
      .then((d) => {
        if (!ac.signal.aborted) setHoles(d.holes);
      })
      .catch(() => {
        /* fetchCourseData가 이미 번들로 물러섭니다 */
      });
    return () => ac.abort();
  }, []);

  const plans = useMemo(() => holes.map(planHole), [holes]);
  const groups = useMemo(() => batteryGroups(plans), [plans]);
  const aerodromes = useMemo(() => nearestAerodromes(plans), [plans]);
  const hits = useMemo(() => {
    const byLevel = new Map<ZoneLevel, { hole: number; id: string }[]>();
    for (const p of plans) {
      for (const w of allWaypoints(p)) {
        if (w.zone == null) continue;
        byLevel.set(w.zone, [...(byLevel.get(w.zone) ?? []), { hole: p.hole.holeNumber, id: w.id }]);
      }
    }
    return byLevel;
  }, [plans]);
  const total = plans.length * 7;
  const blocked = (hits.get(2)?.length ?? 0) + (hits.get(1)?.length ?? 0);

  const plan = selected ? plans.find((p) => p.hole.holeNumber === selected) ?? null : null;
  const bounds = useMemo<FairwayPoint[]>(
    () => (plan ? [...plan.heroView, ...plan.greenView, ...plan.route.map((w) => w.at)] : plans.flatMap((p) => p.line)),
    [plan, plans]
  );
  const enhanced = DRONE_ZONES.filter((z) => z.level === 3 && z.rings);

  const copyCsv = (p: HolePlan) => {
    const text = waypointCsv(p);
    navigator.clipboard.writeText(text).then(
      () => setCopied('복사했습니다'),
      () => setCopied('복사하지 못했습니다. 아래 표를 보고 옮겨 적으세요.')
    );
  };

  const step = (d: number) => {
    const n = ((selected - 1 + d + plans.length) % plans.length) + 1;
    setSelected(n);
    setCopied(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">드론 촬영 계획</p>
          <span className="ml-auto text-xs text-muted-foreground">DJI Mini 4 Pro</span>
        </div>
        <p className="text-xs text-muted-foreground">
          홀마다 조망 사진(H), 플라이스루 영상(①~⑤), 그린 탑다운(G)을 찍습니다. 좌표는 코스 지도 탭의 티·핀·페어웨이 선을 따라갑니다.
        </p>
        <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="홀 선택">
          {[0, ...plans.map((p) => p.hole.holeNumber)].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setSelected(n);
                setCopied(null);
              }}
              aria-current={selected === n ? 'true' : undefined}
              className={`min-w-9 px-2.5 py-1.5 rounded-md text-xs font-medium tabular-nums whitespace-nowrap ${
                selected === n ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:bg-muted/40'
              }`}
            >
              {n === 0 ? '전체' : n}
            </button>
          ))}
        </nav>
      </section>

      <div className="rounded-lg overflow-hidden border border-border h-[55vh] min-h-[320px]">
        <MapContainer
          center={[PELHAM_HILLS.center.lat, PELHAM_HILLS.center.lng]}
          zoom={16}
          maxZoom={TILE_MAX_ZOOM}
          className="h-full w-full"
        >
          <TileLayer url={TILE_URL_TEMPLATE} attribution={TILE_ATTRIBUTION} maxZoom={TILE_MAX_ZOOM} />
          <FitTo points={bounds} />
          {enhanced.map((z, i) => (
            <Polygon
              key={i}
              positions={z.rings!}
              pathOptions={{ color: ALERT, weight: 1.5, dashArray: '6 4', fillOpacity: 0.12 }}
            />
          ))}
          {plans.map((p) => (
            <Polyline
              key={p.hole.holeNumber}
              positions={p.line}
              pathOptions={{ color: '#ffffff', weight: plan ? 1.5 : 2.5, opacity: plan && p !== plan ? 0.35 : 0.85, dashArray: plan === p ? '3 4' : undefined }}
            />
          ))}
          {!plan &&
            plans.map((p) => (
              <Marker
                key={`n${p.hole.holeNumber}`}
                position={p.line[0]}
                icon={holeNumberIcon(p.hole.holeNumber)}
                eventHandlers={{ click: () => setSelected(p.hole.holeNumber) }}
              />
            ))}
          {plan && (
            <>
              <Polygon positions={plan.heroView} pathOptions={{ color: CAMERA, weight: 1.5, dashArray: '6 4', fillOpacity: 0.08 }} />
              <Polygon positions={plan.greenView} pathOptions={{ color: CAMERA, weight: 1.5, fillOpacity: 0.15 }} />
              <Polyline positions={plan.route.map((w) => w.at)} pathOptions={{ color: ROUTE, weight: 4 }} />
              {[plan.hero, ...plan.route].map((w) => (
                <Marker key={w.id} position={w.at} icon={badge(w.id, w.id === 'H' ? CAMERA : ROUTE, w.zone === 3 || w.zone === 1 || w.zone === 2)} />
              ))}
            </>
          )}
          {aerodromes.map((a) => (
            <CircleMarker key={a.id} center={a.at} radius={7} pathOptions={{ color: '#0b120d', weight: 2, fillColor: CAMERA, fillOpacity: 1 }} />
          ))}
        </MapContainer>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        주황 선 = 비행 경로, 하늘색 = 카메라에 찍히는 땅, 빨간 점선 = 강화 경고 구역, 하늘색 점 = 공항·헬기장
      </p>

      {plan ? (
        <HoleCard
          plan={plan}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onCopy={() => copyCsv(plan)}
          copied={copied}
        />
      ) : (
        <>
          <section aria-label="비행 구역" className="rounded-lg border border-border p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <TriangleAlert className="w-4 h-4 text-orange-500" />
              <p className="text-sm font-medium">비행 구역 확인</p>
              <span className="ml-auto text-xs text-muted-foreground">DJI GEO · {DRONE_ZONES_CHECKED}</span>
            </div>
            <p className={`text-sm font-medium ${blocked ? 'text-red-600' : 'text-green-700 dark:text-green-400'}`}>
              {blocked ? `금지·승인 구역에 드는 웨이포인트가 ${blocked}개 있습니다. 계획을 옮겨야 합니다.` : '금지·승인 구역에 드는 웨이포인트는 없습니다.'}
            </p>
            <ul className="text-sm flex flex-col gap-1.5">
              {([3, 0] as ZoneLevel[]).map((level) => {
                const list = hits.get(level) ?? [];
                return (
                  <li key={level} className="flex flex-wrap items-baseline gap-2">
                    <ZoneTag zone={level} />
                    <span className="tabular-nums">
                      {list.length} / {total}
                    </span>
                    {level === 3 && list.length > 0 && (
                      <span className="text-muted-foreground">
                        {[...new Set(list.map((h) => h.hole))]
                          .map((n) => `${n}번 ${list.filter((h) => h.hole === n).map((h) => h.id).join('·')}`)
                          .join(', ')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              강화 경고 구역은 들어갈 때 DJI Fly 에서 확인을 눌러야 합니다 - 웨이포인트 비행이 거기서 멈출 수 있으니 이륙 전에 눌러 두세요. 경고 구역은 메시지만 뜹니다.
            </p>
            <ul className="text-xs text-muted-foreground flex flex-col gap-0.5">
              {aerodromes.map((a) => (
                <li key={a.id} className="tabular-nums">
                  {a.kind === 'airport' ? '공항' : '헬기장'} {a.id} ({a.name}) - 가장 가까운 곳 {a.hole}번 {a.waypoint},{' '}
                  {(a.metres / 1000).toFixed(2)}km
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              구역은 바뀔 수 있습니다. 촬영 당일 DJI Fly 와 NAV Drone 앱으로 다시 확인하세요. 표준 배터리(250g 미만)로만 찍습니다.
            </p>
          </section>

          <section aria-label="배터리" className="rounded-lg border border-border p-3 flex flex-col gap-2">
            <p className="text-sm font-medium">배터리 {groups.length}개 · 코스 순서</p>
            <div className="flex flex-col gap-1 text-sm">
              {groups.map((g, i) => (
                <div key={i} className="flex items-baseline gap-3">
                  <span className="font-mono text-primary w-7">B{i + 1}</span>
                  <span className="flex flex-wrap gap-1">
                    {g.holes.map((n) => (
                      <button key={n} type="button" onClick={() => setSelected(n)} className="underline underline-offset-2">
                        {n}번
                      </button>
                    ))}
                  </span>
                  <span className="ml-auto font-mono text-muted-foreground tabular-nums">{mmss(g.seconds)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              한 개에 20분까지(표준 배터리 34분 중 바람·이동 여유를 뺌). 프로 샵에서 조종하지 않습니다 - 캐나다는 드론을 눈으로 직접 봐야 하므로, 카트로 홀마다 가서 티 뒤 40m(①)에서 이륙합니다.
            </p>
          </section>

          <section aria-label="호프 가이드" className="rounded-lg border border-border p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Presentation className="w-4 h-4 text-primary" />
              <p className="text-sm font-medium">호프 가이드</p>
              <span className="ml-auto text-xs text-muted-foreground">ElevenLabs Hope · 9장</span>
            </div>
            <p className="text-xs text-muted-foreground">
              경로 넣는 법, 조종 위치, 배터리, 비행 구역, 체크리스트를 호프가 한국어·영어로 읽어 줍니다. 피치와 속도를 바꿀 수 있습니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowGuide((v) => !v)}
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                {showGuide ? '가이드 닫기' : '여기서 보기'}
              </button>
              <a
                href={`/admin/drone-guide.html?lang=${lang}`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
              >
                <ExternalLink className="w-4 h-4" />새 창으로
              </a>
            </div>
            {showGuide && (
              <iframe
                title="호프 드론 가이드"
                src={`/admin/drone-guide.html?lang=${lang}`}
                className="w-full h-[80vh] rounded-md border border-border"
                allow="autoplay"
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function HoleCard({
  plan,
  onPrev,
  onNext,
  onCopy,
  copied,
}: {
  plan: HolePlan;
  onPrev: () => void;
  onNext: () => void;
  onCopy: () => void;
  copied: string | null;
}) {
  const h = plan.hole;
  const row = (w: Waypoint) => (
    <tr key={w.id} className="border-t border-border">
      <td className="py-1.5 pr-2 font-mono">{w.id}</td>
      <td className="py-1.5 pr-2">{w.label}</td>
      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{w.altitude}m</td>
      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{w.gimbal}°</td>
      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{w.heading}°</td>
      <td className="py-1.5 pr-2">
        <ZoneTag zone={w.zone} />
      </td>
      <td className="py-1.5 font-mono text-xs whitespace-nowrap">{latLng(w.at)}</td>
    </tr>
  );
  const warned = allWaypoints(plan).filter((w) => w.zone != null && w.zone !== 0);

  return (
    <section aria-label="홀 계획" className="rounded-lg border border-border p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onPrev} aria-label="이전 홀" className="p-1.5 rounded-md border border-border">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="text-base font-semibold">
          {h.holeNumber}번 홀 · Par {h.par}
        </p>
        <button type="button" onClick={onNext} aria-label="다음 홀" className="p-1.5 rounded-md border border-border">
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {Math.round(plan.length)}m · {Math.round(plan.bearing)}° · {mmss(plan.seconds)}
        </span>
      </div>

      {warned.length > 0 && (
        <p className="text-sm rounded-md px-3 py-2 bg-orange-500/10 text-orange-800 dark:text-orange-200">
          {warned.map((w) => w.id).join('·')} 이(가) {ZONE_LABEL[warned[0].zone!]}에 듭니다. 이륙 전에 DJI Fly 에서 확인을 눌러 두세요.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground text-left">
              <th className="pb-1 pr-2 font-medium">#</th>
              <th className="pb-1 pr-2 font-medium">지점</th>
              <th className="pb-1 pr-2 font-medium text-right">고도</th>
              <th className="pb-1 pr-2 font-medium text-right">짐벌</th>
              <th className="pb-1 pr-2 font-medium text-right">기수</th>
              <th className="pb-1 pr-2 font-medium">구역</th>
              <th className="pb-1 font-medium">위도, 경도</th>
            </tr>
          </thead>
          <tbody>
            {row(plan.hero)}
            {plan.route.map(row)}
            {row(plan.green)}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        H 와 G 는 직접 날려 한 장씩 찍습니다. ①~⑤ 는 DJI Fly ▸ 웨이포인트에서 지도에 같은 자리를 찍고 고도·짐벌·기수를 넣습니다 (속도 {MISSION_SPEED}m/s, ①에서 녹화 시작, ⑤에서 녹화 중지와 사진). 그린 한 장에 약 {GREEN_COVERAGE.across}×{GREEN_COVERAGE.along}m 가 담깁니다.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={gmaps(plan.route[0].at)}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
        >
          <ExternalLink className="w-4 h-4" />이륙 지점 지도
        </a>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm"
        >
          <ClipboardCopy className="w-4 h-4" />웨이포인트 CSV 복사
        </button>
        {copied && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {copied}
          </span>
        )}
      </div>
    </section>
  );
}
