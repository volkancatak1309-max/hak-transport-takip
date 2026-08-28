-- HAK61 / Galzura Fleet — Migration 094 (LİTRE HATTI ARAÇ EKSENİNE)
-- =====================================================================
-- Additive + idempotent. Supabase SQL Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 HİÇBİR ŞEY DEĞİŞTİRMEZ, HİÇBİR ŞEY SİLMEZ
-- ═══════════════════════════════════════════════════════════════════════
--
-- Tek işi YENİ bir fonksiyon eklemek: `report_fuel_volume_stats_vehicle`.
-- 039'un `report_fuel_volume_stats`i **AYNEN DURUYOR** — hem geri düşüş yolu
-- olarak (uygulama katmanı önce yeniyi dener, yoksa eskiye düşer) hem de
-- migration'ı henüz koşmamış kiracılar için. Tablo/kolon/indeks/veri
-- DEĞİŞMEZ.
--
-- ═══════════════════════════════════════════════════════════════════════
-- NEDEN — ÖLÇÜLDÜ (HAK61 canlı, 28.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 052 yüzde hattını (`report_fuel_stats` → `report_fuel_stats_vehicle`)
-- araç eksenine çevirdi. **Litre hattı o dönüşümü almadı** ve kapsamsız tek
-- gövde olarak kaldı (`lib/reports.ts:1086`), üstelik her yakıt raporu
-- render'ında KOŞULSUZ çağrılıyor:
--
--     report_fuel_volume_stats (28 gün, kapsamsız)  : 5.086 / 4.582 ms
--     report_fuel_stats_vehicle ×30 + mapBounded(6) : duvar 4.525 ms,
--                                                     en kötü ifade 2.182 ms
--
-- Ve bu maliyet YEDİ YERDEN birden ödeniyor. `co2Panosu()` tek başına
-- 7 tam `buildFuelReport` koşturuyor (1 seçili aralık + 6 aylık seri,
-- `lib/co2-db.ts:415`), yani bu fonksiyon tek bir CO₂ panosu açılışında
-- 7 kez çağrılıyor: ölçüldü, co2Panosu = 1.115 çağrı / 36,7 sn.
--
-- Ayrıca ZAMAN AŞIMI KAPISI: yüzde ikizi 46 günlük pencerede zaten
-- `57014` alıyor (ölçüldü). Kapsamsız litre gövdesi aynı duvara koşuyor;
-- araç ekseni her aracı KENDİ ifade bütçesine alarak bunu kapatıyor —
-- statement timeout ÇAĞRIYA değil İFADEYE uygulanır (052'nin dersi).
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔑 GÖVDE BİREBİR AYNI — TEK FARK BİR `where` SATIRI
-- ═══════════════════════════════════════════════════════════════════════
--
-- Aşağıdaki fonksiyon 039'un gövdesinin KOPYASIDIR. Değişen tek şey:
--
--     +  where dt.vehicle_id = p_vehicle_id
--
-- `partition by b.vehicle_id` / `partition by c.vehicle_id` ve
-- `group by vehicle_id` BİLEREK KORUNDU. Tek araçlık girdide bunlar
-- işlevsizdir (tek bölüm) ama silmek gövdeyi 039'dan ayırırdı ve iki
-- fonksiyonun zamanla ayrışmasına kapı açardı. Aynı kalsınlar ki fark
-- `diff` ile bir satır olarak görülebilsin.
--
-- ⚠️ 052'nin YÜZDE tarafındaki "UÇ SATIR KURALI" (027, `rn = 1` / `rn = cnt`)
-- buraya EKLENMEDİ. 039'un litre gövdesinde o kural HİÇ YOKTU; eklemek
-- sonucu değiştirirdi. Bu migration davranış değiştirmez, yalnız kapsar.
--
-- EŞDEĞERLİK KANITI: yerel PostgreSQL 15 konteynerinde, HAK61'den salt
-- okumayla çekilmiş GERÇEK telemetri üzerinde eski ve yeni fonksiyon
-- araç araç koşturulup 12 çıktı kolonunun tamamı karşılaştırıldı.
-- Sonuç ve yöntem: `docs/YAKIT-ARAC-EKSENI.md` § 3.

begin;

create or replace function public.report_fuel_volume_stats_vehicle(
  p_from       timestamptz,
  p_to         timestamptz,
  p_vehicle_id uuid
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
    where dt.vehicle_id = p_vehicle_id
      and dt.recorded_at >= p_from
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

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- İNDEKS: YENİSİ GEREKMİYOR — VAR OLAN BİRİ NİHAYET KULLANILACAK
-- =====================================================================
--
-- 039 şunu kurmuştu:
--   idx_device_telemetry_fuel_volume
--     on device_telemetry (vehicle_id, recorded_at)
--     where fuel_volume_l is not null
--
-- 049 kendi başlığında bu indeksin BOŞTA kaldığını yazıyor: "039'un indeksi
-- vehicle_id ile başlıyor, fonksiyon ise yalnız recorded_at süzüyor". Yeni
-- fonksiyon tam olarak `(vehicle_id, recorded_at)` ile seek ediyor, yani
-- 039'un indeksi ilk kez amacına hizmet edecek. Yeni indeks EKLENMEDİ.
--
-- 049'un `idx_device_telemetry_fuel_volume_time` indeksi de DURUYOR:
-- kapsamsız 039 fonksiyonu (geri düşüş yolu) hâlâ ona dayanıyor.

-- =====================================================================
-- 🔴 GERİ ALMA
-- =====================================================================
--
-- Tek cümle. Uygulama katmanı `missing_function` sınıflandırmasıyla
-- otomatik olarak kapsamsız 039 yoluna düşer — yani fonksiyonu düşürmek
-- yakıt raporunu BOZMAZ, yalnız eski (yavaş) yola döndürür.
--
--   drop function if exists public.report_fuel_volume_stats_vehicle(
--     timestamptz, timestamptz, uuid
--   );
--   notify pgrst, 'reload schema';
--
-- Kod tarafını geri almak GEREKMEZ; ama istenirse `lib/reports.ts` içindeki
-- litre bloğu tek `supabaseAdmin.rpc("report_fuel_volume_stats", …)`
-- çağrısına döndürülür (git: bu migration'la aynı commit).

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL
-- =====================================================================
--
--   select proname, pronargs from pg_proc
--    where proname like 'report_fuel_volume_stats%';
--   → 2 satır:  report_fuel_volume_stats          (2 argüman, 039 — DURUYOR)
--               report_fuel_volume_stats_vehicle  (3 argüman, YENİ)
--
--   -- Eşdeğerlik: iki fonksiyon aynı aralıkta aynı sayıyı vermeli.
--   with eski as (
--     select * from public.report_fuel_volume_stats(
--       now() - interval '28 days', now())
--   ),
--   yeni as (
--     select (public.report_fuel_volume_stats_vehicle(
--              now() - interval '28 days', now(), v.id)).*
--     from public.vehicles v where v.flespi_device_id is not null
--   )
--   select
--     count(*) filter (where y.vehicle_id is null) as yenide_eksik,
--     count(*) filter (where e.vehicle_id is null) as eskide_eksik,
--     count(*) filter (where e.refill_l  is distinct from y.refill_l)  as refill_farkli,
--     count(*) filter (where e.drop_l    is distinct from y.drop_l)    as drop_farkli,
--     count(*) filter (where e.sample_count is distinct from y.sample_count) as sayim_farkli
--   from eski e full outer join yeni y using (vehicle_id);
--   → BEŞ SÜTUN DA 0 OLMALI. Değilse kodu deploy ETMEYİN.
--
-- MEVCUT VERİYE ETKİSİ: **SIFIR SATIR** değişir. Bu migration yalnız bir
-- fonksiyon ekler.
-- =====================================================================
