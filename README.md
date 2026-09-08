# Warehouse — Free GitHub Pages + Supabase

A static warehouse catalog with a private admin panel. Visitors can browse inventory; only an approved Supabase Auth user whose UUID exists in `admin_users` can create, edit or delete products.

## 1. Configure Supabase

Open `config.js` and replace:

- `SUPABASE_URL` with your Supabase project URL.
- `SUPABASE_ANON_KEY` with the **anon/public** key from Supabase Settings → API (or the publishable key if your project exposes that option).

Never put a `service_role` / secret key in this file.

## 2. Database

The supplied `schema.sql` creates:

- `products`
- `admin_users`
- `activity`
- RLS policies
- `is_admin()` security function
- automatic product activity logging
- `product-images` public storage bucket with admin-only uploads

If the tables already exist, the SQL is written with `if not exists` / policy replacement so it can be rerun.

## 3. Admin account

Create your administrator in Supabase Authentication → Users. Then add a row in `admin_users` using the exact Auth User UID and email. Example:

`user_id`: your Auth User UID

`email`: your admin email

The browser checks this table after login. Database writes are protected by RLS as well, so hiding the Admin UI is not the security boundary.

## 4. Realtime

For live product/activity refreshes, enable Realtime for `products` and `activity` in Supabase Dashboard → Database → Replication. The site still works without Realtime; it just will not auto-refresh between browser sessions.

## 5. GitHub Pages

Upload all files in this folder to the repository root:

- `index.html`
- `app.js`
- `styles.css`
- `config.js`
- `schema.sql`
- `README.md`

Then GitHub → Settings → Pages → Deploy from branch → select `main` and `/root`.

## Free stack

No custom backend or paid server is required. GitHub Pages hosts the static frontend and Supabase handles Auth, database and storage on its free tier subject to Supabase's current limits.
