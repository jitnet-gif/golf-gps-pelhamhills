-- ============================================================================
-- 0025 친구 소개 → 카트 무료 적립 (다음 방문에 사용)
-- ============================================================================
--
-- 쿠폰북 코드(0023)가 그대로 소개 코드입니다. 흐름:
--   1. A 가 쿠폰북 화면에서 자기 코드를 친구 B 에게 보냅니다.
--   2. B 는 GPS 앱에 가입해 쿠폰북 화면의 "소개 코드" 칸에 A 의 코드를 넣습니다.
--   3. B 가 **첫 라운드 도장**을 받는 순간 A 에게 카트 무료 1회가 쌓입니다.
--   4. A 는 다음에 올 때 카운터에서 코드를 보여 주고 카트를 무료로 씁니다.
--
-- ## 왜 가입이 아니라 첫 도장에서 주는가
-- 이메일 확인이 꺼져 있어 가입은 공짜입니다. 가입만으로 주면 가짜 이메일 열 개로
-- 카트 열 번입니다. 도장은 카운터에서 돈을 받은 사람이 찍으므로(0023), 친구가
-- 실제로 와서 쳤다는 뜻입니다.
--
-- ## 규칙 (서버가 지킵니다)
--   - 소개 코드는 한 번만, 그리고 아직 도장이 없는 계정만 넣을 수 있습니다
--     (오래 다닌 손님이 뒤늦게 서로 코드를 바꿔 넣는 것을 막음).
--   - 자기 코드는 넣을 수 없습니다.
--   - 친구의 첫 도장을 되돌리면(coupon_undo) 아직 안 쓴 카트 적립도 같이 빠집니다.
--
-- 장부는 0023 의 coupon_entries 를 그대로 씁니다. 종류가 둘 늘어납니다:
--   cart_credit  카트 무료 1회 적립 (소개 보상)
--   cart_redeem  카트 무료 1회 사용
--
-- 먼저: 0023_coupon_book.sql. 여러 번 실행해도 안전합니다.
-- ============================================================================

ALTER TABLE public.coupon_entries DROP CONSTRAINT IF EXISTS coupon_entries_kind_check;
ALTER TABLE public.coupon_entries ADD CONSTRAINT coupon_entries_kind_check
  CHECK (kind IN ('stamp', 'redeem', 'cart_credit', 'cart_redeem'));

CREATE TABLE IF NOT EXISTS public.coupon_referrals (
  -- 소개받은 사람. 한 사람은 한 번만 소개받습니다.
  friend_id       uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  referrer_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 보상이 나간 장부 줄. 친구의 첫 도장을 되돌릴 때 이 줄을 찾아 뺍니다.
  credit_entry_id bigint REFERENCES public.coupon_entries (id) ON DELETE SET NULL,
  rewarded_at     timestamptz,
  CHECK (friend_id <> referrer_id)
);

CREATE INDEX IF NOT EXISTS coupon_referrals_referrer ON public.coupon_referrals (referrer_id);

ALTER TABLE public.coupon_referrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_referrals FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 요약에 카트와 소개를 더합니다 (0023 의 것을 바꿔 씁니다)
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
  )
  SELECT jsonb_build_object(
    'code', (SELECT code FROM public.coupon_books WHERE owner_id = p_owner),
    'stamps', c.stamps,
    'on_card', c.stamps % 10,
    'free_earned', c.stamps / 10,
    'free_left', c.stamps / 10 - c.redeemed,
    'redeemed', c.redeemed,
    'stamped_today', c.stamped_today > 0,
    'carts_left', c.carts - c.carts_used,
    'carts_used', c.carts_used,
    -- 이 사람이 소개해서 첫 라운드까지 친 친구 수 / 아직 안 온 친구 수
    'friends_rewarded', (SELECT count(*) FROM public.coupon_referrals
                          WHERE referrer_id = p_owner AND rewarded_at IS NOT NULL),
    'friends_pending', (SELECT count(*) FROM public.coupon_referrals
                         WHERE referrer_id = p_owner AND rewarded_at IS NULL),
    'referred', EXISTS (SELECT 1 FROM public.coupon_referrals WHERE friend_id = p_owner),
    'can_enter_referral', c.stamps = 0
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
  FROM counts c
$$;

REVOKE ALL ON FUNCTION public.coupon_summary(uuid) FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 손님: 소개 코드 넣기
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
-- 직원: 도장 찍기 - 친구의 첫 도장이면 소개한 사람에게 카트 무료를 쌓습니다
-- ----------------------------------------------------------------------------
-- 돌려주는 요약에 'referral_rewarded' (소개한 사람 이메일)가 붙으면 직원
-- 화면이 그것을 알려 줍니다.
CREATE OR REPLACE FUNCTION public.coupon_stamp(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ref     public.coupon_referrals;
  v_credit  bigint;
  v_rewarded text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('coupon:' || p_owner::text));
  IF (public.coupon_summary(p_owner) ->> 'stamped_today')::boolean THEN
    RAISE EXCEPTION '오늘은 이미 도장을 찍었습니다.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.coupon_entries (owner_id, kind, staff_id)
  VALUES (p_owner, 'stamp', auth.uid());

  SELECT * INTO v_ref FROM public.coupon_referrals
   WHERE friend_id = p_owner AND rewarded_at IS NULL
   FOR UPDATE;
  IF v_ref.friend_id IS NOT NULL THEN
    INSERT INTO public.coupon_entries (owner_id, kind, staff_id)
    VALUES (v_ref.referrer_id, 'cart_credit', auth.uid())
    RETURNING id INTO v_credit;
    UPDATE public.coupon_referrals
       SET rewarded_at = now(), credit_entry_id = v_credit
     WHERE friend_id = p_owner;
    SELECT email INTO v_rewarded FROM auth.users WHERE id = v_ref.referrer_id;
  END IF;

  RETURN public.coupon_summary(p_owner)
    || CASE WHEN v_rewarded IS NOT NULL
            THEN jsonb_build_object('referral_rewarded', v_rewarded)
            ELSE '{}'::jsonb END;
END
$$;

-- ----------------------------------------------------------------------------
-- 직원: 카트 무료 쓰기
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_redeem_cart(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('coupon:' || p_owner::text));
  IF (public.coupon_summary(p_owner) ->> 'carts_left')::int < 1 THEN
    RAISE EXCEPTION '쓸 수 있는 카트 무료가 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.coupon_entries (owner_id, kind, staff_id)
  VALUES (p_owner, 'cart_redeem', auth.uid());
  RETURN public.coupon_summary(p_owner);
END
$$;

-- ----------------------------------------------------------------------------
-- 직원: 되돌리기 - 친구의 첫 도장을 무르면 그 보상도 무릅니다
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_undo(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry public.coupon_entries;
  v_ref   public.coupon_referrals;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('coupon:' || p_owner::text));
  SELECT * INTO v_entry FROM public.coupon_entries
   WHERE owner_id = p_owner
   ORDER BY created_at DESC, id DESC
   LIMIT 1;
  IF v_entry.id IS NULL OR v_entry.created_at <= now() - interval '30 minutes' THEN
    RAISE EXCEPTION '30분 안에 찍은 것만 되돌릴 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  -- 소개 보상으로 받은 카트는 받은 사람 쪽에서 무르지 않습니다(친구 쪽 도장을
  -- 되돌리면 같이 빠집니다).
  IF v_entry.kind = 'cart_credit' THEN
    RAISE EXCEPTION '소개 보상은 친구의 첫 도장을 되돌려야 빠집니다.' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.coupon_entries WHERE id = v_entry.id;

  IF v_entry.kind = 'stamp'
     AND NOT EXISTS (SELECT 1 FROM public.coupon_entries WHERE owner_id = p_owner AND kind = 'stamp') THEN
    SELECT * INTO v_ref FROM public.coupon_referrals
     WHERE friend_id = p_owner AND rewarded_at IS NOT NULL
     FOR UPDATE;
    IF v_ref.friend_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext('coupon:' || v_ref.referrer_id::text));
      -- 소개한 사람이 그 카트를 이미 썼으면 장부를 맞추느라 남의 기록을 지우지
      -- 않습니다. 카트는 이미 나갔고, 그것은 직원이 판단할 일입니다.
      IF (public.coupon_summary(v_ref.referrer_id) ->> 'carts_left')::int > 0 THEN
        DELETE FROM public.coupon_entries WHERE id = v_ref.credit_entry_id;
      END IF;
      UPDATE public.coupon_referrals
         SET rewarded_at = NULL, credit_entry_id = NULL
       WHERE friend_id = p_owner;
    END IF;
  END IF;

  RETURN public.coupon_summary(p_owner);
END
$$;

REVOKE ALL ON FUNCTION public.coupon_stamp(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.coupon_redeem_cart(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.coupon_undo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.coupon_stamp(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_redeem_cart(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_undo(uuid) TO authenticated;
