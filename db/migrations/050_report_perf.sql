-- 050_report_perf.sql — RAPOR HIZLANDIRMA (iki fonksiyon, şema değişikliği yok)
--
-- İki ayrı darboğaz, ikisi de canlıda ölçüldü (09.08.2026, HAK61 üretim):
--
--  1) /admin/raporlar/yakit 30 GÜN → 8.277 ms → 57014 statement timeout.
--     049'daki indeks DEVREYE GİRDİ (süre artık aralıkla ölçekleniyor:
--     1 gün 429 ms, 7 gün 3.714 ms, 30 gün timeout) ama 30 günde ~690 bin
--     satır üstünde İKİ pencere fonksiyonu (max() over rows 30 preceding/
--     following) + lag + iki array_agg dönüyor. Bu CPU/sort maliyeti, indeksin
--     çözebileceği bir şey DEĞİL. Çözüm: aynı işi araç araç yap — her araç
--     ~1/29 veri görür, pencere fonksiyonları küçük partition'larda koşar,
--     ve 29 çağrı PARALEL gider.
--
--  2) /admin/analiz 6,4 sn'nin 5.485 ms'i getVehicleDistanceSpan'in 58 ARDIŞIK
--     sorgusu (29 araç × asc+desc limit 1). Veri hacmi değil ROUND-TRIP sayısı:
--     her sorgu ~95 ms ağ gidiş-dönüşü, dönen veri 1 satır. Çözüm: tek
--     DISTINCT ON sorgusu.
--
-- Additive + idempotent. Uygulanmazsa uygulama eski yoluna düşer (kod her iki
-- fonksiyonu da PGRST202'de yakalayıp mevcut davranışa geri döner).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) TEK ARAÇ İÇİN YAKIT İSTATİSTİĞİ
--
-- Gövde 027'deki report_fuel_stats ile BİREBİR AYNI (de-glitch → adım →
-- toplulaştırma, eşikler 10 puan). TEK fark: `p_vehicle_id` filtresi. İki
-- fonksiyon aynı sayıyı üretmek ZORUNDA — biri diğerinin araç-kırpılmış hâli.
-- Mantık değişirse İKİSİ BİRDEN değişmeli (027'nin gövdesi tek doğruluk kaynağı).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.report_fuel_stats_vehicle(
  p_from       timestamptz,
  p_to         timestamptz,
  p_vehicle_id uuid
)
returns table (
  vehicle_id   uuid,
  sample_count bigint,
  avg_pct      double precision,
  min_pct      double precision,
  max_pct      double precision,
  first_pct    double precision,
  last_pct     double precision,
  refill_count bigint,
  refill_pct   double precision,
  drop_count   bigint,
  drop_pct     double precision
)
language sql
stable
as $$
  with base as (
    select
      dt.vehicle_id,
      dt.recorded_at,
      dt.fuel_level_pct::double precision as fuel,
      dt.odometer_km::double precision    as odo
    from public.device_telemetry dt
    where dt.vehicle_id = p_vehicle_id
      and dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.fuel_level_pct is not null
  ),
  numbered as (
    select b.*,
           row_number() over (order by b.recorded_at) as rn,
           count(*) over ()                           as cnt
    from base b
  ),
  bounded as (
    select
      n.*,
      max(n.fuel) over (order by n.recorded_at rows between 30 preceding and current row) as bwd_max,
      max(n.fuel) over (order by n.recorded_at rows between current row and 30 following) as fwd_max
    from numbered n
  ),
  clean as (
    -- UÇ SATIR KURALI (027): ilk satırda geriye, son satırda ileriye pencere
    -- YOKTUR; tek yönlü kanıt yeterli sayılır, yoksa gerçek dolum kırpılırdı.
    select vehicle_id, recorded_at, fuel, odo
    from bounded
    where not (
      case
        when rn = 1   then fwd_max - fuel >= 10
        when rn = cnt then bwd_max - fuel >= 10
        else bwd_max - fuel >= 10 and fwd_max - fuel >= 10
      end
    )
  ),
  stepped as (
    select c.*,
           lag(c.fuel) over w as prev_fuel,
           lag(c.odo)  over w as prev_odo
    from clean c
    window w as (order by c.recorded_at)
  )
  select
    p_vehicle_id                                    as vehicle_id,
    count(*)::bigint                                as sample_count,
    avg(fuel)                                       as avg_pct,
    min(fuel)                                       as min_pct,
    max(fuel)                                       as max_pct,
    (array_agg(fuel order by recorded_at asc))[1]   as first_pct,
    (array_agg(fuel order by recorded_at desc))[1]  as last_pct,
    count(*) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 10
    )::bigint                                       as refill_count,
    coalesce(sum(fuel - prev_fuel) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 10
    ), 0)                                           as refill_pct,
    count(*) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 10
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    )::bigint                                       as drop_count,
    coalesce(sum(prev_fuel - fuel) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 10
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    ), 0)                                           as drop_pct
  from stepped
  having count(*) > 0;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) TÜM ARAÇLARIN ODOMETRE UÇ NOKTALARI — TEK SORGUDA
--
-- getVehicleDistanceSpan'in 58 ardışık sorgusunun yerine geçer. km-guard'ı
-- (negatif fark, MAX_PLAUSIBLE_KM_PER_DAY = 800 km/gün) BURADA UYGULAMAZ:
-- kural JS tarafında (lib/analytics.ts:352-358) yaşamaya devam eder ki tek
-- doğruluk kaynağı bölünmesin. Bu fonksiyon yalnız UÇ NOKTALARI getirir.
--
-- `distinct on (vehicle_id)` iki kez: bir asc bir desc. Her ikisi de
-- (vehicle_id, recorded_at) indeksinden gider — 049'un eklediği kısmi indeks
-- burada gerekmez, 014'teki unique indeks yeterli.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.vehicle_odometer_spans(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  vehicle_id uuid,
  first_km   double precision,
  first_at   timestamptz,
  last_km    double precision,
  last_at    timestamptz
)
language sql
stable
as $$
  with f as (
    select distinct on (dt.vehicle_id)
           dt.vehicle_id,
           dt.odometer_km::double precision as km,
           dt.recorded_at
    from public.device_telemetry dt
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.odometer_km is not null
    order by dt.vehicle_id, dt.recorded_at asc
  ),
  l as (
    select distinct on (dt.vehicle_id)
           dt.vehicle_id,
           dt.odometer_km::double precision as km,
           dt.recorded_at
    from public.device_telemetry dt
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.odometer_km is not null
    order by dt.vehicle_id, dt.recorded_at desc
  )
  select f.vehicle_id, f.km, f.recorded_at, l.km, l.recorded_at
  from f join l on l.vehicle_id = f.vehicle_id;
$$;

notify pgrst, 'reload schema';
