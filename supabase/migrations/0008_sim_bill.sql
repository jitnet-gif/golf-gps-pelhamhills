-- 실내 골프 베이 요금을 **계산서(0005)** 로 받는다. Bay Sheet 의 "Paid" 토글을 없앤다.
--
-- 왜: 손님은 `/book/indoor` 에서 돈을 내지 않는다(예약만, 결제는 와서). 그런데 Bay Sheet 의
-- 초록 "Paid" 버튼은 `status = 'paid'` 글자만 바꿨다 — 돈이 오가지 않았는데 결제 완료로 보였다
-- (2026-09-30, #B8323B2D89). 2026-09-10 결정 "직원 토글만으로 paid 가 되면 안 된다" 를 어긴다.
-- 이제 베이 요금은 그린피처럼 계산서 한 줄이고, **계산서가 결제될 때만** 예약이 paid 가 된다.
--
-- 바뀌는 것
-- 1. 계산서 줄 종류 `sim_booking`(칸 `sim_reservation_id`). 한 예약은 살아 있는 계산서 한 곳에만.
--    날짜·시각은 그린피 줄과 같은 `tee_date`·`tee_time` 칸에 넣는다(영수증·매출 탭이 그대로 읽는다).
-- 2. 계산서 station `simulator`. `pelham_staff_bill_open` 을 다시 정의한다(목록이 박혀 있다).
-- 3. `pelham_staff_bill_add_sim(bill, reservation)` — 직원 함수 하나 추가.
-- 4. `pelham_pos_recalc` 를 다시 정의한다: 열린 계산서의 베이 줄은 예약의 지금 `total_price` 를
--    따라간다(담은 뒤 길이를 바꿨을 수 있다). 바뀐 곳은 베이 줄 루프 하나뿐이다.
--    예약 쪽 트리거에서 계산서를 다시 계산하지 **않는다** — 결제는 계산서 → 베이 날짜 순으로,
--    Bay Sheet 수정은 베이 날짜 → (계산서) 순으로 잠가서 서로를 기다리다 멈춘다.
-- 5. `pelham_staff_bill_line_update` 를 다시 정의한다: 베이 줄도 수량 0/1 만(한 예약 = 한 줄).
-- 6. 계산서 트리거: open → paid 이면 담긴 예약을 paid 로, paid → refunded 이면 checked_in 으로.
-- 7. 예약 트리거(보호): 결제된 계산서 없이 paid 로 가는 길을 막는다. 결제된 계산서가 있는
--    예약은 paid 에서 벗어나거나(취소 포함) 베이·길이(=요금)를 바꿀 수 없다 — 계산서 환불로만.
--    `pelham_pos_guard_tee`(0005)와 같은 생각이다.
--
-- 이미 paid 로 찍혀 있지만 계산서가 없는 예약(토글로 찍힌 것)은 건드리지 않는다. 보호 트리거는
-- 그런 예약이 paid 에서 벗어나는 것을 막지 않으니 Bay Sheet 에서 Check In 을 누르면 돌아간다.
--
-- 규칙은 0005·0007 과 같다: `pelham_` 접두사, 직원 함수만 authenticated 에게, 오류는 PTxxx.
-- 전제: 0005, 0007. 실행: SQL editor 에 이 파일 전체를 붙여 한 번. 다시 실행해도 안전하다.

do $$
begin
  if to_regclass('public.pelham_bill_lines') is null or to_regprocedure('public.pelham_pos_recalc(bigint)') is null then
    raise exception '0008 needs 0005 first (pelham_bill_lines / pelham_pos_recalc is missing).';
  end if;
  if to_regprocedure('public.pelham_staff_sim_update(bigint, jsonb)') is null then
    raise exception '0008 needs 0007 first (pelham_staff_sim_update is missing).';
  end if;
end;
$$;

-- ===== 테이블 ==========================================================

alter table public.pelham_bill_lines
  add column if not exists sim_reservation_id bigint references public.pelham_sim_reservations (id);

-- 0005 의 이름 없는 check 두 개(줄 종류, station)를 찾아 바꾼다. 이름은 Postgres 가 붙였으니
-- 추측하지 않고 정의로 찾는다. 이 파일이 붙인 이름도 같은 모양이라 다시 돌리면 지우고 다시 만든다.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.pelham_bill_lines'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind = ANY%'
  loop
    execute format('alter table public.pelham_bill_lines drop constraint %I', c.conname);
  end loop;
  alter table public.pelham_bill_lines add constraint pelham_bill_lines_kind_check
    check (kind in ('product', 'tee_player', 'sim_booking'));

  if not exists (select 1 from pg_constraint where conname = 'pelham_bill_lines_sim_check') then
    alter table public.pelham_bill_lines add constraint pelham_bill_lines_sim_check
      check ((kind = 'sim_booking') = (sim_reservation_id is not null));
  end if;

  for c in
    select conname from pg_constraint
     where conrelid = 'public.pelham_bills'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%station = ANY%'
  loop
    execute format('alter table public.pelham_bills drop constraint %I', c.conname);
  end loop;
  alter table public.pelham_bills add constraint pelham_bills_station_check
    check (station in ('pro_shop', 'snack_bar', 'tee_sheet', 'simulator'));
end;
$$;

-- 한 예약의 베이 요금은 살아 있는 계산서 한 곳에만. 두 계산서에 담기면 두 번 받는다.
create unique index if not exists pelham_bill_lines_sim_once
  on public.pelham_bill_lines (sim_reservation_id) where kind = 'sim_booking' and active;

-- ===== 헬퍼 ============================================================

-- 870 → '2:30 PM'
create or replace function public.pelham_pos_sim_time(p_minutes integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select format('%s:%s %s',
                case when (p_minutes / 60) % 12 = 0 then 12 else (p_minutes / 60) % 12 end,
                lpad((p_minutes % 60)::text, 2, '0'),
                case when p_minutes >= 12 * 60 then 'PM' else 'AM' end)
$$;

-- 베이 줄의 이름. 영수증에 그대로 찍힌다: "Simulator Bay 2 — Golfer 1 (3:00 PM, 1h)".
create or replace function public.pelham_pos_sim_line_name(r public.pelham_sim_reservations)
returns text
language sql
stable
set search_path = ''
as $$
  select format('Simulator Bay %s — %s (%s, %sh)',
                coalesce((select b.bay_number::text from public.pelham_sim_bays b where b.id = r.bay_id), '?'),
                coalesce(nullif(btrim(r.customer_name), ''), 'Guest'),
                public.pelham_pos_sim_time(r.start_minutes),
                r.duration_hours)
$$;

-- 0005 와 같고, 베이 줄 루프(가운데)만 더했다.
create or replace function public.pelham_pos_recalc(p_bill bigint)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  l record;
  v_doc jsonb;
  v_player jsonb;
  v_price integer;
  v_subtotal integer;
  v_discount integer;
  v_taxable integer;
  v_status text;
  v_sim public.pelham_sim_reservations;
begin
  select b.status into v_status from public.pelham_bills b where b.id = p_bill for update;
  if v_status is distinct from 'open' then
    return;
  end if;
  for l in
    select * from public.pelham_bill_lines where bill_id = p_bill and kind = 'tee_player' and active
  loop
    select t.doc into v_doc from public.pelham_tee_bookings t where t.id = l.booking_id;
    v_player := public.pelham_pos_find_player(v_doc, l.player_id);
    if v_player is null or coalesce((v_player->>'cancelled')::boolean, false)
       or coalesce((v_player->>'paid')::boolean, false) then
      continue;
    end if;
    v_price := public.pelham_pos_tee_price(v_doc, v_player);
    update public.pelham_bill_lines
       set unit_price = v_price,
           line_total = v_price * quantity - least(discount, v_price * quantity),
           name = public.pelham_pos_tee_line_name(v_doc, v_player),
           tee_date = (v_doc->>'date')::date,
           tee_time = v_doc->>'time'
     where id = l.id;
  end loop;

  -- 베이 줄: 예약의 지금 요금(세전 달러)을 따라간다. 잠그지 않고 읽기만 한다(파일 머리 4).
  -- 결제·취소된 예약은 값을 바꾸지 않고 둔다 — 결제 트리거가 그 줄을 거절한다.
  for l in
    select * from public.pelham_bill_lines where bill_id = p_bill and kind = 'sim_booking' and active
  loop
    select * into v_sim from public.pelham_sim_reservations r where r.id = l.sim_reservation_id;
    if v_sim.id is null or v_sim.status in ('paid', 'cancelled') then
      continue;
    end if;
    v_price := round(coalesce(v_sim.total_price, 0) * 100)::integer;
    update public.pelham_bill_lines
       set unit_price = v_price,
           line_total = v_price * quantity - least(discount, v_price * quantity),
           name = public.pelham_pos_sim_line_name(v_sim),
           tee_date = v_sim.booking_date,
           tee_time = public.pelham_pos_sim_time(v_sim.start_minutes)
     where id = l.id;
  end loop;

  select coalesce(sum(line_total), 0) into v_subtotal
    from public.pelham_bill_lines where bill_id = p_bill and active;
  select b.discount into v_discount from public.pelham_bills b where b.id = p_bill;
  v_discount := least(coalesce(v_discount, 0), v_subtotal);
  v_taxable := v_subtotal - v_discount;

  update public.pelham_bills
     set subtotal = v_subtotal,
         discount = v_discount,
         tax = public.pelham_pos_tax(v_taxable),
         total = v_taxable + public.pelham_pos_tax(v_taxable)
   where id = p_bill;
end;
$$;

-- ===== 직원 함수 =======================================================

-- 0005 와 같고, station 목록에 simulator 만 더했다.
create or replace function public.pelham_staff_bill_open(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_station text := coalesce(nullif(p->>'station', ''), 'pro_shop');
begin
  perform public.pelham_require_staff();
  if v_station not in ('pro_shop', 'snack_bar', 'tee_sheet', 'simulator') then
    perform public.pelham_fail('422', format('''%s'' is not a station', v_station));
  end if;
  insert into public.pelham_bills (station, label, cashier, note, created_by)
  values (v_station, nullif(btrim(coalesce(p->>'label', '')), ''),
          nullif(btrim(coalesce(p->>'cashier', '')), ''),
          nullif(btrim(coalesce(p->>'note', '')), ''), auth.uid())
  returning id into v_id;
  return public.pelham_pos_bill_json(v_id);
end;
$$;

-- 0005 와 같고, 베이 줄도 그린피 줄처럼 수량 0/1 만 받는다.
create or replace function public.pelham_staff_bill_line_update(p_bill bigint, p_line bigint, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l public.pelham_bill_lines;
  v_qty integer;
  v_discount integer;
begin
  perform public.pelham_require_staff();
  perform public.pelham_pos_lock_open(p_bill);
  select * into l from public.pelham_bill_lines where id = p_line and bill_id = p_bill;
  if l.id is null then
    perform public.pelham_fail('404', 'Line not found on this bill');
  end if;
  p := coalesce(p, '{}'::jsonb);

  v_qty := coalesce((p->>'quantity')::integer, l.quantity);
  if l.kind = 'tee_player' and v_qty not in (0, 1) then
    perform public.pelham_fail('422', 'A green fee line is one player. Remove it or keep it.');
  end if;
  if l.kind = 'sim_booking' and v_qty not in (0, 1) then
    perform public.pelham_fail('422', 'A simulator line is one reservation. Remove it or keep it.');
  end if;
  if v_qty = 0 then
    delete from public.pelham_bill_lines where id = p_line;
  else
    if v_qty < 0 or v_qty > 9999 then
      perform public.pelham_fail('422', 'Quantity must be between 0 and 9999.');
    end if;
    v_discount := coalesce((p->>'discount')::integer, l.discount);
    if v_discount < 0 then
      perform public.pelham_fail('422', 'Discount cannot be negative.');
    end if;
    v_discount := least(v_discount, v_qty * l.unit_price);
    update public.pelham_bill_lines
       set quantity = v_qty, discount = v_discount, line_total = v_qty * unit_price - v_discount
     where id = p_line;
  end if;

  perform public.pelham_pos_recalc(p_bill);
  return public.pelham_pos_bill_json(p_bill);
end;
$$;

-- 베이 예약 하나를 계산서에 담는다. 이미 낸·취소된·다른 계산서에 있는 예약은 거절한다.
create or replace function public.pelham_staff_bill_add_sim(p_bill bigint, p_reservation bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pelham_sim_reservations;
  v_other text;
  v_price integer;
begin
  perform public.pelham_require_staff();
  perform public.pelham_pos_lock_open(p_bill);

  select * into v from public.pelham_sim_reservations where id = p_reservation;
  if v.id is null then
    perform public.pelham_fail('404', 'Reservation not found');
  end if;
  if v.status = 'cancelled' then
    perform public.pelham_fail('409', 'This reservation is cancelled.');
  end if;
  if exists (select 1 from public.pelham_bill_lines li join public.pelham_bills b on b.id = li.bill_id
              where li.sim_reservation_id = v.id and li.kind = 'sim_booking' and li.active and b.status = 'paid') then
    perform public.pelham_fail('409', 'This reservation has already been paid.');
  end if;
  select coalesce(b.receipt_no, b.label, '#' || b.id) into v_other
    from public.pelham_bill_lines li join public.pelham_bills b on b.id = li.bill_id
   where li.sim_reservation_id = v.id and li.kind = 'sim_booking' and li.active
   limit 1;
  if v_other is not null then
    perform public.pelham_fail('409', format('This reservation is already on bill %s.', v_other));
  end if;

  v_price := round(coalesce(v.total_price, 0) * 100)::integer;
  insert into public.pelham_bill_lines
    (bill_id, kind, sku, name, category, quantity, unit_price, line_total,
     sim_reservation_id, tee_date, tee_time)
  values
    (p_bill, 'sim_booking', 'SIM', public.pelham_pos_sim_line_name(v), 'Simulator',
     1, v_price, v_price, v.id, v.booking_date, public.pelham_pos_sim_time(v.start_minutes));

  perform public.pelham_pos_recalc(p_bill);
  return public.pelham_pos_bill_json(p_bill);
end;
$$;

-- ===== 트리거 ==========================================================

-- 계산서가 결제되면 담긴 예약을 paid 로, 환불되면 checked_in 으로.
-- 결제 함수(`pelham_staff_bill_pay`)의 한 트랜잭션 안에서 돈다 — 여기서 거절하면 결제 전체가 없던 일이 된다.
-- 잠금 순서: 계산서(이미 잡혀 있다) → 베이 날짜 → 예약 행. Bay Sheet 수정은 계산서를 잠그지 않는다.
create or replace function public.pelham_pos_sim_on_bill()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  l record;
  v public.pelham_sim_reservations;
begin
  if old.status = 'open' and new.status = 'paid' then
    for l in
      select li.sim_reservation_id as id, li.name, r.booking_date
        from public.pelham_bill_lines li
        join public.pelham_sim_reservations r on r.id = li.sim_reservation_id
       where li.bill_id = new.id and li.kind = 'sim_booking' and li.active
       order by r.booking_date, li.sim_reservation_id
    loop
      perform pg_advisory_xact_lock(hashtext('pelham_sim:' || l.booking_date::text));
      select * into v from public.pelham_sim_reservations where id = l.id for update;
      if v.status = 'cancelled' then
        perform public.pelham_fail('409', format('%s was cancelled. Remove the line.', l.name));
      end if;
      if v.status = 'paid' then
        perform public.pelham_fail('409', format('%s is already marked paid. Remove the line.', l.name));
      end if;
      update public.pelham_sim_reservations set status = 'paid', updated_at = now() where id = l.id;
    end loop;
  elsif old.status = 'paid' and new.status = 'refunded' then
    -- 환불 함수는 줄을 무효로 하기 **전에** 계산서 상태를 바꾼다. 그래서 여기서는 아직 active 다.
    for l in
      select li.sim_reservation_id as id, r.booking_date
        from public.pelham_bill_lines li
        join public.pelham_sim_reservations r on r.id = li.sim_reservation_id
       where li.bill_id = new.id and li.kind = 'sim_booking' and li.active
       order by r.booking_date, li.sim_reservation_id
    loop
      perform pg_advisory_xact_lock(hashtext('pelham_sim:' || l.booking_date::text));
      update public.pelham_sim_reservations
         set status = 'checked_in', updated_at = now()
       where id = l.id and status = 'paid';
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists pelham_pos_sim_on_bill on public.pelham_bills;
create trigger pelham_pos_sim_on_bill
  after update of status on public.pelham_bills
  for each row execute function public.pelham_pos_sim_on_bill();

-- 예약 보호. "결제된 계산서가 이 예약을 덮고 있는가" 하나만 보고 판단한다.
create or replace function public.pelham_pos_guard_sim()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_receipt text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'paid' then
      perform public.pelham_fail('409', 'A reservation becomes paid only when its bill is charged. Press Pay.');
    end if;
    return new;
  end if;

  select b.receipt_no into v_receipt
    from public.pelham_bill_lines li join public.pelham_bills b on b.id = li.bill_id
   where li.sim_reservation_id = new.id and li.kind = 'sim_booking' and li.active and b.status = 'paid'
   limit 1;

  if new.status = 'paid' and old.status <> 'paid' and v_receipt is null then
    perform public.pelham_fail('409', 'A reservation becomes paid only when its bill is charged. Press Pay.');
  end if;
  if v_receipt is not null then
    if old.status = 'paid' and new.status <> 'paid' then
      perform public.pelham_fail('409', format(
        'This reservation was paid on bill %s. Refund that bill first.', v_receipt));
    end if;
    -- 베이를 옮기는 것은 막지 않는다(점검 중인 베이에서 빼야 할 수 있다). 요금이 바뀌는 것만 막는다.
    if new.duration_hours <> old.duration_hours or new.total_price is distinct from old.total_price then
      perform public.pelham_fail('409', format(
        'This reservation was paid on bill %s. Refund that bill before changing the hours or price.', v_receipt));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pelham_pos_guard_sim on public.pelham_sim_reservations;
create trigger pelham_pos_guard_sim
  before insert or update on public.pelham_sim_reservations
  for each row execute function public.pelham_pos_guard_sim();

-- ===== 권한 ============================================================
-- 다시 정의한 0005 함수(recalc, bill_open, line_update)는 `create or replace` 라 권한이 그대로다.

revoke all on function public.pelham_pos_sim_time(integer) from public, anon, authenticated;
revoke all on function public.pelham_pos_sim_line_name(public.pelham_sim_reservations) from public, anon, authenticated;
revoke all on function public.pelham_pos_sim_on_bill() from public, anon, authenticated;
revoke all on function public.pelham_pos_guard_sim() from public, anon, authenticated;

revoke all on function public.pelham_staff_bill_add_sim(bigint, bigint) from public, anon, authenticated;
grant execute on function public.pelham_staff_bill_add_sim(bigint, bigint) to authenticated;
