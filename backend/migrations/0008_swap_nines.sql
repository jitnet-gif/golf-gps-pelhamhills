-- ============================================================================
-- 0008 홀 번호 바로잡기 - 앞 9홀과 뒤 9홀이 뒤바뀌어 있던 것
-- ============================================================================
--
-- holes 표는 OpenStreetMap 에서 왔고, OSM 은 이 코스의 앞뒤 9홀을 거꾸로
-- 적어 두었습니다. 표의 1~18번 홀 핸디캡이 클럽 스코어카드의 10~18, 1~9번과
-- 18개 모두 같고, 자기 번호와 같은 홀은 하나도 없습니다. 클럽 코스 안내도도
-- 같은 말을 합니다 - 클럽하우스에서 곧장 남쪽으로 가는 홀이 안내도의
-- 1번인데, 표에서는 10번이었습니다.
--
-- 그래서 번호 N 의 핀·파·핸디캡·길이를 N±9 번과 서로 바꾸고, 파와 핸디캡은
-- 스코어카드 값으로 적습니다. 앱은 이미 바로잡힌 번호로 그리고 있어서
-- (티와 핀을 한 곳에서만 읽으므로) 이 SQL 을 언제 실행해도 화면은 그대로
-- 맞습니다. 데이터베이스를 클럽 번호와 같게 맞춰 두는 정리입니다.
--
-- Supabase 대시보드 > SQL Editor 에 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다: 1번 홀 핸디캡이 이미 1이면 아무것도 바꾸지 않습니다.
-- ============================================================================

DO $$
DECLARE
  cid       uuid;
  first_hcp int;
  pair      text := 'o.hole_number = CASE WHEN h.hole_number <= 9 THEN h.hole_number + 9 ELSE h.hole_number - 9 END';
BEGIN
  SELECT id INTO cid FROM public.courses WHERE name = 'Pelham Hills Golf Club';
  IF cid IS NULL THEN
    RAISE NOTICE 'Pelham Hills Golf Club 코스가 없습니다 - 바꾸지 않았습니다.';
    RETURN;
  END IF;

  SELECT handicap INTO first_hcp FROM public.holes WHERE course_id = cid AND hole_number = 1;
  IF first_hcp = 1 THEN
    RAISE NOTICE '이미 클럽 번호대로입니다 - 바꾸지 않았습니다.';
    RETURN;
  END IF;

  -- 한 문장 안에서 FROM 쪽은 바꾸기 전 값을 봅니다. 그래서 N 과 N±9 가 서로 바뀝니다.
  EXECUTE format(
    'UPDATE public.holes AS h
        SET length = o.length, pin_gps_lat = o.pin_gps_lat, pin_gps_lng = o.pin_gps_lng
       FROM public.holes AS o
      WHERE h.course_id = $1 AND o.course_id = $1 AND %s', pair)
  USING cid;

  -- 0002(티 좌표)나 0005(점선)가 적용된 데이터베이스라면 그것도 같이 옮깁니다.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'holes' AND column_name = 'tee_gps_lat') THEN
    EXECUTE format(
      'UPDATE public.holes AS h
          SET tee_gps_lat = o.tee_gps_lat, tee_gps_lng = o.tee_gps_lng
         FROM public.holes AS o
        WHERE h.course_id = $1 AND o.course_id = $1 AND %s', pair)
    USING cid;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'holes' AND column_name = 'fairway_path') THEN
    EXECUTE format(
      'UPDATE public.holes AS h
          SET fairway_path = o.fairway_path
         FROM public.holes AS o
        WHERE h.course_id = $1 AND o.course_id = $1 AND %s', pair)
    USING cid;
  END IF;

  -- 파와 핸디캡은 클럽 스코어카드 그대로.
  UPDATE public.holes AS h
     SET par = c.par, handicap = c.handicap
    FROM (VALUES
      (1, 4, 1), (2, 4, 15), (3, 5, 3), (4, 4, 11), (5, 3, 13), (6, 5, 5),
      (7, 3, 17), (8, 4, 9), (9, 4, 7), (10, 5, 8), (11, 4, 2), (12, 3, 14),
      (13, 4, 18), (14, 4, 6), (15, 4, 10), (16, 3, 12), (17, 4, 16), (18, 4, 4)
    ) AS c(hole_number, par, handicap)
   WHERE h.course_id = cid AND h.hole_number = c.hole_number;

  RAISE NOTICE '앞뒤 9홀을 클럽 번호대로 바로잡았습니다.';
END $$;
