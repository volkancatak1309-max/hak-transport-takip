-- HAK Transport — Migration 005
-- Telegram notification system: per-worker chat link, one-time linking codes,
-- and per-shift notification de-duplication flags.
-- Run in Supabase SQL Editor BEFORE deploying this version to Vercel.

-- 1) Workers: linked Telegram chat + the locale to notify them in.
alter table public.workers
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_username text,
  add column if not exists telegram_linked_at timestamptz,
  add column if not exists telegram_locale text;

create index if not exists idx_workers_telegram_chat
  on public.workers(telegram_chat_id)
  where telegram_chat_id is not null;

-- 2) Pending linking codes — match a /start <code> from the bot to a worker.
--    `locale` captures the requester's UI language so the bot replies (and
--    later notifications) use the right language.
create table if not exists public.telegram_link_codes (
  code text primary key,
  worker_id uuid not null references public.workers(id) on delete cascade,
  locale text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at timestamptz
);

create index if not exists idx_telegram_link_codes_expires
  on public.telegram_link_codes(expires_at);

-- 3) Per-shift notification flags — send each alert at most once.
alter table public.time_entries
  add column if not exists nine_hour_notified_at timestamptz,
  add column if not exists lenkzeit_notified_at timestamptz,
  add column if not exists summary_notified_at timestamptz;
