/**
 * 예약 발송 + 배너 집계 스키마
 * migrations/0004_campaigns_and_analytics.sql
 *
 * 0003에 이어지는 두 가지입니다.
 * - push_campaigns: 보낼 알림을 미리 적어 두고 Cron이 시간에 맞춰 집어 갑니다.
 * - promotion_events: 배너가 몇 번 보였고 몇 번 눌렸는지.
 *
 * 두 테이블 모두 공개 정책과 GRANT가 없습니다(= anon 전면 거부).
 * 집계 이벤트를 브라우저가 직접 넣게 하면 누구나 숫자를 부풀릴 수 있고,
 * 예약 발송은 말할 것도 없습니다. 둘 다 Worker(service_role)만 만집니다.
 *
 * 실행 방법은 0001_init.sql 상단 주석과 동일합니다.
 */

-- ============================================================
-- 1. 예약 발송(Push Campaigns)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 보낼 내용. promotion_id가 있으면 비워 두고 배너 내용을 그대로 씁니다.
  title VARCHAR(120),
  body VARCHAR(300),
  url VARCHAR(500),
  image_url TEXT,
  promotion_id UUID REFERENCES public.promotions (id) ON DELETE SET NULL,

  -- 누구에게
  topic VARCHAR(40) NOT NULL DEFAULT 'marketing',

  -- 언제. Cron이 이 시각을 지난 pending 행을 집어 갑니다.
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,

  /*
   * 상태 흐름: pending -> sending -> sent | failed
   * canceled는 pending에서만 갈 수 있습니다.
   *
   * sending이 따로 있는 이유: Cron이 겹쳐 돌아도 같은 캠페인을 두 번
   * 보내지 않으려면, 집어 갈 때 pending -> sending으로 먼저 낚아채고
   * 그 UPDATE가 실제로 행을 잡았을 때만 발송해야 합니다.
   */
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),

  -- 발송 결과
  attempted INTEGER,
  delivered INTEGER,
  failed INTEGER,
  error TEXT,

  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- 내용이 없는 캠페인은 보낼 수 없습니다.
  CONSTRAINT push_campaigns_has_content
    CHECK (title IS NOT NULL OR promotion_id IS NOT NULL)
);

-- Cron이 매번 던지는 질문은 "지금 보낼 게 있나?" 하나뿐입니다.
CREATE INDEX IF NOT EXISTS idx_push_campaigns_due
  ON public.push_campaigns (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_push_campaigns_created_at
  ON public.push_campaigns (created_at DESC);

-- RLS: 정책 없음 = service_role 전용
ALTER TABLE public.push_campaigns ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_push_campaigns_updated_at ON public.push_campaigns;
CREATE TRIGGER trg_push_campaigns_updated_at
  BEFORE UPDATE ON public.push_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. 배너 이벤트(Promotion Events)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.promotion_events (
  id BIGSERIAL PRIMARY KEY,

  promotion_id UUID NOT NULL REFERENCES public.promotions (id) ON DELETE CASCADE,

  -- 익명 기기 ID. 사람이 아니라 기기 단위입니다.
  device_id VARCHAR(64) NOT NULL,

  -- impression: 화면에 실제로 보였다 / click: 눌렀다 / dismiss: 닫았다
  event_type VARCHAR(20) NOT NULL
    CHECK (event_type IN ('impression', 'click', 'dismiss')),

  placement VARCHAR(20) NOT NULL CHECK (placement IN ('home', 'scorecard')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_promotion_events_promotion
  ON public.promotion_events (promotion_id, event_type);

CREATE INDEX IF NOT EXISTS idx_promotion_events_created_at
  ON public.promotion_events (created_at DESC);

/*
 * 같은 기기가 같은 배너를 같은 날 여러 번 열어도 노출은 하루 한 번으로
 * 셉니다. 이게 없으면 앱을 자주 켜는 사람 한 명이 노출 수를 좌우하고,
 * 클릭률은 그만큼 의미를 잃습니다. 클릭과 닫기는 행동이므로 그대로 쌓습니다.
 */
CREATE UNIQUE INDEX IF NOT EXISTS uniq_promotion_impression_per_day
  ON public.promotion_events (promotion_id, device_id, (created_at AT TIME ZONE 'Asia/Seoul')::date)
  WHERE event_type = 'impression';

-- RLS: 정책 없음 = service_role 전용
ALTER TABLE public.promotion_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. 집계 뷰
-- ============================================================

/*
 * 배너별 성적. 관리 화면이 이 뷰 하나만 읽으면 됩니다.
 * anon에는 주지 않습니다 - 어떤 배너가 안 먹혔는지는 대외 정보가 아닙니다.
 */
CREATE OR REPLACE VIEW public.v_promotion_stats AS
SELECT
  p.id AS promotion_id,
  p.title,
  p.placement,
  p.active,
  p.starts_at,
  p.ends_at,
  COUNT(*) FILTER (WHERE e.event_type = 'impression') AS impressions,
  COUNT(*) FILTER (WHERE e.event_type = 'click') AS clicks,
  COUNT(*) FILTER (WHERE e.event_type = 'dismiss') AS dismissals,
  -- 노출이 0일 때 0으로 나누지 않도록 NULLIF를 씁니다.
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE e.event_type = 'click')
      / NULLIF(COUNT(*) FILTER (WHERE e.event_type = 'impression'), 0),
    1
  ) AS click_rate_pct
FROM public.promotions p
LEFT JOIN public.promotion_events e ON e.promotion_id = p.id
GROUP BY p.id, p.title, p.placement, p.active, p.starts_at, p.ends_at;
