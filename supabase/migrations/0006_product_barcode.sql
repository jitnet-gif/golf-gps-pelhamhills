-- 상품에 **바코드 칸**을 따로 둔다.
--
-- 왜: 지금까지는 공산품 바코드(UPC/EAN)를 SKU 칸에 넣어야 계산대 스캔이 찾았다. 그러면
-- 클럽이 쓰는 SKU(`GTR-591` 같은 사람이 읽는 코드)와 제조사 바코드 중 하나를 버려야 한다.
-- 2026-09-30: 상품 등록 창에서 바코드를 쏘았더니 커서가 있던 원가 칸에 숫자가 들어갔다.
-- 이제 바코드는 제 칸이 있고, 계산대는 SKU 또는 바코드로 찾는다.
--
-- 규칙
-- - 비어 있어도 된다(렌탈·로고 상품처럼 바코드가 없는 품목). 있으면 대소문자 무시로 유일하다.
-- - SKU 와는 따로 센다. 한 상품의 SKU 가 다른 상품의 바코드와 같아도 막지는 않는다 —
--   계산대는 바코드를 먼저 보고, 없으면 SKU 를 본다.
--
-- 전제: 0005. 실행: SQL editor 에 이 파일 전체를 붙여 한 번. 다시 실행해도 안전하다.

do $$
begin
  if to_regprocedure('public.pelham_staff_pos_product_create(jsonb)') is null then
    raise exception '0006 needs 0005 first (pelham_staff_pos_product_create is missing).';
  end if;
end;
$$;

alter table public.pelham_retail_products add column if not exists barcode text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pelham_retail_products_barcode_check') then
    alter table public.pelham_retail_products add constraint pelham_retail_products_barcode_check
      check (barcode is null or barcode ~ '^[A-Za-z0-9./-]{1,64}$');
  end if;
end;
$$;

create unique index if not exists pelham_retail_products_barcode_key
  on public.pelham_retail_products (lower(barcode)) where barcode is not null;

-- 아래 네 함수는 0005 와 같고, 바코드를 읽고 쓰는 줄만 더했다.

create or replace function public.pelham_pos_product_json(p public.pelham_retail_products)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'sku', p.sku,
    'barcode', p.barcode,
    'name', p.name,
    'category', p.category,
    'price', p.price,
    'cost', p.cost,
    'stock', p.stock,
    'reorder_point', p.reorder_point,
    'is_active', p.is_active,
    'created_at', public.pelham_iso(p.created_at),
    'updated_at', public.pelham_iso(p.updated_at)
  )
$$;

create or replace function public.pelham_pos_check_product(p jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p ? 'category' and (p->>'category') not in
     ('Apparel', 'Equipment', 'Balls', 'Accessories', 'Food & Beverage', 'Rentals') then
    perform public.pelham_fail('422', format('''%s'' is not a product category', p->>'category'));
  end if;
  if p ? 'price' and coalesce((p->>'price')::integer, -1) < 0 then
    perform public.pelham_fail('422', 'Price must be zero or more (cents).');
  end if;
  if p ? 'cost' and coalesce((p->>'cost')::integer, 0) < 0 then
    perform public.pelham_fail('422', 'Cost cannot be negative.');
  end if;
  if p ? 'stock' and jsonb_typeof(p->'stock') <> 'null' and (p->>'stock')::integer < 0 then
    perform public.pelham_fail('422', 'Stock cannot be negative. Leave it empty for rentals.');
  end if;
  if p ? 'sku' and length(btrim(coalesce(p->>'sku', ''))) not between 1 and 64 then
    perform public.pelham_fail('422', 'SKU must be 1–64 characters.');
  end if;
  -- 바코드: 비우면 null(바코드 없는 상품). 스캐너가 읽는 글자만(영숫자·하이픈·점·슬래시).
  if p ? 'barcode' and jsonb_typeof(p->'barcode') = 'string' and btrim(p->>'barcode') <> ''
     and btrim(p->>'barcode') !~ '^[A-Za-z0-9./-]{1,64}$' then
    perform public.pelham_fail('422', 'Barcode must be 1–64 letters, digits, "-", "." or "/".');
  end if;
  if p ? 'name' and length(btrim(coalesce(p->>'name', ''))) not between 1 and 120 then
    perform public.pelham_fail('422', 'Name must be 1–120 characters.');
  end if;
end;
$$;

create or replace function public.pelham_staff_pos_product_create(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pelham_retail_products;
  v_stock integer;
  v_barcode text;
begin
  perform public.pelham_require_staff();
  p := coalesce(p, '{}'::jsonb);
  if not (p ? 'sku' and p ? 'name' and p ? 'category' and p ? 'price') then
    perform public.pelham_fail('422', 'sku, name, category and price are required.');
  end if;
  perform public.pelham_pos_check_product(p);
  if exists (select 1 from public.pelham_retail_products
              where lower(btrim(sku)) = lower(btrim(p->>'sku'))) then
    perform public.pelham_fail('409', format('SKU %s already exists.', btrim(p->>'sku')));
  end if;

  v_barcode := nullif(btrim(coalesce(p->>'barcode', '')), '');
  if v_barcode is not null and exists (select 1 from public.pelham_retail_products
                                        where lower(barcode) = lower(v_barcode)) then
    perform public.pelham_fail('409', format('Barcode %s is already on another product.', v_barcode));
  end if;

  v_stock := case when jsonb_typeof(p->'stock') in ('number', 'string') then (p->>'stock')::integer end;
  insert into public.pelham_retail_products (sku, barcode, name, category, price, cost, stock, reorder_point, is_active)
  values (btrim(p->>'sku'), v_barcode, btrim(p->>'name'), p->>'category', (p->>'price')::integer,
          coalesce((p->>'cost')::integer, 0),
          -- 원장의 출발점은 아래 'initial' 이동이다. 여기서는 0(또는 null)으로 넣는다.
          case when v_stock is null then null else 0 end,
          coalesce((p->>'reorder_point')::integer, 0),
          coalesce((p->>'is_active')::boolean, true))
  returning * into v;

  if v_stock is not null and v_stock <> 0 then
    perform public.pelham_pos_move(v.id, v_stock, 'initial', null, 'Stock when the product was added');
  end if;
  select * into v from public.pelham_retail_products where id = v.id;
  return public.pelham_pos_product_json(v);
end;
$$;

create or replace function public.pelham_staff_pos_product_update(p_id integer, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pelham_retail_products;
  v_new_stock integer;
begin
  perform public.pelham_require_staff();
  p := coalesce(p, '{}'::jsonb);
  perform public.pelham_pos_check_product(p);

  select * into v from public.pelham_retail_products where id = p_id for update;
  if v.id is null then
    perform public.pelham_fail('404', 'Product not found');
  end if;
  if p ? 'sku' and exists (select 1 from public.pelham_retail_products
                            where lower(btrim(sku)) = lower(btrim(p->>'sku')) and id <> p_id) then
    perform public.pelham_fail('409', format('SKU %s already exists.', btrim(p->>'sku')));
  end if;

  if p ? 'barcode' and nullif(btrim(coalesce(p->>'barcode', '')), '') is not null
     and exists (select 1 from public.pelham_retail_products
                  where lower(barcode) = lower(btrim(p->>'barcode')) and id <> p_id) then
    perform public.pelham_fail('409', format('Barcode %s is already on another product.', btrim(p->>'barcode')));
  end if;

  update public.pelham_retail_products
     set sku = case when p ? 'sku' then btrim(p->>'sku') else sku end,
         barcode = case when p ? 'barcode' then nullif(btrim(coalesce(p->>'barcode', '')), '') else barcode end,
         name = case when p ? 'name' then btrim(p->>'name') else name end,
         category = coalesce(p->>'category', category),
         price = coalesce((p->>'price')::integer, price),
         cost = coalesce((p->>'cost')::integer, cost),
         reorder_point = coalesce((p->>'reorder_point')::integer, reorder_point),
         is_active = coalesce((p->>'is_active')::boolean, is_active),
         updated_at = now()
   where id = p_id;

  if p ? 'stock' then
    if jsonb_typeof(p->'stock') = 'null' then
      -- 재고 추적을 끈다(렌탈로 바꿈). 원장은 남는다.
      update public.pelham_retail_products set stock = null, updated_at = now() where id = p_id;
    else
      v_new_stock := (p->>'stock')::integer;
      if v.stock is null then
        -- 추적을 새로 켠다. 0 에서 출발해 'initial' 로 채운다.
        update public.pelham_retail_products set stock = 0 where id = p_id;
        perform public.pelham_pos_move(p_id, v_new_stock, 'initial', null, 'Stock tracking turned on');
      else
        perform public.pelham_pos_move(p_id, v_new_stock - v.stock, 'adjust', null, 'Edited on the Products tab');
      end if;
    end if;
  end if;

  select * into v from public.pelham_retail_products where id = p_id;
  return public.pelham_pos_product_json(v);
end;
$$;

-- 권한은 0005 에서 준 그대로다(`create or replace` 는 권한을 바꾸지 않는다).
