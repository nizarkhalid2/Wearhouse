# Warehouse — Inventory & Delivery

Static warehouse management app using Supabase.

## Included

- Public inventory catalog
- Admin product management
- Product image uploads
- Serialized physical inventory
- Delivery staff accounts
- Delivery request → admin approval → delivery note → completion workflow
- Notifications
- Realtime refresh
- Row Level Security (RLS)
- Private delivery-note storage

## 1. Configure Supabase

Edit `config.js` and keep your Supabase URL + publishable/anon key there.

## 2. Run the database setup

Open **Supabase → SQL Editor**, paste the entire contents of `schema.sql`, then Run.

Create your admin user in **Authentication → Users**, then run:

```sql
insert into public.admin_users(user_id,email)
values ('YOUR_ADMIN_AUTH_UUID','admin@example.com')
on conflict (user_id) do update set email=excluded.email;

insert into public.profiles(id,full_name,email,role,active)
values ('YOUR_ADMIN_AUTH_UUID','Admin','admin@example.com','admin',true)
on conflict (id) do update set role='admin', active=true;
```

## 3. Deploy the delivery-user Edge Function

The function is included at:

`supabase/functions/create-delivery-user/index.ts`

With the Supabase CLI:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy create-delivery-user
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available to deployed Supabase Edge Functions automatically.

## 4. Enable Realtime

In Supabase, enable Realtime replication for:

- `products`
- `activity`
- `inventory_units`
- `delivery_requests`
- `notifications`
- `profiles`

## Delivery flow

1. Admin adds products and serial numbers.
2. Admin creates a delivery account.
3. Delivery user signs in and requests an exact serial number.
4. Admin approves or rejects the request.
5. Delivery user uploads the delivery note.
6. Admin completes the delivery.
7. The serial becomes delivered and product quantity decreases by one.
