-- ============================================================================
-- 0031 앱 가입 - 회원은 멤버십 카드 등록, 비회원은 쿠폰북 등록
-- ============================================================================
--
-- 클럽 요청(2026-10-31): "회원과 비회원 가입을 통한 맴버쉽카드 등록 및 쿠폰북 등록".
--
-- 지금까지 앱 가입은 이메일 + 비밀번호뿐이고, 회원 여부는 이메일이 명부와 같을 때만
-- 알 수 있었습니다. /join 에서 가입할 때 회원/비회원을 고릅니다.
--
--   비회원  이름(전화는 선택) -> 프로필 + 쿠폰북. 명부(pelham_customers)에는 넣지 않습니다.
--           명부에 새 손님을 넣는 일은 매니저 승인입니다(pelhamhills 0054, 0084).
--   회원    카드 값 + 연락처 -> 프로필 + 회원권 연결 + 쿠폰북. 지갑(/coupons)에 카드가 뜹니다.
--
-- ## 회원 본인 확인
-- 카드 값은 회원권 바코드(MEM-2027-A1B2C3, pelhamhills 0151) 또는 회원 번호입니다.
-- 거기에 예약 사이트 회원 등록(pelhamhills 0111)과 같은 확인을 더합니다 - 전화 끝 7자리 이상
-- (최대 10자리)이 같아야 합니다. 이메일이 같아도 되는 것은 바코드로 등록할 때뿐입니다: 앱 가입은
-- 이메일을 확인하지 않아서(lib/auth) 남의 이메일로 계정을 만들 수 있고, 회원 번호는 짐작할 수 있습니다.
-- 어느 쪽이 틀렸는지는 알려 주지 않습니다. 계정당 5번 틀리면 15분 잠급니다.
-- 프로 샵 QR(PHC-) + 생년월일로 잇는 길(pelham_gps_link)은 그대로이고, 그렇게 이어도 카드가 뜹니다.
--
-- ## 부부 회원권
-- 회원권 하나를 같이 씁니다(0151). pelham_customers.gps_user_id 는 한 계정뿐이라, 이미 다른
-- 계정이 잡고 있으면 그대로 두고 프로필로만 잇습니다. 빼앗지 않습니다.
--
-- ## 카드에 보이는 것
-- 바코드는 시간을 쓰는 코드라 등록한 계정에만, 그리고 완납한 회원권일 때만 내려줍니다
-- (계산서도 완납한 회원권만 받습니다, 0151). 이메일만 같은 계정에는 내려주지 않습니다.
--
-- 바뀌는 것
--   - gps_profiles, gps_join_tries          표 (직접 읽고 쓰지 않습니다)
--   - gps_live_membership(owner)            내부용. 이 계정의 살아 있는 회원권 한 줄
--   - coupon_is_member                      0026 의 것 + 프로필로 이은 회원권
--   - gps_my_profile()                      손님: 내 가입 상태와 카드
--   - gps_join_guest(p_name, p_phone)       손님: 비회원 가입
--   - gps_join_member(p_card, p_phone)      손님: 회원 카드 등록
--
-- 먼저: 0029_coupon_hundred_gift.sql, 그리고 pelhamhills 쪽 0151_membership_card_sim_hours.sql.
-- 여러 번 실행해도 안전합니다.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.coupon_is_member(uuid)') IS NULL THEN
    RAISE EXCEPTION '0031 needs 0026_coupon_members_excluded.sql first.';
  END IF;
  IF to_regprocedure('public.my_coupon_book()') IS NULL THEN
    RAISE EXCEPTION '0031 needs 0023_coupon_book.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'pelham_memberships'
                    AND column_name = 'member_code') THEN
    RAISE EXCEPTION '0031 needs pelhamhills 0151_membership_card_sim_hours.sql first.';
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 1. 표
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gps_profiles (
  owner_id      uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('member', 'guest')),
  full_name     text NOT NULL,
  phone         text,
  -- 회원만. 다음 시즌 회원권은 customer_ref 로 찾습니다. 명부에 없는 회원은 membership_id 뿐입니다.
  customer_ref  text,
  membership_id uuid REFERENCES public.pelham_memberships (id) ON DELETE SET NULL,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gps_join_tries (
  owner_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  tries        integer NOT NULL DEFAULT 0,
  locked_until timestamptz
);

ALTER TABLE public.gps_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_join_tries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gps_profiles FROM anon, authenticated;
REVOKE ALL ON public.gps_join_tries FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. 이 계정의 살아 있는 회원권 (내부용)
-- ----------------------------------------------------------------------------
-- 프로필로 이었거나 프로 샵 QR 로 이은 계정만입니다. 이메일만 같은 경우는 넣지 않습니다
-- - 카드와 바코드를 내려주는 근거라서, 이메일 확인 없는 가입으로 열리면 안 됩니다.
CREATE OR REPLACE FUNCTION public.gps_live_membership(p_owner uuid)
RETURNS public.pelham_memberships
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.*
    FROM public.pelham_memberships m
   WHERE m.status <> 'cancelled'
     AND coalesce(m.expires_on >= (now() AT TIME ZONE 'America/Toronto')::date, true)
     AND (EXISTS (SELECT 1 FROM public.gps_profiles p
                   WHERE p.owner_id = p_owner AND p.kind = 'member'
                     AND (p.membership_id = m.id OR p.customer_ref = m.customer_ref))
          OR EXISTS (SELECT 1 FROM public.pelham_customers c
                      WHERE c.gps_user_id = p_owner AND c.customer_ref = m.customer_ref))
   ORDER BY m.season DESC, m.created_at DESC
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.gps_live_membership(uuid) FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. 회원 판정 (0026 의 것 + 프로필로 이은 회원권)
-- ----------------------------------------------------------------------------
-- 가입 이메일이 명부와 다르거나 부부 회원권의 두 번째 계정이면 0026 의 규칙으로는 안 보입니다.
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
      OR (public.gps_live_membership(p_owner)).id IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.coupon_is_member(uuid) FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. 손님: 내 가입 상태와 카드
-- ----------------------------------------------------------------------------
-- kind 가 null 이면 아직 /join 을 안 거친 계정입니다. is_member 만 참이면 이메일로 알아본
-- 회원이라, 화면이 카드 등록을 권합니다.
CREATE OR REPLACE FUNCTION public.gps_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'America/Toronto')::date;
  v_p     public.gps_profiles;
  v_m     public.pelham_memberships;
  v_paid  boolean;
  v_left  numeric := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.gps_profiles WHERE owner_id = v_me;
  v_m := public.gps_live_membership(v_me);

  IF v_m.id IS NOT NULL THEN
    v_paid := public.pelham_membership_paid_in_full(v_m);
    IF public.pelham_membership_sim_expires(v_m.season) >= v_today THEN
      v_left := greatest(public.pelham_membership_sim_allowance(v_m.membership_type)
                         - coalesce(v_m.sim_hours_used, 0), 0);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind', v_p.kind,
    'name', v_p.full_name,
    'is_member', public.coupon_is_member(v_me),
    'coupon_code', (SELECT code FROM public.coupon_books WHERE owner_id = v_me),
    'card', CASE WHEN v_m.id IS NULL THEN NULL ELSE jsonb_build_object(
      'member_name', v_m.member_name,
      'membership_type', v_m.membership_type,
      'season', v_m.season,
      'member_number', coalesce(
        nullif(btrim(v_m.member_number), ''),
        (SELECT nullif(btrim(c.member_number), '') FROM public.pelham_customers c
          WHERE c.customer_ref = v_m.customer_ref)),
      'member_code', CASE WHEN v_paid THEN v_m.member_code END,
      'paid_in_full', v_paid,
      'expires_on', v_m.expires_on,
      'sim_hours_left', v_left,
      'sim_expires_on', public.pelham_membership_sim_expires(v_m.season)
    ) END
  );
END
$$;

REVOKE ALL ON FUNCTION public.gps_my_profile() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gps_my_profile() TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. 손님: 비회원 가입
-- ----------------------------------------------------------------------------
-- 이미 회원으로 등록한 계정은 그대로 둡니다. 내리지도, 명부의 이름을 덮어쓰지도 않습니다.
CREATE OR REPLACE FUNCTION public.gps_join_guest(p_name text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_name  text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF length(v_name) < 2 OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Enter your full name.' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_phone) = 11 AND left(v_phone, 1) = '1' THEN
    v_phone := substr(v_phone, 2);
  END IF;
  IF v_phone <> '' AND length(v_phone) <> 10 THEN
    RAISE EXCEPTION 'A phone number has 10 digits.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.gps_profiles (owner_id, kind, full_name, phone)
  VALUES (v_me, 'guest', v_name, nullif(v_phone, ''))
  ON CONFLICT (owner_id) DO UPDATE
    SET full_name = excluded.full_name, phone = excluded.phone, updated_at = now()
    WHERE public.gps_profiles.kind = 'guest';

  PERFORM public.my_coupon_book();
  RETURN public.gps_my_profile();
END
$$;

REVOKE ALL ON FUNCTION public.gps_join_guest(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gps_join_guest(text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. 손님: 회원 카드 등록
-- ----------------------------------------------------------------------------
-- 실패는 raise 하지 않고 {error} 로 돌려줍니다 - raise 하면 틀린 횟수까지 되돌려집니다(pelhamhills 0111).
-- 비회원으로 먼저 가입한 계정은 같은 프로필을 회원으로 바꿉니다.
CREATE OR REPLACE FUNCTION public.gps_join_member(p_card text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_card  text := upper(replace(btrim(coalesce(p_card, '')), ' ', ''));
  v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_today date := (now() AT TIME ZONE 'America/Toronto')::date;
  v_email text;
  v_m     public.pelham_memberships;
  v_c     public.pelham_customers;
  v_tries public.gps_join_tries;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gps-join:' || v_me::text));

  SELECT * INTO v_tries FROM public.gps_join_tries WHERE owner_id = v_me;
  IF v_tries.locked_until > now() THEN
    RETURN jsonb_build_object('error', 'Too many tries. Please wait 15 minutes and try again.');
  END IF;

  SELECT lower(btrim(coalesce(u.email, ''))) INTO v_email FROM auth.users u WHERE u.id = v_me;

  -- 빈 카드 값은 회원 번호가 빈 줄과 맞아 버립니다.
  IF v_card <> '' THEN
    SELECT m.* INTO v_m
      FROM public.pelham_memberships m
      LEFT JOIN public.pelham_customers c ON c.customer_ref = m.customer_ref
     WHERE m.status <> 'cancelled'
       AND coalesce(m.expires_on >= v_today, true)
       AND ((upper(m.member_code) = v_card
             AND v_email <> ''
             AND v_email IN (lower(btrim(coalesce(m.email, ''))), lower(btrim(coalesce(c.email, '')))))
            OR ((upper(m.member_code) = v_card
                 OR upper(btrim(coalesce(m.member_number, ''))) = v_card
                 OR upper(btrim(coalesce(c.member_number, ''))) = v_card)
                AND length(v_phone) >= 7
                AND v_phone IN (right(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g'), 10),
                                right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10))))
     ORDER BY m.season DESC, m.created_at DESC
     LIMIT 1;
  END IF;

  IF v_m.id IS NULL THEN
    INSERT INTO public.gps_join_tries (owner_id, tries) VALUES (v_me, 1)
    ON CONFLICT (owner_id) DO UPDATE
      SET tries = CASE WHEN public.gps_join_tries.tries >= 4 THEN 0 ELSE public.gps_join_tries.tries + 1 END,
          locked_until = CASE WHEN public.gps_join_tries.tries >= 4 THEN now() + interval '15 minutes' END;
    RETURN jsonb_build_object(
      'error', 'That card and phone don''t match an active membership. Ask the pro shop.');
  END IF;

  DELETE FROM public.gps_join_tries WHERE owner_id = v_me;

  IF v_m.customer_ref IS NOT NULL THEN
    SELECT * INTO v_c FROM public.pelham_customers c WHERE c.customer_ref = v_m.customer_ref FOR UPDATE;
    IF v_c.gps_user_id IS NULL THEN
      -- 한 계정은 한 사람(pelham_gps_link 와 같습니다). 다른 손님에 이어져 있었으면 옮깁니다.
      UPDATE public.pelham_customers c SET gps_user_id = NULL, updated_at = now()
       WHERE c.gps_user_id = v_me AND c.customer_ref <> v_m.customer_ref;
      UPDATE public.pelham_customers c SET gps_user_id = v_me, updated_at = now()
       WHERE c.customer_ref = v_m.customer_ref;
    END IF;
  END IF;

  INSERT INTO public.gps_profiles (owner_id, kind, full_name, phone, customer_ref, membership_id)
  VALUES (v_me, 'member',
          coalesce(nullif(btrim(v_c.display_name), ''),
                   nullif(btrim(concat_ws(' ', v_c.first_name, v_c.last_name)), ''),
                   btrim(v_m.member_name)),
          nullif(v_phone, ''), v_m.customer_ref, v_m.id)
  ON CONFLICT (owner_id) DO UPDATE
    SET kind = 'member',
        full_name = excluded.full_name,
        phone = coalesce(excluded.phone, public.gps_profiles.phone),
        customer_ref = excluded.customer_ref,
        membership_id = excluded.membership_id,
        updated_at = now();

  PERFORM public.my_coupon_book();
  RETURN public.gps_my_profile();
END
$$;

REVOKE ALL ON FUNCTION public.gps_join_member(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gps_join_member(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
