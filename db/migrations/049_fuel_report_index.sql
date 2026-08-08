-- 049_fuel_report_index.sql — YAKIT RAPORU ZAMAN AŞIMI (57014)
--
-- SORUN (canlıda ölçüldü 09.08.2026, HAK61 üretim):
--   /admin/raporlar/yakit → report_fuel_stats soğuk cache'te 8,2 sn sonra
--   57014 (statement timeout) → sayfa available:false basıyor. Ödeyen müşteri
--   raporu hiç göremiyor.
--
-- TEŞHİS — süre ARALIKTAN BAĞIMSIZ, yani indeks HİÇ kullanılmıyor:
--     7 gün  : 7.037 ms (soğuk) / 2.239 ms (sıcak)
--    30 gün  : 7.861 ms / 6.930 ms
--   tüm zaman: 6.905 ms / 6.841 ms
--   Aralığı 4 katına çıkarmak süreyi değiştirmiyor → 1.038.145 satırlık
--   SEQ SCAN. Sayfanın VARSAYILAN aralığı "hafta" (raporlar/yakit/page.tsx:26),
--   yani her normal açılış bu 7 saniyeyi ödüyor ve yük altında tavanı aşıyor.
--
-- NEDEN indeks yok: device_telemetry'deki üç indeksin ÜÇÜ DE recorded_at'i
-- İKİNCİ kolonda tutuyor —
--   014: (vehicle_id, recorded_at) unique
--   014: (flespi_device_id, recorded_at desc)
--   039: (vehicle_id, recorded_at) where fuel_volume_l is not null
-- Rapor fonksiyonları ise ARAÇ FİLTRESİ OLMADAN yalnız recorded_at aralığı +
-- "yakıt alanı dolu" ile süzüyor (026/027 satır 60-63, 039 satır 78-81).
-- recorded_at baştaki kolon olmadığı için hiçbiri aralık taramasına hizmet
-- edemiyor.
--
-- ÇÖZÜM: recorded_at BAŞTA olan kısmi + kapsayan (covering) indeks.
--   • kısmi (where ... is not null) → yalnız yakıt okuması olan satırlar
--     (fuel_level_pct: 687.111/1.038.145 = %66; fuel_volume_l: 273.692 = %26)
--   • include(...) → fonksiyonun okuduğu her kolon indekste, heap'e hiç
--     gidilmiyor (index-only scan)
--   • recorded_at başta → 7 günlük rapor 7 günlük veriyi tarar, tabloyu değil.
--     Asıl kazanç bu: tablo büyüdükçe rapor YAVAŞLAMAZ.
--
-- 039'un kendi indeksi (vehicle_id başta) DURUYOR — düşürmüyoruz: pencere
-- fonksiyonunun partition by vehicle_id sıralamasına hâlâ hizmet edebilir ve
-- düşürmek geri alınamaz bir risk olurdu. Maliyeti yalnız disk.
--
-- Additive + idempotent. Uygulanmazsa davranış bugünkü hâliyle aynı kalır.
--
-- ⚠️ CANLIDA KESİNTİSİZ İSTENİRSE: aşağıdaki iki create index'i
--    `create index concurrently if not exists ...` olarak, HER BİRİNİ AYRI
--    çalıştırın (CONCURRENTLY transaction bloğu içinde çalışmaz). Bu dosyadaki
--    düz sürüm ~2-5 sn ACCESS EXCLUSIVE kilidi alır; flespi sync upsert'i
--    idempotent olduğu için o pencerede kaçan tur bir sonraki turda kapanır.

-- YÜZDE hattı — report_fuel_stats (migration 026 + 027).
create index if not exists idx_device_telemetry_fuel_pct_time
  on public.device_telemetry (recorded_at)
  include (vehicle_id, fuel_level_pct, odometer_km)
  where fuel_level_pct is not null;

-- LİTRE hattı — report_fuel_volume_stats (migration 039). Aynı kusur: 039'un
-- indeksi vehicle_id ile başlıyor, fonksiyon ise yalnız recorded_at süzüyor.
create index if not exists idx_device_telemetry_fuel_volume_time
  on public.device_telemetry (recorded_at)
  include (vehicle_id, fuel_volume_l, odometer_km)
  where fuel_volume_l is not null;

analyze public.device_telemetry;
