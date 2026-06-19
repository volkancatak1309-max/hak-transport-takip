-- HAK Transport — Migration 012 (LOGIN BRUTE-FORCE THROTTLE)
-- =====================================================================
-- Backs the login rate-limiter in app/actions/auth.ts. One row per
-- `${ip}|${phone}` identifier; the action increments `attempts` on each failed
-- login and sets `locked_until` once failures cross the threshold (escalating
-- window). A successful login deletes the row. No external service needed.
--
-- Safe to run on the live DB: uses IF NOT EXISTS and creates only a new table.
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists public.login_attempts (
  identifier        text primary key,            -- "<ip>|<phone>"
  attempts          int not null default 0,
  locked_until      timestamptz,
  first_attempt_at  timestamptz not null default now(),
  last_attempt_at   timestamptz not null default now()
);

-- Lets an optional cleanup job prune stale rows by age.
create index if not exists login_attempts_last_attempt_idx
  on public.login_attempts (last_attempt_at);

-- NOTE: RLS stays OFF (consistent with the rest of the schema); this table is
-- only ever read/written by the service-role client inside the login action.
