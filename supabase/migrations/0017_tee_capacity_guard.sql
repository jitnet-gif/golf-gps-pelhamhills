-- 한 티타임에 4명을 넘게 넣는 쓰기를 **DB 가** 거절한다.
--
-- 왜(2026-10-06): 한 티타임은 4자리이고, 다른 일행과 나눠 쓸 수 있다. 정원 검사는 지금까지
-- 쓰는 쪽마다 따로 했다.
-- - 웹 예약·손님 변경·직원 화면(0003·0004·0012 의 SQL 함수): `pelham_tee:<날짜> <시각>`
--   잠금을 잡고 센 뒤 쓴다.
-- - 전화·문자 비서·대기자 제안(Fly 백엔드): PostgREST 로 읽어 Python 에서 세고 통째로
--   upsert 한다. 잠금은 프로세스 안의 RLock 뿐이라 위 잠금을 기다리지 않는다.
-- 그래서 웹 손님과 전화 손님이 같은 9:10 을 동시에 잡으면 둘 다 "자리 있음" 을 보고 7명이
-- 들어갈 수 있었다. 홀드가 막 만료된 순간 확정하는 경우, 직원이 취소한 예약을 백엔드가
-- 옛 내용으로 덮어 되살리는 경우도 같다.
--
-- 이 트리거는 누가 어떤 길로 쓰든 마지막에 한 번 더 센다:
-- - 같은 잠금 키를 잡는다. 이미 그 잠금을 잡은 SQL 함수 안에서는 그대로 통과한다(재진입).
-- - AFTER ROW 라서 같은 명령이 함께 넣은 줄(대기자 홀드 여러 개를 한 번에 upsert)도 센다.
-- - 무엇이 자리를 차지하는지는 `pelham_tee_seats`(0004)와 같다: 취소·만료된 홀드는 빠진다.
-- - 이 줄이 그 티타임에서 차지하는 자리가 **늘어날 때만** 검사한다. 이미 4명을 넘긴 옛
--   기록도 인원을 줄이거나 메모를 고치는 것은 막지 않는다.
-- - 막히면 `PT409` → PostgREST 가 HTTP 409 로 돌려준다. 웹 화면은 이미 409 에서 목록을
--   다시 불러오고, 백엔드는 `bookings_tx` 에서 같은 409 로 바꾼다.
--
-- 막힌 슬롯(`status = 'blocked'`)은 여기서 보지 않는다. 직원이 막힌 시간에 일부러 넣는 경우가
-- 있어 정원과는 다른 규칙이다.
--
-- 전제: 0004. 실행: SQL editor 에 이 파일 전체를 붙여 한 번. 다시 실행해도 안전하다.

create or replace function public.pelham_tee_capacity_guard()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_seats integer;
  v_old   integer := 0;
  v_taken integer;
begin
  -- 이 줄이 지금 자리를 차지하지 않으면 볼 것이 없다(취소·만료 홀드·시각 없음).
  if new.booking_date is null or new.tee_time is null
     or coalesce(new.status, '') = 'cancelled'
     or (new.hold_expires_at is not null and new.hold_expires_at <= now()) then
    return null;
  end if;
  v_seats := jsonb_array_length(coalesce(new.doc->'players', '[]'::jsonb));
  if v_seats = 0 then
    return null;
  end if;

  -- 같은 티타임에서 원래도 자리를 차지했고 인원이 늘지 않았다면 통과.
  -- 홀드였던 줄은 늘 다시 센다: `now()` 는 트랜잭션 시작 시각이라, 만료 직전에 시작한 확정과
  -- 만료 직후에 시작한 웹 예약이 서로를 세지 않고 둘 다 통과할 수 있다. 홀드는 몇 건뿐이다.
  if tg_op = 'UPDATE'
     and old.booking_date = new.booking_date
     and old.tee_time = new.tee_time
     and coalesce(old.status, '') <> 'cancelled'
     and old.hold_expires_at is null then
    v_old := jsonb_array_length(coalesce(old.doc->'players', '[]'::jsonb));
    if v_seats <= v_old then
      return null;
    end if;
  end if;

  -- 잠금 뒤의 문장은 새 스냅숏으로 읽는다: 먼저 잠금을 쥐었던 쪽이 커밋한 줄까지 보인다.
  perform pg_advisory_xact_lock(
    hashtext('pelham_tee:' || new.booking_date::text || ' ' || new.tee_time));
  select coalesce(sum(jsonb_array_length(coalesce(t.doc->'players', '[]'::jsonb))), 0)::integer
    into v_taken
    from public.pelham_tee_bookings t
   where t.booking_date = new.booking_date
     and t.tee_time = new.tee_time
     and coalesce(t.status, '') <> 'cancelled'
     and (t.hold_expires_at is null or t.hold_expires_at > now());

  if v_taken > 4 then
    raise exception using
      errcode = 'PT409',
      message = format(
        '%s on %s only holds 4 players; %s are already taken and %s more were requested',
        new.tee_time, to_char(new.booking_date, 'YYYY-MM-DD'),
        v_taken - v_seats, v_seats);
  end if;
  return null;
end;
$$;

revoke all on function public.pelham_tee_capacity_guard() from public, anon, authenticated;

drop trigger if exists pelham_tee_capacity_guard on public.pelham_tee_bookings;
create trigger pelham_tee_capacity_guard
  after insert or update on public.pelham_tee_bookings
  for each row execute function public.pelham_tee_capacity_guard();

notify pgrst, 'reload schema';
