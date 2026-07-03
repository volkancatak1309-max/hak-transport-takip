-- HAK61 — Migration 013
-- Bind each vehicle to its flespi gateway device (Teltonika FMC003).
-- Fully ADDITIVE: a single nullable column on `vehicles`; no existing auth /
-- shift / GPS / assignment flow changes. The phone-GPS pipeline (driver_locations,
-- recordLocation) is untouched. Run in Supabase SQL Editor BEFORE deploying.

alter table public.vehicles
  add column if not exists flespi_device_id bigint;   -- flespi gw/devices/{id}

-- A flespi device belongs to at most one vehicle (partial: many vehicles may
-- still have NULL during rollout).
create unique index if not exists idx_vehicles_flespi_device
  on public.vehicles(flespi_device_id)
  where flespi_device_id is not null;
