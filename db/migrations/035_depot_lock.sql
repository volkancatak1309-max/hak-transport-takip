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
