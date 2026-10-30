-- ============================================================================
-- 0022 클럽 번호로 되돌리기 + 티·핀 좌표를 Google Earth 측정값으로
-- ============================================================================
--
-- 클럽이 Google Earth 프로젝트 "Pelham Hills Tee and Pin coordinates" 로 홀마다
-- 네 가지 티와 핀을 찍어 주었습니다 (course-gps/pelham-hills-tee-pin.csv).
-- 그 프로젝트의 번호가 클럽의 번호라고 클럽이 확인했습니다. 인쇄된 야디지 북과
-- 코스 안내도는 앞뒤 9홀이 반대이고, 0008 은 그 책을 따라 OSM 번호를 뒤집었습니다.
-- 그래서 이 파일이 0008 을 되돌립니다: 1번은 파5 (핸디캡 8), 10번은 파4 (핸디캡 1).
--
-- 값은 frontend/src/data/pelhamHills.ts 와 같습니다. 티는 화이트 티입니다.
-- 11번 홀은 프로젝트에 핀이 없어 OSM 핀 그대로입니다.
--
-- 함께 하는 일:
--   * holes.fairway_path 와 hole_edits 의 점선은 그린 땅을 따라 N <-> N±9 로 옮깁니다.
--     (1번 홀 핸디캡이 이미 8 이면 옮긴 것으로 보고 건너뜁니다.)
--   * hole_edits 의 티·핀·길이는 예전 OSM 좌표를 번호만 옮긴 것이라 지웁니다.
--   * scores / scorecards 는 건드리지 않습니다. 홀 행은 UPDATE 만 하고 지우지 않습니다.
--
-- Supabase 대시보드 > SQL Editor 에 붙여 넣고 Run 하면 됩니다. 여러 번 실행해도 안전합니다.
-- ============================================================================

DO $$
DECLARE
  cid uuid;
  first_hcp int;
BEGIN
  SELECT id INTO cid FROM public.courses WHERE name = 'Pelham Hills Golf Club';
  IF cid IS NULL THEN
    RAISE NOTICE 'Pelham Hills Golf Club 코스가 없습니다 - 바꾸지 않았습니다.';
    RETURN;
  END IF;

  SELECT handicap INTO first_hcp FROM public.holes WHERE course_id = cid AND hole_number = 1;

  IF first_hcp IS DISTINCT FROM 8 THEN
    -- 한 문장 안에서 FROM 쪽은 바꾸기 전 값을 봅니다. 그래서 N 과 N±9 가 서로 바뀝니다.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'holes' AND column_name = 'fairway_path') THEN
      UPDATE public.holes AS h
         SET fairway_path = o.fairway_path
        FROM public.holes AS o
       WHERE h.course_id = cid AND o.course_id = cid
         AND o.hole_number = CASE WHEN h.hole_number <= 9 THEN h.hole_number + 9 ELSE h.hole_number - 9 END;
    END IF;

    IF to_regclass('public.hole_edits') IS NOT NULL THEN
      -- 기본 키 (course_id, hole_number) 가 중간에 겹치지 않도록 꺼냈다가 다시 넣습니다.
      CREATE TEMP TABLE hole_edits_0022 ON COMMIT DROP AS SELECT * FROM public.hole_edits;
      DELETE FROM public.hole_edits;
      INSERT INTO public.hole_edits (course_id, hole_number, waypoints, tee, pin, length, updated_at, updated_by)
      SELECT course_id,
             CASE WHEN hole_number <= 9 THEN hole_number + 9 ELSE hole_number - 9 END,
             waypoints, NULL, NULL, NULL, now(), updated_by
        FROM hole_edits_0022;
    END IF;
  END IF;

  IF to_regclass('public.hole_edits') IS NOT NULL THEN
    UPDATE public.hole_edits
       SET tee = NULL, pin = NULL, length = NULL, updated_at = now()
     WHERE tee IS NOT NULL OR pin IS NOT NULL OR length IS NOT NULL OR first_hcp IS DISTINCT FROM 8;
  END IF;

  UPDATE public.holes AS h
     SET par = v.par, handicap = v.handicap, length = v.length,
         pin_gps_lat = v.pin_lat, pin_gps_lng = v.pin_lng
    FROM (VALUES
    ( 1, 5,  8, 424, 42.9848644, -79.2964008, 42.9867890, -79.3009216),
    ( 2, 4,  2, 287, 42.9844739, -79.3002091, 42.9845416, -79.2962150),
    ( 3, 3, 14, 125, 42.9836969, -79.2986115, 42.9842198, -79.3003112),
    ( 4, 4, 18, 392, 42.9801284, -79.2993280, 42.9834257, -79.2981540),
    ( 5, 4,  6, 336, 42.9810978, -79.2965069, 42.9799442, -79.2986171),
    ( 6, 4, 10, 289, 42.9834352, -79.2974376, 42.9810309, -79.2958628),
    ( 7, 3, 12, 121, 42.9841178, -79.2961687, 42.9837288, -79.2979619),
    ( 8, 4, 16, 298, 42.9871908, -79.2962411, 42.9845227, -79.2958179),
    ( 9, 4,  4, 281, 42.9868744, -79.2997055, 42.9878200, -79.2960284),
    (10, 4,  1, 338, 42.9833118, -79.3011269, 42.9864196, -79.3010763),
    (11, 4, 15, 157, 42.9814791, -79.2997647, 42.9840324, -79.3004578),
    (12, 5,  3, 427, 42.9822720, -79.3053916, 42.9812892, -79.3002111),
    (13, 4, 11, 322, 42.9824792, -79.3013747, 42.9830750, -79.3053472),
    (14, 3, 13, 170, 42.9839819, -79.3026301, 42.9827683, -79.3012514),
    (15, 5,  5, 477, 42.9872432, -79.3056218, 42.9831922, -79.3040602),
    (16, 3, 17, 122, 42.9873990, -79.3041568, 42.9876085, -79.3057181),
    (17, 4,  9, 307, 42.9846729, -79.3038394, 42.9875949, -79.3034094),
    (18, 4,  7, 334, 42.9877060, -79.3025428, 42.9847295, -79.3034007)
    ) AS v(hole_number, par, handicap, length, pin_lat, pin_lng, tee_lat, tee_lng)
   WHERE h.course_id = cid AND h.hole_number = v.hole_number;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'holes' AND column_name = 'tee_gps_lat') THEN
    UPDATE public.holes AS h
       SET tee_gps_lat = v.tee_lat, tee_gps_lng = v.tee_lng
      FROM (VALUES
    ( 1, 5,  8, 424, 42.9848644, -79.2964008, 42.9867890, -79.3009216),
    ( 2, 4,  2, 287, 42.9844739, -79.3002091, 42.9845416, -79.2962150),
    ( 3, 3, 14, 125, 42.9836969, -79.2986115, 42.9842198, -79.3003112),
    ( 4, 4, 18, 392, 42.9801284, -79.2993280, 42.9834257, -79.2981540),
    ( 5, 4,  6, 336, 42.9810978, -79.2965069, 42.9799442, -79.2986171),
    ( 6, 4, 10, 289, 42.9834352, -79.2974376, 42.9810309, -79.2958628),
    ( 7, 3, 12, 121, 42.9841178, -79.2961687, 42.9837288, -79.2979619),
    ( 8, 4, 16, 298, 42.9871908, -79.2962411, 42.9845227, -79.2958179),
    ( 9, 4,  4, 281, 42.9868744, -79.2997055, 42.9878200, -79.2960284),
    (10, 4,  1, 338, 42.9833118, -79.3011269, 42.9864196, -79.3010763),
    (11, 4, 15, 157, 42.9814791, -79.2997647, 42.9840324, -79.3004578),
    (12, 5,  3, 427, 42.9822720, -79.3053916, 42.9812892, -79.3002111),
    (13, 4, 11, 322, 42.9824792, -79.3013747, 42.9830750, -79.3053472),
    (14, 3, 13, 170, 42.9839819, -79.3026301, 42.9827683, -79.3012514),
    (15, 5,  5, 477, 42.9872432, -79.3056218, 42.9831922, -79.3040602),
    (16, 3, 17, 122, 42.9873990, -79.3041568, 42.9876085, -79.3057181),
    (17, 4,  9, 307, 42.9846729, -79.3038394, 42.9875949, -79.3034094),
    (18, 4,  7, 334, 42.9877060, -79.3025428, 42.9847295, -79.3034007)
      ) AS v(hole_number, par, handicap, length, pin_lat, pin_lng, tee_lat, tee_lng)
     WHERE h.course_id = cid AND h.hole_number = v.hole_number;
  END IF;

  RAISE NOTICE '클럽 번호와 Google Earth 좌표로 맞췄습니다.';
END $$;
