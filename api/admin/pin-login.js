/**
 * 운영 화면 숫자판 로그인 - POST /api/admin/pin-login  { code: "1234" }
 *
 * 클럽 어드민(pelhamhills.com/admin)과 같은 직원 ID 입니다 (migration 0032).
 *   1. 번호를 Pelham Shift(GET /api/birth-login?id=)에 확인해 직원 이름을 받습니다.
 *      없는 번호는 여기서 끝나고 'login_failed' 로 적습니다 - 클럽 어드민 서버까지 가지 않으므로
 *      그쪽의 "10분에 10번" 잠금을 이 함수 주소 하나로 다 써 버리지 않습니다.
 *      매니저 번호는 403 - 매니저는 이메일로 들어옵니다(클럽 어드민과 같은 규칙).
 *   2. 클럽 어드민 서버(Fly, POST /pos/pin-login)에서 공용 직원 계정 세션을 받습니다.
 *      그 서버만 Supabase service_role 을 갖고 있어서, 이 함수는 마스터 키 없이 동작합니다.
 *   3. 토큰의 session_id 와 직원 이름을 gps_admin_pin_record 로 적습니다. 이후 그 세션의 쓰기는
 *      데이터베이스 트리거가 이 이름으로 기록합니다.
 *
 * 번호는 Pelham Shift 로그인 비밀번호이기도 하므로 어디에도 적지 않습니다.
 *
 * 환경 변수 (Vercel > Settings > Environment Variables)
 *   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY  앱 빌드에 쓰는 것과 같은 값 (이미 있음)
 *   GPS_ADMIN_LOG_SECRET   0032 을 Run 하면 마지막 칸에 나오는 값. 없으면 로그인은 되지만
 *                          기록에 직원 이름 대신 공용 계정 이메일이 남습니다.
 *   PELHAM_API_URL         (선택) 기본 https://pelham-hills-api.fly.dev/api/v1
 *   PELHAM_SHIFT_URL       (선택) 기본 https://pelham-shift.vercel.app
 *   PELHAM_SHIFT_TEAM      (선택) 같은 번호가 여러 팀에 있을 때 팀 id
 */

const PELHAM_API = (process.env.PELHAM_API_URL || 'https://pelham-hills-api.fly.dev/api/v1').replace(/\/+$/, '');
const SHIFT_URL = (process.env.PELHAM_SHIFT_URL || 'https://pelham-shift.vercel.app').replace(/\/+$/, '');
const SHIFT_TEAM = (process.env.PELHAM_SHIFT_TEAM || '').trim();

const WINDOW_MS = 10 * 60 * 1000;
const MAX_MISSES = 10;

const json = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function supabaseConfig() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

async function rpc(db, name, args) {
  const res = await fetch(`${db.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: db.key, Authorization: `Bearer ${db.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// 비밀값이 없을 때만 쓰는 이 인스턴스 메모리의 잠금. 있으면 데이터베이스 기록으로 셉니다.
const misses = new Map();
function recentMisses(ip, now) {
  const list = (misses.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  misses.set(ip, list);
  return list;
}

/** JWT 가운데 부분. 서명은 확인하지 않습니다 - 방금 클럽 서버에서 HTTPS 로 받은 토큰입니다. */
function claims(token) {
  try {
    const part = String(token).split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

async function lookup(code) {
  const url = new URL(`${SHIFT_URL}/api/birth-login`);
  url.searchParams.set('id', code);
  if (SHIFT_TEAM) url.searchParams.set('team', SHIFT_TEAM);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`pelham-shift ${res.status}`);
  const body = await res.json();
  return body && typeof body === 'object' ? body : {};
}

export async function POST(request) {
  const input = await request.json().catch(() => null);
  const code = String(input?.code ?? '').trim();
  if (!/^\d{4,8}$/.test(code)) return json(400, { error: 'Enter your 4-8 digit staff ID.' });

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || '';
  const ua = (request.headers.get('user-agent') || '').slice(0, 200);

  const db = supabaseConfig();
  const secret = (process.env.GPS_ADMIN_LOG_SECRET || '').trim();
  const logging = Boolean(db && secret);

  const record = async (fields) => {
    if (!logging) return false;
    try {
      await rpc(db, 'gps_admin_pin_record', {
        p_secret: secret,
        p_ip: ip,
        p_ua: ua,
        p_session: null,
        p_user: null,
        p_name: null,
        p_reason: null,
        ...fields,
      });
      return true;
    } catch (error) {
      console.warn('admin pin record failed:', error.message);
      return false;
    }
  };

  const miss = async (reason, name = null) => {
    if (logging) await record({ p_ok: false, p_reason: reason, p_name: name });
    else recentMisses(ip, Date.now()).push(Date.now());
  };

  // 1. 너무 많이 틀렸나
  let allowed = true;
  if (logging) {
    try {
      allowed = (await rpc(db, 'gps_admin_pin_gate', { p_secret: secret, p_ip: ip })) !== false;
    } catch (error) {
      console.warn('admin pin gate failed:', error.message);
    }
  } else {
    allowed = recentMisses(ip, Date.now()).length < MAX_MISSES;
  }
  if (!allowed) return json(429, { error: 'Too many wrong IDs. Wait 10 minutes.' });

  // 2. Pelham Shift 에 번호 확인
  let found;
  try {
    found = await lookup(code);
  } catch (error) {
    console.warn('pelham-shift lookup failed:', error.message);
    return json(503, { error: "Can't reach Pelham Shift right now. Try again, or sign in with email." });
  }
  if (found.ambiguous) {
    return json(409, { error: 'More than one Pelham Shift team uses this ID. Ask a manager to set PELHAM_SHIFT_TEAM.' });
  }
  const name = String(found.name || '').split(/\s+/).filter(Boolean).join(' ').slice(0, 80);
  if (!name) {
    await miss('unknown id');
    return json(404, { error: 'That staff ID is not right.' });
  }
  if (found.manager === true) {
    await miss('manager id', name);
    return json(403, { error: 'Managers sign in with their email and password.' });
  }

  // 3. 공용 직원 계정 세션 받기
  let session;
  try {
    const res = await fetch(`${PELHAM_API}/pos/pin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = typeof body?.detail === 'string' ? body.detail : `Sign-in failed (${res.status}).`;
      return json(res.status === 404 || res.status === 403 || res.status === 429 ? res.status : 503, { error: detail });
    }
    session = body;
  } catch (error) {
    console.warn('pelham pin-login failed:', error.message);
    return json(503, { error: "Can't reach the club sign-in server. Try again." });
  }
  if (!session?.access_token || !session?.refresh_token) {
    return json(503, { error: 'Sign-in answer was not understood. Try again.' });
  }

  // 4. 세션 → 이름
  const jwt = claims(session.access_token);
  const recorded = UUIDish(jwt.session_id) && UUIDish(jwt.sub)
    ? await record({ p_ok: true, p_session: jwt.session_id, p_user: jwt.sub, p_name: name })
    : false;

  return json(200, {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    email: session.user?.email ?? null,
    name,
    // false 면 기록에 직원 이름이 아니라 공용 계정이 남습니다(GPS_ADMIN_LOG_SECRET 확인).
    recorded,
  });
}

function UUIDish(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}
