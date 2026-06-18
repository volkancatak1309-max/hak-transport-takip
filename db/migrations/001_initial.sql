-- HAK Transport — Migration 001 (INITIAL / BOOTSTRAP)
-- =====================================================================
-- Fresh-install bootstrap. Creates the two base tables that every later
-- migration assumes already exist: `workers` and `time_entries`. The rest of
-- the schema is created by the migrations that follow, in order:
--   002 → break/cargo columns on time_entries
--   003 → driver_locations
--   004 → workers.employee_number
--   005 → telegram fields + telegram_link_codes + notify flags
--   006 → assignments
--   007 → fuel_entries / expense_entries / vehicle_maintenance (+ storage)
--   008 → driver_locations: FK cascade + time_entry_id NOT NULL
--   009 → vehicles (+ vehicle_id / break_started_at / start_package_count)
--   010 → time_entries.undelivered_count
--   011 → time_entries.still_active_asked_at
-- Running 001 → 011 in order on an EMPTY database reproduces the full HAK61
-- schema from scratch (needed to deploy this system for a new company).
--
-- ⚠️ DO NOT run on the existing live database — it already has these tables.
-- All statements use IF NOT EXISTS, so an accidental run is a harmless no-op,
-- but the live DB is never part of the fresh-install flow.
-- =====================================================================

-- gen_random_uuid() for primary keys.
create extension if not exists pgcrypto;

-- Workers (drivers + admins). Base columns only; 004/005 add employee_number
-- and the telegram_* fields on top of this.
create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  pin_hash text not null,
  plate text,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Shifts. Base columns only; 002/005/009/010/011 add break_minutes,
-- cargo_count, audit/notify flags, vehicle_id, package counts, etc.
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_km integer not null,
  end_km integer,
  plate text,
  notes text,
  created_at timestamptz not null default now()
);

-- FK lookup index (shifts by worker). Later migrations add their own indexes.
create index if not exists idx_time_entries_worker
  on public.time_entries(worker_id);
