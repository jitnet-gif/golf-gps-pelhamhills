-- 홀별 티박스 좌표 추가
-- migrations/0002_add_tee_positions.sql
--
-- 0001은 핀 좌표만 담고 있어서, 티-핀 거리와 홀 중심선을 그릴 수 없었다.
-- GPS 골프앱에서 "남은 거리"의 기준점이 티이므로 좌표가 필요하다.
-- 출처: OpenStreetMap way 56217508 (ODbL) — golf=hole 경로의 시작점.
--
-- 재실행 안전.

ALTER TABLE public.holes
  ADD COLUMN IF NOT EXISTS tee_gps_lat NUMERIC(10, 8),
  ADD COLUMN IF NOT EXISTS tee_gps_lng NUMERIC(11, 8);

UPDATE public.holes h
SET tee_gps_lat = v.lat, tee_gps_lng = v.lng
FROM (VALUES
  ( 1, 42.9867767, -79.3009328),
  ( 2, 42.9844693, -79.2968544),
  ( 3, 42.9841492, -79.3000214),
  ( 4, 42.9835456, -79.2981148),
  ( 5, 42.9798868, -79.2986809),
  ( 6, 42.9811120, -79.2958587),
  ( 7, 42.9838398, -79.2976146),
  ( 8, 42.9845292, -79.2958245),
  ( 9, 42.9876177, -79.2965523),
  (10, 42.9863438, -79.3010870),
  (11, 42.9827074, -79.3007131),
  (12, 42.9813220, -79.3003284),
  (13, 42.9830509, -79.3052841),
  (14, 42.9827975, -79.3012926),
  (15, 42.9834798, -79.3034185),
  (16, 42.9876180, -79.3056757),
  (17, 42.9874356, -79.3036566),
  (18, 42.9847944, -79.3034122)
) AS v(hole_number, lat, lng)
WHERE h.hole_number = v.hole_number
  AND h.course_id = (SELECT id FROM public.courses WHERE name = 'Pelham Hills Golf Club');
