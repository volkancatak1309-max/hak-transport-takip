-- 060 — SENKRON TURUNUN İMLEÇ OKUMASI TEK SORGUYA (#84 Adım 1)
--
-- ═══ SORUN ═══
-- `/api/flespi/sync` her turda araç başına bir "son kayıt anı" sorgusu atıyor
-- (lib/telemetry.ts → lastRecordedAt). 29 araçta 29 gidiş-dönüş.
--
-- 18.08.2026'da CANLIDA ÖLÇÜLDÜ (sorgu sayacı, #84 Adım 0): tur başına
-- 169 PostgREST çağrısı, dökümü:
--     92  device_telemetry     ← imleç okuması bunun büyük kısmı
--     59  idle_episodes
--      7  workers · 6 geofences · 2 vehicles · 2 time_entries · 1 worker_leaves
--
-- ═══ NEDEN SQL (JS'te toplanamıyor) ═══
-- PostgREST "araç başına max(recorded_at)" ifadesini kuramaz: GROUP BY yok,
-- DISTINCT ON yok. JS tarafında yapılabilecek tek şey son N satırı çekip
-- bellekte gruplamaktı — ama o SESSİZ KIRPMAYA açık: yoğun bir araç tek başına
-- 1000 satırı doldurursa başka bir aracın imleci hiç görünmez ve o araç için
-- pencere yanlış hesaplanır. Kasadaki ders açık: sessiz kırpma başarı gibi
-- görünür. Bu yüzden toplama SQL tarafında yapılıyor.
--
-- LATERAL, araç başına (vehicle_id, recorded_at) indeksine TEK seek yapar —
-- 052'deki shift_odometer_spans ile aynı desen. Tablo taranmaz.
--
-- ═══ SÖZLEŞME ═══
-- Girdi : araç id listesi (senkronun o turda işlediği araçlar)
-- Çıktı : her araç için son telemetri anı. HİÇ kaydı olmayan araç SATIR
--         DÖNDÜRMEZ (null döndürmez) — çağıran tarafta "kayıt yok" ile
--         "sorgu başarısız" birbirine karışmasın diye.
--
-- ═══ GERİYE UYUM ═══
-- Bu fonksiyon ÇALIŞTIRILMASA DA uygulama çalışır: lib/telemetry.ts'teki
-- toplu okuma, fonksiyon yoksa araç-araç eski yola (lastRecordedAt) düşer ve
-- tur bugünküyle birebir aynı davranır — yalnız sorgu sayısı düşmez.
-- Yani deploy sırası serbest: kod önce çıkabilir, migration sonra koşabilir.

create or replace function public.last_recorded_at_batch(
  p_vehicle_ids uuid[]
)
returns table (
  vehicle_id  uuid,
  recorded_at timestamptz
)
language sql
stable
as $$
  select v.id as vehicle_id, son.recorded_at
  from unnest(p_vehicle_ids) as v(id)
  cross join lateral (
    select dt.recorded_at
    from public.device_telemetry dt
    where dt.vehicle_id = v.id
    order by dt.recorded_at desc
    limit 1
  ) as son
$$;

comment on function public.last_recorded_at_batch(uuid[]) is
  'Senkron turunun imlec okumasi: arac basina son device_telemetry ani, TEK sorguda (#84 Adim 1). Kaydi olmayan arac icin satir donmez.';
