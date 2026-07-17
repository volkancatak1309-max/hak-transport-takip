-- HAK61 — Migration 023
-- Fleet separation: every vehicle belongs to one of two named fleets, 'bordo'
-- or 'mavi'. Map marker colors, list badges and the fleet filter derive from
-- this column. Fully ADDITIVE: one column with a default; no existing flow
-- changes. New vehicles default to 'mavi'. Run in Supabase SQL Editor.
--
-- NOTE: the one-time backfill (which plates are 'bordo') contains real plate
-- numbers and therefore is NOT committed to the repo (privacy rule); it was
-- run separately in the Supabase SQL Editor on 2026-07-17.

alter table public.vehicles
  add column if not exists fleet text not null default 'mavi'
  check (fleet in ('bordo', 'mavi'));
