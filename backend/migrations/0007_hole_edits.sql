-- ============================================================================
-- 0007 코스 지도 수정 공유 (홀 점선과 홀 번호 → 모든 폰) + 앱 설정
-- ============================================================================
--
-- 두 가지를 만듭니다: hole_edits (아래) 와 app_settings (맨 아래, 고객 전체 맵을
-- 신시스템/현시스템 중 무엇으로 보여 줄지).
--
-- /admin/map 에서 고친 홀 점선(꺾이는 점)과 번호 바꾸기를 서버에 두어,
-- 모든 선수의 폰 지도에 같은 선이 보이게 합니다. 전에는 고친 브라우저에만
-- 저장되어 다른 폰에서는 보이지 않았습니다.
--
-- 0006_scorecards.sql 을 먼저 실행해야 합니다 - 누가 고칠 수 있는지를
-- 0006 의 관리자 표(scorecard_admins)와 is_scorecard_admin() 으로 정합니다.
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다.
--
-- 한 행 = 한 홀의 최종 모습 ("2번 홀은 여기"). 앱의 HolePath 와 같은 모양:
--   waypoints = [[위도, 경도], ...] 티 쪽부터, 빈 배열이면 직선
--   tee / pin = [위도, 경도] - 번호를 바꾼 홀에만 있습니다
--   length    = 티에서 핀까지 미터 - 번호를 바꾼 홀에만 있습니다
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hole_edits (
  course_id   text NOT NULL,
  hole_number int  NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  waypoints   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(waypoints) = 'array'),
  tee         jsonb,
  pin         jsonb,
  length      numeric,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid DEFAULT auth.uid(),
  PRIMARY KEY (course_id, hole_number)
);

ALTER TABLE public.hole_edits ENABLE ROW LEVEL SECURITY;

-- 선수 폰은 로그인 없이 읽습니다. 지도에 그리는 선일 뿐 개인 정보가 없습니다.
DROP POLICY IF EXISTS "hole_edits_read_all" ON public.hole_edits;
CREATE POLICY "hole_edits_read_all" ON public.hole_edits
  FOR SELECT TO anon, authenticated
  USING (true);

-- 고치는 것은 관리자 계정만.
DROP POLICY IF EXISTS "hole_edits_insert_admin" ON public.hole_edits;
CREATE POLICY "hole_edits_insert_admin" ON public.hole_edits
  FOR INSERT TO authenticated
  WITH CHECK (public.is_scorecard_admin());

DROP POLICY IF EXISTS "hole_edits_update_admin" ON public.hole_edits;
CREATE POLICY "hole_edits_update_admin" ON public.hole_edits
  FOR UPDATE TO authenticated
  USING (public.is_scorecard_admin())
  WITH CHECK (public.is_scorecard_admin());

DROP POLICY IF EXISTS "hole_edits_delete_admin" ON public.hole_edits;
CREATE POLICY "hole_edits_delete_admin" ON public.hole_edits
  FOR DELETE TO authenticated
  USING (public.is_scorecard_admin());

REVOKE ALL ON public.hole_edits FROM anon;
GRANT SELECT ON public.hole_edits TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hole_edits TO authenticated;

-- ============================================================================
-- 앱 설정 (관리자가 고르고 모든 폰이 따르는 값)
-- ============================================================================
-- 지금 쓰는 키:
--   full_map = "satellite" (신시스템 지도: 위성 사진 + 점선)
--            | "printed"   (현시스템 지도: 클럽 코스 안내도)
-- 행이 없으면 앱은 "printed"(현시스템 지도)를 기본으로 보여 줍니다.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_read_all" ON public.app_settings;
CREATE POLICY "app_settings_read_all" ON public.app_settings
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "app_settings_insert_admin" ON public.app_settings;
CREATE POLICY "app_settings_insert_admin" ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_scorecard_admin());

DROP POLICY IF EXISTS "app_settings_update_admin" ON public.app_settings;
CREATE POLICY "app_settings_update_admin" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.is_scorecard_admin())
  WITH CHECK (public.is_scorecard_admin());

DROP POLICY IF EXISTS "app_settings_delete_admin" ON public.app_settings;
CREATE POLICY "app_settings_delete_admin" ON public.app_settings
  FOR DELETE TO authenticated
  USING (public.is_scorecard_admin());

REVOKE ALL ON public.app_settings FROM anon;
GRANT SELECT ON public.app_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
