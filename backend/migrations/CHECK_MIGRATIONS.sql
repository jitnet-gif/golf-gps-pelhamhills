-- ============================================================================
-- 서버에 무엇이 들어가 있는지 (읽기만 합니다)
-- ============================================================================
--
-- **이 파일 전체를 붙여 넣고 Run 하세요.** 0006 부터 0020 까지 어느 파일이
-- 들어가 있고 어느 것이 빠졌는지 한 표로 나옵니다. 표가 하나도 없는 서버에서도
-- 오류 없이 돕니다 - 카탈로그(무엇이 존재하는지 적어 둔 곳)만 읽습니다.
--
-- 아무것도 만들지 않고 아무것도 바꾸지 않습니다.
--
-- 읽는 법: '빠짐' 으로 나온 줄의 파일을, **위에서부터 순서대로** 실행하세요.
-- 뒤 파일이 앞 파일의 표를 쓰는 곳이 있어서 순서가 중요합니다. 모든
-- 마이그레이션은 여러 번 실행해도 안전합니다.
-- ============================================================================

WITH checks(ord, 파일, 확인하는_것, 있음) AS (
  VALUES
    -- 확장 (알림 발송에만 필요합니다)
    (1, '확장', 'pg_net (DB 가 발송 서버를 부르는 통로)',
        EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')),
    (2, '확장', 'pg_cron (1분마다 깨우는 시계)',
        EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')),

    -- 0006 스코어카드 + 관리자. 뒤의 거의 모든 파일이 이것을 씁니다.
    (10, '0006_scorecards', 'scorecards 표',
         to_regclass('public.scorecards') IS NOT NULL),
    (11, '0006_scorecards', 'scorecard_admins 표 (누가 관리자인지)',
         to_regclass('public.scorecard_admins') IS NOT NULL),
    (12, '0006_scorecards', 'is_scorecard_admin() 함수',
         to_regprocedure('public.is_scorecard_admin()') IS NOT NULL),

    -- 0007 코스 지도 수정 + 설정 보관함
    (20, '0007_hole_edits', 'hole_edits 표',
         to_regclass('public.hole_edits') IS NOT NULL),
    (21, '0007_hole_edits', 'app_settings 표 (영업시간 등 설정)',
         to_regclass('public.app_settings') IS NOT NULL),

    -- 0009 배너. 알림(0010)에 꼭 필요하지는 않습니다 - 있으면 연결됩니다.
    (30, '0009_promotions', 'promotions 표 (배너)',
         to_regclass('public.promotions') IS NOT NULL),
    (31, '0009_promotions', 'promotion_events 표 (배너 성과)',
         to_regclass('public.promotion_events') IS NOT NULL),

    -- 0010 알림. 직원 알림·손님 알림이 전부 여기서 나옵니다.
    (40, '0010_push', 'push_subscriptions 표 (알림을 켠 폰)',
         to_regclass('public.push_subscriptions') IS NOT NULL),
    (41, '0010_push', 'push_campaigns 표 (보낼 알림)',
         to_regclass('public.push_campaigns') IS NOT NULL),
    (42, '0010_push', 'push_dispatch_due() 함수 (1분 시계가 부르는 것)',
         to_regprocedure('public.push_dispatch_due()') IS NOT NULL),

    -- 0011 카트 길
    (50, '0011_cart_paths', 'cart_paths 표',
         to_regclass('public.cart_paths') IS NOT NULL),

    -- 0012 음식 주문
    (60, '0012_food_orders', 'menu_items 표',
         to_regclass('public.menu_items') IS NOT NULL),
    (61, '0012_food_orders', 'food_orders 표',
         to_regclass('public.food_orders') IS NOT NULL),
    (62, '0012_food_orders', 'place_food_order() 함수',
         to_regprocedure('public.place_food_order(jsonb)') IS NOT NULL),
    (63, '0012_food_orders', 'set_proshop_push() 함수 (직원 폰만 주문 알림)',
         to_regprocedure('public.set_proshop_push(text,boolean)') IS NOT NULL),

    -- 0014 플레이어 모니터
    (70, '0014_player_monitor', 'player_positions 표',
         to_regclass('public.player_positions') IS NOT NULL),
    (71, '0014_player_monitor', 'report_player_position() 함수',
         to_regprocedure('public.report_player_position(text,text,double precision,double precision,real,smallint,text,text)') IS NOT NULL),

    -- 0015 메뉴 사진
    (80, '0015_menu_photos', 'menu_items.image_url 칸',
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'menu_items'
                    AND column_name = 'image_url')),
    (81, '0015_menu_photos', 'menu-photos 저장통',
         EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'menu-photos')),
    (82, '0015_menu_photos', 'menu-photos 정책 4개',
         (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'storage' AND tablename = 'objects'
             AND policyname LIKE 'menu_photos%') >= 4),

    -- 0016 코드 없이 내 주문 보기
    (90, '0016_my_orders_by_phone', 'my_food_orders() 함수',
         to_regprocedure('public.my_food_orders(text)') IS NOT NULL),

    -- 0017 손님이 취소
    (100, '0017_cancel_order', 'cancel_food_order() 함수',
          to_regprocedure('public.cancel_food_order(text)') IS NOT NULL),

    -- 0018 결제 표시
    (110, '0018_order_payment', 'food_orders.paid_at 칸',
          EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'food_orders'
                     AND column_name = 'paid_at')),
    (111, '0018_order_payment', 'food_orders.paid_method 칸',
          EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'food_orders'
                     AND column_name = 'paid_method')),

    -- 0019 직원 공지
    (120, '0019_staff_notices', 'staff_members 표 (직원 명부)',
          to_regclass('public.staff_members') IS NOT NULL),
    (121, '0019_staff_notices', 'send_staff_notice() 함수',
          to_regprocedure('public.send_staff_notice(text,text)') IS NOT NULL),

    -- 0020 직원 알림 점검
    (130, '0020_staff_alerts', 'staff_alert_reach() 함수',
          to_regprocedure('public.staff_alert_reach()') IS NOT NULL)
)
SELECT 파일,
       확인하는_것,
       CASE WHEN 있음 THEN '있음' ELSE '빠짐  <-- 이 파일을 실행하세요' END AS 결과
  FROM checks
 ORDER BY ord;

-- ----------------------------------------------------------------------------
-- 직원 알림이 실제로 갔는지까지 보려면
-- ----------------------------------------------------------------------------
-- CHECK_staff_alerts.sql 을 붙여 넣고 Run 하세요. 받는 폰이 몇 대인지, 1분
-- 시계가 도는지, 최근 알림이 몇 대에 전달됐는지 한 표로 나옵니다. 그 파일도
-- 표가 없는 서버에서 오류 없이 돕니다.
--
-- ----------------------------------------------------------------------------
-- 0013(인쇄 메뉴판 17개)은 여기서 확인되지 않습니다
-- ----------------------------------------------------------------------------
-- 표가 아니라 데이터(메뉴 행)를 넣는 파일이라, 들어갔는지는 행을 세어야 압니다.
-- menu_items 표가 '있음' 일 때 이 두 줄만 선택해서 Run 하세요:
--   SELECT count(*) AS 메뉴_개수, count(*) FILTER (WHERE is_available) AS 파는_것
--     FROM public.menu_items;
--
-- ----------------------------------------------------------------------------
-- 0015 의 저장통 정책이 '빠짐' 으로 나올 때
-- ----------------------------------------------------------------------------
-- SQL Editor 가 storage.objects 에 정책 만드는 것을 거부하는 일이 흔합니다
-- ("must be owner of table objects"). 그때는 대시보드에서 손으로:
--   Storage > New bucket > 이름 menu-photos, Public 켜기
--   그 버킷의 Policies 에 0015 파일 아래쪽 네 개를 그대로 넣기
-- 사진 올리기만 그 정책을 씁니다. 인쇄 메뉴판에서 잘라 온 사진 17장은
-- 앱에 들어 있어서 이것과 상관없이 나옵니다.
