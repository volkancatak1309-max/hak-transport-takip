-- 102 — 101'İN v2'SİNDEKİ O(n²) PENCERE ÇERÇEVESİ DÜZELTMESİ
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 NE OLDU — 101 DOĞRU SAYIYI ÜRETİYOR AMA YAVAŞ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 101 galzura-demo'da uygulandı, backfill koştu (710.912 satır) ve SAYILAR
-- DOĞRU ÇIKTI. Ama süre ölçülünce v2, v1'den KAT KAT yavaş çıktı
-- (galzura-demo canlı, 17.09.2026, en yoğun araç W-GF-123 · 83.301 satır):
--
--     pencere              v1 (052)     v2 (101)
--     30 gün                1.541 ms     8.072 ms  ← 57014 tavanı
--      7 gün                  413 ms     8.066 ms  ← 57014 tavanı
--     filo · 30 gün         7.383 ms    24.699 ms
--
-- 01–07.09 penceresinde 30 aracın 8'i zaman aşımına uğradı ve KIYASLANAMADI.
-- (Kıyaslanabilen 74 araç×pencere ölçümünde sayısal fark 0 idi — kusur
-- doğrulukta değil, YALNIZCA sürede.)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SEBEP: `rows between current row and unbounded following` + max()
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 101'in v2'si pencere kenarını düzeltmek için şunu kullanıyordu:
--
--     max(fuel) over (order by recorded_at rows between current row and unbounded following)
--
-- `max()` için TERS geçiş fonksiyonu yoktur. Çerçevenin BAŞI ilerlediğinde
-- Postgres toplamı artımlı güncelleyemez ve her satır için çerçeveyi BAŞTAN
-- tarar → O(n²). Çerçeve `unbounded preceding`den geldiğinde ise çerçeve
-- yalnız BÜYÜR, artımlı güncellenir → O(n).
--
-- ÖLÇÜLDÜ (PGlite, PostgreSQL 18.3 — aynı makine, aynı veri):
--
--     satır     ileri-sınırsız    desc-artımlı    31 satırlık kayan (v1)
--     10.000        4.800 ms          21 ms             52 ms
--     20.000       19.619 ms          35 ms             89 ms
--     40.000       69.537 ms          68 ms            179 ms
--
-- İleri-sınırsız her ikiye katlamada DÖRDE katlanıyor (O(n²) imzası);
-- desc-artımlı ikiye katlanıyor (O(n)). 40 bin satırda fark **1.022×**.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DÜZELTME: AYNI DEĞER, ARTIMLI ÇERÇEVE
-- ═══════════════════════════════════════════════════════════════════════════
--
--     ÖNCE : max(fuel) over (order by recorded_at      rows between current row and unbounded following)
--     SONRA: max(fuel) over (order by recorded_at desc rows between unbounded preceding and current row)
--
-- `desc` sıralamada "unbounded preceding" SON satırdan bu satıra kadar olan
-- küme demektir — yani artan sırada `rn..cnt`. İleri-sınırsız çerçevenin
-- TAM OLARAK AYNI kümesi; yalnız Postgres onu artımlı hesaplayabiliyor.
-- Döndürülen sayı değişmez (PGlite'ta 19/19 denklik denetimi yeniden koştu).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- KAPSAM
-- ═══════════════════════════════════════════════════════════════════════════
--
-- YALNIZ `report_fuel_stats_vehicle_v2` yeniden yazılır. `fuel_seri` tablosuna,
-- `yakit_seri_etiketle`ye, 052'nin eski fonksiyonuna DOKUNULMAZ; etiketlenmiş
-- satırlar OLDUĞU GİBİ geçerli kalır (backfill tekrarlanmaz).
--
-- Geri alma: 101'deki v2 gövdesini yeniden çalıştırmak yeter (ya da
-- `drop function if exists public.report_fuel_stats_vehicle_v2(timestamptz, timestamptz, uuid);`
-- → uygulama otomatik olarak 052'nin yoluna düşer).
--
-- ⚠️ 101 UYGULANMAMIŞ KİRACIDA: önce 101, sonra 102. Tek başına çalıştırılırsa
-- `fuel_seri` tablosu olmadığı için fonksiyon oluşur ama ilk çağrıda hata verir.
--
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.report_fuel_stats_vehicle_v2(
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
  with esik as (
    -- Etiketli serinin GÜVENLİ ucu: sondaki 30 satırın ileri penceresi
    -- eksik olabilir, onlar canlı hesaplanır.
    select coalesce(
      (select fs.recorded_at
         from public.fuel_seri fs
        where fs.vehicle_id = p_vehicle_id
        order by fs.recorded_at desc
        offset 30 limit 1),
      '-infinity'::timestamptz
    ) as t
  ),
  etiketli as (
    select fs.recorded_at, fs.fuel, fs.odo, fs.bwd_max, fs.fwd_max
    from public.fuel_seri fs, esik e
    where fs.vehicle_id = p_vehicle_id
      and fs.recorded_at >= p_from
      and fs.recorded_at <= p_to
      and fs.recorded_at < e.t
  ),
  kuyruk_ham as (
    -- Eşikten sonraki ham satırlar
    select dt.recorded_at,
           dt.fuel_level_pct::double precision as fuel,
           dt.odometer_km::double precision    as odo
    from public.device_telemetry dt, esik e
    where dt.vehicle_id = p_vehicle_id
      and dt.fuel_level_pct is not null
      and dt.recorded_at >= e.t
      and dt.recorded_at <= p_to
    union all
    -- + tam 30 satırlık geri örtüşme (kuyruğun bwd_max'ı doğru çıksın)
    select o.recorded_at, o.fuel, o.odo
    from esik e
    cross join lateral (
      select dt.recorded_at,
             dt.fuel_level_pct::double precision as fuel,
             dt.odometer_km::double precision    as odo
      from public.device_telemetry dt
      where dt.vehicle_id = p_vehicle_id
        and dt.fuel_level_pct is not null
        and dt.recorded_at < e.t
      order by dt.recorded_at desc
      limit 30
    ) o
  ),
  kuyruk as (
    select k.recorded_at, k.fuel, k.odo,
           max(k.fuel) over (order by k.recorded_at rows between 30 preceding and current row) as bwd_max,
           /**
            * ⚠️ SINIRLI çerçeve (30 following) — burada O(n²) SORUNU YOK:
            * çerçeve genişliği sabit olduğu için Postgres satır başına en çok
            * 31 değer tarar. Sorun yalnız `unbounded following`de doğuyordu.
            */
           max(k.fuel) over (order by k.recorded_at rows between current row and 30 following) as fwd_max
    from kuyruk_ham k
  ),
  base as (
    select recorded_at, fuel, odo, bwd_max, fwd_max from etiketli
    union all
    /**
     * ⚠️ `recorded_at >= e.t` ŞART. `kuyruk` içindeki 30 satırlık geri
     * örtüşme YALNIZ pencere fonksiyonunu doğru beslemek için var; o
     * satırlar `etiketli`de ZATEN bulunuyor. Bu koşul olmadan aynı 30
     * satır iki kez sayılır (PGlite denemesinde birebir bu görüldü:
     * sample_count 8.627 yerine 8.657).
     */
    select k.recorded_at, k.fuel, k.odo, k.bwd_max, k.fwd_max
      from kuyruk k, esik e
     where k.recorded_at >= e.t
       and k.recorded_at >= p_from
       and k.recorded_at <= p_to
  ),
  numbered as (
    select b.*,
           row_number() over (order by b.recorded_at) as rn,
           count(*)     over ()                       as cnt
    from base b
  ),
  bounded as (
    /**
     * PENCEREYE GÖRE DÜZELTME — 052'de ilk/son 31 satırın kayan penceresi
     * PENCERENİN İÇİNDE kırpılır; etiketteki değer ise pencere dışına da bakar.
     *
     * ⚠️ 102'NİN TEK DEĞİŞİKLİĞİ AŞAĞIDAKİ `desc`. 101'de ileri düzeltme
     * `rows between current row and unbounded following` idi; `max()` için
     * ters geçiş fonksiyonu olmadığından Postgres her satırda çerçeveyi
     * baştan tarıyor → O(n²) (40 bin satırda 69,5 sn). `order by ... desc`
     * + `unbounded preceding` AYNI KÜMEDİR ama çerçeve yalnız büyüdüğü için
     * artımlı hesaplanır → O(n) (aynı veride 68 ms).
     */
    select n.*,
           case when n.rn <= 31
                then max(n.fuel) over (order by n.recorded_at rows between unbounded preceding and current row)
                else n.bwd_max end as bwd_w,
           case when n.rn > n.cnt - 31
                then max(n.fuel) over (order by n.recorded_at desc rows between unbounded preceding and current row)
                else n.fwd_max end as fwd_w
    from numbered n
  ),
  clean as (
    -- UÇ SATIR KURALI (027) — 052'den birebir.
    select recorded_at, fuel, odo
    from bounded
    where not (
      case
        when rn = 1   then fwd_w - fuel >= 10
        when rn = cnt then bwd_w - fuel >= 10
        else bwd_w - fuel >= 10 and fwd_w - fuel >= 10
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

comment on function public.report_fuel_stats_vehicle_v2(timestamptz, timestamptz, uuid) is
  'report_fuel_stats_vehicle (052) ile BİREBİR aynı çıktı; 31 satırlık iki kayan maksimum fuel_seri''den okunur. 102: ileri kenar düzeltmesi O(n²) çerçeveden desc-artımlı çerçeveye alındı (40 bin satırda 69,5 sn → 68 ms).';

commit;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (uygulandıktan sonra)
-- ═══════════════════════════════════════════════════════════════════════════
-- select
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='report_fuel_stats_vehicle_v2')  as v2_fn,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='report_fuel_stats_vehicle')     as eski_duruyor,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='yakit_seri_etiketle')           as etiketleme_fn,
--   (select count(*) from public.fuel_seri)                                   as etiketli_satir,
--   (select count(*) from pg_get_functiondef(
--      (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='public' and p.proname='report_fuel_stats_vehicle_v2')
--    ) t where t like '%desc rows between unbounded preceding%')              as duzeltme_var;
-- -- beklenen: v2_fn 1 · eski_duruyor 1 · etiketleme_fn 1 ·
-- --           etiketli_satir DEĞİŞMEZ (demo'da 710.912) · duzeltme_var 1
