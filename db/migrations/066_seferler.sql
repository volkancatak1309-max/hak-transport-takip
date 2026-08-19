-- HAK61 — Migration 066 (SEFER / GÖREV ATAMA — Tur 1 temeli)
-- =====================================================================
-- Yönetici gün için sefer oluşturur, şoföre atar; şoför telefonda görür ve
-- durum çizgisini ilerletir. Additive + idempotent; mevcut hiçbir tabloya
-- DOKUNULMAZ. Supabase SQL Editor'da çalıştırın.
--
-- ⚠️ NUMARA: 064/065 diğer zincirde (FAZ C müşteri bölgesi + telemetri partisi).
-- Bu dosya o zincirden BAĞIMSIZ: zone_visits'e ne yazar ne okur.
--
-- ═══ NEDEN `assignments` (006) KULLANILMIYOR ═══
--
-- 006'daki tablo bir "çoklu duraklı sipariş" modeli: stops jsonb, start_km/
-- end_km, kategori (lieferung/abholung/kurier/verteilung), Telegram bildirim
-- damgası. Canlıda 0 satır — hiç kullanılmadı. Onaylanan model ise DURAK
-- LİSTESİ OLMAYAN, gün eksenli sade bir sefer. Eski tabloyu bu şekle zorlamak
-- kullanılmayan altı alanı taşımak ve durum makinesini (assigned/started/
-- completed/cancelled) yeniden yazmak demekti. 006 OLDUĞU GİBİ bırakılıyor;
-- panelin /admin/seferler sayfası bugünkü hâliyle çalışmaya devam eder.
--
-- ═══ NEDEN `tarih date`, timestamptz DEĞİL ═══
--
-- Sefer bir GÜN birimidir ("19 Ağustos, Wolfurt bölgesi, Ahmet"). Saatli bir
-- alan, olmayan bir kesinlik vaat ederdi ve kiracı diliminde (Europe/Vienna)
-- gün sınırı sorusunu her okumada yeniden doğururdu. Durumun NE ZAMAN
-- değiştiği ayrı damgalarda zaten saatli tutuluyor.
--
-- ═══ TEST VERİSİ ELEMESİ İÇİN KOLON YOK — BİLEREK ═══
--
-- Depodaki desen `worker_id` üzerinden eler (`lib/test-data.ts`
-- withoutTestRows(q, "worker_id", scope.workerIds)). `seferler.worker_id`
-- zorunlu olduğu için aynı süzgeç buraya da uygulanır; ikinci bir `is_test`
-- kolonu iki ayrı gerçek doğururdu.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Tabloya yalnız service-role
-- istemcisi yazar; okuma sunucu bileşenleri ve /api/mobile uçları üzerinden.
-- =====================================================================

begin;

create table if not exists public.seferler (
  id uuid primary key default gen_random_uuid(),

  -- Operasyon günü (kiracı takvimi). Sefer bir GÜN birimidir.
  tarih date not null,

  -- Kime atandı. Sefer şoförsüz var olamaz.
  worker_id uuid not null references public.workers(id) on delete cascade,

  -- Hangi araçla. Atama anında belli olmayabilir; araç silinirse sefer kalır.
  vehicle_id uuid references public.vehicles(id) on delete set null,

  -- Hedef bölge (geofences). Tur 1'de yalnız YAPISAL bağ: hiçbir motor bunu
  -- okumuyor. Otomatik "varıldı" köprüsü (zone_visits) Tur 3'ün işi.
  -- Bölge silinirse sefer kaybolmaz, hedefi boşalır.
  zone_id uuid references public.geofences(id) on delete set null,

  -- Planlanan paket adedi. null = hedef verilmedi (0 DEĞİL).
  paket_hedef integer check (paket_hedef is null or paket_hedef >= 0),

  -- Serbest not. ⚠️ Kolon adı `notlar`: `not` PostgreSQL'de REZERVE kelime,
  -- kolon adı olarak her yerde çift tırnak isterdi.
  notlar text,

  -- ── DURUM ÇİZGİSİ ────────────────────────────────────────────────────
  -- atandi → kabul → yolda → tamamlandi   (+ iptal: yalnız yönetici)
  -- "Reddet" YOK (Volkan kararı 3): şoför seferi reddedemez.
  durum text not null default 'atandi'
    check (durum in ('atandi','kabul','yolda','tamamlandi','iptal')),

  -- Her geçişin anı ayrı damgada: "ne zaman kabul etti", "yola ne zaman
  -- çıktı" soruları tek bir updated_at'ten cevaplanamaz.
  atandi_at     timestamptz not null default now(),
  kabul_at      timestamptz,
  yolda_at      timestamptz,
  tamamlandi_at timestamptz,
  iptal_at      timestamptz,

  -- Seferi kim oluşturdu (yalnız yönetici). Hesap silinirse sefer kalır.
  created_by uuid references public.workers(id) on delete set null,

  created_at timestamptz not null default now()
);

-- Günün seferleri: mobil listenin birincil sorgusu (tarih + şoför).
create index if not exists idx_seferler_tarih_worker
  on public.seferler (tarih desc, worker_id);

-- Şoförün AÇIK seferleri — kapanmış/iptal satırlar indekse hiç girmez.
create index if not exists idx_seferler_acik
  on public.seferler (worker_id, tarih)
  where durum in ('atandi','kabul','yolda');

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorgusu):
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='seferler'
--    order by ordinal_position;
--
--   → 15 satır: id, tarih, worker_id, vehicle_id, zone_id, paket_hedef,
--     notlar, durum, atandi_at, kabul_at, yolda_at, tamamlandi_at, iptal_at,
--     created_by, created_at
--
--   select count(*) from public.seferler;   → 0
-- =====================================================================
