-- 064 — MÜŞTERİ BÖLGESİ + ZİYARET ÖLÇÜMÜ (FAZ C)
-- =====================================================================
-- "Bölgede geçirilen süre raporu (faturalama kanıtı)" — GOLD paketinde
-- zaten satılan özelliğin veri katmanı.
--
-- ⚠️ 063 (geofences.category) uygulanmış olmalı. Numara 063 dolu → 064.
--
-- ═══ NEDEN `purpose`, `category` DEĞİL (Volkan kararı B, 19.08.2026) ═══
--
-- 063 iki ekseni ayırdı ve gerekçesi ölçülmüştü:
--     category = GÖRSEL rozet — MOTOR OKUMAZ, mobil serbestçe yazar
--     purpose  = DAVRANIŞ anahtarı
--
-- Ziyaret ölçümü `category='customer'`e bağlansaydı, mobil uygulamada bir
-- kategori açılır menüsüne dokunmak FATURALAMA KANITI üretimini sessizce
-- başlatır ya da durdururdu — hata mesajı olmadan. 063 tam olarak bu kaza
-- sınıfını önlemek için yazılmıştı (son 30 günde 511 vardiyanın %68'i depo
-- tetiğiyle açılıyor); aynı tehlike burada en yüksek bahisli tüketiciye,
-- müşteri faturasına dokunuyor.
--
-- Volkan'ın kararı ve gerekçesi:
--   "ÖLÇÜM DAVRANIŞTIR, ROZET DEĞİL; FATURA KANITI TELEFON MENÜSÜNDEN
--    DEĞİŞEMEZ."
--
-- Sonuç: bir bölge, `purpose='customer'` ise müşteri sahasıdır.
-- `category='customer'` rozeti YANINDA durur (panel ikisini birlikte yazar).
-- Mobil `purpose` YAZAMIYOR (lib/geofences-db.ts, bilinçli) → ölçüm yalnız
-- panelden, bilerek açılabilir.
--
-- 063'ün saydığı depo tehlikesi BURADA YOK: 'customer' hiçbir mevcut satırda
-- olmayan YENİ bir değer; purpose='depot' satırlarına dokunulmuyor ve o beş
-- depo davranışı (otomatik vardiya tetiği, depo kilidi, başlangıç anı türetme,
-- şoför paneli rozeti, kural muafiyeti) aynen çalışmaya devam ediyor.
-- =====================================================================

begin;

-- ── 1) purpose'a 'customer' ──────────────────────────────────────────
-- 034 kısıtı kolon tanımının İÇİNDE açmıştı (adı Postgres tarafından
-- üretildi). Adı varsaymak yerine purpose üzerindeki CHECK kısıtı BULUNUP
-- düşürülüyor — migration tekrar çalıştırılabilir kalsın.
do $$
declare k text;
begin
  select con.conname into k
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public'
     and rel.relname = 'geofences'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%purpose%'
   limit 1;
  if k is not null then
    execute format('alter table public.geofences drop constraint %I', k);
  end if;
end $$;

alter table public.geofences
  add constraint geofences_purpose_check
  check (purpose in ('rule','depot','customer'));

-- ── 2) Müşteri kimliği ───────────────────────────────────────────────
-- Ayrı müşteri TABLOSU açılmıyor: bugün "müşteri kaydı" diye bir kavram yok,
-- iki kolon yetiyor. Gerekirse sonra ilişkiye çevrilir; şimdiden tablo açmak
-- kullanılmayan bir yapıyı bakım yüküne çevirirdi.
alter table public.geofences
  add column if not exists customer_name text,
  add column if not exists customer_ref  text;

-- ── 3) Histerezis eşiği ──────────────────────────────────────────────
-- Depo tetiği 3 dakika kullanıyor. Müşteri sahası için AYRI ve ayarlanabilir
-- olmalı: bir teslimat 90 saniye sürebilir ve 3 dakikalık eşik onu TAMAMEN
-- kaçırırdı. Varsayılan 120 sn (Volkan onayı).
-- Çok kısa seçilirse yoldan geçiş "ziyaret" sayılır ve FATURAYA girer —
-- bu bir fatura doğruluğu ayarıdır, kozmetik değil.
alter table public.geofences
  add column if not exists min_dwell_s integer not null default 120
  constraint geofences_min_dwell_pos check (min_dwell_s > 0);

-- ── 4) ZİYARET EPİZODLARI ────────────────────────────────────────────
-- idle_episodes'un (024) birebir kardeşi. Aynı ilke: GÖZLEMLENMEMİŞ SÜRE
-- ASLA SAYILMAZ. Süre daima ended_at - started_at; "şu an - started_at"
-- HİÇBİR YERDE hesaplanmaz.
create table if not exists public.zone_visits (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id)  on delete cascade,
  zone_id      uuid not null references public.geofences(id) on delete cascade,
  -- Ziyaret anındaki şoför. Araç el değiştirirse GEÇMİŞ BOZULMASIN diye
  -- burada donduruluyor (vehicles.assigned_worker_id'den türetilmiyor).
  worker_id    uuid references public.workers(id) on delete set null,
  -- Histerezis dolduğu an — yoldan geçiş değil, GERÇEK varış.
  started_at   timestamptz not null,
  -- NULL = araç hâlâ içeride.
  ended_at     timestamptz,
  -- İçeride olduğunu doğrulayan SON telemetri. Sinyal kesilirse ziyaret
  -- bununla kapanır; sinyalsiz geçen süre faturaya girmez.
  last_seen_at timestamptz not null,
  end_reason   text check (end_reason in ('exit','gap_timeout','shift_end')),
  created_at   timestamptz not null default now(),
  -- Bitmiş ziyaret geriye akamaz.
  constraint zone_visits_sira check (ended_at is null or ended_at >= started_at)
);

-- KRİTİK DEĞİŞMEZ: araç + bölge başına EN FAZLA BİR açık ziyaret.
-- idle_episodes'un uq_idle_open_per_vehicle deseninin aynısı: iki ingest yolu
-- (stream + poll) yarışırsa veritabanı reddeder, kod yarışı çözer.
create unique index if not exists uq_zone_visit_open
  on public.zone_visits (vehicle_id, zone_id)
  where ended_at is null;

-- Rapor okuması: "şu tarih aralığında şu bölgedeki ziyaretler".
create index if not exists idx_zone_visits_zone_time
  on public.zone_visits (zone_id, started_at desc);
-- Tur okuması: açık ziyaretlerin tamamı (tur başına TEK sorgu).
create index if not exists idx_zone_visits_open
  on public.zone_visits (vehicle_id)
  where ended_at is null;

-- RLS — kardeş tablo `idle_episodes` (024) ile BİREBİR aynı duruş:
-- tablo yalnız service-role (supabaseAdmin) ile okunur/yazılır ve service-role
-- RLS'i bypass eder. public/anon/authenticated erişimi OLMAMALI →
-- RLS AÇIK + policy YOK (varsayılan deny).
-- Kasadaki kural (17 Tem): yeni migration'da RLS zorunlu.
alter table public.zone_visits enable row level security;

commit;

notify pgrst, 'reload schema';
