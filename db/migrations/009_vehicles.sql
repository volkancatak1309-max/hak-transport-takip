-- HAK61 — Migration 009
-- Vehicle layer (vehicle-centric / Samsara-style). Fully ADDITIVE — no existing
-- column is changed or dropped, so current auth / shift / GPS / assignment flows
-- keep working unchanged. Run in Supabase SQL Editor BEFORE deploying this version.

-- 1) Vehicles: the fleet. `assigned_worker_id` is the primary/default driver
--    (optional); the live "current driver" is derived from the active shift.
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text unique not null,
  make text,                                   -- Mercedes-Benz, VW, Ford …
  model text,                                  -- Sprinter, Crafter, Transit …
  year int,
  status text not null default 'active',       -- active | maintenance | inactive
  assigned_worker_id uuid references public.workers(id) on delete set null,
  -- Document / inspection placeholders — surfaced in the detail page, filled later.
  inspection_due date,                         -- §57a "Pickerl"
  insurance_due date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicles_plate on public.vehicles(plate);
create index if not exists idx_vehicles_assigned on public.vehicles(assigned_worker_id);

-- 2) Link a shift to the vehicle the driver picked at shift start, persist the
--    live break state server-side (needed to show "on break" status), and keep
--    the start-of-day package count (cargo_count already holds end-of-day).
alter table public.time_entries
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists break_started_at timestamptz,
  add column if not exists start_package_count int;

create index if not exists idx_time_entries_vehicle on public.time_entries(vehicle_id);
