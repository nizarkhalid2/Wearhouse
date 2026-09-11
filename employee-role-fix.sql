-- Run this once in Supabase SQL Editor.
-- It makes every active non-admin profile a warehouse delivery/installation employee.

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

revoke all on function public.is_delivery() from public;
grant execute on function public.is_delivery() to authenticated;
