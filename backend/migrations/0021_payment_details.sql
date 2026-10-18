-- ============================================================================
-- 0021 결제 상세 (현금 받은 돈 / 카드 끝 4자리 · 승인번호)
-- ============================================================================
--
-- 0018 은 "받았다 + 무엇으로" 만 적었습니다. 이 파일은 영수증과 마감에 필요한
-- 나머지를 적을 칸을 더합니다:
--
--   현금  - 손님이 낸 돈(paid_cash_cents). 거스름돈은 여기서 합계를 빼면
--           나오므로 따로 적지 않습니다.
--   카드  - 카드 끝 4자리(paid_card_last4)와 단말기 승인번호(paid_card_auth).
--
-- ----------------------------------------------------------------------------
-- 카드 전체 번호는 받지 않습니다
-- ----------------------------------------------------------------------------
-- 카드 번호 전체를 우리 DB 에 두는 순간 PCI DSS 대상이 되고, 새면 클럽이
-- 책임집니다. 그래서 칸 자체가 4자리까지만 들어가게 막았습니다(CHECK). 화면에
-- 번호 전체를 쳐도 끝 4자리만 서버로 갑니다.
-- 실제로 카드에서 돈을 빼 가는 것(번호 입력 결제 / 단말기 연동)은 결제 대행사
-- (Stripe, Moneris 등) 계정이 있어야 하고, 지금은 보류입니다. 그때까지 카드는
-- 카운터 단말기로 받고, 여기에는 그 기록만 남깁니다.
--
-- 먼저 실행해야 하는 것: 0018_order_payment.sql
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run.
-- 여러 번 실행해도 안전합니다. 쓰기 권한은 0012 의 정책이 그대로 덮습니다.
-- ============================================================================

DO $paydetail$
BEGIN

IF to_regclass('public.food_orders') IS NULL THEN
  RAISE NOTICE 'food_orders 표가 없습니다. 0012_food_orders.sql 을 먼저 실행하세요.';
  RETURN;
END IF;

IF NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'food_orders' AND column_name = 'paid_method'
) THEN
  RAISE NOTICE '결제 칸이 없습니다. 0018_order_payment.sql 을 먼저 실행하세요.';
  RETURN;
END IF;

ALTER TABLE public.food_orders ADD COLUMN IF NOT EXISTS paid_cash_cents integer;
ALTER TABLE public.food_orders ADD COLUMN IF NOT EXISTS paid_card_last4 char(4);
ALTER TABLE public.food_orders ADD COLUMN IF NOT EXISTS paid_card_auth varchar(20);

ALTER TABLE public.food_orders DROP CONSTRAINT IF EXISTS food_orders_paid_detail_shape;
ALTER TABLE public.food_orders
  ADD CONSTRAINT food_orders_paid_detail_shape CHECK (
    -- 현금 칸은 현금 결제에만, 합계 이상으로만.
    (paid_cash_cents IS NULL
      OR (paid_method = 'cash' AND paid_cash_cents >= total_cents AND paid_cash_cents < 10000000))
    -- 카드 칸은 카드 결제에만. 숫자 4개 - 그 이상은 들어갈 수 없습니다.
    AND (paid_card_last4 IS NULL
      OR (paid_method = 'card' AND paid_card_last4 ~ '^[0-9]{4}$'))
    AND (paid_card_auth IS NULL
      OR (paid_method = 'card' AND paid_card_auth ~ '^[A-Za-z0-9-]{1,20}$'))
  );

END
$paydetail$;
