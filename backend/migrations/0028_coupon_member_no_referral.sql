-- ============================================================================
-- 0028 멤버는 친구 소개 보상(카트 무료)을 받지 않습니다
-- ============================================================================
--
-- 0026 으로 멤버는 도장이 없어졌습니다. 클럽이 2026-10-23 친구 소개도 막자고
-- 했습니다 - 멤버가 자기 코드로 친구를 소개해 카트 무료를 쌓을 수 없습니다.
--
-- 바뀌는 것
--   - coupon_set_referrer  친구가 넣은 코드의 주인이 멤버면 거절합니다.
--   - coupon_give_stamp    친구의 첫 도장 때 소개한 사람이 그때 멤버면 보상 없이
--                          그 소개를 지웁니다(코드를 넣은 뒤에 멤버가 된 경우).
--   - coupon_summary       'can_refer' (멤버가 아니면 참) - 화면이 초대 칸을 숨깁니다.
--
-- 이미 쌓인 카트 무료는 그대로 둡니다(쓸 수 있습니다).
--
-- 먼저: 0027_coupon_auto_stamp.sql. 여러 번 실행해도 안전합니다.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.coupon_give_stamp(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION '0028 needs 0027_coupon_auto_stamp.sql first.';
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 1. 요약에 can_refer (0026 의 것 + 한 줄)
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
-- 2. 소개 코드 넣기 - 멤버의 코드는 거절 (0025 의 것 + 멤버 검사)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_set_referrer(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_referrer uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('coupon:' || v_me::text));

  SELECT owner_id INTO v_referrer FROM public.coupon_books
   WHERE code = upper(replace(btrim(coalesce(p_code, '')), ' ', ''));
  IF v_referrer IS NULL THEN
    RAISE EXCEPTION 'That code was not found. Check it with your friend.' USING ERRCODE = 'P0001';
  END IF;
  IF v_referrer = v_me THEN
    RAISE EXCEPTION 'That is your own code - enter the code of the friend who invited you.'
      USING ERRCODE = 'P0001';
  END IF;
  IF public.coupon_is_member(v_referrer) THEN
    RAISE EXCEPTION 'Member codes can''t be used for friend rewards.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.coupon_referrals WHERE friend_id = v_me) THEN
    RAISE EXCEPTION 'You have already entered a friend''s code.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.coupon_entries WHERE owner_id = v_me AND kind = 'stamp') THEN
    RAISE EXCEPTION 'Friend codes are for new players before their first round.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.coupon_referrals (friend_id, referrer_id) VALUES (v_me, v_referrer);
  RETURN public.coupon_summary(v_me);
END
$$;

REVOKE ALL ON FUNCTION public.coupon_set_referrer(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.coupon_set_referrer(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. 도장 하나 찍기 - 소개한 사람이 멤버면 보상 없음 (0027 의 것 + 멤버 검사)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_give_stamp(p_owner uuid, p_booking text, p_player text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ref      public.coupon_referrals;
  v_credit   bigint;
  v_rewarded text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('coupon:' || p_owner::text));
  IF public.coupon_is_member(p_owner) THEN
    RETURN jsonb_build_object('stamped', false, 'reason', 'member');
  END IF;
  IF (public.coupon_summary(p_owner) ->> 'stamped_today')::boolean THEN
    RETURN jsonb_build_object('stamped', false, 'reason', 'today');
  END IF;

  INSERT INTO public.coupon_entries (owner_id, kind, staff_id, booking_id, player_id)
  VALUES (p_owner, 'stamp', auth.uid(), p_booking, p_player);

  SELECT * INTO v_ref FROM public.coupon_referrals
   WHERE friend_id = p_owner AND rewarded_at IS NULL
   FOR UPDATE;
  IF v_ref.friend_id IS NOT NULL THEN
    IF public.coupon_is_member(v_ref.referrer_id) THEN
      -- 코드를 넣은 뒤에 소개한 사람이 멤버가 됐습니다. 보상 없이 소개를 지웁니다.
      DELETE FROM public.coupon_referrals WHERE friend_id = p_owner;
    ELSE
      INSERT INTO public.coupon_entries (owner_id, kind, staff_id)
      VALUES (v_ref.referrer_id, 'cart_credit', auth.uid())
      RETURNING id INTO v_credit;
      UPDATE public.coupon_referrals
         SET rewarded_at = now(), credit_entry_id = v_credit
       WHERE friend_id = p_owner;
      SELECT email INTO v_rewarded FROM auth.users WHERE id = v_ref.referrer_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('stamped', true)
    || CASE WHEN v_rewarded IS NOT NULL
            THEN jsonb_build_object('referral_rewarded', v_rewarded)
            ELSE '{}'::jsonb END;
END
$$;

REVOKE ALL ON FUNCTION public.coupon_give_stamp(uuid, text, text) FROM public, anon, authenticated;

NOTIFY pgrst, 'reload schema';
