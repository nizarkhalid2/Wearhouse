-- INVENTORY READ FIX -- SAFE / NON-DESTRUCTIVE
-- This script does NOT delete, reset, rename, or recreate any product or serial row.
-- Existing products and serial numbers remain exactly where they are.

create or replace function public.warehouse_inventory_products()
returns setof public.products
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.products p
  order by p.created_at desc;
$$;

revoke all on function public.warehouse_inventory_products() from public;
grant execute on function public.warehouse_inventory_products() to anon, authenticated;

-- Keep ordinary table reads valid as well.
alter table public.products enable row level security;
grant select on public.products to anon, authenticated;

drop policy if exists "warehouse products always readable" on public.products;
create policy "warehouse products always readable"
on public.products
for select
using (true);
