-- 039_fuel_volume.sql — YAKIT HACMİ (LİTRE) HATTI
--
-- Sorun (27.07.2026 flespi teşhisi): filodaki 6 VW Crafter yakıt seviyesini
-- YÜZDE olarak HİÇ göndermiyor — `can.fuel.level` her satırda NULL. Bu yüzden
-- yakıt raporunda "Veri yok" düşüyorlardı ve "sensörsüz" sanılıyorlardı.
-- Oysa cihaz `can.fuel.volume` ile HACMİ (litre) gönderiyor ve sinyal TEMİZ:
--   DO-776GS 4.193 fix, 23,4–39,8 L, en büyük adım 0,1 L, 95 km'de 15,6 L düşüş
--   DO-753GS · DO-775GS · DO-945HL aynı desen (adım ≤0,5 L)
-- Bizim çekme kodumuz yalnız yüzde adaylarını okuyordu (lib/flespi.ts).
--
-- ⚠️ LİTRE FİLO GENELİNE AÇILMAZ. Hem yüzde hem hacim gönderen 11 araçta
-- hacim ÇÖP: 3 günde 13.872 L "artış", 0↔79 arası binlerce salınım, depo
-- kapasitesinin üstünde değerler (DO-747GU 100 L / kayıt 60 L). O araçlarda
-- yüzde sağlam, litreye ihtiyaç yok. Bu yüzden rapor sırası: YÜZDE varsa yüzde,
-- YOKSA litre — ve litre yolunda gürültü muhafızı var (aşağıdaki max_step_l).
--
-- Additive + idempotent. Kolon yokken uygulama best-effort çalışmaya devam eder
-- (flespi sync insert'i kolon hatasında kolonsuz tekrar dener; rapor RPC'si
-- yoksa litre yolu sessizce kapalı kalır, yüzde yolu aynen çalışır).

alter table public.device_telemetry
  add column if not exists fuel_volume_l numeric;

-- Rapor sorgusu (araç + zaman aralığı + dolu hacim) bu kısmi indeksten gider.
-- Kısmi: satırların çoğunda hacim NULL (yüzde gönderen araçlar), indekse girmez.
create index if not exists idx_device_telemetry_fuel_volume
  on public.device_telemetry (vehicle_id, recorded_at)
  where fuel_volume_l is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- LİTRE İSTATİSTİĞİ — report_fuel_stats'ın hacim ikizi.
--
-- Yüzde sürümüyle AYNI iskelet (de-glitch → adım → toplulaştırma), yalnız
-- eşikler litreye çevrildi:
--   de-glitch çukuru : 10 puan  →  5 L
--   dolum eşiği      : 10 puan  →  5 L
-- ve BİR ALAN EKLENDİ: max_step_l = ardışık iki okuma arasındaki en büyük
-- MUTLAK sıçrama. Gürültü muhafızı bunu kullanır: >5 L ise o aracın litresi
-- güvenilmez sayılır ve rapor "Veri yok"a düşer (uydurma sayı göstermez).
-- Ölçüm: temiz araçlarda max_step 0,1–1,0 L; çöp araçlarda 30–79 L.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.report_fuel_volume_stats(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  vehicle_id   uuid,
  sample_count bigint,
  avg_l        double precision,
  min_l        double precision,
  max_l        double precision,
  first_l      double precision,
  last_l       double precision,
  refill_count bigint,
  refill_l     double precision,
  drop_count   bigint,
  drop_l       double precision,
  max_step_l   double precision
)
language sql
stable
as $$
  with base as (
    select
      dt.vehicle_id,
      dt.recorded_at,
      dt.fuel_volume_l::double precision as fuel,
      dt.odometer_km::double precision   as odo
    from public.device_telemetry dt
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.fuel_volume_l is not null
  ),
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
    where not (bwd_max - fuel >= 5 and fwd_max - fuel >= 5)
  ),
  stepped as (
    select
      c.*,
      lag(c.fuel) over w as prev_fuel,
      lag(c.odo)  over w as prev_odo
    from clean c
    window w as (partition by c.vehicle_id order by c.recorded_at)
  )
  select
    vehicle_id,
    count(*)::bigint                                as sample_count,
    avg(fuel)                                       as avg_l,
    min(fuel)                                       as min_l,
    max(fuel)                                       as max_l,
    (array_agg(fuel order by recorded_at asc))[1]   as first_l,
    (array_agg(fuel order by recorded_at desc))[1]  as last_l,
    count(*) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 5
    )::bigint                                       as refill_count,
    coalesce(sum(fuel - prev_fuel) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 5
    ), 0)                                           as refill_l,
    -- ŞÜPHELİ DÜŞÜŞ: araç HAREKET ETMEDEN (odometre ilerlemeden) ≥5 L düşüş.
    -- Odometre yoksa bayrak YOK (temkinli: az sayar, uydurmaz).
    count(*) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 5
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    )::bigint                                       as drop_count,
    coalesce(sum(prev_fuel - fuel) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 5
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    ), 0)                                           as drop_l,
    coalesce(max(abs(fuel - prev_fuel)) filter (where prev_fuel is not null), 0)
                                                    as max_step_l
  from stepped
  group by vehicle_id;
$$;

notify pgrst, 'reload schema';
