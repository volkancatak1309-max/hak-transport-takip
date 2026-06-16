-- HAK Transport — Migration 008
-- LEGAL HARDENING: a GPS point may exist ONLY when tied to a shift.
--
-- Signed worker consent: location is collected solely while a shift is open.
-- This makes that promise a DB-level invariant — driver_locations.time_entry_id
-- can never be NULL, so no point can be stored that is not attached to a shift.
-- This is the third layer of defense, below the client (LocationTracker) and the
-- server action (recordLocation), and the only one a stray client cannot bypass.
--
-- PRE-FLIGHT (run separately, see below): there must be NO existing rows with
-- time_entry_id IS NULL, or the SET NOT NULL will fail. Such rows are pre-fix
-- stray pings not attributable to any shift — delete them first.
--
-- Run in Supabase SQL Editor BEFORE deploying. Idempotent and transactional.

begin;

-- 1) FK was "on delete set null": deleting a shift would null the column and
--    then violate NOT NULL. Switch to cascade so removing a shift also removes
--    its GPS trail (correct for privacy) and never produces orphan/NULL rows.
alter table public.driver_locations
  drop constraint if exists driver_locations_time_entry_id_fkey;

alter table public.driver_locations
  add constraint driver_locations_time_entry_id_fkey
  foreign key (time_entry_id) references public.time_entries(id) on delete cascade;

-- 2) Enforce the invariant: every location row must belong to a shift.
alter table public.driver_locations
  alter column time_entry_id set not null;

commit;
