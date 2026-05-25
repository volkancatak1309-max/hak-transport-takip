-- HAK Transport — Migration 004
-- Adds a human-readable employee number (Personalnummer) to workers.
-- DATEV (LODAS) and BMD (Lohnverrechnung) payroll exports require a real,
-- short personnel number — not a UUID fragment. Run in Supabase SQL Editor
-- BEFORE deploying this version to Vercel.

alter table public.workers
  add column if not exists employee_number text;

-- Backfill existing workers with sequential 4-digit numbers (0001, 0002, …)
-- ordered by creation date. Only fills rows that don't already have one.
with numbered as (
  select
    id,
    lpad(
      (row_number() over (order by created_at, id))::text,
      4, '0'
    ) as num
  from public.workers
  where employee_number is null
)
update public.workers w
set employee_number = n.num
from numbered n
where w.id = n.id;

-- Two workers must never share a Personalnummer (NULLs are ignored).
create unique index if not exists idx_workers_employee_number
  on public.workers(employee_number)
  where employee_number is not null;
