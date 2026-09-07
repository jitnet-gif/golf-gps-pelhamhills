/**
 * 골프 GPS 앱 초기 스키마
 * migrations/0001_init.sql
 *
 * Supabase PostgreSQL 초기 설정
 * 이 마이그레이션을 실행하려면:
 *
 * 방법 1: Supabase Dashboard
 * - SQL Editor에서 이 쿼리를 복사-붙여넣기
 * - 실행 버튼 클릭
 *
 * 방법 2: Supabase CLI (권장)
 * $ supabase migration new <name>
 * $ # 파일에 쿼리 복사
 * $ supabase db push
 */

-- ============================================================
-- 1. 확장 기능 활성화
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 2. 코스(Courses) 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS public.courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  location VARCHAR(200) NOT NULL,
  par INTEGER NOT NULL CHECK (par >= 36 AND par <= 144),
  holes INTEGER NOT NULL CHECK (holes IN (9, 18)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_courses_created_at ON public.courses (created_at DESC);
CREATE INDEX idx_courses_name ON public.courses USING GIN (to_tsvector('english', name));

-- RLS (Row-Level Security)
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

-- 정책: 누구나 읽기 가능
CREATE POLICY "courses_read_all" ON public.courses
  FOR SELECT USING (true);

-- 정책: 관리자만 쓰기 가능 (현재는 비활성, 필요시 활성화)
-- CREATE POLICY "courses_write_admin" ON public.courses
--   FOR INSERT WITH CHECK (auth.uid() IN (SELECT user_id FROM admin_users));

-- ============================================================
-- 3. 홀(Holes) 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS public.holes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES public.courses (id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL CHECK (hole_number >= 1 AND hole_number <= 18),
  par INTEGER NOT NULL CHECK (par >= 3 AND par <= 5),
  handicap INTEGER NOT NULL CHECK (handicap >= 1 AND handicap <= 18),
  length INTEGER NOT NULL CHECK (length > 0), -- meters
  pin_gps_lat NUMERIC(10, 8) NOT NULL,
  pin_gps_lng NUMERIC(11, 8) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_hole_per_course UNIQUE (course_id, hole_number)
);

-- 인덱스
CREATE INDEX idx_holes_course_id ON public.holes (course_id);
CREATE INDEX idx_holes_hole_number ON public.holes (hole_number);

-- RLS
ALTER TABLE public.holes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holes_read_all" ON public.holes
  FOR SELECT USING (true);

-- ============================================================
-- 4. 라운드(Rounds) 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES public.courses (id) ON DELETE RESTRICT,
  player_ids UUID[] NOT NULL CHECK (array_length(player_ids, 1) > 0),
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_rounds_course_id ON public.rounds (course_id);
CREATE INDEX idx_rounds_status ON public.rounds (status);
CREATE INDEX idx_rounds_start_time ON public.rounds (start_time DESC);
-- player_ids 배열 검색을 위한 인덱스
CREATE INDEX idx_rounds_player_ids ON public.rounds USING GIN (player_ids);

-- RLS
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;

-- 정책: 참여자만 읽기 가능 (또는 서비스 역할)
CREATE POLICY "rounds_read_participants" ON public.rounds
  FOR SELECT USING (
    -- 참여자이거나, 또는 서비스 역할 (is_admin 정책은 나중에 추가)
    EXISTS (
      SELECT 1 FROM unnest(player_ids) AS pid
      WHERE pid = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

-- 정책: 참여자만 수정 가능
CREATE POLICY "rounds_update_participants" ON public.rounds
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM unnest(player_ids) AS pid
      WHERE pid = auth.uid()
    )
  );

-- ============================================================
-- 5. 점수(Scores) 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id UUID NOT NULL REFERENCES public.rounds (id) ON DELETE CASCADE,
  hole_id UUID NOT NULL REFERENCES public.holes (id) ON DELETE RESTRICT,
  player_id UUID NOT NULL,
  strokes INTEGER NOT NULL CHECK (strokes >= 1 AND strokes <= 13),
  is_synced BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- 멱등성: (round_id, hole_id, player_id) 조합은 유일해야 함
  CONSTRAINT unique_score_per_round_hole_player
    UNIQUE (round_id, hole_id, player_id)
);

-- 인덱스
CREATE INDEX idx_scores_round_id ON public.scores (round_id);
CREATE INDEX idx_scores_player_id ON public.scores (player_id);
CREATE INDEX idx_scores_hole_id ON public.scores (hole_id);
CREATE INDEX idx_scores_created_at ON public.scores (created_at DESC);

-- RLS
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

-- 정책: 자신의 점수 또는 같은 라운드의 다른 참여자의 점수 읽기
CREATE POLICY "scores_read_own_or_same_round" ON public.scores
  FOR SELECT USING (
    player_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.rounds
      WHERE id = scores.round_id
        AND auth.uid() = ANY(player_ids)
    )
    OR auth.role() = 'service_role'
  );

-- 정책: 라운드 참여자가 그룹의 점수를 기록 (예: 한 사람이 모두 입력)
CREATE POLICY "scores_write_by_round_participant" ON public.scores
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rounds
      WHERE id = scores.round_id
        AND auth.uid() = ANY(player_ids)
    )
  );

-- 정책: 점수 수정은 자신의 점수만 또는 라운드 참여자가 수정
CREATE POLICY "scores_update_own_or_participant" ON public.scores
  FOR UPDATE USING (
    player_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.rounds
      WHERE id = scores.round_id
        AND auth.uid() = ANY(player_ids)
    )
  );

-- ============================================================
-- 6. 타일 메타데이터(Tile Metadata) 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tile_metadata (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES public.courses (id) ON DELETE CASCADE,
  zoom INTEGER NOT NULL CHECK (zoom >= 0 AND zoom <= 30),
  x INTEGER NOT NULL CHECK (x >= 0),
  y INTEGER NOT NULL CHECK (y >= 0),
  path VARCHAR(255) NOT NULL,
  bucket VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_tile UNIQUE (course_id, zoom, x, y)
);

-- 인덱스
CREATE INDEX idx_tile_metadata_course_id ON public.tile_metadata (course_id);
CREATE INDEX idx_tile_metadata_zoom_level ON public.tile_metadata (zoom);

-- RLS
ALTER TABLE public.tile_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tile_metadata_read_all" ON public.tile_metadata
  FOR SELECT USING (true);

-- ============================================================
-- 7. 뷰: 라운드별 리더보드
-- ============================================================

CREATE OR REPLACE VIEW public.v_leaderboard AS
SELECT
  r.id as round_id,
  r.course_id,
  r.start_time,
  s.player_id,
  COUNT(*) as total_holes,
  SUM(s.strokes) as total_strokes,
  SUM(s.strokes) - SUM(h.par) as total_score_vs_par
FROM public.rounds r
JOIN public.scores s ON s.round_id = r.id
JOIN public.holes h ON h.id = s.hole_id
GROUP BY r.id, r.course_id, r.start_time, s.player_id
ORDER BY r.start_time DESC, total_strokes ASC;

-- RLS
ALTER VIEW public.v_leaderboard OWNER TO postgres;

-- ============================================================
-- 8. 함수: updated_at 자동 업데이트
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_rounds_updated_at BEFORE UPDATE ON public.rounds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_scores_updated_at BEFORE UPDATE ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 9. 샘플 데이터 (선택사항)
-- ============================================================

-- 코스 예제
INSERT INTO public.courses (name, location, par, holes)
VALUES
  ('Pelham Hills Golf Club', 'Seoul, South Korea', 72, 18),
  ('Namsan Golf Course', 'Seoul, South Korea', 72, 18)
ON CONFLICT DO NOTHING;

-- 첫 번째 코스의 홀 예제 (일부)
INSERT INTO public.holes (course_id, hole_number, par, handicap, length, pin_gps_lat, pin_gps_lng)
SELECT
  c.id,
  hole_num,
  CASE WHEN hole_num <= 9 THEN 4 ELSE 4 END,
  hole_num,
  350 + (hole_num * 10),
  37.123 + (hole_num * 0.001),
  127.456 + (hole_num * 0.001)
FROM public.courses c
CROSS JOIN LATERAL (
  SELECT generate_series(1, 18) AS hole_num
) h
WHERE c.name = 'Pelham Hills Golf Club'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 10. 권한 설정
-- ============================================================

-- anon 역할: 읽기만 가능
GRANT SELECT ON public.courses TO anon;
GRANT SELECT ON public.holes TO anon;
GRANT SELECT ON public.rounds TO anon;
GRANT SELECT ON public.scores TO anon;
GRANT SELECT ON public.v_leaderboard TO anon;

-- authenticated 역할: CRUD 가능
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rounds TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scores TO authenticated;
GRANT SELECT ON public.v_leaderboard TO authenticated;

-- Sequence 권한
GRANT USAGE ON SCHEMA public TO anon, authenticated;
