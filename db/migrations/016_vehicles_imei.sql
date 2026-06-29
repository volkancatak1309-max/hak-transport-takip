-- HAK61 — Migration 016
-- Bind a vehicle to its flespi device by IMEI, for the HTTP Stream PUSH ingest
-- (/api/flespi/ingest). The flespi stream's "ident" field is the device IMEI; we
-- match it to vehicles.imei. Fully ADDITIVE: one nullable column + a partial
-- unique index; no existing table / column / flow is changed. The earlier
-- flespi_device_id column (migration 013) is left untouched and keeps working
-- for the REST pull sync. Run in Supabase SQL Editor.

alter table public.vehicles
  add column if not exists imei text;   -- device IMEI (flespi stream "ident")

-- An IMEI belongs to at most one vehicle (partial: many vehicles may be NULL
-- during rollout).
create unique index if not exists idx_vehicles_imei
  on public.vehicles(imei)
  where imei is not null;
