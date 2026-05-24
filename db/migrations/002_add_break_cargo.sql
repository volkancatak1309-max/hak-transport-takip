-- HAK Transport — Migration 002
-- Adds break tracking, cargo count, and edit audit fields to time_entries.
-- Run in Supabase SQL Editor BEFORE deploying this version to Vercel.

alter table public.time_entries
  add column if not exists break_minutes integer default 0,
  add column if not exists cargo_count integer,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.workers(id);

create index if not exists idx_time_entries_started_date
  on public.time_entries(date(started_at at time zone 'Europe/Vienna'));

-- Sanity defaults (existing rows)
update public.time_entries set break_minutes = 0 where break_minutes is null;

-- Constraint: break_minutes non-negative
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'time_entries_break_nonneg'
  ) then
    alter table public.time_entries
      add constraint time_entries_break_nonneg
      check (break_minutes is null or break_minutes >= 0);
  end if;
end $$;

-- Constraint: cargo_count non-negative when set
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'time_entries_cargo_nonneg'
  ) then
    alter table public.time_entries
      add constraint time_entries_cargo_nonneg
      check (cargo_count is null or cargo_count >= 0);
  end if;
end $$;
