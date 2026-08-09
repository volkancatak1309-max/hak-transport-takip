-- 052 — VARDİYA PENCERELİ KM + DOLUM BİRLEŞTİRME
--
-- İki ayrı doğruluk kusuru, ikisi de 09.08.2026'da canlıda ölçüldü.
--
-- ═══ 1) shift_odometer_spans — KM ARTIK VARDİYADAN, ARALIKTAN DEĞİL ═══
--
-- Kusur: getVehicleDistanceSpan aracın km'sini ARALIĞIN uçlarından ölçüyor.
-- Şoför o aracı 1 gün sürmüş olsa bile aracın 30 GÜNLÜK km'si ona yazılıyordu:
--     Mustafa Karakoç   809 km / 1 çalışılan gün
--     Ekrem Gyuler    1.163 km / 3 gün  (işten çıkmış)
--     Bayram Çöymen     917 km / 3 gün  (işten çıkmış)
-- Şişirilmiş km → düşük ceza/1000km → ŞİŞİRİLMİŞ SKOR. Puan eşiği çalışılan
-- güne çekilince (adc04df) bu uyuşmazlık daha da büyüdü, o yüzden o değişiklik
-- bayrakla kapatıldı ve buranın düzelmesi bekleniyor.
--
-- Neden SQL: JS'te vardiya başına 2 sorgu = 373 vardiya × 2 = 746 istek.
-- ÖLÇÜLDÜ: paralel bile 26.926 ms / 38.786 ms. Kabul edilemez. Buradaki iki
-- LATERAL, araç başına (vehicle_id, recorded_at) indeksine tek seek yapar;
-- 373 vardiya tek sorguda, tek gidiş-dönüşte döner.
--
-- KM-GUARD BURADA UYGULANMAZ. Ham uç noktalar döner, guard (negatif fark +
-- MAX_PLAUSIBLE_KM_PER_DAY = 800 km/gün) lib/analytics.ts'te kalır — tek
-- doğruluk kaynağı bölünmesin. Bu fonksiyon yalnız "hangi vardiyada odometre
-- nereden nereye gitti" sorusunu cevaplar.
--
-- AÇIK VARDİYA: ended_at null ise pencere p_to'da kapanır.
-- ARALIKLA KESİŞEN her vardiya döner (başlangıcı aralıktan önce olsa bile),
-- böylece gece yarısını aşan / devreden vardiya kaybolmaz.

create or replace function public.shift_odometer_spans(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  time_entry_id uuid,
  worker_id     uuid,
  vehicle_id    uuid,
  started_at    timestamptz,
  ended_at      timestamptz,
  first_km      double precision,
  last_km       double precision
)
language sql
stable
as $$
  select
    te.id,
    te.worker_id,
    te.vehicle_id,
    te.started_at,
    te.ended_at,
    f.km,
    l.km
  from public.time_entries te
  left join lateral (
    select dt.odometer_km::double precision as km
    from public.device_telemetry dt
    where dt.vehicle_id = te.vehicle_id
      and dt.odometer_km is not null
      and dt.recorded_at >= te.started_at
      and dt.recorded_at <= coalesce(te.ended_at, p_to)
    order by dt.recorded_at asc
    limit 1
  ) f on true
  left join lateral (
    select dt.odometer_km::double precision as km
    from public.device_telemetry dt
    where dt.vehicle_id = te.vehicle_id
      and dt.odometer_km is not null
      and dt.recorded_at >= te.started_at
      and dt.recorded_at <= coalesce(te.ended_at, p_to)
    order by dt.recorded_at desc
    limit 1
  ) l on true
  where te.vehicle_id is not null
    and te.worker_id is not null
    and te.started_at <= p_to
    and (te.ended_at is null or te.ended_at >= p_from);
$$;

-- ═══ 2) report_fuel_stats_vehicle — DOLUM BİRLEŞTİRME ═══
--
-- Kusur: tek fiziksel dolum ardışık okumalara bölününce her parça ayrı dolum
-- sayılıyordu. ÖLÇÜLDÜ (7 gün, canlı): gerçek 16 dolum serisine karşılık
-- sistem 19 adım saymış. Örnek — DO-719GV, 70 L, 06.08:
--     06:53:18  %18
--     06:54:20  %33  (+15 puan)  ← ayrı dolum sayılıyordu
--     06:56:36  %100 (+67 puan)  ← ayrı dolum sayılıyordu
--   toplam +82 puan = 57 L, tek fiziksel dolum.
--
-- ÇÖZÜM: ardışık YÜKSELİŞLER, aralarında MERGE_GAP'ten uzun boşluk yoksa TEK
-- dolum sayılır ve puanları toplanır. 15 dakika: ölçülen dolum içi adım aralığı
-- 1-3 dakika, iki AYRI dolum arasındaki en kısa mesafe ise saatler — 15 dk ikisi
-- arasında geniş bir güvenlik payı bırakıyor.
--
-- EŞİK 10 → 5 PUAN. Birleştirmeden ÖNCE 10 puan gerekliydi çünkü eşik hem
-- "gürültüyü ele" hem "dolumu yakala" işini birden yapıyordu. Artık gürültüyü
-- birleştirme+seri toplamı eliyor, eşik yalnız "bu seri gerçek bir dolum mu"
-- sorusunu cevaplıyor. ÖLÇÜLDÜ: 10 puanlık eşik DO-623GL'de gerçek bir dolumun
-- 7 puanlık ilk parçasını (4 L) düşürüyordu. 5 puan (~3,5 L) hâlâ sensör
-- gürültüsünün (1 puan = 0,7 L) çok üstünde.
--
-- Düşüş (drop) tarafı DEĞİŞMEDİ: 10 puan + odometre durağan şartı aynen duruyor.
-- Şüpheli düşüş bir HIRSIZLIK sinyali; onu gevşetmek yanlış alarm üretirdi.

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
    -- UÇ SATIR KURALI (027): ilk satırda geriye, son satırda ileriye pencere yok.
    select recorded_at, fuel, odo
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
           lag(c.fuel)        over w as prev_fuel,
           lag(c.odo)         over w as prev_odo,
           lag(c.recorded_at) over w as prev_at
    from clean c
    window w as (order by c.recorded_at)
  ),
  marked as (
    -- YENİ SERİ BAŞLANGICI: yükseliş değilse, ya da önceki okumadan 15 dk'dan
    -- uzun süre geçmişse. Bu bayrağın kümülatif toplamı seri kimliğidir.
    select s.*,
           case
             when s.prev_fuel is null then 1
             when s.fuel - s.prev_fuel <= 0 then 1
             when s.recorded_at - s.prev_at > interval '15 minutes' then 1
             else 0
           end as new_run
    from stepped s
  ),
  runs as (
    select m.*, sum(m.new_run) over (order by m.recorded_at) as run_id
    from marked m
  ),
  rises as (
    -- Seri başına toplam yükseliş. Yalnız POZİTİF adımlar toplanır: seriyi
    -- açan satırın kendisi yükseliş olmayabilir (new_run=1 iken).
    select run_id,
           sum(greatest(fuel - coalesce(prev_fuel, fuel), 0)) as total_rise
    from runs
    group by run_id
  )
  select
    p_vehicle_id                                    as vehicle_id,
    (select count(*) from clean)::bigint            as sample_count,
    (select avg(fuel) from clean)                   as avg_pct,
    (select min(fuel) from clean)                   as min_pct,
    (select max(fuel) from clean)                   as max_pct,
    (select fuel from clean order by recorded_at asc  limit 1) as first_pct,
    (select fuel from clean order by recorded_at desc limit 1) as last_pct,
    (select count(*) from rises where total_rise >= 5)::bigint as refill_count,
    (select coalesce(sum(total_rise), 0) from rises where total_rise >= 5) as refill_pct,
    (select count(*) from stepped
      where prev_fuel is not null and prev_fuel - fuel >= 10
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    )::bigint                                       as drop_count,
    (select coalesce(sum(prev_fuel - fuel), 0) from stepped
      where prev_fuel is not null and prev_fuel - fuel >= 10
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    )                                               as drop_pct
  where exists (select 1 from clean);
$$;

notify pgrst, 'reload schema';
