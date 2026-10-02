-- 실내 골프 베이는 **3개뿐**이다: Bay 1·2·3, 모두 오른손·왼손 겸용(left_right).
--
-- 왜: 0003 시드는 옛 `backend/data/simulator.json` 을 옮긴 것이라 베이가 5개였다
-- (1~3 right_handed, 4 left_right, 5 vip). 실제 매장은 좌우 겸용 3베이다(2026-10-01).
--
-- 바뀌는 것
-- 1. Bay 1·2·3 → bay_type = 'left_right'. 요금은 그대로(20).
-- 2. Bay 4·5 → is_active = false. 지우지 않는다 — 지난 예약·계산서가 이 id 를 가리킨다.
--    0007 함수가 이미 is_active 를 보므로 Bay Sheet·온라인 예약 모두에서 사라진다.
--
-- 안전장치: Bay 4·5 에 오늘 이후의 살아 있는 예약이 있으면 아무것도 바꾸지 않고 멈춘다
-- (꺼진 베이의 예약은 Bay Sheet 에 안 보여서 잃어버린다). 먼저 Bay 1~3 으로 옮기거나 취소한다.
--
-- 전제: 0003, 0007. 실행: SQL editor 에 이 파일 전체를 붙여 한 번. 다시 실행해도 안전하다.

do $$
declare
  stuck text;
begin
  select string_agg(format('Bay %s %s %s (%s)', b.bay_number, r.booking_date,
                           to_char(make_time(r.start_minutes / 60, r.start_minutes % 60, 0), 'HH24:MI'),
                           r.confirmation_code), ', ' order by r.booking_date, r.start_minutes)
    into stuck
    from public.pelham_sim_reservations r
    join public.pelham_sim_bays b on b.id = r.bay_id
   where b.bay_number not in (1, 2, 3)
     and b.is_active
     and r.booking_date >= public.pelham_local_now()::date
     and r.status not in ('cancelled', 'no_show', 'paid');
  if stuck is not null then
    raise exception 'Move or cancel these bookings first: %', stuck;
  end if;

  update public.pelham_sim_bays
     set bay_type = 'left_right'
   where bay_number in (1, 2, 3) and bay_type <> 'left_right';

  update public.pelham_sim_bays
     set is_active = false
   where bay_number not in (1, 2, 3) and is_active;
end $$;

select id, bay_number, bay_type, hourly_rate, is_active
  from public.pelham_sim_bays
 order by bay_number;
