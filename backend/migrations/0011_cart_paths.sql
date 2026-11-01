-- ============================================================================
-- 0011 카트 길 (관리자가 카트로 달리며 녹화한 길 → 모든 폰의 카트 네비게이션)
-- ============================================================================
--
-- /admin/map 의 '카트 길 녹화' 로 저장한 길입니다. 선수 폰의 카트 네비게이션
-- (Hole out → 목적지)이 OpenStreetMap 의 카트 길과 함께 이 길을 따라 안내합니다.
-- OSM 길은 조각나 있어서(20조각, 13~15번 홀 주변은 없음), 실제로 달린 길이
-- 쌓일수록 직선(점선) 구간이 줄어듭니다.
--
-- 0006_scorecards.sql 을 먼저 실행해야 합니다 - 누가 저장할 수 있는지를
-- 0006 의 관리자 표(scorecard_admins)와 is_scorecard_admin() 으로 정합니다.
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다.
--
-- 이 파일을 실행한 뒤에는 0030_map_editor.sql 도 다시 Run 하세요. 아래의 관리자
-- 정책을 지정된 지도 수정 계정 정책으로 바꿉니다.
--
-- 한 행 = 한 번 녹화한 길 한 줄:
--   points = [[위도, 경도], ...] 달린 순서대로 (앱이 흔들린 점을 걸러 낸 뒤)
--   metres = 길이
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cart_paths (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   text NOT NULL,
  points      jsonb NOT NULL CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) >= 2),
  metres      numeric NOT NULL CHECK (metres > 0),
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS cart_paths_course_idx ON public.cart_paths (course_id);

ALTER TABLE public.cart_paths ENABLE ROW LEVEL SECURITY;

-- 선수 폰은 로그인 없이 읽습니다. 지도에 그리는 길일 뿐 개인 정보가 없습니다.
-- (created_by 는 읽기 목록에서 앱이 가져가지 않습니다.)
DROP POLICY IF EXISTS "cart_paths_read_all" ON public.cart_paths;
CREATE POLICY "cart_paths_read_all" ON public.cart_paths
  FOR SELECT TO anon, authenticated
  USING (true);

-- 저장·삭제는 관리자 계정만. 고치지 않고 지우고 다시 녹화합니다.
DROP POLICY IF EXISTS "cart_paths_insert_admin" ON public.cart_paths;
CREATE POLICY "cart_paths_insert_admin" ON public.cart_paths
  FOR INSERT TO authenticated
  WITH CHECK (public.is_scorecard_admin());

DROP POLICY IF EXISTS "cart_paths_delete_admin" ON public.cart_paths;
CREATE POLICY "cart_paths_delete_admin" ON public.cart_paths
  FOR DELETE TO authenticated
  USING (public.is_scorecard_admin());

REVOKE ALL ON public.cart_paths FROM anon;
GRANT SELECT ON public.cart_paths TO anon;
GRANT SELECT, INSERT, DELETE ON public.cart_paths TO authenticated;
