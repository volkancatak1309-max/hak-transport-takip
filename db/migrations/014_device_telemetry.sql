-- HAK61 — Migration 014
-- Vehicle-centric GPS telemetry from flespi / Teltonika hardware trackers.
--
-- DELIBERATELY SEPARATE from driver_locations: that table is phone-GPS, worker-
-- centric and gated on an active shift (legal backstop — no tracking outside a
-- shift). A hardwired tracker reports 24/7 regardless of any open shift, so its
-- data is keyed by VEHICLE and is NOT shift-gated. driver_locations and the whole
-- phone-GPS flow (recordLocation / LocationTracker / location-beacon) stay
-- completely untouched. Run in Supabase SQL Editor BEFORE deploying.

create table if not exists public.device_telemetry (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  flespi_device_id bigint not null,
  latitude double precision not null,
  longitude double precision not null,
  speed_kmh double precision,                  -- km/h (flespi position.speed)
  heading int,                                 -- 0..359 (flespi position.direction)
  ignition_on boolean,                         -- flespi engine.ignition.status
  recorded_at timestamptz not null,            -- device RTC time (flespi `timestamp`)
  ingested_at timestamptz not null default now()
);

-- Dedup + "latest position per vehicle". One row per (vehicle, device-timestamp);
-- re-polling an overlapping window is idempotent via ON CONFLICT DO NOTHING.
-- An ascending btree also serves `order by recorded_at desc` via backward scan.
create unique index if not exists idx_device_telemetry_vehicle_recorded
  on public.device_telemetry(vehicle_id, recorded_at);

-- Ops lookups by raw device id (ingestion resolves device -> vehicle).
create index if not exists idx_device_telemetry_device_recorded
  on public.device_telemetry(flespi_device_id, recorded_at desc);

-- NOTE: RLS stays OFF (consistent with the rest of the schema); this table is
-- only ever written by the service-role client inside the flespi sync route and
-- read by server components.
