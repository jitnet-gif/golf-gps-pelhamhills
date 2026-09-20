-- ===== 0001_customers.sql =====
-- 고객(회원·퍼블릭) 명부. 원본은 Lightspeed/Chronogolf 대시보드의
-- `Customers > Export` CSV 이고, 임포터는 `scripts/import_customers_export.py` 다.
--
-- ⚠️ 이 테이블은 **실제 고객 개인정보**를 담는다 — 이름, 이메일, 전화, 주소,
-- 생년월일. `backend/services/customer_store.py` 와 같은 규칙을 따른다:
-- 레코드 내용을 로그·이슈에 붙이지 말 것.
--
-- 이름 규칙: 이 DB 는 다른 앱들과 **공유하는** Supabase 프로젝트다. `public` 에
-- 올리는 테이블·인덱스·함수는 전부 `pelham_` 접두사를 단다. 특히 함수는
-- `create or replace` 라서, 흔한 이름을 쓰면 다른 앱의 같은 이름 함수를
-- 조용히 덮어쓴다.
--
-- 소스 CSV 에서 **일부러 가져오지 않는 컬럼**:
--   Bag Number / Bank Account Last 4 / ACH Status / Bank Account Last Updated At
--     -> 500행 전부 비어 있다. 빈 컬럼을 만들지 않는다.
--   Credit Card Last 4 / Credit Card Expiry
--     -> 결제 수단 메타데이터다. 이 앱에 소비자가 없고, 두면 취급 범위만
--        넓어진다. "카드가 등록돼 있나" 라는 운영상 필요는 has_credit_card
--        불리언 하나로 충분하다.

create table if not exists public.pelham_customers (
  -- 소스의 `Customer Reference`. 500행에서 100% 고유해 자연키로 쓴다.
  customer_ref            text primary key,

  -- 이름. display_name 은 소스 표기 그대로, first/last 는 소스 컬럼 그대로 둔다.
  -- 별명과 `(Ws5)` 류 내부 태그는 clean_display_name 이 떼어내 따로 담는다.
  first_name              text,
  last_name               text,
  display_name            text,
  nickname                text,
  source_tags             text[] not null default '{}',

  -- 연락처. 정규화 값과 원본을 **둘 다** 남긴다. 정규화가 실패한 행
  -- (자릿수가 안 맞는 전화 등) 은 needs_review 로 넘어가고, 원본이 있어야
  -- 사람이 판단할 수 있다.
  email                   text,
  email_raw               text,
  phone                   text,
  phone_raw               text,

  gender                  text,
  date_of_birth           date,

  -- 회원 자격. player_role 은 소스 값 그대로, is_member 는 그로부터 유도한다.
  player_role             text,
  is_member               boolean not null default false,
  player_type             text,
  member_number           text,
  scoring_factor          numeric(4,1),

  -- 주소. 우편번호도 정규화 값과 원본을 둘 다 남긴다 (`L0S1E0` 같은 표기가 섞여 있다).
  address_line1           text,
  city                    text,
  state_code              text,
  country_code            text,
  postal_code             text,
  postal_code_raw         text,

  -- 계정 상태 플래그.
  activation_state        text,
  has_credit_card         boolean not null default false,
  prefers_mailed_statements boolean not null default false,
  hidden_from_tee_sheet   boolean not null default false,
  hidden_from_directory   boolean not null default false,

  rounds_booked_played    integer not null default 0,
  user_created_on         date,

  -- 사람이 봐야 하는 행. 정규화 실패, 이름 누락, 중복 의심 등.
  -- 중복은 **표시만 하고 합치지 않는다** — 부부가 유선 하나를 같이 쓰는 경우와
  -- 같은 사람이 두 번 등록된 경우를 기계가 구분할 수 없다.
  needs_review            boolean not null default false,
  review_reasons          text[] not null default '{}',
  possible_duplicate_of   text[] not null default '{}',

  -- 이 값이 어디서 왔는지. 임포터가 CSV 파일명·행수·내보낸 날짜를 적는다.
  source                  text not null default 'lightspeed_customers_export',
  provenance              jsonb not null default '{}'::jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- 조회 경로. 이메일·전화는 `customer_store.find_customer` 의 매칭 순서와 같다.
-- **unique 를 걸지 않는다**: 소스에 같은 번호를 쓰는 부부가 있고(Hagar, Umber,
-- Ridge), unique 를 걸면 임포트가 통째로 실패한다.
create index if not exists pelham_customers_email_idx on public.pelham_customers (email) where email is not null;
create index if not exists pelham_customers_phone_idx on public.pelham_customers (phone) where phone is not null;
create index if not exists pelham_customers_last_name_idx on public.pelham_customers (lower(last_name));
create index if not exists pelham_customers_is_member_idx on public.pelham_customers (is_member) where is_member;
create index if not exists pelham_customers_needs_review_idx on public.pelham_customers (needs_review) where needs_review;

-- updated_at 은 **내용이 실제로 바뀐 행에서만** 움직인다. 같은 CSV 를 다시
-- 임포트했을 때 500행 전부가 "변경됨"으로 찍히면 무엇이 진짜 바뀌었는지 알 수 없다.
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

drop trigger if exists pelham_customers_touch_updated_at on public.pelham_customers;
create trigger pelham_customers_touch_updated_at
  before update on public.pelham_customers
  for each row execute function public.pelham_touch_updated_at();

-- RLS. 이 테이블은 개인정보라 anon 키로 읽히면 안 된다. 정책을 하나도 만들지
-- 않으므로 anon/authenticated 는 아무 행도 볼 수 없고, 백엔드의
-- service_role 키만 RLS 를 우회해 접근한다 (`backend/services/db.py`).
-- 나중에 프로 샵 직원용 정책을 붙일 때 여기에 추가한다.
alter table public.pelham_customers enable row level security;

comment on table public.pelham_customers is
  '실고객 PII. service_role 로만 접근한다. 원본: Lightspeed Customers Export CSV.';


-- ===== 0002_tee_bookings.sql =====
-- 티 시트 예약. 지금까지는 `backend/data/tee_sheet.json` 한 파일이 원본이었고,
-- 이 테이블이 그 자리를 이어받는다 (`TEE_SHEET_BACKEND=supabase`).
-- 저장 계층은 `backend/services/tee_sheet_supabase.py`, 이관은
-- `scripts/migrate_tee_sheet_to_supabase.py` 다.
--
-- ⚠️ 플레이어 이름·전화·이메일과 음성 통화 기록이 들어간다. 0001 과 같은 PII 규칙.
--
-- 이름 규칙은 0001 과 같다: 공유 프로젝트라 전부 `pelham_` 접두사.
--
-- 설계: **인덱스용 컬럼 + 예약 전체를 담은 `doc`**.
--   `doc` 은 API 가 `TeeBooking.model_dump(mode="json")` 으로 만든 dict 를 그대로
--   담는다 — JSON 파일 저장소의 한 원소와 바이트 단위로 같다. 읽을 때는 `doc` 만
--   돌려준다. 나머지 컬럼은 저장 계층이 `doc` 에서 뽑아 적는 사본으로, 날짜·상태별
--   조회와 사람이 대시보드에서 훑어보는 용도다. 둘이 어긋나면 `doc` 이 맞다.
--   플레이어를 별도 테이블로 정규화하는 건 고객 연결이 필요해질 때 따로 한다 —
--   저장 엔진과 데이터 모델을 한 번에 바꾸면 동작 차이를 추적할 수 없다.

create table if not exists public.pelham_tee_bookings (
  id                text primary key,

  -- `doc` 에서 뽑은 사본. booking_date 만 not null (모든 예약에 날짜가 있다).
  booking_date      date not null,
  tee_time          text,             -- 슬롯 라벨 그대로, 예: '6:58 AM'
  status            text,             -- reserved / checked_in / paid / cancelled / no_show / blocked
  source            text,             -- staff / web / voice / voice_hold
  title             text,
  hold_expires_at   timestamptz,      -- voice_hold 에만 채워진다
  created_at        timestamptz,      -- doc.createdAt
  updated_at        timestamptz,      -- doc.updatedAt

  -- 원본. 읽기는 이것만 쓴다.
  doc               jsonb not null,

  -- 이 행이 DB 에 마지막으로 쓰인 시각. doc.updatedAt 과 달리 저장 계층이 찍는다.
  synced_at         timestamptz not null default now()
);

create index if not exists pelham_tee_bookings_date_idx
  on public.pelham_tee_bookings (booking_date);
create index if not exists pelham_tee_bookings_status_idx
  on public.pelham_tee_bookings (status);
create index if not exists pelham_tee_bookings_hold_idx
  on public.pelham_tee_bookings (hold_expires_at) where hold_expires_at is not null;

-- RLS. 0001 과 같다: 정책이 없으므로 anon/authenticated 는 아무 행도 못 본다.
-- 백엔드의 service_role 키만 RLS 를 우회해 읽고 쓴다. 공유 프로젝트의 다른 앱이
-- 쓰는 anon 키로는 이 테이블이 보이지 않는다.
alter table public.pelham_tee_bookings enable row level security;

comment on table public.pelham_tee_bookings is
  'Pelham Hills 티 시트 예약 (PII 포함). service_role 로만 접근한다. 원본 필드는 doc.';


-- PostgREST 스키마 캐시 새로고침 (새 테이블을 REST 로 바로 보이게)
notify pgrst, 'reload schema';
