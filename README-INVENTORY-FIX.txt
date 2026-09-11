WAREHOUSE - INVENTORY VISIBILITY FIX

Why this fix exists:
- If a serial says "already exists", that row is still stored in Supabase.
- Because inventory_units.product_id references products.id, its product also still exists.
- An empty Inventory page in that situation is a READ/VISIBILITY issue, not deleted data.

Do only this:
1) Supabase > SQL Editor > New query
2) Run inventory-read-fix.sql ONCE
3) Upload/replace the website files from this folder
4) Hard refresh the site (Ctrl+F5)

Do NOT run schema.sql and do NOT run any reset/delete SQL.
