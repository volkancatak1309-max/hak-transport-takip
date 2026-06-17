-- HAK61 — Migration 010
-- Undelivered (returned) package count at end of shift. Additive & nullable —
-- existing rows stay NULL (shown as "-"/0). Run in Supabase SQL Editor.

alter table public.time_entries
  add column if not exists undelivered_count int;
