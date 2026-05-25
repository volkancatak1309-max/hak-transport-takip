-- HAK Transport — Migration 007
-- Fuel tracking, expense reports and vehicle maintenance (+ CO₂ reporting).
-- Additive only. Run in Supabase SQL Editor BEFORE deploying this version.

-- ═══════ FUEL ENTRIES ═══════
create table public.fuel_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references public.workers(id) on delete set null,
  vehicle_plate text not null,

  fueled_at timestamptz not null default now(),
  liters numeric(10,2) not null check (liters > 0),
  total_cost numeric(10,2) not null check (total_cost > 0),
  cost_per_liter numeric(10,4) generated always as (total_cost / liters) stored,
  odometer_km integer not null check (odometer_km > 0),
  fuel_type text default 'diesel' check (fuel_type in ('diesel', 'benzin', 'lpg', 'elektro')),
  station_name text,

  receipt_path text not null,
  receipt_url text,

  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references public.workers(id),
  approved_at timestamptz,
  rejection_reason text,
  notes text,

  created_by uuid references public.workers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_fuel_entries_worker_date on public.fuel_entries(worker_id, fueled_at desc);
create index idx_fuel_entries_status on public.fuel_entries(status) where status = 'pending';
create index idx_fuel_entries_vehicle on public.fuel_entries(vehicle_plate, fueled_at desc);

-- ═══════ EXPENSE ENTRIES ═══════
create table public.expense_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references public.workers(id) on delete set null,

  spent_at timestamptz not null default now(),
  category text not null check (category in ('maut', 'verpflegung', 'parking', 'diesel', 'sonstige')),
  amount numeric(10,2) not null check (amount > 0),
  description text,
  vehicle_plate text,

  receipt_path text not null,
  receipt_url text,

  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references public.workers(id),
  approved_at timestamptz,
  rejection_reason text,

  created_by uuid references public.workers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_expense_entries_worker_date on public.expense_entries(worker_id, spent_at desc);
create index idx_expense_entries_status on public.expense_entries(status) where status = 'pending';
create index idx_expense_entries_category on public.expense_entries(category, spent_at desc);

-- ═══════ VEHICLE MAINTENANCE ═══════
create table public.vehicle_maintenance (
  id uuid primary key default gen_random_uuid(),
  vehicle_plate text not null,

  serviced_at timestamptz not null,
  service_type text not null check (service_type in ('oil_change', 'inspection', 'tire_change', 'brake_check', 'general_service', 'repair', 'other')),
  odometer_km integer not null,
  cost numeric(10,2),
  description text,
  next_service_km integer,
  next_service_date timestamptz,

  receipt_path text,
  receipt_url text,

  created_by uuid references public.workers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_vehicle_maintenance_plate_date on public.vehicle_maintenance(vehicle_plate, serviced_at desc);
create index idx_vehicle_maintenance_next_service on public.vehicle_maintenance(next_service_date) where next_service_date is not null;

-- updated_at triggers (generic function; assignments use their own from 006)
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_fuel_entries_updated_at
  before update on public.fuel_entries
  for each row execute function update_updated_at();

create trigger trg_expense_entries_updated_at
  before update on public.expense_entries
  for each row execute function update_updated_at();

create trigger trg_vehicle_maintenance_updated_at
  before update on public.vehicle_maintenance
  for each row execute function update_updated_at();

-- ═══════ STORAGE BUCKETS (private, 5 MB, images only) ═══════
-- Uploads/reads happen via the service-role client in server actions, which
-- bypasses RLS, so no object policies are required. Buckets just need to exist.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('fuel-receipts', 'fuel-receipts', false, 5242880, array['image/jpeg','image/png','image/webp','image/heic']),
  ('expense-receipts', 'expense-receipts', false, 5242880, array['image/jpeg','image/png','image/webp','image/heic']),
  ('maintenance-receipts', 'maintenance-receipts', false, 5242880, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;
