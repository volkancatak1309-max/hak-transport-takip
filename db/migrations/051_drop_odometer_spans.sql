-- 051_drop_odometer_spans.sql — 050'DEKİ İKİNCİ FONKSİYONU GERİ ÇEK
--
-- `vehicle_odometer_spans` (migration 050) YANLIŞ BİR TEŞHİSE dayanıyordu ve
-- canlıda ölçüldüğünde hem GEREKSİZ hem ZARARLI çıktı. İkisi de 09.08.2026'da
-- HAK61 üretiminde ölçüldü:
--
--  1) GEREKSİZ. "Analiz sayfasındaki 58 ardışık sorgu 5.485 ms sürüyor" bulgusu
--     HATALIYDI: o rakam benim SIRALI test döngümün maliyetiydi, ürün kodunun
--     değil. Gerçek kod zaten tam paralel —
--       • lib/analytics.ts:324  getVehicleDistanceSpan içinde Promise.all([asc, desc])
--       • app/admin/analiz/page.tsx:64  Promise.all(vehicles.map(...))
--     Aynı 58 sorgu paralel atıldığında ÖLÇÜLEN süre: 1.010 ms (soğuk) /
--     286 ms (sıcak). Hedef "< 1 sn" zaten karşılanıyordu; ortada çözülecek
--     bir N+1 yoktu.
--
--  2) ZARARLI. Fonksiyonun kendisi 30 günlük aralıkta 8.333 ms sonra 57014
--     (statement timeout) veriyor — yani çağrılsaydı çalışan bir yolu BOZARDI.
--     Sebep: `distinct on (vehicle_id) ... order by vehicle_id, recorded_at`
--     iki kez, `odometer_km is not null` süzgeciyle. Bu şekil (vehicle_id,
--     recorded_at) indeksinden gidemiyor; aralıktaki tüm satırları sıralıyor.
--     Doğru şekli `vehicles`e LATERAL join + araç başına limit 1 olurdu — ama
--     madde 1 yüzünden buna İHTİYAÇ YOK, o yüzden yazmıyoruz: kullanılmayan
--     ikinci bir kod yolu ileride yanlışlıkla benimsenecek bir tuzaktır.
--
-- 050'nin BİRİNCİ fonksiyonu (report_fuel_stats_vehicle) DURUYOR ve canlıda
-- kullanılıyor: 30 günlük yakıt raporu 8,3 sn timeout → 6,0 sn / 29 araç.
--
-- Idempotent. Fonksiyon hiç uygulanmadıysa da sorunsuz geçer.

drop function if exists public.vehicle_odometer_spans(timestamptz, timestamptz);

notify pgrst, 'reload schema';
