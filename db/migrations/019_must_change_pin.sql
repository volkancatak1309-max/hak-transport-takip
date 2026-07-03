-- HAK Transport — Migration 019 (FORCED PIN CHANGE ON FIRST LOGIN)
-- =====================================================================
-- Adds workers.must_change_pin. When an admin creates a worker or resets a
-- PIN (app/actions/workers.ts) the PIN is a TEMPORARY one, so the flag is set
-- true; the login flow (app/actions/auth.ts) then forces the driver to set
-- their own PIN at /pin BEFORE reaching the panel. changePinAction clears it.
--
-- Default false: existing workers keep their current PIN and are NOT disrupted
-- — only newly created accounts and freshly reset PINs require a change.
--
-- Safe to run on the live DB: additive column only, guarded with IF NOT EXISTS.
-- RLS stays OFF (consistent with the rest of the schema); the column is only
-- read/written by the service-role client in the auth/workers server actions.
-- =====================================================================

alter table public.workers
  add column if not exists must_change_pin boolean not null default false;
