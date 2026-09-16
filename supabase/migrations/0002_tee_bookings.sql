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
