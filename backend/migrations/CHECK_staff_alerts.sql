-- ============================================================================
-- 직원 알림이 갔는지 확인 (읽기만 합니다)
-- ============================================================================
--
-- **이 파일 전체를 붙여 넣고 Run 하세요.** 한 표가 나옵니다. 표가 하나도 없는
-- 서버에서도 오류 없이 돕니다 - 없는 것은 '빠짐' 으로 나오고, 볼 수 있는 데까지
-- 보여 줍니다. 아무것도 만들지 않고 아무것도 바꾸지 않습니다.
--
-- 읽는 법: 판정에 ❌ 가 붙은 줄이 원인입니다. 위에서부터 차례로 고치면 됩니다.
--
-- 알아 둘 것: '전달' 은 구글·애플의 푸시 서버가 받았다는 뜻입니다. 폰이 꺼져
-- 있으면 켤 때 오고(하루까지), 폰에서 알림을 무음으로 두면 조용히 옵니다.
-- 그 두 가지는 서버가 알 수 없습니다.
--
-- ----------------------------------------------------------------------------
-- 왜 이렇게 만들었나
-- ----------------------------------------------------------------------------
-- 보통의 SELECT 로 짜면, push_subscriptions 같은 표가 없는 서버에서는 쿼리가
-- 그 줄에서 오류로 멈춥니다("relation does not exist") - 정작 그것이 답인데
-- 답을 보여 주지 못하고 끝나는 셈입니다. 그래서 결과를 임시 표에 모았다가
-- 마지막에 한 번에 보여 줍니다. 없는 표는 아예 읽지 않고 건너뜁니다.
-- 임시 표(temp)는 이 창을 닫으면 사라지고, 데이터베이스에는 남지 않습니다.
-- ============================================================================

DROP TABLE IF EXISTS pg_temp.staff_alert_report;
CREATE TEMP TABLE staff_alert_report (ord int, 구분 text, 내용 text, 판정 text);

DO $check$
DECLARE
  has_subs   boolean := to_regclass('public.push_subscriptions') IS NOT NULL;
  has_camp   boolean := to_regclass('public.push_campaigns') IS NOT NULL;
  has_orders boolean := to_regclass('public.food_orders') IS NOT NULL;
  -- cron.job 은 pg_cron 을 켜야 생깁니다. 없는 채로 읽으면 오류라 먼저 봅니다.
  has_cron   boolean := to_regclass('cron.job') IS NOT NULL;

  since      timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Toronto'))
                              AT TIME ZONE 'America/Toronto';
  n_on int; n_off int;
  a_total int; a_ok int; a_nobody int; a_failed int; a_waiting int; a_stuck int; a_new int;
  o_total int;
  job_n int; job_on boolean;
  r record;
  seq int := 0;
BEGIN
  -- --------------------------------------------------------------------------
  -- 1. 알림 장치가 깔려 있는가 (카탈로그만 읽습니다)
  -- --------------------------------------------------------------------------
  INSERT INTO staff_alert_report VALUES
    (1, '설치', 'pg_net 확장 (데이터베이스가 발송 서버를 부르는 통로)',
        CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
             THEN '✅ 있음'
             ELSE '❌ 빠짐 - 대시보드 > Database > Extensions 에서 pg_net 켜기' END),
    (2, '설치', 'pg_cron 확장 (1분마다 깨우는 시계)',
        CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
             THEN '✅ 있음'
             ELSE '❌ 빠짐 - 대시보드 > Database > Extensions 에서 pg_cron 켜기' END),
    (3, '설치', 'push_subscriptions 표 (알림을 켠 폰)',
        CASE WHEN has_subs THEN '✅ 있음' ELSE '❌ 빠짐 - 0010_push.sql 실행' END),
    (4, '설치', 'push_campaigns 표 (보낼 알림)',
        CASE WHEN has_camp THEN '✅ 있음' ELSE '❌ 빠짐 - 0010_push.sql 실행' END),
    (5, '설치', 'push_dispatch_due() 함수 (보낼 때가 된 것 집어가기)',
        CASE WHEN to_regprocedure('public.push_dispatch_due()') IS NOT NULL
             THEN '✅ 있음' ELSE '❌ 빠짐 - 0010_push.sql 실행' END),
    (6, '설치', 'set_proshop_push() 함수 (직원 폰만 주문 알림 받기)',
        CASE WHEN to_regprocedure('public.set_proshop_push(text,boolean)') IS NOT NULL
             THEN '✅ 있음' ELSE '❌ 빠짐 - 0010 을 넣은 뒤 0012_food_orders.sql 다시 실행' END),
    (7, '설치', 'staff_alert_reach() 함수 (운영 화면의 받는 폰 수)',
        CASE WHEN to_regprocedure('public.staff_alert_reach()') IS NOT NULL
             THEN '✅ 있음' ELSE '△ 빠짐 - 0020_staff_alerts.sql 실행 (없어도 알림 자체는 갑니다)' END);

  -- 표가 없으면 아래를 읽을 것이 없습니다. 왜 조용했는지만 한 줄 남깁니다.
  IF NOT has_camp THEN
    INSERT INTO staff_alert_report VALUES
      (10, '지금 상태', '알림 표가 없어 직원 알림이 만들어진 적이 없습니다',
           '❌ 주문 함수(0012)는 push_campaigns 가 없으면 알림 넣기를 조용히 건너뜁니다 - '
           '주문은 받아야 하니까요. 그래서 실패 기록조차 남지 않았습니다. 위 ❌ 를 채우세요');
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. 1분 시계가 도는가
  -- --------------------------------------------------------------------------
  IF has_cron THEN
    SELECT count(*)::int, coalesce(bool_or(active), false)
      INTO job_n, job_on
      FROM cron.job WHERE jobname = 'push-dispatch';
    INSERT INTO staff_alert_report VALUES
      (20, '발송 시계',
       CASE WHEN job_n = 0 THEN 'push-dispatch 작업이 없습니다'
            WHEN job_on THEN '1분마다 돌고 있습니다'
            ELSE 'push-dispatch 작업이 꺼져 있습니다' END,
       CASE WHEN job_n = 0 OR NOT job_on
            THEN '❌ 0010_push.sql 을 다시 실행하세요 (맨 아래가 이 작업을 겁니다)'
            ELSE '✅' END);
  ELSE
    INSERT INTO staff_alert_report VALUES
      (20, '발송 시계', 'pg_cron 이 없어 시계가 없습니다',
       '❌ 알림은 예약만 되고 나가지 않습니다 - pg_cron 을 켜고 0010 을 다시 실행하세요');
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. 직원 폰
  -- --------------------------------------------------------------------------
  IF has_subs THEN
    SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int,
           count(*) FILTER (WHERE revoked_at IS NOT NULL
                              AND revoked_at > now() - interval '7 days')::int
      INTO n_on, n_off
      FROM public.push_subscriptions
     WHERE 'proshop' = ANY (topics);

    INSERT INTO staff_alert_report VALUES
      (30, '직원 폰', format('%s대 알림 켜짐 (최근 7일 안에 꺼진 폰 %s대)', n_on, n_off),
       CASE WHEN n_on = 0
            THEN '❌ 받을 폰이 없습니다. 직원 폰에서 /admin > 주문 > "새 주문 알림 받기" 를 눌러야 합니다'
            ELSE '✅' END);
  END IF;

  -- --------------------------------------------------------------------------
  -- 4. 오늘 주문과 오늘 알림
  -- --------------------------------------------------------------------------
  IF has_orders THEN
    SELECT count(*)::int INTO o_total
      FROM public.food_orders WHERE created_at >= since;
    INSERT INTO staff_alert_report VALUES (40, '오늘 주문', format('%s건', o_total), '-');
  END IF;

  IF has_camp THEN
    SELECT count(*)::int,
           count(*) FILTER (WHERE status = 'sent' AND coalesce(delivered, 0) > 0)::int,
           -- 발송은 '완료' 로 적히지만 받을 폰이 없었던 것. 가장 흔한 미수신입니다.
           count(*) FILTER (WHERE status = 'sent' AND coalesce(attempted, 0) = 0)::int,
           count(*) FILTER (WHERE status = 'failed')::int,
           count(*) FILTER (WHERE status IN ('pending', 'sending'))::int,
           count(*) FILTER (WHERE status IN ('pending', 'sending')
                              AND scheduled_at < now() - interval '5 minutes')::int,
           count(*) FILTER (WHERE title LIKE 'New order%')::int
      INTO a_total, a_ok, a_nobody, a_failed, a_waiting, a_stuck, a_new
      FROM public.push_campaigns
     WHERE topic = 'proshop' AND created_at >= since;

    INSERT INTO staff_alert_report VALUES
      (41, '오늘 직원 알림',
       format('%s건 · 전달 %s · 아무도 못 받음 %s · 실패 %s · 대기 %s',
              a_total, a_ok, a_nobody, a_failed, a_waiting),
       CASE WHEN a_nobody > 0 THEN '❌ 받을 폰이 없어 그냥 사라진 알림이 있습니다'
            WHEN a_failed > 0 THEN '❌ 발송 실패가 있습니다 (아래 목록의 이유를 보세요)'
            WHEN a_stuck > 0  THEN '❌ 예약된 채 멈춘 알림이 있습니다 - 발송 시계 줄을 보세요'
            WHEN a_waiting > 0 THEN '⏳ 아직 나가지 않은 알림이 있습니다 (1분 안에 나갑니다)'
            WHEN a_total = 0 THEN '-'
            ELSE '✅' END);

    -- 알림 줄이 아예 안 생긴 주문 잡기. 0012 는 알림이 막혀도 주문은 받습니다.
    IF has_orders THEN
      INSERT INTO staff_alert_report VALUES
        (42, '주문 대비 알림', format('주문 %s건 / 새 주문 알림 %s건', o_total, a_new),
         CASE WHEN o_total > a_new
              THEN '❌ 알림 줄이 안 생긴 주문이 있습니다 (위 설치 줄의 ❌ 를 먼저 채우세요)'
              ELSE '✅' END);
    END IF;

    -- ------------------------------------------------------------------------
    -- 5. 최근 직원 알림 20건
    -- ------------------------------------------------------------------------
    FOR r IN
      SELECT to_char(c.created_at AT TIME ZONE 'America/Toronto', 'MM-DD HH24:MI') AS at_local,
             c.title, c.status, c.scheduled_at, c.error,
             coalesce(c.attempted, 0) AS attempted,
             coalesce(c.delivered, 0) AS delivered,
             coalesce(c.failed, 0) AS failed
        FROM public.push_campaigns c
       WHERE c.topic = 'proshop'
       ORDER BY c.created_at DESC
       LIMIT 20
    LOOP
      seq := seq + 1;
      INSERT INTO staff_alert_report VALUES
        (100 + seq, format('최근 알림 %s', seq),
         format('%s · %s · %s대 중 %s대 전달', r.at_local, r.title, r.attempted, r.delivered),
         CASE
           WHEN r.status = 'canceled' THEN '취소됨'
           WHEN r.status IN ('pending', 'sending')
                AND r.scheduled_at < now() - interval '5 minutes'
             THEN '❌ 예약된 채 멈춰 있습니다 (발송 시계 확인)'
           WHEN r.status IN ('pending', 'sending') THEN '⏳ 나가는 중'
           WHEN r.status = 'failed' THEN format('❌ 실패: %s', left(coalesce(r.error, '이유 없음'), 120))
           WHEN r.attempted = 0 THEN '❌ 받을 폰이 없어 아무에게도 안 갔습니다'
           WHEN r.delivered = 0 THEN '❌ 전달 0대'
           WHEN r.failed > 0 THEN format('⚠ %s대 실패', r.failed)
           ELSE '✅ 전달'
         END);
    END LOOP;

    IF seq = 0 THEN
      INSERT INTO staff_alert_report VALUES
        (101, '최근 알림', '직원 알림 기록이 한 건도 없습니다',
         '주문이 들어온 적이 없거나, 알림이 만들어지지 못한 것입니다');
    END IF;
  END IF;
END
$check$;

SELECT 구분, 내용, 판정 FROM staff_alert_report ORDER BY ord;


-- ============================================================================
-- 더 파고들 때 (아래는 필요할 때 한 덩어리씩 선택해서 Run)
-- ============================================================================
-- 발송 서버(Vercel)가 실제로 어떤 답을 돌려줬는지. pg_net 이 남겨 두는 응답이라
-- 얼마 뒤 지워집니다. 200 이 아니면 /api/push/dispatch 쪽 문제입니다.
--   SELECT created, status_code, left(content, 300) FROM net._http_response
--    ORDER BY created DESC LIMIT 10;
--
-- 직원 알림을 켠 폰 하나하나 (endpoint 는 그 폰에 알림을 보낼 수 있는 값이라
-- 앞 40자만 봅니다):
--   SELECT left(device_id, 6) AS 기기, left(endpoint, 40) AS 주소앞부분,
--          last_seen_at AS 앱을_마지막으로_연_시각, revoked_at AS 꺼진_시각,
--          left(user_agent, 60) AS 폰
--     FROM public.push_subscriptions
--    WHERE 'proshop' = ANY (topics)
--    ORDER BY revoked_at NULLS FIRST, last_seen_at DESC;
--
-- 지금 이 자리에서 테스트 알림 한 건 보내기 (1분 안에 직원 폰에 떠야 합니다).
-- 운영 화면의 '테스트 알림 보내기' 버튼과 같은 일을 합니다:
--   INSERT INTO public.push_campaigns (title, body, url, topic, scheduled_at)
--   VALUES ('Test alert', 'SQL Editor 에서 보낸 테스트입니다', '/admin', 'proshop', now());
