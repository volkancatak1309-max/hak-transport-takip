-- 065 — CANLI TELEMETRİ PENCERESİ TOPLU (#116b'nin GERÇEK karşılığı)
-- =====================================================================
-- ═══ SORUN ═══
-- `processAutoShifts` döngüsünün İLK satırı, KOŞULSUZ:
--     lib/auto-shift.ts:494   const latest = await latestVehicleTelemetry(v.id);
-- Araç başına 1 sorgu → 29 araçta 29 gidiş-dönüş.
--
-- CANLIDA ÖLÇÜLDÜ (19.08.2026, #84 sayacı, yoğun tur): `device_telemetry` 37;
-- bunun 29'u bu çağrı, kalanı `depotArrivalTrigger` sayfalı okumaları ve
-- vardiya açılırken `resolveStartKm`.
--
-- ⚠️ Bu kalem önce "saveDtc odometre", sonra "migration 062" sanılmıştı. İkisi
-- de ÖLÇÜMLE yanlış çıktı: saveDtc'nin odometre okuması tembel, 062'nin
-- kapsadığı üç okuma da HAK61 yapılandırmasında (SHIFT_START_TRIGGER=
-- depot_entry, SHIFT_AUTO_END=off) hiç çalışmıyor. Gerçek kaynak burası.
--
-- ═══ NEDEN 060 DESENİNİN AYNISI DEĞİL ═══
-- `latestVehicleTelemetry` TEK SATIR döndürmüyor: en yeni 40 satırlık bir
-- PENCERE çekip seyrek CAN/OBD alanlarını (yakıt, rpm, hararet…) o pencerede
-- gerçekten değer bildiren EN YENİ satırdan tamamlıyor. En yeni kare motor
-- verisi taşımadığında detay kartı "—" göstermesin diye.
--
-- Bu yüzden bu fonksiyon da PENCERE döndürür — tek satır değil.
--
-- ═══ BİRLEŞTİRME (coalesce) SQL'E TAŞINMADI — BİLİNÇLİ ═══
-- Alanları SQL tarafında doldurmak, aynı kuralın İKİNCİ bir uygulaması
-- olurdu ve iki uygulama ilk değişiklikte birbirinden sapardı. Kural
-- JS'te TEK KAYNAK olarak kalıyor (lib/telemetry.ts); SQL yalnız satırları
-- getiriyor. Aynı gerekçe `telemetriSatirlari()` ve `MOVE_SPEED_KMH`
-- parametresinde de uygulandı.
--
-- ═══ ⚠️ SATIR TAVANI — ÇAĞIRAN PARÇALAYARAK ÇAĞIRMALI ═══
-- 29 araç × 40 satır = 1160 satır. PostgREST sonuçları 1000 satırda SESSİZCE
-- keser; tek çağrıda tüm filoyu istemek bazı araçların penceresini yarıda
-- kırpar ve bunu HİÇBİR HATA BİLDİRMEZ — kasadaki en pahalı hata sınıfı.
-- Bu yüzden çağıran taraf araç listesini parçalara böler:
--     parça = floor(900 / pencere)   → 40'lık pencerede 22 araç
-- 29 araç = 2 çağrı (29 yerine). Pencere değişirse parça boyu kendiliğinden
-- ayarlanır; sabit bir sayı yazmak o günü sessiz kırpmaya çevirirdi.
--
-- ═══ GERİYE UYUM ═══
-- Çalıştırılmasa da uygulama çalışır: toplu okuma null dönerse çağıran
-- araç-araç `latestVehicleTelemetry`'ye düşer ve davranış birebir aynı kalır
-- (060/061'de canlıda iki kez kanıtlanan desen).
-- =====================================================================

create or replace function public.latest_telemetry_batch(
  p_vehicle_ids uuid[],
  p_window      integer
)
returns table (
  vehicle_id       uuid,
  latitude         double precision,
  longitude        double precision,
  speed_kmh        double precision,
  heading          double precision,
  ignition_on      boolean,
  fuel_level_pct   double precision,
  odometer_km      double precision,
  engine_rpm       double precision,
  engine_load_pct  double precision,
  coolant_temp_c   double precision,
  fuel_consumption double precision,
  power_voltage    double precision,
  battery_voltage  double precision,
  gsm_signal       double precision,
  altitude_m       double precision,
  satellites       double precision,
  dtc_number       integer,
  recorded_at      timestamptz
)
language sql
stable
as $$
  select
    p.vehicle_id, p.latitude, p.longitude, p.speed_kmh, p.heading,
    p.ignition_on, p.fuel_level_pct, p.odometer_km, p.engine_rpm,
    p.engine_load_pct, p.coolant_temp_c, p.fuel_consumption,
    p.power_voltage, p.battery_voltage, p.gsm_signal, p.altitude_m,
    p.satellites, p.dtc_number, p.recorded_at
  from unnest(p_vehicle_ids) as v(id)
  cross join lateral (
    select
      dt.vehicle_id, dt.latitude, dt.longitude, dt.speed_kmh, dt.heading,
      dt.ignition_on, dt.fuel_level_pct, dt.odometer_km, dt.engine_rpm,
      dt.engine_load_pct, dt.coolant_temp_c, dt.fuel_consumption,
      dt.power_voltage, dt.battery_voltage, dt.gsm_signal, dt.altitude_m,
      dt.satellites, dt.dtc_number, dt.recorded_at
    from public.device_telemetry dt
    where dt.vehicle_id = v.id
    order by dt.recorded_at desc
    limit p_window
  ) as p
$$;

comment on function public.latest_telemetry_batch(uuid[], integer) is
  'Arac basina en yeni p_window telemetri satiri, TEK sorguda (#116b). Seyrek CAN alanlarinin birlestirilmesi SQL''e TASINMADI - kural JS''te tek kaynak. Cagiran, PostgREST 1000 satir tavanina karsi arac listesini floor(900/p_window) buyuklugunde parcalara bolmek ZORUNDA.';
