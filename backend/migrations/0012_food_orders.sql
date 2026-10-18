-- ============================================================================
-- 0012 프로 샵 음식 주문 (메뉴 + 주문 + 10분 단위 픽업 시간)
-- ============================================================================
--
-- 선수는 코스에서 메뉴를 보고 주문하며 픽업 시간을 10분 단위로 고릅니다.
-- 프로 샵은 /admin 의 '주문' 탭에서 보고, 알림을 켜 둔 직원 폰에는 새 주문이
-- 푸시로 갑니다.
--
-- 먼저 실행해야 하는 것:
--   0006_scorecards.sql  - 누가 관리자인지(is_scorecard_admin)
--   0007_hole_edits.sql  - app_settings (영업시간을 여기 한 줄로 둡니다)
--   0010_push.sql        - 직원 알림을 쓰려면. 없어도 주문은 그대로 됩니다.
--
-- 0009 나 0003 은 필요 없습니다. 둘 다 set_updated_at() 을 만들고 아래 트리거가
-- 그걸 쓰는데, 음식 주문 때문에 배너(0009)와 푸시 크론(0010)까지 돌리게 할 수는
-- 없어서 이 파일이 같은 함수를 직접 만듭니다(2절). CREATE OR REPLACE 이고 내용이
-- 0009 와 글자까지 같으므로, 이 파일을 먼저 돌리든 나중에 돌리든 결과는 같습니다.
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다.
--
-- 설계
-- - 메뉴는 누구나 읽습니다(가격표일 뿐입니다). 고치는 것은 관리자만.
-- - 주문 표는 손님 이름·전화가 들어가므로 공개 키로 **읽히지 않습니다**.
--   주문은 함수(place_food_order)로만 들어가고, 값은 함수가 다시 계산합니다 -
--   가격을 폰에서 받아 적으면 0원짜리 버거가 들어옵니다.
--   손님은 자기 주문만 확인 코드로 봅니다(lookup_food_order).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 메뉴
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.menu_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         varchar(80) NOT NULL,
  description  varchar(200) NOT NULL DEFAULT '',
  -- 카테고리는 자유롭게 씁니다 (Snacks, Drinks, Grill ...). 화면은 이 순서로 묶습니다.
  category     varchar(40) NOT NULL DEFAULT '',
  -- 센트. 소수 달러로 두면 하루 합계가 1센트씩 어긋납니다.
  price_cents  integer NOT NULL CHECK (price_cents >= 0 AND price_cents <= 100000),
  is_available boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_order ON public.menu_items (category, sort_order, name);

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

-- 가격표는 로그인 없이 읽습니다. 품절도 보여 줍니다 - 숨기면 "왜 없지" 가 됩니다.
DROP POLICY IF EXISTS "menu_items_read_all" ON public.menu_items;
CREATE POLICY "menu_items_read_all" ON public.menu_items
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "menu_items_write_admin" ON public.menu_items;
CREATE POLICY "menu_items_write_admin" ON public.menu_items
  FOR ALL TO authenticated
  USING (public.is_scorecard_admin())
  WITH CHECK (public.is_scorecard_admin());

REVOKE ALL ON public.menu_items FROM anon, authenticated;
GRANT SELECT ON public.menu_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. 주문
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.food_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 손님이 주문을 다시 찾는 열쇠. 짧고 헷갈리지 않는 글자만 씁니다.
  code         varchar(8) NOT NULL UNIQUE,
  customer_name  varchar(60) NOT NULL,
  phone        varchar(30) NOT NULL,
  note         varchar(500) NOT NULL DEFAULT '',
  -- 주문한 순간의 이름과 가격을 그대로 박아 둡니다. 나중에 메뉴 가격이 바뀌어도
  -- 이 영수증은 변하지 않습니다.
  items        jsonb NOT NULL,
  total_cents  integer NOT NULL CHECK (total_cents >= 0),
  pickup_at    timestamptz NOT NULL,
  -- 어느 홀에서 시켰는지. 프로 샵이 "언제쯤 오겠구나" 를 가늠합니다.
  hole_number  integer CHECK (hole_number BETWEEN 1 AND 18),
  status       varchar(16) NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'ready', 'picked_up', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_food_orders_pickup ON public.food_orders (pickup_at DESC);

-- updated_at 을 스스로 갱신하는 트리거 함수.
--
-- 0003 과 0009 에도 똑같은 것이 들어 있습니다 - 이 파일에도 두는 이유는 위
-- 머리말에 적었습니다. 여러 파일이 같은 함수를 CREATE OR REPLACE 하므로
-- 정의는 반드시 서로 같아야 합니다. 고칠 일이 생기면 세 군데를 같이 고치세요.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $set_updated_at$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$set_updated_at$;

DROP TRIGGER IF EXISTS trg_food_orders_updated_at ON public.food_orders;
CREATE TRIGGER trg_food_orders_updated_at
  BEFORE UPDATE ON public.food_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.food_orders ENABLE ROW LEVEL SECURITY;

-- 프로 샵(관리자)만 주문을 봅니다. 손님은 아래 lookup_food_order 로 자기 것만.
DROP POLICY IF EXISTS "food_orders_admin_read" ON public.food_orders;
CREATE POLICY "food_orders_admin_read" ON public.food_orders
  FOR SELECT TO authenticated USING (public.is_scorecard_admin());

DROP POLICY IF EXISTS "food_orders_admin_update" ON public.food_orders;
CREATE POLICY "food_orders_admin_update" ON public.food_orders
  FOR UPDATE TO authenticated
  USING (public.is_scorecard_admin())
  WITH CHECK (public.is_scorecard_admin());

-- anon 에는 읽기도 쓰기도 주지 않습니다. 주문은 함수로만 들어갑니다.
REVOKE ALL ON public.food_orders FROM anon, authenticated;
GRANT SELECT ON public.food_orders TO authenticated;
GRANT UPDATE (status) ON public.food_orders TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. 영업시간과 준비시간 (app_settings 의 한 줄)
-- ----------------------------------------------------------------------------
-- 값이 없으면 아래 기본값을 씁니다: 오전 8시 ~ 오후 7시, 20분 뒤부터, 10분 단위.
-- 관리자가 /admin 에서 고칩니다.

INSERT INTO public.app_settings (key, value)
VALUES ('food_orders', '{"open":"08:00","close":"19:00","lead_minutes":20,"slot_minutes":10,"enabled":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.food_order_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT value FROM public.app_settings WHERE key = 'food_orders'), '{}'::jsonb)
$$;

-- ----------------------------------------------------------------------------
-- 4. 주문 넣기
-- ----------------------------------------------------------------------------
-- p = {"name":..,"phone":..,"note":..,"hole":3,"pickup_at":"2026-09-19T18:30:00Z",
--      "items":[{"id":"<menu uuid>","quantity":2}, ...]}
--
-- 오류는 PT400/PT409 로 올립니다 - PostgREST 가 그 숫자를 HTTP 상태로 씁니다.

CREATE OR REPLACE FUNCTION public.place_food_order(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s jsonb := public.food_order_settings();
  open_min integer := coalesce(split_part(s->>'open', ':', 1)::int * 60 + split_part(s->>'open', ':', 2)::int, 480);
  close_min integer := coalesce(split_part(s->>'close', ':', 1)::int * 60 + split_part(s->>'close', ':', 2)::int, 1140);
  lead_min integer := coalesce((s->>'lead_minutes')::int, 20);
  slot_min integer := greatest(1, coalesce((s->>'slot_minutes')::int, 10));
  v_name text := btrim(coalesce(p->>'name', ''));
  v_phone text := btrim(coalesce(p->>'phone', ''));
  v_note text := btrim(coalesce(p->>'note', ''));
  v_hole integer := nullif(p->>'hole', '')::int;
  v_pickup timestamptz;
  v_local timestamp;
  v_now timestamp := (now() AT TIME ZONE 'America/Toronto');
  v_minutes integer;
  v_items jsonb;
  v_total integer;
  v_lines integer;
  v_all_available boolean;
  v_code text;
  v_id uuid;
BEGIN
  IF coalesce((s->>'enabled')::boolean, true) IS NOT TRUE THEN
    PERFORM public.pelham_order_fail('409', 'Food ordering is closed right now. Please call the pro shop.');
  END IF;
  IF v_name = '' OR length(v_name) > 60 THEN
    PERFORM public.pelham_order_fail('400', 'Please give a name for the order.');
  END IF;
  IF v_phone = '' OR length(v_phone) > 30 THEN
    PERFORM public.pelham_order_fail('400', 'Please give a phone number the pro shop can call.');
  END IF;
  IF length(v_note) > 500 THEN
    PERFORM public.pelham_order_fail('400', 'That note is too long.');
  END IF;

  BEGIN
    v_pickup := (p->>'pickup_at')::timestamptz;
  EXCEPTION WHEN others THEN
    v_pickup := NULL;
  END;
  IF v_pickup IS NULL THEN
    PERFORM public.pelham_order_fail('400', 'Please choose a pickup time.');
  END IF;
  v_local := v_pickup AT TIME ZONE 'America/Toronto';
  v_minutes := extract(hour FROM v_local)::int * 60 + extract(minute FROM v_local)::int;

  IF v_local::date <> v_now::date THEN
    PERFORM public.pelham_order_fail('400', 'Pickup times are for today only.');
  END IF;
  IF extract(second FROM v_local)::int <> 0 OR v_minutes % slot_min <> 0 THEN
    PERFORM public.pelham_order_fail('400', format('Pickup times go in %s minute steps.', slot_min));
  END IF;
  IF v_minutes < open_min OR v_minutes > close_min THEN
    PERFORM public.pelham_order_fail('400', format('The pro shop takes orders between %s and %s.', s->>'open', s->>'close'));
  END IF;
  IF v_pickup < now() + make_interval(mins => lead_min) - interval '1 minute' THEN
    PERFORM public.pelham_order_fail('409', format('That time has passed. Orders need %s minutes.', lead_min));
  END IF;

  -- 값은 DB 가 정합니다. 폰이 보낸 것은 무엇을 몇 개인지뿐입니다.
  WITH wanted AS (
    SELECT (line->>'id')::uuid AS id,
           greatest(1, least(20, coalesce((line->>'quantity')::int, 1))) AS quantity
      FROM jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) AS line
  ),
  priced AS (
    SELECT m.id, m.name, m.price_cents, w.quantity, m.is_available
      FROM wanted w JOIN public.menu_items m ON m.id = w.id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'price_cents', price_cents, 'quantity', quantity
         ) ORDER BY name), '[]'::jsonb),
         coalesce(sum(price_cents * quantity), 0),
         count(*),
         bool_and(is_available)
    INTO v_items, v_total, v_lines, v_all_available
    FROM priced;

  IF jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 THEN
    PERFORM public.pelham_order_fail('400', 'Your order is empty.');
  END IF;
  -- A line the menu no longer has: the club took it off while this order sat open.
  IF v_lines <> jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) THEN
    PERFORM public.pelham_order_fail('409', 'The menu changed while you were ordering. Please check your order.');
  END IF;
  IF v_all_available IS NOT TRUE THEN
    PERFORM public.pelham_order_fail('409', 'Something in your order has just sold out. Please check the menu.');
  END IF;

  LOOP
    -- 헷갈리는 글자(0/O, 1/I)를 뺀 여섯 자리.
    SELECT string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1), '')
      INTO v_code FROM generate_series(1, 6);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.food_orders WHERE code = v_code);
  END LOOP;

  INSERT INTO public.food_orders (code, customer_name, phone, note, items, total_cents, pickup_at, hole_number)
  VALUES (v_code, v_name, v_phone, v_note, v_items, v_total, v_pickup, v_hole)
  RETURNING id INTO v_id;

  -- 프로 샵 폰에 알림. 0010 을 아직 실행하지 않았으면 조용히 넘어갑니다.
  -- 손님 이름·전화는 알림에 넣지 않습니다 - 잠금 화면에 뜨는 글입니다.
  IF to_regclass('public.push_campaigns') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.push_campaigns (title, body, url, topic, scheduled_at)
      VALUES (
        format('New order · pickup %s', to_char(v_local, 'HH12:MI AM')),
        format('%s item%s · $%s · code %s', v_lines, CASE WHEN v_lines = 1 THEN '' ELSE 's' END,
               to_char(v_total / 100.0, 'FM999990.00'), v_code),
        '/admin',
        'proshop',
        now()
      );
    EXCEPTION WHEN others THEN
      NULL;  -- 알림이 안 나가도 주문은 들어갑니다.
    END;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'code', v_code,
    'items', v_items,
    'total_cents', v_total,
    'pickup_at', v_pickup,
    'status', 'new'
  );
END;
$$;

-- PostgREST 가 HTTP 상태로 읽는 오류. 이름은 다른 앱과 겹치지 않게 pelham_ 로.
CREATE OR REPLACE FUNCTION public.pelham_order_fail(status text, message text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING errcode = 'PT' || status, message = message;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. 손님이 자기 주문 보기 (확인 코드로만)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lookup_food_order(p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'code', o.code,
    'customer_name', o.customer_name,
    'items', o.items,
    'total_cents', o.total_cents,
    'pickup_at', o.pickup_at,
    'status', o.status,
    'created_at', o.created_at
  )
  FROM public.food_orders o
  WHERE o.code = upper(btrim(coalesce(p_code, '')))
    AND btrim(coalesce(p_code, '')) ~* '^[0-9a-z]{6}$'
$$;

-- ----------------------------------------------------------------------------
-- 6. 직원 폰만 주문 알림 받기
-- ----------------------------------------------------------------------------
-- 알림 구독(0010)에는 이미 topics 가 있습니다. 'proshop' 을 켜고 끄는 것은
-- 관리자 계정만 - 아무나 켜면 주문 알림을 남이 받게 됩니다.

CREATE OR REPLACE FUNCTION public.set_proshop_push(p_endpoint text, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed integer;
BEGIN
  IF NOT public.is_scorecard_admin() THEN
    RAISE EXCEPTION USING errcode = 'PT403', message = 'Only a pro shop account can take order alerts.';
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
$$;

REVOKE ALL ON FUNCTION public.pelham_order_fail(text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.food_order_settings() FROM public;
REVOKE ALL ON FUNCTION public.place_food_order(jsonb) FROM public;
REVOKE ALL ON FUNCTION public.lookup_food_order(text) FROM public;
REVOKE ALL ON FUNCTION public.set_proshop_push(text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.food_order_settings() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_food_order(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_food_order(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_proshop_push(text, boolean) TO authenticated;
