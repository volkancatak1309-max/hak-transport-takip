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
