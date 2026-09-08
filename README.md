# Warehouse — Delivery Workflow Edition

This version keeps the existing dark glass warehouse UI and adds a real serialized delivery workflow on Supabase.

## Roles
- `admin`: full inventory control + delivery approvals.
- `delivery_guy`: can select/scan a serialized physical unit, create delivery requests, and upload delivery notes. Cannot edit stock.

## Workflow
1. Delivery guy searches/scans a serial number.
2. Sends destination/date/recipient/details.
3. Admin receives a notification and clicks **Accept**.
4. The exact serial is reserved; stock quantity is NOT reduced.
5. Delivery guy delivers the item.
6. Delivery guy uploads the delivery note.
7. Admin receives another notification and clicks **Accept delivery**.
8. Only then the exact unit becomes `delivered` and product quantity decreases by 1.

## Setup
1. Run `schema.sql` completely in Supabase SQL Editor.
2. Keep your existing `config.js`.
3. In Supabase Auth, create the admin and delivery users.
4. Add a profile row for the delivery user:
   `insert into public.profiles(id,full_name,role) values('USER_UUID','Delivery Guy','delivery_guy');`
5. For each product, open Admin → Serials and enter one physical serial number per line.
6. Enable Realtime for `products`, `activity`, `delivery_requests`, and `notifications` in Supabase Database → Replication.
7. Deploy the files to GitHub Pages.

## Important
The browser never directly decrements stock. The final deduction happens in the protected `complete_delivery_request()` RPC after the admin accepts the submitted delivery note.
