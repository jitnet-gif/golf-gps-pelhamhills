-- ============================================================================
-- 0017 손님이 자기 주문 취소하기
-- ============================================================================
--
-- 지금은 취소를 프로 샵만 할 수 있습니다(0012 의 food_orders_admin_update).
-- 잘못 누른 손님은 전화를 걸어야 하고, 그 전화는 카운터가 바쁠 때 옵니다.
--
-- 먼저 실행해야 하는 것:
--   0012_food_orders.sql  - food_orders 표와 pelham_order_fail(). 없으면 이
--                           파일은 아무것도 하지 않고 조용히 끝납니다.
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다.
--
-- ----------------------------------------------------------------------------
-- 어디까지 손님이 무르게 할 것인가
-- ----------------------------------------------------------------------------
-- '접수(new)' 인 동안만입니다. 프로 샵이 '준비됨' 을 찍었다면 그것은 이미
-- 만들어 놓았다는 뜻이고, 그 다음은 앱이 정할 일이 아니라 사람이 이야기할
-- 일입니다 - 그때는 전화 안내로 보냅니다.
--
-- 픽업 시간이 이미 지난 주문도 막습니다. 카운터에 음식이 나와 있는데 손님
-- 폰에서 조용히 사라지면, 그 음식은 아무도 찾아가지 않은 채 남습니다.
--
-- 열쇠는 여전히 확인 코드입니다. 코드를 아는 사람은 그 주문의 주인이라는
-- 0012 의 판단을 그대로 씁니다. 취소는 지우는 것이 아니라 상태를 바꾸는
-- 것이므로, 프로 샵의 오늘 목록에는 '취소' 로 그대로 남습니다 - 만들던 것을
-- 멈추려면 그것이 보여야 합니다.
-- ============================================================================

DO $cancel$
BEGIN

IF to_regclass('public.food_orders') IS NULL THEN
  RAISE NOTICE 'food_orders 표가 없습니다. 0012_food_orders.sql 을 먼저 실행하세요.';
  RETURN;
END IF;

END
$cancel$;

CREATE OR REPLACE FUNCTION public.cancel_food_order(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_order  public.food_orders%ROWTYPE;
BEGIN
  IF v_code !~ '^[0-9A-Z]{6}$' THEN
    PERFORM public.pelham_order_fail('400', 'That is not an order code.');
  END IF;

  -- 같은 코드로 두 번 눌러도 한 번만 바뀌도록 줄을 잠급니다.
  SELECT * INTO v_order FROM public.food_orders WHERE code = v_code FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.pelham_order_fail('404', 'No order with that code.');
  END IF;

  -- 이미 취소된 것은 취소된 것입니다. 두 번째 탭에서 누른 것일 수도 있고,
  -- 신호가 끊겨 다시 보낸 것일 수도 있습니다 - 어느 쪽도 오류가 아닙니다.
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'code', v_order.code, 'customer_name', v_order.customer_name,
      'items', v_order.items, 'total_cents', v_order.total_cents,
      'pickup_at', v_order.pickup_at, 'status', v_order.status,
      'created_at', v_order.created_at
    );
  END IF;

  IF v_order.status = 'picked_up' THEN
    PERFORM public.pelham_order_fail('409',
      'That order has already been picked up.');
  END IF;

  IF v_order.status = 'ready' THEN
    PERFORM public.pelham_order_fail('409',
      'The pro shop has already made this one. Please call them.');
  END IF;

  IF v_order.pickup_at < now() THEN
    PERFORM public.pelham_order_fail('409',
      'The pickup time has passed. Please call the pro shop.');
  END IF;

  UPDATE public.food_orders
     SET status = 'cancelled'
   WHERE code = v_code
  RETURNING * INTO v_order;

  -- 프로 샵 폰에 알림. 새 주문과 같은 장치(0010 의 topics, 0012 의 proshop)를
  -- 씁니다. 취소야말로 빨리 알아야 하는 소식입니다 - 카운터 화면은 20 초마다
  -- 다시 읽지만, 주방에서 등지고 있는 사람은 그 화면을 보고 있지 않습니다.
  -- 손님 이름과 전화는 넣지 않습니다. 잠금 화면에 뜨는 글입니다.
  IF to_regclass('public.push_campaigns') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.push_campaigns (title, body, url, topic, scheduled_at)
      VALUES (
        'Order cancelled',
        format('Code %s · pickup %s · was $%s',
               v_order.code,
               to_char(v_order.pickup_at AT TIME ZONE 'America/Toronto', 'HH12:MI AM'),
               to_char(v_order.total_cents / 100.0, 'FM999990.00')),
        '/admin',
        'proshop',
        now()
      );
    EXCEPTION WHEN others THEN
      NULL;  -- 알림이 안 나가도 취소는 됩니다.
    END;
  END IF;

  RETURN jsonb_build_object(
    'code', v_order.code, 'customer_name', v_order.customer_name,
    'items', v_order.items, 'total_cents', v_order.total_cents,
    'pickup_at', v_order.pickup_at, 'status', v_order.status,
    'created_at', v_order.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_food_order(text) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_food_order(text) TO anon, authenticated;
