-- 053 — SOĞUK CACHE ZAMAN AŞIMI: ARAÇ EKSENLİ KAPSAYAN İNDEKSLER
--
-- ═══ NEDEN (canlıda ölçüldü, 09.08.2026, HAK61 üretim) ═══
--
-- İki fonksiyon da soğukta statement timeout (57014) alıyor, SICAKTA almıyor:
--
--   shift_odometer_spans (30 gün)   1. çağrı 8.290 ms → 57014
--                                   2. çağrı 1.198 ms → 373 vardiya
--   report_fuel_stats_vehicle       soğuk turda 30 aracın 12'si 57014
--                                   sıcak turda 30/30, 5.512 ms
--
-- 7 katlık soğuk/sıcak farkı CPU değil DİSK imzasıdır. Aynı sorgu, aynı satır,
-- aynı plan — tek fark sayfaların bellekte olup olmaması.
--
-- ═══ SEBEP: OKUNAN KOLONLAR HİÇBİR İNDEKSTE YOK ═══
--
-- Bugünkü device_telemetry indeksleri:
--   014  (vehicle_id, recorded_at) unique                    — INCLUDE YOK
--   014  (flespi_device_id, recorded_at desc)
--   039  (vehicle_id, recorded_at) where fuel_volume_l is not null
--   049  (recorded_at) include(vehicle_id, fuel_level_pct, odometer_km)
--          where fuel_level_pct is not null                  — recorded_at BAŞTA
--
-- İki fonksiyon da ARAÇ + ZAMAN süzüp odometer_km / fuel_level_pct OKUYOR.
-- Araç-eksenli tek indeks 014 ve o hiçbir veri kolonu taşımıyor → eşleşen her
-- satır için HEAP'e gitmek zorunlu. shift_odometer_spans'ın iki LATERAL'i
-- 373 vardiya × 2 = 746 ayrı seek yapar; soğukta 746 rastgele disk okuması
-- ≈ 8 sn. Ölçülen sayı tam olarak bu.
--
-- 049 bu iki fonksiyonu KURTARMAZ: recorded_at başta olduğu için araç-eksenli
-- erişimde ya kullanılamaz ya da aralığın TÜM filo satırını (687.111) tarayıp
-- vehicle_id'yi INCLUDE'dan süzmek zorunda kalır.
--
-- ═══ ÇÖZÜM ═══
--
-- 039'un LİTRE hattı için yaptığının aynısını yüzde ve odometre hatları için
-- yapmak: araç-eksenli KISMİ + KAPSAYAN indeks. Böylece ilgili taramalar
-- index-only olur, heap'e hiç gidilmez, soğuk turda rastgele disk okuması
-- ortadan kalkar.
--
-- Kısmi (where ... is not null) çünkü fonksiyonlar zaten yalnız dolu satırla
-- ilgileniyor: odometer_km 1.038.145 satırın bir kısmında, fuel_level_pct
-- 687.111'inde dolu. Kısmi indeks hem küçük hem tam olarak sorgunun süzgeciyle
-- örtüşüyor.
--
-- ⚠️ BU MIGRATION UYGULANMASA DA KOD DOĞRU ÇALIŞIR: uygulama tarafında
-- eşzamanlılık tavanı (lib/db-fanout.ts, mapBounded=6) ve zaman aşımında tek
-- seferlik tekrar (retryOnTimeout) zaten devrede. Bu indeksler o iki muhafızın
-- YERİNE değil, ALTINA konur — muhafızlar kusuru yönetir, indeks kusuru
-- kaynağında keser.
--
-- ⚠️ CANLIDA KESİNTİSİZ İSTENİRSE: her create index'i `concurrently` ile ve
-- AYRI çalıştırın (CONCURRENTLY transaction bloğunda çalışmaz). Düz sürüm
-- ~3-8 sn ACCESS EXCLUSIVE kilidi alır; flespi sync upsert'i idempotent olduğu
-- için o pencerede kaçan tur bir sonraki turda kapanır.
--
-- Additive + idempotent. Hiçbir veri değişmez, hiçbir fonksiyon değişmez.

-- ── 1) ODOMETRE HATTI — shift_odometer_spans + getVehicleDistanceSpan ────────
-- Fonksiyon (vehicle_id, recorded_at) ile seek edip odometer_km okuyor.
-- INCLUDE ile bu tek seek index-only olur.
create index if not exists idx_device_telemetry_vehicle_odo
  on public.device_telemetry (vehicle_id, recorded_at)
  include (odometer_km)
  where odometer_km is not null;

-- ── 2) YÜZDE HATTI — report_fuel_stats_vehicle ──────────────────────────────
-- 049'un araç-eksenli ikizi. 049 DURUYOR: araç filtresi OLMAYAN eski
-- report_fuel_stats'a hâlâ hizmet ediyor (Sendigo/demo geri düşüş yolu).
create index if not exists idx_device_telemetry_vehicle_fuel_pct
  on public.device_telemetry (vehicle_id, recorded_at)
  include (fuel_level_pct, odometer_km)
  where fuel_level_pct is not null;

analyze public.device_telemetry;
