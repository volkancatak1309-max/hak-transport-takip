-- HAK61 — Migration 017
-- FMC003 OBD/CAN telemetry: fuel level + vehicle odometer on device_telemetry.
--
-- Fully ADDITIVE + idempotent: two nullable columns, no existing column / index /
-- flow changes. Any device that doesn't report OBD/CAN simply leaves these
-- NULL — the whole GPS pipeline keeps working unchanged. The
-- flespi ingest (lib/flespi.ts normalize) fills them when the device sends the
-- OBD/CAN fields. Run in Supabase SQL Editor BEFORE deploying.

alter table public.device_telemetry
  add column if not exists fuel_level_pct double precision,  -- % 0..100 (OBD/CAN fuel level)
  add column if not exists odometer_km double precision;     -- aracın toplam km'si (OBD/CAN)
