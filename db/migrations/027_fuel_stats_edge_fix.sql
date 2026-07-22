-- HAK61 — Migration 027
-- report_fuel_stats: DE-GLITCH UÇ-SATIR DÜZELTMESİ (22.07.2026)
--
-- 026'daki de-glitch iki taraflı koşul arıyordu: bir okuma hem ÖNCEKİ 30 hem
-- SONRAKİ 30 satırın en yükseğinden ≥10 puan düşükse geçici çukur sayılıp
-- eleniyordu. Partition'ın İLK satırında geriye bakan pencere yalnız satırın
-- kendisini içerir → bwd_max = fuel → koşul YAPISAL OLARAK sağlanamaz ve
-- baştaki glitch elenmez. Simetrik olarak SON satırda fwd_max = fuel.
--
-- CANLI ETKİ (ölçüldü, 22.07.2026): DO-512GT'nin aralıktaki ilk okuması %0,
-- 4 saniye sonra %100 → sahte "1 dolum / 60 L" ve min %0. Üç aralıkta da
-- (7 gün / 30 gün / tüm zaman) tek araç, tek olay; filo dolum toplamının
-- 527 L'sinin 60 L'si uydurmaydı. Tüketim rakamı etkilenmiyordu: hayalet dolum
-- (+100 puan) ile hayalet düşük ilk okuma (−100 puan) denge kimliğinde
-- sadeleşiyor. Bozulan yerler: DOLUM kolonu, min/ort seviye, filo dolum toplamı.
--
-- ÇÖZÜM: uçlarda tek taraflı karar. İlk satırda yalnız fwd_max, son satırda
-- yalnız bwd_max yeterli sayılır. ORTADAKİ satırlarda kural DEĞİŞMEZ (iki
-- taraflı) — gerçek sürekli düşüşler (kaçak sinyali) korunur.
--
-- Tek satırlık partition'da rn = 1 dalı çalışır ve fwd_max = fuel olduğu için
-- okuma elenmez: tek bir ölçümden çukur kararı verilemez.
--
-- BİLİNÇLİ OLARAK ÇÖZÜLMEYEN: uzun sıfır SERİLERİ (DO-687GX — 18.07'de 7.801
-- okumanın 1.729'u %0). Bu bir V-çukuru değil, yarı ölü sensördür; 30 satırlık
-- pencere de uç-satır düzeltmesi de onu elemez ve ELEMEMELİ (sürekli sıfır
-- gerçek bir sinyal olabilir). Bu araçlar uygulama katmanında "veri güvenilmez"
-- rozetiyle işaretlenir (lib/reports.ts, UNRELIABLE_ZERO_RATIO).
--
-- 026 GERİYE DÖNÜK DEĞİŞTİRİLMEDİ: onu çalıştırmış kurulumlar bu dosyayı da
-- çalıştırır; sıfırdan kurulanlar 026 → 027 sırasıyla doğru sonuca ulaşır.
-- İdempotent (create or replace), tablo/kolon/akış değişmez.

create or replace function public.report_fuel_stats(
  p_from timestamptz,
  p_to   timestamptz
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
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.fuel_level_pct is not null
  ),
  -- DE-GLITCH: cihazın CAN dropout'ları yakıtı anlık 0'a düşürüp saniyeler
  -- içinde geri döndürüyor (canlı: DO-805HK 65→0→65 2 sn'de, DO-806HK
  -- 36→0→0→36). Böyle V-şekilli geçici çukurlar hem sahte DOLUM (0→65) hem
  -- sahte KAÇAK (65→0) üretir ve tüketimi şişirir. Gerçek SÜREKLİ düşüş
  -- (çukurdan sonra da düşük kalır → fwd_max düşük) elenmez.
  --
  -- Pencere SATIR (rows) tabanlı — zaman (range) değil: 30 satır art arda birden
  -- çok sıfır çukurunu kapsar ve interval-RANGE'in ortam bağımlılığından kaçınır.
  --
  -- rn/cnt: partition'ın UÇ satırlarını tanımak için (bkz. başlık).
  bounded as (
    select
      b.*,
      max(b.fuel) over (
        partition by b.vehicle_id order by b.recorded_at
        rows between 30 preceding and current row
      ) as bwd_max,
      max(b.fuel) over (
        partition by b.vehicle_id order by b.recorded_at
        rows between current row and 30 following
      ) as fwd_max,
      row_number() over (
        partition by b.vehicle_id order by b.recorded_at
      ) as rn,
      count(*) over (partition by b.vehicle_id) as cnt
    from base b
  ),
  clean as (
    select vehicle_id, recorded_at, fuel, odo
    from bounded
    where not (
      case
        -- İLK satır: geriye bakacak veri yok → yalnız ileriye bak.
        when rn = 1   then fwd_max - fuel >= 10
        -- SON satır: ileriye bakacak veri yok → yalnız geriye bak.
        when rn = cnt then bwd_max - fuel >= 10
        -- Ortada: kural değişmedi.
        else bwd_max - fuel >= 10 and fwd_max - fuel >= 10
      end
    )
  ),
  stepped as (
    select
      c.*,
      lag(c.fuel)        over w as prev_fuel,
      lag(c.odo)         over w as prev_odo,
      lag(c.recorded_at) over w as prev_at
    from clean c
    window w as (partition by c.vehicle_id order by c.recorded_at)
  )
  select
    vehicle_id,
    count(*)::bigint                                          as sample_count,
    avg(fuel)                                                 as avg_pct,
    min(fuel)                                                 as min_pct,
    max(fuel)                                                 as max_pct,
    (array_agg(fuel order by recorded_at asc))[1]            as first_pct,
    (array_agg(fuel order by recorded_at desc))[1]           as last_pct,
    count(*) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 10
    )::bigint                                                 as refill_count,
    coalesce(sum(fuel - prev_fuel) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 10
    ), 0)                                                     as refill_pct,
    count(*) filter (
      where prev_fuel is not null
        and prev_fuel - fuel >= 8
        and prev_odo is not null and odo is not null
        and odo - prev_odo < 1
        and extract(epoch from (recorded_at - prev_at)) <= 3600
    )::bigint                                                 as drop_count,
    coalesce(sum(prev_fuel - fuel) filter (
      where prev_fuel is not null
        and prev_fuel - fuel >= 8
        and prev_odo is not null and odo is not null
        and odo - prev_odo < 1
        and extract(epoch from (recorded_at - prev_at)) <= 3600
    ), 0)                                                     as drop_pct
  from stepped
  group by vehicle_id;
$$;

revoke execute on function public.report_fuel_stats(timestamptz, timestamptz) from public;
grant  execute on function public.report_fuel_stats(timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
