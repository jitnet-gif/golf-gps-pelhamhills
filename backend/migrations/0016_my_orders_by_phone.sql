-- ============================================================================
-- 0016 내 주문 목록 (코드를 치지 않고 보기)
-- ============================================================================
--
-- 손님이 /food 를 열면 자기 주문이 목록으로 보이게 합니다. 지금까지는 여섯
-- 자리 코드를 손으로 쳐야 했습니다(lookup_food_order) - 8번 홀에서 한 번 읽고
-- 지나간 글자입니다.
--
-- 먼저 실행해야 하는 것:
--   0012_food_orders.sql  - food_orders 표. 없으면 이 파일은 아무것도 하지 않고
--                           조용히 끝납니다(아래 DO 블록).
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다.
--
-- ----------------------------------------------------------------------------
-- 열쇠를 코드에서 전화번호로 바꾸는 일이라, 그 값을 적어 둡니다
-- ----------------------------------------------------------------------------
-- 앱은 이미 주문할 때 쓴 전화번호를 폰에 가지고 있습니다(golf.food.who). 그것을
-- 그대로 보내면 손님은 아무것도 치지 않습니다.
--
-- 대신 코드보다 약한 열쇠입니다. 코드는 32^6 (약 10억) 가지에서 뽑은 한 번
-- 쓰는 글자지만, 전화번호는 찍어 볼 수 있습니다. 그래서 아래 세 가지로 조입니다:
--
--   1. **오늘 것만.** 어제 주문은 이 함수로 나오지 않습니다. 찍어 맞히더라도
--      건질 수 있는 것이 그 날 그 사람의 주문 한두 건입니다.
--   2. **숫자 여덟 자리 이상**을 요구합니다. '1' 이나 '010' 같은 것으로 표를
--      훑을 수 없습니다.
--   3. **전화번호는 돌려주지 않습니다.** 맞혀서 들어온 사람이 가져갈 수 있는
--      것은 이름과 품목뿐이고, 번호는 이미 알고 넣은 값입니다.
--
-- 여기서 나가는 것: 이름, 품목, 금액, 픽업 시간, 상태, 코드.
-- 이것이 클럽에 과하다고 판단되면 이 함수의 권한만 거두면 됩니다 -
--   REVOKE EXECUTE ON FUNCTION public.my_food_orders(text) FROM anon, authenticated;
-- 앱은 그때 조용히 코드 기억 방식(폰에 저장된 코드)으로만 돌아갑니다.
-- ============================================================================

DO $mine$
BEGIN

IF to_regclass('public.food_orders') IS NULL THEN
  RAISE NOTICE 'food_orders 표가 없습니다. 0012_food_orders.sql 을 먼저 실행하세요.';
  RETURN;
END IF;

-- 번호로 찾는 길이 생겼으니 색인을 답니다. 숫자만 남긴 값으로 찾으므로
-- 표현식 색인이라야 걸립니다 - '905-735-6768' 과 '9057356768' 은 같은 번호고,
-- 손님이 둘 중 무엇으로 넣었는지는 그 날 기분입니다.
CREATE INDEX IF NOT EXISTS idx_food_orders_phone_digits
  ON public.food_orders (regexp_replace(phone, '[^0-9]', '', 'g'), pickup_at DESC);

END
$mine$;

-- ----------------------------------------------------------------------------
-- 손님 폰이 부르는 함수
-- ----------------------------------------------------------------------------
-- 목록(jsonb 배열)을 줍니다. 못 찾으면 빈 배열입니다 - null 과 빈 배열을
-- 가르면 부르는 쪽이 두 가지를 다뤄야 하고, 둘 다 "없다" 입니다.
CREATE OR REPLACE FUNCTION public.my_food_orders(p_phone text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH digits AS (
    SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') AS d
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', o.code,
        'customer_name', o.customer_name,
        'items', o.items,
        'total_cents', o.total_cents,
        'pickup_at', o.pickup_at,
        'status', o.status,
        'created_at', o.created_at
      )
      ORDER BY o.pickup_at DESC
    ),
    '[]'::jsonb
  )
  FROM public.food_orders o, digits
  WHERE length(digits.d) >= 8
    AND regexp_replace(o.phone, '[^0-9]', '', 'g') = digits.d
    -- 오늘 것만. 클럽 시간 기준이고, 0012 가 픽업 시간을 검사할 때 쓰는 것과
    -- 같은 지역입니다.
    AND (o.pickup_at AT TIME ZONE 'America/Toronto')::date
        = (now() AT TIME ZONE 'America/Toronto')::date
  -- 한 사람이 하루에 스무 건을 넘게 시키지는 않습니다. 넘으면 최근 것부터.
  LIMIT 20
$$;

REVOKE ALL ON FUNCTION public.my_food_orders(text) FROM public;
GRANT EXECUTE ON FUNCTION public.my_food_orders(text) TO anon, authenticated;
