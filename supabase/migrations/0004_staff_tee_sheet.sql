-- 프로 샵 티 시트(어드민 화면)를 FastAPI 없이 돌린다.
--
-- 왜: 0003 은 손님 화면만 옮겼다. 직원 화면(`/admin/tee-sheet`)은 아직
-- `pelhamhills-api.fly.dev` 를 보고 있는데 그 서버는 2026-09-16 Fly.io 체험 종료로
-- 꺼졌다. 클럽은 2026-09-19 에 "직원은 GPS 앱에서 쓰던 관리자 계정으로 로그인한다"
-- 고 정했다. 음성 에이전트·AI 챗·오케스트레이션(일괄 작업)은 이식하지 않는다.
--
-- 규칙 (0003 과 같다)
-- - 공유 프로젝트다. 테이블·함수 전부 `pelham_` 접두사.
-- - 테이블에는 anon/authenticated 정책이 없고 권한도 없다. 직원이 닿는 문은
--   아래 `pelham_staff_*` 함수 열한 개뿐이다. 손님 정보(이름·전화·이메일)가
--   통째로 나가므로 함수마다 직원 확인을 먼저 한다.
-- - 영업 규칙(격자 6:40 AM~6:58 PM 9분, 한 티타임 4자리, 주말 58.41 / 평일 47.79,
--   카트 1인 $19.00)은 `backend/api/routes/tee_sheet.py` 와 같은 값이다.
--   바꾸면 양쪽을 같이 바꾼다.
-- - 정원 검사와 저장은 한 트랜잭션 안에서 advisory lock 으로 묶는다. 잠금 키는
--   0003 의 손님 예약과 **글자 그대로 같다** — 그래야 손님 예약과 직원 편집이
--   같은 티타임에서 서로를 기다린다.
-- - 오류는 `PTxxx` SQLSTATE (PostgREST 가 HTTP 상태로 쓴다). 직원이 그대로 읽어도
--   되는 문장이다. PT401=로그인 아님, PT404=없음, PT409=자리 충돌, PT422=입력 오류.
-- - `doc` 이 원본이다(0002 참고). 쓰기는 언제나 `doc` 을 만들고, 인덱스용 컬럼
--   (status/title/tee_time/booking_date/source/hold_expires_at/updated_at)을 거기서 뽑아 맞춘다.
--
-- 전제: GPS 앱의 `backend/migrations/0006_scorecards.sql` 이 이 프로젝트에 먼저
-- 돌아 있어야 한다. 직원 = 그 마이그레이션의 관리자 표 `public.scorecard_admins`
-- 에 올라 있는 계정이고, 판정은 거기 있는 `public.is_scorecard_admin()` 을 그대로
-- 쓴다(같은 판정이 두 벌로 갈라지지 않게). 0006 이 없으면 아래
-- `pelham_is_staff` 를 만들 때 바로 실패한다 — 그게 맞다.
-- ⚠️ 그래서 지금은 **명단 하나가 GPS 스코어카드 관리자와 프로 샵 직원을 겸한다**.
--    둘을 나눠야 하면 `pelham_is_staff` 만 다른 표로 바꾸면 된다.
--
-- 실행: SQL editor 에 이 파일 전체를 붙여 한 번. 다시 실행해도 안전하다.

-- 0002/0003 이 이미 걷어 냈지만, 이 파일만 따로 돌려도 잠겨 있도록 한 번 더.
revoke all on public.pelham_tee_bookings from anon, authenticated;

-- ===== 직원 확인 =======================================================

-- 직원인가. GPS 0006 의 관리자 판정을 그대로 빌린다.
create or replace function public.pelham_is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.is_scorecard_admin(), false)
$$;

-- 모든 `pelham_staff_*` 의 첫 줄. 로그인하지 않았거나 명단에 없으면 여기서 끝난다.
create or replace function public.pelham_require_staff()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.pelham_is_staff() then
    perform public.pelham_fail('401', 'Sign in with a pro shop account to open the tee sheet.');
  end if;
end;
$$;

-- ===== 티 시트 헬퍼 ====================================================
-- 전부 `pelham_staff_*` 밖에 둔다: 직원 확인이 없는 내부 부품이라 아무에게도
-- 실행 권한을 주지 않는다(파일 끝 권한 절 참고).

-- 격자 상수. `tee_sheet.py` 의 FIRST_TEE_MINUTES / LAST_TEE_MINUTES / SLOT_INTERVAL_MINUTES.
-- 6:40 AM(400) ~ 6:58 PM(1138), 9분 → 83칸. 한 칸 4자리이므로 하루 정원은 332.

-- 라벨 → 분. `label_to_minutes` 와 같다. 격자 밖 라벨도 숫자로 바꿔 준다
-- (정렬에만 쓴다 — 옛 임포트 데이터에 격자 밖 시각이 섞여 있어도 줄이 사라지면 안 된다).
create or replace function public.pelham_tee_minutes(p_label text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
           when m is null then null
           else (case when upper(m[3]) = 'PM' then (m[1]::integer % 12) + 12
                      else m[1]::integer % 12 end) * 60 + m[2]::integer
         end
  from (
    select regexp_match(btrim(coalesce(p_label, '')), '^(\d{1,2}):(\d{2})\s*(AM|PM)$', 'i') as m
  ) s
$$;

-- `require_slot`: 라벨 모양과 격자 위 여부를 본다. 직원 화면은 **지난 날짜·시각도**
-- 쓸 수 있다(전화로 받은 예약을 나중에 적는다) — 0003 의 손님 예약과 다른 점이다.
create or replace function public.pelham_tee_require_slot(p_date date, p_time text)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v integer;
begin
  if p_time is null or btrim(p_time) !~ '^\d{1,2}:\d{2} (AM|PM)$' then
    perform public.pelham_fail('422', format('''%s'' is not a valid tee time label', coalesce(p_time, '')));
  end if;
  select g.m into v
    from generate_series(400, 1138, 9) as g(m)
   where public.pelham_tee_label(g.m) = btrim(p_time);
  if v is null then
    perform public.pelham_fail('422', format('%s is not a bookable tee time on %s',
                                             btrim(p_time), to_char(p_date, 'YYYY-MM-DD')));
  end if;
  return v;
end;
$$;

-- 전체 이름을 (firstName, lastName) 으로. **성은 마지막 토큰**이다
-- (`tee_sheet_store.split_name`). 프론트가 셀을 `성, 이름` 으로 그리므로
-- "Blake Jo Kestrel" 가 "Jo Kestrel, Blake" 가 되면 안 된다.
create or replace function public.pelham_tee_split_name(p_name text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
           when n = '' or position(' ' in n) = 0 then array[n, '']
           else array[
             btrim(left(n, length(n) - position(' ' in reverse(n)))),
             btrim(right(n, position(' ' in reverse(n)) - 1))
           ]
         end
  from (select btrim(coalesce(p_name, '')) as n) s
$$;

-- `name` 은 언제나 서버가 만든다 (`Player._reconcile_names`).
-- firstName/lastName 중 하나라도 오면 그것이 진실, name 만 오면 쪼갠다, 둘 다 없으면 Guest.
create or replace function public.pelham_tee_name(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('firstName', f, 'lastName', l, 'name', btrim(f || ' ' || l))
  from (
    select case when a.first <> '' or a.last <> '' then a.first
                when a.nm <> '' then (public.pelham_tee_split_name(a.nm))[1]
                else 'Guest' end as f,
           case when a.first <> '' or a.last <> '' then a.last
                when a.nm <> '' then (public.pelham_tee_split_name(a.nm))[2]
                else '' end as l
      from (select btrim(coalesce(p->>'firstName', '')) as first,
                   btrim(coalesce(p->>'lastName', ''))  as last,
                   btrim(coalesce(p->>'name', ''))      as nm) a
  ) b
$$;

-- 1인 카트 요금. 2026-09-15 클럽 확인: 홀 수·요금제와 무관하게 $19.00 한 가지.
-- 이름에 "Cart" 가 든 회원 요금제는 회원권에 카트가 들어 있다고 보고 0.
-- `p_holes` 는 지금 금액에 영향이 없지만 인자로 남긴다 — 홀 수별 요금이 다시
-- 생기면 부르는 쪽(생성·수정·리포트)을 건드리지 않고 여기만 고친다.
create or replace function public.pelham_tee_cart_fee(p_rate_plan text, p_holes integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when position('cart' in lower(coalesce(p_rate_plan, ''))) > 0 then 0.00 else 19.00 end
$$;

create or replace function public.pelham_same_money(a numeric, b numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select round(coalesce(a, 0), 2) = round(coalesce(b, 0), 2)
$$;

-- 들어온 플레이어 조각 → 완전한 Player. `_settle_new_player` 의 파생 값까지 채운다.
create or replace function public.pelham_tee_player(p jsonb, p_holes integer, p_id text, p_now text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_names jsonb := public.pelham_tee_name(p);
  v_type text := coalesce(p->>'type', 'Guest');
  v_plan text := coalesce(p->>'ratePlan', 'Public');
  v_cart boolean := coalesce((p->>'cart')::boolean, false);
  v_paid boolean := coalesce((p->>'paid')::boolean, false);
  -- 금액을 "직접 준" 경우에만 그 값을 쓴다. 안 주면 요금제·홀 수로 채운다.
  v_fee_given boolean := (p ? 'cartFee') and jsonb_typeof(p->'cartFee') <> 'null';
  v_fee numeric;
  v_paid_at text := nullif(p->>'paidAt', '');
begin
  if v_type not in ('Existing Customer', 'Guest') then
    perform public.pelham_fail('422', format('''%s'' is not a player type (Existing Customer or Guest)', v_type));
  end if;

  if not v_cart then
    v_fee := 0.00;
  elsif v_fee_given then
    v_fee := (p->>'cartFee')::numeric;
    if v_fee < 0 then
      perform public.pelham_fail('422', 'Cart fee cannot be negative.');
    end if;
  else
    v_fee := public.pelham_tee_cart_fee(v_plan, p_holes);
  end if;

  -- 결제 시각은 서버가 찍는다(영수증의 날짜·시각). 이미 적혀 있으면 그대로 둔다.
  if v_paid and v_paid_at is null then
    v_paid_at := p_now;
  end if;

  return jsonb_build_object(
    'id', p_id,
    'name', v_names->>'name',
    'firstName', v_names->>'firstName',
    'lastName', v_names->>'lastName',
    'email', coalesce(p->>'email', ''),
    'phone', coalesce(p->>'phone', ''),
    'type', v_type,
    'ratePlan', v_plan,
    'arrived', coalesce((p->>'arrived')::boolean, false),
    'paid', v_paid,
    'cancelled', coalesce((p->>'cancelled')::boolean, false),
    'no_show', coalesce((p->>'no_show')::boolean, false),
    'cart', v_cart,
    'cartFee', v_fee,
    'paidAt', v_paid_at
  );
end;
$$;

-- 감사 로그 한 줄을 **맨 앞에** 붙이고 `updatedAt` 을 찍는다 (`_audit`).
-- 최신 40개만 남긴다(AUDIT_LIMIT) — 한 예약의 doc 이 끝없이 커지면 격자 한 번
-- 그리는 데 읽는 양이 계속 늘어난다.
create or replace function public.pelham_tee_audit(p_doc jsonb, p_message text, p_now text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_list jsonb;
begin
  v_list := jsonb_build_array(jsonb_build_object(
              'id', gen_random_uuid()::text,
              'ts', p_now,
              'message', p_message
            )) || coalesce(p_doc->'audit', '[]'::jsonb);
  if jsonb_array_length(v_list) > 40 then
    select coalesce(jsonb_agg(e order by i), '[]'::jsonb) into v_list
      from jsonb_array_elements(v_list) with ordinality t(e, i)
     where i <= 40;
  end if;
  return jsonb_set(jsonb_set(p_doc, '{audit}', v_list), '{updatedAt}', to_jsonb(p_now));
end;
$$;

-- 이 티타임이 이미 잡아먹은 자리 수. 무엇이 자리를 차지하는지의 판정은
-- `occupies_seat` 하나와 같다: 취소는 자리를 반납하고, 만료된 음성 홀드도
-- **레코드가 남아 있어도** 즉시 빠진다.
create or replace function public.pelham_tee_seats(p_date date, p_time text, p_exclude text)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(jsonb_array_length(coalesce(t.doc->'players', '[]'::jsonb))), 0)::integer
    from public.pelham_tee_bookings t
   where t.booking_date = p_date
     and t.tee_time = p_time
     and coalesce(t.status, '') <> 'cancelled'
     and (t.hold_expires_at is null or t.hold_expires_at > now())
     and (p_exclude is null or t.id <> p_exclude)
$$;

-- 티타임 정원(4명). 한 티타임에 예약이 몇 건이든 상관없다 — 합계 인원만 본다.
create or replace function public.pelham_tee_require_capacity(
  p_date date, p_time text, p_incoming integer, p_exclude text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_taken integer := public.pelham_tee_seats(p_date, p_time, p_exclude);
begin
  if v_taken + p_incoming > 4 then
    perform public.pelham_fail('409', format(
      '%s on %s only holds 4 players; %s are already taken and %s more were requested',
      p_time, to_char(p_date, 'YYYY-MM-DD'), v_taken, p_incoming));
  end if;
end;
$$;

-- 정원 검사와 저장을 묶는 잠금. 키 문자열은 0003 `pelham_tee_book` 과 같아야 한다.
create or replace function public.pelham_tee_lock(p_date date, p_time text)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtext('pelham_tee:' || p_date::text || ' ' || coalesce(p_time, '')))
$$;

-- doc 을 쓰고 인덱스용 컬럼을 거기에 맞춘다. `created_at` 은 건드리지 않는다.
create or replace function public.pelham_tee_save(p_doc jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  update public.pelham_tee_bookings t
     set booking_date    = (p_doc->>'date')::date,
         tee_time        = p_doc->>'time',
         status          = p_doc->>'status',
         source          = p_doc->>'source',
         title           = p_doc->>'title',
         hold_expires_at = nullif(p_doc->>'holdExpiresAt', '')::timestamptz,
         updated_at      = nullif(p_doc->>'updatedAt', '')::timestamptz,
         doc             = p_doc,
         synced_at       = now()
   where t.id = p_doc->>'id'
$$;

-- 상태 전이 + 플레이어 플래그 동기화 (`_apply_status`). {doc, message} 를 돌려준다.
create or replace function public.pelham_tee_apply_status(
  p_doc jsonb, p_status text, p_reason text, p_now text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_doc jsonb := jsonb_set(p_doc, '{status}', to_jsonb(p_status));
  v_players jsonb := '[]'::jsonb;
  pl jsonb;
  v_reason text;
  v_msg text;
begin
  if p_status = 'checked_in' then
    for pl in select value from jsonb_array_elements(coalesce(v_doc->'players', '[]'::jsonb)) loop
      if not coalesce((pl->>'cancelled')::boolean, false) then
        pl := pl || jsonb_build_object('arrived', true, 'no_show', false);
      end if;
      v_players := v_players || pl;
    end loop;
    v_doc := jsonb_set(v_doc, '{players}', v_players);
    v_msg := 'Reservation checked in.';

  elsif p_status = 'paid' then
    for pl in select value from jsonb_array_elements(coalesce(v_doc->'players', '[]'::jsonb)) loop
      if not coalesce((pl->>'cancelled')::boolean, false) then
        -- 결제 시각은 "아직 결제 아님" 에서 넘어오는 순간에만 찍는다.
        if not coalesce((pl->>'paid')::boolean, false) then
          pl := pl || jsonb_build_object('paidAt', p_now);
        end if;
        pl := pl || jsonb_build_object('arrived', true, 'paid', true, 'no_show', false);
      end if;
      v_players := v_players || pl;
    end loop;
    v_doc := jsonb_set(v_doc, '{players}', v_players);
    v_msg := 'Reservation marked paid.';

  elsif p_status = 'cancelled' then
    v_reason := coalesce(nullif(p_reason, ''), 'Cancelled by pro shop.');
    for pl in select value from jsonb_array_elements(coalesce(v_doc->'players', '[]'::jsonb)) loop
      v_players := v_players || (pl || jsonb_build_object('cancelled', true, 'arrived', false));
    end loop;
    v_doc := jsonb_set(jsonb_set(v_doc, '{players}', v_players), '{cancelReason}', to_jsonb(v_reason));
    v_msg := format('Reservation cancelled: %s', v_reason);

  elsif p_status = 'no_show' then
    for pl in select value from jsonb_array_elements(coalesce(v_doc->'players', '[]'::jsonb)) loop
      if not coalesce((pl->>'cancelled')::boolean, false) then
        pl := pl || jsonb_build_object('no_show', true);
      end if;
      v_players := v_players || pl;
    end loop;
    v_doc := jsonb_set(v_doc, '{players}', v_players);
    v_msg := 'Reservation marked no-show.';

  elsif p_status = 'blocked' then
    v_msg := 'Tee time blocked.';

  else
    -- reserved: 취소·노쇼·체크인·결제를 모두 되돌린다. paid 를 남겨 두면 취소 후
    -- 되살린 예약이 collected_revenue 에 잡혀 매출이 부풀려진다.
    for pl in select value from jsonb_array_elements(coalesce(v_doc->'players', '[]'::jsonb)) loop
      v_players := v_players || (pl || jsonb_build_object(
        'cancelled', false, 'no_show', false, 'arrived', false, 'paid', false, 'paidAt', null));
    end loop;
    v_doc := jsonb_set(jsonb_set(v_doc, '{players}', v_players), '{cancelReason}', 'null'::jsonb);
    v_msg := 'Reservation reinstated as reserved.';
  end if;

  return jsonb_build_object('doc', v_doc, 'message', v_msg);
end;
$$;

-- 하루치 리포트 (`build_daily_report`). 일간·주간 리포트가 같이 쓴다.
-- ⚠️ 리포트는 취소된 예약도, 만료된 음성 홀드도 빼지 않는다 — FastAPI 와 같다.
--    `total_tee_times` 와 `bookings[]` 는 그날 있는 줄 전부이고, 돈과 자리 계산에서만
--    취소가 빠진다.
create or replace function public.pelham_tee_daily_report(p_date date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  c_total_slots constant integer := 83 * 4;   -- 격자 83칸 × 한 칸 4자리
  v_tee_times integer := 0;
  v_booked integer := 0;
  v_total numeric := 0;
  v_collected numeric := 0;
  v_carts integer := 0;
  v_checked integer := 0;
  v_cancelled integer := 0;
  v_no_show integer := 0;
  v_lines jsonb := '[]'::jsonb;
  v_rate numeric;
  v_due numeric;
  b record;
  pl jsonb;
begin
  for b in
    select t.doc as d
      from public.pelham_tee_bookings t
     where t.booking_date = p_date
     order by coalesce(public.pelham_tee_minutes(t.doc->>'time'), 0), t.id
  loop
    v_tee_times := v_tee_times + 1;
    v_rate := coalesce((b.d->>'rate')::numeric, 0);

    if coalesce(b.d->>'status', '') <> 'cancelled' then
      for pl in select value from jsonb_array_elements(coalesce(b.d->'players', '[]'::jsonb)) loop
        if not coalesce((pl->>'cancelled')::boolean, false) then
          v_booked := v_booked + 1;
          -- 한 사람이 내는 돈 = 그린피 + (카트를 쓰면) 카트 요금. 둘 다 세전.
          v_due := v_rate + case when coalesce((pl->>'cart')::boolean, false)
                                 then coalesce((pl->>'cartFee')::numeric, 0) else 0 end;
          v_total := v_total + v_due;
          if coalesce((pl->>'paid')::boolean, false) then
            v_collected := v_collected + v_due;
          end if;
        end if;
      end loop;
      -- 카트 대수는 취소되지 않은 예약만 센다(파이썬도 이 루프 안에서 더한다).
      v_carts := v_carts + coalesce((b.d->>'cartCount')::integer, 0);
    end if;

    if b.d->>'status' = 'checked_in' then v_checked := v_checked + 1; end if;
    if b.d->>'status' = 'cancelled' then v_cancelled := v_cancelled + 1; end if;
    if b.d->>'status' = 'no_show'   then v_no_show := v_no_show + 1; end if;

    -- 줄의 players 는 **전체 인원**이다 (취소된 사람도 센다). booked_slots 와 다르다.
    v_lines := v_lines || jsonb_build_object(
      'id', b.d->>'id',
      'time', b.d->>'time',
      'title', b.d->>'title',
      'players', jsonb_array_length(coalesce(b.d->'players', '[]'::jsonb)),
      'rate', v_rate,
      'status', b.d->>'status'
    );
  end loop;

  return jsonb_build_object(
    'date', to_char(p_date, 'YYYY-MM-DD'),
    'total_tee_times', v_tee_times,
    'total_slots', c_total_slots,
    'booked_slots', v_booked,
    'available_slots', greatest(c_total_slots - v_booked, 0),
    'occupancy_rate', round(v_booked::numeric / c_total_slots * 100, 2),
    'total_revenue', round(v_total, 2),
    'collected_revenue', round(v_collected, 2),
    'outstanding_revenue', round(v_total - v_collected, 2),
    'checked_in', v_checked,
    'cancelled', v_cancelled,
    'no_show', v_no_show,
    'carts', v_carts,
    'bookings', v_lines
  );
end;
$$;

-- ===== 직원 함수 (열한 개) =============================================

-- 1) 슬롯 격자. `GET /tee-sheet/slots` 와 같다: 막힌 티타임도 지난 시각도 빼지
--    않는다. 직원 화면은 하루를 통째로 그려야 하기 때문이다(손님용
--    `pelham_tee_availability` 와 다른 점).
create or replace function public.pelham_staff_slots(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slots jsonb;
begin
  perform public.pelham_require_staff();
  if p_date is null then
    perform public.pelham_fail('422', '''date'' must be an ISO date (YYYY-MM-DD)');
  end if;

  select jsonb_agg(jsonb_build_object(
           'time', public.pelham_tee_label(g.m),
           'minutes', g.m,
           'rate', public.pelham_tee_rate(p_date),
           'cartsTotal', 4
         ) order by g.m)
    into v_slots
    from generate_series(400, 1138, 9) as g(m);

  return jsonb_build_object('date', to_char(p_date, 'YYYY-MM-DD'), 'slots', coalesce(v_slots, '[]'::jsonb));
end;
$$;

-- 2) 기간의 예약 전부(doc 그대로). 만료된 음성 홀드는 아무에게도 보여주지 않는다 —
--    정리 패스가 레코드를 지우기 전이라도 격자에는 없는 것으로 친다.
--    p_from/p_to 가 null 이면 그쪽 끝이 열려 있다(예전 `GET /tee-sheet/bookings` 와 같다).
create or replace function public.pelham_staff_bookings(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.pelham_require_staff();

  select jsonb_agg(t.doc order by t.booking_date, coalesce(public.pelham_tee_minutes(t.doc->>'time'), 0), t.id)
    into v
    from public.pelham_tee_bookings t
   where (p_from is null or t.booking_date >= p_from)
     and (p_to is null or t.booking_date <= p_to)
     and (t.hold_expires_at is null or t.hold_expires_at > now());

  return coalesce(v, '[]'::jsonb);
end;
$$;

-- 3) 한 건. id 로 부르는 길은 만료된 홀드도 돌려준다 (`GET .../{id}` 와 같다).
create or replace function public.pelham_staff_booking(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.pelham_require_staff();
  select t.doc into v from public.pelham_tee_bookings t where t.id = p_id;
  if v is null then
    perform public.pelham_fail('404', 'Booking not found');
  end if;
  return v;
end;
$$;

-- 4) 새 예약. 직원이 만든 것이므로 source='staff', 상태 reserved.
--    생성은 기본 플레이어를 만들지 않는다 — 요청에 실려 온 인원이 곧 정원 소비량이다.
create or replace function public.pelham_staff_booking_create(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_time text;
  v_title text;
  v_holes integer;
  v_rate numeric;
  v_span integer;
  v_carts integer;
  v_color text;
  v_notes text;
  v_status text := 'reserved';
  v_in jsonb := coalesce(p->'players', '[]'::jsonb);
  v_players jsonb := '[]'::jsonb;
  v_now text := public.pelham_iso(now());
  v_id text := gen_random_uuid()::text;
  v_doc jsonb;
  pl jsonb;
begin
  perform public.pelham_require_staff();

  -- 본문 검증이 먼저다 (FastAPI 는 pydantic 이 슬롯 검사보다 앞선다).
  v_title := coalesce(p->>'title', '');
  if v_title = '' then
    perform public.pelham_fail('422', '''title'' is required - it is the name shown on the tee sheet');
  end if;
  v_holes := coalesce(nullif(p->>'holes', ''), '18')::integer;
  if v_holes not in (9, 18) then
    perform public.pelham_fail('422', 'Holes must be 9 or 18.');
  end if;
  v_span := coalesce(nullif(p->>'span', ''), '1')::integer;
  if v_span not between 1 and 7 then
    perform public.pelham_fail('422', 'Span must be between 1 and 7.');
  end if;
  v_carts := coalesce(nullif(p->>'cartCount', ''), '0')::integer;
  if v_carts not between 0 and 4 then
    perform public.pelham_fail('422', 'Carts must be between 0 and 4.');
  end if;
  v_color := coalesce(nullif(p->>'color', ''), 'gold');
  if v_color not in ('blue', 'gold', 'gray') then
    perform public.pelham_fail('422', 'Colour must be blue, gold or gray.');
  end if;
  v_notes := coalesce(p->>'notes', '');
  if jsonb_typeof(v_in) <> 'array' then
    perform public.pelham_fail('422', '''players'' must be a list');
  end if;
  if jsonb_array_length(v_in) > 4 then
    perform public.pelham_fail('422', 'A tee time can contain at most 4 players');
  end if;

  if coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    perform public.pelham_fail('422', '''date'' must be an ISO date (YYYY-MM-DD)');
  end if;
  begin
    v_date := (p->>'date')::date;
  exception when others then
    perform public.pelham_fail('422', format('''date'' is not a real calendar date: %s', p->>'date'));
  end;

  perform public.pelham_tee_require_slot(v_date, p->>'time');
  v_time := btrim(p->>'time');

  -- rate 를 주지 않으면 그날의 요금표(주말/평일)를 쓴다. 준 값은 그대로 존중한다
  -- (단체·이벤트 요금을 직원이 손으로 적는다).
  v_rate := coalesce(nullif(p->>'rate', '')::numeric, public.pelham_tee_rate(v_date));

  for pl in select value from jsonb_array_elements(v_in) loop
    v_players := v_players || public.pelham_tee_player(
      pl, v_holes, coalesce(nullif(pl->>'id', ''), gen_random_uuid()::text), v_now);
  end loop;

  -- 이 티타임의 정원 확인과 기록을 한 잠금 안에서.
  perform public.pelham_tee_lock(v_date, v_time);
  perform public.pelham_tee_require_capacity(v_date, v_time, jsonb_array_length(v_players), null);

  v_doc := jsonb_build_object(
    'id', v_id,
    'date', to_char(v_date, 'YYYY-MM-DD'),
    'time', v_time,
    'holes', v_holes,
    'rate', v_rate,
    'span', v_span,
    'color', v_color,
    'title', v_title,
    'status', v_status,
    'cartCount', v_carts,
    'notes', v_notes,
    'players', v_players,
    'audit', '[]'::jsonb,
    'cancelReason', null,
    'source', 'staff',
    'holdExpiresAt', null,
    'createdAt', v_now,
    'updatedAt', v_now
  );
  v_doc := public.pelham_tee_audit(
    v_doc, format('Reservation created for %s %s.', to_char(v_date, 'YYYY-MM-DD'), v_time), v_now);

  insert into public.pelham_tee_bookings
    (id, booking_date, tee_time, status, source, title, hold_expires_at, created_at, updated_at, doc, synced_at)
  values
    (v_id, v_date, v_time, v_status, 'staff', v_title, null, now(), now(), v_doc, now());

  return v_doc;
end;
$$;

-- 5) 예약 수정. FastAPI 와 순서가 같다: 없는 예약이면 날짜 검증(422)보다 먼저 404.
--    한 번의 PATCH 가 감사 로그를 **여러 줄** 남길 수 있다(이동 + 제목 + 상태 = 세 줄).
create or replace function public.pelham_staff_booking_patch(p_id text, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_doc jsonb;
  v_old_date date;
  v_old_time text;
  v_new_date date;
  v_new_time text;
  v_now text := public.pelham_iso(now());
  v_status text;
  v_applied jsonb;
  v_holes integer;
  v_old_holes integer;
  v_reason text;
  v_players jsonb;
  v_fee numeric;
  pl jsonb;
  v_val numeric;
  v_int integer;
  v_txt text;
begin
  perform public.pelham_require_staff();

  select t.doc into v_doc from public.pelham_tee_bookings t where t.id = p_id;
  if v_doc is null then
    perform public.pelham_fail('404', 'Booking not found');
  end if;
  v_old_date := (v_doc->>'date')::date;
  v_old_time := v_doc->>'time';

  -- 잠글 티타임을 먼저 정한다: 옮기면 목적지, 아니면 지금 자리.
  v_new_date := v_old_date;
  v_new_time := v_old_time;
  if (p ? 'date') and jsonb_typeof(p->'date') <> 'null' then
    if coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      perform public.pelham_fail('422', '''date'' must be an ISO date (YYYY-MM-DD)');
    end if;
    begin
      v_new_date := (p->>'date')::date;
    exception when others then
      perform public.pelham_fail('422', format('''date'' is not a real calendar date: %s', p->>'date'));
    end;
  end if;
  if (p ? 'time') and jsonb_typeof(p->'time') <> 'null' then
    v_new_time := btrim(p->>'time');
  end if;

  perform public.pelham_tee_lock(v_new_date, v_new_time);

  -- 잠근 뒤 다시 읽는다. 그사이 다른 요청이 지웠거나 옮겼을 수 있다.
  select t.doc into v_doc from public.pelham_tee_bookings t where t.id = p_id;
  if v_doc is null then
    perform public.pelham_fail('404', 'Booking not found');
  end if;

  -- --- 날짜/시간 이동: 슬롯 재검증 + 목적지 정원 ---
  if ((p ? 'date') and jsonb_typeof(p->'date') <> 'null')
     or ((p ? 'time') and jsonb_typeof(p->'time') <> 'null') then
    perform public.pelham_tee_require_slot(v_new_date, v_new_time);
    if v_new_date <> (v_doc->>'date')::date or v_new_time <> v_doc->>'time' then
      -- 취소된 예약은 어디서도 자리를 잡지 않으므로 옮기는 것만으로는 목적지 정원을
      -- 한 자리도 먹지 않는다. 되살릴 때 아래 status 게이트가 다시 검사한다.
      if v_doc->>'status' <> 'cancelled' then
        if (v_doc->>'date')::date <> v_old_date or v_doc->>'time' <> v_old_time then
          perform public.pelham_fail('409',
            'This reservation changed while it was being edited. Reload and try again.');
        end if;
        perform public.pelham_tee_require_capacity(
          v_new_date, v_new_time,
          jsonb_array_length(coalesce(v_doc->'players', '[]'::jsonb)), p_id);
      end if;
      v_doc := jsonb_set(jsonb_set(v_doc, '{date}', to_jsonb(to_char(v_new_date, 'YYYY-MM-DD'))),
                         '{time}', to_jsonb(v_new_time));
      v_doc := public.pelham_tee_audit(
        v_doc, format('Moved to %s %s.', to_char(v_new_date, 'YYYY-MM-DD'), v_new_time), v_now);
    end if;
  end if;

  if (p ? 'title') and jsonb_typeof(p->'title') <> 'null' and p->>'title' <> v_doc->>'title' then
    v_doc := jsonb_set(v_doc, '{title}', to_jsonb(p->>'title'));
    v_doc := public.pelham_tee_audit(v_doc, format('Title changed to ''%s''.', v_doc->>'title'), v_now);
  end if;

  if (p ? 'holes') and jsonb_typeof(p->'holes') <> 'null' then
    v_holes := (p->>'holes')::integer;
    if v_holes not in (9, 18) then
      perform public.pelham_fail('422', 'Holes must be 9 or 18.');
    end if;
  end if;
  if v_holes is not null and v_holes is distinct from (v_doc->>'holes')::integer then
    v_old_holes := (v_doc->>'holes')::integer;
    v_doc := jsonb_set(v_doc, '{holes}', to_jsonb(v_holes));
    -- 카트 요금이 아직 자동값이면 새 홀 수의 값으로 따라간다. 사람이 고친 금액과
    -- 이미 결제한 사람의 금액은 그대로 둔다 — 결제 뒤 금액이 바뀌면 재인쇄한
    -- 영수증이 받은 돈과 달라진다. (지금 요금표는 홀 수와 무관한 한 금액이라
    -- 값은 바뀌지 않는다. 홀 수별 요금이 돌아오면 이 규칙이 그때 일한다.)
    v_players := '[]'::jsonb;
    for pl in select value from jsonb_array_elements(coalesce(v_doc->'players', '[]'::jsonb)) loop
      if coalesce((pl->>'cart')::boolean, false)
         and not coalesce((pl->>'paid')::boolean, false)
         and public.pelham_same_money((pl->>'cartFee')::numeric,
                                      public.pelham_tee_cart_fee(pl->>'ratePlan', v_old_holes)) then
        pl := pl || jsonb_build_object('cartFee', public.pelham_tee_cart_fee(pl->>'ratePlan', v_holes));
      end if;
      v_players := v_players || pl;
    end loop;
    v_doc := jsonb_set(v_doc, '{players}', v_players);
    v_doc := public.pelham_tee_audit(v_doc, format('Holes set to %s.', v_holes), v_now);
  end if;

  if (p ? 'rate') and jsonb_typeof(p->'rate') <> 'null'
     and (p->>'rate')::numeric is distinct from (v_doc->>'rate')::numeric then
    v_val := (p->>'rate')::numeric;
    v_doc := jsonb_set(v_doc, '{rate}', to_jsonb(v_val));
    v_doc := public.pelham_tee_audit(
      v_doc, format('Rate set to $%s.', to_char(v_val, 'FM9999999990.00')), v_now);
  end if;

  if (p ? 'cartCount') and jsonb_typeof(p->'cartCount') <> 'null' then
    v_int := (p->>'cartCount')::integer;
    if v_int not between 0 and 4 then
      perform public.pelham_fail('422', 'Carts must be between 0 and 4.');
    end if;
    if v_int is distinct from (v_doc->>'cartCount')::integer then
      v_doc := jsonb_set(v_doc, '{cartCount}', to_jsonb(v_int));
      v_doc := public.pelham_tee_audit(v_doc, format('Cart count set to %s.', v_int), v_now);
    end if;
  end if;

  if (p ? 'color') and jsonb_typeof(p->'color') <> 'null' then
    v_txt := p->>'color';
    if v_txt not in ('blue', 'gold', 'gray') then
      perform public.pelham_fail('422', 'Colour must be blue, gold or gray.');
    end if;
    if v_txt <> v_doc->>'color' then
      v_doc := jsonb_set(v_doc, '{color}', to_jsonb(v_txt));
      v_doc := public.pelham_tee_audit(v_doc, format('Color set to %s.', v_txt), v_now);
    end if;
  end if;

  if (p ? 'span') and jsonb_typeof(p->'span') <> 'null' then
    v_int := (p->>'span')::integer;
    if v_int not between 1 and 7 then
      perform public.pelham_fail('422', 'Span must be between 1 and 7.');
    end if;
    if v_int is distinct from (v_doc->>'span')::integer then
      v_doc := jsonb_set(v_doc, '{span}', to_jsonb(v_int));
      v_doc := public.pelham_tee_audit(v_doc, format('Span set to %s.', v_int), v_now);
    end if;
  end if;

  if (p ? 'notes') and jsonb_typeof(p->'notes') <> 'null' and p->>'notes' <> v_doc->>'notes' then
    v_doc := jsonb_set(v_doc, '{notes}', to_jsonb(p->>'notes'));
    v_doc := public.pelham_tee_audit(v_doc, 'Notes updated.', v_now);
  end if;

  -- status 에는 일부러 "값이 달라졌을 때만" 이 없다. reserved 를 다시 눌러 예약을
  -- 초기 상태로 되돌리는 것이 직원의 실제 동작이기 때문이다.
  if (p ? 'status') and jsonb_typeof(p->'status') <> 'null' then
    v_status := p->>'status';
    if v_status not in ('reserved', 'checked_in', 'paid', 'cancelled', 'no_show', 'blocked') then
      perform public.pelham_fail('422', format('''%s'' is not a booking status', v_status));
    end if;
    -- 취소된 예약은 정원을 차지하지 않으므로 그사이 자리가 다른 예약에 팔릴 수 있다.
    -- 되살릴 때는 자리가 아직 남아 있는지 반드시 다시 확인한다.
    if v_doc->>'status' = 'cancelled' and v_status <> 'cancelled' then
      if (v_doc->>'date')::date <> v_new_date or v_doc->>'time' <> v_new_time then
        perform public.pelham_fail('409',
          'This reservation changed while it was being edited. Reload and try again.');
      end if;
      perform public.pelham_tee_require_capacity(
        (v_doc->>'date')::date, v_doc->>'time',
        jsonb_array_length(coalesce(v_doc->'players', '[]'::jsonb)), p_id);
    end if;
    v_applied := public.pelham_tee_apply_status(v_doc, v_status, p->>'cancelReason', v_now);
    v_doc := public.pelham_tee_audit(v_applied->'doc', v_applied->>'message', v_now);

  elsif p ? 'cancelReason' then
    -- status 없이 사유만 고치는 길. null 을 보내면 사유를 지운다(의미 있는 null).
    v_reason := p->>'cancelReason';
    v_doc := jsonb_set(v_doc, '{cancelReason}',
                       case when v_reason is null then 'null'::jsonb else to_jsonb(v_reason) end);
    v_doc := public.pelham_tee_audit(
      v_doc,
      case when v_reason is null or v_reason = '' then 'Cancellation reason cleared.'
           else format('Cancellation reason set to ''%s''.', v_reason) end,
      v_now);
  end if;

  perform public.pelham_tee_save(v_doc);
  return v_doc;
end;
$$;

-- 6) 예약 삭제. 되돌릴 수 없다 — 화면은 보통 취소(status=cancelled)를 쓴다.
create or replace function public.pelham_staff_booking_delete(p_id text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_doc jsonb;
begin
  perform public.pelham_require_staff();

  select t.doc into v_doc from public.pelham_tee_bookings t where t.id = p_id;
  if v_doc is null then
    perform public.pelham_fail('404', 'Booking not found');
  end if;

  perform public.pelham_tee_lock((v_doc->>'date')::date, v_doc->>'time');
  delete from public.pelham_tee_bookings t where t.id = p_id;
end;
$$;

-- 7) 플레이어 추가. 두 개의 서로 다른 한계를 구분한다.
--    1) 예약 하나가 담는 인원 = 4 → 422 (요청 자체가 모델 제약 위반)
--    2) 티타임 전체가 담는 인원 = 4 → 409 (다른 예약과의 자원 충돌)
--    순서가 중요하다: 둘 다 걸리면 422 를 돌려준다.
create or replace function public.pelham_staff_player_add(p_id text, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_doc jsonb;
  v_date date;
  v_time text;
  v_now text := public.pelham_iso(now());
  v_player jsonb;
begin
  perform public.pelham_require_staff();

  select t.doc into v_doc from public.pelham_tee_bookings t where t.id = p_id;
  if v_doc is null then
    perform public.pelham_fail('404', 'Booking not found');
  end if;
  v_date := (v_doc->>'date')::date;
  v_time := v_doc->>'time';

  perform public.pelham_tee_lock(v_date, v_time);

  select t.doc into v_doc from public.pelham_tee_bookings t where t.id = p_id;
  if v_doc is null then
    perform public.pelham_fail('404', 'Booking not found');
  end if;

  if jsonb_array_length(coalesce(v_doc->'players', '[]'::jsonb)) >= 4 then
    perform public.pelham_fail('422', 'A tee time can contain at most 4 players');
  end if;

  -- 취소된 예약은 자리를 잡지 않으므로 (2) 를 물어볼 이유가 없다. 물어보면
  -- "취소된 예약에 사람을 더할 수 있는가" 가 무관한 다른 예약의 인원수에 좌우된다.
  if v_doc->>'status' <> 'cancelled' then
    if (v_doc->>'date')::date <> v_date or v_doc->>'time' <> v_time then
      perform public.pelham_fail('409',
        'This reservation changed while it was being edited. Reload and try again.');
    end if;
    -- exclude 를 주지 않는다: taken 에 이 예약의 인원이 이미 들어가야 incoming=1 이 맞다.
    perform public.pelham_tee_require_capacity(v_date, v_time, 1, null);
  end if;

  v_player := public.pelham_tee_player(
    coalesce(p, '{}'::jsonb), (v_doc->>'holes')::integer, gen_random_uuid()::text, v_now);
  v_doc := jsonb_set(v_doc, '{players}', coalesce(v_doc->'players', '[]'::jsonb) || v_player);
  v_doc := public.pelham_tee_audit(v_doc, format('Player added: %s.', v_player->>'name'), v_now);

  perform public.pelham_tee_save(v_doc);
  return v_doc;
end;
$$;

-- 8) 플레이어 수정. 인원이 늘지 않으니 정원을 셀 필요가 없다.
create or replace function public.pelham_staff_player_patch(p_id text, p_player text, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_doc jsonb;
  v_now text := public.pelham_iso(now());
  v_old jsonb;
  v_merged jsonb;
  v_new jsonb;
  v_players jsonb := '[]'::jsonb;
  v_found boolean := false;
  v_holes integer;
  v_fee numeric;
  v_messages text[] := '{}';
  pl jsonb;
begin
  perform public.pelham_require_staff();

  select t.doc into v_doc from public.pelham_tee_bookings t where t.id = p_id;
  if v_doc is null then
    perform public.pelham_fail('404', 'Booking not found');
  end if;
  perform public.pelham_tee_lock((v_doc->>'date')::date, v_doc->>'time');
  select t.doc into v_doc from public.pelham_tee_bookings t where t.id = p_id;
  if v_doc is null then
    perform public.pelham_fail('404', 'Booking not found');
  end if;
  v_holes := (v_doc->>'holes')::integer;
  p := coalesce(p, '{}'::jsonb);

  for pl in select value from jsonb_array_elements(coalesce(v_doc->'players', '[]'::jsonb)) loop
    if v_found or pl->>'id' is distinct from p_player then
      v_players := v_players || pl;
      continue;
    end if;
    v_found := true;
    v_old := pl;

    -- null 이 아닌 값만 덮어쓴다 (`{k: v for k, v in fields.items() if v is not None}`).
    -- 모르는 키는 버린다 — 화면이 doc 에 임의의 필드를 심지 못하게.
    select v_old || coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
      into v_merged
      from jsonb_each(p) as e(k, v)
     where jsonb_typeof(e.v) <> 'null'
       and e.k in ('name', 'firstName', 'lastName', 'email', 'phone', 'type', 'ratePlan',
                   'arrived', 'paid', 'cancelled', 'no_show', 'cart', 'cartFee');

    -- 이름 재계산 규칙: first/last 가 오면 그게 진실, name 만 오면 쪼갠다.
    if (p ? 'firstName' and jsonb_typeof(p->'firstName') <> 'null')
       or (p ? 'lastName' and jsonb_typeof(p->'lastName') <> 'null') then
      v_merged := v_merged - 'name';
    elsif (p ? 'name') and jsonb_typeof(p->'name') <> 'null' then
      v_merged := v_merged || jsonb_build_object('firstName', '', 'lastName', '');
    end if;

    -- 새 플레이어와 같은 파생 규칙을 태우되, id 와 카트·결제는 아래에서 다시 정한다.
    v_new := public.pelham_tee_player(v_merged, v_holes, v_old->>'id', v_now);

    -- 카트: 켜면서 금액을 안 보냈으면 요금제·홀 수로 채운다. 요금제를 바꿨고 금액이
    -- 아직 옛 요금제의 자동값이면 따라간다(결제 전일 때만). 끄면 0 — 다시 켜면 새로 계산된다.
    if not ((p ? 'cartFee') and jsonb_typeof(p->'cartFee') <> 'null')
       and coalesce((v_new->>'cart')::boolean, false) then
      if not coalesce((v_old->>'cart')::boolean, false) then
        v_new := v_new || jsonb_build_object(
          'cartFee', public.pelham_tee_cart_fee(v_new->>'ratePlan', v_holes));
      elsif v_new->>'ratePlan' is distinct from v_old->>'ratePlan'
            and not coalesce((v_new->>'paid')::boolean, false)
            and public.pelham_same_money((v_old->>'cartFee')::numeric,
                                         public.pelham_tee_cart_fee(v_old->>'ratePlan', v_holes)) then
        v_new := v_new || jsonb_build_object(
          'cartFee', public.pelham_tee_cart_fee(v_new->>'ratePlan', v_holes));
      else
        v_new := v_new || jsonb_build_object('cartFee', (v_old->>'cartFee')::numeric);
      end if;
    end if;
    if not coalesce((v_new->>'cart')::boolean, false) then
      v_new := v_new || jsonb_build_object('cartFee', 0.00);
    end if;

    -- 결제 시각은 서버가 찍는다. 결제를 취소하면 지운다.
    if coalesce((v_new->>'paid')::boolean, false) and not coalesce((v_old->>'paid')::boolean, false) then
      v_new := v_new || jsonb_build_object('paidAt', v_now);
    elsif not coalesce((v_new->>'paid')::boolean, false) then
      v_new := v_new || jsonb_build_object('paidAt', null);
    else
      v_new := v_new || jsonb_build_object('paidAt', v_old->'paidAt');
    end if;

    v_players := v_players || v_new;

    -- 감사 문구: 돈·카트가 아닌 필드가 하나라도 오면 "Player updated".
    if exists (select 1 from jsonb_object_keys(p) k where k not in ('paid', 'cart', 'cartFee')) then
      v_messages := v_messages || format('Player updated: %s.', v_new->>'name');
    end if;
    if coalesce((v_new->>'cart')::boolean, false) is distinct from coalesce((v_old->>'cart')::boolean, false)
       or not public.pelham_same_money((v_new->>'cartFee')::numeric, (v_old->>'cartFee')::numeric) then
      v_fee := (v_new->>'cartFee')::numeric;
      v_messages := v_messages || (
        case
          when coalesce((v_new->>'cart')::boolean, false) and not coalesce((v_old->>'cart')::boolean, false)
            then format('Cart added for %s ($%s).', v_new->>'name', to_char(v_fee, 'FM9999999990.00'))
          when coalesce((v_new->>'cart')::boolean, false)
            then format('Cart fee for %s set to $%s.', v_new->>'name', to_char(v_fee, 'FM9999999990.00'))
          else format('Cart removed for %s.', v_new->>'name')
        end);
    end if;
    if coalesce((v_new->>'paid')::boolean, false) is distinct from coalesce((v_old->>'paid')::boolean, false) then
      v_messages := v_messages || (
        case when coalesce((v_new->>'paid')::boolean, false)
             then format('Payment recorded for %s.', v_new->>'name')
             else format('Payment cleared for %s.', v_new->>'name') end);
    end if;
  end loop;

  if not v_found then
    perform public.pelham_fail('404', 'Player not found');
  end if;

  v_doc := jsonb_set(v_doc, '{players}', v_players);
  v_doc := public.pelham_tee_audit(
    v_doc,
    coalesce(nullif(array_to_string(v_messages, ' '), ''), format('Player updated: %s.', v_new->>'name')),
    v_now);

  perform public.pelham_tee_save(v_doc);
  return v_doc;
end;
$$;

-- 9) 플레이어 삭제. 순서가 FastAPI 와 같다: 마지막 한 명 검사(422)가 "그런 사람
--    없음"(404)보다 먼저다 — 1인 예약에서 없는 id 를 지우면 422 가 나온다.
create or replace function public.pelham_staff_player_remove(p_id text, p_player text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_doc jsonb;
  v_now text := public.pelham_iso(now());
  v_players jsonb := '[]'::jsonb;
  v_removed jsonb;
  pl jsonb;
begin
  perform public.pelham_require_staff();

  select t.doc into v_doc from public.pelham_tee_bookings t where t.id = p_id;
  if v_doc is null then
    perform public.pelham_fail('404', 'Booking not found');
  end if;
  perform public.pelham_tee_lock((v_doc->>'date')::date, v_doc->>'time');
  select t.doc into v_doc from public.pelham_tee_bookings t where t.id = p_id;
  if v_doc is null then
    perform public.pelham_fail('404', 'Booking not found');
  end if;

  if jsonb_array_length(coalesce(v_doc->'players', '[]'::jsonb)) <= 1 then
    perform public.pelham_fail('422', 'A reservation must keep at least one player');
  end if;

  for pl in select value from jsonb_array_elements(coalesce(v_doc->'players', '[]'::jsonb)) loop
    if v_removed is null and pl->>'id' is not distinct from p_player then
      v_removed := pl;
    else
      v_players := v_players || pl;
    end if;
  end loop;

  if v_removed is null then
    perform public.pelham_fail('404', 'Player not found');
  end if;

  v_doc := jsonb_set(v_doc, '{players}', v_players);
  v_doc := public.pelham_tee_audit(v_doc, format('Player removed: %s.', v_removed->>'name'), v_now);

  perform public.pelham_tee_save(v_doc);
  return v_doc;
end;
$$;

-- 10) 하루 리포트.
create or replace function public.pelham_staff_report_daily(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pelham_require_staff();
  if p_date is null then
    perform public.pelham_fail('422', '''date'' must be an ISO date (YYYY-MM-DD)');
  end if;
  return public.pelham_tee_daily_report(p_date);
end;
$$;

-- 11) 기간 리포트. 날짜를 주지 않으면 **이번 주(월~일)** 다.
--     ⚠️ FastAPI 는 서버의 `date.today()` 를 썼다. 여기서는 0003 과 같이 클럽 현지
--        시간(America/Toronto)으로 오늘을 정한다 — Supabase 는 UTC 라서 서버 날짜를
--        그대로 쓰면 저녁 8시 이후에 "이번 주" 가 하루 앞서 간다.
create or replace function public.pelham_staff_report_week(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.pelham_local_now()::date;
  v_from date := coalesce(p_from, v_today - (extract(isodow from v_today)::integer - 1));
  v_to date;
  v_days jsonb := '[]'::jsonb;
  v_day jsonb;
  v_cursor date;
  v_revenue numeric := 0;
  v_collected numeric := 0;
  v_booked integer := 0;
  v_capacity integer := 0;
  v_tee_times integer := 0;
begin
  perform public.pelham_require_staff();
  v_to := coalesce(p_to, v_from + 6);

  if v_to < v_from then
    perform public.pelham_fail('422', '''to'' must not be before ''from''');
  end if;
  if v_to - v_from > 62 then
    perform public.pelham_fail('422', 'Week report range is limited to 62 days');
  end if;

  v_cursor := v_from;
  while v_cursor <= v_to loop
    v_day := public.pelham_tee_daily_report(v_cursor);
    v_days := v_days || v_day;
    -- 합계는 하루치의 **반올림된** 값을 더한다(FastAPI 와 같다).
    v_revenue := v_revenue + (v_day->>'total_revenue')::numeric;
    v_collected := v_collected + (v_day->>'collected_revenue')::numeric;
    v_booked := v_booked + (v_day->>'booked_slots')::integer;
    v_capacity := v_capacity + (v_day->>'total_slots')::integer;
    v_tee_times := v_tee_times + (v_day->>'total_tee_times')::integer;
    v_cursor := v_cursor + 1;
  end loop;

  return jsonb_build_object(
    'from', to_char(v_from, 'YYYY-MM-DD'),
    'to', to_char(v_to, 'YYYY-MM-DD'),
    'days', v_days,
    'summary', jsonb_build_object(
      'total_days', jsonb_array_length(v_days),
      'total_tee_times', v_tee_times,
      'total_booked_slots', v_booked,
      'total_revenue', round(v_revenue, 2),
      'collected_revenue', round(v_collected, 2),
      -- 하루치 점유율의 평균이 아니라 기간 전체의 자리 대비 예약이다.
      'average_occupancy', case when v_capacity = 0 then 0
                                else round(v_booked::numeric / v_capacity * 100, 2) end
    )
  );
end;
$$;

-- ===== 권한 ============================================================
-- Supabase 는 새 함수를 기본으로 누구에게나 실행하게 둔다. 내부 헬퍼는 전부 막고
-- (`from public, anon, authenticated` — 기본 권한이 명시적으로 부여돼 있을 수 있으므로
-- `public` 만 걷어 내면 모자란다), 직원용 열한 개만 authenticated 에 연다.
-- anon 은 어느 것도 부르지 못한다: 로그인하지 않은 브라우저는 PT401 도 아니고
-- 아예 함수가 없는 것처럼 막힌다.

revoke all on function public.pelham_is_staff() from public, anon, authenticated;
revoke all on function public.pelham_require_staff() from public, anon, authenticated;
revoke all on function public.pelham_tee_minutes(text) from public, anon, authenticated;
revoke all on function public.pelham_tee_require_slot(date, text) from public, anon, authenticated;
revoke all on function public.pelham_tee_split_name(text) from public, anon, authenticated;
revoke all on function public.pelham_tee_name(jsonb) from public, anon, authenticated;
revoke all on function public.pelham_tee_cart_fee(text, integer) from public, anon, authenticated;
revoke all on function public.pelham_same_money(numeric, numeric) from public, anon, authenticated;
revoke all on function public.pelham_tee_player(jsonb, integer, text, text) from public, anon, authenticated;
revoke all on function public.pelham_tee_audit(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.pelham_tee_seats(date, text, text) from public, anon, authenticated;
revoke all on function public.pelham_tee_require_capacity(date, text, integer, text) from public, anon, authenticated;
revoke all on function public.pelham_tee_lock(date, text) from public, anon, authenticated;
revoke all on function public.pelham_tee_save(jsonb) from public, anon, authenticated;
revoke all on function public.pelham_tee_apply_status(jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.pelham_tee_daily_report(date) from public, anon, authenticated;

revoke all on function public.pelham_staff_slots(date) from public, anon, authenticated;
revoke all on function public.pelham_staff_bookings(date, date) from public, anon, authenticated;
revoke all on function public.pelham_staff_booking(text) from public, anon, authenticated;
revoke all on function public.pelham_staff_booking_create(jsonb) from public, anon, authenticated;
revoke all on function public.pelham_staff_booking_patch(text, jsonb) from public, anon, authenticated;
revoke all on function public.pelham_staff_booking_delete(text) from public, anon, authenticated;
revoke all on function public.pelham_staff_player_add(text, jsonb) from public, anon, authenticated;
revoke all on function public.pelham_staff_player_patch(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.pelham_staff_player_remove(text, text) from public, anon, authenticated;
revoke all on function public.pelham_staff_report_daily(date) from public, anon, authenticated;
revoke all on function public.pelham_staff_report_week(date, date) from public, anon, authenticated;

grant execute on function public.pelham_staff_slots(date) to authenticated;
grant execute on function public.pelham_staff_bookings(date, date) to authenticated;
grant execute on function public.pelham_staff_booking(text) to authenticated;
grant execute on function public.pelham_staff_booking_create(jsonb) to authenticated;
grant execute on function public.pelham_staff_booking_patch(text, jsonb) to authenticated;
grant execute on function public.pelham_staff_booking_delete(text) to authenticated;
grant execute on function public.pelham_staff_player_add(text, jsonb) to authenticated;
grant execute on function public.pelham_staff_player_patch(text, text, jsonb) to authenticated;
grant execute on function public.pelham_staff_player_remove(text, text) to authenticated;
grant execute on function public.pelham_staff_report_daily(date) to authenticated;
grant execute on function public.pelham_staff_report_week(date, date) to authenticated;
