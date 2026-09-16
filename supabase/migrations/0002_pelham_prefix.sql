-- 0001 첫 판(접두사 없는 `customers`)이 이미 실행된 DB 를 `pelham_` 이름으로 옮긴다.
--
-- 왜: 이 Supabase 프로젝트는 다른 앱들(SMEAG 학사, 매장 메뉴 등)과 공유된다.
-- 0001 첫 판은 `public.customers` 와 `public.touch_updated_at()` 을 만들었는데 둘 다
-- 흔한 이름이다. 특히 함수는 `create or replace` 라서, 같은 이름이 이미 있었다면
-- 조용히 덮어썼다. 아래 마지막 블록이 그 흔적을 확인한다.
--
-- 새 DB 에서는 아무 일도 하지 않는다: 0001 현재 판이 처음부터 `pelham_` 로 만든다.
-- `public.customers` 는 **우리 테이블일 때만** 옮긴다 — 다른 앱의 customers 를
-- 건드리지 않도록 우리만 가진 컬럼 두 개로 확인한다.
--
-- 행을 복사하지 않고 테이블 이름을 바꾼다. 500행, created_at, RLS, 코멘트가
-- 그대로 따라온다. 다시 임포트할 필요가 없다.

create or replace function public.pelham_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.pelham_customers') is null
     and (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'customers'
             and column_name in ('customer_ref', 'possible_duplicate_of')) = 2
  then
    alter table public.customers rename to pelham_customers;
    -- 제약 이름을 바꾸면 그 제약이 쓰는 인덱스 이름도 같이 바뀐다.
    alter table public.pelham_customers rename constraint customers_pkey to pelham_customers_pkey;
    alter index if exists public.customers_email_idx       rename to pelham_customers_email_idx;
    alter index if exists public.customers_phone_idx       rename to pelham_customers_phone_idx;
    alter index if exists public.customers_last_name_idx   rename to pelham_customers_last_name_idx;
    alter index if exists public.customers_is_member_idx   rename to pelham_customers_is_member_idx;
    alter index if exists public.customers_needs_review_idx rename to pelham_customers_needs_review_idx;
    drop trigger if exists customers_touch_updated_at on public.pelham_customers;
    raise notice 'public.customers -> public.pelham_customers 로 옮겼다';
  end if;
end;
$$;

drop trigger if exists pelham_customers_touch_updated_at on public.pelham_customers;
create trigger pelham_customers_touch_updated_at
  before update on public.pelham_customers
  for each row execute function public.pelham_touch_updated_at();

-- 첫 판이 만든(또는 덮어쓴) public.touch_updated_at() 정리.
-- 우리 트리거는 위에서 이미 떼어 냈으므로, 여기서 이 함수를 쓰는 트리거가 남아
-- 있다면 **다른 앱의 것**이다. 그 경우 지우지 않고 경고만 낸다 — 지우면 그 앱의
-- 트리거가 깨지고, 첫 판이 원래 본문을 덮어썼을 수 있으니 사람이 봐야 한다.
-- 트리거 함수는 트리거로만 쓰이므로, 쓰는 트리거가 없으면 지워도 안전하다.
do $$
declare
  users text;
begin
  if to_regprocedure('public.touch_updated_at()') is null then
    return;
  end if;
  select string_agg(tgrelid::regclass::text, ', ')
    into users
    from pg_trigger
   where tgfoid = 'public.touch_updated_at()'::regprocedure;
  if users is null then
    drop function public.touch_updated_at();
    raise notice 'public.touch_updated_at() 를 지웠다 — 쓰는 트리거가 없었다';
  else
    raise warning 'public.touch_updated_at() 를 다른 테이블이 쓰고 있다: %. 지우지 않았다. 0001 첫 판이 이 함수 본문을 덮어썼을 수 있으니 확인할 것.', users;
  end if;
end;
$$;
