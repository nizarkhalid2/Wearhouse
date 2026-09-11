-- WAREHOUSE PERSISTENCE-SAFE MIGRATION
-- Safe to run on an existing project.
-- IMPORTANT: This file NEVER deletes products, serial numbers, delivery requests, or user data.
-- Existing inventory stays in the database unless an admin explicitly deletes it from the site.

create extension if not exists pgcrypto;


-- 0) Stable read access so inventory does not "disappear" after future migrations.
--    These statements change permissions only; they do not touch stored rows.
alter table public.products enable row level security;
alter table public.inventory_units enable row level security;

grant select on public.products to anon, authenticated;
grant select on public.inventory_units to authenticated;

drop policy if exists "warehouse products always readable" on public.products;
create policy "warehouse products always readable"
on public.products for select
using (true);

create or replace function public.is_delivery()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and not exists (
        select 1 from public.admin_users a where a.user_id = p.id
      )
  );
$$;

grant execute on function public.is_delivery() to authenticated;

drop policy if exists "warehouse staff read serials" on public.inventory_units;
create policy "warehouse staff read serials"
on public.inventory_units for select to authenticated
using (public.is_admin() or public.is_delivery());

-- 1) Keep displayed product quantity synchronized with ACTIVE serialized stock.
--    Delivered serials remain stored for history, but no longer count as warehouse stock.
create or replace function public.sync_product_quantity_from_units()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_product_id uuid;
  old_product_id uuid;
begin
  if tg_op = 'DELETE' then
    old_product_id := old.product_id;
  else
    new_product_id := new.product_id;
  end if;

  if tg_op = 'UPDATE' then
    old_product_id := old.product_id;
  end if;

  if new_product_id is not null then
    update public.products p
    set quantity = (
      select count(*)::integer
      from public.inventory_units u
      where u.product_id = new_product_id
        and u.status <> 'delivered'
    )
    where p.id = new_product_id;
  end if;

  if old_product_id is not null
     and old_product_id is distinct from new_product_id then
    update public.products p
    set quantity = (
      select count(*)::integer
      from public.inventory_units u
      where u.product_id = old_product_id
        and u.status <> 'delivered'
    )
    where p.id = old_product_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists inventory_units_sync_product_quantity on public.inventory_units;
create trigger inventory_units_sync_product_quantity
after insert or delete or update of status, product_id
on public.inventory_units
for each row execute function public.sync_product_quantity_from_units();

-- Repair the DISPLAYED quantities from serials that already exist.
-- This updates only quantity numbers; it does not delete or recreate anything.
update public.products p
set quantity = (
  select count(*)::integer
  from public.inventory_units u
  where u.product_id = p.id
    and u.status <> 'delivered'
)
where exists (
  select 1 from public.inventory_units x where x.product_id = p.id
);

-- 2) Atomic product creation: product + all serial numbers succeed together or nothing changes.
--    A duplicate serial can no longer create/delete a half-finished item.
create or replace function public.create_product_with_serials(
  p_name text,
  p_description text default '',
  p_location text default 'A-01',
  p_category text default 'General',
  p_price numeric default 0,
  p_image_url text default '',
  p_serials text[] default '{}'::text[]
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.products;
  clean_serials text[];
  duplicate_serial text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select coalesce(array_agg(distinct btrim(s)), '{}'::text[])
  into clean_serials
  from unnest(coalesce(p_serials, '{}'::text[])) as s
  where btrim(s) <> '';

  if cardinality(clean_serials) = 0 then
    raise exception 'Add at least one serial number';
  end if;

  select u.serial_number
  into duplicate_serial
  from public.inventory_units u
  where u.serial_number = any(clean_serials)
  limit 1;

  if duplicate_serial is not null then
    raise exception 'Serial already exists: %', duplicate_serial;
  end if;

  insert into public.products(
    name, description, quantity, location, category, price, image_url
  ) values (
    btrim(coalesce(p_name, '')),
    coalesce(p_description, ''),
    cardinality(clean_serials),
    coalesce(nullif(btrim(p_location), ''), 'A-01'),
    coalesce(nullif(btrim(p_category), ''), 'General'),
    greatest(coalesce(p_price, 0), 0),
    coalesce(p_image_url, '')
  )
  returning * into r;

  insert into public.inventory_units(product_id, serial_number, status)
  select r.id, s, 'available'
  from unnest(clean_serials) as s;

  select * into r from public.products where id = r.id;
  return r;
end;
$$;

revoke all on function public.create_product_with_serials(text,text,text,text,numeric,text,text[]) from public;
grant execute on function public.create_product_with_serials(text,text,text,text,numeric,text,text[]) to authenticated;

-- 3) Final delivery approval keeps the serial in history as DELIVERED.
--    The quantity trigger above removes it from active inventory automatically.
create or replace function public.complete_delivery_request(request_id uuid)
returns public.delivery_requests
language plpgsql
security definer
set search_path = public
as $$
declare r public.delivery_requests;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into r
  from public.delivery_requests
  where id = request_id
  for update;

  if r.id is null then raise exception 'Delivery request not found'; end if;
  if r.status <> 'delivery_note_submitted' then
    raise exception 'Delivery note must be submitted first';
  end if;

  update public.inventory_units
  set status = 'delivered'
  where id = r.unit_id
    and status in ('reserved','out_for_delivery');

  if not found then
    raise exception 'Inventory unit is not reserved/out for delivery';
  end if;

  update public.delivery_requests
  set status = 'completed',
      completed_at = now(),
      completed_by = auth.uid()
  where id = request_id
  returning * into r;

  insert into public.notifications(recipient_id, title, body, type, reference_id)
  values (
    r.delivery_guy_id,
    'Delivery completed',
    'Delivery for serial ' ||
      (select serial_number from public.inventory_units where id = r.unit_id) ||
      ' was completed successfully.',
    'delivery',
    r.id
  );

  return r;
end;
$$;

revoke all on function public.complete_delivery_request(uuid) from public;
grant execute on function public.complete_delivery_request(uuid) to authenticated;

-- 4) Compatibility for older delivery_requests tables that have a required delivery_number.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'delivery_requests'
      and column_name = 'delivery_number'
  ) then
    execute $sql$
      alter table public.delivery_requests
      alter column delivery_number
      set default ('DL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)))
    $sql$;
  end if;
end $$;
