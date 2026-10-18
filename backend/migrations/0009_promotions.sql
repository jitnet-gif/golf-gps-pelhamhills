-- ============================================================================
-- 0009 배너 + 배너 성과 (관리자 계정으로 관리)
-- ============================================================================
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다. 0006(관리자 표 scorecard_admins)이 먼저 있어야 합니다.
--
-- 0003/0004 의 promotions, promotion_events 를 이 파일이 대신합니다. 그 두 파일은
-- 배포되지 않은 Worker(service_role) 를 전제로 쓰기 권한을 아무에게도 주지 않아,
-- 실행해도 관리 화면에서 배너를 올릴 수 없었습니다. 여기서는 0006·0007 과 같은
-- 방식입니다: 관리자 계정이 앱에서 직접 쓰고, 고객 폰은 지금 걸린 배너만 읽습니다.
-- (예약 발송 표는 0010 에 따로 있습니다.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 배너
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.promotions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      varchar(120) NOT NULL,
  body       varchar(300),
  -- 배너 이미지와 누르면 열 주소. 둘 다 선택입니다.
  image_url  text,
  link_url   text,
  -- 앱 안에서 배너가 나갈 자리. 코스 지도 화면에는 넣지 않습니다 - 플레이 중
  -- 거리와 지도를 가리는 배너는 이 앱을 쓰는 이유를 깎아 먹습니다.
  placement  varchar(20) NOT NULL DEFAULT 'home' CHECK (placement IN ('home', 'scorecard')),
  -- 같은 자리에 여러 개면 높은 값이 먼저 나옵니다.
  priority   integer NOT NULL DEFAULT 0,
  -- 노출 기간. starts_at 이 비면 즉시, ends_at 이 비면 무기한.
  starts_at  timestamptz,
  ends_at    timestamptz,
  -- 기간과 따로 노는 스위치. 기간을 건드리지 않고 잠시 내릴 때 씁니다.
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotions_window_valid
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_promotions_placement ON public.promotions (placement, priority DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promotions_updated_at ON public.promotions;
CREATE TRIGGER trg_promotions_updated_at
  BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

-- 고객 폰(로그인 없음)은 지금 노출 중인 배너만 봅니다. 다음 주에 걸 배너가
-- 공개 키로 미리 새어 나가지 않습니다.
DROP POLICY IF EXISTS "promotions_read_live" ON public.promotions;
CREATE POLICY "promotions_read_live" ON public.promotions
  FOR SELECT TO anon, authenticated
  USING (
    active
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at > now())
  );

-- 관리자는 내려간 것·예정된 것까지 전부 보고 고칩니다.
DROP POLICY IF EXISTS "promotions_admin_read" ON public.promotions;
CREATE POLICY "promotions_admin_read" ON public.promotions
  FOR SELECT TO authenticated
  USING (public.is_scorecard_admin());

DROP POLICY IF EXISTS "promotions_admin_insert" ON public.promotions;
CREATE POLICY "promotions_admin_insert" ON public.promotions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_scorecard_admin());

DROP POLICY IF EXISTS "promotions_admin_update" ON public.promotions;
CREATE POLICY "promotions_admin_update" ON public.promotions
  FOR UPDATE TO authenticated
  USING (public.is_scorecard_admin())
  WITH CHECK (public.is_scorecard_admin());

DROP POLICY IF EXISTS "promotions_admin_delete" ON public.promotions;
CREATE POLICY "promotions_admin_delete" ON public.promotions
  FOR DELETE TO authenticated
  USING (public.is_scorecard_admin());

-- 정책은 "어느 행"만 정하고, 표에 손댈 수 있는지는 GRANT 가 정합니다.
-- 쓰기 GRANT 가 빠지면 관리자 정책이 맞아도 저장이 "permission denied" 로 끝납니다.
REVOKE ALL ON public.promotions FROM anon, authenticated;
GRANT SELECT ON public.promotions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.promotions TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. 배너 성과 기록 (보임 / 누름 / 닫음)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.promotion_events (
  id           bigserial PRIMARY KEY,
  promotion_id uuid NOT NULL REFERENCES public.promotions (id) ON DELETE CASCADE,
  -- 익명 기기 ID. 사람이 아니라 폰 단위입니다.
  device_id    varchar(64) NOT NULL,
  event_type   varchar(20) NOT NULL CHECK (event_type IN ('impression', 'click', 'dismiss')),
  placement    varchar(20) NOT NULL CHECK (placement IN ('home', 'scorecard')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotion_events_promotion
  ON public.promotion_events (promotion_id, event_type);

-- 같은 폰이 같은 배너를 하루에 몇 번 열어도 "보임"은 한 번입니다. 앱을 자주 켜는
-- 한 사람이 숫자를 좌우하면 누른 비율이 의미를 잃습니다. 하루는 클럽이 있는
-- 온타리오 날짜로 끊습니다. 누름·닫음은 행동이라 그대로 쌓습니다.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_promotion_impression_per_day
  ON public.promotion_events (promotion_id, device_id, ((created_at AT TIME ZONE 'America/Toronto')::date))
  WHERE event_type = 'impression';

-- 정책 없음 + GRANT 없음 = 표를 직접은 아무도 못 봅니다. 기록은 아래
-- record_promotion_events 로만 들어가고, 합계는 promotion_stats 로만 나옵니다.
ALTER TABLE public.promotion_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotion_events FROM anon, authenticated;

-- 고객 폰이 모아 둔 기록을 한 번에 넣습니다. 한 번에 최대 50건, 없는 배너나
-- 모르는 종류는 조용히 버립니다. 공개 키로 부를 수 있으니 누구든 숫자를 조금
-- 부풀릴 수는 있지만(서버를 거쳐도 마찬가지입니다), 배너를 바꾸거나 남의 기록을
-- 읽을 수는 없습니다.
CREATE OR REPLACE FUNCTION public.record_promotion_events(p_device_id text, p_events jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inserted integer;
BEGIN
  IF p_device_id IS NULL
     OR length(p_device_id) NOT BETWEEN 8 AND 64
     OR p_events IS NULL
     OR jsonb_typeof(p_events) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO public.promotion_events (promotion_id, device_id, event_type, placement)
  SELECT p.id, p_device_id, ev.e ->> 'event_type', ev.e ->> 'placement'
  FROM (SELECT value AS e FROM jsonb_array_elements(p_events) LIMIT 50) AS ev
  JOIN public.promotions p ON p.id::text = ev.e ->> 'promotion_id'
  WHERE ev.e ->> 'event_type' IN ('impression', 'click', 'dismiss')
    AND ev.e ->> 'placement' IN ('home', 'scorecard')
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.record_promotion_events(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_promotion_events(text, jsonb) TO anon, authenticated;

-- 배너별 합계. 관리자만 봅니다 - 어떤 배너가 안 먹혔는지는 대외 정보가 아닙니다.
-- 뷰가 아니라 함수인 이유: 뷰는 만든 사람 권한으로 돌아 로그인한 누구에게나
-- 숫자가 보이고, 함수는 관리자가 아니면 이유를 담아 거절할 수 있습니다.
CREATE OR REPLACE FUNCTION public.promotion_stats()
RETURNS TABLE (
  promotion_id   uuid,
  title          text,
  placement      text,
  active         boolean,
  starts_at      timestamptz,
  ends_at        timestamptz,
  impressions    bigint,
  clicks         bigint,
  dismissals     bigint,
  click_rate_pct numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_scorecard_admin() THEN
    RAISE EXCEPTION 'promotion_stats: admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.title::text,
    p.placement::text,
    p.active,
    p.starts_at,
    p.ends_at,
    count(ev.id) FILTER (WHERE ev.event_type = 'impression'),
    count(ev.id) FILTER (WHERE ev.event_type = 'click'),
    count(ev.id) FILTER (WHERE ev.event_type = 'dismiss'),
    -- 보인 적이 없으면 비율은 "아직 모름"(NULL)이지 0% 가 아닙니다.
    round(
      100.0 * count(ev.id) FILTER (WHERE ev.event_type = 'click')
        / NULLIF(count(ev.id) FILTER (WHERE ev.event_type = 'impression'), 0),
      1
    )
  FROM public.promotions p
  LEFT JOIN public.promotion_events ev ON ev.promotion_id = p.id
  GROUP BY p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.promotion_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promotion_stats() TO authenticated;
