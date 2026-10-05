-- 손님이 **고객 사이트(`/book/lookup`)에서 직접** 예약을 고치고 취소한다. 실내 골프와 티타임 둘 다.
--
-- 왜: 지금까지 손님은 확인 코드로 실내 골프 예약을 **보기만** 했고, 바꾸거나 취소하려면 프로 샵에
-- 전화해야 했다. 티타임은 확인 코드 자체가 없어서 조회도 못 했다(2026-10-03 사용자 결정).
--
-- 규칙 (사용자 결정)
-- - 본인 확인: **확인 코드 + 예약할 때 쓴 이메일**. 코드만 아는 사람은 남의 예약을 못 바꾼다.
--   코드가 틀렸는지 이메일이 틀렸는지는 알려 주지 않는다(같은 "찾을 수 없음").
--   티타임의 이메일은 플레이어 배열에서 **이메일이 있는 첫 사람**의 것이다(온라인 예약은 첫 사람).
-- - 바꿀 수 있는 것: 날짜·시각·이용 시간(실내 골프는 시간, 티타임은 9/18홀), 인원, 이름, 전화.
--   그리고 취소. 이메일은 바꾸지 않는다(본인 확인 수단이다).
-- - 마감: **원래 시작 시각 24시간 전까지**. 새로 고르는 시각은 지금 이후이기만 하면 된다.
-- - 온라인으로 못 바꾸는 예약(→ 전화 안내):
--   실내 골프는 status 가 confirmed 가 아닌 것, 티타임은 reserved 가 아니거나 음성 홀드인 것,
--   그리고 **계산서에 담긴 적이 있는(살아 있는 줄) 예약**과 결제된 플레이어가 있는 티타임.
--   계산서는 날짜·시각을 줄에 베껴 두므로, 손님이 옮기면 계산서와 시트가 갈라진다.
-- - 바꾼 기록은 직원이 볼 수 있게 남긴다: 티타임은 audit 한 줄, 실내 골프는 notes 끝에 한 줄.
--
-- 티타임 확인 코드
-- - `pelham_tee_bookings.confirmation_code`: `T` + 16진수 9자(예: T4F09A1C2B). 실내 골프 코드(16진수
--   10자)와 첫 글자로 구분된다. 트리거가 새 예약마다 매기고 `doc.confirmationCode` 에도 적는다.
--   기존 예약도 전부 채운다. 예전 손님이 받은 UUID 예약 번호로도 계속 찾을 수 있다.
-- - `pelham_tee_book`(0003)을 다시 정의한다: 바뀐 곳은 끝의 insert 가 트리거가 채운 doc 을
--   돌려받는 것 하나뿐이다(확인 화면이 코드를 보여 준다).
--
-- 잠금: 0003·0004·0007 과 같은 advisory 키를 **먼저**, 정렬된 순서로 잡고 그다음 행을 잠근다
-- (직원 함수도 advisory 먼저다). 잠그기 전에 읽은 날짜·시각이 그사이 바뀌었으면 409.
--
-- 규칙은 0003~0011 과 같다: `pelham_` 접두사, 오류는 PTxxx. 손님 함수는 anon 에게 연다.
-- 전제: 0004, 0005, 0007, 0008. 실행: SQL editor 에 이 파일 전체를 붙여 한 번. 다시 실행해도 안전하다.

do $$
begin
  if to_regprocedure('public.pelham_tee_save(jsonb)') is null then
    raise exception '0012 needs 0004 first (pelham_tee_save is missing).';
  end if;
  if to_regprocedure('public.pelham_sim_bay_busy(integer, date, integer, integer, bigint)') is null then
    raise exception '0012 needs 0007 first (pelham_sim_bay_busy is missing).';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pelham_bill_lines'
                    and column_name = 'sim_reservation_id') then
    raise exception '0012 needs 0008 first (pelham_bill_lines.sim_reservation_id is missing).';
  end if;
end;
$$;

-- ===== 티타임 확인 코드 ================================================

alter table public.pelham_tee_bookings
  add column if not exists confirmation_code text;

create or replace function public.pelham_tee_new_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v text;
begin
  loop
    v := 'T' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 9));
    exit when not exists (select 1 from public.pelham_tee_bookings t where t.confirmation_code = v);
  end loop;
  return v;
end;
$$;

-- 코드가 없으면 매기고, doc 에도 같은 값을 적는다. 직원 함수(`pelham_tee_save`)는 doc 을 통째로
-- 갈아 끼우므로 doc 쪽 값이 빠져도 여기서 다시 채운다. 원본은 칸이다.
create or replace function public.pelham_tee_code_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.confirmation_code is null then
    new.confirmation_code := public.pelham_tee_new_code();
  end if;
  if new.doc->>'confirmationCode' is distinct from new.confirmation_code then
    new.doc := new.doc || jsonb_build_object('confirmationCode', new.confirmation_code);
  end if;
  return new;
end;
$$;

-- 기존 예약 채우기. 이 update 는 계산서·레인체크 보호 트리거도 깨우는데, 이미 어긋난 행이 하나라도
-- 있으면 파일 전체가 멈춘다. 코드만 쓰는 update 라 그 둘을 잠시 끄고, 한 블록(한 트랜잭션) 안에서
-- 다시 켠다.
do $$
begin
  if exists (select 1 from public.pelham_tee_bookings where confirmation_code is null) then
    alter table public.pelham_tee_bookings disable trigger pelham_pos_guard_tee;
    if exists (select 1 from pg_trigger where tgname = 'pelham_rc_guard_tee') then
      alter table public.pelham_tee_bookings disable trigger pelham_rc_guard_tee;
    end if;

    update public.pelham_tee_bookings t
       set confirmation_code = c.code,
           doc = t.doc || jsonb_build_object('confirmationCode', c.code)
      from (select id, 'T' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 9)) as code
              from public.pelham_tee_bookings
             where confirmation_code is null) c
     where t.id = c.id;

    alter table public.pelham_tee_bookings enable trigger pelham_pos_guard_tee;
    if exists (select 1 from pg_trigger where tgname = 'pelham_rc_guard_tee') then
      alter table public.pelham_tee_bookings enable trigger pelham_rc_guard_tee;
    end if;
  end if;
end;
$$;

create unique index if not exists pelham_tee_bookings_code_idx
  on public.pelham_tee_bookings (confirmation_code);

drop trigger if exists pelham_tee_code_sync on public.pelham_tee_bookings;
create trigger pelham_tee_code_sync
  before insert or update on public.pelham_tee_bookings
  for each row execute function public.pelham_tee_code_sync();

-- 0003 그대로. 끝의 insert 만 `returning doc` 으로 트리거가 채운 코드를 돌려받는다.
create or replace function public.pelham_tee_book(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  local_now timestamp := public.pelham_local_now();
  v_date date;
  v_time text := btrim(coalesce(p->>'time', ''));
  v_minutes integer;
  v_holes integer;
  v_carts integer;
  v_first text := btrim(coalesce(p->>'firstName', ''));
  v_last text := btrim(coalesce(p->>'lastName', ''));
  v_email text := btrim(coalesce(p->>'email', ''));
  v_phone text := btrim(coalesce(p->>'phone', ''));
  v_notes text := btrim(coalesce(p->>'notes', ''));
  v_party integer;
  v_taken integer;
  v_now text := public.pelham_iso(now());
  v_id text := gen_random_uuid()::text;
  v_players jsonb := '[]'::jsonb;
  v_doc jsonb;
  i integer;
begin
  if coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    perform public.pelham_fail('422', '''date'' must be an ISO date (YYYY-MM-DD)');
  end if;
  begin
    v_date := (p->>'date')::date;
  exception when others then
    perform public.pelham_fail('422', format('''date'' is not a real calendar date: %s', p->>'date'));
  end;

  select g.m into v_minutes
    from generate_series(6 * 60 + 40, 18 * 60 + 58, 9) as g(m)
   where public.pelham_tee_label(g.m) = v_time;
  if v_minutes is null then
    perform public.pelham_fail('422', format('%s is not a bookable tee time on %s', v_time, p->>'date'));
  end if;
  if v_date < local_now::date
     or (v_date = local_now::date and v_minutes <= extract(hour from local_now) * 60 + extract(minute from local_now)) then
    perform public.pelham_fail('422', 'That tee time has already passed. Please pick a later time.');
  end if;
  if v_date > local_now::date + 365 then
    perform public.pelham_fail('422', 'Online booking opens up to one year ahead.');
  end if;

  v_holes := coalesce(nullif(p->>'holes', ''), '18')::integer;
  if v_holes not in (9, 18) then
    perform public.pelham_fail('422', 'Holes must be 9 or 18.');
  end if;
  v_party := coalesce(nullif(p->>'players', ''), '0')::integer;
  if v_party not between 1 and 4 then
    perform public.pelham_fail('422', 'A tee time holds 1 to 4 players.');
  end if;
  v_carts := coalesce(nullif(p->>'cartCount', ''), '0')::integer;
  if v_carts not between 0 and 4 then
    perform public.pelham_fail('422', 'Carts must be between 0 and 4.');
  end if;
  if v_first = '' and v_last = '' then
    perform public.pelham_fail('422', 'Name is required.');
  end if;
  if v_email = '' or position('@' in v_email) = 0 then
    perform public.pelham_fail('422', 'A valid email is required.');
  end if;
  if length(v_first) + length(v_last) > 120 or length(v_email) > 254
     or length(v_phone) > 40 or length(v_notes) > 1000 then
    perform public.pelham_fail('422', 'Please shorten your name, phone or notes.');
  end if;

  -- 이 티타임의 정원 확인과 기록을 한 잠금 안에서.
  perform pg_advisory_xact_lock(hashtext('pelham_tee:' || v_date::text || ' ' || v_time));

  if exists (
    select 1 from public.pelham_tee_bookings t
     where t.booking_date = v_date and t.tee_time = v_time and t.status = 'blocked'
  ) then
    perform public.pelham_fail('409', format('%s on %s is not available', v_time, p->>'date'));
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(t.doc->'players', '[]'::jsonb))), 0) into v_taken
    from public.pelham_tee_bookings t
   where t.booking_date = v_date
     and t.tee_time = v_time
     and coalesce(t.status, '') <> 'cancelled'
     and (t.hold_expires_at is null or t.hold_expires_at > now());
  if v_taken + v_party > 4 then
    perform public.pelham_fail('409', format(
      '%s on %s only holds 4 players; %s are already taken and %s more were requested',
      v_time, p->>'date', v_taken, v_party));
  end if;

  for i in 1..v_party loop
    v_players := v_players || jsonb_build_object(
      'id', gen_random_uuid()::text,
      'name', case when i = 1 then btrim(v_first || ' ' || v_last) else 'Guest' end,
      'firstName', case when i = 1 then v_first else 'Guest' end,
      'lastName', case when i = 1 then v_last else '' end,
      'email', case when i = 1 then v_email else '' end,
      'phone', case when i = 1 then v_phone else '' end,
      'type', 'Guest',
      'ratePlan', 'Public',
      'arrived', false,
      'paid', false,
      'cancelled', false,
      'no_show', false,
      'cart', false,
      'cartFee', 0.0,
      'paidAt', null
    );
  end loop;

  v_doc := jsonb_build_object(
    'id', v_id,
    'date', to_char(v_date, 'YYYY-MM-DD'),
    'time', v_time,
    'holes', v_holes,
    'rate', public.pelham_tee_rate(v_date),
    'span', 1,
    'color', 'gold',
    'title', btrim(v_first || ' ' || v_last),
    'status', 'reserved',
    'cartCount', v_carts,
    'notes', case when v_notes = '' then 'Booked online at pelhamhills.com.'
                  else v_notes || E'\n\nBooked online at pelhamhills.com.' end,
    'players', v_players,
    'audit', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'ts', v_now,
      'message', format('Reservation created for %s %s.', to_char(v_date, 'YYYY-MM-DD'), v_time)
    )),
    'cancelReason', null,
    'source', 'web',
    'holdExpiresAt', null,
    'createdAt', v_now,
    'updatedAt', v_now
  );

  insert into public.pelham_tee_bookings
    (id, booking_date, tee_time, status, source, title, hold_expires_at, created_at, updated_at, doc, synced_at)
  values
    (v_id, v_date, v_time, 'reserved', 'web', v_doc->>'title', null, now(), now(), v_doc, now())
  returning doc into v_doc;

  return v_doc;
end;
$$;

-- ===== 공용 헬퍼 =======================================================

create or replace function public.pelham_guest_email_match(a text, b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select btrim(coalesce(b, '')) <> '' and lower(btrim(coalesce(a, ''))) = lower(btrim(b))
$$;

create or replace function public.pelham_guest_not_found()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.pelham_fail('404', 'We could not find a booking with that confirmation code and email.');
end;
$$;

-- 원래 시작 시각에서 24시간을 뺀 시각(현지). 이 시각이 지나면 온라인 변경이 닫힌다.
create or replace function public.pelham_guest_deadline(p_date date, p_minutes integer)
returns timestamp
language sql
immutable
set search_path = ''
as $$
  select p_date + make_interval(mins => p_minutes) - interval '24 hours'
$$;

-- ===== 실내 골프 ======================================================

-- 코드 + 이메일로 한 건(잠그지 않음). 없으면 null.
create or replace function public.pelham_sim_guest_row(p_code text, p_email text)
returns public.pelham_sim_reservations
language sql
stable
set search_path = ''
as $$
  select r.*
    from public.pelham_sim_reservations r
   where btrim(coalesce(p_code, '')) ~* '^[0-9a-f]{10}$'
     and r.confirmation_code = upper(btrim(p_code))
     and public.pelham_guest_email_match(r.customer_email, p_email)
$$;

-- 온라인으로 바꿀 수 없는 이유. 바꿀 수 있으면 null.
create or replace function public.pelham_sim_guest_block(r public.pelham_sim_reservations)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when r.status <> 'confirmed' then
      format('This booking is %s, so it can no longer be changed online.', replace(r.status, '_', ' '))
    when public.pelham_local_now() > public.pelham_guest_deadline(r.booking_date, r.start_minutes) then
      'Online changes close 24 hours before your start time.'
    when exists (select 1 from public.pelham_bill_lines li
                  where li.sim_reservation_id = r.id and li.kind = 'sim_booking' and li.active) then
      'The pro shop has already started a bill for this booking.'
  end
$$;

create or replace function public.pelham_sim_guest_json(r public.pelham_sim_reservations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'sim',
    'editable', public.pelham_sim_guest_block(r) is null,
    'reason', public.pelham_sim_guest_block(r),
    'change_deadline', to_char(public.pelham_guest_deadline(r.booking_date, r.start_minutes), 'YYYY-MM-DD"T"HH24:MI'),
    'booking', jsonb_build_object(
      'confirmation_code', r.confirmation_code,
      'bay_number', b.bay_number,
      'bay_type', initcap(replace(b.bay_type, '_', ' ')),
      'hourly_rate', b.hourly_rate,
      'date', to_char(r.booking_date, 'YYYY-MM-DD'),
      'start_time', lpad((r.start_minutes / 60)::text, 2, '0') || ':' || lpad((r.start_minutes % 60)::text, 2, '0'),
      'duration_hours', r.duration_hours,
      'player_count', r.player_count,
      'customer_name', r.customer_name,
      'customer_email', r.customer_email,
      'phone', r.phone,
      'total_price', r.total_price,
      'status', r.status
    )
  )
  from public.pelham_sim_bays b
  where b.id = r.bay_id
$$;

-- 날짜 두 개(옛·새)의 베이 잠금을 정렬된 순서로. 키는 0003·0007 과 글자 그대로 같다.
create or replace function public.pelham_sim_lock_days(a date, b date)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('pelham_sim:' || least(a, b)::text));
  if a <> b then
    perform pg_advisory_xact_lock(hashtext('pelham_sim:' || greatest(a, b)::text));
  end if;
end;
$$;

-- 잠금을 잡은 뒤 다시 읽는다. 그사이 직원이 옮겼으면 409.
create or replace function public.pelham_sim_guest_relock(seen public.pelham_sim_reservations)
returns public.pelham_sim_reservations
language plpgsql
volatile
set search_path = ''
as $$
declare
  v public.pelham_sim_reservations;
  v_block text;
begin
  select * into v from public.pelham_sim_reservations where id = seen.id for update;
  if v.id is null then
    perform public.pelham_guest_not_found();
  end if;
  if v.booking_date <> seen.booking_date or v.start_minutes <> seen.start_minutes or v.status <> seen.status then
    perform public.pelham_fail('409', 'This booking just changed. Please reload it and try again.');
  end if;
  v_block := public.pelham_sim_guest_block(v);
  if v_block is not null then
    perform public.pelham_fail('409', v_block || ' Please call the pro shop.');
  end if;
  return v;
end;
$$;

-- p: 바꿀 칸만. date, start_time(HH:MM), duration_hours, player_count, customer_name, phone.
create or replace function public.pelham_sim_guest_update(p_code text, p_email text, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  local_now timestamp := public.pelham_local_now();
  seen public.pelham_sim_reservations := public.pelham_sim_guest_row(p_code, p_email);
  v public.pelham_sim_reservations;
  v_bay public.pelham_sim_bays;
  v_date date;
  v_start integer;
  v_duration integer;
  v_players integer;
  v_name text;
  v_phone text;
  v_changes text[] := '{}';
  m text[];
begin
  if seen.id is null then
    perform public.pelham_guest_not_found();
  end if;
  p := coalesce(p, '{}'::jsonb) - 'bay_id' - 'status' - 'source' - 'customer_email' - 'notes';
  perform public.pelham_sim_check(p);

  begin
    v_date := coalesce((p->>'date')::date, seen.booking_date);
  exception when others then
    perform public.pelham_fail('422', 'Invalid date format. Use YYYY-MM-DD');
  end;
  if p ? 'start_time' then
    m := regexp_match(p->>'start_time', '^(\d{1,2}):(\d{2})$');
    if m[1]::integer > 23 or m[2]::integer > 59 then
      perform public.pelham_fail('422', 'Invalid time format. Use HH:MM');
    end if;
    v_start := m[1]::integer * 60 + m[2]::integer;
  else
    v_start := seen.start_minutes;
  end if;
  v_duration := coalesce((p->>'duration_hours')::integer, seen.duration_hours);
  v_players := coalesce((p->>'player_count')::integer, seen.player_count);
  v_name := coalesce(btrim(p->>'customer_name'), seen.customer_name);
  v_phone := coalesce(btrim(p->>'phone'), seen.phone);

  perform public.pelham_sim_lock_days(seen.booking_date, v_date);
  v := public.pelham_sim_guest_relock(seen);

  if v_date <> v.booking_date or v_start <> v.start_minutes or v_duration <> v.duration_hours then
    if extract(isodow from v_date) in (1, 2) then
      perform public.pelham_fail('422', 'The simulator is closed on Mondays and Tuesdays.');
    end if;
    if v_start % 15 <> 0 or v_start < 14 * 60 or v_start + v_duration * 60 > 22 * 60 then
      perform public.pelham_fail('422', 'Bookings run 2:00 PM – 10:00 PM on the 15-minute grid.');
    end if;
    if v_date < local_now::date
       or (v_date = local_now::date
           and v_start <= extract(hour from local_now) * 60 + extract(minute from local_now)) then
      perform public.pelham_fail('422', 'That time has already passed. Please pick a later time.');
    end if;
    if v_date > local_now::date + 365 then
      perform public.pelham_fail('422', 'Online booking opens up to one year ahead.');
    end if;

    -- 지금 베이가 비어 있으면 그대로, 아니면 번호 순으로 빈 베이.
    select b.* into v_bay
      from public.pelham_sim_bays b
     where b.is_active and b.status <> 'maintenance'
       and not public.pelham_sim_bay_busy(b.id, v_date, v_start, v_duration, v.id)
     order by (b.id = v.bay_id) desc, b.bay_number
     limit 1;
    if v_bay.id is null then
      perform public.pelham_fail('409', 'That time is fully booked. Please pick another time.');
    end if;
    v_bay := public.pelham_sim_require_slot(v_bay.id, v_date, v_start, v_duration, v.id);

    if v_date <> v.booking_date or v_start <> v.start_minutes then
      v_changes := v_changes || format('%s %s:%s → %s %s:%s',
        to_char(v.booking_date, 'MM-DD'), v.start_minutes / 60, lpad((v.start_minutes % 60)::text, 2, '0'),
        to_char(v_date, 'MM-DD'), v_start / 60, lpad((v_start % 60)::text, 2, '0'));
    end if;
    if v_duration <> v.duration_hours then
      v_changes := v_changes || format('%sh → %sh', v.duration_hours, v_duration);
    end if;
    if v_bay.id <> v.bay_id then
      v_changes := v_changes || format('bay %s', v_bay.bay_number);
    end if;
  else
    select * into v_bay from public.pelham_sim_bays where id = v.bay_id;
  end if;

  if v_players <> v.player_count then
    v_changes := v_changes || format('%s → %s players', v.player_count, v_players);
  end if;
  if v_name <> v.customer_name or v_phone <> v.phone then
    v_changes := v_changes || 'contact details'::text;
  end if;

  if cardinality(v_changes) = 0 then
    return public.pelham_sim_guest_json(v);
  end if;

  update public.pelham_sim_reservations
     set bay_id = v_bay.id,
         booking_date = v_date,
         start_minutes = v_start,
         duration_hours = v_duration,
         player_count = v_players,
         customer_name = v_name,
         phone = v_phone,
         total_price = v_bay.hourly_rate * v_duration,
         notes = btrim(notes || E'\n' || format('[%s] Changed online by guest: %s.',
                       to_char(local_now, 'YYYY-MM-DD HH24:MI'), array_to_string(v_changes, ', ')), E' 
'),
         updated_at = now()
   where id = v.id
   returning * into v;

  return public.pelham_sim_guest_json(v);
end;
$$;

create or replace function public.pelham_sim_guest_cancel(p_code text, p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  seen public.pelham_sim_reservations := public.pelham_sim_guest_row(p_code, p_email);
  v public.pelham_sim_reservations;
begin
  if seen.id is null then
    perform public.pelham_guest_not_found();
  end if;
  perform public.pelham_sim_lock_days(seen.booking_date, seen.booking_date);
  v := public.pelham_sim_guest_relock(seen);

  update public.pelham_sim_reservations
     set status = 'cancelled',
         notes = btrim(notes || E'\n' || format('[%s] Cancelled online by guest.',
                       to_char(public.pelham_local_now(), 'YYYY-MM-DD HH24:MI')), E' 
'),
         updated_at = now()
   where id = v.id
   returning * into v;

  return public.pelham_sim_guest_json(v);
end;
$$;

-- ===== 티타임 =========================================================

-- 연락 담당: 이메일이 있는 첫 플레이어. 그 사람의 배열 위치(0부터)도 함께.
create or replace function public.pelham_tee_contact_index(p_doc jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (i - 1)::integer
    from jsonb_array_elements(coalesce(p_doc->'players', '[]'::jsonb)) with ordinality t(e, i)
   where btrim(coalesce(e->>'email', '')) <> ''
   order by i
   limit 1
$$;

-- 코드(T + 9자) 또는 예전 UUID 예약 번호 + 이메일로 한 건(잠그지 않음).
create or replace function public.pelham_tee_guest_row(p_code text, p_email text)
returns public.pelham_tee_bookings
language sql
stable
set search_path = ''
as $$
  select t.*
    from public.pelham_tee_bookings t
   where (
           (btrim(coalesce(p_code, '')) ~* '^T[0-9a-f]{9}$' and t.confirmation_code = upper(btrim(p_code)))
        or (btrim(coalesce(p_code, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and t.id = lower(btrim(p_code)))
         )
     and coalesce(t.status, '') <> 'blocked'
     and public.pelham_guest_email_match(
           t.doc->'players'->public.pelham_tee_contact_index(t.doc)->>'email', p_email)
$$;

create or replace function public.pelham_tee_guest_block(t public.pelham_tee_bookings)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(t.status, '') <> 'reserved' then
      format('This booking is %s, so it can no longer be changed online.', replace(coalesce(t.status, ''), '_', ' '))
    when t.tee_time is null or public.pelham_tee_minutes(t.tee_time) is null then
      'This booking has no tee time on the sheet.'
    when coalesce(t.source, '') = 'voice_hold' then
      'This booking is still being confirmed by the pro shop.'
    when public.pelham_local_now()
         > public.pelham_guest_deadline(t.booking_date, public.pelham_tee_minutes(t.tee_time)) then
      'Online changes close 24 hours before your tee time.'
    when exists (select 1 from jsonb_array_elements(coalesce(t.doc->'players', '[]'::jsonb)) e
                  where coalesce((e->>'paid')::boolean, false)) then
      'Part of this booking has already been paid.'
    when exists (select 1 from public.pelham_bill_lines li
                  where li.booking_id = t.id and li.kind = 'tee_player' and li.active) then
      'The pro shop has already started a bill for this booking.'
  end
$$;

create or replace function public.pelham_tee_guest_json(t public.pelham_tee_bookings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'tee',
    'editable', public.pelham_tee_guest_block(t) is null,
    'reason', public.pelham_tee_guest_block(t),
    'change_deadline', to_char(public.pelham_guest_deadline(
                          t.booking_date, public.pelham_tee_minutes(t.tee_time)), 'YYYY-MM-DD"T"HH24:MI'),
    'booking', jsonb_build_object(
      'confirmation_code', t.confirmation_code,
      'date', to_char(t.booking_date, 'YYYY-MM-DD'),
      'time', t.tee_time,
      'holes', coalesce((t.doc->>'holes')::integer, 18),
      'players', jsonb_array_length(coalesce(t.doc->'players', '[]'::jsonb)),
      'rate', (t.doc->>'rate')::numeric,
      'cart_count', coalesce((t.doc->>'cartCount')::integer, 0),
      'first_name', c->>'firstName',
      'last_name', c->>'lastName',
      'email', c->>'email',
      'phone', c->>'phone',
      'status', t.status
    )
  )
  from (select t.doc->'players'->public.pelham_tee_contact_index(t.doc) as c) s
$$;

-- 옛·새 티타임 잠금을 키 순서대로. 키는 `pelham_tee_lock`(0004)·`pelham_tee_book` 과 같다.
create or replace function public.pelham_tee_lock_slots(d1 date, t1 text, d2 date, t2 text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  k1 text := d1::text || ' ' || coalesce(t1, '');
  k2 text := d2::text || ' ' || coalesce(t2, '');
begin
  if k1 <= k2 then
    perform public.pelham_tee_lock(d1, t1);
    if k1 <> k2 then perform public.pelham_tee_lock(d2, t2); end if;
  else
    perform public.pelham_tee_lock(d2, t2);
    perform public.pelham_tee_lock(d1, t1);
  end if;
end;
$$;

create or replace function public.pelham_tee_guest_relock(seen public.pelham_tee_bookings)
returns public.pelham_tee_bookings
language plpgsql
volatile
set search_path = ''
as $$
declare
  v public.pelham_tee_bookings;
  v_block text;
begin
  select * into v from public.pelham_tee_bookings where id = seen.id for update;
  if v.id is null then
    perform public.pelham_guest_not_found();
  end if;
  if v.booking_date <> seen.booking_date or v.tee_time is distinct from seen.tee_time
     or v.status is distinct from seen.status then
    perform public.pelham_fail('409', 'This booking just changed. Please reload it and try again.');
  end if;
  v_block := public.pelham_tee_guest_block(v);
  if v_block is not null then
    perform public.pelham_fail('409', v_block || ' Please call the pro shop.');
  end if;
  return v;
end;
$$;

-- p: 바꿀 칸만. date, time('7:16 AM'), holes(9/18), players(1~4), firstName, lastName, phone.
create or replace function public.pelham_tee_guest_update(p_code text, p_email text, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  local_now timestamp := public.pelham_local_now();
  v_now text := public.pelham_iso(now());
  seen public.pelham_tee_bookings := public.pelham_tee_guest_row(p_code, p_email);
  v public.pelham_tee_bookings;
  v_doc jsonb;
  v_date date;
  v_time text;
  v_minutes integer;
  v_holes integer;
  v_party integer;
  v_first text;
  v_last text;
  v_phone text;
  v_contact integer;
  v_players jsonb;
  v_keep jsonb := '[]'::jsonb;
  v_drop integer;
  v_changes text[] := '{}';
  c jsonb;
  e jsonb;
  i integer;
begin
  if seen.id is null then
    perform public.pelham_guest_not_found();
  end if;
  p := coalesce(p, '{}'::jsonb);

  if p ? 'date' then
    if coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      perform public.pelham_fail('422', '''date'' must be an ISO date (YYYY-MM-DD)');
    end if;
    begin
      v_date := (p->>'date')::date;
    exception when others then
      perform public.pelham_fail('422', format('''date'' is not a real calendar date: %s', p->>'date'));
    end;
  else
    v_date := seen.booking_date;
  end if;
  v_time := coalesce(btrim(p->>'time'), seen.tee_time);
  v_minutes := public.pelham_tee_require_slot(v_date, v_time);

  if p ? 'holes' and coalesce(p->>'holes', '') !~ '^(9|18)$' then
    perform public.pelham_fail('422', 'Holes must be 9 or 18.');
  end if;
  if p ? 'players' and coalesce(p->>'players', '') !~ '^[1-4]$' then
    perform public.pelham_fail('422', 'A tee time holds 1 to 4 players.');
  end if;

  perform public.pelham_tee_lock_slots(seen.booking_date, seen.tee_time, v_date, v_time);
  v := public.pelham_tee_guest_relock(seen);
  v_doc := v.doc;
  v_players := coalesce(v_doc->'players', '[]'::jsonb);
  v_contact := public.pelham_tee_contact_index(v_doc);
  c := v_players->v_contact;

  v_holes := coalesce((p->>'holes')::integer, (v_doc->>'holes')::integer, 18);
  v_party := coalesce((p->>'players')::integer, jsonb_array_length(v_players));
  v_first := coalesce(btrim(p->>'firstName'), c->>'firstName', '');
  v_last := coalesce(btrim(p->>'lastName'), c->>'lastName', '');
  v_phone := coalesce(btrim(p->>'phone'), c->>'phone', '');
  if v_first = '' and v_last = '' then
    perform public.pelham_fail('422', 'Name is required.');
  end if;
  if length(v_first) + length(v_last) > 120 or length(v_phone) > 40 then
    perform public.pelham_fail('422', 'Please shorten your name or phone.');
  end if;

  -- 시각·날짜
  if v_date <> v.booking_date or v_time <> v.tee_time then
    if v_date < local_now::date
       or (v_date = local_now::date and v_minutes <= extract(hour from local_now) * 60 + extract(minute from local_now)) then
      perform public.pelham_fail('422', 'That tee time has already passed. Please pick a later time.');
    end if;
    if v_date > local_now::date + 365 then
      perform public.pelham_fail('422', 'Online booking opens up to one year ahead.');
    end if;
    if exists (select 1 from public.pelham_tee_bookings t
                where t.booking_date = v_date and t.tee_time = v_time and t.status = 'blocked') then
      perform public.pelham_fail('409', format('%s on %s is not available.', v_time, to_char(v_date, 'YYYY-MM-DD')));
    end if;
    v_changes := v_changes || format('moved from %s %s', to_char(v.booking_date, 'YYYY-MM-DD'), v.tee_time);
    v_doc := v_doc || jsonb_build_object('date', to_char(v_date, 'YYYY-MM-DD'), 'time', v_time,
                                         'rate', public.pelham_tee_rate(v_date));
  end if;

  if v_holes <> coalesce((v.doc->>'holes')::integer, 18) then
    v_changes := v_changes || format('%s → %s holes', coalesce((v.doc->>'holes')::integer, 18), v_holes);
    v_doc := v_doc || jsonb_build_object('holes', v_holes);
  end if;

  -- 인원: 늘리면 Guest 를 뒤에 붙이고, 줄이면 연락 담당이 아닌 사람을 뒤에서부터 뺀다.
  if v_party <> jsonb_array_length(v_players) then
    v_changes := v_changes || format('%s → %s players', jsonb_array_length(v_players), v_party);
    if v_party > jsonb_array_length(v_players) then
      for i in 1..(v_party - jsonb_array_length(v_players)) loop
        v_players := v_players || public.pelham_tee_player(
          jsonb_build_object('firstName', 'Guest', 'type', 'Guest', 'ratePlan', 'Public'),
          v_holes, gen_random_uuid()::text, v_now);
      end loop;
    else
      v_drop := jsonb_array_length(v_players) - v_party;
      for e, i in
        select x.e, (x.i - 1)::integer
          from jsonb_array_elements(v_players) with ordinality x(e, i)
         order by x.i desc
      loop
        if v_drop > 0 and i <> v_contact then
          v_drop := v_drop - 1;
        else
          v_keep := e || v_keep;
        end if;
      end loop;
      v_players := v_keep;
    end if;
  end if;
  -- 연락 담당 앞의 사람이 빠졌으면 위치가 바뀐다.
  v_contact := public.pelham_tee_contact_index(jsonb_build_object('players', v_players));

  perform public.pelham_tee_require_capacity(v_date, v_time, v_party, v.id);

  -- 연락 담당 이름·전화
  c := v_players->v_contact;
  if v_first <> coalesce(c->>'firstName', '') or v_last <> coalesce(c->>'lastName', '')
     or v_phone <> coalesce(c->>'phone', '') then
    v_changes := v_changes || 'contact details'::text;
    c := c || jsonb_build_object('firstName', v_first, 'lastName', v_last,
                                 'name', btrim(v_first || ' ' || v_last), 'phone', v_phone);
    v_players := jsonb_set(v_players, array[v_contact::text], c);
    v_doc := v_doc || jsonb_build_object('title', btrim(v_first || ' ' || v_last));
  end if;

  if cardinality(v_changes) = 0 then
    return public.pelham_tee_guest_json(v);
  end if;

  v_doc := jsonb_set(v_doc, '{players}', v_players);
  v_doc := public.pelham_tee_audit(v_doc,
             format('Changed online by guest: %s.', array_to_string(v_changes, ', ')), v_now);
  perform public.pelham_tee_save(v_doc);

  select * into v from public.pelham_tee_bookings where id = v.id;
  return public.pelham_tee_guest_json(v);
end;
$$;

create or replace function public.pelham_tee_guest_cancel(p_code text, p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now text := public.pelham_iso(now());
  seen public.pelham_tee_bookings := public.pelham_tee_guest_row(p_code, p_email);
  v public.pelham_tee_bookings;
  v_res jsonb;
  v_doc jsonb;
begin
  if seen.id is null then
    perform public.pelham_guest_not_found();
  end if;
  perform public.pelham_tee_lock_slots(seen.booking_date, seen.tee_time, seen.booking_date, seen.tee_time);
  v := public.pelham_tee_guest_relock(seen);

  v_res := public.pelham_tee_apply_status(v.doc, 'cancelled', 'Cancelled online by the guest.', v_now);
  v_doc := public.pelham_tee_audit(v_res->'doc', v_res->>'message', v_now);
  perform public.pelham_tee_save(v_doc);

  select * into v from public.pelham_tee_bookings where id = v.id;
  return public.pelham_tee_guest_json(v);
end;
$$;

-- ===== 찾기 ============================================================

-- 코드 모양으로 실내 골프/티타임을 가른다. 없으면 null(화면이 "찾을 수 없음").
create or replace function public.pelham_booking_find(p_code text, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.pelham_sim_reservations;
  t public.pelham_tee_bookings;
begin
  s := public.pelham_sim_guest_row(p_code, p_email);
  if s.id is not null then
    return public.pelham_sim_guest_json(s);
  end if;
  t := public.pelham_tee_guest_row(p_code, p_email);
  if t.id is not null then
    return public.pelham_tee_guest_json(t);
  end if;
  return null;
end;
$$;

-- ===== 권한 ============================================================
-- 헬퍼는 막고, 손님 함수 다섯 개만 anon 에게 연다. `pelham_tee_book` 은 `create or replace`
-- 라 0003 의 권한이 그대로다.

revoke all on function public.pelham_tee_new_code() from public, anon, authenticated;
revoke all on function public.pelham_tee_code_sync() from public, anon, authenticated;
revoke all on function public.pelham_guest_email_match(text, text) from public, anon, authenticated;
revoke all on function public.pelham_guest_not_found() from public, anon, authenticated;
revoke all on function public.pelham_guest_deadline(date, integer) from public, anon, authenticated;
revoke all on function public.pelham_sim_guest_row(text, text) from public, anon, authenticated;
revoke all on function public.pelham_sim_guest_block(public.pelham_sim_reservations) from public, anon, authenticated;
revoke all on function public.pelham_sim_guest_json(public.pelham_sim_reservations) from public, anon, authenticated;
revoke all on function public.pelham_sim_lock_days(date, date) from public, anon, authenticated;
revoke all on function public.pelham_sim_guest_relock(public.pelham_sim_reservations) from public, anon, authenticated;
revoke all on function public.pelham_tee_contact_index(jsonb) from public, anon, authenticated;
revoke all on function public.pelham_tee_guest_row(text, text) from public, anon, authenticated;
revoke all on function public.pelham_tee_guest_block(public.pelham_tee_bookings) from public, anon, authenticated;
revoke all on function public.pelham_tee_guest_json(public.pelham_tee_bookings) from public, anon, authenticated;
revoke all on function public.pelham_tee_lock_slots(date, text, date, text) from public, anon, authenticated;
revoke all on function public.pelham_tee_guest_relock(public.pelham_tee_bookings) from public, anon, authenticated;

revoke all on function public.pelham_booking_find(text, text) from public;
revoke all on function public.pelham_sim_guest_update(text, text, jsonb) from public;
revoke all on function public.pelham_sim_guest_cancel(text, text) from public;
revoke all on function public.pelham_tee_guest_update(text, text, jsonb) from public;
revoke all on function public.pelham_tee_guest_cancel(text, text) from public;

grant execute on function public.pelham_booking_find(text, text) to anon, authenticated;
grant execute on function public.pelham_sim_guest_update(text, text, jsonb) to anon, authenticated;
grant execute on function public.pelham_sim_guest_cancel(text, text) to anon, authenticated;
grant execute on function public.pelham_tee_guest_update(text, text, jsonb) to anon, authenticated;
grant execute on function public.pelham_tee_guest_cancel(text, text) to anon, authenticated;
