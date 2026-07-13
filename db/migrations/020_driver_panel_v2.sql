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
