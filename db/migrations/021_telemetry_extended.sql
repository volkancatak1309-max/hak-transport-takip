-- HAK61 — Migration 021
-- Extended FMC003 CAN/OBD telemetry + VIN + diagnostic trouble codes (DTC).
--
-- Fully ADDITIVE + idempotent: new nullable columns and one new table only. No
-- existing column / index / flow is changed; a device that doesn't report a
-- field simply leaves it NULL and the whole GPS pipeline keeps working.
--
-- Confirmed against the LIVE device DO-992GO (flespi 8549498, Fiat) on
-- 2026-07-13: the device sends flespi's `can.*` normalized params, but only on
-- ~45% of messages (the frames where the engine ECU is on the CAN bus). So these
-- are read opportunistically and NEVER gate a GPS fix. Observed keys/values:
--   can.engine.rpm=1479 · can.engine.coolant.temperature=89 ·
--   can.engine.load.level=0 · can.fuel.consumption=0 · can.fuel.level=80 ·
--   can.vehicle.mileage=74075 · can.dtc.number=2 ·
--   can.dtc=[{"code":"P0100","standard":"OBDII"},{"code":"P225C","standard":"OBDII"}] ·
--   external.powersource.voltage=14.255 · battery.voltage=4.109 ·
--   gsm.signal.level=100 · position.altitude=446 · position.satellites=14 ·
--   vehicle.vin='ZFA25000002V34962'
-- Run in Supabase SQL Editor BEFORE deploying this version.

-- 1) Extra CAN/OBD telemetry on each fix (all nullable, filled by lib/flespi
--    normalize() when the device sends them).
alter table public.device_telemetry
  add column if not exists engine_rpm int,                    -- can.engine.rpm
  add column if not exists engine_load_pct double precision,  -- can.engine.load.level (%)
  add column if not exists coolant_temp_c double precision,   -- can.engine.coolant.temperature (°C)
  add column if not exists fuel_consumption double precision, -- can.fuel.consumption (birim gerçek cihazda teyit edilecek)
  add column if not exists power_voltage double precision,    -- external.powersource.voltage (V, araç aküsü/alternatör)
  add column if not exists battery_voltage double precision,  -- battery.voltage (V, cihaz dahili yedek batarya)
  add column if not exists gsm_signal int,                    -- gsm.signal.level (0..100)
  add column if not exists altitude_m double precision,       -- position.altitude (m)
  add column if not exists satellites int,                    -- position.satellites
  add column if not exists dtc_number int;                    -- can.dtc.number (aktif arıza sayısı, her CAN frame'inde)

-- 2) VIN on the vehicle (device reports vehicle.vin). Backfilled opportunistically
--    by the flespi ingest/sync the first time a VIN is seen; only ever set when
--    currently NULL, so a manual value is never overwritten.
alter table public.vehicles
  add column if not exists vin text;                          -- vehicle.vin (ISO 17 hane)

-- 3) Diagnostic Trouble Codes (arıza kodları). The device sends the full active
--    list (can.dtc = [{code, standard}, ...]) only when it CHANGES; the count
--    (can.dtc.number) rides every CAN frame. We keep one ACTIVE row per code and
--    mark it cleared when a fresh snapshot no longer lists it.
create table if not exists public.vehicle_dtc (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  code text not null,                          -- 'P0100'
  standard text,                               -- 'OBDII'
  first_seen timestamptz not null,             -- device RTC when first observed
  last_seen timestamptz not null,              -- device RTC of the latest snapshot listing it
  cleared_at timestamptz,                      -- set when a snapshot no longer lists it (arıza giderildi)
  created_at timestamptz not null default now()
);

-- At most one ACTIVE row per (vehicle, code); a code may recur after clearing,
-- which inserts a fresh row (old one keeps its cleared_at as history).
create unique index if not exists idx_vehicle_dtc_active
  on public.vehicle_dtc(vehicle_id, code)
  where cleared_at is null;

-- List a vehicle's codes newest-first (active card + history).
create index if not exists idx_vehicle_dtc_vehicle
  on public.vehicle_dtc(vehicle_id, last_seen desc);

-- RLS stays OFF (consistent with the rest of the schema): this table is written
-- only by the service-role client inside the flespi ingest/sync routes and read
-- by server components.
