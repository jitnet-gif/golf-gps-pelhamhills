-- ============================================================================
-- 0030 코스 지도·드론 경로 수정은 지정된 계정 하나만 + 1번 홀 원래 자리로
-- ============================================================================
--
-- 코스 지도 탭과 드론 촬영 탭에서 서버에 쓰는 것을 운영 관리자 전체에서 빼고,
-- map_editors 표에 오른 계정만 쓰게 합니다:
--   hole_edits                홀 티·핀·점선·번호
--   cart_paths                카트 길 녹화
--   app_settings.full_map     고객 전체 맵 종류
--   app_settings.drone_routes 드론 촬영 경로
-- 읽기는 그대로입니다 - 선수 폰은 로그인 없이 지도를 읽습니다.
-- app_settings 의 다른 줄(food_orders 등)은 그대로 관리자가 고칩니다.
--
-- 0006 과 같은 이유로 이메일이 아니라 계정 id 로 둡니다. 이메일 확인을 끈
-- 상태에서는 그 주소를 먼저 가입한 사람이 권한을 가져가기 때문입니다. 계정이
-- 아직 없으면 아무도 고칠 수 없는 상태로 끝납니다 - 가입한 뒤 다시 Run 하세요.
--
-- 0006, 0007 을 먼저 실행해야 합니다. 0011(cart_paths)은 없으면 건너뜁니다.
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다. 맨 아래 표에 지정된 계정이 나옵니다.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.map_editors (
  user_id  uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.map_editors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.map_editors FROM anon, authenticated;

-- is_scorecard_admin() 과 같은 모양입니다. 표는 공개하지 않고 이 함수만 읽습니다.
CREATE OR REPLACE FUNCTION public.is_map_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.map_editors WHERE user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_map_editor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_map_editor() TO authenticated;

INSERT INTO public.map_editors (user_id)
SELECT id FROM auth.users WHERE lower(email) = 'analysis@pelhamhills.ca'
ON CONFLICT (user_id) DO NOTHING;

-- 이 주소 하나만 남깁니다. 앞서 다른 주소로 실행했어도 그 계정의 권한이 빠집니다.
DELETE FROM public.map_editors
 WHERE user_id NOT IN (SELECT id FROM auth.users WHERE lower(email) = 'analysis@pelhamhills.ca');

-- ----------------------------------------------------------------------------
-- hole_edits
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "hole_edits_insert_admin" ON public.hole_edits;
DROP POLICY IF EXISTS "hole_edits_update_admin" ON public.hole_edits;
DROP POLICY IF EXISTS "hole_edits_delete_admin" ON public.hole_edits;
DROP POLICY IF EXISTS "hole_edits_insert_map_editor" ON public.hole_edits;
DROP POLICY IF EXISTS "hole_edits_update_map_editor" ON public.hole_edits;
DROP POLICY IF EXISTS "hole_edits_delete_map_editor" ON public.hole_edits;

CREATE POLICY "hole_edits_insert_map_editor" ON public.hole_edits
  FOR INSERT TO authenticated
  WITH CHECK (public.is_map_editor());

CREATE POLICY "hole_edits_update_map_editor" ON public.hole_edits
  FOR UPDATE TO authenticated
  USING (public.is_map_editor())
  WITH CHECK (public.is_map_editor());

CREATE POLICY "hole_edits_delete_map_editor" ON public.hole_edits
  FOR DELETE TO authenticated
  USING (public.is_map_editor());

-- ----------------------------------------------------------------------------
-- cart_paths
-- ----------------------------------------------------------------------------
-- 0011 을 아직 실행하지 않은 서버에는 표가 없으므로 건너뜁니다. 0011 은 관리자
-- 정책을 다시 만드니, 나중에 0011 을 실행하면 이 파일도 다시 Run 해야 합니다.
DO $$
BEGIN
  IF to_regclass('public.cart_paths') IS NULL THEN
    RAISE NOTICE 'cart_paths 표가 없어 건너뜁니다. 0011 을 실행한 뒤 이 파일을 다시 Run 하세요.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "cart_paths_insert_admin" ON public.cart_paths;
  DROP POLICY IF EXISTS "cart_paths_delete_admin" ON public.cart_paths;
  DROP POLICY IF EXISTS "cart_paths_insert_map_editor" ON public.cart_paths;
  DROP POLICY IF EXISTS "cart_paths_delete_map_editor" ON public.cart_paths;

  CREATE POLICY "cart_paths_insert_map_editor" ON public.cart_paths
    FOR INSERT TO authenticated
    WITH CHECK (public.is_map_editor());

  CREATE POLICY "cart_paths_delete_map_editor" ON public.cart_paths
    FOR DELETE TO authenticated
    USING (public.is_map_editor());
END $$;

-- ----------------------------------------------------------------------------
-- app_settings - full_map·drone_routes 줄만 지도 담당, 나머지는 전처럼 관리자
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "app_settings_insert_admin" ON public.app_settings;
CREATE POLICY "app_settings_insert_admin" ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (CASE WHEN key IN ('full_map', 'drone_routes') THEN public.is_map_editor() ELSE public.is_scorecard_admin() END);

DROP POLICY IF EXISTS "app_settings_update_admin" ON public.app_settings;
CREATE POLICY "app_settings_update_admin" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (CASE WHEN key IN ('full_map', 'drone_routes') THEN public.is_map_editor() ELSE public.is_scorecard_admin() END)
  WITH CHECK (CASE WHEN key IN ('full_map', 'drone_routes') THEN public.is_map_editor() ELSE public.is_scorecard_admin() END);

DROP POLICY IF EXISTS "app_settings_delete_admin" ON public.app_settings;
CREATE POLICY "app_settings_delete_admin" ON public.app_settings
  FOR DELETE TO authenticated
  USING (CASE WHEN key IN ('full_map', 'drone_routes') THEN public.is_map_editor() ELSE public.is_scorecard_admin() END);

-- ----------------------------------------------------------------------------
-- 1번 홀 원래 자리로
-- ----------------------------------------------------------------------------
-- 2026-11-01 에 지도에서 핀이 약 160m 북쪽으로 끌려간 행입니다. 행이 없으면 앱은
-- 코스 데이터(Google Earth 측량, 0022)의 티·핀과 직선으로 돌아갑니다.
-- 그때의 핀일 때만 지웁니다 - 이 파일을 나중에 다시 Run 해도 그 뒤에 고친
-- 1번 홀을 지우지 않습니다.
DELETE FROM public.hole_edits
 WHERE course_id = 'pelham-hills'
   AND hole_number = 1
   AND pin = '[42.986194652780796, -79.29557534854588]'::jsonb;

-- ----------------------------------------------------------------------------
-- 결과 - 한 줄이어야 합니다. 비어 있으면 그 주소로 가입한 계정이 없는 것입니다.
-- ----------------------------------------------------------------------------
SELECT u.email AS 지도_수정_계정,
       to_char(u.created_at AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD HH24:MI') AS 가입,
       u.email_confirmed_at IS NOT NULL AS 이메일_확인됨,
       (SELECT count(*) FROM public.hole_edits
         WHERE course_id = 'pelham-hills' AND hole_number = 1) AS 남은_1번홀_수정
  FROM public.map_editors m
  JOIN auth.users u ON u.id = m.user_id;
