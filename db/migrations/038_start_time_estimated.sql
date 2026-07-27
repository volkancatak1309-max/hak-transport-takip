-- 038_start_time_estimated.sql — "KONUM DOĞRULANMADI" BAYRAĞI İKİYE AYRILDI
--
-- Sorun (27.07.2026 canlı teşhis): time_entries.location_unverified TEK bayrak
-- olarak iki bambaşka olguyu taşıyordu (app/actions/shift.ts:295 →
-- `depotGate.unverified || !resolvedStart.verified`):
--
--   (a) ARAÇTAN SİNYAL YOK — cihaz sessiz/ölü, konum gerçekten bilinmiyor.
--   (b) SAAT TAHMİNİ — araç DEPODAYDI (konum doğrulandı), ama started_at depo
--       girişinden türetilemedi; kademe 2 (14 gün ortalaması) ya da 3 ("şimdi")
--       kullanıldı.
--
-- 27.07.2026'da bayrak düşen 8 vardiyanın 7'sinde araç fiilen depodaydı; yani
-- pano "konum doğrulanmadı" derken konum DOĞRULANMIŞTI. Yönetici her sabah
-- gerçek olmayan 7 uyarı okuyordu; asıl olan (DO-505GS, cihaz 11 gündür ölü)
-- aralarında kayboluyordu.
--
-- Bundan sonra:
--   location_unverified  = yalnız (a) — depo kapısı konumu doğrulayamadı
--   start_time_estimated = yalnız (b) — başlangıç anı kestirim
-- İkisi aynı anda da true olabilir (cihaz ölü → hem konum hem saat bilinmez).
--
-- Additive + idempotent. Kolon yoksa uygulama best-effort: action önce iki
-- kolonla update dener, kolon hatası alırsa eski bayrağı tek başına yazar
-- (vardiya ASLA iz eksikliğiyle kırılmaz); pano sorgusu error → boş → kalem
-- çıkmaz.

alter table public.time_entries
  add column if not exists start_time_estimated boolean not null default false;

-- Dikkat panosu sorgusu (start_time_estimated + started_at) üzerinden gider.
create index if not exists idx_time_entries_start_time_estimated
  on public.time_entries(start_time_estimated, started_at);

-- ── GERİYE DÖNÜK AYRIŞTIRMA ────────────────────────────────────────────────
-- Sıra önemli: önce hepsini (b) say, sonra sinyali olanların (a) damgasını kaldır.

-- 1) Eski bayrak düşmüş her kayıt EN AZ (b)'ydi: başlangıç anı ya ortalamadan
--    ya "şimdi"den geliyordu. Hepsine saat-tahmini damgası.
update public.time_entries
   set start_time_estimated = true
 where location_unverified = true
   and start_time_estimated = false;

-- 2) Vardiya başlangıcının çevresinde aracın KONUMLU telemetrisi varsa sinyal
--    vardı → (a) damgası yanlıştı, kaldır. Pencere depo kapısının tazelik
--    eşiğini (90 dk) yansıtır; +30 dk, geri-tarihlenmiş started_at'lerde butona
--    basma anını da kapsamak için.
update public.time_entries te
   set location_unverified = false
 where te.location_unverified = true
   and te.vehicle_id is not null
   and exists (
     select 1
       from public.device_telemetry dt
      where dt.vehicle_id = te.vehicle_id
        and dt.latitude is not null
        and dt.longitude is not null
        and dt.recorded_at between te.started_at - interval '90 minutes'
                               and te.started_at + interval '30 minutes'
   );

notify pgrst, 'reload schema';
