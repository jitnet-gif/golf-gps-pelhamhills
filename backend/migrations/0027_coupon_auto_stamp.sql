-- ============================================================================
-- 0027 체크인하면 쿠폰북 도장이 저절로 찍히고, 환불하면 빠집니다
-- ============================================================================
--
-- 티 시트에서 선수가 체크인(Arrived)되는 순간 그 선수의 쿠폰북에 도장을 하나
-- 찍습니다. 직원 버튼, QR·신분증 체크인(pelhamhills 0084) 어느 길이든 예약 doc 의
-- 선수 arrived 가 false -> true 로 바뀌므로, 예약 표 트리거 하나로 다 잡힙니다.
-- 직원이 /fnb 에서 따로 누를 일이 없습니다(버튼은 예외 처리용으로 남김).
--
-- 빠지는 때
--   - 그 선수가 든 계산서를 환불하면(paid -> refunded) 그 선수의 그날 도장을 뺍니다.
--   - 체크인을 잘못 눌러 되돌리면(arrived true -> false) 같이 뺍니다.
--
-- ## 선수 -> GPS 계정
--   1. 선수의 customerRef -> pelham_customers.gps_user_id (프로 샵 QR 로 이은 계정)
--   2. 그 손님 기록의 이메일과 같은 이메일로 가입한 계정
--   3. 선수 자리에 적힌 이메일과 같은 이메일로 가입한 계정 (웹 예약은 예약자 이메일이 들어 있음)
-- 못 찾으면 도장 없이 넘어갑니다(앱에 가입하지 않은 손님).
--
-- ## 찍지 않는 경우
--   - 회원(멤버) - 0026 의 coupon_is_member, 또는 선수 요금제가 회원 요금(ratePlan 에 'member')
--   - 오늘 이미 도장을 받음 (하루 한 번, 0023 과 같음)
--   - 오늘 무료 라운드를 씀 - 무료로 친 라운드에는 도장이 없습니다.
--     (직원이 /fnb 에서 "무료 라운드 사용" 을 체크인보다 먼저 누르는 순서입니다.)
--   - 오늘 예약이 아님 - 지난 예약을 정리하느라 Arrived 를 눌러도 도장은 없습니다.
--
-- ## 체크인·환불을 막지 않습니다
-- 트리거는 체크인·환불 트랜잭션 안에서 돕니다. 쿠폰북 쪽 오류로 그것이 되돌려지면
-- 안 되므로, 선수 하나마다 예외를 잡아 경고만 남기고 넘어갑니다.
--
-- ## 바뀌는 것
--   - coupon_entries.booking_id, player_id   자동 도장이 어느 예약의 어느 선수 것인지
--   - coupon_give_stamp          도장 하나 찍기의 공통 부분 (회원·오늘 검사, 소개 보상)
--   - coupon_stamp               직원 버튼 - coupon_give_stamp 를 부릅니다 (동작은 0026 그대로)
--   - coupon_drop_stamp          도장 하나 빼기 (소개 보상도 같이 무름)
--   - pelham_coupon_on_checkin   pelham_tee_bookings 트리거
--   - pelham_coupon_on_refund    pelham_bills 상태 트리거
--
-- 먼저: 0026_coupon_members_excluded.sql, 그리고 pelhamhills 쪽 0005(계산서), 0084.
-- 여러 번 실행해도 안전합니다.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.coupon_is_member(uuid)') IS NULL THEN
    RAISE EXCEPTION '0027 needs 0026_coupon_members_excluded.sql first.';
  END IF;
  IF to_regclass('public.pelham_bill_lines') IS NULL THEN
    RAISE EXCEPTION '0027 needs pelhamhills 0005_pos_bills.sql first.';
  END IF;
END
$$;

ALTER TABLE public.coupon_entries ADD COLUMN IF NOT EXISTS booking_id text;
ALTER TABLE public.coupon_entries ADD COLUMN IF NOT EXISTS player_id text;
CREATE INDEX IF NOT EXISTS coupon_entries_seat
  ON public.coupon_entries (booking_id, player_id) WHERE booking_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 1. 도장 하나 찍기 (내부용)
-- ----------------------------------------------------------------------------
-- 돌려주는 것: {stamped: true, referral_rewarded?} 또는 {stamped: false, reason: 'member' | 'today'}
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
  -- 같은 손님을 버튼과 체크인이 동시에 찍어도 한 번만 들어가게.
  PERFORM pg_advisory_xact_lock(hashtext('coupon:' || p_owner::text));
  IF public.coupon_is_member(p_owner) THEN
    RETURN jsonb_build_object('stamped', false, 'reason', 'member');
  END IF;
  IF (public.coupon_summary(p_owner) ->> 'stamped_today')::boolean THEN
    RETURN jsonb_build_object('stamped', false, 'reason', 'today');
  END IF;

  INSERT INTO public.coupon_entries (owner_id, kind, staff_id, booking_id, player_id)
  VALUES (p_owner, 'stamp', auth.uid(), p_booking, p_player);

  -- 친구 소개로 온 손님의 첫 도장이면 소개한 사람에게 카트 무료 (0025).
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

  RETURN jsonb_build_object('stamped', true)
    || CASE WHEN v_rewarded IS NOT NULL
            THEN jsonb_build_object('referral_rewarded', v_rewarded)
            ELSE '{}'::jsonb END;
END
$$;

REVOKE ALL ON FUNCTION public.coupon_give_stamp(uuid, text, text) FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. 직원 버튼 (0026 과 같은 동작, 공통 부분만 옮김)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_stamp(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;
  v_res := public.coupon_give_stamp(p_owner, NULL, NULL);
  IF v_res ->> 'reason' = 'member' THEN
    RAISE EXCEPTION '회원은 쿠폰북 도장 대상이 아닙니다(회원권으로 칩니다).' USING ERRCODE = 'P0001';
  ELSIF v_res ->> 'reason' = 'today' THEN
    RAISE EXCEPTION '오늘은 이미 도장을 찍었습니다. 체크인할 때 자동으로 찍혔을 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.coupon_summary(p_owner) || (v_res - 'stamped');
END
$$;

REVOKE ALL ON FUNCTION public.coupon_stamp(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.coupon_stamp(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. 도장 하나 빼기 (내부용)
-- ----------------------------------------------------------------------------
-- 그 도장으로 채운 무료 라운드를 이미 썼으면 빼지 않습니다 - 남은 무료가
-- 음수가 되면 장부가 맞지 않습니다. 무료는 이미 나갔고, 그것은 직원이 판단할 일입니다.
-- 친구의 첫 도장이었으면 0025 의 coupon_undo 처럼 소개 보상도 무릅니다.
CREATE OR REPLACE FUNCTION public.coupon_drop_stamp(p_entry bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry public.coupon_entries;
  v_sum   jsonb;
  v_ref   public.coupon_referrals;
BEGIN
  SELECT * INTO v_entry FROM public.coupon_entries WHERE id = p_entry AND kind = 'stamp';
  IF v_entry.id IS NULL THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('coupon:' || v_entry.owner_id::text));
  v_sum := public.coupon_summary(v_entry.owner_id);
  IF ((v_sum ->> 'stamps')::int - 1) / 10 < (v_sum ->> 'redeemed')::int THEN
    RETURN false;
  END IF;

  DELETE FROM public.coupon_entries WHERE id = v_entry.id;

  IF NOT EXISTS (SELECT 1 FROM public.coupon_entries
                  WHERE owner_id = v_entry.owner_id AND kind = 'stamp') THEN
    SELECT * INTO v_ref FROM public.coupon_referrals
     WHERE friend_id = v_entry.owner_id AND rewarded_at IS NOT NULL
     FOR UPDATE;
    IF v_ref.friend_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext('coupon:' || v_ref.referrer_id::text));
      IF (public.coupon_summary(v_ref.referrer_id) ->> 'carts_left')::int > 0 THEN
        DELETE FROM public.coupon_entries WHERE id = v_ref.credit_entry_id;
      END IF;
      UPDATE public.coupon_referrals
         SET rewarded_at = NULL, credit_entry_id = NULL
       WHERE friend_id = v_entry.owner_id;
    END IF;
  END IF;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.coupon_drop_stamp(bigint) FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. 선수 -> GPS 계정 (내부용). 못 찾으면 null.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_owner_for_player(p_player jsonb)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT c.gps_user_id FROM public.pelham_customers c
      WHERE c.customer_ref = nullif(btrim(coalesce(p_player ->> 'customerRef', '')), '')),
    (SELECT u.id FROM public.pelham_customers c
       JOIN auth.users u ON lower(u.email) = lower(btrim(c.email))
      WHERE c.customer_ref = nullif(btrim(coalesce(p_player ->> 'customerRef', '')), '')
        AND btrim(coalesce(c.email, '')) <> ''
      LIMIT 1),
    (SELECT u.id FROM auth.users u
      WHERE btrim(coalesce(p_player ->> 'email', '')) <> ''
        AND lower(u.email) = lower(btrim(p_player ->> 'email'))
      LIMIT 1)
  )
$$;

REVOKE ALL ON FUNCTION public.coupon_owner_for_player(jsonb) FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. 체크인 트리거 (pelham_tee_bookings)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pelham_coupon_on_checkin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Toronto')::date;
  v_old   jsonb := CASE WHEN tg_op = 'UPDATE' THEN coalesce(old.doc -> 'players', '[]'::jsonb) ELSE '[]'::jsonb END;
  v_owner uuid;
  r       record;
  e       record;
BEGIN
  FOR r IN
    SELECT n.value AS player,
           n.value ->> 'id' AS pid,
           coalesce((n.value ->> 'arrived')::boolean, false)
             AND NOT coalesce((n.value ->> 'cancelled')::boolean, false) AS now_in,
           coalesce((o.value ->> 'arrived')::boolean, false) AS was_in
      FROM jsonb_array_elements(coalesce(new.doc -> 'players', '[]'::jsonb)) n
      LEFT JOIN LATERAL (
        SELECT x.value FROM jsonb_array_elements(v_old) x
         WHERE x.value ->> 'id' = n.value ->> 'id'
         LIMIT 1
      ) o ON true
  LOOP
    BEGIN
      IF r.now_in AND NOT r.was_in THEN
        -- 체크인: 오늘 예약, 살아 있는 예약, 회원 요금 아님, 계정 있음, 오늘 무료 라운드 안 씀.
        IF new.booking_date <> v_today
           OR coalesce(new.status, '') IN ('cancelled', 'blocked', 'no_show')
           OR coalesce(r.player ->> 'ratePlan', '') ILIKE '%member%' THEN
          CONTINUE;
        END IF;
        v_owner := public.coupon_owner_for_player(r.player);
        IF v_owner IS NULL THEN
          CONTINUE;
        END IF;
        IF EXISTS (SELECT 1 FROM public.coupon_entries ce
                    WHERE ce.owner_id = v_owner AND ce.kind = 'redeem'
                      AND (ce.created_at AT TIME ZONE 'America/Toronto')::date = v_today) THEN
          CONTINUE;
        END IF;
        PERFORM public.coupon_give_stamp(v_owner, new.id, r.pid);
      ELSIF r.was_in AND NOT r.now_in THEN
        -- 체크인을 되돌림(또는 그 선수를 취소): 그 자리로 찍힌 도장을 뺍니다.
        FOR e IN SELECT ce.id FROM public.coupon_entries ce
                  WHERE ce.booking_id = new.id AND ce.player_id = r.pid AND ce.kind = 'stamp'
        LOOP
          PERFORM public.coupon_drop_stamp(e.id);
        END LOOP;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'coupon stamp skipped for booking % player %: %', new.id, r.pid, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.pelham_coupon_on_checkin() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS pelham_coupon_on_checkin ON public.pelham_tee_bookings;
CREATE TRIGGER pelham_coupon_on_checkin
  AFTER INSERT OR UPDATE OF doc ON public.pelham_tee_bookings
  FOR EACH ROW EXECUTE FUNCTION public.pelham_coupon_on_checkin();

-- ----------------------------------------------------------------------------
-- 6. 환불 트리거 (pelham_bills paid -> refunded)
-- ----------------------------------------------------------------------------
-- 환불 함수(pelhamhills 0005 · 0020)는 상태를 먼저 refunded 로 바꾸고 그 뒤에 줄을 끕니다.
-- 그래서 이 트리거가 돌 때는 그 계산서의 선수 줄이 아직 active 입니다.
-- 환불은 체크인을 되돌리지 않으므로(arrived 는 그대로) 여기서 직접 뺍니다.
CREATE OR REPLACE FUNCTION public.pelham_coupon_on_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  e record;
BEGIN
  IF NOT (old.status = 'paid' AND new.status = 'refunded') THEN
    RETURN NULL;
  END IF;
  FOR e IN
    SELECT ce.id
      FROM public.pelham_bill_lines bl
      JOIN public.coupon_entries ce
        ON ce.booking_id = bl.booking_id AND ce.player_id = bl.player_id AND ce.kind = 'stamp'
     WHERE bl.bill_id = new.id AND bl.kind = 'tee_player' AND bl.active
  LOOP
    BEGIN
      PERFORM public.coupon_drop_stamp(e.id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'coupon stamp % not removed on refund of bill %: %', e.id, new.id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.pelham_coupon_on_refund() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS pelham_coupon_on_refund ON public.pelham_bills;
CREATE TRIGGER pelham_coupon_on_refund
  AFTER UPDATE OF status ON public.pelham_bills
  FOR EACH ROW EXECUTE FUNCTION public.pelham_coupon_on_refund();

NOTIFY pgrst, 'reload schema';
