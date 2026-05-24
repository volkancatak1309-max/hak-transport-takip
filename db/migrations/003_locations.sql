-- HAK Transport — Migration 003
-- Driver GPS location tracking (live fleet map + route history).
-- Run in Supabase SQL Editor BEFORE deploying this version to Vercel.

create table if not exists public.driver_locations (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  time_entry_id uuid references public.time_entries(id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_driver_locations_worker_recent
  on public.driver_locations(worker_id, recorded_at desc);

create index if not exists idx_driver_locations_time_entry
  on public.driver_locations(time_entry_id)
  where time_entry_id is not null;
