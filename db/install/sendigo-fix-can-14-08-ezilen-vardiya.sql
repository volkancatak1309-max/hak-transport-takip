-- SENDIGO — CAN ÖZSAVAŞ'IN 14.08.2026 SABAH VARDİYASINI GERİ YAZ
-- =====================================================================
-- ── NE OLDU ─────────────────────────────────────────────────────────
-- Can Özsavaş 14.08.2026'da İKİ kez işe çıktı:
--   1) 07:10 → 09:28 Viyana (2 sa 18 dk), DO-MDC1  — kapatıldı
--   2) 20:00 Viyana — akşam vardiyası, hâlâ açık
--
-- "Günde tek vardiya" kilidi (o tarihte SHIFT_PER_DAY diye bir ayar yoktu)
-- ikinci vardiyanın YENİ SATIR olarak açılmasına izin vermiyordu. Yönetici
-- panelden "Vardiya Başlat" dediğinde sunucu yeni satır yazmak yerine o günün
-- satırını YENİDEN AÇTI (app/actions/shift.ts startShiftForWorkerAction,
-- yeniden açma dalı). O dal `started_at`, `ended_at` ve `end_km` alanlarının
-- ÜZERİNE YAZIYOR — yani ikinci vardiyayı EKLEMEDİ, birincisini SİLDİ.
--
-- Kanıt (satırın 14.08 22:00'deki hâli):
--   id          9f7f25ea-a3af-4cb2-9163-b54f3b55ab85
--   created_at  2026-08-14 07:10:07 Viyana   ← SABAHKİ vardiyanın doğuş anı
--   started_at  2026-08-14 20:00:00 Viyana   ← üzerine yazılmış
--   ended_at    NULL                          ← sabahki kapanış silinmiş
--   start_km    289209                        ← hâlâ SABAHKİ değer
--   end_km      NULL                          ← sabahki 289301 silinmiş
--
-- Kusur 14.08.2026'da kaynağında kapatıldı (b74da92): SHIFT_PER_DAY='many'
-- kiracısında yeniden açma dalı atlanır ve yeni SATIR yazılır. Bu betik o
-- düzeltmeden ÖNCE kaybolan tek kaydı geri getirir.
--
-- ── KM'LER NEREDEN GELİYOR: ÖLÇÜLDÜ, TAHMİN EDİLMEDİ ────────────────
-- Kaynak device_telemetry.odometer_km (panelin resolveStartKm/resolveEndKm
-- zincirinin okuduğu alanın aynısı). DO-MDC1, 14.08.2026:
--
--   07:09:47–07:10:21 Viyana   odo = 289209   ← vardiya başlangıcı
--   09:28:26–09:28:30 Viyana   odo = 289301   ← vardiya kapanışı
--   → sabah vardiyası mesafesi  92,0 km
--
--   09:28:37 Viyana            odo = 289302
--   09:35:48 Viyana            odo = 289305   ← ARACIN SON ODOMETRE OKUMASI
--   20:00 sonrası              odometre YOK (cihaz o saatten beri sessiz)
--
-- İki bağımsız doğrulama: (a) telemetri penceresi yukarıdaki gibi ölçüldü;
-- (b) satırın ezilmeden ÖNCEKİ hâli 14.08 21:32'de okunmuştu ve
-- start_km=289209 / end_km=289301 taşıyordu. İki kaynak birbirini tutuyor.
--
-- ── AKŞAM VARDİYASININ start_km'si ──────────────────────────────────
-- Şu an 289209 yazıyor; bu SABAHIN başlangıç değeri, akşamın değil. Doğrusu
-- aracın son bilinen odometresi olan 289305'tir (09:35:48). Cihaz o saatten
-- beri sessiz olduğu için daha iyi bir kaynak YOKTUR — akşam vardiyası zaten
-- start_time_estimated=true ile işaretli. 289209 bırakılırsa akşam vardiyası
-- sabahın 92 km'sini İKİNCİ KEZ sayar ve Can'ın günlük km'si 92 km şişer.
--
-- ── SALT OKUNUR ÖN KONTROL ──────────────────────────────────────────
-- Aşağıdaki üçünü ÖNCE çalıştır. Beklenen: 1 satır / 0 satır / 2 satır.
-- (2. sorgu 0 dönmezse betik ZATEN uygulanmış demektir — TEKRAR ÇALIŞTIRMA.)
-- =====================================================================

-- 1) Ezilen satır hâlâ beklenen hâlde mi? (1 satır dönmeli)
SELECT id, created_at, started_at, ended_at, start_km, end_km, plate, notes
FROM public.time_entries
WHERE id = '9f7f25ea-a3af-4cb2-9163-b54f3b55ab85'
  AND started_at = '2026-08-14T18:00:00+00:00'
  AND ended_at IS NULL
  AND start_km = 289209;

-- 2) Sabah vardiyası daha önce geri yazılmış mı? (0 satır dönmeli)
SELECT id, started_at, ended_at
FROM public.time_entries
WHERE worker_id = 'dbf30980-185c-43c0-b2dc-872a8806e5da'
  AND started_at >= '2026-08-14T05:00:00+00:00'
  AND started_at <  '2026-08-14T08:00:00+00:00';

-- 3) Can'ın 14.08 (Viyana) satırları — şu an 1, betikten sonra 2 olmalı
SELECT id, started_at, ended_at, start_km, end_km, plate
FROM public.time_entries
WHERE worker_id = 'dbf30980-185c-43c0-b2dc-872a8806e5da'
  AND started_at >= '2026-08-13T22:00:00+00:00'
  AND started_at <  '2026-08-14T22:00:00+00:00'
ORDER BY started_at;

-- =====================================================================
--  DÜZELTME — tek işlem. Herhangi bir adım tutmazsa hiçbiri uygulanmaz.
-- =====================================================================
BEGIN;

-- ── A) SABAH VARDİYASI — YENİ SATIR ─────────────────────────────────
-- Alanlar ezilmeden önceki değerlerin birebir kendisi. `auto_started=false`
-- ve `confirmation_status='confirmed'` şoförün kendi başlattığı vardiyanın
-- imzasıdır (app/actions/shift.ts startShiftManualAction insert seti) —
-- bu satır gerçekten öyle açılmıştı (start_source='self').
--
-- `notes` SABAH VARDİYASINA AİTTİR: yeniden açma dalı notes'a HİÇ dokunmaz,
-- yani metin ezilmeden önce yazılmıştı ve o an açık olan tek vardiya
-- sabahkiydi. Aşağıda D adımında akşam satırından temizleniyor. Notun akşam
-- vardiyasına ait olduğunu biliyorsan bu satırı ve D adımını yorumla.
--
-- `location_unverified=false`, `start_time_estimated=false`: sabah vardiyası
-- gerçek odometre + gerçek konum akışıyla açılmıştı (07:09:47'de telemetri
-- vardı) — kestirim işareti yanlış olurdu.
INSERT INTO public.time_entries (
  id, worker_id, vehicle_id, plate,
  started_at, ended_at,
  start_km, end_km,
  break_minutes, cargo_count, undelivered_count, start_package_count,
  auto_started, auto_ended, confirmation_status, confirmed_at,
  location_unverified, start_time_estimated,
  started_by, start_source,
  notes, created_at, updated_at, updated_by
) VALUES (
  gen_random_uuid(),
  'dbf30980-185c-43c0-b2dc-872a8806e5da',           -- Can Özsavaş
  'a29356fa-2b6a-45d5-9fe9-d2e7b2c5ccea',           -- DO-MDC1
  'DO-MDC1',
  '2026-08-14T05:10:07.339+00:00',                  -- 07:10:07 Viyana
  '2026-08-14T07:28:12.485+00:00',                  -- 09:28:12 Viyana
  289209,                                            -- ölçüldü: odo @07:10
  289301,                                            -- ölçüldü: odo @09:28
  0, NULL, NULL, NULL,
  false, false, 'confirmed', '2026-08-14T05:10:07.448+00:00',
  false, false,
  'dbf30980-185c-43c0-b2dc-872a8806e5da',           -- kendi başlattı
  'self',
  'herba yardım samir',
  '2026-08-14T05:10:07.509983+00:00',               -- özgün doğuş anı korunur
  now(),
  '831e5709-0d04-4787-9d3c-2b205024180c'            -- Volkan Çatak (düzeltmeyi yapan)
);

-- ── B) AKŞAM VARDİYASININ start_km'si ───────────────────────────────
-- 289209 (sabahın başlangıcı) → 289305 (aracın son bilinen odometresi).
-- WHERE'de eski değer var: satır bu arada değiştiyse UPDATE 0 satır etkiler
-- ve aşağıdaki bütünlük kapısı işlemi geri alır.
UPDATE public.time_entries
SET start_km   = 289305,
    updated_at = now(),
    updated_by = '831e5709-0d04-4787-9d3c-2b205024180c'
WHERE id       = '9f7f25ea-a3af-4cb2-9163-b54f3b55ab85'
  AND start_km = 289209;

-- ── C) DÜZENLEME İZİ ────────────────────────────────────────────────
-- shift_edit_log şeması: (id, time_entry_id, changed_at, changed_by, field,
-- old_value, new_value). Panelin yazdığı biçimin aynısı; `field` metin.
-- Yeniden açmanın kendisi bu tabloya YAZMIYOR (kusurun bir parçası) —
-- kaybın izi de bu yüzden yalnız burada kalıyor.
INSERT INTO public.shift_edit_log (time_entry_id, changed_by, field, old_value, new_value)
SELECT
  te.id,
  '831e5709-0d04-4787-9d3c-2b205024180c',
  'kurtarma',
  'SİLİNDİ — 14.08.2026 yeniden açma başlangıç/bitiş/end_km üzerine yazdı',
  'GERİ YAZILDI — 07:10→09:28 Viyana, km 289209→289301 (device_telemetry odometresinden ölçüldü)'
FROM public.time_entries te
WHERE te.worker_id = 'dbf30980-185c-43c0-b2dc-872a8806e5da'
  AND te.started_at = '2026-08-14T05:10:07.339+00:00';

INSERT INTO public.shift_edit_log (time_entry_id, changed_by, field, old_value, new_value)
VALUES (
  '9f7f25ea-a3af-4cb2-9163-b54f3b55ab85',
  '831e5709-0d04-4787-9d3c-2b205024180c',
  'start_km',
  '289209',
  '289305'
);

-- ── D) NOT AKŞAM SATIRINDAN TEMİZLENİR ──────────────────────────────
-- Yukarıdaki A adımının gerekçesine bakın. Notun akşam vardiyasına ait
-- olduğunu biliyorsan bu bloğu ve A'daki `notes` değerini yorumla.
UPDATE public.time_entries
SET notes = NULL
WHERE id = '9f7f25ea-a3af-4cb2-9163-b54f3b55ab85'
  AND notes = 'herba yardım samir';

-- ── BÜTÜNLÜK KAPISI ─────────────────────────────────────────────────
-- Can'ın 14.08 Viyana gününde TAM 2 satırı olmalı ve açık vardiyası TEK
-- kalmalı (uq_time_entries_one_open zaten worker bazında koruyor; bu kapı
-- sayıyı da denetler). Tutmazsa işlem geri alınır.
DO $$
DECLARE n_gun int; n_acik int; n_sabah int;
BEGIN
  SELECT count(*) INTO n_gun FROM public.time_entries
   WHERE worker_id = 'dbf30980-185c-43c0-b2dc-872a8806e5da'
     AND started_at >= '2026-08-13T22:00:00+00:00'
     AND started_at <  '2026-08-14T22:00:00+00:00';
  SELECT count(*) INTO n_acik FROM public.time_entries
   WHERE worker_id = 'dbf30980-185c-43c0-b2dc-872a8806e5da' AND ended_at IS NULL;
  SELECT count(*) INTO n_sabah FROM public.time_entries
   WHERE worker_id = 'dbf30980-185c-43c0-b2dc-872a8806e5da'
     AND started_at = '2026-08-14T05:10:07.339+00:00'
     AND end_km = 289301;
  IF n_gun <> 2 OR n_acik <> 1 OR n_sabah <> 1 THEN
    RAISE EXCEPTION 'KURTARMA DOĞRULANAMADI: gün=% açık=% sabah=% (beklenen 2/1/1)',
      n_gun, n_acik, n_sabah;
  END IF;
END $$;

COMMIT;

-- =====================================================================
--  SONRASI — çalıştırıp çıktıyı sakla
-- =====================================================================
-- Beklenen: 2 satır.
--   07:10:07 → 09:28:12   289209 → 289301   (92 km)   DO-MDC1
--   20:00:00 → AÇIK       289305 → NULL                DO-MDC1
SELECT
  started_at AT TIME ZONE 'Europe/Vienna' AS baslangic_viyana,
  ended_at   AT TIME ZONE 'Europe/Vienna' AS bitis_viyana,
  start_km, end_km, (end_km - start_km) AS km, plate, notes
FROM public.time_entries
WHERE worker_id = 'dbf30980-185c-43c0-b2dc-872a8806e5da'
  AND started_at >= '2026-08-13T22:00:00+00:00'
  AND started_at <  '2026-08-14T22:00:00+00:00'
ORDER BY started_at;

-- Düzenleme izi (2 eski + 2 yeni = 4 satır)
SELECT changed_at AT TIME ZONE 'Europe/Vienna' AS ne_zaman,
       field, old_value, new_value
FROM public.shift_edit_log
ORDER BY changed_at;
