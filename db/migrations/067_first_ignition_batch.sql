-- 067 — OTOMATİK VARDİYANIN "BUGÜNKÜ İLK KONTAK" OKUMASI TEK SORGUYA (#131b)
--
-- ═══ SORUN — VE NASIL GÖRÜLDÜ ═══
-- `lib/auto-shift.ts` → `firstIgnitionToday(vehicleId)`: otomatik başlatma
-- kapısını geçen HER araç için ayrı bir `device_telemetry` sorgusu.
--
-- Bu kalem #84 boyunca HİÇ görülmedi ve sebebi öğreticiydi: bütün ölçümler
-- `curl` ile ELLE tetiklenen turlardan alınıyordu. Cron 30 saniyede bir
-- koştuğu için el çağrısı hep bir turun hemen ardına düşüyor ve bu yol 8'de
-- kalıyordu. 20.08.2026'da ölçüm aracı değiştirildi — sayaç zaten her tur
-- `[flespi/sync] SORGU toplam=…` diye loglanıyordu — ve CRON'UN KENDİ turunda
-- gerçek şu çıktı:
--
--     gece turu (57 sorgu):  device_telemetry 22  +  workers 22   = 44
--     gündüz turu (56):      vehicle_dtc 23 baskın, bu yol 8'de
--
-- `workers` ayağı #131a ile migration'sız kapatıldı (8 → 1, canlıda ölçüldü).
-- Kalan ayak bu.
--
-- ═══ NEDEN SQL (JS'te toplanamıyor) ═══
-- İstenen şey araç başına "bugünün İLK kontak-açık satırı". PostgREST bunu
-- kuramaz (GROUP BY / DISTINCT ON yok). JS'te yapılabilecek tek şey günün tüm
-- kontak satırlarını çekip bellekte gruplamaktı — ama o SESSİZ KIRPMAYA açık:
-- 1000 satır tavanına yoğun bir araç tek başına dayanırsa başka bir aracın ilk
-- kontağı hiç görünmez ve o araç için vardiya YANLIŞ saatte açılır. Kasadaki
-- ders net: sessiz kırpma başarı gibi görünür. 060 ve 065 aynı gerekçeyle
-- SQL'e taşınmıştı; bu onların üçüncüsü.
--
-- LATERAL, `(vehicle_id, recorded_at)` indeksine araç başına TEK seek yapar.
--
-- ⚠️ `ignition_on` üzerinde ayrı bir indeks GEREKMEZ: seek zaten araç+zaman
-- üzerinden gidiyor, `ignition_on = true` süzgeci seek içinde uygulanıyor ve
-- pencere tek bir kiracı-günü. Yeni indeks eklemek yazma yolunu (turun en
-- yoğun kalemi olan telemetri partisini) yavaşlatırdı.
--
-- ═══ SÖZLEŞME ═══
-- Girdi : araç id listesi + kiracı-gününün başlangıcı (Viyana 04:00 sınırı
--         JS'te hesaplanır — `startOfTodayVienna()`; DST mantığı TEK YERDE
--         kalsın diye SQL'e taşınmadı).
-- Çıktı : araç başına bugünkü İLK kontak-açık anı. Bugün hiç kontak açmamış
--         araç SATIR DÖNDÜRMEZ (null değil) — "kontak yok" ile "sorgu
--         başarısız" birbirine karışmasın.
--
-- ═══ GERİYE UYUM ═══
-- Bu fonksiyon KOŞULMASA DA uygulama çalışır: `lib/auto-shift.ts` toplu okuma
-- null dönerse araç-araç eski yola (`firstIgnitionToday`) düşer ve davranış
-- birebir aynı kalır — yalnız kazanç gerçekleşmez. Deploy sırası serbest.
--
-- ⚠️ ÜÇ VERİTABANI VAR (bkz. Bekleyen-Isler #128): hak-transport-takip ·
-- galzura-demo · sendigo. "Koşuldu" üç ayrı kutucuktur.

create or replace function public.first_ignition_batch(
  p_vehicle_ids uuid[],
  p_day_start   timestamptz
)
returns table (
  vehicle_id   uuid,
  first_at     timestamptz
)
language sql
stable
as $$
  select v.id as vehicle_id, ilk.recorded_at as first_at
  from unnest(p_vehicle_ids) as v(id)
  cross join lateral (
    select dt.recorded_at
    from public.device_telemetry dt
    where dt.vehicle_id = v.id
      and dt.ignition_on = true
      and dt.recorded_at >= p_day_start
    order by dt.recorded_at asc
    limit 1
  ) as ilk
$$;

comment on function public.first_ignition_batch(uuid[], timestamptz) is
  'Otomatik vardiya: arac basina BUGUNUN ilk kontak-acik ani, TEK sorguda (#131b). Bugun kontak acmamis arac icin satir donmez.';
