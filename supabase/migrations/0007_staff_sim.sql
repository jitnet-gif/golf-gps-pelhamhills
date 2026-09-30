-- 실내 골프 **직원 Bay Sheet**(`/admin/simulator-sheet`)를 FastAPI 없이 돌린다.
--
-- 왜: 0003 은 손님 화면(`/book/indoor`)만 옮겼다. 직원 Bay Sheet 는 꺼진 Fly API 를
-- 부르다 실패해 늘 "local sample mode" 였고, 손님이 온라인으로 잡은 베이 예약이 직원
-- 화면에 보이지 않았다(겹침 위험). 2026-09-30 확인.
--
-- 규칙 (0003·0004 와 같다)
-- - 공유 프로젝트다. 테이블·함수 전부 `pelham_` 접두사.
-- - 테이블에는 anon/authenticated 권한이 없다. 직원이 닿는 문은 아래
--   `pelham_staff_sim_*` 함수 다섯 개뿐이고, 함수마다 `pelham_require_staff()` 가 먼저다.
-- - 잠금 키는 0003 의 손님 예약과 **글자 그대로 같다**(`'pelham_sim:' || 날짜`) — 그래야
--   손님 예약과 직원 편집이 같은 날에서 서로를 기다린다.
-- - 오류는 `PTxxx` SQLSTATE. PT401=로그인·직원 아님, PT404=없음, PT409=베이 겹침, PT422=입력 오류.
--
-- 바뀌는 것
-- 1. 예약 상태가 늘어난다: confirmed / checked_in / paid / no_show / cancelled.
--    **cancelled 가 아닌 예약은 전부 베이를 차지한다.** 0003 의 손님 함수는
--    `status = 'confirmed'` 만 보고 있어서, 직원이 체크인·결제 처리한 순간 손님이 같은
--    베이를 다시 잡을 수 있었다. 그래서 손님 함수 두 개(availability, reserve)를 여기서
--    다시 정의한다. 바뀐 곳은 겹침 조건 한 줄씩뿐이다.
--    예외: **no_show 는 베이를 비운다**(2026-09-30 사용자 결정). 노쇼로 표시하면 기록은
--    남고 그 시간에 워크인·온라인 예약을 새로 받을 수 있다. 노쇼를 되돌리면(다른 상태로)
--    그 사이 누가 잡았는지 다시 확인한다.
-- 2. `source` 칸(online / phone / walk_in / voice_ai). 손님 예약은 기본값 online.
-- 3. 베이 상태 `pelham_sim_bays.status`(open / cleaning / maintenance). 전엔 직원 브라우저에만
--    있어서 기기끼리 공유되지 않고 온라인 예약도 막지 못했다.
--    - maintenance: 온라인 예약에서 빠지고, 직원도 그 베이에 새로 잡거나 옮겨 넣을 수 없다.
--      이미 잡힌 예약은 그대로 둔다 — 직원이 화면에서 보고 다른 베이로 옮긴다.
--    - cleaning: 지금 청소 중이라는 표시일 뿐이다. 나중 시간 예약은 막지 않는다.
--    날짜별이 아니라 "지금" 상태다. 점검이 끝나면 직원이 Open 으로 되돌린다.
--
-- 전제: 0003, 0004. 실행: SQL editor 에 이 파일 전체를 붙여 한 번. 다시 실행해도 안전하다.

do $$
begin
  if to_regprocedure('public.pelham_require_staff()') is null then
    raise exception '0007 needs 0004 first (pelham_require_staff is missing).';
  end if;
  if to_regclass('public.pelham_sim_reservations') is null then
    raise exception '0007 needs 0003 first (pelham_sim_reservations is missing).';
  end if;
end;
$$;

alter table public.pelham_sim_reservations
  add column if not exists source text not null default 'online';

alter table public.pelham_sim_bays
  add column if not exists status text not null default 'open',
  add column if not exists status_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pelham_sim_bays_status_check') then
    alter table public.pelham_sim_bays add constraint pelham_sim_bays_status_check
      check (status in ('open', 'cleaning', 'maintenance'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pelham_sim_reservations_source_check') then
    alter table public.pelham_sim_reservations add constraint pelham_sim_reservations_source_check
      check (source in ('online', 'phone', 'walk_in', 'voice_ai'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pelham_sim_reservations_status_check') then
    alter table public.pelham_sim_reservations add constraint pelham_sim_reservations_status_check
      check (status in ('confirmed', 'checked_in', 'paid', 'no_show', 'cancelled'));
  end if;
end;
$$;

-- ===== 헬퍼 ============================================================

-- 그 베이의 그 시간이 이미 차 있는가. p_exclude = 자기 자신(옮기는 중인 예약).
create or replace function public.pelham_sim_bay_busy(
  p_bay integer, p_date date, p_start integer, p_duration integer, p_exclude bigint
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pelham_sim_reservations r
     where r.bay_id = p_bay
       and r.booking_date = p_date
       and r.status not in ('cancelled', 'no_show')
       and r.id is distinct from p_exclude
       and r.start_minutes < p_start + p_duration * 60
       and r.start_minutes + r.duration_hours * 60 > p_start
  )
$$;

-- Bay Sheet 화면의 `Reservation` 모양 그대로.
create or replace function public.pelham_sim_reservation_json(r public.pelham_sim_reservations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'confirmation_code', r.confirmation_code,
    'bay_id', r.bay_id,
    'date', to_char(r.booking_date, 'YYYY-MM-DD'),
    'start_time', lpad((r.start_minutes / 60)::text, 2, '0') || ':' || lpad((r.start_minutes % 60)::text, 2, '0'),
    'duration_hours', r.duration_hours,
    'player_count', r.player_count,
    'customer_name', r.customer_name,
    'customer_email', r.customer_email,
    'phone', r.phone,
    'notes', r.notes,
    'status', r.status,
    'source', r.source,
    'total_price', r.total_price,
    'created_at', public.pelham_iso(r.created_at),
    'updated_at', public.pelham_iso(r.updated_at)
  )
$$;

-- 입력 검사. 들어온 칸만 본다(수정은 일부 칸만 보낸다).
create or replace function public.pelham_sim_check(p jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p ? 'date' and coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    perform public.pelham_fail('422', 'Invalid date format. Use YYYY-MM-DD');
  end if;
  if p ? 'start_time' and coalesce(p->>'start_time', '') !~ '^\d{1,2}:\d{2}$' then
    perform public.pelham_fail('422', 'Invalid time format. Use HH:MM');
  end if;
  if p ? 'bay_id' and coalesce(p->>'bay_id', '') !~ '^\d+$' then
    perform public.pelham_fail('422', 'Pick a bay.');
  end if;
  if p ? 'duration_hours' and (coalesce(p->>'duration_hours', '') !~ '^\d+$'
                               or (p->>'duration_hours')::integer not between 1 and 5) then
    perform public.pelham_fail('422', 'Duration must be between 1 and 5 hours.');
  end if;
  if p ? 'player_count' and (coalesce(p->>'player_count', '') !~ '^\d+$'
                             or (p->>'player_count')::integer not between 1 and 4) then
    perform public.pelham_fail('422', 'Player count must be between 1 and 4.');
  end if;
  if p ? 'customer_name' and length(btrim(coalesce(p->>'customer_name', ''))) not between 1 and 120 then
    perform public.pelham_fail('422', 'Customer name is required (up to 120 characters).');
  end if;
  if p ? 'customer_email' and length(btrim(coalesce(p->>'customer_email', ''))) > 254 then
    perform public.pelham_fail('422', 'Email is too long.');
  end if;
  if p ? 'phone' and length(btrim(coalesce(p->>'phone', ''))) > 40 then
    perform public.pelham_fail('422', 'Phone is too long.');
  end if;
  if p ? 'notes' and length(btrim(coalesce(p->>'notes', ''))) > 1000 then
    perform public.pelham_fail('422', 'Notes are too long (1000 characters).');
  end if;
  if p ? 'status' and coalesce(p->>'status', '') not in
     ('confirmed', 'checked_in', 'paid', 'no_show', 'cancelled') then
    perform public.pelham_fail('422', format('''%s'' is not a reservation status', p->>'status'));
  end if;
  if p ? 'source' and coalesce(p->>'source', '') not in ('online', 'phone', 'walk_in', 'voice_ai') then
    perform public.pelham_fail('422', format('''%s'' is not a booking source', p->>'source'));
  end if;
end;
$$;

-- 그날·그 베이·그 시간이 영업 안에 있고 비어 있는가. 아니면 실패로 끝난다.
-- 부르기 전에 그날의 잠금을 잡아 둘 것.
create or replace function public.pelham_sim_require_slot(
  p_bay integer, p_date date, p_start integer, p_duration integer, p_exclude bigint
)
returns public.pelham_sim_bays
language plpgsql
stable
set search_path = ''
as $$
declare
  v_bay public.pelham_sim_bays;
begin
  if extract(isodow from p_date) in (1, 2) then
    perform public.pelham_fail('422', 'The simulator is closed on Mondays and Tuesdays.');
  end if;
  if p_start % 15 <> 0 or p_start < 14 * 60 or p_start + p_duration * 60 > 22 * 60 then
    perform public.pelham_fail('422', 'Bookings run 2:00 PM – 10:00 PM on the 15-minute grid.');
  end if;
  select * into v_bay from public.pelham_sim_bays where id = p_bay;
  if v_bay.id is null then
    perform public.pelham_fail('404', 'Bay not found');
  end if;
  if not v_bay.is_active then
    perform public.pelham_fail('422', format('Bay %s is not in service.', v_bay.bay_number));
  end if;
  if v_bay.status = 'maintenance' then
    perform public.pelham_fail('409', format('Bay %s is under maintenance — set it to Open first.', v_bay.bay_number));
  end if;
  if public.pelham_sim_bay_busy(p_bay, p_date, p_start, p_duration, p_exclude) then
    perform public.pelham_fail('409', format('Bay %s is already booked for part of that time.', v_bay.bay_number));
  end if;
  return v_bay;
end;
$$;

create or replace function public.pelham_sim_bay_json(b public.pelham_sim_bays)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id,
    'bay_number', b.bay_number,
    'bay_type', b.bay_type,
    'hourly_rate', b.hourly_rate,
    'is_active', b.is_active,
    'status', b.status,
    'status_updated_at', public.pelham_iso(b.status_updated_at)
  )
$$;

-- ===== 직원 함수 =======================================================

create or replace function public.pelham_staff_sim_bays()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pelham_require_staff();
  return coalesce((
    select jsonb_agg(public.pelham_sim_bay_json(b) order by b.bay_number)
      from public.pelham_sim_bays b
  ), '[]'::jsonb);
end;
$$;

-- 베이 상태를 바꾼다(open / cleaning / maintenance). 모든 직원 화면과 온라인 예약이 같은 값을 본다.
create or replace function public.pelham_staff_sim_bay_status(p_bay integer, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pelham_sim_bays;
begin
  perform public.pelham_require_staff();
  if coalesce(p_status, '') not in ('open', 'cleaning', 'maintenance') then
    perform public.pelham_fail('422', format('''%s'' is not a bay status', coalesce(p_status, '')));
  end if;
  update public.pelham_sim_bays
     set status = p_status,
         status_updated_at = now()
   where id = p_bay
  returning * into v;
  if v.id is null then
    perform public.pelham_fail('404', 'Bay not found');
  end if;
  return public.pelham_sim_bay_json(v);
end;
$$;

-- 그날의 예약 전부(취소 포함 — 화면에 "Show cancelled" 가 있다).
create or replace function public.pelham_staff_sim_reservations(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pelham_require_staff();
  if p_date is null then
    perform public.pelham_fail('422', 'Invalid date format. Use YYYY-MM-DD');
  end if;
  return coalesce((
    select jsonb_agg(public.pelham_sim_reservation_json(r) order by r.start_minutes, r.bay_id)
      from public.pelham_sim_reservations r
     where r.booking_date = p_date
  ), '[]'::jsonb);
end;
$$;

-- 직원이 잡는 예약(워크인·전화). 손님 예약과 달리 베이를 직접 고르고, 이메일은 없어도 되며,
-- 이미 지난 시각도 받는다(사후 기록).
create or replace function public.pelham_staff_sim_create(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_start integer;
  v_duration integer;
  v_bay public.pelham_sim_bays;
  v_code text;
  v_row public.pelham_sim_reservations;
begin
  perform public.pelham_require_staff();
  p := coalesce(p, '{}'::jsonb);
  if not (p ? 'bay_id' and p ? 'date' and p ? 'start_time' and p ? 'duration_hours' and p ? 'customer_name') then
    perform public.pelham_fail('422', 'bay_id, date, start_time, duration_hours and customer_name are required.');
  end if;
  perform public.pelham_sim_check(p);

  v_date := (p->>'date')::date;
  v_start := split_part(p->>'start_time', ':', 1)::integer * 60 + split_part(p->>'start_time', ':', 2)::integer;
  v_duration := (p->>'duration_hours')::integer;

  perform pg_advisory_xact_lock(hashtext('pelham_sim:' || v_date::text));
  v_bay := public.pelham_sim_require_slot((p->>'bay_id')::integer, v_date, v_start, v_duration, null);

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.pelham_sim_reservations r where r.confirmation_code = v_code);
  end loop;

  insert into public.pelham_sim_reservations
    (bay_id, booking_date, start_minutes, duration_hours, player_count,
     customer_name, customer_email, phone, notes, confirmation_code, total_price, status, source)
  values
    (v_bay.id, v_date, v_start, v_duration, coalesce((p->>'player_count')::integer, 1),
     btrim(p->>'customer_name'), btrim(coalesce(p->>'customer_email', '')),
     btrim(coalesce(p->>'phone', '')), btrim(coalesce(p->>'notes', '')),
     v_code, v_bay.hourly_rate * v_duration,
     coalesce(p->>'status', 'confirmed'), coalesce(p->>'source', 'walk_in'))
  returning * into v_row;

  return public.pelham_sim_reservation_json(v_row);
end;
$$;

-- 일부 칸만 고친다. 베이·날짜·시간·길이가 바뀌거나 취소에서 되살리면 빈자리를 다시 본다.
-- 지우기는 없다 — 취소는 status = 'cancelled'.
create or replace function public.pelham_staff_sim_update(p_id bigint, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pelham_sim_reservations;
  v_bay public.pelham_sim_bays;
  v_bay_id integer;
  v_date date;
  v_start integer;
  v_duration integer;
  v_status text;
  v_moved boolean;
begin
  perform public.pelham_require_staff();
  p := coalesce(p, '{}'::jsonb);
  perform public.pelham_sim_check(p);

  select * into v from public.pelham_sim_reservations where id = p_id;
  if v.id is null then
    perform public.pelham_fail('404', 'Reservation not found');
  end if;

  v_bay_id := coalesce((p->>'bay_id')::integer, v.bay_id);
  v_date := coalesce((p->>'date')::date, v.booking_date);
  v_start := case when p ? 'start_time'
                  then split_part(p->>'start_time', ':', 1)::integer * 60 + split_part(p->>'start_time', ':', 2)::integer
                  else v.start_minutes end;
  v_duration := coalesce((p->>'duration_hours')::integer, v.duration_hours);
  v_status := coalesce(p->>'status', v.status);
  v_moved := v_bay_id <> v.bay_id or v_date <> v.booking_date
             or v_start <> v.start_minutes or v_duration <> v.duration_hours;

  -- 옛 날짜와 새 날짜 둘 다 잠근다. 순서를 정해 두어 교착을 피한다.
  perform pg_advisory_xact_lock(hashtext('pelham_sim:' || least(v.booking_date, v_date)::text));
  if v_date <> v.booking_date then
    perform pg_advisory_xact_lock(hashtext('pelham_sim:' || greatest(v.booking_date, v_date)::text));
  end if;
  select * into v from public.pelham_sim_reservations where id = p_id for update;

  select * into v_bay from public.pelham_sim_bays where id = v_bay_id;
  if v_status not in ('cancelled', 'no_show') and (v_moved or v.status in ('cancelled', 'no_show')) then
    v_bay := public.pelham_sim_require_slot(v_bay_id, v_date, v_start, v_duration, p_id);
  elsif v_bay.id is null then
    perform public.pelham_fail('404', 'Bay not found');
  end if;

  update public.pelham_sim_reservations
     set bay_id = v_bay_id,
         booking_date = v_date,
         start_minutes = v_start,
         duration_hours = v_duration,
         player_count = coalesce((p->>'player_count')::integer, player_count),
         customer_name = case when p ? 'customer_name' then btrim(p->>'customer_name') else customer_name end,
         customer_email = case when p ? 'customer_email' then btrim(coalesce(p->>'customer_email', '')) else customer_email end,
         phone = case when p ? 'phone' then btrim(coalesce(p->>'phone', '')) else phone end,
         notes = case when p ? 'notes' then btrim(coalesce(p->>'notes', '')) else notes end,
         status = v_status,
         source = coalesce(p->>'source', source),
         -- 요금은 베이나 길이가 바뀔 때만 다시 계산한다(손님이 낸 값을 괜히 흔들지 않는다).
         total_price = case when v_bay_id <> bay_id or v_duration <> duration_hours
                            then v_bay.hourly_rate * v_duration else total_price end,
         updated_at = now()
   where id = p_id
  returning * into v;

  return public.pelham_sim_reservation_json(v);
end;
$$;

-- ===== 손님 함수 다시 정의 (0003) =======================================
-- 0003 과 같고, 두 가지만 바꿨다(파일 머리의 "바뀌는 것" 1·3):
-- - 겹침 조건 `r.status = 'confirmed'` → `r.status not in ('cancelled', 'no_show')`
-- - 베이 조건에 `b.status <> 'maintenance'` 를 더하고, 점검 때문에 막힌 경우의 문장을 따로 둠

create or replace function public.pelham_sim_availability(
  p_date date,
  p_bay_type text default 'right_handed',
  p_duration_hours integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  open_min constant integer := 14 * 60;
  close_min constant integer := 22 * 60;
  span integer;
  local_now timestamp := public.pelham_local_now();
  label text;
  total integer;
  free_bays integer;
  slots jsonb := '[]'::jsonb;
  base jsonb;
  start_min integer;
begin
  if p_date is null then
    perform public.pelham_fail('400', 'Invalid date format. Use YYYY-MM-DD');
  end if;
  if p_duration_hours is null or p_duration_hours not between 1 and 5 then
    perform public.pelham_fail('400', 'Duration must be between 1 and 5 hours.');
  end if;
  span := p_duration_hours * 60;
  label := initcap(replace(coalesce(p_bay_type, ''), '_', ' '));

  base := jsonb_build_object(
    'date', to_char(p_date, 'YYYY-MM-DD'),
    'bay_type', p_bay_type,
    'duration_hours', p_duration_hours,
    'is_closed', false,
    'available_slots', '[]'::jsonb,
    'reason', null
  );

  if extract(isodow from p_date) in (1, 2) then
    return base || jsonb_build_object(
      'is_closed', true,
      'reason', 'The simulator is closed on Mondays and Tuesdays.'
    );
  end if;

  select count(*) into total
    from public.pelham_sim_bays b
   where b.is_active and b.status <> 'maintenance' and b.bay_type = p_bay_type;
  if total = 0 then
    if exists (select 1 from public.pelham_sim_bays b where b.is_active and b.bay_type = p_bay_type) then
      return base || jsonb_build_object('reason', format('%s bays are closed for maintenance.', label));
    end if;
    return base || jsonb_build_object('reason', format('No bays are configured for %s.', label));
  end if;

  start_min := open_min;
  while start_min + span <= close_min loop
    -- 오늘의 지난 시각은 팔지 않는다.
    if p_date > local_now::date
       or (p_date = local_now::date
           and start_min > extract(hour from local_now) * 60 + extract(minute from local_now)) then
      select count(*) into free_bays
        from public.pelham_sim_bays b
       where b.is_active and b.status <> 'maintenance' and b.bay_type = p_bay_type
         and not exists (
           select 1 from public.pelham_sim_reservations r
            where r.bay_id = b.id
              and r.booking_date = p_date
              and r.status not in ('cancelled', 'no_show')
              and r.start_minutes < start_min + span
              and r.start_minutes + r.duration_hours * 60 > start_min
         );
      if free_bays > 0 then
        slots := slots || jsonb_build_object(
          'time', lpad((start_min / 60)::text, 2, '0') || ':' || lpad((start_min % 60)::text, 2, '0'),
          'available_bays', free_bays,
          'total_bays', total
        );
      end if;
    end if;
    start_min := start_min + 15;
  end loop;

  if jsonb_array_length(slots) = 0 then
    return base || jsonb_build_object(
      'reason',
      case when p_date < local_now::date
           then 'That date has already passed.'
           else format('Every %s bay is booked for %s hour%s on this date.',
                       label, p_duration_hours, case when p_duration_hours > 1 then 's' else '' end)
      end
    );
  end if;
  return base || jsonb_build_object('available_slots', slots);
end;
$$;

create or replace function public.pelham_sim_reserve(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  open_min constant integer := 14 * 60;
  close_min constant integer := 22 * 60;
  local_now timestamp := public.pelham_local_now();
  v_date date;
  v_type text := p->>'bay_type';
  v_duration integer;
  v_players integer;
  v_name text := btrim(coalesce(p->>'customer_name', ''));
  v_email text := btrim(coalesce(p->>'customer_email', ''));
  v_phone text := btrim(coalesce(p->>'phone', ''));
  v_notes text := btrim(coalesce(p->>'notes', ''));
  v_start integer;
  v_bay public.pelham_sim_bays;
  v_code text;
  v_row public.pelham_sim_reservations;
  m text[];
begin
  begin
    v_date := (p->>'date')::date;
  exception when others then
    v_date := null;
  end;
  if v_date is null or coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    perform public.pelham_fail('400', 'Invalid date format. Use YYYY-MM-DD');
  end if;
  if extract(isodow from v_date) in (1, 2) then
    perform public.pelham_fail('400', 'The simulator is closed on Mondays and Tuesdays.');
  end if;
  if v_type is null or v_type not in ('right_handed', 'left_right', 'vip') then
    perform public.pelham_fail('400', format('Unknown bay type: %s', coalesce(v_type, '')));
  end if;
  if coalesce(p->>'duration_hours', '') !~ '^\d+$' or (p->>'duration_hours')::integer not between 1 and 5 then
    perform public.pelham_fail('400', 'Duration must be between 1 and 5 hours.');
  end if;
  v_duration := (p->>'duration_hours')::integer;
  v_players := coalesce(nullif(p->>'player_count', ''), '1')::integer;
  if v_players not between 1 and 4 then
    perform public.pelham_fail('400', 'Player count must be between 1 and 4.');
  end if;
  if v_name = '' then
    perform public.pelham_fail('400', 'Name is required');
  end if;
  if v_email = '' then
    perform public.pelham_fail('400', 'Email is required');
  end if;
  if length(v_name) > 120 or length(v_email) > 254 or length(v_phone) > 40 or length(v_notes) > 1000
     or position('@' in v_email) = 0 then
    perform public.pelham_fail('400', 'Please check your name, email, phone and notes.');
  end if;

  m := regexp_match(coalesce(p->>'start_time', ''), '^(\d{1,2}):(\d{2})$');
  if m is null or m[1]::integer > 23 or m[2]::integer > 59 then
    perform public.pelham_fail('400', 'Invalid time format. Use HH:MM');
  end if;
  v_start := m[1]::integer * 60 + m[2]::integer;
  if v_start < open_min or v_start + v_duration * 60 > close_min then
    perform public.pelham_fail('400', 'Requested time is outside operating hours (2:00 PM - 10:00 PM).');
  end if;
  if v_date < local_now::date
     or (v_date = local_now::date
         and v_start <= extract(hour from local_now) * 60 + extract(minute from local_now)) then
    perform public.pelham_fail('400', 'That time has already passed. Please pick a later time.');
  end if;

  -- 그날의 빈 베이 확인과 기록을 한 잠금 안에서.
  perform pg_advisory_xact_lock(hashtext('pelham_sim:' || v_date::text));

  select b.* into v_bay
    from public.pelham_sim_bays b
   where b.is_active and b.status <> 'maintenance' and b.bay_type = v_type
     and not exists (
       select 1 from public.pelham_sim_reservations r
        where r.bay_id = b.id
          and r.booking_date = v_date
          and r.status not in ('cancelled', 'no_show')
          and r.start_minutes < v_start + v_duration * 60
          and r.start_minutes + r.duration_hours * 60 > v_start
     )
   order by b.bay_number
   limit 1;

  if v_bay.id is null then
    if not exists (select 1 from public.pelham_sim_bays b where b.is_active and b.bay_type = v_type) then
      perform public.pelham_fail('404', format('No bays are configured for %s.', initcap(replace(v_type, '_', ' '))));
    end if;
    if not exists (select 1 from public.pelham_sim_bays b
                    where b.is_active and b.status <> 'maintenance' and b.bay_type = v_type) then
      perform public.pelham_fail('409', format('%s bays are closed for maintenance.', initcap(replace(v_type, '_', ' '))));
    end if;
    perform public.pelham_fail('409', 'Time slot already booked');
  end if;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.pelham_sim_reservations r where r.confirmation_code = v_code);
  end loop;

  insert into public.pelham_sim_reservations
    (bay_id, booking_date, start_minutes, duration_hours, player_count,
     customer_name, customer_email, phone, notes, confirmation_code, total_price)
  values
    (v_bay.id, v_date, v_start, v_duration, v_players,
     v_name, v_email, v_phone, v_notes, v_code, v_bay.hourly_rate * v_duration)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'confirmation_code', v_row.confirmation_code,
    'bay_type', initcap(replace(v_bay.bay_type, '_', ' ')),
    'bay_number', v_bay.bay_number,
    'date', to_char(v_row.booking_date, 'YYYY-MM-DD'),
    'start_time', lpad((v_start / 60)::text, 2, '0') || ':' || lpad((v_start % 60)::text, 2, '0'),
    'duration_hours', v_row.duration_hours,
    'player_count', v_row.player_count,
    'total_price', v_row.total_price
  );
end;
$$;

-- ===== 권한 ============================================================
-- 헬퍼는 막고, 직원 함수 다섯 개만 authenticated 에게 연다(직원 확인은 함수 안에서).
-- 손님 함수 두 개는 `create or replace` 라 0003 의 권한이 그대로 남는다.

revoke all on function public.pelham_sim_bay_busy(integer, date, integer, integer, bigint) from public, anon, authenticated;
revoke all on function public.pelham_sim_bay_json(public.pelham_sim_bays) from public, anon, authenticated;
revoke all on function public.pelham_staff_sim_bay_status(integer, text) from public, anon, authenticated;
grant execute on function public.pelham_staff_sim_bay_status(integer, text) to authenticated;
revoke all on function public.pelham_sim_reservation_json(public.pelham_sim_reservations) from public, anon, authenticated;
revoke all on function public.pelham_sim_check(jsonb) from public, anon, authenticated;
revoke all on function public.pelham_sim_require_slot(integer, date, integer, integer, bigint) from public, anon, authenticated;

revoke all on function public.pelham_staff_sim_bays() from public, anon, authenticated;
revoke all on function public.pelham_staff_sim_reservations(date) from public, anon, authenticated;
revoke all on function public.pelham_staff_sim_create(jsonb) from public, anon, authenticated;
revoke all on function public.pelham_staff_sim_update(bigint, jsonb) from public, anon, authenticated;

grant execute on function public.pelham_staff_sim_bays() to authenticated;
grant execute on function public.pelham_staff_sim_reservations(date) to authenticated;
grant execute on function public.pelham_staff_sim_create(jsonb) to authenticated;
grant execute on function public.pelham_staff_sim_update(bigint, jsonb) to authenticated;
