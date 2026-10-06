-- 분실물 접수대장. 음성 에이전트가 전화로 받아 적고, 프로 샵이 처리한다.
--
-- 왜 티켓 번호를 DB 가 만드나: 전화 중에 손님에게 번호를 읽어 줘야 하는데, 백엔드가
-- 여러 프로세스로 뜨면 파이썬에서 센 번호는 겹칠 수 있다. 시퀀스는 DB 가 보장한다.
--
-- 에이전트는 **접수만** 한다. "찾았습니다" 라고 먼저 말하지 않는다 — 물건을 실제로
-- 본 사람은 직원이고, 전화로 섣불리 희망을 주면 헛걸음을 만든다. 상태를 바꾸는 것은
-- 프로 샵 화면이고, 그때 손님에게 문자가 나간다.
--
-- 이름 규칙: 이 프로젝트는 다른 앱과 공유하는 DB 라 `pelham_` 접두사를 붙인다.

create sequence if not exists public.pelham_lost_item_seq start 401;

create table if not exists public.pelham_lost_items (
  id            uuid primary key default gen_random_uuid(),

  -- 손님에게 읽어 주는 번호. `LF-0401` 꼴.
  ticket        text not null unique
                default ('LF-' || lpad(nextval('public.pelham_lost_item_seq')::text, 4, '0')),

  item          text not null,          -- "rangefinder"
  description   text,                   -- "black Bushnell, grey case"
  lost_on       date,                   -- 잃어버린 날 (모르면 비운다)
  where_lost    text,                   -- "cart #34", "hole 12"

  -- 연락처. 찾으면 문자를 보내야 하므로 받는다.
  caller_phone  text,
  caller_name   text,

  -- searching: 접수됨 · found: 보관 중 · returned: 돌려줌 · closed: 못 찾고 종료
  status        text not null default 'searching',
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists pelham_lost_items_open_idx
  on public.pelham_lost_items (created_at desc) where status = 'searching';
create index if not exists pelham_lost_items_phone_idx
  on public.pelham_lost_items (caller_phone) where caller_phone is not null;

-- 개인정보(이름·전화)가 들어 있다. anon 키로 읽히면 안 된다.
alter table public.pelham_lost_items enable row level security;

comment on table public.pelham_lost_items is
  '분실물 접수. service_role 로만 접근한다. 접수는 음성 에이전트, 상태 변경은 프로 샵.';
