-- ============================================================================
-- 0023 쿠폰북 (라운드 10번 = 1번 무료)
-- ============================================================================
--
-- 손님이 라운드를 마치고 카운터에 오면 직원이 도장을 하나 찍어 줍니다.
-- 도장 10개가 모이면 무료 라운드 1회가 생기고, 그것을 쓰는 것도 카운터에서
-- 직원이 합니다.
--
-- 먼저 실행해야 하는 것:
--   0006_scorecards.sql     - is_scorecard_admin()
--   0019_staff_notices.sql  - is_staff() (직원 = staff_members + 관리자)
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다.
--
-- ----------------------------------------------------------------------------
-- 왜 스코어카드로 세지 않는가
-- ----------------------------------------------------------------------------
-- 앱에는 이미 계정별 스코어카드가 있으니 그 수를 세면 직원 손이 안 듭니다.
-- 하지만 카드는 손님 폰이 만들고 아무 날짜로나 올릴 수 있습니다 - 거실에서
-- 카드 열 장을 만들면 공짜 라운드입니다. 무료 라운드는 돈이라, 도장은 돈을
-- 받은 사람(카운터)이 찍습니다. 손님 폰은 보기만 합니다.
--
-- ----------------------------------------------------------------------------
-- 장부 방식
-- ----------------------------------------------------------------------------
-- 도장 판을 "10칸 채우면 비운다" 로 두지 않고, 한 줄씩 쌓는 장부로 둡니다:
--   kind = 'stamp'  도장 하나
--   kind = 'redeem' 무료 라운드 하나 사용
-- 적립된 무료 = floor(도장 수 / 10), 남은 무료 = 적립 - 사용,
-- 판 위의 도장 = 도장 수 % 10.
-- 숫자를 덮어쓰지 않으므로 "왜 3개밖에 없냐" 는 질문에 날짜로 답할 수 있습니다.
--
-- 하루에 도장은 한 번입니다(클럽 시간 기준). 직원이 버튼을 두 번 누르거나,
-- 같은 손님이 두 직원에게 각각 받아 가는 일을 서버가 막습니다. 36홀을 도는
-- 날이 잦다면 coupon_stamp 의 그 검사만 지우면 됩니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 쿠폰북 (계정마다 하나, 카운터에서 부를 코드)
-- ----------------------------------------------------------------------------
-- 카운터에서 이메일을 받아 적는 것은 느리고 잘 틀립니다. 손님 폰에 여섯 자리
-- 코드를 크게 띄우고 직원이 그것을 칩니다. 0012 주문 코드와 같은 글자판
-- (0/O, 1/I/L 처럼 헷갈리는 글자를 뺀 32자)입니다.
CREATE TABLE IF NOT EXISTS public.coupon_books (
  owner_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coupon_entries (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('stamp', 'redeem')),
  -- 누가 찍었는지. 직원 계정이 지워져도 장부 줄은 남깁니다.
  staff_id    uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coupon_entries_owner
  ON public.coupon_entries (owner_id, created_at DESC);

-- 두 표 모두 직접 읽고 쓰지 않습니다. 아래 함수들만 통합니다.
ALTER TABLE public.coupon_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_books FROM anon, authenticated;
REVOKE ALL ON public.coupon_entries FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. 한 계정의 쿠폰북 요약 (내부용)
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
      count(*) FILTER (WHERE kind = 'stamp')  AS stamps,
      count(*) FILTER (WHERE kind = 'redeem') AS redeemed,
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
-- 3. 손님: 내 쿠폰북 (처음 부르면 코드를 만듭니다)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_coupon_book()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_chars text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code  text;
  v_try   int := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.coupon_books WHERE owner_id = v_me) THEN
    LOOP
      v_try := v_try + 1;
      v_code := '';
      FOR i IN 1..6 LOOP
        v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
      END LOOP;
      BEGIN
        INSERT INTO public.coupon_books (owner_id, code) VALUES (v_me, v_code)
        ON CONFLICT (owner_id) DO NOTHING;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- 다른 사람의 코드와 겹쳤습니다. 다시 뽑습니다.
        IF v_try >= 10 THEN RAISE; END IF;
      END;
    END LOOP;
  END IF;

  RETURN public.coupon_summary(v_me);
END
$$;

REVOKE ALL ON FUNCTION public.my_coupon_book() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_coupon_book() TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. 직원: 코드(또는 이메일)로 손님 찾기
-- ----------------------------------------------------------------------------
-- 코드를 잊은 손님은 이메일로 찾습니다. 못 찾으면 null.
CREATE OR REPLACE FUNCTION public.coupon_lookup(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_q     text := btrim(coalesce(p_query, ''));
  v_owner uuid;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;

  IF position('@' IN v_q) > 0 THEN
    SELECT id INTO v_owner FROM auth.users WHERE lower(email) = lower(v_q);
  ELSE
    SELECT owner_id INTO v_owner FROM public.coupon_books
    WHERE code = upper(replace(v_q, ' ', ''));
  END IF;

  IF v_owner IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.coupon_summary(v_owner)
    || jsonb_build_object(
         'owner_id', v_owner,
         'email', (SELECT email FROM auth.users WHERE id = v_owner)
       );
END
$$;

REVOKE ALL ON FUNCTION public.coupon_lookup(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.coupon_lookup(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. 직원: 도장 찍기 / 무료 라운드 쓰기 / 방금 것 되돌리기
-- ----------------------------------------------------------------------------
-- 셋 다 바뀐 요약을 돌려줍니다. 거절은 사람이 읽을 말로 올라갑니다.

CREATE OR REPLACE FUNCTION public.coupon_stamp(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;
  -- 같은 손님을 두 직원이 동시에 찍어도 한 번만 들어가게.
  PERFORM pg_advisory_xact_lock(hashtext('coupon:' || p_owner::text));
  IF (public.coupon_summary(p_owner) ->> 'stamped_today')::boolean THEN
    RAISE EXCEPTION '오늘은 이미 도장을 찍었습니다.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.coupon_entries (owner_id, kind, staff_id)
  VALUES (p_owner, 'stamp', auth.uid());
  RETURN public.coupon_summary(p_owner);
END
$$;

CREATE OR REPLACE FUNCTION public.coupon_redeem(p_owner uuid)
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
  IF (public.coupon_summary(p_owner) ->> 'free_left')::int < 1 THEN
    RAISE EXCEPTION '쓸 수 있는 무료 라운드가 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.coupon_entries (owner_id, kind, staff_id)
  VALUES (p_owner, 'redeem', auth.uid());
  RETURN public.coupon_summary(p_owner);
END
$$;

-- 잘못 누른 것을 무르는 길. 그 손님의 가장 최근 줄 하나를, 30분 안에만.
-- 오래된 줄을 지울 수 있으면 장부가 장부가 아니게 됩니다.
CREATE OR REPLACE FUNCTION public.coupon_undo(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('coupon:' || p_owner::text));
  SELECT id INTO v_id FROM public.coupon_entries
  WHERE owner_id = p_owner
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.coupon_entries
    WHERE id = v_id AND created_at > now() - interval '30 minutes'
  ) THEN
    RAISE EXCEPTION '30분 안에 찍은 것만 되돌릴 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.coupon_entries WHERE id = v_id;
  RETURN public.coupon_summary(p_owner);
END
$$;

REVOKE ALL ON FUNCTION public.coupon_stamp(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.coupon_redeem(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.coupon_undo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.coupon_stamp(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_redeem(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_undo(uuid) TO authenticated;
