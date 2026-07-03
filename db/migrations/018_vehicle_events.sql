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
