/**
 * 푸시 구독 + 마케팅 배너 스키마
 * migrations/0003_push_and_promotions.sql
 *
 * 이 앱에는 로그인이 없습니다. 프론트엔드가 만든 익명 device_id가
 * 구독의 주인이며 auth.uid()는 항상 NULL입니다. 따라서
 * push_subscriptions에는 공개 정책을 하나도 두지 않고(= 전면 거부),
 * Worker가 service_role 키로만 읽고 씁니다.
 *
 * 실행 방법은 0001_init.sql 상단 주석과 동일합니다.
 */

-- ============================================================
-- 1. 푸시 구독(Push Subscriptions) 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 브라우저가 아니라 기기를 식별합니다. 같은 기기가 구독을 갱신하면
  -- endpoint가 바뀌므로, 오래된 행을 정리할 때 이 값을 씁니다.
  device_id VARCHAR(64) NOT NULL,

  -- 푸시 서비스(FCM/Mozilla/Apple)가 발급한 주소. 이것이 진짜 식별자입니다.
  endpoint TEXT NOT NULL,

  -- RFC 8291 페이로드 암호화에 필요한 클라이언트 키 (base64url)
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,

  -- 어떤 알림을 받을지. 빈 배열이면 전체 공지만 받습니다.
  topics TEXT[] NOT NULL DEFAULT ARRAY['marketing']::TEXT[],

  -- 진단용. 어떤 브라우저에서 실패가 몰리는지 보려고 남깁니다.
  user_agent TEXT,
  locale VARCHAR(10),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- 푸시 서비스가 404/410을 돌려준 시각. 행을 지우지 않고 표시만 해서
  -- 재구독 시 같은 기기를 추적할 수 있게 합니다.
  revoked_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT unique_push_endpoint UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device_id ON public.push_subscriptions (device_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_topics ON public.push_subscriptions USING GIN (topics);
-- 발송 대상 조회는 항상 "살아있는 구독"이므로 부분 인덱스가 맞습니다.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active
  ON public.push_subscriptions (created_at DESC)
  WHERE revoked_at IS NULL;

-- RLS: 활성화하되 정책을 만들지 않습니다 = anon/authenticated 전면 거부.
-- service_role만 접근할 수 있습니다.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. 프로모션(Promotions) 테이블 - 마케팅/홍보 배너
-- ============================================================

CREATE TABLE IF NOT EXISTS public.promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  title VARCHAR(120) NOT NULL,
  body VARCHAR(300),

  -- 배너 이미지와 클릭 시 이동할 곳. 둘 다 선택 사항입니다.
  image_url TEXT,
  link_url TEXT,

  -- 앱 안에서 배너가 나갈 자리. 코스 화면(지도)에는 넣지 않습니다 -
  -- 플레이 중 지도를 가리는 배너는 이 앱이 존재하는 이유를 해칩니다.
  placement VARCHAR(20) NOT NULL DEFAULT 'home'
    CHECK (placement IN ('home', 'scorecard')),

  -- 같은 자리에 여러 개가 있으면 높은 값이 먼저 나옵니다.
  priority INTEGER NOT NULL DEFAULT 0,

  -- 노출 기간. starts_at이 NULL이면 즉시, ends_at이 NULL이면 무기한.
  starts_at TIMESTAMP WITH TIME ZONE,
  ends_at TIMESTAMP WITH TIME ZONE,

  -- 기간과 별개인 수동 스위치. 기간을 건드리지 않고 내릴 수 있습니다.
  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT promotions_window_valid
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_promotions_placement ON public.promotions (placement, priority DESC);
CREATE INDEX IF NOT EXISTS idx_promotions_window ON public.promotions (starts_at, ends_at);

-- RLS
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

-- 정책: 누구나 읽을 수 있지만, 지금 노출 중인 배너만 보입니다.
-- 예약해 둔 다음 주 프로모션이 anon 키로 미리 새어 나가지 않습니다.
DROP POLICY IF EXISTS "promotions_read_live" ON public.promotions;
CREATE POLICY "promotions_read_live" ON public.promotions
  FOR SELECT USING (
    active = true
    AND (starts_at IS NULL OR starts_at <= NOW())
    AND (ends_at IS NULL OR ends_at > NOW())
  );

-- 쓰기 정책 없음: 배너 등록/수정은 service_role(관리 API 또는 SQL)로만.

-- ============================================================
-- 3. updated_at 자동 갱신
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_promotions_updated_at ON public.promotions;
CREATE TRIGGER trg_promotions_updated_at
  BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. 권한(GRANT)
-- ============================================================

-- RLS 정책만으로는 부족합니다. 정책은 "어떤 행을 볼 수 있는지"만 정하고,
-- 테이블에 접근할 수 있는지는 GRANT가 정합니다. 이게 빠지면
-- promotions_read_live가 아무리 맞아도 브라우저는 빈 배열만 받습니다.
GRANT SELECT ON public.promotions TO anon;
GRANT SELECT ON public.promotions TO authenticated;

-- push_subscriptions에는 어떤 GRANT도 주지 않습니다.
-- 구독 정보는 기기를 지목할 수 있는 데이터이므로 service_role 전용입니다.
