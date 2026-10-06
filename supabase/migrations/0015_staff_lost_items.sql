-- 분실물 직원 화면(`/admin/lost-items`). 0013 이 만든 접수대장을 프로 샵이 보고 고친다.
--
-- 0013 은 "상태 변경은 프로 샵 화면, 그때 손님에게 문자" 라고 적어 두기만 했다. 이 파일이
-- 그 반쪽을 채운다:
--
-- 1. `pelham_staff_lost_items*` — 목록·직접 접수·상태 변경. 다른 직원 함수와 같이
--    로그인한 직원만 부른다(`pelham_require_staff`).
-- 2. `notified_at` / `notify_status` — "찾았습니다" 문자를 보냈는지. 문자는 DB 가 아니라
--    백엔드의 1분 루프(`backend/services/lost_item_notices.py`)가 보낸다: 정적 사이트에는
--    Twilio 키를 둘 곳이 없다. 루프는 `status = 'found' and notified_at is null` 인 줄을
--    집어 간다.
--
-- 같은 물건을 "찾음" 으로 두 번 바꿔도 문자는 한 번만 간다 — `notified_at` 은 상태를
-- 되돌려도 지우지 않는다. 다시 보내는 것은 직원이 "Resend text" 를 눌렀을 때뿐이다.

alter table public.pelham_lost_items
  add column if not exists notified_at   timestamptz,
  -- sent · failed · skipped(수신 거부/Twilio 미설정) · 비어 있음(아직 안 보냄)
  add column if not exists notify_status text,
  add column if not exists notify_error  text;

-- 루프가 1분마다 찾는 줄. 거의 항상 비어 있다.
create index if not exists pelham_lost_items_notify_idx
  on public.pelham_lost_items (updated_at)
  where status = 'found' and notified_at is null;

-- ===== 헬퍼 ==============================================================

create or replace function public.pelham_lost_item_json(r public.pelham_lost_items)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'ticket', r.ticket,
    'item', r.item,
    'description', r.description,
    'lost_on', r.lost_on,
    'where_lost', r.where_lost,
    'caller_name', r.caller_name,
    'caller_phone', r.caller_phone,
    'status', r.status,
    'notes', r.notes,
    'notified_at', r.notified_at,
    'notify_status', r.notify_status,
    'notify_error', r.notify_error,
    'created_at', r.created_at,
    'updated_at', r.updated_at
  )
$$;

-- ===== 직원 함수 =========================================================

-- 목록. 새로 접수된 것이 위. `p_status` 가 비면 전부(최근 300건).
create or replace function public.pelham_staff_lost_items(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.pelham_require_staff();
  return coalesce((
    select jsonb_agg(public.pelham_lost_item_json(r) order by r.created_at desc)
      from (
        select * from public.pelham_lost_items l
         where p_status is null or btrim(p_status) = '' or l.status = p_status
         order by l.created_at desc
         limit 300
      ) r
  ), '[]'::jsonb);
end;
$$;

-- 카운터에서 직접 받는 접수(손님이 들렀을 때). 전화 접수와 같은 표·같은 티켓 번호를 쓴다.
create or replace function public.pelham_staff_lost_item_create(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.pelham_lost_items;
  v_item text := btrim(coalesce(p->>'item', ''));
begin
  perform public.pelham_require_staff();
  if v_item = '' then
    perform public.pelham_fail('422', 'Say what was lost.');
  end if;
  insert into public.pelham_lost_items (item, description, lost_on, where_lost, caller_name, caller_phone, notes)
  values (
    v_item,
    nullif(btrim(coalesce(p->>'description', '')), ''),
    nullif(btrim(coalesce(p->>'lost_on', '')), '')::date,
    nullif(btrim(coalesce(p->>'where_lost', '')), ''),
    nullif(btrim(coalesce(p->>'caller_name', '')), ''),
    nullif(btrim(coalesce(p->>'caller_phone', '')), ''),
    nullif(btrim(coalesce(p->>'notes', '')), '')
  )
  returning * into r;
  return public.pelham_lost_item_json(r);
end;
$$;

-- 상태·메모 바꾸기. `p` 에 있는 키만 바꾼다.
--   status : searching · found · returned · closed
--   notes  : 보관 위치 등 직원 메모
--   resend : true 면 "찾았습니다" 문자를 다시 보낸다(찾음 상태일 때만)
create or replace function public.pelham_staff_lost_item_update(p_id uuid, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.pelham_lost_items;
  v_status text := nullif(btrim(coalesce(p->>'status', '')), '');
begin
  perform public.pelham_require_staff();
  if v_status is not null and v_status not in ('searching', 'found', 'returned', 'closed') then
    perform public.pelham_fail('422', format('''%s'' is not a lost item status', v_status));
  end if;

  select * into r from public.pelham_lost_items where id = p_id for update;
  if r.id is null then
    perform public.pelham_fail('404', 'No such lost item');
  end if;

  if coalesce((p->>'resend')::boolean, false) then
    if coalesce(v_status, r.status) <> 'found' then
      perform public.pelham_fail('409', 'Only a found item can be texted.');
    end if;
    r.notified_at := null;
    r.notify_status := null;
    r.notify_error := null;
  end if;

  update public.pelham_lost_items
     set status        = coalesce(v_status, status),
         notes         = case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes', '')), '') else notes end,
         notified_at   = r.notified_at,
         notify_status = r.notify_status,
         notify_error  = r.notify_error,
         updated_at    = now()
   where id = p_id
  returning * into r;
  return public.pelham_lost_item_json(r);
end;
$$;

-- ===== 권한 ==============================================================

revoke all on function public.pelham_lost_item_json(public.pelham_lost_items) from public, anon, authenticated;

revoke all on function public.pelham_staff_lost_items(text) from public, anon, authenticated;
revoke all on function public.pelham_staff_lost_item_create(jsonb) from public, anon, authenticated;
revoke all on function public.pelham_staff_lost_item_update(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.pelham_staff_lost_items(text) to authenticated;
grant execute on function public.pelham_staff_lost_item_create(jsonb) to authenticated;
grant execute on function public.pelham_staff_lost_item_update(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
