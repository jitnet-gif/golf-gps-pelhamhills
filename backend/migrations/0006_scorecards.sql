-- ============================================================================
-- 0006 스코어카드 (계정별 저장, 날짜별 조회, 관리자 전체 조회)
-- ============================================================================
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다(IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
--
-- 0001 의 rounds / scores 를 쓰지 않는 이유:
--   그 두 테이블은 배포되지 않은 Worker API 를 전제로 짜여 있습니다.
--   rounds 에는 INSERT 정책이 없고, 동반자를 계정(UUID)으로만 받으며,
--   scores 는 holes 테이블의 UUID 를 요구합니다. 계정이 없는 동반자 이름을
--   카드에 적는 지금의 방식과 맞지 않아, 카드 한 장 = 한 행으로 새로 둡니다.
--
-- 카드 한 장(한 행):
--   players = [{ "name": "홍길동", "scores": [4,5,null, ... 18칸] }, ...] 최대 4명
--   첫 번째 선수가 계정 주인입니다. 동반자는 이름만 적습니다.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.scorecards (
  -- 앱이 오프라인에서 먼저 만들고 나중에 올리므로 id 는 앱이 정합니다.
  id          uuid PRIMARY KEY,
  owner_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  -- 관리자 목록에서 누구의 카드인지 보이도록 올릴 때의 로그인 이메일을 남깁니다.
  owner_email text DEFAULT (auth.jwt() ->> 'email'),
  course_id   text NOT NULL,
  played_on   date NOT NULL,
  tee_set     text NOT NULL,
  players     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scorecards_players_shape CHECK (
    jsonb_typeof(players) = 'array'
    AND jsonb_array_length(players) BETWEEN 1 AND 4
  )
);

CREATE INDEX IF NOT EXISTS scorecards_owner_played_on
  ON public.scorecards (owner_id, played_on DESC);
CREATE INDEX IF NOT EXISTS scorecards_played_on
  ON public.scorecards (played_on DESC);

-- 관리자 = 이 표에 계정이 올라 있는 사람. 이메일이 아니라 계정 id 로 둡니다:
-- 이메일 확인을 끈 상태에서는 누구든 아무 이메일로 가입할 수 있으므로,
-- "이 이메일이면 관리자" 로 두면 관리자 주소를 먼저 가입한 사람이 관리자가 됩니다.
CREATE TABLE IF NOT EXISTS public.scorecard_admins (
  user_id  uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now()
);

-- 정책 안에서 관리자 표를 읽기 위한 함수. scorecard_admins 는 누구에게도
-- 공개하지 않으므로 SECURITY DEFINER 로 이 함수만 읽게 합니다.
CREATE OR REPLACE FUNCTION public.is_scorecard_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.scorecard_admins WHERE user_id = auth.uid()
  );
$$;

ALTER TABLE public.scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scorecard_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scorecards_select_own_or_admin" ON public.scorecards;
CREATE POLICY "scorecards_select_own_or_admin" ON public.scorecards
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_scorecard_admin());

DROP POLICY IF EXISTS "scorecards_insert_own" ON public.scorecards;
CREATE POLICY "scorecards_insert_own" ON public.scorecards
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- 관리자는 보기만 합니다. 고치고 지우는 것은 카드 주인만.
DROP POLICY IF EXISTS "scorecards_update_own" ON public.scorecards;
CREATE POLICY "scorecards_update_own" ON public.scorecards
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "scorecards_delete_own" ON public.scorecards;
CREATE POLICY "scorecards_delete_own" ON public.scorecards
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- anon(로그인 안 한 사람)에게는 아무 권한도 주지 않습니다.
REVOKE ALL ON public.scorecards FROM anon;
REVOKE ALL ON public.scorecard_admins FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scorecards TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_scorecard_admin() TO authenticated;

-- ============================================================================
-- 관리자 지정 (앱에서 관리자 이메일로 먼저 가입한 뒤 실행하세요)
-- ============================================================================
-- 아래 두 줄의 맨 앞 -- 를 지우고, 이메일을 관리자 주소로 바꿔 Run 합니다.
-- 가입하지 않은 이메일이면 아무것도 추가되지 않습니다(0 rows).
--
-- INSERT INTO public.scorecard_admins (user_id)
-- SELECT id FROM auth.users WHERE email = '관리자이메일@example.com' ON CONFLICT DO NOTHING;
