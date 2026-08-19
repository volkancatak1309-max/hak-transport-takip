-- 062 — OTOMATİK VARDİYA TELEMETRİ OKUMALARI TEK SORGUYA (#116b)
--
-- ═══ SORUN ═══
-- `processAutoShifts` her turda araç/vardiya başına ayrı telemetri sorgusu
-- atıyor (lib/auto-shift.ts):
--     firstIgnitionToday(vehicleId)   → bugünün İLK kontak-açık anı   (araç başına 1)
--     lastActivityMs(vehicleId, shift)→ vardiya başlangıcından beri
--                                        son kontak-açık + son HAREKET (vardiya başına 2)
--
-- CANLIDA ÖLÇÜLDÜ (19.08.2026, #84 sayacı, yoğun tur):
--     device_telemetry 37 sorgu/tur
--     13 açık vardiya, 29 cihazlı araç → 2×13 + (29−13) = 42 beklenen, 37 ölçülen
--     (fark: daha önceki filtrelerle elenen araçlar)
-- #84 Adım 0-4 bittikten sonra turun EN BÜYÜK kalemi bu.
--
-- ⚠️ NOT: bu kalem başta "saveDtc odometre okuması" sanılmıştı. Ölçüm yanlışı
-- düzeltti — saveDtc'nin odometre okuması TEMBEL (yalnız yeni bir arıza kodu
-- eklenirken) ve pratikte neredeyse hiç tetiklenmiyor.
--
-- ═══ NEDEN SQL ═══
-- 060/061 ile aynı sebep: PostgREST "araç başına EN YENİ/EN ESKİ satır"
-- kuramaz (GROUP BY yok, DISTINCT ON yok) ve her aracın penceresi FARKLI
-- (`p_since` vardiya başlangıcı). Bellekte gruplamak için tüm telemetriyi
-- çekmek gerekirdi — yoğun günde araç başına binlerce satır, ve 1000 satırlık
-- PostgREST tavanı yüzünden SESSİZ KIRPMAYA açık.
--
-- Üç LATERAL, araç başına (vehicle_id, recorded_at) indeksine birer seek yapar.
--
-- ═══ SÖZLEŞME ═══
-- Girdi : eşleşen üç dizi — araç id'leri ve her araç için pencere başlangıcı.
--         `p_since[i]` NULL ise o araç için vardiya penceresi yok; yalnız
--         `first_ignition_today` hesaplanır (diğer ikisi NULL döner).
-- Çıktı : her araç için TEK satır (LEFT JOIN — hiç kaydı olmayan araç da döner).
--         first_ignition_today : p_day_start'tan sonraki İLK kontak-açık anı
--         last_ignition_on     : p_since'ten sonraki SON kontak-açık anı
--         last_movement        : p_since'ten sonraki SON hareket anı
--                                (speed_kmh >= p_move_kmh)
--
-- Hız eşiği PARAMETRE: JS tarafındaki MOVE_SPEED_KMH tek kaynak olarak kalsın;
-- SQL'e sabit gömülseydi iki yerde iki farklı eşik olur ve biri değişince
-- öteki sessizce geride kalırdı.
--
-- ═══ GERİYE UYUM ═══
-- Çalıştırılmasa da uygulama çalışır: toplu okuma null dönerse auto-shift
-- araç-araç eski yola düşer ve davranış birebir aynı kalır (060/061'de
-- canlıda iki kez kanıtlanan desen). Deploy sırası serbest.

create or replace function public.autoshift_telemetry_batch(
  p_vehicle_ids uuid[],
  p_since       timestamptz[],
  p_day_start   timestamptz,
  p_move_kmh    double precision
)
returns table (
  vehicle_id           uuid,
  first_ignition_today timestamptz,
  last_ignition_on     timestamptz,
  last_movement        timestamptz
)
language sql
stable
as $$
  select
    v.id as vehicle_id,
    ilk.recorded_at  as first_ignition_today,
    sonKontak.recorded_at as last_ignition_on,
    sonHareket.recorded_at as last_movement
  from unnest(p_vehicle_ids, p_since) as v(id, since)
  left join lateral (
    select dt.recorded_at
    from public.device_telemetry dt
    where dt.vehicle_id = v.id
      and dt.ignition_on = true
      and dt.recorded_at >= p_day_start
    order by dt.recorded_at asc
    limit 1
  ) as ilk on true
  left join lateral (
    select dt.recorded_at
    from public.device_telemetry dt
    where v.since is not null
      and dt.vehicle_id = v.id
      and dt.ignition_on = true
      and dt.recorded_at >= v.since
    order by dt.recorded_at desc
    limit 1
  ) as sonKontak on true
  left join lateral (
    select dt.recorded_at
    from public.device_telemetry dt
    where v.since is not null
      and dt.vehicle_id = v.id
      and dt.speed_kmh >= p_move_kmh
      and dt.recorded_at >= v.since
    order by dt.recorded_at desc
    limit 1
  ) as sonHareket on true
$$;

comment on function public.autoshift_telemetry_batch(uuid[], timestamptz[], timestamptz, double precision) is
  'Otomatik vardiya motorunun telemetri okumalari: arac basina bugunun ilk kontagi + vardiya penceresindeki son kontak/son hareket, TEK sorguda (#116b). Hiz esigi parametre — JS tarafi tek kaynak.';
