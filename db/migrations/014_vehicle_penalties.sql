-- HAK61 — Migration 014
-- Arac ceza (Strafe / penalty) takibi.
--
-- NOT: Muayene (§57a Pickerl) ve sigorta HATIRLATMASI zaten mevcut
-- (lib/admin-dashboard.ts buildAttention, ±30 gun). Bu migration yalnizca
-- CEZA kayitlari icin yeni bir tablo ekler. Tamamen additive; mevcut akislar
-- (auth/vardiya/arac) degismez. Supabase SQL Editor'da calistir.
create table if not exists public.vehicle_penalties (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  penalty_date date not null,                 -- cezanin tarihi
  amount numeric(10,2),                        -- tutar (EUR), opsiyonel
  description text,                            -- aciklama
  paid boolean not null default false,         -- odendi mi
  paid_at timestamptz,                         -- odeme zamani
  created_by uuid references public.workers(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicle_penalties_vehicle
  on public.vehicle_penalties(vehicle_id);

-- Odenmemis cezalari hizli bulmak icin (Dikkat/Aksiyon paneli).
create index if not exists idx_vehicle_penalties_unpaid
  on public.vehicle_penalties(vehicle_id)
  where paid = false;
