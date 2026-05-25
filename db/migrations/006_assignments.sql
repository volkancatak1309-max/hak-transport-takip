-- HAK Transport — Migration 006
-- Sefer Atama (assignments): admin assigns routes to drivers, drivers start/
-- complete them, with Telegram notification de-dup. Additive — no existing
-- table is touched. Run in Supabase SQL Editor BEFORE deploying this version.

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,

  -- Zamanlama
  scheduled_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,

  -- Adresler (JSON array, çoklu durak için)
  -- Format: [{ "label": "Çıkış", "address": "Feldkirch Lager" }, { "label": "Varış", "address": "Linz" }]
  stops jsonb not null default '[]'::jsonb,

  -- KM
  start_km integer,
  end_km integer,

  -- İçerik
  category text not null check (category in ('lieferung', 'abholung', 'kurier', 'verteilung')),
  package_count integer default 0,
  notes text,

  -- Durum: assigned, started, completed, cancelled
  status text not null default 'assigned' check (status in ('assigned', 'started', 'completed', 'cancelled')),
  cancel_reason text,

  -- Telegram tracking (yarış-güvenli flag)
  assignment_notified_at timestamptz,

  -- Audit
  created_by uuid references public.workers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_assignments_worker_date
  on public.assignments(worker_id, scheduled_at desc);

create index idx_assignments_status_date
  on public.assignments(status, scheduled_at)
  where status in ('assigned', 'started');

create index idx_assignments_pending_notification
  on public.assignments(id)
  where assignment_notified_at is null;

-- updated_at otomatik güncelleme
create or replace function update_assignments_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_assignments_updated_at
  before update on public.assignments
  for each row execute function update_assignments_updated_at();
