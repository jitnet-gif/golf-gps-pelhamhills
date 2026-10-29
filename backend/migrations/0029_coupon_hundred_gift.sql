-- ============================================================================
-- 0029 쿠폰북 라운드 100번 = 기념품 하나
-- ============================================================================
--
-- 클럽 요청(2026-10-29): "쿠폰북 100회 라운드시 기념품 증정".
--
-- 라운드 수 = 도장(유료 라운드) + 쓴 무료 라운드. 무료로 친 라운드에는 도장이 없지만
-- (0027) 라운드는 라운드라 셉니다. 100, 200, 300 ... 마다 기념품이 하나씩 생깁니다.
--
-- 기념품은 물건이라 계산서 금액은 바꾸지 않습니다. 직원이 건네고 "줬다" 를 누르면
-- 장부에 kind = 'gift' 한 줄이 남습니다. 받을 기념품 = floor(라운드 / 100) - 준 수.
--   - 티 시트 계산서(pelhamhills 0138)에 그 선수 줄 아래 "Souvenir due" 와 버튼이 뜹니다.
--   - /fnb 쿠폰북 칸에도 "기념품 줬음" 버튼이 있습니다(앱만 있고 예약이 안 이어진 손님).
--   - 손님 /coupons 에 다음 기념품까지 남은 라운드와 "받을 기념품이 있어요" 가 보입니다.
-- 잘못 눌렀으면 /fnb 되돌리기(30분 안 가장 최근 줄, 0023) 또는 계산서의 Undo.
--
-- 회원은 도장이 없으니(0026) 라운드도 쌓이지 않습니다. 회원이 되기 전에 채운 기념품은 받습니다.
--
-- 바뀌는 것
--   - coupon_entries.kind 에 'gift'
--   - coupon_summary   rounds, gifts_earned, gifts_given, gift_due, rounds_to_gift (0028 의 것 + 몇 줄)
--   - coupon_give_gift(p_owner, p_booking, p_player)  기념품 한 줄 (내부용, 받을 것이 없으면 거절)
--   - coupon_gift(p_owner)                             /fnb 직원 버튼
--
-- 먼저: 0028_coupon_member_no_referral.sql. 여러 번 실행해도 안전합니다.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.coupon_give_stamp(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION '0029 needs 0027/0028 first.';
  END IF;
END
$$;

ALTER TABLE public.coupon_entries DROP CONSTRAINT IF EXISTS coupon_entries_kind_check;
ALTER TABLE public.coupon_entries ADD CONSTRAINT coupon_entries_kind_check
  CHECK (kind IN ('stamp', 'redeem', 'cart_credit', 'cart_redeem', 'gift'));

-- ----------------------------------------------------------------------------
-- 1. 요약에 라운드·기념품 (0028 의 것 + 몇 줄)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_summary(p_owner uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH counts AS (
    SELECT
      count(*) FILTER (WHERE kind = 'stamp')       AS stamps,
      count(*) FILTER (WHERE kind = 'redeem')      AS redeemed,
      count(*) FILTER (WHERE kind = 'cart_credit') AS carts,
      count(*) FILTER (WHERE kind = 'cart_redeem') AS carts_used,
      count(*) FILTER (WHERE kind = 'gift')        AS gifts,
      count(*) FILTER (
        WHERE kind = 'stamp'
          AND (created_at AT TIME ZONE 'America/Toronto')::date
              = (now() AT TIME ZONE 'America/Toronto')::date
      ) AS stamped_today
    FROM public.coupon_entries
    WHERE owner_id = p_owner
  ),
  member AS (
    SELECT public.coupon_is_member(p_owner) AS yes
  )
  SELECT jsonb_build_object(
    'code', (SELECT code FROM public.coupon_books WHERE owner_id = p_owner),
    'is_member', mb.yes,
    'can_refer', NOT mb.yes,
    'stamps', c.stamps,
    'on_card', c.stamps % 10,
    'free_earned', c.stamps / 10,
    'free_left', c.stamps / 10 - c.redeemed,
    'redeemed', c.redeemed,
    'stamped_today', c.stamped_today > 0,
    'rounds', c.stamps + c.redeemed,
    'gifts_earned', (c.stamps + c.redeemed) / 100,
    'gifts_given', c.gifts,
    -- 도장이 환불로 빠져 준 수가 더 많아질 수 있습니다. 음수는 0 으로.
    'gift_due', greatest((c.stamps + c.redeemed) / 100 - c.gifts, 0),
    'rounds_to_gift', 100 - (c.stamps + c.redeemed) % 100,
    'carts_left', c.carts - c.carts_used,
    'carts_used', c.carts_used,
    'friends_rewarded', (SELECT count(*) FROM public.coupon_referrals
                          WHERE referrer_id = p_owner AND rewarded_at IS NOT NULL),
    'friends_pending', (SELECT count(*) FROM public.coupon_referrals
                         WHERE referrer_id = p_owner AND rewarded_at IS NULL),
    'referred', EXISTS (SELECT 1 FROM public.coupon_referrals WHERE friend_id = p_owner),
    'can_enter_referral', c.stamps = 0
      AND NOT mb.yes
      AND NOT EXISTS (SELECT 1 FROM public.coupon_referrals WHERE friend_id = p_owner),
    'history', coalesce((
      SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.created_at)
                       ORDER BY e.created_at DESC)
      FROM (
        SELECT kind, created_at FROM public.coupon_entries
        WHERE owner_id = p_owner
        ORDER BY created_at DESC
        LIMIT 30
      ) e
    ), '[]'::jsonb)
  )
  FROM counts c, member mb
$$;

REVOKE ALL ON FUNCTION public.coupon_summary(uuid) FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. 기념품 한 줄 (내부용) - 티 시트 계산서(pelhamhills 0138)와 /fnb 가 같이 씁니다
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_give_gift(p_owner uuid, p_booking text, p_player text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sum jsonb;
BEGIN
  -- 두 계산대가 같은 기념품을 두 번 적지 않게(0023 과 같은 잠금).
  PERFORM pg_advisory_xact_lock(hashtext('coupon:' || p_owner::text));
  v_sum := public.coupon_summary(p_owner);
  IF (v_sum ->> 'gift_due')::int < 1 THEN
    RAISE EXCEPTION 'No souvenir due yet - % more rounds to go.', v_sum ->> 'rounds_to_gift'
      USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.coupon_entries (owner_id, kind, staff_id, booking_id, player_id)
  VALUES (p_owner, 'gift', auth.uid(), p_booking, p_player);
  RETURN public.coupon_summary(p_owner);
END
$$;

REVOKE ALL ON FUNCTION public.coupon_give_gift(uuid, text, text) FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. /fnb 직원 버튼
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_gift(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;
  RETURN public.coupon_give_gift(p_owner, NULL, NULL);
END
$$;

REVOKE ALL ON FUNCTION public.coupon_gift(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.coupon_gift(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
