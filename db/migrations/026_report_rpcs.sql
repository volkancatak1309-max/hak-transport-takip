-- HAK61 — Migration 026
-- Rapor toplulaştırma fonksiyonları (Yakıt + Motor Sıcaklığı raporları, FAZ 3).
--
-- NEDEN RPC: device_telemetry ~258 bin satır. Yakıt ve sıcaklık raporları
-- araç başına ort/min/max, dolum tespiti, kaçak sinyali ve günlük trend ister —
-- bunlar tüm satırların taranmasını gerektirir. Supabase PostgREST'te aggregate
-- fonksiyonları KAPALI (PGRST123), ayrıca 258 bin satır uygulamaya taşınamaz
-- (bkz. lib/reports.ts başlığı). Bu yüzden toplulaştırma Postgres tarafında,
-- indeksli (vehicle_id, recorded_at) tarama ile burada yapılır.
--
-- Tamamen EKLEMELİ ve idempotent: yalnız üç yeni fonksiyon. Hiçbir tablo/kolon/
-- akış değişmez. Fonksiyon yoksa raporlar çökmez — lib/reports.ts hatayı yakalar
-- ve "migrasyon bekliyor" boş durumuna düşer.
--
-- Supabase SQL Editor'da BU SÜRÜMÜ DEPLOY ETMEDEN ÖNCE çalıştırın.
-- (tank_capacity_l kolonu ZATEN VAR ve dolu — burada eklenmez.)

-- ── 1) YAKIT — araç başına yakıt seviyesi (%) istatistikleri ─────────────────
-- fuel_level_pct cihazın gerçek yüzde okumasıdır (CAN can.fuel.level). Dönüş
-- birim-bağımsızdır (yalnız %): litre/L100km çevrimi uygulamada tank_capacity_l
-- ile yapılır, böylece fonksiyon kapasiteden habersiz kalır.
--
-- Eşikler (ayarlanabilir, sabit yorumlu):
--   • DOLUM  : ardışık iki okuma arası +10 puan ve üstü sıçrama = yakıt alımı.
--              (Gerçek dolumlar 20-90 puan sıçrar; +10 gürültüyü eler, 60-80 L
--              tankta ~6-8 L'lik en küçük anlamlı alımı yakalar.)
--   • ŞÜPHELİ DÜŞÜŞ (kaçak/hırsızlık): -8 puan ve üstü düşüş, ARACIN HAREKET
--              ETMEDİĞİ anda (iki okuma arası odometre < 1 km) ve iki okuma 1
--              saatten yakınsa. "Yakıt düştü ama araç 1 km bile gitmedi" güçlü,
--              uydurması zor bir sinyaldir. Odometre yoksa BAYRAK YOK (temkinli:
--              az sayar, uydurmaz). Sürüş tüketimi (hareket hâlinde düşüş) bu
--              sayıya GİRMEZ.
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
  -- içinde geri döndürüyor (canlıda görüldü 2026-07: DO-805HK 65→0→65 2 sn'de,
  -- DO-806HK 36→0→0→36 art arda iki sıfır). Böyle V-şekilli geçici çukurlar hem
  -- sahte DOLUM (0→65) hem sahte KAÇAK (65→0) üretir ve tüketimi şişirir. Bir
  -- okuma, hem ÖNCEKİ 30 okumanın hem SONRAKİ 30 okumanın en yükseğinden ≥10 puan
  -- düşükse geçici çukurdur → elenir. Gerçek SÜREKLİ düşüş (çukurdan sonra da düşük
  -- kalır → fwd_max düşük) elenmez, yani gerçek kaçak sinyali korunur.
  --
  -- Pencere neden SATIR (rows) — zaman (range) değil: 30 satır art arda birden çok
  -- sıfır çukurunu da kapsar (okumalar saniyeler arayla akıyor) ve interval-RANGE
  -- çerçevesinin ortam bağımlılığından kaçınır. Eşik 10 = dolum eşiğiyle aynı.
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
      ) as fwd_max
    from base b
  ),
  clean as (
    select vehicle_id, recorded_at, fuel, odo
    from bounded
    where not (bwd_max - fuel >= 10 and fwd_max - fuel >= 10)
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

-- ── 2) MOTOR SICAKLIĞI — araç başına soğutma suyu (°C) istatistikleri ────────
-- coolant_temp_c = can.engine.coolant.temperature. hot_count aşırı ısınma
-- eşiğini (≥105 °C) aşan okuma sayısıdır: dizel motorda ~85-95 normal, ~100
-- fan devreye girer, ≥105 uyarı bölgesi. Eşik ayarlanabilir; uydurma risk
-- üretmez — hiçbir okuma aşmıyorsa hot_count 0 döner ("aşırı ısınma yok").
create or replace function public.report_coolant_stats(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  vehicle_id   uuid,
  sample_count bigint,
  avg_c        double precision,
  max_c        double precision,
  min_c        double precision,
  hot_count    bigint
)
language sql
stable
as $$
  select
    vehicle_id,
    count(*)::bigint                                    as sample_count,
    avg(coolant_temp_c)                                 as avg_c,
    max(coolant_temp_c)                                 as max_c,
    min(coolant_temp_c)                                 as min_c,
    count(*) filter (where coolant_temp_c >= 105)::bigint as hot_count
  from public.device_telemetry
  where recorded_at >= p_from
    and recorded_at <= p_to
    and coolant_temp_c is not null
  group by vehicle_id;
$$;

-- ── 3) MOTOR SICAKLIĞI — filo geneli günlük trend (Europe/Vienna) ────────────
-- Trend çizgisi için gün başına ort/max °C. Gün, filonun geri kalanıyla aynı
-- DST-güvenli Vienna gün anahtarıyla hesaplanır.
create or replace function public.report_coolant_daily(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  day          date,
  avg_c        double precision,
  max_c        double precision,
  sample_count bigint
)
language sql
stable
as $$
  select
    (recorded_at at time zone 'Europe/Vienna')::date as day,
    avg(coolant_temp_c)                               as avg_c,
    max(coolant_temp_c)                               as max_c,
    count(*)::bigint                                  as sample_count
  from public.device_telemetry
  where recorded_at >= p_from
    and recorded_at <= p_to
    and coolant_temp_c is not null
  group by (recorded_at at time zone 'Europe/Vienna')::date
  order by day;
$$;

-- Yalnız service-role çağırsın (uygulama bu anahtarla çağırır). PostgREST'in
-- anon/authenticated rolleri telemetri toplamlarına erişmesin.
revoke execute on function public.report_fuel_stats(timestamptz, timestamptz)    from public;
revoke execute on function public.report_coolant_stats(timestamptz, timestamptz) from public;
revoke execute on function public.report_coolant_daily(timestamptz, timestamptz) from public;
grant execute on function public.report_fuel_stats(timestamptz, timestamptz)    to service_role;
grant execute on function public.report_coolant_stats(timestamptz, timestamptz) to service_role;
grant execute on function public.report_coolant_daily(timestamptz, timestamptz) to service_role;

-- PostgREST şema önbelleğini hemen tazele (fonksiyonlar /rpc altında görünsün).
notify pgrst, 'reload schema';
