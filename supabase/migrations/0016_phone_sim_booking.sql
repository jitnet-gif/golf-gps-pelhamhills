-- 전화 비서·문자 비서가 **실내 골프(시뮬레이터)** 를 예약하고 취소한다.
--
-- 왜: 손님 웹(`/book/indoor`, `/book/lookup`)은 0003·0012 로 이미 예약·변경·취소가 된다.
-- 그런데 전화(ElevenLabs)와 문자(Claude) 비서는 티타임만 알았다. 손님이 "토요일 저녁에
-- 시뮬레이터 두 시간" 이라고 하면 프로 샵으로 넘기는 수밖에 없었다(2026-10-06).
--
-- 왜 0003 의 `pelham_sim_reserve` 를 그대로 쓰지 않나
-- - 이메일이 필수다. 전화 손님에게 이메일을 받아 적게 하면 틀린다. 전화 예약의 열쇠는 번호다.
-- - `source` 가 'online' 으로 남는다. Bay Sheet 가 출처를 보여 준다.
-- - 베이 종류를 골라야 한다. 0009 이후 베이는 전부 좌우 겸용이라 손님에게 물을 것이 없다.
--   여기 함수는 종류를 보지 않고 **켜져 있고 점검 중이 아닌 베이** 중 빈 곳을 고른다.
--
-- 규칙
-- - 영업·격자·겹침은 0007 과 같다: 수~일 14:00-22:00, 15분 격자, 1-5시간, 최대 4명,
--   겹침은 `status not in ('cancelled', 'no_show')` (`pelham_sim_bay_busy`).
-- - 잠금은 0003·0007·0012 와 같은 키 `pelham_sim:<날짜>` 다. 웹·직원·전화가 한 줄로 선다.
-- - 취소 마감은 **온라인과 같다**: 시작 24시간 전까지, confirmed 인 것만, 계산서에 담긴 적이
--   없는 것만(`pelham_guest_deadline`, 0012). 전화로만 다른 규칙을 만들지 않는다. 마감이
--   지났으면 비서가 프로 샵으로 넘긴다. 수수료 규정은 시스템에 없으므로 말하지 않는다.
-- - 본인 확인은 Python 쪽이 한다: 전화는 "번호 + 성" 으로 찾은 예약만, 문자는 "발신번호 +
--   확인 코드". 이 함수들은 그 열쇠가 실제로 맞는지 한 번 더 본다.
-- - **service_role 만** 부른다(Fly 백엔드). 번호만으로 예약을 찾는 함수라 anon 에 열면 안 된다.
--
-- 전제: 0007, 0008, 0012. 실행: SQL editor 에 이 파일 전체를 붙여 한 번. 다시 실행해도 안전하다.

do $$
begin
  if to_regprocedure('public.pelham_sim_bay_busy(integer, date, integer, integer, bigint)') is null then
    raise exception '0016 needs 0007 first (pelham_sim_bay_busy is missing).';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pelham_bill_lines'
                    and column_name = 'sim_reservation_id') then
    raise exception '0016 needs 0008 first (pelham_bill_lines.sim_reservation_id is missing).';
  end if;
  if to_regprocedure('public.pelham_guest_deadline(date, integer)') is null then
    raise exception '0016 needs 0012 first (pelham_guest_deadline is missing).';
  end if;
end;
$$;

-- ===== 헬퍼 ============================================================

-- 비교용 번호: 숫자만, 뒤에서 10자리. `voice.normalize_phone` 과 같다.
create or replace function public.pelham_phone_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

-- 예약 이름의 성(마지막 낱말). "Last, First" 로 적힌 직원 입력은 쉼표 앞을 성으로 본다.
create or replace function public.pelham_sim_last_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(case
    when position(',' in coalesce(p_name, '')) > 0 then btrim(split_part(p_name, ',', 1))
    else coalesce((regexp_match(btrim(coalesce(p_name, '')), '(\S+)$'))[1], '')
  end)
$$;

-- 전화·문자로 취소할 수 없는 이유(비서가 그대로 읽을 짧은 구절). 취소할 수 있으면 null.
-- 마감과 계산서 조건은 `pelham_sim_guest_block`(0012)과 같다.
create or replace function public.pelham_sim_phone_block(r public.pelham_sim_reservations)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when r.status <> 'confirmed' then
      format('it is already %s', replace(r.status, '_', ' '))
    when public.pelham_local_now() > public.pelham_guest_deadline(r.booking_date, r.start_minutes) then
      'it starts in less than 24 hours'
    when exists (select 1 from public.pelham_bill_lines li
                  where li.sim_reservation_id = r.id and li.kind = 'sim_booking' and li.active) then
      'the pro shop has already started a bill for it'
  end
$$;

create or replace function public.pelham_sim_phone_json(r public.pelham_sim_reservations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'confirmation_code', r.confirmation_code,
    'bay_number', b.bay_number,
    'date', to_char(r.booking_date, 'YYYY-MM-DD'),
    'start_time', lpad((r.start_minutes / 60)::text, 2, '0') || ':' || lpad((r.start_minutes % 60)::text, 2, '0'),
    'duration_hours', r.duration_hours,
    'player_count', r.player_count,
    'customer_name', r.customer_name,
    -- 취소 확인 문자를 보낼 곳. 백엔드가 비서에게 넘기는 요약에는 싣지 않는다.
    'phone', r.phone,
    'total_price', r.total_price,
    'status', r.status,
    'cancellable', public.pelham_sim_phone_block(r) is null,
    'reason', public.pelham_sim_phone_block(r)
  )
  from public.pelham_sim_bays b
  where b.id = r.bay_id
$$;

-- ===== 빈 시간 =========================================================

-- 그날 그 길이로 시작할 수 있는 시각과 빈 베이 수. 베이 종류는 보지 않는다.
create or replace function public.pelham_sim_phone_availability(p_date date, p_duration_hours integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  open_min constant integer := 14 * 60;
  close_min constant integer := 22 * 60;
  local_now timestamp := public.pelham_local_now();
  now_min integer := extract(hour from local_now) * 60 + extract(minute from local_now);
  v_total integer;
  v_rate numeric;
  v_free integer;
  v_start integer;
  v_slots jsonb := '[]'::jsonb;
begin
  if p_date is null then
    perform public.pelham_fail('422', 'A date is required, as YYYY-MM-DD.');
  end if;
  if p_duration_hours is null or p_duration_hours not between 1 and 5 then
    perform public.pelham_fail('422', 'Simulator bookings are 1 to 5 hours.');
  end if;
  if extract(isodow from p_date) in (1, 2) then
    return jsonb_build_object('date', to_char(p_date, 'YYYY-MM-DD'), 'is_closed', true, 'slots', '[]'::jsonb,
                              'reason', 'The simulator is closed on Mondays and Tuesdays.');
  end if;

  select count(*), min(b.hourly_rate) into v_total, v_rate
    from public.pelham_sim_bays b
   where b.is_active and b.status <> 'maintenance';
  if v_total = 0 then
    return jsonb_build_object('date', to_char(p_date, 'YYYY-MM-DD'), 'is_closed', true, 'slots', '[]'::jsonb,
                              'reason', 'No simulator bays are open right now.');
  end if;

  v_start := open_min;
  while v_start + p_duration_hours * 60 <= close_min loop
    if p_date > local_now::date or (p_date = local_now::date and v_start > now_min) then
      select count(*) into v_free
        from public.pelham_sim_bays b
       where b.is_active and b.status <> 'maintenance'
         and not public.pelham_sim_bay_busy(b.id, p_date, v_start, p_duration_hours, null);
      if v_free > 0 then
        v_slots := v_slots || jsonb_build_object(
          'time', lpad((v_start / 60)::text, 2, '0') || ':' || lpad((v_start % 60)::text, 2, '0'),
          'free_bays', v_free
        );
      end if;
    end if;
    v_start := v_start + 15;
  end loop;

  return jsonb_build_object(
    'date', to_char(p_date, 'YYYY-MM-DD'),
    'is_closed', false,
    'hourly_rate', v_rate,
    'total_bays', v_total,
    'slots', v_slots,
    'reason', case when jsonb_array_length(v_slots) = 0
                   then format('Every bay is booked for %s hour%s that day.', p_duration_hours,
                               case when p_duration_hours > 1 then 's' else '' end)
              end
  );
end;
$$;

-- ===== 예약 ============================================================

-- p: date(YYYY-MM-DD), start_time(HH:MM, 24시간), duration_hours, player_count,
--    customer_name, phone(필수), via('phone' | 'text').
create or replace function public.pelham_sim_phone_reserve(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  local_now timestamp := public.pelham_local_now();
  v_date date;
  v_start integer;
  v_duration integer;
  v_players integer;
  v_name text := btrim(coalesce(p->>'customer_name', ''));
  v_phone text := btrim(coalesce(p->>'phone', ''));
  v_via text := coalesce(p->>'via', 'phone');
  v_bay public.pelham_sim_bays;
  v_code text;
  v_row public.pelham_sim_reservations;
  m text[];
begin
  if coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    perform public.pelham_fail('422', 'A date is required, as YYYY-MM-DD.');
  end if;
  v_date := (p->>'date')::date;

  m := regexp_match(coalesce(p->>'start_time', ''), '^(\d{1,2}):(\d{2})$');
  if m is null or m[1]::integer > 23 or m[2]::integer > 59 then
    perform public.pelham_fail('422', 'The start time must be HH:MM.');
  end if;
  v_start := m[1]::integer * 60 + m[2]::integer;

  if coalesce(p->>'duration_hours', '') !~ '^\d+$' or (p->>'duration_hours')::integer not between 1 and 5 then
    perform public.pelham_fail('422', 'Simulator bookings are 1 to 5 hours.');
  end if;
  v_duration := (p->>'duration_hours')::integer;

  if coalesce(p->>'player_count', '') !~ '^\d+$' or (p->>'player_count')::integer not between 1 and 4 then
    perform public.pelham_fail('422', 'A bay takes 1 to 4 players.');
  end if;
  v_players := (p->>'player_count')::integer;

  if v_name = '' or length(v_name) > 120 then
    perform public.pelham_fail('422', 'The booking needs the guest''s name.');
  end if;
  if length(public.pelham_phone_key(v_phone)) <> 10 or length(v_phone) > 40 then
    perform public.pelham_fail('422', 'The booking needs a 10-digit phone number.');
  end if;
  if v_via not in ('phone', 'text') then
    perform public.pelham_fail('422', format('''%s'' is not a booking channel', v_via));
  end if;

  if extract(isodow from v_date) in (1, 2) then
    perform public.pelham_fail('422', 'The simulator is closed on Mondays and Tuesdays.');
  end if;
  if v_start % 15 <> 0 or v_start < 14 * 60 or v_start + v_duration * 60 > 22 * 60 then
    perform public.pelham_fail('422', 'Simulator bookings run 2:00 PM to 10:00 PM, starting on the quarter hour.');
  end if;
  if v_date < local_now::date
     or (v_date = local_now::date
         and v_start <= extract(hour from local_now) * 60 + extract(minute from local_now)) then
    perform public.pelham_fail('409', 'That time has already passed.');
  end if;

  perform pg_advisory_xact_lock(hashtext('pelham_sim:' || v_date::text));

  select b.* into v_bay
    from public.pelham_sim_bays b
   where b.is_active and b.status <> 'maintenance'
     and not public.pelham_sim_bay_busy(b.id, v_date, v_start, v_duration, null)
   order by b.bay_number
   limit 1;
  if v_bay.id is null then
    perform public.pelham_fail('409', 'Every bay is booked for that time.');
  end if;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.pelham_sim_reservations r where r.confirmation_code = v_code);
  end loop;

  insert into public.pelham_sim_reservations
    (bay_id, booking_date, start_minutes, duration_hours, player_count,
     customer_name, customer_email, phone, notes, confirmation_code, total_price, source)
  values
    (v_bay.id, v_date, v_start, v_duration, v_players,
     v_name, '', v_phone,
     case when v_via = 'text' then 'Booked by text message with the booking assistant.'
          else 'Booked by phone with the voice assistant.' end,
     v_code, v_bay.hourly_rate * v_duration, 'voice_ai')
  returning * into v_row;

  return public.pelham_sim_phone_json(v_row);
end;
$$;

-- ===== 찾기 ============================================================

-- 오늘 이후의 살아 있는 예약 중 번호가 맞는 것. 성이나 코드를 주면 그것도 맞아야 한다.
-- 번호만으로는 부르지 않는다(Python 이 성 또는 코드를 언제나 함께 보낸다).
create or replace function public.pelham_sim_phone_find(
  p_phone text, p_last_name text default null, p_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := public.pelham_phone_key(p_phone);
  v_last text := lower(btrim(coalesce(p_last_name, '')));
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if length(v_key) <> 10 then
    perform public.pelham_fail('422', 'A 10-digit phone number is needed to find a booking.');
  end if;
  if v_last = '' and v_code = '' then
    perform public.pelham_fail('422', 'A last name or a confirmation code is needed as well as the number.');
  end if;

  return coalesce((
    select jsonb_agg(public.pelham_sim_phone_json(r) order by r.booking_date, r.start_minutes)
      from public.pelham_sim_reservations r
     where r.booking_date >= public.pelham_local_now()::date
       and r.status not in ('cancelled', 'no_show')
       and public.pelham_phone_key(r.phone) = v_key
       and (v_last = '' or public.pelham_sim_last_name(r.customer_name) = v_last)
       and (v_code = '' or r.confirmation_code = v_code)
  ), '[]'::jsonb);
end;
$$;

-- ===== 취소 ============================================================

-- p_phone / p_last_name 중 준 것은 전부 예약과 맞아야 한다(하나는 꼭 줄 것).
-- p_preview = true 면 취소할 수 있는지만 돌려준다. 지우지 않고 status 만 바꾼다.
create or replace function public.pelham_sim_phone_cancel(
  p_id bigint,
  p_phone text default null,
  p_last_name text default null,
  p_preview boolean default false,
  p_via text default 'phone'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  seen public.pelham_sim_reservations;
  v public.pelham_sim_reservations;
  v_block text;
begin
  if nullif(btrim(coalesce(p_phone, '')), '') is null and nullif(btrim(coalesce(p_last_name, '')), '') is null then
    perform public.pelham_fail('422', 'A phone number or last name is needed to cancel.');
  end if;

  select * into seen from public.pelham_sim_reservations where id = p_id;
  if seen.id is null
     or (nullif(btrim(coalesce(p_phone, '')), '') is not null
         and public.pelham_phone_key(seen.phone) <> public.pelham_phone_key(p_phone))
     or (nullif(btrim(coalesce(p_last_name, '')), '') is not null
         and public.pelham_sim_last_name(seen.customer_name) <> lower(btrim(p_last_name))) then
    perform public.pelham_fail('404', 'No simulator booking matches those details.');
  end if;

  perform pg_advisory_xact_lock(hashtext('pelham_sim:' || seen.booking_date::text));
  select * into v from public.pelham_sim_reservations where id = p_id for update;

  if v.status = 'cancelled' then
    return public.pelham_sim_phone_json(v) || jsonb_build_object('cancelled', true, 'already', true);
  end if;
  v_block := public.pelham_sim_phone_block(v);
  if v_block is not null then
    perform public.pelham_fail('409', format('This booking can''t be cancelled by phone or text because %s.', v_block));
  end if;
  if p_preview then
    return public.pelham_sim_phone_json(v) || jsonb_build_object('cancelled', false, 'already', false);
  end if;

  update public.pelham_sim_reservations
     set status = 'cancelled',
         notes = btrim(notes || E'\n' || format('[%s] Cancelled %s.',
                       to_char(public.pelham_local_now(), 'YYYY-MM-DD HH24:MI'),
                       case when p_via = 'text' then 'by text reply' else 'by phone with the voice assistant' end)),
         updated_at = now()
   where id = v.id
   returning * into v;

  return public.pelham_sim_phone_json(v) || jsonb_build_object('cancelled', true, 'already', false);
end;
$$;

-- ===== 권한 ============================================================
-- 전부 service_role 만. 번호로 예약을 찾는 함수라 anon·authenticated 에 열지 않는다.

revoke all on function public.pelham_phone_key(text) from public, anon, authenticated;
revoke all on function public.pelham_sim_last_name(text) from public, anon, authenticated;
revoke all on function public.pelham_sim_phone_block(public.pelham_sim_reservations) from public, anon, authenticated;
revoke all on function public.pelham_sim_phone_json(public.pelham_sim_reservations) from public, anon, authenticated;
revoke all on function public.pelham_sim_phone_availability(date, integer) from public, anon, authenticated;
revoke all on function public.pelham_sim_phone_reserve(jsonb) from public, anon, authenticated;
revoke all on function public.pelham_sim_phone_find(text, text, text) from public, anon, authenticated;
revoke all on function public.pelham_sim_phone_cancel(bigint, text, text, boolean, text) from public, anon, authenticated;

grant execute on function public.pelham_sim_phone_availability(date, integer) to service_role;
grant execute on function public.pelham_sim_phone_reserve(jsonb) to service_role;
grant execute on function public.pelham_sim_phone_find(text, text, text) to service_role;
grant execute on function public.pelham_sim_phone_cancel(bigint, text, text, boolean, text) to service_role;

notify pgrst, 'reload schema';
