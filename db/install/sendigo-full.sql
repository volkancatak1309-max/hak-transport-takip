-- ═══════════════════════════════════════════════════════════════════════════
--  SENDIGO — TEK PARÇA KURULUM SQL'İ
--  hak-transport-takip · şema 001 → 040 · üretim tarihi: 31.07.2026
-- ═══════════════════════════════════════════════════════════════════════════
--
--  NE İŞE YARAR
--  BOŞ bir Supabase projesini uygulamanın beklediği tam şemaya getirir.
--  Supabase → SQL Editor → hepsini yapıştır → Run. Tek seferde.
--
--  NASIL ÇALIŞIR — HEPSİ YA DA HİÇBİRİ
--  Dosyanın tamamı TEK transaction içindedir. Herhangi bir ifade hata verirse
--  HİÇBİR ŞEY uygulanmaz; yarım kalmış şema oluşmaz. Hatayı düzeltip dosyayı
--  baştan çalıştırmak güvenlidir.
--
--  ÖNCE BOŞLUK DENETİMİ
--  İlk blok veritabanının boş olduğunu doğrular. Doluysa betik kendini durdurur
--  — mevcut bir müşterinin veritabanına yanlışlıkla çalıştırılamaz.
--
--  ⚠️  HAK61'DE ÇALIŞTIRMAYIN. Bu dosya sıfırdan kurulum içindir.
--
--  ÇALIŞTIRDIKTAN SONRA
--    select count(*) from information_schema.tables where table_schema='public';
--    -- 20+ tablo bekleniyor
--    select plate, is_test from public.vehicles;      -- TEST-001, true
--  Sonra: npm run bootstrap:admin (ilk yönetici) — bkz. docs/SENDIGO-KURULUM.md
--
-- ───────────────────────────────────────────────────────────────────────────
--  SAPMALAR — kaynak migration'lara göre bilinçli 4 fark
--  1) KÖPRÜ: vehicles.tank_capacity_l eklendi. Hiçbir migration onu
--     yaratmıyor (canlı HAK61'e elle eklenmiş); yokluğunda 028 KIRILIR.
--  2) 008 ve 030'daki iç `begin;`/`commit;` kaldırıldı — dosyanın tamamı
--     zaten tek transaction. İç commit dış transaction'ı erken kapatırdı.
--  3) 030 uyarlandı: HAK61'e özgü veri onarımı ve gerçek telefon parçaları
--     içeren DELETE çıkarıldı; kalıcı şema parçası (biçim kısıtı) korundu.
--  4) 006/007'deki create table/index/trigger idempotent yapıldı. Boş
--     veritabanında sonuç BİREBİR aynı; yalnız ikinci çalıştırma hata vermez.
--  SEED DOSYALARI DAHİL DEĞİLDİR (db/seed/* — demo araç/rota verisi).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── BOŞLUK DENETİMİ ────────────────────────────────────────────────────────
do $guard$
declare
  v_found text;
begin
  select string_agg(table_name, ', ' order by table_name) into v_found
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('workers','time_entries','vehicles','device_telemetry');
  if v_found is not null then
    raise exception
      'DURDURULDU: bu veritabanı BOŞ DEĞİL (bulunan tablolar: %). Bu dosya yalnız SIFIRDAN kurulum içindir; mevcut bir kuruluma çalıştırılmaz.',
      v_found;
  end if;
end
$guard$;



-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  001_initial.sql                                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK Transport — Migration 001 (INITIAL / BOOTSTRAP)
-- =====================================================================
-- Fresh-install bootstrap. Creates the two base tables that every later
-- migration assumes already exist: `workers` and `time_entries`. The rest of
-- the schema is created by the migrations that follow, in order:
--   002 → break/cargo columns on time_entries
--   003 → driver_locations
--   004 → workers.employee_number
--   005 → telegram fields + telegram_link_codes + notify flags
--   006 → assignments
--   007 → fuel_entries / expense_entries / vehicle_maintenance (+ storage)
--   008 → driver_locations: FK cascade + time_entry_id NOT NULL
--   009 → vehicles (+ vehicle_id / break_started_at / start_package_count)
--   010 → time_entries.undelivered_count
--   011 → time_entries.still_active_asked_at
-- Running 001 → 011 in order on an EMPTY database reproduces the full HAK61
-- schema from scratch (needed to deploy this system for a new company).
--
-- ⚠️ DO NOT run on the existing live database — it already has these tables.
-- All statements use IF NOT EXISTS, so an accidental run is a harmless no-op,
-- but the live DB is never part of the fresh-install flow.
-- =====================================================================

-- gen_random_uuid() for primary keys.
create extension if not exists pgcrypto;

-- Workers (drivers + admins). Base columns only; 004/005 add employee_number
-- and the telegram_* fields on top of this.
create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  pin_hash text not null,
  plate text,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Shifts. Base columns only; 002/005/009/010/011 add break_minutes,
-- cargo_count, audit/notify flags, vehicle_id, package counts, etc.
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_km integer not null,
  end_km integer,
  plate text,
  notes text,
  created_at timestamptz not null default now()
);

-- FK lookup index (shifts by worker). Later migrations add their own indexes.
create index if not exists idx_time_entries_worker
  on public.time_entries(worker_id);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  002_add_break_cargo.sql                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK Transport — Migration 002
-- Adds break tracking, cargo count, and edit audit fields to time_entries.
-- Run in Supabase SQL Editor BEFORE deploying this version to Vercel.

alter table public.time_entries
  add column if not exists break_minutes integer default 0,
  add column if not exists cargo_count integer,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.workers(id);

create index if not exists idx_time_entries_started_date
  on public.time_entries(date(started_at at time zone 'Europe/Vienna'));

-- Sanity defaults (existing rows)
update public.time_entries set break_minutes = 0 where break_minutes is null;

-- Constraint: break_minutes non-negative
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'time_entries_break_nonneg'
  ) then
    alter table public.time_entries
      add constraint time_entries_break_nonneg
      check (break_minutes is null or break_minutes >= 0);
  end if;
end $$;

-- Constraint: cargo_count non-negative when set
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'time_entries_cargo_nonneg'
  ) then
    alter table public.time_entries
      add constraint time_entries_cargo_nonneg
      check (cargo_count is null or cargo_count >= 0);
  end if;
end $$;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  003_locations.sql                                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK Transport — Migration 003
-- Driver GPS location tracking (live fleet map + route history).
-- Run in Supabase SQL Editor BEFORE deploying this version to Vercel.

create table if not exists public.driver_locations (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  time_entry_id uuid references public.time_entries(id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_driver_locations_worker_recent
  on public.driver_locations(worker_id, recorded_at desc);

create index if not exists idx_driver_locations_time_entry
  on public.driver_locations(time_entry_id)
  where time_entry_id is not null;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  004_employee_number.sql                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  005_telegram.sql                                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  006_assignments.sql                                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK Transport — Migration 006
-- Sefer Atama (assignments): admin assigns routes to drivers, drivers start/
-- complete them, with Telegram notification de-dup. Additive — no existing
-- table is touched. Run in Supabase SQL Editor BEFORE deploying this version.

create table if not exists public.assignments (
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

create index if not exists idx_assignments_worker_date
  on public.assignments(worker_id, scheduled_at desc);

create index if not exists idx_assignments_status_date
  on public.assignments(status, scheduled_at)
  where status in ('assigned', 'started');

create index if not exists idx_assignments_pending_notification
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

drop trigger if exists trg_assignments_updated_at on public.assignments;
create trigger trg_assignments_updated_at
  before update on public.assignments
  for each row execute function update_assignments_updated_at();


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  007_fuel_expenses.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK Transport — Migration 007
-- Fuel tracking, expense reports and vehicle maintenance (+ CO₂ reporting).
-- Additive only. Run in Supabase SQL Editor BEFORE deploying this version.

-- ═══════ FUEL ENTRIES ═══════
create table if not exists public.fuel_entries (
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

create index if not exists idx_fuel_entries_worker_date on public.fuel_entries(worker_id, fueled_at desc);
create index if not exists idx_fuel_entries_status on public.fuel_entries(status) where status = 'pending';
create index if not exists idx_fuel_entries_vehicle on public.fuel_entries(vehicle_plate, fueled_at desc);

-- ═══════ EXPENSE ENTRIES ═══════
create table if not exists public.expense_entries (
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

create index if not exists idx_expense_entries_worker_date on public.expense_entries(worker_id, spent_at desc);
create index if not exists idx_expense_entries_status on public.expense_entries(status) where status = 'pending';
create index if not exists idx_expense_entries_category on public.expense_entries(category, spent_at desc);

-- ═══════ VEHICLE MAINTENANCE ═══════
create table if not exists public.vehicle_maintenance (
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

create index if not exists idx_vehicle_maintenance_plate_date on public.vehicle_maintenance(vehicle_plate, serviced_at desc);
create index if not exists idx_vehicle_maintenance_next_service on public.vehicle_maintenance(next_service_date) where next_service_date is not null;

-- updated_at triggers (generic function; assignments use their own from 006)
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_fuel_entries_updated_at on public.fuel_entries;
create trigger trg_fuel_entries_updated_at
  before update on public.fuel_entries
  for each row execute function update_updated_at();

drop trigger if exists trg_expense_entries_updated_at on public.expense_entries;
create trigger trg_expense_entries_updated_at
  before update on public.expense_entries
  for each row execute function update_updated_at();

drop trigger if exists trg_vehicle_maintenance_updated_at on public.vehicle_maintenance;
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


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  008_locations_require_shift.sql                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

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
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
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
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  009_vehicles.sql                                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 009
-- Vehicle layer (vehicle-centric / Samsara-style). Fully ADDITIVE — no existing
-- column is changed or dropped, so current auth / shift / GPS / assignment flows
-- keep working unchanged. Run in Supabase SQL Editor BEFORE deploying this version.

-- 1) Vehicles: the fleet. `assigned_worker_id` is the primary/default driver
--    (optional); the live "current driver" is derived from the active shift.
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text unique not null,
  make text,                                   -- Mercedes-Benz, VW, Ford …
  model text,                                  -- Sprinter, Crafter, Transit …
  year int,
  status text not null default 'active',       -- active | maintenance | inactive
  assigned_worker_id uuid references public.workers(id) on delete set null,
  -- Document / inspection placeholders — surfaced in the detail page, filled later.
  inspection_due date,                         -- §57a "Pickerl"
  insurance_due date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicles_plate on public.vehicles(plate);
create index if not exists idx_vehicles_assigned on public.vehicles(assigned_worker_id);

-- 2) Link a shift to the vehicle the driver picked at shift start, persist the
--    live break state server-side (needed to show "on break" status), and keep
--    the start-of-day package count (cargo_count already holds end-of-day).
alter table public.time_entries
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists break_started_at timestamptz,
  add column if not exists start_package_count int;

create index if not exists idx_time_entries_vehicle on public.time_entries(vehicle_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- KÖPRÜ 1 — vehicles.tank_capacity_l   (migration DEĞİL, eksik DDL tamamlaması)
-- ═══════════════════════════════════════════════════════════════════════════
-- Bu kolon HİÇBİR migration dosyasında yaratılmıyor: canlı HAK61 veritabanına
-- 2026 ortasında Supabase SQL Editor'dan elle eklenmiş ve repoya hiç girmemiş.
-- Boş bir veritabanında yokluğu ZİNCİRİ KIRAR:
--   • 028_test_data_flag.sql → insert into public.vehicles (... tank_capacity_l ...)
--     "column tank_capacity_l of relation vehicles does not exist" → 028-040 çalışmaz.
--   • lib/reports.ts:630 → .select("id, plate, assigned_worker_id, tank_capacity_l")
--     yakıt raporu kolon hatası döndürür.
-- Tip/ölçek canlı HAK61 şemasından alındı (numeric, litre; NULL = bilinmiyor).
alter table public.vehicles
  add column if not exists tank_capacity_l numeric;

comment on column public.vehicles.tank_capacity_l is
  'Depo kapasitesi (litre). Yakıt raporunda yüzde→litre çevrimi için; NULL ise litre hesaplanmaz.';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  010_undelivered.sql                                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 010
-- Undelivered (returned) package count at end of shift. Additive & nullable —
-- existing rows stay NULL (shown as "-"/0). Run in Supabase SQL Editor.

alter table public.time_entries
  add column if not exists undelivered_count int;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  011_shift_watchdog.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  012_login_attempts.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  013_telegram_chat_unique.sql                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 013
-- Bir Telegram chat = TEK worker.
--
-- Duzeltilen hata: telegram_chat_id'de yalnizca NON-UNIQUE index vardi; ayni chat
-- birden fazla worker'a baglanabiliyordu (test verisi tam da boyleydi). Webhook,
-- chat_id'den worker'i .maybeSingle() ile ariyordu; bu coklu kayitta HATA dondurur
-- -> worker=null -> watchdog "Evet/Hayir" butonlari sessizce hicbir sey yapmiyordu.
--
-- Supabase SQL Editor'da calistir. Tekrar calistirilabilir (idempotent).

-- 1) DEDUP: birden fazla worker'a bagli her telegram_chat_id icin BIR kayit tut,
--    digerlerinin baglantisini kaldir (null). Tutma onceligi:
--      (a) su an ACIK vardiyasi (ended_at IS NULL) olan worker,
--      (b) yoksa en son baglanan (telegram_linked_at DESC),
--      (c) esitlikte id ile sabit siralama.
with ranked as (
  select
    w.id,
    row_number() over (
      partition by w.telegram_chat_id
      order by
        (exists (
          select 1 from public.time_entries t
          where t.worker_id = w.id and t.ended_at is null
        )) desc,
        w.telegram_linked_at desc nulls last,
        w.id
    ) as rn
  from public.workers w
  where w.telegram_chat_id is not null
)
update public.workers w
set telegram_chat_id   = null,
    telegram_username  = null,
    telegram_linked_at = null,
    telegram_locale    = null
from ranked r
where w.id = r.id
  and r.rn > 1;

-- 2) NON-UNIQUE index'i kismi UNIQUE index ile degistir. NULL'lar sinirsiz
--    (Telegram baglamayan worker'lar), NULL olmayan chat id'ler benzersiz olmali.
drop index if exists public.idx_workers_telegram_chat;

create unique index if not exists idx_workers_telegram_chat_unique
  on public.workers (telegram_chat_id)
  where telegram_chat_id is not null;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  013_vehicles_flespi_device.sql                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 013
-- Bind each vehicle to its flespi gateway device (Teltonika FMC003).
-- Fully ADDITIVE: a single nullable column on `vehicles`; no existing auth /
-- shift / GPS / assignment flow changes. The phone-GPS pipeline (driver_locations,
-- recordLocation) is untouched. Run in Supabase SQL Editor BEFORE deploying.

alter table public.vehicles
  add column if not exists flespi_device_id bigint;   -- flespi gw/devices/{id}

-- A flespi device belongs to at most one vehicle (partial: many vehicles may
-- still have NULL during rollout).
create unique index if not exists idx_vehicles_flespi_device
  on public.vehicles(flespi_device_id)
  where flespi_device_id is not null;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  014_device_telemetry.sql                                           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 014
-- Vehicle-centric GPS telemetry from flespi / Teltonika hardware trackers.
--
-- DELIBERATELY SEPARATE from driver_locations: that table is phone-GPS, worker-
-- centric and gated on an active shift (legal backstop — no tracking outside a
-- shift). A hardwired tracker reports 24/7 regardless of any open shift, so its
-- data is keyed by VEHICLE and is NOT shift-gated. driver_locations and the whole
-- phone-GPS flow (recordLocation / LocationTracker / location-beacon) stay
-- completely untouched. Run in Supabase SQL Editor BEFORE deploying.

create table if not exists public.device_telemetry (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  flespi_device_id bigint not null,
  latitude double precision not null,
  longitude double precision not null,
  speed_kmh double precision,                  -- km/h (flespi position.speed)
  heading int,                                 -- 0..359 (flespi position.direction)
  ignition_on boolean,                         -- flespi engine.ignition.status
  recorded_at timestamptz not null,            -- device RTC time (flespi `timestamp`)
  ingested_at timestamptz not null default now()
);

-- Dedup + "latest position per vehicle". One row per (vehicle, device-timestamp);
-- re-polling an overlapping window is idempotent via ON CONFLICT DO NOTHING.
-- An ascending btree also serves `order by recorded_at desc` via backward scan.
create unique index if not exists idx_device_telemetry_vehicle_recorded
  on public.device_telemetry(vehicle_id, recorded_at);

-- Ops lookups by raw device id (ingestion resolves device -> vehicle).
create index if not exists idx_device_telemetry_device_recorded
  on public.device_telemetry(flespi_device_id, recorded_at desc);

-- NOTE: RLS stays OFF (consistent with the rest of the schema); this table is
-- only ever written by the service-role client inside the flespi sync route and
-- read by server components.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  014_vehicle_penalties.sql                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  015_geofences.sql                                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 015
-- Geofence zones for GPS region-violation detection (computeGeofenceEvents).
-- Vehicle-centric and ADDITIVE: no existing auth / shift / GPS / telemetry flow
-- changes. Circle zones only for now (polygon can be added later as a new `type`
-- + a vertices column). Run in Supabase SQL Editor BEFORE deploying.

create table if not exists public.geofences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 'circle' only for now; the check keeps the column honest for future 'polygon'.
  type text not null default 'circle' check (type in ('circle')),
  -- Circle geometry (metres). Latitude/longitude are the centre.
  center_lat double precision not null check (center_lat between -90 and 90),
  center_lng double precision not null check (center_lng between -180 and 180),
  radius_m double precision not null check (radius_m > 0),
  -- 'forbidden'    → entering the zone is a violation.
  -- 'allowed_only' → leaving the zone is a violation (must stay inside).
  rule_kind text not null default 'forbidden' check (rule_kind in ('forbidden', 'allowed_only')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Active zones are read on every vehicle-detail load; tiny table, simple index.
create index if not exists idx_geofences_active on public.geofences(active);

-- NOTE: RLS stays OFF (consistent with the rest of the schema); this table is
-- written only by the service-role client inside the geofence admin actions and
-- read by server components.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  016_vehicles_imei.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 016
-- Bind a vehicle to its flespi device by IMEI, for the HTTP Stream PUSH ingest
-- (/api/flespi/ingest). The flespi stream's "ident" field is the device IMEI; we
-- match it to vehicles.imei. Fully ADDITIVE: one nullable column + a partial
-- unique index; no existing table / column / flow is changed. The earlier
-- flespi_device_id column (migration 013) is left untouched and keeps working
-- for the REST pull sync. Run in Supabase SQL Editor.

alter table public.vehicles
  add column if not exists imei text;   -- device IMEI (flespi stream "ident")

-- An IMEI belongs to at most one vehicle (partial: many vehicles may be NULL
-- during rollout).
create unique index if not exists idx_vehicles_imei
  on public.vehicles(imei)
  where imei is not null;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  017_telemetry_obd.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 017
-- FMC003 OBD/CAN telemetry: fuel level + vehicle odometer on device_telemetry.
--
-- Fully ADDITIVE + idempotent: two nullable columns, no existing column / index /
-- flow changes. Any device that doesn't report OBD/CAN simply leaves these
-- NULL — the whole GPS pipeline keeps working unchanged. The
-- flespi ingest (lib/flespi.ts normalize) fills them when the device sends the
-- OBD/CAN fields. Run in Supabase SQL Editor BEFORE deploying.

alter table public.device_telemetry
  add column if not exists fuel_level_pct double precision,  -- % 0..100 (OBD/CAN fuel level)
  add column if not exists odometer_km double precision;     -- aracın toplam km'si (OBD/CAN)


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  018_vehicle_events.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK Transport — Migration 018
-- Araç olayları/alarmları (vehicle_events): cihazın bildirdiği ani fren /
-- ani hızlanma / sert viraj (green driving), aşırı hız, çarpma, çekilme,
-- cihaz sökümü, uzun rölanti ve GSM sinyal karıştırma olayları.
-- Tamamen additive ve idempotent — mevcut tablolara dokunmaz.
-- Supabase SQL Editor'da deploy'dan ÖNCE çalıştırılmalı.

create table if not exists public.vehicle_events (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  -- Kanonik olay türü: harsh_braking | harsh_acceleration | harsh_cornering |
  -- overspeeding | crash | towing | unplug | idling | jamming
  event_type text not null,
  -- Olaya eşlik eden ham detay (örn. çarpma yönü, viraj açısı, aşırı hız değeri).
  event_value jsonb,
  -- Olay anındaki konum/hız — mesajda yoksa null (olay yine de kaydedilir).
  latitude double precision,
  longitude double precision,
  speed_kmh double precision,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Araç detay "Son Olaylar" sorgusu: araç bazlı, en yeni önce.
create index if not exists idx_vehicle_events_vehicle_time
  on public.vehicle_events (vehicle_id, occurred_at desc);

-- /admin/alarmlar listesi: tüm araçlar, en yeni önce.
create index if not exists idx_vehicle_events_time
  on public.vehicle_events (occurred_at desc);

-- Çift teslim koruması: aynı olay hem HTTP-stream (ingest) hem REST poll (sync)
-- yolundan gelebilir — aynı (araç, tür, an) üçlüsü ikinci kez yazılamaz;
-- uygulama ON CONFLICT DO NOTHING ile sessizce atlar.
create unique index if not exists uq_vehicle_events_dedup
  on public.vehicle_events (vehicle_id, event_type, occurred_at);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  019_must_change_pin.sql                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  020_driver_panel_v2.sql                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK Transport — Migration 020 (Şoför Paneli v2 — Faz 1)
-- =====================================================================
-- Otomatik vardiya (kontak ile başlat/bitir) + şoför onayı + vardiya sonu
-- dijital imza + paket olayları (+1 PAKET, GPS'li) + vardiya fotoğrafları +
-- şoför sorun bildirimleri.
--
-- Supabase SQL Editor'de, bu sürüm deploy edilmeden ÖNCE çalıştırılmalı.
-- Tüm time_entries kolonları additive/nullable ya da default'lu — mevcut
-- satırlar ve mevcut sorgular etkilenmez.
--
-- İDEMPOTENT: baştan sona `if not exists` / `drop ... if exists` kullanır;
-- iki kez çalıştırılsa da hata vermez. Aşağıdaki 1.5 ön-temizlik bloğu, tekil
-- açık-vardiya UNIQUE index'inin patlamaması için çift açık vardiyaları önce
-- güvenle kapatır (veri SİLMEZ). Bu blok da tekrar çalıştırmaya dayanıklıdır.
-- =====================================================================

-- ── 1) time_entries: otomatik vardiya + onay + imza alanları ────────────────

alter table public.time_entries
  -- Vardiya kontak (ignition) telemetrisiyle otomatik mi açıldı?
  add column if not exists auto_started boolean not null default false,
  -- Vardiya başlangıcının şoför onayı:
  --   'pending'     → otomatik başladı, şoför onayı bekleniyor
  --   'confirmed'   → şoför "VARDİYAYI ONAYLA"ya bastı (confirmed_at dolu)
  --   'unconfirmed' → vardiya onaylanmadan bitti → admin panelinde uyarı rozeti
  -- Eski/manuel vardiyalar şoförün kendi başlattığı vardiyalardır → default
  -- 'confirmed' (geçmiş kayıtlar rozet üretmesin).
  add column if not exists confirmation_status text not null default 'confirmed',
  add column if not exists confirmed_at timestamptz,
  -- Vardiya kontak kapalı + hareketsizlik eşiğiyle otomatik mi kapandı?
  add column if not exists auto_ended boolean not null default false,
  -- Kapanış yolu (rapor/denetim için): manual | auto_idle | watchdog | admin
  add column if not exists end_reason text,
  -- Vardiya sonu özetinin şoför tarafından dijital imzası (İş 3):
  -- timestamp + user_id birlikte "imza"yı oluşturur.
  add column if not exists summary_confirmed_at timestamptz,
  add column if not exists summary_confirmed_by uuid references public.workers(id);

-- CHECK'ler ayrı eklenir (ADD COLUMN IF NOT EXISTS ile birleşik yazılamaz;
-- tekrar çalıştırmaya dayanıklı olsun diye önce düşürülür).
alter table public.time_entries
  drop constraint if exists time_entries_confirmation_status_chk;
alter table public.time_entries
  add constraint time_entries_confirmation_status_chk
  check (confirmation_status in ('pending', 'confirmed', 'unconfirmed'));

alter table public.time_entries
  drop constraint if exists time_entries_end_reason_chk;
alter table public.time_entries
  add constraint time_entries_end_reason_chk
  check (end_reason is null or end_reason in ('manual', 'auto_idle', 'watchdog', 'admin'));

-- ── 1.5) ÖN-TEMİZLİK: aynı şoförde birden çok AÇIK vardiya varsa kapat ───────
-- Aşağıdaki uq_time_entries_one_open UNIQUE index'i, veride bir şoförün >1 açık
-- vardiyası (ended_at IS NULL) varsa CREATE aşamasında patlar. Bu blok o
-- çakışmayı güvenli, denetlenebilir bir kuralla çözer:
--   • Her şoförün EN YENİ açık vardiyası açık kalır (started_at desc, id desc).
--   • Daha eski açık vardiyalar KAPATILIR (silinmez):
--       ended_at = başlangıçtan SONRAKİ son bilinen ARAÇ telemetri zamanı
--                  (device_telemetry.recorded_at), yoksa now();
--                  her hâlükârda started_at'ten en az 1 sn büyük ve now()'ı aşmaz.
--       end_reason = 'admin', auto_ended = true,
--       notes alanına 'auto-closed by migration 020' işareti eklenir (denetim izi).
-- İDEMPOTENT: ikinci çalıştırmada kapatılacak ikinci açık vardiya kalmadığı için
-- hiçbir satırı güncellemez (no-op). (device_telemetry migration 013/014'te oluşur;
-- bu migration'dan önce uygulanmış olması beklenir.)
with dupes as (
  select
    id,
    row_number() over (
      partition by worker_id
      order by started_at desc, id desc
    ) as rn
  from public.time_entries
  where ended_at is null
)
update public.time_entries te
set
  ended_at = greatest(
    te.started_at + interval '1 second',
    least(
      now(),
      coalesce(
        (
          select max(dt.recorded_at)
          from public.device_telemetry dt
          where dt.vehicle_id = te.vehicle_id
            and dt.recorded_at >= te.started_at
        ),
        now()
      )
    )
  ),
  end_reason = 'admin',
  auto_ended = true,
  notes = case
    when te.notes is null or btrim(te.notes) = ''
      then 'auto-closed by migration 020'
    else te.notes || ' · auto-closed by migration 020'
  end
from dupes
where te.id = dupes.id
  and dupes.rn > 1;

-- Yarış koşulu emniyeti: bir şoförün aynı anda EN FAZLA BİR açık vardiyası
-- olabilir. startShiftAction bugüne dek bunu yalnız uygulama kodunda kontrol
-- ediyordu; otomatik başlatma (sync cron + stream ingest eşzamanlı) için DB
-- garantisi şart. Yukarıdaki 1.5 ön-temizlik bloğu çift açık vardiyaları önce
-- kapattığı için bu index artık güvenle oluşturulabilir.
create unique index if not exists uq_time_entries_one_open
  on public.time_entries (worker_id)
  where ended_at is null;

-- ── 2) shift_packages: +1 PAKET olayları (GPS + zaman damgalı denetim izi) ──
-- Her dokunuş bir satır; time_entries.cargo_count bu tablodan yeniden
-- sayılarak senkron tutulur (mevcut rapor/export'lar değişmeden çalışsın).

create table if not exists public.shift_packages (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_shift_packages_entry
  on public.shift_packages (time_entry_id);

-- ── 3) shift_photos: FOTO ÇEK — konum+saat damgalı vardiya fotoğrafları ─────
-- Tek genel akış (hasarlı paket / teslim kanıtı / araç hasarı) — kategorisiz.

create table if not exists public.shift_photos (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  storage_path text not null,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_shift_photos_entry
  on public.shift_photos (time_entry_id);

-- Özel bucket — fuel/expense receipt bucket'larıyla aynı desen
-- (private, 5 MB, yalnız görüntü; erişim service-role üzerinden).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('shift-photos', 'shift-photos', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

-- ── 4) driver_reports: SORUN BİLDİR — 4 hazır seçenek, yazı zorunluluğu yok ─

create table if not exists public.driver_reports (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  -- Vardiya bağı opsiyonel (vardiya dışı bildirim de kaydedilebilsin diye
  -- SET NULL; vardiya silinirse bildirim kalır).
  time_entry_id uuid references public.time_entries(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  report_type text not null
    check (report_type in ('vehicle_fault', 'address_issue', 'damaged_package', 'other')),
  latitude double precision,
  longitude double precision,
  resolved_at timestamptz,
  resolved_by uuid references public.workers(id),
  created_at timestamptz not null default now()
);

-- Admin dikkat listesi "çözülmemiş bildirimler"i hızlı taransın.
create index if not exists idx_driver_reports_open
  on public.driver_reports (created_at desc)
  where resolved_at is null;

create index if not exists idx_driver_reports_worker
  on public.driver_reports (worker_id, created_at desc);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  021_telemetry_extended.sql                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 021
-- Extended FMC003 CAN/OBD telemetry + VIN + diagnostic trouble codes (DTC).
--
-- Fully ADDITIVE + idempotent: new nullable columns and one new table only. No
-- existing column / index / flow is changed; a device that doesn't report a
-- field simply leaves it NULL and the whole GPS pipeline keeps working.
--
-- Confirmed against the LIVE device DO-992GO (flespi 8549498, Fiat) on
-- 2026-07-13: the device sends flespi's `can.*` normalized params, but only on
-- ~45% of messages (the frames where the engine ECU is on the CAN bus). So these
-- are read opportunistically and NEVER gate a GPS fix. Observed keys/values:
--   can.engine.rpm=1479 · can.engine.coolant.temperature=89 ·
--   can.engine.load.level=0 · can.fuel.consumption=0 · can.fuel.level=80 ·
--   can.vehicle.mileage=74075 · can.dtc.number=2 ·
--   can.dtc=[{"code":"P0100","standard":"OBDII"},{"code":"P225C","standard":"OBDII"}] ·
--   external.powersource.voltage=14.255 · battery.voltage=4.109 ·
--   gsm.signal.level=100 · position.altitude=446 · position.satellites=14 ·
--   vehicle.vin='ZFA25000002V34962'
-- Run in Supabase SQL Editor BEFORE deploying this version.

-- 1) Extra CAN/OBD telemetry on each fix (all nullable, filled by lib/flespi
--    normalize() when the device sends them).
alter table public.device_telemetry
  add column if not exists engine_rpm int,                    -- can.engine.rpm
  add column if not exists engine_load_pct double precision,  -- can.engine.load.level (%)
  add column if not exists coolant_temp_c double precision,   -- can.engine.coolant.temperature (°C)
  add column if not exists fuel_consumption double precision, -- can.fuel.consumption (birim gerçek cihazda teyit edilecek)
  add column if not exists power_voltage double precision,    -- external.powersource.voltage (V, araç aküsü/alternatör)
  add column if not exists battery_voltage double precision,  -- battery.voltage (V, cihaz dahili yedek batarya)
  add column if not exists gsm_signal int,                    -- gsm.signal.level (0..100)
  add column if not exists altitude_m double precision,       -- position.altitude (m)
  add column if not exists satellites int,                    -- position.satellites
  add column if not exists dtc_number int;                    -- can.dtc.number (aktif arıza sayısı, her CAN frame'inde)

-- 2) VIN on the vehicle (device reports vehicle.vin). Backfilled opportunistically
--    by the flespi ingest/sync the first time a VIN is seen; only ever set when
--    currently NULL, so a manual value is never overwritten.
alter table public.vehicles
  add column if not exists vin text;                          -- vehicle.vin (ISO 17 hane)

-- 3) Diagnostic Trouble Codes (arıza kodları). The device sends the full active
--    list (can.dtc = [{code, standard}, ...]) only when it CHANGES; the count
--    (can.dtc.number) rides every CAN frame. We keep one ACTIVE row per code and
--    mark it cleared when a fresh snapshot no longer lists it.
create table if not exists public.vehicle_dtc (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  code text not null,                          -- 'P0100'
  standard text,                               -- 'OBDII'
  first_seen timestamptz not null,             -- device RTC when first observed
  last_seen timestamptz not null,              -- device RTC of the latest snapshot listing it
  cleared_at timestamptz,                      -- set when a snapshot no longer lists it (arıza giderildi)
  created_at timestamptz not null default now()
);

-- At most one ACTIVE row per (vehicle, code); a code may recur after clearing,
-- which inserts a fresh row (old one keeps its cleared_at as history).
create unique index if not exists idx_vehicle_dtc_active
  on public.vehicle_dtc(vehicle_id, code)
  where cleared_at is null;

-- List a vehicle's codes newest-first (active card + history).
create index if not exists idx_vehicle_dtc_vehicle
  on public.vehicle_dtc(vehicle_id, last_seen desc);

-- RLS stays OFF (consistent with the rest of the schema): this table is written
-- only by the service-role client inside the flespi ingest/sync routes and read
-- by server components.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  022_dtc_enrichment.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 022
-- DTC zenginleştirme: arızanın İLK görüldüğü andaki araç km'si.
--
-- Fully ADDITIVE + idempotent: tek nullable kolon; mevcut kolon / indeks / akış
-- değişmez. saveDtc yeni bir aktif arıza satırı açarken aracın o anki
-- odometer_km değerini buraya yazar; UI "X gündür aktif · o günden beri Y km"
-- rozetini (güncel odometer − first_seen_odometer_km) bundan türetir. Cihaz o
-- an km raporlamadıysa NULL kalır ve UI "—" gösterir. Eski (migration 021
-- öncesi/sonrası) satırlar NULL kalır — geriye dönük doldurma YOK, çünkü ilk
-- görülme anındaki km artık bilinemez.
-- Run in Supabase SQL Editor BEFORE deploying this version.

alter table public.vehicle_dtc
  add column if not exists first_seen_odometer_km double precision;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  023_vehicle_fleet.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 023
-- Fleet separation: every vehicle belongs to one of two named fleets, 'bordo'
-- or 'mavi'. Map marker colors, list badges and the fleet filter derive from
-- this column. Fully ADDITIVE: one column with a default; no existing flow
-- changes. New vehicles default to 'mavi'. Run in Supabase SQL Editor.
--
-- NOTE: the one-time backfill (which plates are 'bordo') contains real plate
-- numbers and therefore is NOT committed to the repo (privacy rule); it was
-- run separately in the Supabase SQL Editor on 2026-07-17.

alter table public.vehicles
  add column if not exists fleet text not null default 'mavi'
  check (fleet in ('bordo', 'mavi'));


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  024_idle_episodes.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 024: Rölanti EPİZOD modeli (idle_episodes)
-- Cihazın idle.status boolean geçişlerinden bir rölantiyi başlangıç→bitiş→süre
-- olarak modeller. Eski ping modelinin yerine geçer: 25 dk'lık tek rölanti =
-- tek satır + gerçek süre (5 ayrı ping değil). Tamamen additive; vehicle_events /
-- device_telemetry tablolarına DOKUNMAZ. Supabase SQL Editor'da çalıştırılır.
--
-- Durum makinesi (lib/telemetry.ts saveIdleEpisodes):
--   idle.status false→true  = INSERT (started_at, last_seen_at)
--   idle.status true→true   = UPDATE last_seen_at (yeni satır YOK)
--   idle.status true→false  = kapat (end_reason='idle_off')
--   ignition off / hız≥3     = kapat ('ignition_off' / 'moving')
--   sinyal kesik (bekçi)     = kapat (ended_at=last_seen_at, 'gap_timeout')

create table if not exists public.idle_episodes (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  -- İlk idle.status=true görülen an (cihaz 11205 eşiğini geçince true yapar →
  -- "aşırı rölanti" başlangıcı, fiziksel duruştan ~5 dk sonra).
  started_at    timestamptz not null,
  -- idle.status=false / ignition off / hareket / gap ile kapanır.
  -- NULL = hâlâ açık (devam ediyor).
  ended_at      timestamptz,
  -- Açık epizod için "hâlâ rölantide" doğrulayan son telemetri anı. Sinyal
  -- kesilirse epizod bununla kapatılır — gözlemlenmemiş süre asla sayılmaz.
  last_seen_at  timestamptz not null,
  -- Nasıl kapandı; NULL = açık.
  end_reason    text check (end_reason in ('idle_off','ignition_off','moving','gap_timeout')),
  -- Başlangıç konumu (alarm satırı + mini harita); mesajda yoksa NULL.
  latitude      double precision,
  longitude     double precision,
  created_at    timestamptz not null default now()
);

-- KRİTİK değişmez: bir araçta aynı anda EN FAZLA BİR açık epizod. Durum makinesi
-- + dayanıklı durum + iki ingest yolunun (stream+poll) yarış koruması buna yaslanır.
create unique index if not exists uq_idle_open_per_vehicle
  on public.idle_episodes (vehicle_id)
  where ended_at is null;

-- Araç detay "rölanti geçmişi" + alarmlar araç filtresi.
create index if not exists idx_idle_vehicle_time
  on public.idle_episodes (vehicle_id, started_at desc);

-- Alarmlar listesi (tüm filo, en yeni önce).
create index if not exists idx_idle_time
  on public.idle_episodes (started_at desc);

-- RLS: tablo YALNIZ service-role (supabaseAdmin) ile okunur/yazılır; service-role
-- RLS'i bypass eder. Public/anon/authenticated erişimi olmamalı → RLS açık +
-- policy YOK (varsayılan deny).
alter table public.idle_episodes enable row level security;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  025_worker_profile.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 025: Personel dosyası alanları (workers)
-- Gökhan'ın topladığı personel formundaki bilgilerin ~%70'i sisteme girmiyordu
-- (yalnız ad/telefon/plaka vardı). 11 kolon ekler: kişisel, istihdam, ehliyet ve
-- acil-durum bilgileri. Tamamen ADDITIVE ve idempotent; hepsi NULLABLE — kâğıt
-- formlar eksik gelebiliyor, boş alan "girilmedi" demektir. Supabase SQL
-- Editor'da çalıştırılır. (Canlıda 18.07.2026'da uygulandı; bu dosya şema
-- geçmişinin repo kaydıdır.)

alter table public.workers
  add column if not exists birth_date date,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists social_security_no text,
  add column if not exists employment_start date,
  add column if not exists employment_type text
    check (employment_type in ('full_time', 'hourly')),
  add column if not exists license_no text,
  add column if not exists license_expiry date,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_relation text,
  add column if not exists emergency_contact_phone text;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  026_report_rpcs.sql                                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 026
-- Rapor toplulaştırma fonksiyonları (Yakıt + Motor Sıcaklığı raporları, FAZ 3).
--
-- NEDEN RPC: device_telemetry ~258 bin satır. Yakıt ve sıcaklık raporları
-- araç başına ort/min/max, dolum tespiti, kaçak sinyali ve günlük trend ister —
-- bunlar tüm satırların taranmasını gerektirir. Supabase PostgREST'te aggregate
-- fonksiyonları KAPALI (PGRST123), ayrıca 258 bin satır uygulamaya taşınamaz
-- (bkz. lib/reports.ts başlığı). Bu yüzden toplulaştırma Postgres tarafında,
-- indeksli (vehicle_id, recorded_at) tarama ile burada yapılır.
--
-- Tamamen EKLEMELİ ve idempotent: yalnız üç yeni fonksiyon. Hiçbir tablo/kolon/
-- akış değişmez. Fonksiyon yoksa raporlar çökmez — lib/reports.ts hatayı yakalar
-- ve "migrasyon bekliyor" boş durumuna düşer.
--
-- Supabase SQL Editor'da BU SÜRÜMÜ DEPLOY ETMEDEN ÖNCE çalıştırın.
-- (tank_capacity_l kolonu ZATEN VAR ve dolu — burada eklenmez.)

-- ── 1) YAKIT — araç başına yakıt seviyesi (%) istatistikleri ─────────────────
-- fuel_level_pct cihazın gerçek yüzde okumasıdır (CAN can.fuel.level). Dönüş
-- birim-bağımsızdır (yalnız %): litre/L100km çevrimi uygulamada tank_capacity_l
-- ile yapılır, böylece fonksiyon kapasiteden habersiz kalır.
--
-- Eşikler (ayarlanabilir, sabit yorumlu):
--   • DOLUM  : ardışık iki okuma arası +10 puan ve üstü sıçrama = yakıt alımı.
--              (Gerçek dolumlar 20-90 puan sıçrar; +10 gürültüyü eler, 60-80 L
--              tankta ~6-8 L'lik en küçük anlamlı alımı yakalar.)
--   • ŞÜPHELİ DÜŞÜŞ (kaçak/hırsızlık): -8 puan ve üstü düşüş, ARACIN HAREKET
--              ETMEDİĞİ anda (iki okuma arası odometre < 1 km) ve iki okuma 1
--              saatten yakınsa. "Yakıt düştü ama araç 1 km bile gitmedi" güçlü,
--              uydurması zor bir sinyaldir. Odometre yoksa BAYRAK YOK (temkinli:
--              az sayar, uydurmaz). Sürüş tüketimi (hareket hâlinde düşüş) bu
--              sayıya GİRMEZ.
create or replace function public.report_fuel_stats(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  vehicle_id   uuid,
  sample_count bigint,
  avg_pct      double precision,
  min_pct      double precision,
  max_pct      double precision,
  first_pct    double precision,
  last_pct     double precision,
  refill_count bigint,
  refill_pct   double precision,
  drop_count   bigint,
  drop_pct     double precision
)
language sql
stable
as $$
  with base as (
    select
      dt.vehicle_id,
      dt.recorded_at,
      dt.fuel_level_pct::double precision as fuel,
      dt.odometer_km::double precision    as odo
    from public.device_telemetry dt
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.fuel_level_pct is not null
  ),
  -- DE-GLITCH: cihazın CAN dropout'ları yakıtı anlık 0'a düşürüp saniyeler
  -- içinde geri döndürüyor (canlıda görüldü 2026-07: DO-805HK 65→0→65 2 sn'de,
  -- DO-806HK 36→0→0→36 art arda iki sıfır). Böyle V-şekilli geçici çukurlar hem
  -- sahte DOLUM (0→65) hem sahte KAÇAK (65→0) üretir ve tüketimi şişirir. Bir
  -- okuma, hem ÖNCEKİ 30 okumanın hem SONRAKİ 30 okumanın en yükseğinden ≥10 puan
  -- düşükse geçici çukurdur → elenir. Gerçek SÜREKLİ düşüş (çukurdan sonra da düşük
  -- kalır → fwd_max düşük) elenmez, yani gerçek kaçak sinyali korunur.
  --
  -- Pencere neden SATIR (rows) — zaman (range) değil: 30 satır art arda birden çok
  -- sıfır çukurunu da kapsar (okumalar saniyeler arayla akıyor) ve interval-RANGE
  -- çerçevesinin ortam bağımlılığından kaçınır. Eşik 10 = dolum eşiğiyle aynı.
  bounded as (
    select
      b.*,
      max(b.fuel) over (
        partition by b.vehicle_id order by b.recorded_at
        rows between 30 preceding and current row
      ) as bwd_max,
      max(b.fuel) over (
        partition by b.vehicle_id order by b.recorded_at
        rows between current row and 30 following
      ) as fwd_max
    from base b
  ),
  clean as (
    select vehicle_id, recorded_at, fuel, odo
    from bounded
    where not (bwd_max - fuel >= 10 and fwd_max - fuel >= 10)
  ),
  stepped as (
    select
      c.*,
      lag(c.fuel)        over w as prev_fuel,
      lag(c.odo)         over w as prev_odo,
      lag(c.recorded_at) over w as prev_at
    from clean c
    window w as (partition by c.vehicle_id order by c.recorded_at)
  )
  select
    vehicle_id,
    count(*)::bigint                                          as sample_count,
    avg(fuel)                                                 as avg_pct,
    min(fuel)                                                 as min_pct,
    max(fuel)                                                 as max_pct,
    (array_agg(fuel order by recorded_at asc))[1]            as first_pct,
    (array_agg(fuel order by recorded_at desc))[1]           as last_pct,
    count(*) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 10
    )::bigint                                                 as refill_count,
    coalesce(sum(fuel - prev_fuel) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 10
    ), 0)                                                     as refill_pct,
    count(*) filter (
      where prev_fuel is not null
        and prev_fuel - fuel >= 8
        and prev_odo is not null and odo is not null
        and odo - prev_odo < 1
        and extract(epoch from (recorded_at - prev_at)) <= 3600
    )::bigint                                                 as drop_count,
    coalesce(sum(prev_fuel - fuel) filter (
      where prev_fuel is not null
        and prev_fuel - fuel >= 8
        and prev_odo is not null and odo is not null
        and odo - prev_odo < 1
        and extract(epoch from (recorded_at - prev_at)) <= 3600
    ), 0)                                                     as drop_pct
  from stepped
  group by vehicle_id;
$$;

-- ── 2) MOTOR SICAKLIĞI — araç başına soğutma suyu (°C) istatistikleri ────────
-- coolant_temp_c = can.engine.coolant.temperature. hot_count aşırı ısınma
-- eşiğini (≥105 °C) aşan okuma sayısıdır: dizel motorda ~85-95 normal, ~100
-- fan devreye girer, ≥105 uyarı bölgesi. Eşik ayarlanabilir; uydurma risk
-- üretmez — hiçbir okuma aşmıyorsa hot_count 0 döner ("aşırı ısınma yok").
create or replace function public.report_coolant_stats(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  vehicle_id   uuid,
  sample_count bigint,
  avg_c        double precision,
  max_c        double precision,
  min_c        double precision,
  hot_count    bigint
)
language sql
stable
as $$
  select
    vehicle_id,
    count(*)::bigint                                    as sample_count,
    avg(coolant_temp_c)                                 as avg_c,
    max(coolant_temp_c)                                 as max_c,
    min(coolant_temp_c)                                 as min_c,
    count(*) filter (where coolant_temp_c >= 105)::bigint as hot_count
  from public.device_telemetry
  where recorded_at >= p_from
    and recorded_at <= p_to
    and coolant_temp_c is not null
  group by vehicle_id;
$$;

-- ── 3) MOTOR SICAKLIĞI — filo geneli günlük trend (Europe/Vienna) ────────────
-- Trend çizgisi için gün başına ort/max °C. Gün, filonun geri kalanıyla aynı
-- DST-güvenli Vienna gün anahtarıyla hesaplanır.
create or replace function public.report_coolant_daily(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  day          date,
  avg_c        double precision,
  max_c        double precision,
  sample_count bigint
)
language sql
stable
as $$
  select
    (recorded_at at time zone 'Europe/Vienna')::date as day,
    avg(coolant_temp_c)                               as avg_c,
    max(coolant_temp_c)                               as max_c,
    count(*)::bigint                                  as sample_count
  from public.device_telemetry
  where recorded_at >= p_from
    and recorded_at <= p_to
    and coolant_temp_c is not null
  group by (recorded_at at time zone 'Europe/Vienna')::date
  order by day;
$$;

-- Yalnız service-role çağırsın (uygulama bu anahtarla çağırır). PostgREST'in
-- anon/authenticated rolleri telemetri toplamlarına erişmesin.
revoke execute on function public.report_fuel_stats(timestamptz, timestamptz)    from public;
revoke execute on function public.report_coolant_stats(timestamptz, timestamptz) from public;
revoke execute on function public.report_coolant_daily(timestamptz, timestamptz) from public;
grant execute on function public.report_fuel_stats(timestamptz, timestamptz)    to service_role;
grant execute on function public.report_coolant_stats(timestamptz, timestamptz) to service_role;
grant execute on function public.report_coolant_daily(timestamptz, timestamptz) to service_role;

-- PostgREST şema önbelleğini hemen tazele (fonksiyonlar /rpc altında görünsün).
notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  027_fuel_stats_edge_fix.sql                                        ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 027
-- report_fuel_stats: DE-GLITCH UÇ-SATIR DÜZELTMESİ (22.07.2026)
--
-- 026'daki de-glitch iki taraflı koşul arıyordu: bir okuma hem ÖNCEKİ 30 hem
-- SONRAKİ 30 satırın en yükseğinden ≥10 puan düşükse geçici çukur sayılıp
-- eleniyordu. Partition'ın İLK satırında geriye bakan pencere yalnız satırın
-- kendisini içerir → bwd_max = fuel → koşul YAPISAL OLARAK sağlanamaz ve
-- baştaki glitch elenmez. Simetrik olarak SON satırda fwd_max = fuel.
--
-- CANLI ETKİ (ölçüldü, 22.07.2026): DO-512GT'nin aralıktaki ilk okuması %0,
-- 4 saniye sonra %100 → sahte "1 dolum / 60 L" ve min %0. Üç aralıkta da
-- (7 gün / 30 gün / tüm zaman) tek araç, tek olay; filo dolum toplamının
-- 527 L'sinin 60 L'si uydurmaydı. Tüketim rakamı etkilenmiyordu: hayalet dolum
-- (+100 puan) ile hayalet düşük ilk okuma (−100 puan) denge kimliğinde
-- sadeleşiyor. Bozulan yerler: DOLUM kolonu, min/ort seviye, filo dolum toplamı.
--
-- ÇÖZÜM: uçlarda tek taraflı karar. İlk satırda yalnız fwd_max, son satırda
-- yalnız bwd_max yeterli sayılır. ORTADAKİ satırlarda kural DEĞİŞMEZ (iki
-- taraflı) — gerçek sürekli düşüşler (kaçak sinyali) korunur.
--
-- Tek satırlık partition'da rn = 1 dalı çalışır ve fwd_max = fuel olduğu için
-- okuma elenmez: tek bir ölçümden çukur kararı verilemez.
--
-- BİLİNÇLİ OLARAK ÇÖZÜLMEYEN: uzun sıfır SERİLERİ (DO-687GX — 18.07'de 7.801
-- okumanın 1.729'u %0). Bu bir V-çukuru değil, yarı ölü sensördür; 30 satırlık
-- pencere de uç-satır düzeltmesi de onu elemez ve ELEMEMELİ (sürekli sıfır
-- gerçek bir sinyal olabilir). Bu araçlar uygulama katmanında "veri güvenilmez"
-- rozetiyle işaretlenir (lib/reports.ts, UNRELIABLE_ZERO_RATIO).
--
-- 026 GERİYE DÖNÜK DEĞİŞTİRİLMEDİ: onu çalıştırmış kurulumlar bu dosyayı da
-- çalıştırır; sıfırdan kurulanlar 026 → 027 sırasıyla doğru sonuca ulaşır.
-- İdempotent (create or replace), tablo/kolon/akış değişmez.

create or replace function public.report_fuel_stats(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  vehicle_id   uuid,
  sample_count bigint,
  avg_pct      double precision,
  min_pct      double precision,
  max_pct      double precision,
  first_pct    double precision,
  last_pct     double precision,
  refill_count bigint,
  refill_pct   double precision,
  drop_count   bigint,
  drop_pct     double precision
)
language sql
stable
as $$
  with base as (
    select
      dt.vehicle_id,
      dt.recorded_at,
      dt.fuel_level_pct::double precision as fuel,
      dt.odometer_km::double precision    as odo
    from public.device_telemetry dt
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.fuel_level_pct is not null
  ),
  -- DE-GLITCH: cihazın CAN dropout'ları yakıtı anlık 0'a düşürüp saniyeler
  -- içinde geri döndürüyor (canlı: DO-805HK 65→0→65 2 sn'de, DO-806HK
  -- 36→0→0→36). Böyle V-şekilli geçici çukurlar hem sahte DOLUM (0→65) hem
  -- sahte KAÇAK (65→0) üretir ve tüketimi şişirir. Gerçek SÜREKLİ düşüş
  -- (çukurdan sonra da düşük kalır → fwd_max düşük) elenmez.
  --
  -- Pencere SATIR (rows) tabanlı — zaman (range) değil: 30 satır art arda birden
  -- çok sıfır çukurunu kapsar ve interval-RANGE'in ortam bağımlılığından kaçınır.
  --
  -- rn/cnt: partition'ın UÇ satırlarını tanımak için (bkz. başlık).
  bounded as (
    select
      b.*,
      max(b.fuel) over (
        partition by b.vehicle_id order by b.recorded_at
        rows between 30 preceding and current row
      ) as bwd_max,
      max(b.fuel) over (
        partition by b.vehicle_id order by b.recorded_at
        rows between current row and 30 following
      ) as fwd_max,
      row_number() over (
        partition by b.vehicle_id order by b.recorded_at
      ) as rn,
      count(*) over (partition by b.vehicle_id) as cnt
    from base b
  ),
  clean as (
    select vehicle_id, recorded_at, fuel, odo
    from bounded
    where not (
      case
        -- İLK satır: geriye bakacak veri yok → yalnız ileriye bak.
        when rn = 1   then fwd_max - fuel >= 10
        -- SON satır: ileriye bakacak veri yok → yalnız geriye bak.
        when rn = cnt then bwd_max - fuel >= 10
        -- Ortada: kural değişmedi.
        else bwd_max - fuel >= 10 and fwd_max - fuel >= 10
      end
    )
  ),
  stepped as (
    select
      c.*,
      lag(c.fuel)        over w as prev_fuel,
      lag(c.odo)         over w as prev_odo,
      lag(c.recorded_at) over w as prev_at
    from clean c
    window w as (partition by c.vehicle_id order by c.recorded_at)
  )
  select
    vehicle_id,
    count(*)::bigint                                          as sample_count,
    avg(fuel)                                                 as avg_pct,
    min(fuel)                                                 as min_pct,
    max(fuel)                                                 as max_pct,
    (array_agg(fuel order by recorded_at asc))[1]            as first_pct,
    (array_agg(fuel order by recorded_at desc))[1]           as last_pct,
    count(*) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 10
    )::bigint                                                 as refill_count,
    coalesce(sum(fuel - prev_fuel) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 10
    ), 0)                                                     as refill_pct,
    count(*) filter (
      where prev_fuel is not null
        and prev_fuel - fuel >= 8
        and prev_odo is not null and odo is not null
        and odo - prev_odo < 1
        and extract(epoch from (recorded_at - prev_at)) <= 3600
    )::bigint                                                 as drop_count,
    coalesce(sum(prev_fuel - fuel) filter (
      where prev_fuel is not null
        and prev_fuel - fuel >= 8
        and prev_odo is not null and odo is not null
        and odo - prev_odo < 1
        and extract(epoch from (recorded_at - prev_at)) <= 3600
    ), 0)                                                     as drop_pct
  from stepped
  group by vehicle_id;
$$;

revoke execute on function public.report_fuel_stats(timestamptz, timestamptz) from public;
grant  execute on function public.report_fuel_stats(timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  028_test_data_flag.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 028
-- Test şoför / test araç işareti (is_test).
--
-- NEDEN: canlıda bir akışı şoför gözünden denemek için gerçek bir şoförün
-- hesabına girip PIN'ini değiştirmek zorunda kalıyorduk. Artık kalıcı bir test
-- hesabı ve test aracı var; ikisi de HAK61'in hiçbir yönetici yüzeyinde
-- görünmez ama şoför panelinde birebir gerçek gibi çalışır.
--
-- NEDEN AYRI KOLON (is_active / status='inactive' DEĞİL):
--   • is_active=false girişi kırar (app/actions/auth.ts) ve vardiya açmayı
--     kırar (app/actions/shift.ts) → test hesabı işe yaramaz hâle gelir.
--   • vehicles.status='inactive' aracı vardiya başlatmada reddettirir
--     (app/actions/shift.ts: status === "active" şartı).
--   • fleet'e üçüncü değer eklemek workers tarafını çözmez ve FLEET_STYLE
--     rozet/filtre UI'ının her yerine dokunur.
-- is_test bu üçünden de bağımsız: kayıt her yönüyle "canlı" kalır, yalnız
-- yönetici LİSTE okumalarından düşer.
--
-- Tamamen EKLEMELİ ve idempotent: iki yeni kolon, iki kısmi indeks, iki veri
-- satırı. Hiçbir mevcut kolon/akış değişmez, hiçbir satır silinmez.
--
-- ⚠️ SUPABASE SQL EDITOR'DA BU SÜRÜMÜ DEPLOY ETMEDEN ÖNCE ÇALIŞTIRIN.
--    (026'daki kuralın aynısı.) Kolon yokken uygulama çökmez — lib/test-data.ts
--    hatayı yakalayıp boş kümeye düşer, yani panel bugünkü hâliyle çalışmaya
--    devam eder; yalnız test kaydı gizlenmemiş olur.

-- ── 1) Kolonlar ─────────────────────────────────────────────────────────────
alter table public.workers
  add column if not exists is_test boolean not null default false;

alter table public.vehicles
  add column if not exists is_test boolean not null default false;

comment on column public.workers.is_test is
  'true = test hesabı. Yönetici liste okumalarından düşer (lib/test-data.ts); giriş ve şoför paneli normal çalışır.';
comment on column public.vehicles.is_test is
  'true = test aracı. Yönetici liste okumalarından düşer; vardiya açma/kapatma normal çalışır.';

-- Kısmi indeks: test satırları avuç içi kadar, tam indeks israf olur.
create index if not exists idx_workers_is_test
  on public.workers (id) where is_test;
create index if not exists idx_vehicles_is_test
  on public.vehicles (id) where is_test;

-- ── 2-3) Test şoförü + test aracı ───────────────────────────────────────────
--
-- ⚠️ 31.07.2026 — BOŞ VERİTABANI DÜZELTMESİ.
-- Bu bölüm 21.07.2026'da açılmış HAK61 test hesabının UUID'sini DÜZ YAZIYORDU.
-- Sıfırdan kurulan bir veritabanında o kayıt yoktur: update 0 satır etkiler,
-- ardından gelen insert `assigned_worker_id`'ye var olmayan bir UUID yazmaya
-- çalışır ve `vehicles.assigned_worker_id → workers(id)` yabancı anahtarı
-- (migration 009) yüzünden HATA verir. Migration zinciri 028'de durur, 029-040
-- hiç çalışmaz. İkinci müşteri kurulumunda yakalandı.
--
-- Çözüm: kimlik ARANIR, bulunamazsa YARATILIR. Üç aşamalı, sırayla:
--   1. Bilinen HAK61 test hesabı (varsa)  → canlıda bugünkü davranış birebir
--   2. is_test zaten işaretli bir hesap    → tekrar çalıştırmada sabit kalır
--   3. Hiçbiri yoksa yeni test hesabı      → boş veritabanı yolu
--
-- HAK61 canlısında 1. adım eşleşir; update'ler aynı değerleri yazar, araç zaten
-- vardır, insert atlanır. Yani bu düzeltme canlıda TAM NO-OP'tur.
do $$
declare
  v_worker uuid;
begin
  -- 1) Bilinen HAK61 test hesabı.
  select id into v_worker
    from public.workers
   where id = 'fa3841cc-f540-46f5-b170-91daa5e4c005';

  -- 2) Yoksa: zaten işaretlenmiş bir test hesabı (bu migration'ın tekrarı).
  if v_worker is null then
    select id into v_worker
      from public.workers
     where is_test
     order by created_at
     limit 1;
  end if;

  -- 3) O da yoksa: yeni test hesabı. PIN karşılığı olmayan bir bcrypt dizesi
  --    konur — hesap PANELDEN giriş yapabilsin diye VARDIR, ama kurulumcu
  --    PIN'i /admin/workers üzerinden bilinçli olarak belirleyene kadar hiçbir
  --    PIN bu hash'i açmaz. Telefon numarası gerçek bir numarayla ÇAKIŞMAZ.
  if v_worker is null then
    insert into public.workers (name, phone, pin_hash, is_admin, is_active, is_test)
    values (
      'Test Şoför',
      '+430000000001',
      '$2a$10$0000000000000000000000000000000000000000000000000000',
      false,
      true,
      true
    )
    returning id into v_worker;
  end if;

  -- Test şoförü işaretlenir. employee_number NULL'a çekilir:
  -- nextEmployeeNumber() en büyük numarayı baz alıyor (app/actions/workers.ts),
  -- test hesabı sırada durursa gerçek personel numaralandırmasını kaydırır.
  update public.workers
     set is_test         = true,
         employee_number = null,
         plate           = 'TEST-001'  -- vehicles.assigned_worker_id'nin türetilmiş aynası
   where id = v_worker;

  -- Test aracı. Plaka bilerek gerçek DO-* deseninden uzak: bir yerde sızarsa
  -- insan gözü anında yakalasın. Cihaz alanları NULL — gerçek donanım yok,
  -- dolayısıyla device_telemetry / vehicle_events / idle_episodes / vehicle_dtc
  -- tarafında tek satır bile üretmez ve telemetri türevi ekranlarda
  -- kendiliğinden yoktur.
  insert into public.vehicles (
    plate, make, model, year, status, fleet,
    assigned_worker_id, flespi_device_id, imei, tank_capacity_l, notes, is_test
  )
  select
    'TEST-001', 'TEST', 'TEST', null, 'active', 'mavi',
    v_worker, null, null, null,
    'Test aracı — gerçek donanım yok. Yönetici yüzeylerinde gizlidir (is_test).',
    true
  where not exists (
    select 1 from public.vehicles where plate = 'TEST-001'
  );

  -- Kayıt zaten varsa (tekrar çalıştırma) işareti ve atamayı garantiye al.
  update public.vehicles
     set is_test            = true,
         status             = 'active',
         assigned_worker_id = v_worker
   where plate = 'TEST-001';
end $$;

-- PostgREST şema önbelleğini tazele (is_test kolonu /rest altında görünsün).
notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  029_fleet_chief.sql                                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 029
-- Filo şefi rolü: bir çalışan, bir filonun izleme yetkisini alır.
--
-- NEDEN AYRI KOLON, is_admin DEĞİL: filo şefi yönetici DEĞİLDİR. is_admin
-- verilseydi 19 yönetici sayfasının tamamı ve tüm yazma action'ları
-- (adminCloseShiftAction, editEntryAction, adminUpdateKmAction, PIN belirleme)
-- ona da açılırdı; sonra tek tek kapatmak gerekirdi ve yarın eklenecek her yeni
-- sayfa VARSAYILAN OLARAK görünür olurdu (fail-open).
--
-- Bu tasarımda şef is_admin=false kalır: requireAdmin() onu zaten reddeder,
-- yani kapalı sayfalar ve yazma yetkisi HİÇBİR KOD YAZILMADAN kapalıdır
-- (fail-closed). Yalnız iki sayfa (/admin, /admin/harita) yeni bir
-- requireFleetView() kapısıyla açılır ve verisi filoya daraltılır.
--
-- managed_fleet NULL  → normal çalışan (bugünkü herkes)
-- managed_fleet dolu  → o filonun şefi; şoförlüğü aynen devam eder
--
-- CHECK listesi vehicles.fleet ile AYNI tutulur (migration 023). Üçüncü bir
-- filo eklenirse İKİ kısıt da aynı migration'da genişletilmelidir — aksi hâlde
-- yeni filoya şef atanamaz ve hata mesajı bunu söylemez.
--
-- Tamamen EKLEMELİ ve idempotent. Kolon yokken uygulama çökmez:
-- lib/fleet-scope.ts sorgu hatasını yakalayıp "şef yok" durumuna düşer, yani
-- panel bugünkü hâliyle çalışmaya devam eder.
--
-- ⚠️ SUPABASE SQL EDITOR'DA BU SÜRÜMÜ DEPLOY ETMEDEN ÖNCE ÇALIŞTIRIN.
--
-- NOT: kimin hangi filoya şef olduğu GERÇEK KİŞİ VERİSİDİR ve gizlilik kuralı
-- gereği bu dosyada YOKTUR (migration 023'teki plaka backfill'iyle aynı kural).
-- Atama SQL'i ayrıca verildi ve Supabase SQL Editor'da elle çalıştırılır.

alter table public.workers
  add column if not exists managed_fleet text
  check (managed_fleet is null or managed_fleet in ('bordo', 'mavi'));

comment on column public.workers.managed_fleet is
  'Dolu ise bu çalışan o filonun ŞEFİdir: /admin ve /admin/harita sayfalarını yalnız kendi filosunun verisiyle görür. is_admin ile ilgisi yoktur ve yazma yetkisi vermez.';

-- Şef sayısı avuç içi kadar; kısmi indeks yeterli.
create index if not exists idx_workers_managed_fleet
  on public.workers (managed_fleet) where managed_fleet is not null;

-- PostgREST şema önbelleğini tazele (managed_fleet /rest altında görünsün).
notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  030_phone_sanitize.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- ═══ 030_phone_sanitize.sql — UYARLANDI (bkz. dosya başındaki "Sapmalar") ═══
--
-- Özgün dosya HAK61'e özgü bir VERİ ONARIMI: iki çalışanın numarasına yapışmış
-- görünmez Unicode yön işaretlerini (U+202A/U+202C) temizler, öncesinde/sonrasında
-- teşhis SELECT'leri basar. Boş bir veritabanında temizlenecek satır YOKTUR.
--
-- Buraya YALNIZ kalıcı şema parçası alındı: numara biçimi kısıtı (nüks koruması).
--
-- ÇIKARILANLAR ve gerekçesi:
--   • 6 teşhis SELECT'i    → boş DB'de 0 satır; kurulum çıktısını kirletir.
--   • UPDATE workers SET phone = regexp_replace(...) → temizlenecek kayıt yok (no-op).
--   • DELETE FROM login_attempts WHERE identifier LIKE '%8110302%' OR ...
--     → GERÇEK HAK61 telefon parçaları içerir. Başka bir müşterinin kurulum
--       dosyasında bulunmamalı (gizlilik kuralı) ve boş DB'de zaten no-op.
--
-- Kısıt, 028'in yarattığı test hesabının numarasıyla (+430000000001) uyumludur.
alter table public.workers
  drop constraint if exists workers_phone_temiz;

alter table public.workers
  add constraint workers_phone_temiz
  check (phone is null or phone ~ '^\+?[0-9]{6,20}$');



-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  031_worker_leaves.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 031_worker_leaves.sql — İZİN TAKVİMİ (Modül 1)
--
-- İki tablo: worker_leaves (izinler) + leave_edit_log (değişiklik izi).
--
-- TASARIM KARARLARI
--  • ARALIK modeli (per-gün satır DEĞİL): start_date..end_date kapalı aralık.
--    "Bugün izinli mi?" = start_date <= <gün> AND end_date >= <gün> (Viyana günü).
--  • unique(worker_id, day) YOK — Krankenstand yasal olarak Urlaub'u kesebilir;
--    aynı gün iki farklı izin türü meşru bir durumdur. Örtüşme kontrolü
--    uygulama katmanında (app/actions/leaves.ts), DB kısıtıyla değil.
--  • ONAY AKIŞI: filo şefi status='pending' TALEP açar (takvimde silik), patron
--    (is_admin) onaylayınca status='approved' olur (tam renk) ve Günün Panosu'na
--    yansır. Patron doğrudan girerse default 'approved'.
--  • leave_edit_log.leave_id BİLİNÇLİ olarak FK'SIZ: izin silinince silme izi
--    hayatta kalmalı (shift_edit_log deseninin gizli kusuru buydu).
--
-- Gizlilik: bu dosyaya gerçek isim/plaka/kişi verisi YAZMA (yalnız DDL).
-- Idempotent: create ... if not exists — tekrar çalıştırmak güvenli.

create table if not exists public.worker_leaves (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id) on delete cascade,
  leave_type  text not null check (leave_type in (
                'jahresurlaub','krankenstand','pflegefreistellung','unbezahlt',
                'hochzeit','sonderurlaub','todesfall','umzug','geburt','karenz'
              )),
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'approved'
              check (status in ('pending','approved','rejected')),
  note        text,
  created_by  uuid references public.workers(id) on delete set null,
  approved_by uuid references public.workers(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint worker_leaves_range_ck check (end_date >= start_date)
);

create index if not exists idx_worker_leaves_worker
  on public.worker_leaves (worker_id, start_date);
create index if not exists idx_worker_leaves_range
  on public.worker_leaves (start_date, end_date);
create index if not exists idx_worker_leaves_status
  on public.worker_leaves (status);

create table if not exists public.leave_edit_log (
  id         uuid primary key default gen_random_uuid(),
  leave_id   uuid not null,                 -- FK YOK: silme izi hayatta kalsın
  changed_at timestamptz not null default now(),
  changed_by uuid references public.workers(id) on delete set null,
  action     text not null default 'update'
             check (action in ('create','update','delete','approve','reject')),
  field      text not null,                 -- create/delete'te '*'
  old_value  text,
  new_value  text
);

create index if not exists idx_leave_edit_log_leave
  on public.leave_edit_log (leave_id, changed_at desc);

-- Servis-rol istemcisi dışında erişim yok (projedeki diğer tablolarla aynı).
alter table public.worker_leaves  disable row level security;
alter table public.leave_edit_log disable row level security;

-- PostgREST şema önbelleğini yenile (yeni tablolar hemen görünür olsun).
notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  032_worker_terminated.sql                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 032_worker_terminated.sql — İŞTEN ÇIKIŞ (Modül 2)
--
-- workers.terminated_at: personelin SON ÇALIŞMA GÜNÜ. null = çalışıyor.
-- İşten çıkış akışı bu kolonu YAZARKEN is_active=false de yazar; böylece tüm
-- CANLI yüzeyler (Günün Panosu, harita, analiz, seçiciler, auto-shift) mevcut
-- is_active kontrolleriyle personeli kendiliğinden düşürür. terminated_at ise
-- "ne zaman ayrıldı + Eski Personeller arşivi" içindir.
--
-- GEÇMİŞ RAPORLAR: silme YOK — yalnız arşiv. Çalışma süresi/bordro kayıtları
-- Avusturya'da § 132 BAO gereği kaydın ait olduğu takvim yılından itibaren
-- 7 yıl saklanır; ayrılan personelin adı eski AZG/vardiya/yakıt raporlarında
-- görünmeye DEVAM eder (isim evreni sorgularından is_active filtresi kaldırıldı).
--
-- Gizlilik: bu dosyaya gerçek isim yazma (yalnız DDL). Ekrem/Bayram gibi mevcut
-- kayıtların terminated_at'i AYRI bir tek-seferlik UPDATE ile set edilir (repoda
-- değil), çünkü WHERE koşulu gerçek kişi verisi taşır.

alter table public.workers
  add column if not exists terminated_at date;

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  033_device_config_epochs.sql                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 033_device_config_epochs.sql — Aşırı hız eşiği 120→131 dönem kaydı (Modül 5)
--
-- device_config_epochs ZATEN VAR (22.07.2026'da elle kuruldu, alarm eşiği kaydı
-- içeriyor). `create table if not exists` → mevcut tabloya ve VERİSİNE DOKUNMAZ;
-- yalnız temiz bir ortamda tabloyu kurar (repoda migration'ı yoktu, ekleniyor).
--
-- Sonra: aşırı hız uyarı eşiğinin 120'den 131 km/s'e çıktığını işaretleyen bir
-- EPOCH satırı ekler; raporlar bu sınırı aşan trendleri gizler / not düşer
-- (lib/config-epoch.ts). Guard: 11104 için zaten epoch varsa tekrar EKLEMEZ.
--
-- Komut GÖNDERİLDİ: 28 cihaza `setparam 11104:131` + DO-505GS kuyruk düzeltmesi,
-- gönderim anı UTC 2026-07-23T21:38:09Z (flespi commands-queue). Epoch changed_at
-- bu ana SABİTLENDİ — migration'ı ne zaman çalıştırırsan çalıştır sınır doğru
-- kalır (raporlar bu sınırı aşan trendleri gizler / not düşer).

create table if not exists public.device_config_epochs (
  id         uuid primary key default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  params     text,
  note       text
);
alter table public.device_config_epochs disable row level security;

-- ═══ [birleştirici] HAK61'E ÖZEL VERİ SATIRI ÇIKARILDI ═══════════════════
-- Özgün 033, tabloyu kurduktan sonra şu kaydı da yazıyordu:
--   params = '11104: 120->131'
--   note   = 'Asiri hiz uyari esigi 120->131 km/s (28 cihaz + DO-505GS kuyruk…)'
--
-- Bu, HAK61 filosunda 23.07.2026'da yapılan bir cihaz ayarı değişikliğinin
-- kaydıdır: 28 cihazı ve bir HAK61 PLAKASINI (DO-505GS) adlandırır. Yeni bir
-- kurulumda böyle bir eşik değişikliği HİÇ OLMADI; kayıt hem olguyu yanlış
-- anlatır hem başka bir müşterinin verisini taşır.
--
-- CANLI ETKİ (Sendigo kabul testi, 31.07.2026): /admin/alarmlar sayfasında
-- "Seit den neuen Schwellen" (yeni eşiklerden beri) filtresi çıkıyordu —
-- Sendigo'da hiç yaşanmamış bir olaya göre süzme seçeneği.
--
-- Tablo KURULUR (kod onu okuyor, yokluğunda alarm sayfası hata verir);
-- yalnız satır yazılmaz. Yeni müşteri kendi cihaz ayarını değiştirdiğinde
-- kaydı kendisi ekler.

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  034_geofence_purpose.sql                                           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 034_geofence_purpose.sql — DEPO BÖLGESİ (Modül 3)
--
-- geofences.purpose: bölgenin NE İŞE yaradığı (üçüncü eksen). Mevcut alanlar:
--   type      = geometri (yalnız 'circle')
--   rule_kind = ihlal semantiği ('forbidden' / 'allowed_only')
--   purpose   = amaç ('rule' = klasik uyarı bölgesi, 'depot' = depo → panelde
--               "mesaiyi başlat?" önerisi tetikler)
--
-- Additive + idempotent: mevcut satırlar 'rule' olur (davranış değişmez).
-- Tablo yoksa (015 çalıştırılmadıysa) bu migration da başarısız olur — 015'ten
-- sonra çalıştır. Panel okuması best-effort: kolon yoksa öneri sessizce çıkmaz.

alter table public.geofences
  add column if not exists purpose text not null default 'rule'
  check (purpose in ('rule','depot'));

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  035_depot_lock.sql                                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 035_depot_lock.sql — DEPODA VARDİYA KİLİDİ (Modül 6)
--
-- (1) time_entries.location_unverified: vardiya, konum KESİN doğrulanamadan
--     açıldı mı (cihaz-ölü/belirsiz ya da yönetici muafiyeti). Dikkat/Aksiyon
--     panosunda "konum doğrulanmadan başlatıldı" olarak görünür. default false.
--
-- (2) depot_exemptions: yönetici bir şoför için BUGÜNLÜK depo şartını kaldırır
--     (araç serviste, şoför başka yerden başlıyor vb.). O gün o şoförde kilit
--     uygulanmaz ama vardiya "konum doğrulanamadı" işaretlenir.
--
-- Additive + idempotent. Kolon/tablo yoksa uygulama best-effort çalışır:
-- kilit devre dışı gibi davranır, manuel başlatma ASLA kırılmaz.

alter table public.time_entries
  add column if not exists location_unverified boolean not null default false;

create table if not exists public.depot_exemptions (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id) on delete cascade,
  exempt_date date not null,
  created_by  uuid references public.workers(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (worker_id, exempt_date)
);
alter table public.depot_exemptions disable row level security;

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  036_depot_autostart.sql                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 036_depot_autostart.sql — DEPO-TETİKLİ OTOMATİK VARDİYA (Modül 7)
--
-- (1) vehicles.auto_start_enabled: bu araçta depo-tetikli otomatik vardiya açık mı.
--     Paylaşılan/sorunlu araçlarda yönetici kapatır → yalnız elle başlatma
--     (G-riski: yanlış kişi adına vardiya açılmasın). Varsayılan true.
--
-- (2) workers.panel_seen_at: şoför paneli en son ne zaman aktifti (panel açıkken
--     ping'ler). "Vardiya auto açıldı ama şoför 2 saattir panele girmemiş →
--     belki o araçta değil" Dikkat kalemi için (G post-hoc yakalama).
--
-- Additive + idempotent. Kolon yoksa best-effort: auto-shift auto_start_enabled'ı
-- seçemezse motor no-op olur (elle başlatma çalışmaya devam eder), panel_seen_at
-- yoksa ping/Dikkat sessizce atlanır. ⚠️ AUTO açılmadan ÖNCE bu migration çalışmalı.

alter table public.vehicles
  add column if not exists auto_start_enabled boolean not null default true;

alter table public.workers
  add column if not exists panel_seen_at timestamptz;

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  037_manual_shift_start.sql                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 037_manual_shift_start.sql — YÖNETİCİ/ŞEF MANUEL VARDİYA BAŞLATMA (iz)
--
-- Depo-tetikli otomatik vardiya (Modül 7) telemetri düştüğünde açılmaz; o
-- boşlukta vardiyayı yönetici ya da FİLO ŞEFİ personel adına elle başlatır
-- (startShiftForWorkerAction). Bu iki kolon "kim, kimin adına, hangi yolla"
-- sorusunun kalıcı cevabıdır:
--
--   started_by   = eylemi yapan (yönetici/şef) — worker_id ise "kimin adına".
--                  "ne zaman" zaten started_at. shift_edit_log ALAN-değişikliği
--                  için tasarlı (ve SQL'i ayrıca bekliyor); başlatma bir YARATMA
--                  olduğundan buraya kolon olarak yazmak daha temiz ve panele
--                  (Dikkat/Aksiyon) doğrudan kaynak olur.
--   start_source = başlatma yolu: 'self' (şoför kendi), 'auto' (depo tetiği),
--                  'admin' (patron elle), 'chief' (filo şefi elle).
--                  Dikkat panosu YALNIZ 'chief' olanları "şef manuel başlattı"
--                  bildirimi olarak gösterir.
--
-- Additive + idempotent. Kolon yoksa uygulama best-effort: action önce bu
-- kolonlarla insert dener, kolon hatası alırsa kolonsuz tekrar dener (vardiya
-- ASLA iz eksikliğiyle kırılmaz); Dikkat sorgusu error → boş → kalem çıkmaz.
-- ⚠️ Şef manuel başlatma CANLIYA çıkmadan ÖNCE bu migration çalışmalı.

alter table public.time_entries
  add column if not exists started_by uuid references public.workers(id) on delete set null;

alter table public.time_entries
  add column if not exists start_source text not null default 'self'
  check (start_source in ('self', 'auto', 'admin', 'chief'));

-- Bugünkü Dikkat sorgusu start_source='chief' + started_at üzerinden gider.
create index if not exists idx_time_entries_start_source
  on public.time_entries(start_source, started_at);

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  038_start_time_estimated.sql                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 038_start_time_estimated.sql — "KONUM DOĞRULANMADI" BAYRAĞI İKİYE AYRILDI
--
-- Sorun (27.07.2026 canlı teşhis): time_entries.location_unverified TEK bayrak
-- olarak iki bambaşka olguyu taşıyordu (app/actions/shift.ts:295 →
-- `depotGate.unverified || !resolvedStart.verified`):
--
--   (a) ARAÇTAN SİNYAL YOK — cihaz sessiz/ölü, konum gerçekten bilinmiyor.
--   (b) SAAT TAHMİNİ — araç DEPODAYDI (konum doğrulandı), ama started_at depo
--       girişinden türetilemedi; kademe 2 (14 gün ortalaması) ya da 3 ("şimdi")
--       kullanıldı.
--
-- 27.07.2026'da bayrak düşen 8 vardiyanın 7'sinde araç fiilen depodaydı; yani
-- pano "konum doğrulanmadı" derken konum DOĞRULANMIŞTI. Yönetici her sabah
-- gerçek olmayan 7 uyarı okuyordu; asıl olan (DO-505GS, cihaz 11 gündür ölü)
-- aralarında kayboluyordu.
--
-- Bundan sonra:
--   location_unverified  = yalnız (a) — depo kapısı konumu doğrulayamadı
--   start_time_estimated = yalnız (b) — başlangıç anı kestirim
-- İkisi aynı anda da true olabilir (cihaz ölü → hem konum hem saat bilinmez).
--
-- Additive + idempotent. Kolon yoksa uygulama best-effort: action önce iki
-- kolonla update dener, kolon hatası alırsa eski bayrağı tek başına yazar
-- (vardiya ASLA iz eksikliğiyle kırılmaz); pano sorgusu error → boş → kalem
-- çıkmaz.

alter table public.time_entries
  add column if not exists start_time_estimated boolean not null default false;

-- Dikkat panosu sorgusu (start_time_estimated + started_at) üzerinden gider.
create index if not exists idx_time_entries_start_time_estimated
  on public.time_entries(start_time_estimated, started_at);

-- ── GERİYE DÖNÜK AYRIŞTIRMA ────────────────────────────────────────────────
-- Sıra önemli: önce hepsini (b) say, sonra sinyali olanların (a) damgasını kaldır.

-- 1) Eski bayrak düşmüş her kayıt EN AZ (b)'ydi: başlangıç anı ya ortalamadan
--    ya "şimdi"den geliyordu. Hepsine saat-tahmini damgası.
update public.time_entries
   set start_time_estimated = true
 where location_unverified = true
   and start_time_estimated = false;

-- 2) Vardiya başlangıcının çevresinde aracın KONUMLU telemetrisi varsa sinyal
--    vardı → (a) damgası yanlıştı, kaldır. Pencere depo kapısının tazelik
--    eşiğini (90 dk) yansıtır; +30 dk, geri-tarihlenmiş started_at'lerde butona
--    basma anını da kapsamak için.
update public.time_entries te
   set location_unverified = false
 where te.location_unverified = true
   and te.vehicle_id is not null
   and exists (
     select 1
       from public.device_telemetry dt
      where dt.vehicle_id = te.vehicle_id
        and dt.latitude is not null
        and dt.longitude is not null
        and dt.recorded_at between te.started_at - interval '90 minutes'
                               and te.started_at + interval '30 minutes'
   );

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  039_fuel_volume.sql                                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 039_fuel_volume.sql — YAKIT HACMİ (LİTRE) HATTI
--
-- Sorun (27.07.2026 flespi teşhisi): filodaki 6 VW Crafter yakıt seviyesini
-- YÜZDE olarak HİÇ göndermiyor — `can.fuel.level` her satırda NULL. Bu yüzden
-- yakıt raporunda "Veri yok" düşüyorlardı ve "sensörsüz" sanılıyorlardı.
-- Oysa cihaz `can.fuel.volume` ile HACMİ (litre) gönderiyor ve sinyal TEMİZ:
--   DO-776GS 4.193 fix, 23,4–39,8 L, en büyük adım 0,1 L, 95 km'de 15,6 L düşüş
--   DO-753GS · DO-775GS · DO-945HL aynı desen (adım ≤0,5 L)
-- Bizim çekme kodumuz yalnız yüzde adaylarını okuyordu (lib/flespi.ts).
--
-- ⚠️ LİTRE FİLO GENELİNE AÇILMAZ. Hem yüzde hem hacim gönderen 11 araçta
-- hacim ÇÖP: 3 günde 13.872 L "artış", 0↔79 arası binlerce salınım, depo
-- kapasitesinin üstünde değerler (DO-747GU 100 L / kayıt 60 L). O araçlarda
-- yüzde sağlam, litreye ihtiyaç yok. Bu yüzden rapor sırası: YÜZDE varsa yüzde,
-- YOKSA litre — ve litre yolunda gürültü muhafızı var (aşağıdaki max_step_l).
--
-- Additive + idempotent. Kolon yokken uygulama best-effort çalışmaya devam eder
-- (flespi sync insert'i kolon hatasında kolonsuz tekrar dener; rapor RPC'si
-- yoksa litre yolu sessizce kapalı kalır, yüzde yolu aynen çalışır).

alter table public.device_telemetry
  add column if not exists fuel_volume_l numeric;

-- Rapor sorgusu (araç + zaman aralığı + dolu hacim) bu kısmi indeksten gider.
-- Kısmi: satırların çoğunda hacim NULL (yüzde gönderen araçlar), indekse girmez.
create index if not exists idx_device_telemetry_fuel_volume
  on public.device_telemetry (vehicle_id, recorded_at)
  where fuel_volume_l is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- LİTRE İSTATİSTİĞİ — report_fuel_stats'ın hacim ikizi.
--
-- Yüzde sürümüyle AYNI iskelet (de-glitch → adım → toplulaştırma), yalnız
-- eşikler litreye çevrildi:
--   de-glitch çukuru : 10 puan  →  5 L
--   dolum eşiği      : 10 puan  →  5 L
-- ve BİR ALAN EKLENDİ: max_step_l = ardışık iki okuma arasındaki en büyük
-- MUTLAK sıçrama. Gürültü muhafızı bunu kullanır: >5 L ise o aracın litresi
-- güvenilmez sayılır ve rapor "Veri yok"a düşer (uydurma sayı göstermez).
-- Ölçüm: temiz araçlarda max_step 0,1–1,0 L; çöp araçlarda 30–79 L.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.report_fuel_volume_stats(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  vehicle_id   uuid,
  sample_count bigint,
  avg_l        double precision,
  min_l        double precision,
  max_l        double precision,
  first_l      double precision,
  last_l       double precision,
  refill_count bigint,
  refill_l     double precision,
  drop_count   bigint,
  drop_l       double precision,
  max_step_l   double precision
)
language sql
stable
as $$
  with base as (
    select
      dt.vehicle_id,
      dt.recorded_at,
      dt.fuel_volume_l::double precision as fuel,
      dt.odometer_km::double precision   as odo
    from public.device_telemetry dt
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.fuel_volume_l is not null
  ),
  bounded as (
    select
      b.*,
      max(b.fuel) over (
        partition by b.vehicle_id order by b.recorded_at
        rows between 30 preceding and current row
      ) as bwd_max,
      max(b.fuel) over (
        partition by b.vehicle_id order by b.recorded_at
        rows between current row and 30 following
      ) as fwd_max
    from base b
  ),
  clean as (
    select vehicle_id, recorded_at, fuel, odo
    from bounded
    where not (bwd_max - fuel >= 5 and fwd_max - fuel >= 5)
  ),
  stepped as (
    select
      c.*,
      lag(c.fuel) over w as prev_fuel,
      lag(c.odo)  over w as prev_odo
    from clean c
    window w as (partition by c.vehicle_id order by c.recorded_at)
  )
  select
    vehicle_id,
    count(*)::bigint                                as sample_count,
    avg(fuel)                                       as avg_l,
    min(fuel)                                       as min_l,
    max(fuel)                                       as max_l,
    (array_agg(fuel order by recorded_at asc))[1]   as first_l,
    (array_agg(fuel order by recorded_at desc))[1]  as last_l,
    count(*) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 5
    )::bigint                                       as refill_count,
    coalesce(sum(fuel - prev_fuel) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 5
    ), 0)                                           as refill_l,
    -- ŞÜPHELİ DÜŞÜŞ: araç HAREKET ETMEDEN (odometre ilerlemeden) ≥5 L düşüş.
    -- Odometre yoksa bayrak YOK (temkinli: az sayar, uydurmaz).
    count(*) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 5
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    )::bigint                                       as drop_count,
    coalesce(sum(prev_fuel - fuel) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 5
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    ), 0)                                           as drop_l,
    coalesce(max(abs(fuel - prev_fuel)) filter (where prev_fuel is not null), 0)
                                                    as max_step_l
  from stepped
  group by vehicle_id;
$$;

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  040_shift_edit_log.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 040
-- VARDİYA DÜZENLEME İZİ (shift_edit_log).
--
-- NEDEN ŞİMDİ: tablo 22.07.2026'da tasarlandı ve `lib/shift-edit-log.ts`
-- yazıldı, ama SQL hiçbir migration'a girmedi — canlıda elle çalıştırılacaktı
-- ve çalıştırılmadı. Kod "tablo yoksa sessiz geç" desenli olduğu için hata
-- vermedi; iz sessizce hiç tutulmadı. İkinci müşteri kurulumunda aynı boşluk
-- tekrar edecekti (31.07.2026 taraması).
--
-- NE İŞE YARAR: AZG raporu YALNIZ üç alandan beslenir — started_at, ended_at,
-- break_minutes — ve üçü de yöneticinin serbestçe değiştirebildiği alanlardır.
-- Bu tablo olmadan bir denetimde "bu çalışma saati neden değişti?" sorusu
-- cevapsız kalır. Düzenleme YASAKLANMIYOR (gerçek hatalar düzeltilebilmeli);
-- yapılan şey düzeltmeyi görünür ve geri izlenebilir kılmak.
--
-- HAK61 ETKİSİ: tamamen EKLEMELİ. Bu migration çalıştırılmadan da uygulama
-- bugünkü gibi çalışır (kod tabloyu yoklar, yoksa boş döner). Çalıştırıldıktan
-- SONRA düzenlemeler kaydedilmeye başlar — bugüne kadar yapılmış düzenlemeler
-- geriye dönük ÜRETİLEMEZ (eski değer hiçbir yerde saklanmamıştı).
--
-- Idempotent: tablo/indeks IF NOT EXISTS.

create table if not exists public.shift_edit_log (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  changed_at timestamptz not null default now(),
  -- Düzenleyen yönetici. Personel kaydı silinirse iz KALIR (set null):
  -- § 132 BAO 7 yıl saklama, izin kendisi kayıttan bağımsızdır.
  changed_by uuid references public.workers(id) on delete set null,
  -- lib/shift-edit-log.ts TRACKED listesindeki alan adı. Serbest metin:
  -- izlenen alan kümesi kodda değişebilir, eski satırlar okunabilir kalmalı.
  field text not null,
  old_value text,
  new_value text
);

comment on table public.shift_edit_log is
  'Vardiya alanlarının elle düzeltilme izi (AZG denetim dayanağı). Yazan: lib/shift-edit-log.ts logShiftEdit().';

-- Bir vardiyanın geçmişi (listShiftEdits) — en sık sorgu, changed_at sırasıyla.
create index if not exists idx_shift_edit_log_entry
  on public.shift_edit_log (time_entry_id, changed_at desc);

-- PostgREST şema önbelleğini tazele (tablo /rest altında görünsün).
notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
--  BİTTİ — şema hazır.
-- ═══════════════════════════════════════════════════════════════════════════
commit;
