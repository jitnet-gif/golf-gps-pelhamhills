-- ============================================================================
-- 0026 쿠폰북에서 회원 제외
-- ============================================================================
--
-- 쿠폰북(라운드 10번 = 1번 무료, 0023)은 그린피를 내는 일반 손님 것입니다.
-- 회원은 회원권으로 치므로 도장이 없습니다 - 서버가 도장을 거절합니다.
--
-- ## 누가 회원인가
-- 같은 Supabase 프로젝트의 pelhamhills 고객 명부를 봅니다. 이 계정의 손님 기록은
--   1. 프로 샵 QR 로 이어 둔 기록 (pelham_customers.gps_user_id, pelhamhills 0084), 또는
--   2. 가입 이메일과 같은 이메일의 기록
-- 그 기록의 회원 여부는 프로 샵 고객 검색(pelhamhills 0069)과 같은 규칙입니다:
-- 가장 최근 시즌 회원권(취소 제외)이 있고 만료일이 안 지났으면 회원, 회원권 줄이 없으면
-- 명부의 is_member. 명부에 아직 없는 새 회원(회원권 줄만 있음)은 회원권의 이메일로 찾습니다.
--
-- 회원권이 끝나면 다음 날부터 다시 도장을 받습니다. 회원이 되기 전에 모은 무료 라운드는
-- 그대로 남고 쓸 수 있습니다(지우지 않습니다).
--
-- 바뀌는 것
--   - coupon_is_member(owner)  내부용.
--   - coupon_summary           'is_member' 를 더하고, 회원이면 소개 코드 칸을 닫습니다
--                              (회원은 첫 도장이 없으니 소개한 친구가 보상을 못 받습니다).
--   - coupon_stamp             회원이면 거절.
--
-- 먼저: 0025_referral_cart.sql, 그리고 pelhamhills 쪽 0069_membership_expiry.sql,
-- 0084_customer_qr.sql. 여러 번 실행해도 안전합니다.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.coupon_referrals') IS NULL THEN
    RAISE EXCEPTION '0026 needs 0025_referral_cart.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'pelham_memberships'
                    AND column_name = 'expires_on') THEN
    RAISE EXCEPTION '0026 needs pelhamhills 0069_membership_expiry.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'pelham_customers'
                    AND column_name = 'gps_user_id') THEN
    RAISE EXCEPTION '0026 needs pelhamhills 0084_customer_qr.sql first.';
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 1. 이 계정이 지금 회원인가 (내부용)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_is_member(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS (
    SELECT lower(btrim(coalesce(u.email, ''))) AS email,
           (now() AT TIME ZONE 'America/Toronto')::date AS today
      FROM auth.users u
     WHERE u.id = p_owner
  )
  SELECT EXISTS (
           SELECT 1
             FROM me
             JOIN public.pelham_customers c
               ON c.gps_user_id = p_owner
               OR (me.email <> '' AND lower(btrim(coalesce(c.email, ''))) = me.email)
             LEFT JOIN LATERAL (
               SELECT x.* FROM public.pelham_memberships x
                WHERE x.customer_ref = c.customer_ref AND x.status <> 'cancelled'
                ORDER BY x.season DESC, x.created_at DESC
                LIMIT 1
             ) m ON true
            WHERE CASE WHEN m.expires_on < me.today THEN false
                       ELSE (c.is_member OR m.id IS NOT NULL) END
         )
      OR EXISTS (
           SELECT 1
             FROM me
             JOIN public.pelham_memberships x
               ON x.customer_ref IS NULL
              AND x.status <> 'cancelled'
              AND me.email <> ''
              AND lower(btrim(coalesce(x.email, ''))) = me.email
            WHERE coalesce(x.expires_on >= me.today, true)
         )
$$;

REVOKE ALL ON FUNCTION public.coupon_is_member(uuid) FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. 요약에 회원 여부 (0025 의 것 + is_member)
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
-- 3. 도장 찍기 - 회원이면 거절 (0025 의 것 + 회원 검사)
-- ----------------------------------------------------------------------------
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
  IF public.coupon_is_member(p_owner) THEN
    RAISE EXCEPTION '회원은 쿠폰북 도장 대상이 아닙니다(회원권으로 칩니다).' USING ERRCODE = 'P0001';
  END IF;
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

REVOKE ALL ON FUNCTION public.coupon_stamp(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.coupon_stamp(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
