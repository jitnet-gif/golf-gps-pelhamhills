-- ============================================================================
-- 0024 NFC 체크인 (폰을 카운터 태그에 대면 오늘 예약이 체크인)
-- ============================================================================
--
-- 흐름:
--   1. 프로 샵 카운터에 NFC 스티커를 붙입니다. 스티커에는 주소 하나가 적혀
--      있습니다: https://<GPS 앱>/checkin?t=<태그 토큰>
--   2. 손님이 폰을 대면 그 주소가 열립니다(아이폰·안드로이드 모두 - 태그가
--      주소를 여는 것은 OS 기능이라 Web NFC 가 필요 없습니다).
--   3. GPS 앱은 로그인한 이메일로 **오늘** 예약(pelhamhills 티시트,
--      pelham_tee_bookings)을 찾아 체크인으로 바꿉니다. 티시트의 "Check in"
--      버튼과 같은 함수(pelham_tee_apply_status)를 써서 결과가 똑같습니다.
--   4. 카운터 직원 화면(/fnb)에 방금 체크인한 손님과, 예약 때 올린 신분증
--      사진(pelhamhills 0082 pelham_id_scans)이 뜹니다.
--
-- 같은 Supabase 프로젝트(yxpiwwgquyaxjubovzmi)라서 GPS 앱이 예약 표를 직접
-- 봅니다. 먼저 실행해야 하는 것:
--   pelhamhills 0003, 0004, 0012, 0082  - 예약 표와 함수, 신분증 표
--   이 저장소 0019                       - is_staff()
--
-- ## 태그 토큰을 두는 이유
-- 주소만 알면 집에서도 열 수 있습니다. 토큰이 있으면 최소한 스티커를 본
-- 사람이어야 하고, 스티커를 바꾸면(토큰을 끄면) 옛 주소는 죽습니다. 그래도
-- 오늘 예약만, 본인 이메일 예약만 체크인되므로 새어 나가도 피해는 "조금 일찍
-- 체크인됨" 에 그칩니다.
--
-- Supabase SQL Editor 에 붙여 넣고 Run. 여러 번 실행해도 안전합니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 태그와 체크인 기록
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkin_tags (
  token      text PRIMARY KEY,
  label      text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nfc_checkins (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id  text NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  email       text,
  tag_token   text REFERENCES public.checkin_tags (token) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nfc_checkins_created ON public.nfc_checkins (created_at DESC);

ALTER TABLE public.checkin_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfc_checkins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkin_tags FROM anon, authenticated;
REVOKE ALL ON public.nfc_checkins FROM anon, authenticated;

-- 첫 태그 하나. 토큰은 무작위 18자입니다. /fnb 화면에 주소가 보이고, 거기서
-- 안드로이드 폰으로 스티커에 바로 쓸 수 있습니다.
INSERT INTO public.checkin_tags (token, label)
SELECT substr(md5(random()::text || clock_timestamp()::text), 1, 18), 'Pro shop counter'
WHERE NOT EXISTS (SELECT 1 FROM public.checkin_tags);

-- ----------------------------------------------------------------------------
-- 2. 손님: 태그를 댔다
-- ----------------------------------------------------------------------------
-- 돌려주는 것: {status: 'checked_in' | 'already', booking: {...}, idOnFile}
-- 오늘 예약이 없거나 태그가 틀리면 사람이 읽을 말로 거절합니다(P0001).
CREATE OR REPLACE FUNCTION public.nfc_checkin(p_tag text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_email  text;
  v_today  date := (now() AT TIME ZONE 'America/Toronto')::date;
  v_id     text;
  v_doc    jsonb;
  v_was    text;
  v_now    text := public.pelham_iso(now());
  v_applied jsonb;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.checkin_tags WHERE token = btrim(coalesce(p_tag, '')) AND active) THEN
    RAISE EXCEPTION 'This check-in tag is not recognised. Please check in at the counter.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_me;

  -- 오늘, 취소·노쇼·막음이 아닌 예약 중 이 이메일이 선수로 들어 있는 것.
  -- 여러 건이면 티타임이 가장 이른 것(아직 안 친 쪽)을 먼저.
  SELECT t.id INTO v_id
    FROM public.pelham_tee_bookings t
   WHERE t.booking_date = v_today
     AND coalesce(t.status, '') NOT IN ('cancelled', 'no_show', 'blocked')
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(t.doc->'players', '[]'::jsonb)) p
        WHERE lower(btrim(coalesce(p->>'email', ''))) = v_email
     )
   ORDER BY (t.status = 'reserved') DESC,
            to_timestamp(coalesce(t.tee_time, '11:59 PM'), 'HH12:MI AM')
   LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No tee time today for %. Please check in at the counter.', v_email
      USING ERRCODE = 'P0001';
  END IF;

  -- 티시트 직원이 같은 예약을 동시에 고칠 수 있으니 티시트와 같은 잠금을 겁니다.
  SELECT t.doc INTO v_doc FROM public.pelham_tee_bookings t WHERE t.id = v_id;
  PERFORM public.pelham_tee_lock((v_doc->>'date')::date, v_doc->>'time');
  SELECT t.doc INTO v_doc FROM public.pelham_tee_bookings t WHERE t.id = v_id;
  v_was := v_doc->>'status';

  -- 이미 체크인(또는 결제)된 예약은 건드리지 않습니다. 결제를 체크인으로
  -- 되돌리면 안 됩니다.
  IF v_was = 'reserved' THEN
    v_applied := public.pelham_tee_apply_status(v_doc, 'checked_in', NULL, v_now);
    v_doc := public.pelham_tee_audit(
      v_applied->'doc', format('Checked in by NFC tag (%s).', v_email), v_now);
    PERFORM public.pelham_tee_save(v_doc);
  END IF;

  INSERT INTO public.nfc_checkins (booking_id, user_id, email, tag_token)
  VALUES (v_id, v_me, v_email, btrim(p_tag));

  RETURN jsonb_build_object(
    'status', CASE WHEN v_was = 'reserved' THEN 'checked_in' ELSE 'already' END,
    'idOnFile', EXISTS (SELECT 1 FROM public.pelham_id_scans s WHERE s.booking_id = v_id),
    'booking', jsonb_build_object(
      'time', v_doc->>'time',
      'holes', v_doc->'holes',
      'players', jsonb_array_length(coalesce(v_doc->'players', '[]'::jsonb)),
      'cartCount', v_doc->'cartCount'
    )
  );
END
$$;

REVOKE ALL ON FUNCTION public.nfc_checkin(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.nfc_checkin(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. 직원: 오늘 NFC 체크인 목록 / 신분증 사진 / 태그 주소
-- ----------------------------------------------------------------------------
-- 목록에는 사진을 싣지 않습니다(15초마다 부르는 함수에 수백 KB 를 실을 이유가
-- 없음). 사진은 직원이 펼칠 때 nfc_checkin_id_image 로 한 장씩 받습니다.
CREATE OR REPLACE FUNCTION public.nfc_checkin_feed()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY (row->>'at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', c.id,
        'bookingId', c.booking_id,
        'email', c.email,
        'at', c.created_at,
        'name', coalesce(s.holder_name, t.doc->>'title'),
        'time', t.tee_time,
        'players', jsonb_array_length(coalesce(t.doc->'players', '[]'::jsonb)),
        'cartCount', t.doc->'cartCount',
        'status', t.status,
        'idOnFile', s.booking_id IS NOT NULL
      ) AS row
      FROM public.nfc_checkins c
      LEFT JOIN public.pelham_tee_bookings t ON t.id = c.booking_id
      LEFT JOIN public.pelham_id_scans s ON s.booking_id = c.booking_id
      WHERE (c.created_at AT TIME ZONE 'America/Toronto')::date
            = (now() AT TIME ZONE 'America/Toronto')::date
      ORDER BY c.created_at DESC
      LIMIT 50
    ) x
  ), '[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION public.nfc_checkin_id_image(p_booking_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'mime', s.mime,
      'data', encode(s.image, 'base64'),
      'name', s.holder_name,
      'uploadedAt', s.uploaded_at
    )
    FROM public.pelham_id_scans s
    WHERE s.booking_id = p_booking_id
  );
END
$$;

CREATE OR REPLACE FUNCTION public.nfc_checkin_tags()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION '직원 계정이 아닙니다.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('token', token, 'label', label) ORDER BY created_at)
    FROM public.checkin_tags WHERE active
  ), '[]'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION public.nfc_checkin_feed() FROM public, anon;
REVOKE ALL ON FUNCTION public.nfc_checkin_id_image(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.nfc_checkin_tags() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.nfc_checkin_feed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nfc_checkin_id_image(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nfc_checkin_tags() TO authenticated;

-- 스티커를 바꿀 때(옛 주소를 죽이고 새 토큰을 만들 때):
--   UPDATE public.checkin_tags SET active = false;
--   INSERT INTO public.checkin_tags (token, label)
--   VALUES (substr(md5(random()::text), 1, 18), 'Pro shop counter');
