-- ============================================================================
-- 0018 결제 표시 (카운터에서 받았는지)
-- ============================================================================
--
-- 앱은 돈을 받지 않습니다. 값은 손님이 프로 샵 카운터에서 냅니다 - 그건
-- 그대로입니다. 바뀌는 것은 **받았는지를 적어 둘 곳**이 생긴다는 것뿐입니다.
--
-- 지금은 그 기록이 없어서, 카운터 사람이 바뀌면 이 주문이 계산된 것인지
-- 아닌지 알 방법이 없습니다. '가져감' 은 음식이 나갔다는 뜻이지 돈을 받았다는
-- 뜻이 아닙니다 - 둘은 다른 일이고, 어긋나는 날이 하루는 있습니다.
--
-- 먼저 실행해야 하는 것:
--   0012_food_orders.sql  - food_orders 표. 없으면 이 파일은 아무것도 하지
--                           않고 조용히 끝납니다.
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다.
--
-- ----------------------------------------------------------------------------
-- 손님에게는 보이지 않습니다
-- ----------------------------------------------------------------------------
-- lookup_food_order / my_food_orders 가 돌려주는 항목에 넣지 않았습니다.
-- 손님 폰이 "결제됨" 을 보여 주면 그건 앱이 돈을 받았다는 말로 읽히고, 앱은
-- 돈을 받지 않습니다. 이 칸은 카운터 화면(/fnb)만 봅니다.
--
-- 방법(현금/카드)까지 적는 이유는 그 날 마감할 때 맞춰 보기 위해서입니다.
-- 카드 단말기 집계와 이 표의 카드 합계가 다르면 그 날 어딘가 틀린 것입니다.
-- ============================================================================

DO $pay$
BEGIN

IF to_regclass('public.food_orders') IS NULL THEN
  RAISE NOTICE 'food_orders 표가 없습니다. 0012_food_orders.sql 을 먼저 실행하세요.';
  RETURN;
END IF;

-- 받은 시각. NULL 이면 아직 안 받았습니다.
ALTER TABLE public.food_orders
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- 무엇으로 받았는지. 자유 문자열로 두지 않는 이유는 마감 합계를 내려면
-- 값이 셋뿐이어야 하기 때문입니다.
ALTER TABLE public.food_orders
  ADD COLUMN IF NOT EXISTS paid_method varchar(16);

ALTER TABLE public.food_orders
  DROP CONSTRAINT IF EXISTS food_orders_paid_shape;
ALTER TABLE public.food_orders
  ADD CONSTRAINT food_orders_paid_shape CHECK (
    (paid_at IS NULL AND paid_method IS NULL)
    OR (paid_at IS NOT NULL AND paid_method IN ('cash', 'card', 'member'))
  );

-- 카운터 화면이 "오늘 안 받은 것" 을 먼저 봅니다.
CREATE INDEX IF NOT EXISTS idx_food_orders_unpaid
  ON public.food_orders (pickup_at DESC)
  WHERE paid_at IS NULL;

-- 쓰기 권한은 0012 의 food_orders_admin_update 가 이미 정해 두었습니다
-- (관리자만 UPDATE). 칸이 늘어도 그 정책이 그대로 덮습니다 - 여기서 정책을
-- 다시 만들면 0012 와 두 벌이 됩니다.

END
$pay$;
