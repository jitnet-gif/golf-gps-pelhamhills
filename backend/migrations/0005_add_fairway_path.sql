-- 홀별 페어웨이 선 (티와 핀 사이에서 선이 꺾이는 점)
-- migrations/0005_add_fairway_path.sql
--
-- 지도의 점선이 티에서 핀으로 곧장 그어지면 도그렉 홀에서는 숲과 해저드 위를
-- 지나간다. /admin/map 에서 찍은 꺾이는 점을 여기 담는다.
--
-- 형식: [[위도, 경도], ...] - 티 쪽부터. 티와 핀은 담지 않는다(각자 컬럼이 있고,
-- 따로 움직인다). NULL 은 "그린 적 없음", '[]' 는 "직선으로 되돌림"이다.
--
-- 그리기 전용이다. 거리 계산에는 쓰지 않는다 - 위성 사진 위에서 끈 점은 누가
-- 서 본 좌표가 아니다.
--
-- 값 채우기: /admin/map 의 '수정한 선 전체 복사' 가 이 컬럼용 UPDATE 문을 함께 만든다.
-- 앱은 holes 를 select=* 로 읽으므로 컬럼이 생기는 순간 배포 없이 반영된다.
--
-- 재실행 안전.

ALTER TABLE public.holes
  ADD COLUMN IF NOT EXISTS fairway_path JSONB;

ALTER TABLE public.holes
  DROP CONSTRAINT IF EXISTS holes_fairway_path_is_array;

ALTER TABLE public.holes
  ADD CONSTRAINT holes_fairway_path_is_array
  CHECK (fairway_path IS NULL OR jsonb_typeof(fairway_path) = 'array');
