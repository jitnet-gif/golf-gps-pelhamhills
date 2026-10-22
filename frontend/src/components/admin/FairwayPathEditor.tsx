import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ImageOverlay,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L, { type LeafletEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link, useLocation, useSearch } from 'wouter';
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Cloud,
  CloudOff,
  Eye,
  Map as MapIcon,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { holeLabelIcon as labelIcon, PinIcon, TeeIcon } from '@/components/HoleMap';
import { PELHAM_HILLS, PELHAM_HILLS_HOLES, type FairwayPoint, type Hole } from '@/data/pelhamHills';
import { bookHole } from '@/data/pelhamHillsBook';
import { formatDateTime } from '@/lib/adminApi';
import { fetchCourseData } from '@/lib/courseData';
import { METRES_TO_YARDS } from '@/lib/geo';
import {
  applyHoleEdits,
  clearAllHoleEdits,
  clearHolePath,
  deleteServerHoleEdits,
  exportHolePaths,
  isPendingEdit,
  loadHolePaths,
  nearestSegment,
  pathLengthMetres,
  pointAlong,
  pullHoleEdits,
  pushHoleEdits,
  samePoint,
  saveHoleEdit,
  sharedPins,
  swapHoleLayouts,
  type ServerProblem,
} from '@/lib/holePaths';
import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL_TEMPLATE } from '@/lib/tiles';
import { signOut, startAuth } from '@/lib/auth';
import { AccountForm } from '@/components/AccountPanel';
import { useAppStore } from '@/store/appStore';
import { HolePointInput } from './HolePointInput';
import {
  cachedFullMapStyle,
  fetchFullMapStyle,
  FULL_MAP_STYLE_EVENT,
  type FullMapStyle,
} from '@/lib/appSettings';
import { COURSE_MAP_OVERLAY } from '@/data/courseMap';

/** The club's printed map, as the player's Full map lays it on the satellite map. */
const PRINTED_CORNERS = COURSE_MAP_OVERLAY.bounds.map(([lat, lng]) => [lat, lng] as FairwayPoint);

/** 위성 지도가 없을 때 지도 바탕을 종이처럼 흰색으로 (Leaflet 기본은 회색). */
function PaperBackground({ on }: { on: boolean }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    el.style.background = on ? '#ffffff' : '';
    return () => {
      el.style.background = '';
    };
  }, [map, on]);
  return null;
}

const COURSE_ID = PELHAM_HILLS.id;

type View = 'hole' | 'course';

/**
 * 작은 점을 32px 상자 안에 둡니다. 점이 작아야 위성 사진이 가려지지 않고,
 * 상자가 커야 휴대폰에서 손가락으로 집힙니다 - 14px 점만 두면 자꾸 빗나갑니다.
 */
const handleIcon = (dot: number, fill: string, opacity = 1) =>
  L.divIcon({
    // 빈 클래스를 줘야 Leaflet 기본 leaflet-div-icon의 흰 네모가 점 뒤에 깔리지 않습니다.
    className: '',
    html: `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;opacity:${opacity}"><div style="width:${dot}px;height:${dot}px;border-radius:9999px;background:${fill};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.55)"></div></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

const WaypointIcon = handleIcon(14, '#16a34a');
const SelectedWaypointIcon = handleIcon(16, '#f59e0b');
/** 구간 가운데 손잡이. 흐리게 둬서 '이미 있는 점'이 아니라 '끌면 생기는 점'으로 읽히게 합니다. */
const MidpointIcon = handleIcon(10, '#ffffff', 0.75);

// 홀 번호 배지(labelIcon)는 선수 지도의 전체 맵과 같은 것을 씁니다 -
// components/HoleMap의 holeLabelIcon. 어디에 매다는지도 거기 적어 두었습니다.

const teeOf = (h: Hole): FairwayPoint => [h.teeLatitude, h.teeLongitude];
const pinOf = (h: Hole): FairwayPoint => [h.latitude, h.longitude];
const lineOf = (h: Hole): FairwayPoint[] => [teeOf(h), ...(h.path ?? []), pinOf(h)];

const pointOf = (e: LeafletEvent): FairwayPoint => {
  const { lat, lng } = (e.target as L.Marker).getLatLng();
  return [lat, lng];
};

const insertAt = (points: FairwayPoint[], index: number, p: FairwayPoint): FairwayPoint[] => [
  ...points.slice(0, index),
  p,
  ...points.slice(index),
];

const replaceAt = (points: FairwayPoint[], index: number, p: FairwayPoint): FairwayPoint[] =>
  points.map((q, i) => (i === index ? p : q));

/**
 * 점이 실제로 움직이지 않았으면 예전 배열을 그대로 씁니다. react-leaflet 은 위치로
 * 새 배열이 오면 좌표가 같아도 마커를 그 자리로 다시 옮기는데, 저장이 끝나 코스를
 * 다시 읽을 때마다 모든 좌표가 새 배열이 됩니다 - 그 순간 끌고 있던 점이 손가락
 * 밑에서 제자리로 튀어 돌아가지 않게 합니다.
 */
const steady = (old: FairwayPoint | undefined, now: FairwayPoint): FairwayPoint =>
  old && samePoint(old, now) ? old : now;

const yards = (metres: number) => Math.round(metres * METRES_TO_YARDS);

const SERVER_MESSAGE: Record<ServerProblem, string> = {
  unavailable: '이 빌드에는 서버 연결이 없어 이 기기에만 저장됩니다.',
  signedOut: '관리자 계정으로 로그인하면 서버에 올려 모든 폰에 보이게 합니다.',
  notAdmin: '이 계정은 관리자로 지정되지 않아 서버에 올릴 수 없습니다 (0006 SQL 맨 아래 관리자 지정).',
  missingTable: '서버에 hole_edits 표가 없습니다. 0007_hole_edits.sql 을 SQL Editor 에서 실행해 주세요.',
  network: '인터넷 연결이 없어 서버에 올리지 못했습니다. 연결되면 지금 올리기를 누르세요.',
  other: '서버에 올리지 못했습니다. 잠시 후 지금 올리기를 눌러 주세요.',
};

/**
 * 보기가 바뀔 때만 화면을 맞춥니다 - 다른 홀을 고르거나 전체 코스로 나갈 때.
 *
 * 점을 옮길 때마다 다시 맞추면 끌던 점이 손가락 밑에서 달아납니다. 그래서 점
 * 목록은 ref로만 읽고, 효과는 `target`(어느 홀인지, 전체인지)에만 걸어 둡니다.
 */
function Frame({ target, points }: { target: string; points: FairwayPoint[] }) {
  const map = useMap();
  const latest = useRef(points);
  latest.current = points;

  // 왼쪽 위에는 +/- 버튼이 있고, 홀 번호는 티보다 40px 위에 매달립니다. 그만큼
  // 비워 두지 않으면 티가 왼쪽 위에 있는 홀은 번호가 버튼 밑에 깔려 집을 수 없습니다.
  useEffect(() => {
    map.fitBounds(L.latLngBounds(latest.current), {
      paddingTopLeft: [56, 80],
      paddingBottomRight: [32, 32],
      maxZoom: TILE_MAX_ZOOM,
    });
  }, [target, map]);

  return null;
}

/** 전체 코스 보기에서는 비워 둡니다 - 코스를 둘러보다 누른 자리에 점이 생기면 안 됩니다. */
function MapClicks({ onClick }: { onClick?: (p: FairwayPoint) => void }) {
  useMapEvents({ click: (e) => onClick?.([e.latlng.lat, e.latlng.lng]) });
  return null;
}

/**
 * 코스 지도 - 홀 점선과 홀 번호를 바로잡는 편집기
 *
 * 두 가지를 고칩니다.
 * - 선: 플레이어 지도의 점선은 티에서 핀으로 곧장 그어져서, 도그렉 홀에서는
 *   숲과 해저드 위를 지나갑니다. 꺾이는 점을 찍어 페어웨이를 따라가게 합니다.
 * - 번호: 코스 좌표는 OpenStreetMap에서 왔고, 그 번호가 클럽 번호와 같다는
 *   보장이 없습니다. 핀·티가 다른 홀 것이면 두 홀의 위치를 서로 바꿉니다.
 *
 * 티(T와 홀 번호)와 핀(깃발)도 끌어서 옮길 수 있습니다. 코스 좌표가 틀린 홀 -
 * 2번 홀처럼 핀이 그린보다 한참 앞에 찍힌 곳 - 을 위성 사진을 보고 바로잡습니다.
 * 다만 거리 계산은 그대로 현장에서 서 본 핀만 씁니다(lib/pinSurvey.ts). 여기서
 * 옮긴 핀은 사진을 보고 찍은 자리라, 지도와 선을 바꿀 뿐 야드 숫자는 만들지 않습니다.
 *
 * 주소가 곧 상태입니다(/admin/map?hole=2). 플레이어 화면의 링크가 보고 있던
 * 홀로 바로 데려오고, 새로고침해도 같은 홀에 남습니다.
 */
export function FairwayPathEditor() {
  const search = useSearch();
  const [, navigate] = useLocation();

  const [rawHoles, setRawHoles] = useState<Hole[]>(PELHAM_HILLS_HOLES);
  const holePaths = useAppStore((s) => s.holePaths);
  const setHolePaths = useAppStore((s) => s.setHolePaths);
  const setHolePath = useAppStore((s) => s.setHolePath);
  const removeHolePath = useAppStore((s) => s.removeHolePath);
  const selectHole = useAppStore((s) => s.setSelectedHole);

  const [view, setView] = useState<View>('hole');

  // 고객 전체 맵 미리 보기. 위 '고객 전체 맵'에서 고르면 이 지도가 전체 코스로
  // 바뀌어 고른 지도를 그대로 보여 줍니다 - 전에는 고르고 나서 이 화면에서 달라지는
  // 것이 없어, 눌러도 지도가 안 바뀐다고 보였습니다.
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const [previewStyle, setPreviewStyle] = useState<FullMapStyle>(cachedFullMapStyle);
  useEffect(() => {
    let alive = true;
    fetchFullMapStyle().then((s) => {
      if (alive && s) setPreviewStyle(s);
    });
    const onChosen = (e: Event) => {
      setPreviewStyle((e as CustomEvent<FullMapStyle>).detail);
      setView('course');
      requestAnimationFrame(() =>
        mapBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      );
    };
    window.addEventListener(FULL_MAP_STYLE_EVENT, onChosen);
    return () => {
      alive = false;
      window.removeEventListener(FULL_MAP_STYLE_EVENT, onChosen);
    };
  }, []);
  const printedPreview = view === 'course' && previewStyle === 'printed';
  const [selected, setSelected] = useState<number | null>(null);
  // 끄는 동안의 선. 점 자체는 드롭할 때 한 번만 저장합니다.
  const [preview, setPreview] = useState<FairwayPoint[] | null>(null);
  const [swapTarget, setSwapTarget] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ tone: 'ok' | 'info'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 끌던 것을 놓으면 브라우저가 그 밑의 지도에 '누름'도 하나 보냅니다(마우스).
  // 그 누름으로 꺾이는 점을 만들면 방금 옮긴 티·핀이 그 저장에 덮여 되돌아갑니다.
  const lastDrop = useRef(0);
  const dropped = () => {
    lastDrop.current = Date.now();
  };
  const account = useAppStore((s) => s.account);
  const accountReady = useAppStore((s) => s.accountReady);
  const accountId = account?.id ?? null;
  // 모든 폰이 보는 서버 사본에 올린 상태. problem 이 있으면 그 이유를 보여 줍니다.
  const [server, setServer] = useState<{
    state: 'idle' | 'saving' | 'saved';
    problem: ServerProblem | null;
  }>({ state: 'idle', problem: null });
  // 0007 을 아직 실행하지 않은 서버. 로그인 안내보다 먼저 알려야 합니다 -
  // 로그인해도 올릴 곳이 없으니까요.
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    startAuth();
  }, []);

  // 플레이어 화면과 같은 순서: 번들 좌표로 바로 그리고, Supabase 행이 오면 바꿉니다.
  useEffect(() => {
    const ac = new AbortController();
    fetchCourseData(undefined, ac.signal)
      .then((d) => {
        if (!ac.signal.aborted) setRawHoles(d.holes);
      })
      .catch(() => {
        /* fetchCourseData가 이미 번들로 물러섭니다 */
      });
    return () => ac.abort();
  }, []);

  // 이 기기에 있는 것부터 바로 그리고, 서버 사본이 오면 합칩니다.
  useEffect(() => {
    let alive = true;
    loadHolePaths(COURSE_ID)
      .then((rows) => {
        if (alive) setHolePaths(rows);
        return pullHoleEdits(COURSE_ID);
      })
      .then(({ rows, problem }) => {
        if (!alive) return;
        if (rows) setHolePaths(rows);
        if (rows || problem === 'missingTable') setTableMissing(!rows);
      });
    return () => {
      alive = false;
    };
  }, [setHolePaths]);

  /** 서버에 아직 없는 수정을 올립니다. 로그인 전이면 올릴 것만 남겨 둡니다. */
  const upload = useCallback(async (): Promise<ServerProblem | null> => {
    setServer({ state: 'saving', problem: null });
    const { pushed, problem } = await pushHoleEdits(COURSE_ID);
    if (problem === 'missingTable') setTableMissing(true);
    else if (pushed > 0) setTableMissing(false);
    setHolePaths(await loadHolePaths(COURSE_ID));
    setServer({ state: problem ? 'idle' : 'saved', problem });
    return problem;
  }, [setHolePaths]);

  /**
   * '저장' 버튼. 고친 것은 놓는 순간 이미 이 폰에 저장되어 있으므로, 여기서는
   * 서버에 올리고 어디까지 저장됐는지를 말로 알려 줍니다 - 저장 버튼이 없으면
   * 운영자는 고친 것이 남았는지 알 길이 없습니다.
   */
  const saveNow = async () => {
    setSaveMessage(null);
    if (holePaths.size === 0) {
      setSaveMessage({ tone: 'info', text: '고친 것이 없습니다. 지도에서 점·티·핀을 옮기면 그 순간 저장됩니다.' });
      return;
    }
    const problem = await upload();
    setSaveMessage(
      problem
        ? { tone: 'info', text: `이 폰에 저장했습니다. ${SERVER_MESSAGE[problem]}` }
        : { tone: 'ok', text: '저장했습니다. 서버에 올라가 모든 손님 폰에 반영됩니다.' }
    );
  };

  // 로그인하면 이 기기에만 있던 선 - 서버가 생기기 전에 그린 것도 - 을 올립니다.
  useEffect(() => {
    if (accountId) void upload();
  }, [accountId, upload]);

  // 이 기기의 수정을 입힌 코스. 목록·지도·길이가 모두 이것을 보고,
  // 플레이어 화면(Golf.tsx)도 같은 함수를 거칩니다.
  const holes = useMemo(() => applyHoleEdits(rawHoles, holePaths), [rawHoles, holePaths]);
  const coursePoints = useMemo(() => holes.flatMap(lineOf), [holes]);
  const shared = useMemo(() => sharedPins(holes), [holes]);
  // 마커에 주는 좌표는 렌더 사이에 같은 배열이어야 합니다(steady 참고). 홀마다
  // 티·핀·번호 자리를 코스가 바뀔 때만 다시 만들고, 그때도 움직이지 않은 점은
  // 예전 배열을 그대로 둡니다.
  const spotCache = useRef(new Map<number, { tee: FairwayPoint; pin: FairwayPoint; middle: FairwayPoint }>());
  const spots = useMemo(() => {
    const next = new Map<number, { tee: FairwayPoint; pin: FairwayPoint; middle: FairwayPoint }>();
    for (const h of holes) {
      const old = spotCache.current.get(h.holeNumber);
      next.set(h.holeNumber, {
        tee: steady(old?.tee, teeOf(h)),
        pin: steady(old?.pin, pinOf(h)),
        middle: steady(old?.middle, pointAlong(lineOf(h), 0.5)),
      });
    }
    spotCache.current = next;
    return next;
  }, [holes]);

  const requested = Number(new URLSearchParams(search).get('hole'));
  const hole = holes.find((h) => h.holeNumber === requested) ?? holes[0];
  const index = holes.indexOf(hole);
  const book = bookHole(hole.holeNumber);

  // 다른 홀의 점 번호가 선택된 채 남으면 엉뚱한 점이 지워집니다.
  useEffect(() => {
    setSelected(null);
    setPreview(null);
    setSwapTarget(null);
    setSaveMessage(null);
  }, [hole.holeNumber]);

  const goTo = (holeNumber: number) => navigate(`/admin/map?hole=${holeNumber}`, { replace: true });

  const openHole = (holeNumber: number) => {
    setView('hole');
    goTo(holeNumber);
  };

  const saved = holePaths.get(hole.holeNumber);
  const waypointCache = useRef<FairwayPoint[]>([]);
  const waypoints = useMemo(() => {
    const next = (hole.path ?? []).map((p, i) => steady(waypointCache.current[i], p));
    waypointCache.current = next;
    return next;
  }, [hole]);
  const { tee, pin } = spots.get(hole.holeNumber) ?? { tee: teeOf(hole), pin: pinOf(hole) };
  const line = lineOf(hole);
  // 구간 가운데 손잡이도 같은 이유로, 움직인 구간의 것만 새로 만듭니다.
  const middleCache = useRef<FairwayPoint[]>([]);
  const middles = useMemo(() => {
    const points = lineOf(hole);
    const next = points
      .slice(0, -1)
      .map((a, i) =>
        steady(middleCache.current[i], [(a[0] + points[i + 1][0]) / 2, (a[1] + points[i + 1][1]) / 2])
      );
    middleCache.current = next;
    return next;
  }, [hole]);

  // 번호를 바꾼 홀인가: 저장된 핀이 원래 데이터에서 다른 번호의 핀이면 그렇습니다.
  // 두 번 바꿔 제자리로 돌아온 홀은 바꾸지 않은 홀과 같고, 끌어서 새 자리에 놓은
  // 핀은 어느 홀의 핀도 아니므로 번호를 바꾼 것이 아닙니다 - 혼자 되돌려도 됩니다.
  const movedFrom = saved?.pin
    ? (rawHoles.find((h) => samePoint(pinOf(h), saved.pin as FairwayPoint))?.holeNumber ?? null)
    : null;
  const renumbered = movedFrom !== null && movedFrom !== hole.holeNumber;

  const commit = useCallback(
    async (next: FairwayPoint[]) => {
      setError(null);
      setNotice(null);
      try {
        setHolePath(await saveHoleEdit(COURSE_ID, hole.holeNumber, { waypoints: next }));
        void upload();
      } catch {
        setError('이 기기에 저장하지 못했습니다.');
      } finally {
        setPreview(null);
      }
    },
    [hole.holeNumber, setHolePath, upload]
  );

  /**
   * 티나 핀을 끌어 놓은 자리를 저장합니다. 홀 길이는 새 선(티, 꺾이는 점, 핀)을
   * 따라 다시 잽니다 - 선수 화면의 "티에서 핀까지"가 옛 길이로 남지 않게요.
   */
  const commitLayout = async (patch: { tee?: FairwayPoint; pin?: FairwayPoint }) => {
    setError(null);
    setNotice(null);
    const nextLine: FairwayPoint[] = [patch.tee ?? tee, ...waypoints, patch.pin ?? pin];
    try {
      setHolePath(
        await saveHoleEdit(COURSE_ID, hole.holeNumber, {
          ...patch,
          length: Math.round(pathLengthMetres(nextLine)),
        })
      );
      void upload();
    } catch {
      setError('이 기기에 저장하지 못했습니다.');
    } finally {
      setPreview(null);
    }
  };

  /** 지도를 누른 자리를 가장 가까운 구간에 끼워 넣습니다. */
  // 꺾이는 점은 5개까지. 페어웨이 한 홀을 따라가기에 충분하고, 그보다 많으면
  // 폰 화면에서 점과 손잡이가 겹쳐 잘못 누르기 쉽습니다 (클럽 요청).
  const MAX_BENDS = 5;
  const full = waypoints.length >= MAX_BENDS;

  const addPoint = (p: FairwayPoint) => {
    if (Date.now() - lastDrop.current < 700) return;
    if (full) {
      setNotice(`꺾이는 점은 ${MAX_BENDS}개까지입니다. 점을 끌어서 옮기거나, 점을 두 번 눌러(폰은 길게 눌러) 지운 뒤 다시 찍으세요.`);
      return;
    }
    const segment = nearestSegment(line, p);
    void commit(insertAt(waypoints, segment, p));
    setSelected(segment);
  };

  const removeAt = (index: number) => {
    void commit(waypoints.filter((_, i) => i !== index));
    setSelected(null);
  };

  const removeSelected = () => {
    if (selected !== null) removeAt(selected);
  };

  // Delete·Backspace 로도 지웁니다. 입력칸(좌표 붙여넣기)에서 누른 키는 건드리지 않습니다.
  useEffect(() => {
    if (view !== 'hole' || selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeAt(selected);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const straighten = () => {
    void commit([]);
    setSelected(null);
  };

  const revert = async () => {
    if (renumbered) return;
    setError(null);
    try {
      // 서버에 올라간 선은 서버에서도 지워야 다른 폰에서 사라지고, 다음에
      // 서버를 읽을 때 되살아나지 않습니다.
      if (saved?.syncedAt) {
        const problem = await deleteServerHoleEdits(COURSE_ID, [hole.holeNumber]);
        if (problem) {
          setError(SERVER_MESSAGE[problem]);
          return;
        }
      }
      await clearHolePath(COURSE_ID, hole.holeNumber);
      removeHolePath(hole.holeNumber);
      setSelected(null);
    } catch {
      setError('이 기기의 수정을 지우지 못했습니다.');
    }
  };

  /**
   * 이 번호가 쓰던 핀·티·선을 고른 번호로 옮기고, 그 번호가 쓰던 것을 받아 옵니다.
   * 보고 있던 위치를 따라 그 번호로 넘어갑니다 - 방금 옮긴 홀을 계속 보게요.
   */
  const swap = async () => {
    const other = holes.find((h) => h.holeNumber === swapTarget);
    if (!other) return;
    setError(null);
    try {
      const rows = await swapHoleLayouts(COURSE_ID, hole, other);
      rows.forEach((row) => setHolePath(row));
      void upload();
      setNotice(
        `${hole.holeNumber}번 홀 자리에 있던 핀·티·선을 ${other.holeNumber}번 홀로 옮겼습니다. ` +
          `${hole.holeNumber}번 홀은 ${other.holeNumber}번 홀이 쓰던 위치를 받았습니다.`
      );
      goTo(other.holeNumber);
    } catch {
      setError('홀 번호를 바꾸지 못했습니다.');
    }
  };

  const clearAll = async () => {
    if (!window.confirm('저장한 모든 홀 수정(선과 번호)을 지울까요? 서버에 올린 것도 지워져 모든 폰에서 사라집니다.')) {
      return;
    }
    setError(null);
    try {
      if ([...holePaths.values()].some((p) => p.syncedAt)) {
        const problem = await deleteServerHoleEdits(COURSE_ID);
        if (problem) {
          setError(SERVER_MESSAGE[problem]);
          return;
        }
      }
      await clearAllHoleEdits(COURSE_ID);
      setHolePaths([]);
      setSelected(null);
      setNotice('모든 홀 수정을 지웠습니다. 코스 데이터대로 돌아왔습니다.');
    } catch {
      setError('이 기기의 수정을 지우지 못했습니다.');
    }
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportHolePaths([...holePaths.values()]));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('이 브라우저에서는 클립보드를 쓸 수 없습니다.');
    }
  };

  const lineYards = yards(pathLengthMetres(preview ?? line));
  const cardYards = book?.yards.white;
  // 카드 거리와 크게 다르면 번호가 틀렸을 가능성이 큽니다. 선을 따라 잰 길이와
  // 카드 야드는 원래 조금 다르므로 20%를 넘을 때만 알립니다.
  const farFromCard = cardYards != null && Math.abs(lineYards - cardYards) > cardYards * 0.2;

  const where = saved && !isPendingEdit(saved) ? '서버에 저장됨 - 모든 폰에 보임' : '이 기기에만 저장됨';
  const pendingCount = [...holePaths.values()].filter(isPendingEdit).length;
  const allSynced =
    holePaths.size > 0 && pendingCount === 0 && !server.problem && !tableMissing;
  const serverProblem = tableMissing
    ? 'missingTable'
    : server.problem && (server.problem !== 'signedOut' || pendingCount > 0)
      ? server.problem
      : null;
  const serverText =
    server.state === 'saving'
      ? '서버에 올리는 중...'
      : serverProblem
        ? SERVER_MESSAGE[serverProblem]
        : pendingCount > 0
          ? account
            ? `서버에 아직 올리지 않은 홀 ${pendingCount}개`
            : `이 기기에만 있는 홀 ${pendingCount}개 - 관리자 계정으로 로그인하면 서버에 올립니다.`
          : holePaths.size > 0
            ? `수정한 ${holePaths.size}개 홀이 서버에 저장되어 모든 선수 화면에 보입니다.`
            : '수정한 홀이 없습니다. 선을 고치면 서버에 저장되어 모든 폰에 보입니다.';

  const status = renumbered
    ? `원래 데이터의 ${movedFrom ?? '?'}번 홀 위치를 쓰는 중 · ${where} · ${formatDateTime(saved?.updatedAt)}`
    : saved
      ? `${where} · ${formatDateTime(saved.updatedAt)}`
      : hole.path
        ? '배포된 코스 데이터의 선'
        : '수정 없음 - 티와 핀을 잇는 직선';

  const button =
    'inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-40';
  const viewButton = (active: boolean) =>
    `inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:bg-muted/40'
    }`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex gap-2" role="group" aria-label="지도 보기">
        <button
          type="button"
          onClick={() => setView('course')}
          aria-pressed={view === 'course'}
          className={viewButton(view === 'course')}
        >
          <MapIcon className="w-4 h-4" />
          전체 코스
        </button>
        <button
          type="button"
          onClick={() => setView('hole')}
          aria-pressed={view === 'hole'}
          className={viewButton(view === 'hole')}
        >
          <Pencil className="w-4 h-4" />
          {hole.holeNumber}번 홀 편집
        </button>
      </div>

      {view === 'hole' && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goTo(holes[index - 1].holeNumber)}
            disabled={index <= 0}
            aria-label="이전 홀"
            className={button}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <select
            value={hole.holeNumber}
            onChange={(e) => goTo(Number(e.target.value))}
            aria-label="홀 선택"
            className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm font-semibold"
          >
            {holes.map((h) => (
              <option key={h.holeNumber} value={h.holeNumber}>
                {h.holeNumber}번 홀 · Par {bookHole(h.holeNumber)?.par ?? h.par}
                {holePaths.has(h.holeNumber) ? ' · 수정함' : ''}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => goTo(holes[index + 1].holeNumber)}
            disabled={index >= holes.length - 1}
            aria-label="다음 홀"
            className={button}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {view === 'course'
          ? `18개 홀의 번호와 ${printedPreview ? '클럽 안내도' : '점선'}입니다 - 고객 전체 맵(${previewStyle === 'printed' ? '현시스템 지도' : '신시스템 지도'}) 미리 보기. 번호나 핀을 누르면 그 홀 편집으로 넘어갑니다. 번호가 겹치면 확대하세요.`
          : '지도를 누르면 가장 가까운 구간에 꺾이는 점이 생깁니다 (5개까지). 초록 점을 끌어 페어웨이 가운데로 옮기세요. 점을 두 번 누르거나(폰은 길게 누르기), 눌러서 고른 뒤 지도 오른쪽 위 삭제 버튼을 누르면 지워집니다. 선 중간의 흰 점을 끌거나 누르면 그 자리에 점이 하나 더 생깁니다. T나 번호를 끌면 티가, 깃발을 끌면 핀이 옮겨지고 점선이 따라옵니다.'}
      </p>

      {shared.length > 0 && (
        <p className="flex items-start gap-1.5 text-sm text-red-700 dark:text-red-300" role="alert">
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          같은 핀을 쓰는 홀이 있습니다: {shared.map((group) => group.join('·') + '번').join(', ')}. 번호를 다시
          바꾸거나 아래 &apos;모든 홀 수정 지우기&apos;로 되돌리세요.
        </p>
      )}

      {notice && (
        <p className="text-sm text-green-700 dark:text-green-400" role="status">
          {notice}
        </p>
      )}

      <div ref={mapBoxRef} className="relative h-[60vh] min-h-[320px] rounded-lg overflow-hidden border border-border">
        {/* 아래 버튼 줄은 화면 밖에 있기 쉬워, 점을 고르면 지도 위에도 삭제 버튼을 띄웁니다. */}
        {view === 'hole' && selected !== null && (
          <button
            type="button"
            onClick={removeSelected}
            className="absolute top-2 right-2 z-[1000] inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-red-600 text-white text-sm font-medium shadow-md hover:bg-red-700"
          >
            <Trash2 className="w-4 h-4" />
            선택한 점 삭제
          </button>
        )}
        {/* zoomSnap 0.25: 전체 코스를 정수 줌에 맞추면 코스가 화면 가운데 3분의 1로
            쪼그라들고 번호가 겹칩니다. 타일은 소수 줌에서도 그대로 늘려 그립니다. */}
        <MapContainer
          center={pin}
          zoom={17}
          zoomSnap={0.25}
          maxZoom={TILE_MAX_ZOOM}
          doubleClickZoom={false}
          style={{ height: '100%', width: '100%' }}
        >
          {/* 현시스템 미리 보기에서는 위성 지도를 깔지 않습니다 - 고객 폰과 같게,
              안내도만 흰 바탕에. */}
          {!printedPreview && (
            <TileLayer
              url={TILE_URL_TEMPLATE}
              attribution={TILE_ATTRIBUTION}
              maxZoom={TILE_MAX_ZOOM}
              maxNativeZoom={TILE_MAX_ZOOM}
              crossOrigin="anonymous"
            />
          )}
          <PaperBackground on={printedPreview} />
          {/* 현시스템 미리 보기: 고객 폰과 같은 클럽 안내도를 같은 자리에. 번호와 핀은
              그 위에 그대로 있어 누르면 그 홀 편집으로 갑니다. */}
          {printedPreview && (
            <Pane name="printed-preview" style={{ zIndex: 350 }}>
              <ImageOverlay
                url={COURSE_MAP_OVERLAY.url}
                bounds={L.latLngBounds(PRINTED_CORNERS)}
                alt="클럽 코스 안내도 미리 보기"
              />
            </Pane>
          )}
          <Frame
            target={view === 'course' ? `course-${printedPreview ? 'printed' : 'satellite'}` : `hole-${hole.holeNumber}`}
            points={view === 'course' ? (printedPreview ? PRINTED_CORNERS : coursePoints) : line}
          />
          <MapClicks onClick={view === 'hole' ? addPoint : undefined} />

          {/* 나머지 홀. 편집 중에는 흐리게 깔아 두어 옆 홀과 헷갈리지 않게 합니다. */}
          {holes.map((h) =>
            view === 'hole' && h.holeNumber === hole.holeNumber ? null : (
              <Fragment key={`other-${h.holeNumber}`}>
                {/* 안내도가 제 선을 그리므로, 현시스템 미리 보기에서는 점선을 숨깁니다. */}
                {!printedPreview && (
                  <Polyline
                    positions={lineOf(h)}
                    interactive={false}
                    pathOptions={{
                      color: '#ffffff',
                      weight: 2,
                      opacity: view === 'course' ? 0.9 : 0.45,
                      dashArray: '6 6',
                    }}
                  />
                )}
                <Marker
                  position={pinOf(h)}
                  icon={PinIcon}
                  opacity={view === 'course' ? 1 : 0.5}
                  title={`${h.holeNumber}번 홀 핀`}
                  eventHandlers={{ click: () => openHole(h.holeNumber) }}
                />
              </Fragment>
            )
          )}

          {view === 'hole' && (
            <>
              <Polyline
                positions={preview ?? line}
                interactive={false}
                pathOptions={{ color: '#ffffff', weight: 3, opacity: 0.95, dashArray: '8 8' }}
              />

              {/* 티와 핀도 손잡이입니다. 끄는 동안 점선이 따라오고, 놓으면 저장합니다. */}
              <Marker
                position={tee}
                icon={TeeIcon}
                title={`${hole.holeNumber}번 홀 티`}
                draggable
                zIndexOffset={1500}
                eventHandlers={{
                  drag: (e) => setPreview([pointOf(e), ...waypoints, pin]),
                  dragend: (e) => {
                          dropped();
                          void commitLayout({ tee: pointOf(e) });
                        },
                }}
              />
              <Marker
                position={pin}
                icon={PinIcon}
                title={`${hole.holeNumber}번 홀 핀`}
                draggable
                zIndexOffset={1500}
                eventHandlers={{
                  drag: (e) => setPreview([tee, ...waypoints, pointOf(e)]),
                  dragend: (e) => {
                    dropped();
                    void commitLayout({ pin: pointOf(e) });
                  },
                }}
              />

              {/* 흰 손잡이도 점을 하나 더 만듭니다 - 5개가 차면 숨깁니다. */}
              {!full && middles.map((mid, i) => {
                return (
                  // 점 개수를 key에 넣습니다. 끼워 넣은 뒤에는 손잡이가 새 구간마다
                  // 새로 생겨야 하고, 방금 끌어 놓은 손잡이가 그 자리에 남으면 안 됩니다.
                  <Marker
                    key={`mid-${i}-${line.length}`}
                    position={mid}
                    icon={MidpointIcon}
                    draggable
                    eventHandlers={{
                      click: () => {
                        void commit(insertAt(waypoints, i, mid));
                        setSelected(i);
                      },
                      drag: (e) => setPreview(insertAt(line, i + 1, pointOf(e))),
                      dragend: (e) => {
                        dropped();
                        void commit(insertAt(waypoints, i, pointOf(e)));
                        setSelected(i);
                      },
                    }}
                  />
                );
              })}

              {waypoints.map((p, i) => (
                <Marker
                  key={`wp-${i}`}
                  position={p}
                  icon={selected === i ? SelectedWaypointIcon : WaypointIcon}
                  draggable
                  zIndexOffset={1000}
                  eventHandlers={{
                    click: () => setSelected(i),
                    // 두 번 누르기(PC)나 길게 누르기(폰)로 바로 지웁니다.
                    dblclick: () => removeAt(i),
                    contextmenu: () => removeAt(i),
                    dragstart: () => setSelected(i),
                    drag: (e) => setPreview(replaceAt(line, i + 1, pointOf(e))),
                    dragend: (e) => {
                      dropped();
                      void commit(replaceAt(waypoints, i, pointOf(e)));
                    },
                  }}
                />
              ))}
            </>
          )}

          {/* 홀 번호는 두 보기 모두에 둡니다. 전체 코스에서는 이것이 홀로 들어가는 문입니다. */}
          {/* 편집 중인 홀의 번호는 티 위에 매달려 있어, 끌면 티가 함께 옮겨집니다. */}
          {holes.map((h) => {
            const onLine = view === 'course';
            const editing = !onLine && h.holeNumber === hole.holeNumber;
            const spot = spots.get(h.holeNumber);
            return (
              <Marker
                key={`label-${h.holeNumber}`}
                position={onLine ? (spot?.middle ?? pointAlong(lineOf(h), 0.5)) : (spot?.tee ?? teeOf(h))}
                icon={labelIcon(h.holeNumber, editing, onLine)}
                zIndexOffset={2000}
                title={`${h.holeNumber}번 홀`}
                draggable={editing}
                eventHandlers={
                  editing
                    ? {
                        drag: (e) => setPreview([pointOf(e), ...waypoints, pin]),
                        dragend: (e) => {
                          dropped();
                          void commitLayout({ tee: pointOf(e) });
                        },
                      }
                    : { click: () => openHole(h.holeNumber) }
                }
              />
            );
          })}
        </MapContainer>
      </div>

      {view === 'hole' ? (
        <>
          <p className="text-sm">
            꺾이는 점 {waypoints.length}개 (최대 {MAX_BENDS}개) · 선 길이 {lineYards}야드
            <span className="text-muted-foreground"> (직선 {yards(pathLengthMetres([tee, pin]))}야드)</span>
          </p>
          {book && (
            <p className={`text-xs ${farFromCard ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'}`}>
              클럽 카드: Par {book.par} · 핸디캡 {book.handicap} · White {book.yards.white}야드
              {farFromCard && ' - 선 길이와 차이가 큽니다. 이 위치가 정말 이 번호의 홀인지 확인하세요.'}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{status}</p>
          <p className="text-xs text-muted-foreground">
            티·핀을 옮기면 지도와 전체 맵의 선이 바뀝니다. 선수 화면의 실시간 거리는 그린에 서서 잰
            핀(핀 측량)으로만 계산합니다.
          </p>

          <section
            aria-label="정확한 위치 넣기"
            className="rounded-lg border border-border p-3 flex flex-col gap-3"
          >
            <div>
              <p className="text-sm font-medium">정확한 위치 넣기 (GPS)</p>
              <p className="text-xs text-muted-foreground">
                티 박스나 그린 가운데에 서서 &lsquo;지금 내 위치로&rsquo;를 누르세요. 다른 곳에서 잰
                좌표가 있으면 붙여 넣어도 됩니다. 손으로 끄는 것보다 정확합니다.
              </p>
            </div>
            <HolePointInput
              key={`tee-${hole.holeNumber}`}
              label={`${hole.holeNumber}번 티 (T)`}
              point={tee}
              onSave={(p) => commitLayout({ tee: p })}
            />
            <HolePointInput
              key={`pin-${hole.holeNumber}`}
              label={`${hole.holeNumber}번 핀 (깃발)`}
              point={pin}
              onSave={(p) => commitLayout({ pin: p })}
            />
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveNow()}
              disabled={server.state === 'saving'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {server.state === 'saving' ? '저장 중...' : '저장'}
            </button>
            <button type="button" onClick={removeSelected} disabled={selected === null} className={button}>
              <Trash2 className="w-4 h-4" />
              선택한 점 삭제
            </button>
            <button type="button" onClick={straighten} disabled={waypoints.length === 0} className={button}>
              <RotateCcw className="w-4 h-4" />
              직선으로
            </button>
            {saved && (
              <button type="button" onClick={revert} disabled={renumbered} className={button}>
                <Undo2 className="w-4 h-4" />이 홀 수정 취소
              </button>
            )}
            <Link
              href={`/golf/${COURSE_ID}`}
              onClick={() => selectHole(hole.holeNumber)}
              className={button}
            >
              <Eye className="w-4 h-4" />
              플레이어 화면에서 보기
            </Link>
          </div>
          {saveMessage && (
            <p
              role="status"
              className={`text-sm ${saveMessage.tone === 'ok' ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}
            >
              {saveMessage.text}
            </p>
          )}
          {renumbered && (
            <p className="text-xs text-muted-foreground">
              번호를 바꾼 홀은 혼자 되돌리면 두 홀이 같은 위치를 쓰게 됩니다. 되돌리려면 번호를 다시
              바꾸거나 &apos;모든 홀 수정 지우기&apos;를 쓰세요.
            </p>
          )}

          <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
            <p className="text-sm font-medium">홀 번호 바꾸기</p>
            <p className="text-xs text-muted-foreground">
              지도의 핀·티·선이 실제로는 다른 홀이면 맞는 번호를 고르세요. 두 홀의 위치가 서로
              바뀝니다. 파·핸디캡은 번호를 따라 클럽 카드 그대로 남습니다.
            </p>
            <div className="flex gap-2">
              <select
                value={swapTarget ?? ''}
                onChange={(e) => setSwapTarget(e.target.value ? Number(e.target.value) : null)}
                aria-label="바꿀 홀 번호"
                className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm"
              >
                <option value="">번호 선택</option>
                {holes
                  .filter((h) => h.holeNumber !== hole.holeNumber)
                  .map((h) => (
                    <option key={h.holeNumber} value={h.holeNumber}>
                      {h.holeNumber}번 홀
                    </option>
                  ))}
              </select>
              <button type="button" onClick={swap} disabled={swapTarget === null} className={button}>
                <ArrowLeftRight className="w-4 h-4" />
                {swapTarget === null ? '번호 바꾸기' : `이 위치를 ${swapTarget}번 홀로`}
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm">
          수정한 홀 {holePaths.size}/{holes.length}개
        </p>
      )}

      {/* 고친 선이 모든 선수의 폰에 보이는지. 서버에 올리는 것은 관리자 계정만. */}
      <section aria-label="모든 폰에 반영" className="rounded-lg border border-border p-3 flex flex-col gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {allSynced ? (
            <Cloud className="w-4 h-4 text-primary" />
          ) : (
            <CloudOff className="w-4 h-4 text-muted-foreground" />
          )}
          모든 폰에 반영
        </p>
        <p
          role="status"
          className={`text-xs ${
            serverProblem && serverProblem !== 'signedOut'
              ? 'text-red-700 dark:text-red-300'
              : 'text-muted-foreground'
          }`}
        >
          {serverText}
        </p>
        {account ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{account.email}</span>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={() => void upload()}
                disabled={server.state === 'saving'}
                className={button}
              >
                <Cloud className="w-4 h-4" />
                지금 올리기
              </button>
            )}
            <button type="button" onClick={() => void signOut()} className={button}>
              로그아웃
            </button>
          </div>
        ) : (
          accountReady && <AccountForm locale="ko" />
        )}
      </section>

      <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          백업: 수정한 선과 번호를 코드로 복사해 둘 수 있습니다 ({holePaths.size}/{holes.length}홀).
        </p>
        <button
          type="button"
          onClick={copyExport}
          disabled={holePaths.size === 0}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {copied ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
          {copied ? '복사했습니다' : '수정한 선 전체 복사'}
        </button>
        <button type="button" onClick={clearAll} disabled={holePaths.size === 0} className={button}>
          <Trash2 className="w-4 h-4" />모든 홀 수정 지우기
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
