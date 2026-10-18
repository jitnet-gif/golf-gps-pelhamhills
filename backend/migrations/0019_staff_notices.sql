-- ============================================================================
-- 0019 직원 공지 (전 직원 폰으로 한 번에)
-- ============================================================================
--
-- 클럽이 "Francis 와 Sam 은 전 직원한테 보낼 수 있게" 라고 했습니다. 지금은
-- 그럴 방법이 없습니다:
--
--   - /admin > 예약 발송 은 **손님용**입니다(marketing 토픽). 직원 공지를
--     거기로 보내면 그 날 앱을 켠 손님 전부가 받습니다.
--   - 'proshop' 토픽은 새 주문 알림 전용이고, 켜는 함수(set_proshop_push)가
--     관리자만 허용합니다. 직원이 관리자 계정이 아니면 받을 수도 없습니다.
--
-- 먼저 실행해야 하는 것:
--   0006_scorecards.sql  - is_scorecard_admin()
--   0010_push.sql        - push_subscriptions / push_campaigns
--   0012_food_orders.sql - set_proshop_push() (이 파일이 고쳐 씁니다)
-- 없으면 각 단계에서 알려 주고 넘어갑니다. Run 한 뒤 Messages/Notices 를 보세요.
--
-- Supabase 대시보드 > SQL Editor 에 붙여 넣고 Run. 여러 번 해도 안전합니다.
--
-- ----------------------------------------------------------------------------
-- 왜 관리자 표를 그대로 쓰지 않는가
-- ----------------------------------------------------------------------------
-- scorecard_admins 에 넣으면 공지는 받지만, 메뉴 가격·주문·손님 위치까지 전부
-- 열립니다. 공지 하나 받자고 카트 위치를 보여 줄 이유가 없습니다.
--
-- 그래서 직원은 따로 둡니다. 두 단계입니다:
--   staff_members 에 있으면        -> 직원 공지를 **받을** 수 있습니다.
--   can_broadcast 가 true 이면      -> 전 직원에게 **보낼** 수 있습니다.
--
-- Francis 와 Sam 이 두 번째입니다. 맨 아래에서 지정합니다.
--
-- 보낼 수 있다는 것은 모두의 잠금 화면에 글을 띄울 수 있다는 뜻이라, 기본값은
-- false 입니다 - 직원으로 추가하는 것과 보내게 하는 것은 다른 결정입니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 직원 명부
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_members (
  -- 이메일이 아니라 계정 id 입니다. 0006 이 관리자에게 그렇게 한 것과 같은
  -- 이유로 - 이메일 확인이 꺼져 있으면 누구든 아무 주소로 가입할 수 있고,
  -- "이 주소면 직원" 으로 두면 먼저 가입한 사람이 직원이 됩니다.
  user_id       uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  -- 화면에 누구인지 보이라고. 로그인 이메일은 gm2@... 같은 것이 많습니다.
  display_name  text,
  -- 전 직원에게 보낼 수 있는 사람. 받는 것과 보내는 것은 다른 권한입니다.
  can_broadcast boolean NOT NULL DEFAULT false,
  added_at      timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. 이 계정이 직원인가 / 보낼 수 있는가
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER 인 이유는 위 정책이 이 함수를 부르기 때문입니다. 정책이
-- 표를 직접 보게 하면 자기 자신을 참조해 무한히 돕니다.
--
-- 관리자는 언제나 직원입니다. 클럽에 관리자만 있고 직원 명부가 비어 있는 날에도
-- 공지가 오가야 합니다.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_members WHERE user_id = auth.uid())
      OR public.is_scorecard_admin()
$$;

CREATE OR REPLACE FUNCTION public.can_broadcast_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members
     WHERE user_id = auth.uid() AND can_broadcast
  ) OR public.is_scorecard_admin()
$$;

REVOKE ALL ON FUNCTION public.is_staff() FROM public;
REVOKE ALL ON FUNCTION public.can_broadcast_staff() FROM public;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_broadcast_staff() TO authenticated;

-- 정책은 함수 뒤에 둡니다. CREATE POLICY 는 그 안에서 부르는 함수가 이미
-- 있어야 하고, is_staff() 는 위의 표가 이미 있어야 합니다 - 표, 함수, 정책의
-- 순서는 바꿀 수 없습니다.
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

-- 명부는 직원끼리만 봅니다. 손님에게 직원 이름을 보여 줄 일이 없습니다.
DROP POLICY IF EXISTS "staff_members_read_staff" ON public.staff_members;
CREATE POLICY "staff_members_read_staff" ON public.staff_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff());

-- 명부를 고치는 것은 관리자만. 직원이 스스로를 추가할 수 있으면 명부가 아닙니다.
DROP POLICY IF EXISTS "staff_members_write_admin" ON public.staff_members;
CREATE POLICY "staff_members_write_admin" ON public.staff_members
  FOR ALL TO authenticated
  USING (public.is_scorecard_admin())
  WITH CHECK (public.is_scorecard_admin());

REVOKE ALL ON public.staff_members FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_members TO authenticated;


-- ----------------------------------------------------------------------------
-- 3. 직원 폰 등록을 직원에게도 열어 줍니다
-- ----------------------------------------------------------------------------
-- 0012 의 set_proshop_push 는 관리자만 허용했습니다. 그 함수의 쓰임이 늘었으니
-- (주문 알림 + 직원 공지) 직원도 켤 수 있어야 합니다. 관리자만 할 수 있는
-- 일은 그대로 관리자만 합니다 - 이건 "내 폰으로 받겠다" 일 뿐입니다.
DO $push$
BEGIN
IF to_regprocedure('public.set_proshop_push(text,boolean)') IS NULL THEN
  RAISE NOTICE 'set_proshop_push 가 없습니다. 0012_food_orders.sql 을 먼저 실행하세요.';
  RETURN;
END IF;

EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.set_proshop_push(p_endpoint text, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $body$
DECLARE
  changed integer;
BEGIN
  -- 0019 에서 넓혔습니다: 관리자만이 아니라 직원 명부에 있는 사람도.
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION USING errcode = 'PT403', message = 'Only pro shop staff can take these alerts.';
  END IF;
  IF to_regclass('public.push_subscriptions') IS NULL THEN
    RAISE EXCEPTION USING errcode = 'PT409', message = 'Push is not set up on this server yet (0010_push.sql).';
  END IF;

  UPDATE public.push_subscriptions
     SET topics = CASE
           WHEN p_on THEN (SELECT array_agg(DISTINCT t) FROM unnest(topics || ARRAY['proshop']) AS t)
           ELSE (SELECT coalesce(array_agg(t), ARRAY[]::text[]) FROM unnest(topics) AS t WHERE t <> 'proshop')
         END
   WHERE endpoint = p_endpoint;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END;
$body$;
$fn$;

REVOKE ALL ON FUNCTION public.set_proshop_push(text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_proshop_push(text, boolean) TO authenticated;
RAISE NOTICE 'set_proshop_push 를 직원도 쓸 수 있게 넓혔습니다.';
END
$push$;

-- ----------------------------------------------------------------------------
-- 4. 전 직원에게 공지 보내기
-- ----------------------------------------------------------------------------
-- 0010 의 발송 장치를 그대로 씁니다 - push_campaigns 에 한 줄 넣으면 정해진
-- 시각에 Vercel 의 발송 함수가 가져갑니다. 다른 점은 토픽이 'proshop' 이라
-- 직원 폰에만 간다는 것뿐입니다.
--
-- 함수로 두는 이유: 표에 직접 INSERT 하는 길은 0010 이 관리자에게만 열어
-- 두었고(push_campaigns_admin_insert), 여기서 그 정책을 건드리면 손님 발송까지
-- 같이 열립니다. 이 함수는 토픽을 'proshop' 으로 **못박아** 넣으므로, 보낼 수
-- 있는 직원이 실수로든 아니든 손님에게 보낼 방법이 없습니다.
CREATE OR REPLACE FUNCTION public.send_staff_notice(p_title text, p_body text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_id    uuid;
BEGIN
  IF NOT public.can_broadcast_staff() THEN
    RAISE EXCEPTION USING errcode = 'PT403',
      message = 'This account cannot send staff notices.';
  END IF;
  IF v_title = '' THEN
    RAISE EXCEPTION USING errcode = 'PT400', message = 'Please write a title.';
  END IF;
  IF length(v_title) > 120 THEN
    RAISE EXCEPTION USING errcode = 'PT400', message = 'The title is too long (120 max).';
  END IF;
  IF length(v_body) > 300 THEN
    RAISE EXCEPTION USING errcode = 'PT400', message = 'The message is too long (300 max).';
  END IF;
  IF to_regclass('public.push_campaigns') IS NULL THEN
    RAISE EXCEPTION USING errcode = 'PT409',
      message = 'Push is not set up on this server yet (0010_push.sql).';
  END IF;

  -- 같은 글을 1 분 안에 두 번 보내지 않습니다. 발송 버튼은 대개 잠금 화면에
  -- 뜰 때까지 기다리는 사람이 누르고, 기다리는 사람은 한 번 더 누릅니다.
  IF EXISTS (
    SELECT 1 FROM public.push_campaigns
     WHERE topic = 'proshop' AND title = v_title
       AND created_at > now() - interval '1 minute'
  ) THEN
    RAISE EXCEPTION USING errcode = 'PT409',
      message = 'That notice went out less than a minute ago.';
  END IF;

  INSERT INTO public.push_campaigns (title, body, url, topic, scheduled_at)
  VALUES (v_title, nullif(v_body, ''), '/fnb', 'proshop', now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_staff_notice(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_staff_notice(text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4b. 직원이 자기 공지를 읽을 수 있게
-- ----------------------------------------------------------------------------
-- 0010 은 push_campaigns 읽기를 관리자에게만 열었습니다. 그러면 직원 화면의
-- "보낸 공지" 가 늘 비어 있고, 보낸 사람은 나갔는지 알 수 없습니다.
-- 직원에게 여는 것은 **proshop 토픽 줄만**입니다 - 손님 발송 내역은 그대로
-- 관리자만 봅니다.
DO $read$
BEGIN
IF to_regclass('public.push_campaigns') IS NULL THEN
  RAISE NOTICE 'push_campaigns 가 없습니다. 0010_push.sql 을 먼저 실행하세요.';
  RETURN;
END IF;

DROP POLICY IF EXISTS "push_campaigns_staff_read_proshop" ON public.push_campaigns;
CREATE POLICY "push_campaigns_staff_read_proshop" ON public.push_campaigns
  FOR SELECT TO authenticated
  USING (topic = 'proshop' AND public.is_staff());

RAISE NOTICE '직원이 proshop 공지 내역을 읽을 수 있습니다.';
END
$read$;

-- ============================================================================
-- 5. 직원 지정 (각자 앱에서 먼저 가입한 뒤에 실행하세요)
-- ============================================================================
-- 가입하지 않은 주소면 아무것도 들어가지 않습니다(0 rows). 그때는 그 사람에게
-- 먼저 앱에서 회원 가입을 부탁하고 다시 실행하세요.
--
-- ---- Francis 와 Sam: 받고 + 보낼 수 있음 -----------------------------------
-- 아래 두 덩어리의 맨 앞 -- 를 지우고, 주소를 실제 로그인 주소로 바꿔 Run 하세요.
--
-- INSERT INTO public.staff_members (user_id, display_name, can_broadcast)
-- SELECT id, 'Francis', true FROM auth.users WHERE email = 'francis@example.com'
-- ON CONFLICT (user_id) DO UPDATE SET can_broadcast = true, display_name = 'Francis';
--
-- INSERT INTO public.staff_members (user_id, display_name, can_broadcast)
-- SELECT id, 'Sam', true FROM auth.users WHERE email = 'sam@example.com'
-- ON CONFLICT (user_id) DO UPDATE SET can_broadcast = true, display_name = 'Sam';
--
-- ---- 나머지 직원: 받기만 --------------------------------------------------
-- INSERT INTO public.staff_members (user_id, display_name)
-- SELECT id, '이름' FROM auth.users WHERE email = '직원주소@example.com'
-- ON CONFLICT (user_id) DO NOTHING;
--
-- ---- 지금 누가 직원인지 --------------------------------------------------
-- SELECT s.display_name, u.email, s.can_broadcast, s.added_at
--   FROM public.staff_members s JOIN auth.users u ON u.id = s.user_id
--  ORDER BY s.added_at;
--
-- ---- 보낼 권한만 거두기 ---------------------------------------------------
-- UPDATE public.staff_members SET can_broadcast = false
--  WHERE user_id = (SELECT id FROM auth.users WHERE email = '주소@example.com');
-- ============================================================================
