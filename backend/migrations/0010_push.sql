-- ============================================================================
-- 0010 알림(웹 푸시) 구독 + 예약 발송
-- ============================================================================
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다. 먼저 필요한 것은 0006(관리자) 하나뿐입니다 -
-- 0009(배너)는 있으면 연결하고, 없으면 그 칸만 비워 두고 갑니다(아래 2절).
--
-- 흐름
--   1. 고객 폰이 알림을 켜면 push_subscribe 로 구독을 남깁니다(공개 키로 부름).
--   2. 관리자가 앱에서 push_campaigns 에 예약을 넣습니다.
--   3. pg_cron 이 1분마다 push_dispatch_due() 를 돌립니다. 보낼 때가 된 예약이
--      있을 때만 그 예약에 일회용 토큰을 붙여 앱 서버(/api/push/dispatch)를
--      한 번 부릅니다. 보낼 것이 없는 1분은 아무 통신도 하지 않습니다.
--   4. 앱 서버는 그 토큰으로 push_campaign_batch 에서 내용과 받을 폰 목록을 받아
--      보내고, push_campaign_report 로 결과를 적습니다. 결과를 적으면 토큰은
--      사라집니다.
--
-- 이렇게 한 이유: 구독 정보(폰 주소와 암호 키)는 공개 키로 절대 읽히면 안 됩니다.
-- 앱 서버에 데이터베이스 마스터 키(service_role)를 넣어 두는 대신, 데이터베이스가
-- 발송 한 건마다 그 건만 열 수 있는 토큰을 건넵니다. 토큰 없이는 아무것도 안 나옵니다.
-- ============================================================================

-- 1분마다 깨우는 시계(pg_cron)와, 데이터베이스가 앱 서버를 부르는 통로(pg_net).
--
-- 확장 설치가 막히는 프로젝트가 있습니다(권한, 또는 대시보드에서 켜야 하는
-- 경우). 그때 이 네 줄이 통째로 실패하면 SQL Editor 는 거기서 멈추고, 아래의
-- 표와 함수가 **하나도 만들어지지 않습니다** - '실행했는데 알림이 안 온다' 의
-- 정체가 대개 이것입니다. 그래서 실패를 여기서 받아 두고 계속 갑니다.
-- 못 켜진 것은 맨 아래 NOTICE 로 알려 주고, 대시보드 > Database > Extensions
-- 에서 켠 뒤 이 파일을 다시 실행하면 됩니다.
DO $ext$
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'pg_net 을 켜지 못했습니다 (%). 대시보드 > Database > Extensions 에서 켠 뒤 이 파일을 다시 실행하세요. 알림은 그때까지 나가지 않습니다.', SQLERRM;
  END;

  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'pg_cron 을 켜지 못했습니다 (%). 대시보드 > Database > Extensions 에서 켠 뒤 이 파일을 다시 실행하세요.', SQLERRM;
  END;

  -- cron 스키마가 생겼을 때만 의미가 있습니다.
  IF to_regnamespace('cron') IS NOT NULL THEN
    BEGIN
      EXECUTE 'GRANT USAGE ON SCHEMA cron TO postgres';
      EXECUTE 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'cron 스키마 권한을 주지 못했습니다 (%).', SQLERRM;
    END;
  END IF;
END
$ext$;

-- ----------------------------------------------------------------------------
-- 0. 먼저 있어야 하는 것
-- ----------------------------------------------------------------------------
-- 관리자 판별 함수(0006)는 아래 정책들이 그대로 씁니다. 없으면 정책을 만들 수
-- 없으니 여기서 멈추고 무엇을 먼저 하라고 말합니다 - 반쯤 들어간 상태로 끝나는
-- 것보다 낫습니다.
DO $deps$
BEGIN
  IF to_regprocedure('public.is_scorecard_admin()') IS NULL THEN
    RAISE EXCEPTION '0006_scorecards.sql 을 먼저 실행해 주세요. 관리자 판별 함수(is_scorecard_admin)가 없어 알림 표의 접근 정책을 만들 수 없습니다.';
  END IF;
END
$deps$;

-- updated_at 을 자동으로 찍는 함수. 0003·0009·0012 도 같은 것을 만듭니다(글자까지
-- 같습니다). 여기서도 만드는 이유는 배너(0009)를 안 쓰는 서버에서도 이 파일
-- 하나로 알림이 돌아가게 하기 위해서입니다.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $set_updated_at$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$set_updated_at$;

-- ----------------------------------------------------------------------------
-- 1. 구독 (알림을 켠 폰)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 폰마다 앱이 한 번 만든 익명 ID. 사람이 아니라 폰입니다.
  device_id    varchar(64) NOT NULL,
  -- 푸시 서비스(구글·애플·모질라)가 준 주소. 이것이 진짜 식별자입니다.
  endpoint     text NOT NULL UNIQUE,
  -- 내용을 그 폰만 풀 수 있게 암호화하는 데 쓰는 키
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  topics       text[] NOT NULL DEFAULT ARRAY['marketing']::text[],
  user_agent   text,
  locale       varchar(10),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- 알림을 끄거나 푸시 서비스가 "없는 주소"라고 답한 시각. 행은 남깁니다.
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active
  ON public.push_subscriptions (created_at DESC)
  WHERE revoked_at IS NULL;

-- 정책 없음 + GRANT 없음 = 표를 직접은 아무도 못 봅니다.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;

-- 알림 켜기. 같은 주소로 다시 오면 키와 시각만 새로 적습니다(앱을 열 때마다 옵니다).
CREATE OR REPLACE FUNCTION public.push_subscribe(
  p_device_id  text,
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_locale     text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://' OR length(p_endpoint) > 1000
     OR coalesce(length(p_p256dh), 0) NOT BETWEEN 20 AND 200
     OR coalesce(length(p_auth), 0) NOT BETWEEN 8 AND 100
     OR coalesce(length(p_device_id), 0) NOT BETWEEN 8 AND 64 THEN
    RAISE EXCEPTION 'push_subscribe: not a push subscription' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.push_subscriptions (device_id, endpoint, p256dh, auth, locale, user_agent)
  VALUES (p_device_id, p_endpoint, p_p256dh, p_auth, left(p_locale, 10), left(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE
    SET device_id    = excluded.device_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        locale       = excluded.locale,
        user_agent   = excluded.user_agent,
        last_seen_at = now(),
        revoked_at   = NULL;
END;
$$;

-- 알림 끄기. 주소를 아는 폰만 끌 수 있고, 여러 번 불러도 같습니다.
CREATE OR REPLACE FUNCTION public.push_unsubscribe(p_endpoint text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.push_subscriptions
     SET revoked_at = now()
   WHERE endpoint = p_endpoint AND revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.push_subscribe(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_unsubscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_subscribe(text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_unsubscribe(text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. 예약 발송
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.push_campaigns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 보낼 내용. 배너에서 가져온 예약도 등록할 때 배너 글을 여기에 복사해 둡니다 -
  -- 나중에 배너를 고치거나 지워도 예약한 그대로 나갑니다.
  title          varchar(120) NOT NULL,
  body           varchar(300),
  url            varchar(500),
  image_url      text,
  -- 배너에서 가져온 예약이면 그 배너. 배너 표(0009)가 있는 서버에서만 실제로
  -- 연결됩니다 - 연결은 표를 만든 뒤에 답니다(바로 아래 DO 블록).
  promotion_id   uuid,
  topic          varchar(40) NOT NULL DEFAULT 'marketing',
  scheduled_at   timestamptz NOT NULL,
  -- pending -> sending -> sent | failed. canceled 는 pending 에서만.
  status         varchar(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),
  attempted      integer,
  delivered      integer,
  failed         integer,
  error          text,
  -- 발송 중인 건만 가진 일회용 토큰. 관리자 화면에도 보이지 않습니다(아래 GRANT).
  dispatch_token uuid,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_by     uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_campaigns_due
  ON public.push_campaigns (scheduled_at)
  WHERE status = 'pending';

-- 배너 표가 있는 서버에서만 연결을 답니다. 없는 서버에서는 promotion_id 가 그냥
-- 빈 칸으로 남고, 주문 알림·직원 알림은 배너와 상관없이 돕니다. 나중에 0009 를
-- 실행한 뒤 이 파일을 다시 돌리면 그때 연결이 붙습니다.
DO $fk$
BEGIN
  IF to_regclass('public.promotions') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'push_campaigns_promotion_id_fkey'
          AND conrelid = 'public.push_campaigns'::regclass
     ) THEN
    ALTER TABLE public.push_campaigns
      ADD CONSTRAINT push_campaigns_promotion_id_fkey
      FOREIGN KEY (promotion_id) REFERENCES public.promotions (id) ON DELETE SET NULL;
  END IF;
END
$fk$;

DROP TRIGGER IF EXISTS trg_push_campaigns_updated_at ON public.push_campaigns;
CREATE TRIGGER trg_push_campaigns_updated_at
  BEFORE UPDATE ON public.push_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.push_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_campaigns_admin_read" ON public.push_campaigns;
CREATE POLICY "push_campaigns_admin_read" ON public.push_campaigns
  FOR SELECT TO authenticated
  USING (public.is_scorecard_admin());

DROP POLICY IF EXISTS "push_campaigns_admin_insert" ON public.push_campaigns;
CREATE POLICY "push_campaigns_admin_insert" ON public.push_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (public.is_scorecard_admin());

-- 관리자는 내용과 시각만 적을 수 있고(상태·결과·토큰은 못 건드림), 토큰은 읽지도
-- 못합니다. 취소는 아래 cancel_push_campaign 으로만 합니다.
REVOKE ALL ON public.push_campaigns FROM anon, authenticated;
GRANT SELECT (id, title, body, url, image_url, promotion_id, topic, scheduled_at, status,
              attempted, delivered, failed, error, started_at, completed_at, created_at)
  ON public.push_campaigns TO authenticated;
GRANT INSERT (title, body, url, image_url, promotion_id, topic, scheduled_at)
  ON public.push_campaigns TO authenticated;

-- 예약 취소. 아직 안 나간 것만 됩니다.
CREATE OR REPLACE FUNCTION public.cancel_push_campaign(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_status text;
BEGIN
  IF NOT public.is_scorecard_admin() THEN
    RAISE EXCEPTION 'cancel_push_campaign: admin only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.push_campaigns SET status = 'canceled'
   WHERE id = p_id AND status = 'pending';
  IF FOUND THEN
    RETURN 'canceled';
  END IF;

  SELECT status INTO current_status FROM public.push_campaigns WHERE id = p_id;
  RETURN CASE WHEN current_status IS NULL THEN 'not_found' ELSE 'not_pending' END;
END;
$$;

-- 지금 알림을 받는 폰 수. 예약 전에 실제로 몇 대에 닿는지 보여 줍니다.
CREATE OR REPLACE FUNCTION public.push_subscriber_count()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_scorecard_admin() THEN
    RAISE EXCEPTION 'push_subscriber_count: admin only' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT count(*)::integer FROM public.push_subscriptions
     WHERE revoked_at IS NULL AND 'marketing' = ANY (topics)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_push_campaign(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.push_subscriber_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_push_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_subscriber_count() TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. 발송 (1분마다)
-- ----------------------------------------------------------------------------

-- 보낼 때가 된 예약을 잡아 앱 서버에 넘깁니다. 누구도 직접 부를 수 없고
-- (아래 REVOKE), pg_cron 만 부릅니다.
CREATE OR REPLACE FUNCTION public.push_dispatch_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- 앱 주소가 바뀌면 여기만 고쳐서 이 파일을 다시 실행하면 됩니다.
  dispatch_url constant text := 'https://golf-gps-pelhamhills-seven.vercel.app/api/push/dispatch';
  c record;
  handed integer := 0;
BEGIN
  -- 10분이 지나도 결과가 안 온 발송은 실패로 닫습니다. 다시 보내지는 않습니다 -
  -- 중간까지 나갔다면 이미 받은 사람이 같은 알림을 두 번 받게 됩니다.
  UPDATE public.push_campaigns
     SET status = 'failed',
         error = '발송 서버에서 결과가 오지 않았습니다. 일부는 이미 받았을 수 있어 다시 보내지 않습니다.',
         completed_at = now(),
         dispatch_token = NULL
   WHERE status = 'sending' AND started_at < now() - interval '10 minutes';

  -- pending -> sending 을 한 문장으로 잡습니다. 겹쳐 돌아도 같은 예약을 두 번
  -- 잡지 않습니다(SKIP LOCKED + status 조건). 오래 밀린 것부터, 한 번에 5건.
  FOR c IN
    UPDATE public.push_campaigns
       SET status = 'sending', started_at = now(), dispatch_token = gen_random_uuid()
     WHERE id IN (
       SELECT id FROM public.push_campaigns
        WHERE status = 'pending' AND scheduled_at <= now()
        ORDER BY scheduled_at
        LIMIT 5
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, dispatch_token
  LOOP
    PERFORM net.http_post(
      url := dispatch_url,
      body := jsonb_build_object('campaign_id', c.id, 'token', c.dispatch_token),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 30000
    );
    handed := handed + 1;
  END LOOP;

  RETURN handed;
END;
$$;

REVOKE ALL ON FUNCTION public.push_dispatch_due() FROM PUBLIC, anon, authenticated;

-- 앱 서버가 토큰으로 받아 가는 것: 알림 내용 + 받을 폰 목록. 토큰이 맞고 그 예약이
-- 지금 발송 중일 때만 나옵니다.
CREATE OR REPLACE FUNCTION public.push_campaign_batch(p_campaign_id uuid, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c public.push_campaigns%ROWTYPE;
  subscriptions jsonb;
BEGIN
  SELECT * INTO c FROM public.push_campaigns
   WHERE id = p_campaign_id AND status = 'sending' AND dispatch_token = p_token;
  IF NOT FOUND OR p_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
    INTO subscriptions
    FROM public.push_subscriptions s
   WHERE s.revoked_at IS NULL AND c.topic = ANY (s.topics);

  RETURN jsonb_build_object(
    'payload', jsonb_strip_nulls(jsonb_build_object(
      'title', c.title,
      'body', c.body,
      'url', coalesce(c.url, '/'),
      'image', c.image_url,
      -- 같은 배너를 두 번 보내도 폰의 알림창에는 하나로 합쳐집니다.
      'tag', CASE WHEN c.promotion_id IS NULL THEN 'campaign-' || c.id ELSE 'promo-' || c.promotion_id END
    )),
    'subscriptions', subscriptions
  );
END;
$$;

-- 앱 서버가 결과를 적습니다. 토큰이 맞을 때 한 번만 되고, 그 뒤 토큰은 없어집니다.
-- p_gone: 푸시 서비스가 "없는 주소"라고 답한 구독 - 다음부터 보내지 않습니다.
CREATE OR REPLACE FUNCTION public.push_campaign_report(
  p_campaign_id uuid,
  p_token       uuid,
  p_attempted   integer,
  p_delivered   integer,
  p_failed      integer,
  p_gone        text[] DEFAULT NULL,
  p_error       text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_token IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.push_campaigns
     SET status = CASE WHEN p_error IS NULL THEN 'sent' ELSE 'failed' END,
         attempted = p_attempted,
         delivered = p_delivered,
         failed = p_failed,
         error = left(p_error, 1000),
         completed_at = now(),
         dispatch_token = NULL
   WHERE id = p_campaign_id AND status = 'sending' AND dispatch_token = p_token;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_gone IS NOT NULL AND cardinality(p_gone) > 0 THEN
    UPDATE public.push_subscriptions
       SET revoked_at = now()
     WHERE endpoint = ANY (p_gone) AND revoked_at IS NULL;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.push_campaign_batch(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_campaign_report(uuid, uuid, integer, integer, integer, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_campaign_batch(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_campaign_report(uuid, uuid, integer, integer, integer, text[], text) TO anon, authenticated;

-- 1분마다. 같은 이름으로 다시 실행하면 새로 만들지 않고 고쳐 씁니다.
--
-- pg_cron 이 없으면 이 한 줄 때문에 파일 전체가 오류로 끝나곤 했습니다 - 표는
-- 다 만들어진 뒤인데 화면에는 빨간 오류만 보여서, 들어간 것도 안 들어간 줄로
-- 압니다. 이제는 못 걸면 그렇다고 말하고 끝냅니다. 알림은 쌓이기만 하고 나가지
-- 않으므로(CHECK_staff_alerts.sql 2단계가 '멈춰 있음' 으로 잡습니다), pg_cron 을
-- 켠 뒤 이 파일을 다시 실행해야 합니다.
DO $sched$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE '1분 시계를 걸지 못했습니다: pg_cron 이 없습니다. 대시보드 > Database > Extensions 에서 pg_cron 을 켜고 이 파일을 다시 실행하세요. 그 전까지 알림은 예약만 되고 나가지 않습니다.';
    RETURN;
  END IF;
  BEGIN
    EXECUTE $q$SELECT cron.schedule('push-dispatch', '* * * * *', 'SELECT public.push_dispatch_due()')$q$;
    RAISE NOTICE '1분 시계(push-dispatch)를 걸었습니다.';
  EXCEPTION WHEN others THEN
    RAISE NOTICE '1분 시계를 걸지 못했습니다 (%). 알림은 예약만 되고 나가지 않습니다.', SQLERRM;
  END;
END
$sched$;
