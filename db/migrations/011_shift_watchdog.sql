-- HAK Transport — Migration 011
-- "Ghost shift" watchdog: track when we last asked the driver whether a
-- long-open shift is still active, so the background cron can re-ask hourly
-- without spamming. Run in Supabase SQL Editor BEFORE deploying this version.

alter table public.time_entries
  add column if not exists still_active_asked_at timestamptz;

-- Helps the watchdog scan for still-open shifts quickly.
create index if not exists idx_time_entries_open
  on public.time_entries(started_at)
  where ended_at is null;
