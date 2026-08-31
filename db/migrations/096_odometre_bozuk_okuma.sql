-- 096 · ODOMETRE BOZUK OKUMA FİLTRESİ
--
-- ═══ NEDEN ═══════════════════════════════════════════════════════════════
--
-- `telemetry_month_spans` (090) ayın odometre uçlarını ham `min`/`max` ile
-- alıyor. Cihaz zaman zaman TEKİL bozuk okuma bildiriyor ve tek bir bozuk
-- satır ayın minimumunu götürüp açıklığı şişiriyor.
--
-- HAK61 canlı ölçümü (31.08.2026, salt okuma):
--   1.803.566 satır · odometre dolu 1.518.613
--   odometer_km = 0          114 satır (%0,0075) · 4/30 araç
--   monotonluk ihlali        123 olay · 13/30 araç · en büyüğü 113.009 km
--   negatif odometre           0
--   diğer 18 alanda sınır ihlali  0   (hız, yakıt, devir, sıcaklık, voltaj…)
--
-- Bozukluk TEKİL ve geçici — seri hemen normale dönüyor:
--   10:01:20  123836 · 10:01:21  24063 · 10:01:23  123836
-- Yani sayaç sıfırlanması / cihaz değişimi DEĞİL.
--
-- ═══ ZARAR — ölçüldü ═════════════════════════════════════════════════════
--
-- 2026-07, HAK61:
--   ölçülebilen araç   min/max ile 23  →  temizlenmiş seriyle 26   (+3)
--   kazanılan          DO-512GT 757 km · DO-775GS 977 km · DO-776GS 485 km
--   DO-777GS km        36.187 → 1.141  (%3.070 hata; bu değer makullük
--                                       kapısından GEÇİYORDU — sessiz yanlış)
--   ayrıca 8 araçta km küçük düzeltmeler aldı
--
-- Kapsama kaybı CO₂ oranına da vuruyor: km'si ölçülemeyen araç
-- `olculemedi_sebep = 'odometre_yok'` alıp oran kümesinin dışında kalıyor.
--
-- ═══ KURAL — ikisi de fizikten, hiçbiri filoya bağlı değil ═══════════════
--
--  ① Monotonluk: odometre azalmaz. Koşan maksimumdan geri giden okuma bozuk.
--     (Sıfır ayrı kural değil — o da bir azalmadır.)
--  ② Fiziksel atlama: iki okuma arasındaki artış, geçen sürede mümkün
--     olandan büyük olamaz. Üst hız VERİDEN: 1,8M satırda speed_kmh > 200
--     olan hiç satır yok.
--
-- ① tek başına YETMEZ — bozuk okuma serinin başındaysa azalma değil artıştır
-- (0 → 98.783). Ölçüldü: yalnız ① ile kazanç +0, ② eklenince +3 araç.
--
-- 🔴 ÖLÇEKTEN BAĞIMSIZ: plaka yok, araç sayısı yok, filoya özel eşik yok.
-- Tek sabit 200 km/s ve o bir fiziksel sınır. Uygulama katmanındaki eşi:
-- `lib/odometre.ts` (aynı kural, aynı sabit).
--
-- ⚠️ HAM VERİYE DOKUNULMAZ. Hiçbir satır silinmez, güncellenmez. Filtre
-- yalnız OKUMA anında uygulanır — `docs/BOZUK-TELEMETRI.md`.
--
-- İMZA DEĞİŞMEDİ: dönen kolonlar 090'daki ile birebir aynı, çağıranlar
-- (lib/saklama-db.ts → ayOzetiYaz) değişmeden çalışır.

begin;

set local lock_timeout = '3s';

create or replace function public.telemetry_month_spans(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  vehicle_id uuid,
  ay date,
  ornek_sayisi bigint,
  ilk_kayit timestamptz,
  son_kayit timestamptz,
  odometre_ilk numeric,
  odometre_son numeric,
  yakit_ornek_sayisi bigint,
  yakit_sifir_okuma bigint
)
language sql
stable
as $$
  with ham as (
    select
      dt.vehicle_id,
      date_trunc('month', dt.recorded_at)::date as ay,
      dt.recorded_at,
      dt.odometer_km,
      dt.fuel_level_pct
    from public.device_telemetry dt
    where dt.recorded_at >= p_from
      and dt.recorded_at <  p_to
  ),
  -- Sayımlar HAM satırlar üzerinden: "kaç okuma geldi" sorusu filtreden
  -- etkilenmemeli, yoksa kapsama sayacı kendi kendini küçültür.
  sayimlar as (
    select
      vehicle_id, ay,
      count(*)                                              as ornek_sayisi,
      min(recorded_at)                                      as ilk_kayit,
      max(recorded_at)                                      as son_kayit,
      count(*) filter (where fuel_level_pct is not null)     as yakit_ornek_sayisi,
      count(*) filter (where fuel_level_pct = 0)             as yakit_sifir_okuma
    from ham
    group by 1, 2
  ),
  odo as (
    select
      vehicle_id, ay, recorded_at, odometer_km,
      -- ① koşan maksimum (kendisi HARİÇ) — monotonluk kapısı
      -- telemetri-sinir: bu max FILTRENIN KENDISI, filtresiz uc deger degil
      max(odometer_km) over (
        partition by vehicle_id, ay order by recorded_at
        rows between unbounded preceding and 1 preceding
      ) as kosan_max,
      -- ② sonraki okuma — fiziksel atlama kapısı
      lead(odometer_km)  over (partition by vehicle_id, ay order by recorded_at) as sonraki_km,
      lead(recorded_at)  over (partition by vehicle_id, ay order by recorded_at) as sonraki_an
    from ham
    where odometer_km is not null
  ),
  temiz as (
    select vehicle_id, ay, odometer_km
    from odo
    where (kosan_max is null or odometer_km >= kosan_max)
      and (
        sonraki_km is null
        or sonraki_km - odometer_km <= greatest(
             1,
             extract(epoch from (sonraki_an - recorded_at)) / 3600.0 * 200
           )
      )
  )
  select
    s.vehicle_id,
    s.ay,
    s.ornek_sayisi,
    s.ilk_kayit,
    s.son_kayit,
    -- telemetri-sinir: uc deger TEMIZ CTE'den geliyor (monotonluk + fiziksel
    -- atlama kapilarindan gecmis satirlar), ham device_telemetry'den DEGIL.
    min(t.odometer_km)::numeric as odometre_ilk,
    max(t.odometer_km)::numeric as odometre_son,
    s.yakit_ornek_sayisi,
    s.yakit_sifir_okuma
  from sayimlar s
  left join temiz t on t.vehicle_id = s.vehicle_id and t.ay = s.ay
  group by s.vehicle_id, s.ay, s.ornek_sayisi, s.ilk_kayit, s.son_kayit,
           s.yakit_ornek_sayisi, s.yakit_sifir_okuma
$$;

commit;

-- ═══ ÇALIŞTIRMADAN SONRA — EŞDEĞERLİK DENETİMİ ═══════════════════════════
--
-- Beklenen: bozuk okuması OLMAYAN araçlarda sayı DEĞİŞMEZ, olanlarda
-- `odometre_ilk` yükselir. Aşağıdaki sorgu 2026-07 için farkı listeler;
-- HAK61'de üç satır beklenir (DO-512GT, DO-775GS, DO-776GS) artı sekiz
-- küçük düzeltme.
--
--   select v.plate,
--          s.odometre_ilk as yeni_ilk,
--          s.odometre_son as yeni_son,
--          (s.odometre_son - s.odometre_ilk) as yeni_km
--   from public.telemetry_month_spans('2026-07-01'::timestamptz,
--                                     '2026-08-01'::timestamptz) s
--   join public.vehicles v on v.id = s.vehicle_id
--   order by yeni_km desc;
--
-- ⚠️ Bu migration ÇALIŞTIRILMADI (31.08.2026). Kod tarafı ona bağlı değil:
-- `ayOzetiYaz` imza değişmediği için eski gövdeyle de çalışır, yalnız
-- kazanç gerçekleşmez.
