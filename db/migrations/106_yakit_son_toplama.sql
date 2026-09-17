-- 106 — YAKIT YÜZDE: SON TOPLAMA TEK GEÇİŞ (16c, Adım 2)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NE DEĞİŞİYOR
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `report_fuel_stats_vehicle` (052 → 104) ve `_v2` (101 → 102 → 104) sonuçlarını
-- ONBİR AYRI SKALER ALT SORGUYLA üretiyordu; her biri `clean`/`stepped`/`rises`
-- CTE'sini yeniden tarıyordu. 106 bunları 094'ün `group by` kalıbına çeviriyor:
-- `array_agg` ile ilk/son, `filter`lı `count`/`sum` ile düşüşler, tek geçiş.
--
-- ⚠️ `rises` (seri ekseni) SATIR ekseninde toplanamaz; dolum sayısı/miktarı
--    ayrı bir CTE olarak kalıyor. runs/rises MANTIĞI HİÇ DEĞİŞMEDİ.
--
-- ⚠️ GÖVDELER ELLE YAZILMADI. Yürürlükteki hâlden bir betikle türetildi ve
--    TERS DÖNÜŞÜM testiyle (yeni kuyruk → eski kuyruk = orijinal metin)
--    başka hiçbir karakterin değişmediği kanıtlandı.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 DÜRÜST ÖLÇÜM — BEKLENTİYİ KÜÇÜLTÜYOR
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "11 alt sorgu pahalıdır" varsayımı ÖLÇÜLDÜ ve BÜYÜK ORANDA ÇÜRÜDÜ. PGlite,
-- canlı ölçekte (68.000 yakıt okuması = demo/HAK61'in en yoğun aracının 30
-- günü), 5 koşum medyan:
--
--     report_fuel_stats_vehicle      686 ms → 662 ms   (−%3,5)
--     report_fuel_stats_vehicle_v2   343 ms → 309 ms   (−%10)
--
-- Sebep planda görünüyor: CTE'ler İKİDEN FAZLA kez anıldığı için Postgres
-- onları zaten BİR KEZ maddeleştiriyor; alt sorgular küçük maddeleşmiş kümeyi
-- tarıyor. Asıl maliyet `numbered`/`bounded`/`kuyruk` PENCERE ZİNCİRİ (68 bin
-- satırda planın ~%50'si) ve 106 ona dokunmuyor.
--
-- Değişiklik yine de alındı: %10 gerçek, plan düğümü azalıyor ve çıktı
-- BAYT-BAYT aynı. Ama "381 ms → 150 ms" hedefi BU YOLLA TUTMAZ.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- GERİ ALMA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 104'teki iki gövdeyi yeniden çalıştırmak yeter (`create or replace`).
-- ⚠️ HİÇBİR FONKSİYON DÜŞÜRÜLMEZ, hiçbir tablo/veri değişmez, kapı (104)
--    ve de-glitch/uç-satır kuralları (027/052) aynen duruyor.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- KAYNAK GÖVDELER
--   report_fuel_stats_vehicle        ← 104_yuzde_odo_kapisi_hizalama.sql
--   report_fuel_stats_vehicle_v2     ← 104_yuzde_odo_kapisi_hizalama.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

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
  ,
  -- ── TEK GEÇİŞ (106) — 094'ün group by kalıbı ────────────────────────────
  -- `stepped`in kardinalitesi `clean` ile AYNIDIR (lag eklenmiş hâli), bu
  -- yüzden sample_count/avg/min/max/first/last onun üstünden alınabilir.
  toplu as (
    select
      count(*)::bigint                                as sample_count,
      avg(fuel)                                       as avg_pct,
      min(fuel)                                       as min_pct,
      max(fuel)                                       as max_pct,
      -- telemetri-sinir: uc deger TEMIZ seriden (clean), ham tablodan DEGIL
      (array_agg(fuel order by recorded_at asc))[1]   as first_pct,
      (array_agg(fuel order by recorded_at desc))[1]  as last_pct,
      count(*) filter (
        where prev_fuel is not null and prev_fuel - fuel >= 10
          and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1
      )::bigint                                       as drop_count,
      coalesce(sum(prev_fuel - fuel) filter (
        where prev_fuel is not null and prev_fuel - fuel >= 10
          and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1
      ), 0)                                           as drop_pct
    from stepped
  ),
  -- Dolum SERİ eksenli (rises), satır ekseninde toplanamaz — ayrı kalıyor.
  dolum as (
    select count(*)::bigint             as refill_count,
           coalesce(sum(total_rise), 0) as refill_pct
    from rises where total_rise >= 5
  )
  select
    p_vehicle_id as vehicle_id,
    t.sample_count, t.avg_pct, t.min_pct, t.max_pct, t.first_pct, t.last_pct,
    d.refill_count, d.refill_pct, t.drop_count, t.drop_pct
  from toplu t cross join dolum d
  -- Eski gövdedeki `where exists (select 1 from clean)` ile AYNI: `clean` boşsa
  -- `toplu` tek satır (count 0) üretir ve bu koşul onu eler → 0 satır.
  where t.sample_count > 0;
$$;

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
  ,
  -- ── TEK GEÇİŞ (106) — 094'ün group by kalıbı ────────────────────────────
  -- `stepped`in kardinalitesi `clean` ile AYNIDIR (lag eklenmiş hâli), bu
  -- yüzden sample_count/avg/min/max/first/last onun üstünden alınabilir.
  toplu as (
    select
      count(*)::bigint                                as sample_count,
      avg(fuel)                                       as avg_pct,
      min(fuel)                                       as min_pct,
      max(fuel)                                       as max_pct,
      -- telemetri-sinir: uc deger TEMIZ seriden (clean), ham tablodan DEGIL
      (array_agg(fuel order by recorded_at asc))[1]   as first_pct,
      (array_agg(fuel order by recorded_at desc))[1]  as last_pct,
      count(*) filter (
        where prev_fuel is not null and prev_fuel - fuel >= 10
          and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1
      )::bigint                                       as drop_count,
      coalesce(sum(prev_fuel - fuel) filter (
        where prev_fuel is not null and prev_fuel - fuel >= 10
          and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1
      ), 0)                                           as drop_pct
    from stepped
  ),
  -- Dolum SERİ eksenli (rises), satır ekseninde toplanamaz — ayrı kalıyor.
  dolum as (
    select count(*)::bigint             as refill_count,
           coalesce(sum(total_rise), 0) as refill_pct
    from rises where total_rise >= 5
  )
  select
    p_vehicle_id as vehicle_id,
    t.sample_count, t.avg_pct, t.min_pct, t.max_pct, t.first_pct, t.last_pct,
    d.refill_count, d.refill_pct, t.drop_count, t.drop_pct
  from toplu t cross join dolum d
  -- Eski gövdedeki `where exists (select 1 from clean)` ile AYNI: `clean` boşsa
  -- `toplu` tek satır (count 0) üretir ve bu koşul onu eler → 0 satır.
  where t.sample_count > 0;
$$;

commit;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (uygulandıktan sonra)
-- ═══════════════════════════════════════════════════════════════════════════
-- select
--   (select count(*) from pg_get_functiondef(
--      (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='public' and p.proname='report_fuel_stats_vehicle'
--          and p.pronargs=3)) t where t like '%cross join dolum%')      as v1_tek_gecis,
--   (select count(*) from pg_get_functiondef(
--      (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='public' and p.proname='report_fuel_stats_vehicle_v2')
--    ) t where t like '%cross join dolum%')                             as v2_tek_gecis,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='report_fuel_stats')       as eski_2arg_durur,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='report_fuel_volume_stats_vehicle')
--                                                                       as litre_durur;
-- -- beklenen: v1_tek_gecis 1 · v2_tek_gecis 1 · eski_2arg_durur 1 · litre_durur 1
--
-- EŞDEĞERLİK (kapalı bir pencerede, 30 araç):
--   select v.plate, s.*
--   from public.vehicles v
--   cross join lateral public.report_fuel_stats_vehicle_v2(
--     '2026-08-01'::timestamptz, '2026-09-01'::timestamptz, v.id) s
--   order by v.plate;
-- 🔴 Bu çıktı 106 ÖNCESİYLE birebir aynı olmalı (11 kolon).
