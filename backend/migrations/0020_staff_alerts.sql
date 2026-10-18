-- ============================================================================
-- 0020 직원 알림이 갔는지 확인하기
-- ============================================================================
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다. 표를 만들지 않고 아무 데이터도 바꾸지 않습니다 -
-- 함수 하나만 추가합니다.
--
-- 먼저 실행해야 하는 것: 0006(관리자), 0010(알림), 0012(주문).
-- 0019(직원 공지)와는 상관없이 돕니다 - 0019 를 실행하면 관리자가 아닌 직원도
-- 이 토픽을 켤 수 있고, 그 폰들도 아래 목록에 함께 나옵니다.
--
-- ----------------------------------------------------------------------------
-- 왜 필요한가
-- ----------------------------------------------------------------------------
-- 주문이 들어오면 0012 가 push_campaigns 에 'proshop' 알림을 넣고, 0010 의
-- 1분 시계가 그것을 직원 폰으로 보냅니다. 그 결과는 이미 push_campaigns 에
-- 적히고(status·attempted·delivered·failed·error), 관리자는 그 칸들을 읽을 수
-- 있습니다. 그래서 "알림이 나갔는가" 는 새 표 없이도 볼 수 있습니다.
--
-- 딱 하나 볼 수 없는 것이 **받을 폰이 몇 대인가** 입니다. 0010 의
-- push_subscriber_count() 는 손님 알림('marketing')만 셉니다. 직원 알림은
-- 'proshop' 토픽이라 그 수에 들어가지 않습니다.
--
-- 그리고 이것이 가장 중요한 칸입니다. 받는 폰이 0대면 발송은 "보낼 사람이
-- 없었다" 를 오류로 여기지 않습니다 - attempted 0, delivered 0, error 없음,
-- status 는 'sent'. 표에는 발송 완료라고 적히고 아무도 받지 못합니다. 직원이
-- 알림을 못 받는 이유의 대부분이 이것입니다(폰을 바꿨거나, 브라우저 데이터를
-- 지웠거나, 알림 권한이 꺼졌거나, 애초에 아무도 켜지 않았거나).
--
-- 그래서 이 파일은 함수 하나만 둡니다: 지금 직원 알림을 받는 폰의 목록.
-- 최근에 꺼진 폰도 7일까지 같이 돌려줍니다 - "어제까지 받던 폰이 어제 꺼졌다"
-- 가 바로 답인 경우가 있습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 직원 알림을 받는 폰 + 발송 시계가 도는지
-- ----------------------------------------------------------------------------
-- 관리자만 부를 수 있습니다. 구독의 진짜 식별자(endpoint)와 암호 키는 돌려주지
-- 않습니다 - 그것이 있으면 그 폰으로 알림을 보낼 수 있습니다. 화면이 필요한
-- 것은 "몇 대이고, 어떤 폰이고, 마지막으로 앱을 언제 열었나" 까지입니다.
CREATE OR REPLACE FUNCTION public.staff_alert_reach()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  phones jsonb := '[]'::jsonb;
  dispatcher text := 'unknown';
BEGIN
  IF NOT public.is_scorecard_admin() THEN
    RAISE EXCEPTION 'staff_alert_reach: admin only' USING ERRCODE = '42501';
  END IF;

  IF to_regclass('public.push_subscriptions') IS NULL THEN
    RETURN jsonb_build_object('phones', phones, 'dispatcher', 'missing');
  END IF;

  -- 켜져 있는 폰을 먼저, 그 안에서는 앱을 최근에 연 순서로.
  SELECT coalesce(jsonb_agg(sub.payload ORDER BY sub.is_off, sub.last_seen_at DESC), '[]'::jsonb)
    INTO phones
    FROM (
      SELECT s.revoked_at IS NOT NULL AS is_off,
             s.last_seen_at,
             jsonb_build_object(
               -- 폰을 가리키는 짧은 이름. 기기 ID 앞 6자면 목록에서 서로 구별되고,
               -- 이것만으로는 그 폰에 알림을 보낼 수 없습니다.
               'device', left(s.device_id, 6),
               'kind', CASE
                 WHEN s.user_agent ~* 'iPhone'  THEN 'iPhone'
                 WHEN s.user_agent ~* 'iPad'    THEN 'iPad'
                 WHEN s.user_agent ~* 'Android' THEN 'Android'
                 WHEN s.user_agent ~* 'Windows' THEN 'Windows'
                 WHEN s.user_agent ~* 'Mac OS'  THEN 'Mac'
                 ELSE NULL
               END,
               'last_seen_at', s.last_seen_at,
               'added_at', s.created_at,
               -- 알림이 꺼진 시각. 직원이 직접 끈 것이거나, 발송 중에 푸시
               -- 서비스가 "없는 주소" 라고 답해 서버가 뺀 것입니다.
               'off_at', s.revoked_at
             ) AS payload
        FROM public.push_subscriptions s
       WHERE 'proshop' = ANY (s.topics)
         AND (s.revoked_at IS NULL OR s.revoked_at > now() - interval '7 days')
    ) sub;

  -- 1분 시계가 실제로 도는지. 이것이 멈추면 알림은 'pending' 인 채로 쌓입니다.
  -- cron 스키마를 못 읽는 환경도 있어 실패는 'unknown' 으로 넘깁니다.
  BEGIN
    IF to_regclass('cron.job') IS NOT NULL THEN
      SELECT CASE WHEN bool_or(j.active) THEN 'on' ELSE 'off' END
        INTO dispatcher
        FROM cron.job j
       WHERE j.jobname = 'push-dispatch';
      dispatcher := coalesce(dispatcher, 'missing');
    END IF;
  EXCEPTION WHEN others THEN
    dispatcher := 'unknown';
  END;

  RETURN jsonb_build_object('phones', phones, 'dispatcher', dispatcher);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_alert_reach() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_alert_reach() TO authenticated;

-- ----------------------------------------------------------------------------
-- 알림 줄이 아예 안 생기는 경우를 잡으려면
-- ----------------------------------------------------------------------------
-- 0012 의 place_food_order 는 알림 INSERT 를 EXCEPTION WHEN others THEN NULL 로
-- 감쌉니다 - 알림이 막혀도 주문은 받아야 하기 때문입니다. 대신 그때는
-- push_campaigns 에 줄이 하나도 생기지 않아, 화면에는 "알림 없음" 으로 보입니다.
-- 그래서 운영 화면은 오늘 주문 수와 오늘 'New order' 알림 수를 나란히 세어
-- 어긋나면 알려 줍니다(프런트 StaffAlertCheck). 이 파일에 할 일은 없습니다.
