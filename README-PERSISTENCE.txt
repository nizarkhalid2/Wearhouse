WAREHOUSE — PERSISTENCE SAFE UPDATE

1) Run persistence-safe.sql ONCE in Supabase SQL Editor.
   It does NOT delete products, serial numbers, delivery requests or users.

2) Upload/replace the website files from this folder on GitHub Pages.

Rules after this update:
- Products and serial numbers remain stored until the admin explicitly deletes them.
- Adding an item + serials is atomic: if a serial is duplicated, NOTHING is changed.
- Adding/removing a serial automatically keeps product quantity accurate.
- Final delivery marks the serial as delivered and removes it from active stock, but keeps it in database history.
- Do NOT run DELETE/TRUNCATE/reset inventory scripts for normal updates.
