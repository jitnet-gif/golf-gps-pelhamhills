-- ============================================================================
-- 0032 운영 화면 직원 ID(숫자판) 로그인 + 직원 행동 기록
-- ============================================================================
--
-- 클럽 어드민(pelhamhills.com/admin)과 같은 입구로 바꿉니다 (2026-11-11):
--   - 직원은 Pelham Shift 직원 ID(출퇴근 번호, 4~8자리)를 숫자판에 누릅니다.
--     Vercel 함수 /api/admin/pin-login 이 번호를 Pelham Shift 에 확인하고, 클럽 어드민
--     서버(Fly, POST /pos/pin-login)에서 공용 직원 계정(staff@pelhamhills.ca) 세션을 받습니다.
--   - 매니저와 코스 지도 담당(analysis@pelhamhills.ca)은 "이메일로 로그인" 을 씁니다.
--   - 코스 지도·드론 경로 쓰기는 0030 그대로 map_editors(analysis@ 하나)만 됩니다.
--     이 파일 끝에서 한 번 더 그 상태로 맞춥니다.
--
-- 직원 여러 명이 공용 계정 하나를 쓰므로, 누가 했는지는 "로그인 세션" 으로 압니다:
--   Supabase 토큰 안의 session_id 를 Vercel 함수가 받아 gps_admin_sessions 에 (세션 → 직원 이름)
--   으로 적습니다. 그 세션으로 들어온 쓰기는 트리거가 그 이름으로 gps_admin_log 에 적습니다.
--   토큰은 브라우저가 고칠 수 없으므로, 이름을 지어내 기록을 남길 수 없습니다.
--   세션을 적는 함수는 아래 gps_admin_secret 의 비밀값을 아는 서버(Vercel)만 부를 수 있습니다.
--
-- 기록 보기: 운영 화면 '기록' 탭. 이메일로 로그인한 관리자(scorecard_admins)와 지도 담당만
-- 볼 수 있습니다 - 숫자판으로 들어온 공용 계정은 자기 기록을 볼 수도, 지울 수도 없습니다.
-- 기록은 누구도 고치거나 지울 수 없습니다(지우려면 SQL Editor 에서 직접).
--
-- 전제: 0006(scorecard_admins), 0030(map_editors). 0019(직원 명부)는 있으면 그 직원도 기록하고, 없으면 건너뜁니다.
-- 실행: Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run. 여러 번 실행해도 안전합니다.
-- 맨 아래 결과의 vercel_env_GPS_ADMIN_LOG_SECRET 값을 Vercel > Settings > Environment Variables 에
-- GPS_ADMIN_LOG_SECRET 로 넣고 다시 배포하세요. 이 값이 없으면 로그인은 되지만 직원 이름 대신
-- staff@pelhamhills.ca 로 기록됩니다.
-- ============================================================================

DO $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regprocedure('public.is_scorecard_admin()') IS NULL THEN
    v_missing := v_missing || '0006_scorecards.sql (is_scorecard_admin)';
  END IF;
  IF to_regprocedure('public.is_map_editor()') IS NULL THEN
    v_missing := v_missing || '0030_map_editor.sql (is_map_editor)';
  END IF;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '먼저 실행할 파일: %', array_to_string(v_missing, ', ')
      USING HINT = '그 파일을 SQL Editor 에서 Run 한 뒤 0032 를 다시 Run 하세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 표
-- ----------------------------------------------------------------------------

-- 숫자판 로그인 한 번 = 한 줄. 토큰의 session_id 로 찾습니다.
CREATE TABLE IF NOT EXISTS public.gps_admin_sessions (
  session_id uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  staff_name text NOT NULL,
  ip         text,
  user_agent text,
  opened_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gps_admin_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor       text NOT NULL,          -- 직원 이름(숫자판) 또는 이메일
  actor_email text,                   -- 로그인 계정
  user_id     uuid,
  session_id  uuid,
  via         text NOT NULL,          -- pin | email | server
  action      text NOT NULL,          -- login, login_failed, logout, open, insert, update, delete ...
  target      text,                   -- 표 이름 또는 화면
  row_key     text,                   -- 바뀐 줄을 알아볼 값(id, key, 홀 번호 ...)
  detail      jsonb,                  -- update 는 {열: [전, 후]}, insert/delete 는 그 줄
  ip          text
);

CREATE INDEX IF NOT EXISTS gps_admin_log_at_idx ON public.gps_admin_log (at DESC);
CREATE INDEX IF NOT EXISTS gps_admin_log_actor_idx ON public.gps_admin_log (actor, at DESC);

-- Vercel 함수만 아는 값. 처음 Run 할 때 한 번 만들어지고, 다시 Run 해도 바뀌지 않습니다.
-- 바꾸려면: UPDATE public.gps_admin_secret SET secret = replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
CREATE TABLE IF NOT EXISTS public.gps_admin_secret (
  id     boolean PRIMARY KEY DEFAULT true CHECK (id),
  secret text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);
INSERT INTO public.gps_admin_secret (id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.gps_admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_admin_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_admin_secret ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gps_admin_sessions FROM anon, authenticated;
REVOKE ALL ON public.gps_admin_log FROM anon, authenticated;
REVOKE ALL ON public.gps_admin_secret FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 지금 누구인가
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gps_admin_whoami()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_sess  uuid;
  v_name  text;
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_sess := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_sess := NULL;
  END;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_sess IS NOT NULL THEN
    SELECT staff_name INTO v_name
      FROM public.gps_admin_sessions
     WHERE session_id = v_sess AND user_id = v_uid;
  END IF;
  RETURN jsonb_build_object(
    'name', coalesce(v_name, v_email, v_uid::text),
    'email', v_email,
    'via', CASE WHEN v_name IS NOT NULL THEN 'pin' ELSE 'email' END,
    'session_id', v_sess,
    'user_id', v_uid,
    -- 숫자판 공용 계정인가(이 계정으로 숫자판 로그인이 한 번이라도 있었으면). 기록 보기를 막는 데 씁니다.
    'shared', EXISTS (SELECT 1 FROM public.gps_admin_sessions WHERE user_id = v_uid)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gps_admin_whoami() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gps_admin_whoami() TO authenticated;

-- 운영 쪽 사람인가 - 숫자판 세션, 관리자, 지도 담당, 직원 명부.
-- 손님이 자기 주문·쿠폰을 쓰는 것은 기록하지 않으려고 씁니다.
CREATE OR REPLACE FUNCTION public.gps_admin_is_operator()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sess  uuid;
  v_staff boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  BEGIN
    v_sess := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_sess := NULL;
  END;
  IF (v_sess IS NOT NULL AND EXISTS (SELECT 1 FROM public.gps_admin_sessions WHERE session_id = v_sess))
     OR public.is_scorecard_admin()
     OR public.is_map_editor() THEN
    RETURN true;
  END IF;
  -- 직원 명부(0019)는 실행하지 않은 서버도 있어 있을 때만 봅니다.
  IF to_regclass('public.staff_members') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.staff_members WHERE user_id = $1)' INTO v_staff USING auth.uid();
  END IF;
  RETURN coalesce(v_staff, false);
END;
$$;

REVOKE ALL ON FUNCTION public.gps_admin_is_operator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gps_admin_is_operator() TO authenticated;

-- ----------------------------------------------------------------------------
-- 쓰기 기록 트리거
-- ----------------------------------------------------------------------------
-- 기록이 실패해도 원래 저장은 막지 않습니다(EXCEPTION 에서 조용히 넘어감).
CREATE OR REPLACE FUNCTION public.gps_admin_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_who  jsonb;
  v_old  jsonb;
  v_new  jsonb;
  v_row  jsonb;
  v_diff jsonb;
  v_key  text;
BEGIN
  BEGIN
    IF auth.uid() IS NULL OR NOT public.gps_admin_is_operator() THEN
      RETURN NULL;
    END IF;

    IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
    v_row := coalesce(v_new, v_old);

    v_key := CASE
      WHEN TG_TABLE_NAME IN ('hole_edits', 'holes', 'cart_paths') AND v_row ? 'hole_number'
        THEN 'hole ' || (v_row ->> 'hole_number')
      ELSE coalesce(v_row ->> 'id', v_row ->> 'key', v_row ->> 'code', v_row ->> 'user_id')
    END;

    IF TG_OP = 'UPDATE' THEN
      SELECT coalesce(jsonb_object_agg(n.key, jsonb_build_array(v_old -> n.key, n.value)), '{}'::jsonb)
        INTO v_diff
        FROM jsonb_each(v_new) n
       WHERE n.value IS DISTINCT FROM v_old -> n.key
         AND n.key NOT IN ('updated_at');
      IF v_diff = '{}'::jsonb THEN
        RETURN NULL;
      END IF;
    ELSE
      v_diff := v_row;
    END IF;

    -- 드론 경로처럼 큰 값은 바뀐 열 이름만 남깁니다.
    IF octet_length(v_diff::text) > 8000 THEN
      v_diff := jsonb_build_object(
        '_truncated', true,
        'columns', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_diff) k)
      );
    END IF;

    v_who := public.gps_admin_whoami();
    INSERT INTO public.gps_admin_log (actor, actor_email, user_id, session_id, via, action, target, row_key, detail)
    VALUES (
      v_who ->> 'name',
      v_who ->> 'email',
      auth.uid(),
      nullif(v_who ->> 'session_id', '')::uuid,
      v_who ->> 'via',
      lower(TG_OP),
      TG_TABLE_NAME,
      v_key,
      v_diff
    );
  EXCEPTION WHEN others THEN
    RAISE WARNING 'gps_admin_audit skipped on %: %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- 운영 화면과 직원 화면(/fnb, /checkin)이 쓰는 표. 없는 표는 건너뜁니다.
-- 선수 위치·푸시 구독·배너 노출 수처럼 손님 폰이 계속 쓰는 표는 넣지 않습니다.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'promotions', 'push_campaigns', 'hole_edits', 'cart_paths', 'app_settings',
    'food_orders', 'menu_items', 'staff_members', 'scorecard_admins', 'map_editors',
    'coupon_books', 'coupon_entries', 'coupon_referrals', 'checkin_tags', 'nfc_checkins',
    'gps_profiles', 'holes', 'courses'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '% 표가 없어 건너뜁니다.', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS gps_admin_audit ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER gps_admin_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.gps_admin_audit()', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 화면이 남기는 기록(로그인, 로그아웃, 운영 화면 열기)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gps_admin_log_event(p_action text, p_target text DEFAULT NULL, p_detail jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_who jsonb;
BEGIN
  IF NOT public.gps_admin_is_operator() THEN
    RETURN;
  END IF;
  IF p_action IS NULL OR p_action !~ '^[a-z_]{1,40}$' THEN
    RAISE EXCEPTION 'bad action' USING ERRCODE = '22023';
  END IF;
  v_who := public.gps_admin_whoami();
  INSERT INTO public.gps_admin_log (actor, actor_email, user_id, session_id, via, action, target, detail)
  VALUES (
    v_who ->> 'name', v_who ->> 'email', auth.uid(), nullif(v_who ->> 'session_id', '')::uuid,
    v_who ->> 'via', p_action, left(p_target, 80),
    CASE WHEN p_detail IS NULL OR octet_length(p_detail::text) > 2000 THEN NULL ELSE p_detail END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gps_admin_log_event(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gps_admin_log_event(text, text, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 기록 보기 - 이메일로 들어온 관리자·지도 담당만
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gps_admin_log_access()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.gps_admin_sessions WHERE user_id = auth.uid()) THEN
    RETURN false;   -- 숫자판 공용 계정
  END IF;
  RETURN public.is_scorecard_admin() OR public.is_map_editor();
END;
$$;

REVOKE ALL ON FUNCTION public.gps_admin_log_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gps_admin_log_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.gps_admin_log_list(
  p_limit  integer DEFAULT 100,
  p_before bigint DEFAULT NULL,
  p_actor  text DEFAULT NULL
)
RETURNS SETOF public.gps_admin_log
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.gps_admin_log_access() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT *
      FROM public.gps_admin_log l
     WHERE (p_before IS NULL OR l.id < p_before)
       AND (p_actor IS NULL OR p_actor = '' OR l.actor ILIKE '%' || p_actor || '%' OR l.actor_email ILIKE '%' || p_actor || '%')
     ORDER BY l.id DESC
     LIMIT least(greatest(coalesce(p_limit, 100), 1), 500);
END;
$$;

REVOKE ALL ON FUNCTION public.gps_admin_log_list(integer, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gps_admin_log_list(integer, bigint, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- Vercel 함수(/api/admin/pin-login)만 부르는 함수 - 비밀값이 맞아야 합니다
-- ----------------------------------------------------------------------------

-- 이 주소에서 10분 안에 틀린 번호가 10번이면 false.
CREATE OR REPLACE FUNCTION public.gps_admin_pin_gate(p_secret text, p_ip text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_secret IS DISTINCT FROM (SELECT secret FROM public.gps_admin_secret WHERE id) THEN
    RAISE EXCEPTION 'bad secret' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT count(*) < 10
      FROM public.gps_admin_log
     WHERE action = 'login_failed'
       AND ip IS NOT DISTINCT FROM p_ip
       AND at > now() - interval '10 minutes'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gps_admin_pin_gate(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gps_admin_pin_gate(text, text) TO anon, authenticated;

-- 숫자판 결과 적기. 맞으면 세션 → 이름을 남기고 'login', 틀리면 'login_failed'(번호는 적지 않습니다 -
-- 직원 ID 는 Pelham Shift 의 로그인 비밀번호이기도 합니다).
CREATE OR REPLACE FUNCTION public.gps_admin_pin_record(
  p_secret  text,
  p_ok      boolean,
  p_session uuid,
  p_user    uuid,
  p_name    text,
  p_ip      text,
  p_ua      text,
  p_reason  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
BEGIN
  IF p_secret IS DISTINCT FROM (SELECT secret FROM public.gps_admin_secret WHERE id) THEN
    RAISE EXCEPTION 'bad secret' USING ERRCODE = '42501';
  END IF;

  IF p_ok THEN
    IF p_session IS NULL OR p_user IS NULL OR coalesce(trim(p_name), '') = '' THEN
      RAISE EXCEPTION 'session, user and name are required' USING ERRCODE = '22023';
    END IF;
    SELECT email INTO v_email FROM auth.users WHERE id = p_user;
    INSERT INTO public.gps_admin_sessions (session_id, user_id, staff_name, ip, user_agent)
    VALUES (p_session, p_user, left(trim(p_name), 80), left(p_ip, 64), left(p_ua, 200))
    ON CONFLICT (session_id) DO UPDATE SET staff_name = EXCLUDED.staff_name;
    INSERT INTO public.gps_admin_log (actor, actor_email, user_id, session_id, via, action, target, ip, detail)
    VALUES (left(trim(p_name), 80), v_email, p_user, p_session, 'pin', 'login', 'admin', left(p_ip, 64),
            jsonb_build_object('user_agent', left(p_ua, 200)));
  ELSE
    INSERT INTO public.gps_admin_log (actor, via, action, target, ip, detail)
    VALUES (coalesce(nullif(left(trim(p_name), 80), ''), '(알 수 없는 번호)'), 'server', 'login_failed', 'admin',
            left(p_ip, 64), jsonb_build_object('reason', left(p_reason, 80), 'user_agent', left(p_ua, 200)));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.gps_admin_pin_record(text, boolean, uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gps_admin_pin_record(text, boolean, uuid, uuid, text, text, text, text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 숫자판 공용 계정을 운영 관리자로 - 배너·주문·메뉴·플레이어 탭이 열리게
-- ----------------------------------------------------------------------------
-- 클럽 어드민 0128 표의 pin_email 을 따릅니다(없으면 staff@pelhamhills.ca).
-- 코스 지도·드론 경로는 이 계정에 주지 않습니다 - 아래에서 map_editors 를 analysis@ 하나로 맞춥니다.
DO $$
DECLARE
  v_email text := 'staff@pelhamhills.ca';
BEGIN
  IF to_regclass('public.pelham_staff_lock_settings') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(min(pin_email), $1) FROM public.pelham_staff_lock_settings' INTO v_email USING v_email;
  END IF;
  INSERT INTO public.scorecard_admins (user_id)
  SELECT id FROM auth.users WHERE lower(email) = lower(v_email)
  ON CONFLICT (user_id) DO NOTHING;
END $$;

-- 코스 지도 수정은 analysis@pelhamhills.ca 하나만 (0030 과 같은 문장)
INSERT INTO public.map_editors (user_id)
SELECT id FROM auth.users WHERE lower(email) = 'analysis@pelhamhills.ca'
ON CONFLICT (user_id) DO NOTHING;

DELETE FROM public.map_editors
 WHERE user_id NOT IN (SELECT id FROM auth.users WHERE lower(email) = 'analysis@pelhamhills.ca');

NOTIFY pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- 결과 - 한 줄. 마지막 칸의 값을 Vercel 환경 변수 GPS_ADMIN_LOG_SECRET 에 넣으세요.
-- ----------------------------------------------------------------------------
SELECT
  (SELECT string_agg(u.email, ', ') FROM public.map_editors m JOIN auth.users u ON u.id = m.user_id) AS 지도_수정_계정,
  (SELECT string_agg(u.email, ', ') FROM public.scorecard_admins a JOIN auth.users u ON u.id = a.user_id
     WHERE lower(u.email) LIKE 'staff@%') AS 숫자판_공용계정_관리자,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'gps_admin_audit') AS 기록_트리거_수,
  (SELECT secret FROM public.gps_admin_secret WHERE id) AS vercel_env_GPS_ADMIN_LOG_SECRET;
