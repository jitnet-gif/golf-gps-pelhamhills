-- ============================================================================
-- 0014 플레이어 모니터 (프로 샵에서 코스 위의 손님이 보이도록)
-- ============================================================================
--
-- 손님 폰이 몇 십 초에 한 번 자기 자리를 올리고, /admin > 플레이어 에서
-- 그 자리를 지도 위에 보여 줍니다. 클럽이 "지금 14번에 누가 있나"를
-- 무전기 없이 아는 것이 목적입니다.
--
-- 먼저 실행해야 하는 것:
--   0006_scorecards.sql  - is_scorecard_admin() 함수. 없으면 이 파일은
--                          아무것도 하지 않고 조용히 끝납니다(아래 DO 블록).
--                          관리자가 누구인지는 그 파일의 scorecard_admins 가
--                          정하고, 이 표도 같은 기준을 씁니다.
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다(IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
--
-- ----------------------------------------------------------------------------
-- 왜 표에 직접 쓰지 않고 함수를 거치는가
-- ----------------------------------------------------------------------------
-- 라운드 중인 손님은 대개 로그인하지 않았습니다(스코어카드를 쓸 때만 계정이
-- 필요합니다). 그래서 쓰기는 anon 키로 들어오는데, 표에 anon INSERT 를 열면
-- 그 표는 아무나 쓰는 표가 됩니다. 앱에 들어 있는 publishable 키는 누구나
-- 꺼내 볼 수 있습니다.
--
-- 그래서 쓰기는 report_player_position() 하나로만 하고, 그 안에서 두 가지를
-- 막습니다:
--   1. 코스 근처가 아닌 좌표는 버립니다.
--   2. 같은 기기가 10 초 안에 또 올리면 버립니다.
-- 읽기는 관리자만 됩니다.
--
-- ----------------------------------------------------------------------------
-- 남는 것과 지워지는 것
-- ----------------------------------------------------------------------------
-- 기기 하나에 줄 하나입니다. 자취(지나온 길)를 쌓지 않습니다 - 프로 샵이
-- 알고 싶은 것은 "지금 어디"이고, 하루치 이동 경로는 필요하지도 않은 데다
-- 남겨 둘 이유도 없습니다. 6 시간이 지난 줄은 다음 보고가 들어올 때 지워
-- 집니다(라운드는 4~5 시간이면 끝납니다).
-- ============================================================================

DO $monitor$
BEGIN

IF to_regprocedure('public.is_scorecard_admin()') IS NULL THEN
  RAISE NOTICE 'is_scorecard_admin() 이 없습니다. 0006_scorecards.sql 을 먼저 실행하세요.';
  RETURN;
END IF;

CREATE TABLE IF NOT EXISTS public.player_positions (
  -- 폰이 정하는 아이디입니다(localStorage). 계정이 아니라 기기라서, 로그인
  -- 하지 않은 손님도 한 줄을 차지합니다. 한 기기 = 한 줄이라 PK 입니다.
  device_id   text PRIMARY KEY,
  course_id   text NOT NULL,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  -- 폰이 말하는 오차 반경(m). 지도에서 점을 믿을지 말지의 근거라 같이 둡니다.
  accuracy    real,
  -- 화면에 떠 있는 홀. 좌표만으로도 짐작은 되지만, 앱이 이미 알고 있는 답을
  -- 프로 샵이 다시 계산할 이유가 없습니다.
  hole_number smallint,
  -- 누구인지. 스코어카드 첫 줄의 이름이고, 카드를 안 쓰면 비어 있습니다.
  player_name text,
  -- 로그인한 손님이면 그 이메일. 이름이 없을 때 프로 샵이 잡을 수 있는 끈.
  player_email text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_positions_lat CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT player_positions_lng CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT player_positions_hole CHECK (hole_number IS NULL OR hole_number BETWEEN 1 AND 18)
);

-- 관리자 화면은 "최근 것부터, 오래된 것 빼고"로만 읽습니다.
CREATE INDEX IF NOT EXISTS player_positions_updated_at
  ON public.player_positions (updated_at DESC);

ALTER TABLE public.player_positions ENABLE ROW LEVEL SECURITY;

-- 읽기는 관리자만. 쓰기 정책은 일부러 하나도 두지 않습니다 - 쓰기는 아래
-- 함수(SECURITY DEFINER)를 통해서만 들어옵니다.
DROP POLICY IF EXISTS "player_positions_admin_read" ON public.player_positions;
CREATE POLICY "player_positions_admin_read" ON public.player_positions
  FOR SELECT TO authenticated
  USING (public.is_scorecard_admin());

-- 관리자가 화면에서 줄을 지울 수 있게(라운드가 끝난 카트가 남아 있을 때).
DROP POLICY IF EXISTS "player_positions_admin_delete" ON public.player_positions;
CREATE POLICY "player_positions_admin_delete" ON public.player_positions
  FOR DELETE TO authenticated
  USING (public.is_scorecard_admin());

END
$monitor$;

-- ----------------------------------------------------------------------------
-- 손님 폰이 부르는 함수
-- ----------------------------------------------------------------------------
-- 성공하면 true, 버려졌으면 false 를 줍니다. 폰은 이 답으로 아무것도 하지
-- 않습니다 - 라운드 중에 "위치 전송 실패" 를 띄우는 것은 손님에게 아무
-- 의미가 없습니다. 답을 주는 것은 나중에 사람이 SQL 로 확인할 때를 위해서입니다.
CREATE OR REPLACE FUNCTION public.report_player_position(
  p_device_id   text,
  p_course_id   text,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy    real          DEFAULT NULL,
  p_hole_number smallint      DEFAULT NULL,
  p_player_name text          DEFAULT NULL,
  p_player_email text         DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- 펠럼 힐스 18 홀을 넉넉히(약 1 km) 둘러싼 네모. 담장이 아니라 체입니다 -
  -- 주차장과 클럽하우스도 이 안이고, 지구 반대편 좌표만 걸러 냅니다.
  -- 코스가 늘거나 다른 골프장이 붙으면 여기를 넓히세요.
  min_lat constant double precision := 42.970;
  max_lat constant double precision := 42.995;
  min_lng constant double precision := -79.315;
  max_lng constant double precision := -79.285;
  last_seen timestamptz;
BEGIN
  IF p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 8 AND 64 THEN
    RETURN false;
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN false;
  END IF;

  IF p_latitude NOT BETWEEN min_lat AND max_lat
     OR p_longitude NOT BETWEEN min_lng AND max_lng THEN
    RETURN false;
  END IF;

  -- 같은 기기의 도배를 막습니다. 앱은 30 초에 한 번 올리므로 10 초는
  -- 정상 동작을 건드리지 않습니다.
  SELECT updated_at INTO last_seen
    FROM public.player_positions WHERE device_id = p_device_id;
  IF last_seen IS NOT NULL AND last_seen > now() - interval '10 seconds' THEN
    RETURN false;
  END IF;

  INSERT INTO public.player_positions AS pp (
    device_id, course_id, latitude, longitude, accuracy,
    hole_number, player_name, player_email, updated_at
  )
  VALUES (
    p_device_id, coalesce(p_course_id, 'pelham-hills'), p_latitude, p_longitude, p_accuracy,
    p_hole_number, nullif(btrim(coalesce(p_player_name, '')), ''),
    nullif(btrim(coalesce(p_player_email, '')), ''), now()
  )
  ON CONFLICT (device_id) DO UPDATE SET
    course_id    = EXCLUDED.course_id,
    latitude     = EXCLUDED.latitude,
    longitude    = EXCLUDED.longitude,
    accuracy     = EXCLUDED.accuracy,
    hole_number  = EXCLUDED.hole_number,
    -- 이름과 이메일은 한번 들어오면 빈 값으로 덮지 않습니다. 카드를 뒤늦게
    -- 쓰기 시작한 손님의 이름이, 다음 보고 한 번에 다시 사라지면 안 됩니다.
    player_name  = coalesce(EXCLUDED.player_name, pp.player_name),
    player_email = coalesce(EXCLUDED.player_email, pp.player_email),
    updated_at   = now();

  -- 지나간 라운드 치우기. 보고가 들어올 때만 도니 따로 돌릴 일이 없습니다.
  DELETE FROM public.player_positions
   WHERE updated_at < now() - interval '6 hours';

  RETURN true;
END;
$$;

-- 로그인하지 않은 손님이 대부분이라 anon 에게도 줍니다. 위의 두 가지 검사가
-- 이 권한의 값입니다.
GRANT EXECUTE ON FUNCTION public.report_player_position(
  text, text, double precision, double precision, real, smallint, text, text
) TO anon, authenticated;
