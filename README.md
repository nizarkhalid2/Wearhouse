# Warehouse — Free GitHub Pages + Supabase

A real warehouse inventory app designed to run on the free tiers of GitHub Pages and Supabase.

## What is included

- Public live inventory: anyone can open the site and browse stock.
- Admin-only mutations protected by Supabase Row Level Security (RLS).
- Email/password admin login through Supabase Auth.
- Add / edit / delete products.
- Real image upload to Supabase Storage.
- Search + category + location filters.
- Quantity, location, category, price and description fields.
- Automatic activity/audit log from database triggers.
- Realtime product/activity updates through Supabase Realtime.
- Responsive glassmorphism UI with animations and reduced-motion support.
- No server, VPS, paid API, or service-role key required.

## Free architecture

GitHub Pages → static website
Supabase Free → Auth + Postgres database + Storage + Realtime

Do **not** put a Supabase `service_role` key in this project. Only use the browser-safe anon/publishable key.

## Setup (one time)

### 1. Create a Supabase project

Create a free project at Supabase.

### 2. Create the admin account

In Supabase: Authentication → Users → Add user.

Create the email/password account you will use to manage the warehouse.

Copy the user's **UUID**.

### 3. Run the database setup

Open Supabase → SQL Editor → New query.

Paste the entire contents of `schema.sql` and run it.

Then run this command, replacing the two values:

```sql
insert into public.admin_users(user_id, email)
values ('YOUR_AUTH_USER_UUID', 'YOUR_ADMIN_EMAIL@example.com');
```

If you ever need to remove admin access:

```sql
delete from public.admin_users where user_id = 'YOUR_AUTH_USER_UUID';
```

### 4. Add Supabase keys

Open `config.js` and replace:

```js
SUPABASE_URL: "PASTE_YOUR_SUPABASE_URL",
SUPABASE_ANON_KEY: "PASTE_YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY",
ADMIN_EMAIL: "YOUR_ADMIN_EMAIL@example.com"
```

Find the URL and browser-safe key in Supabase → Project Settings → API.

The `ADMIN_EMAIL` value is only used for display/config convenience. The actual security check is the `admin_users` table + RLS.

### 5. Test locally

Because browsers can be picky about local `file://` pages, run a tiny local server from the project folder:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

### 6. Publish on GitHub Pages

Create a GitHub repository and upload:

- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `schema.sql`
- `README.md`

In GitHub: Settings → Pages → Deploy from a branch → `main` → `/root` → Save.

After GitHub publishes the site, open the generated GitHub Pages URL.

## Important free-plan notes

- GitHub Pages is static hosting; Supabase handles the live backend.
- Supabase Free has usage/storage limits. Keep product images reasonably small.
- The app rejects uploaded images above 5 MB.
- The public inventory is intentionally readable without login.
- Only users listed in `public.admin_users` can insert/update/delete products or upload/delete product images.
- The activity log is generated in PostgreSQL, so it does not depend on the browser behaving correctly.

## If GitHub Pages shows an empty/old site

Make sure `index.html` is at the repository root and GitHub Pages is pointing to the correct branch/folder. Also check that `config.js` contains the real Supabase URL and browser-safe key.

## Security

Never publish:

- Supabase service-role key
- database password
- any private server credential

The Supabase anon/publishable key is designed to be used in a public frontend when RLS policies are configured correctly.


## If SQL Editor shows "Backend error! Retry your query"
Use the updated `schema.sql` in this package. It no longer tries to modify the
`supabase_realtime` publication from the main setup script.

After the schema runs successfully:
1. Open Supabase Dashboard -> Database -> Publications/Replication.
2. Find `supabase_realtime`.
3. Enable `products` and `activity` if they are not already enabled.
