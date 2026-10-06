-- 티타임 대기자 명단. 자리가 비면 먼저 기다린 사람에게 문자가 간다.
--
-- 왜 필요한가: 취소된 자리는 아무도 모르면 그냥 빈다. 대기자에게 자동으로 알리면
-- 사람 손을 거치지 않고 다시 팔린다.
--
-- 2026-10-06 변경: 이제 자리를 **15분 잡아 두고** 문자를 보낸다. YES 면 예약, 답이
-- 없으면 다음 사람 (`backend/services/waitlist_offers.py`). 열은 그대로 쓰므로 이 파일을
-- 다시 실행할 필요는 없다. 아래 `comment on table` 문구만 옛 설명이다.
--
-- 문자를 보내려면 번호를 보관해야 하므로, 손님이 **먼저 요청했을 때만** 넣는다.
-- `consented_at` 에 그 시각을 남긴다.

create table if not exists public.pelham_tee_waitlist (
  id            uuid primary key default gen_random_uuid(),

  date          date not null,
  -- 원하는 시간대. 비어 있으면 그날 아무 때나 괜찮다는 뜻이다.
  earliest      text,                   -- "9:00 AM"
  latest        text,                   -- "11:30 AM"
  party_size    integer not null,
  holes         integer not null default 18,

  first_name    text,
  last_name     text not null,
  phone         text not null,

  -- waiting: 기다리는 중 · offered: 자리를 알렸음 · booked: 예약함
  -- expired: 답이 없어 넘어감 · cancelled: 손님이 뺐음
  status        text not null default 'waiting',
  offered_time  text,                   -- 어느 티타임을 알렸는지
  offered_at    timestamptz,

  -- 문자 수신 동의 시각. 손님이 대기자 등록을 요청한 그 순간이다.
  consented_at  timestamptz not null default now(),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 자리가 비면 "그날 기다리는 사람"을 먼저 온 순서로 찾는다.
create index if not exists pelham_tee_waitlist_open_idx
  on public.pelham_tee_waitlist (date, created_at) where status = 'waiting';
create index if not exists pelham_tee_waitlist_phone_idx
  on public.pelham_tee_waitlist (phone);

alter table public.pelham_tee_waitlist enable row level security;

comment on table public.pelham_tee_waitlist is
  '티타임 대기자. service_role 로만 접근한다. 자리를 잠그지 않는다 — 알림만 보낸다.';
