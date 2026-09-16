-- 104 — YÜZDE HATTI ODOMETRE KAPISI HİZALAMA (28.08 kararının tamamlanması)  —  ÇALIŞTIRILDI 17.09.2026
--
-- ✅ ÜÇ KİRACIDA DA UYGULANDI (17.09.2026): HAK61 · Sendigo · galzura-demo.
--    Doğrulama 5/5 `hizalandi = true`.
--    ⚠️ `report_fuel_volume_stats_vehicle` satırında `depo_eski` de true
--    çıktı ve bu BEKLENEN: 094'ün gövdesindeki AÇIKLAMA yorumu eski biçimi
--    anlatıyor ve anlatmaya devam etmeli. `pg_get_functiondef` yorumları da
--    döndürür; kuralın kendisi `hizalandi` sütunundan okunur.
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 NEDEN: 28.08'DE VERİLEN KARAR YALNIZ LİTRE HATTINA UYGULANMIŞTI
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 28.08.2026'da 094'ün eşdeğerlik kapısı HAK61'de düştü ve sebep bulundu:
-- HAK61'in CANLI fonksiyonu depodan farklıydı (elle müdahale; ne zaman ve kim
-- tarafından BİLİNMİYOR). Ayrıntı: `docs/YAKIT-DUSUS-FARKI.md`.
--
--     depo        :  odo - prev_odo <  1
--     HAK61 canlı :  odo - prev_odo between -1 and 1
--
-- KARAR (Volkan, 28.08.2026): canlı biçim DOĞRU kabul edilir, üç kiracı da
-- ona hizalanır. Gerekçe fizik: bir çekici ~0,3 L/km yakar; ayrışan düşüşler
-- 6,1–8,3 L ve 9–147 saniyede olmuş — "araç 1 km hareket etti, normaldir"
-- açıklaması 27 kat yetersiz. Eksik raporlanan hırsızlık hiç görülmez.
--
-- O karar 094 (litre, 3 arg) ve 095 (litre, 2 arg) ile uygulandı.
-- 🔴 YÜZDE HATTI UNUTULDU. 17.09.2026'da ölçüldü: aynı elle müdahale
-- `report_fuel_stats_vehicle`ta da var ve depo hâlâ `< 1` diyor. Bugün üç
-- kiracı yüzde hattında BİRBİRİNDEN FARKLI çalışıyor:
--
--     HAK61        :  between -1 and 1   (elle değişmiş)
--     Sendigo      :  < 1                (depoyla aynı)
--     galzura-demo :  < 1                (depoyla aynı)
--
-- Bu dosya 28.08 kararını yüzde hattında da uygular.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ÖLÇÜLDÜ — 104 KİMİN SAYISINI DEĞİŞTİRİR (17.09.2026, canlı, salt okuma)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ≥10 puanlık düşüşlerin odometre kovası (HAK61, son 30 gün, 19 araç):
--
--     odo farkı        düşüş    puan     `< 1`   `between -1 and 1`
--     ─────────────    ─────   ──────    ─────   ──────────────────
--     < -1 km (geri)       0      0,0      ✓            ✗
--     = -1 km              0      0,0      ✓            ✓
--     =  0 km            185   2321,0      ✓            ✓
--     = +1 km              7     90,0      ✗            ✓
--     > +1 km             10    125,0      ✗            ✗
--     ─────────────    ─────   ──────
--     TOPLAM `< 1`       185   2321,0
--     TOPLAM `between`   192   2411,0
--
-- HAK61 CANLIDA BUGÜN 192 / 2.411 GÖRÜYOR → **104 sonrası AYNI KALIR.**
-- Depoya hizalansaydı (`< 1`) 185 / 2.321'e düşerdi (−%3,6 / −%3,7) — yani
-- tam da 28.08'de reddedilen yön.
--
--   Ağustos 2026 penceresinde `+1 km` kovası BOŞ → o ayın raporu iki kuralda
--   da 14 düşüş / 189 puan. Yani geçmiş aylık raporlar DEĞİŞMEZ.
--
--   Sendigo: son 30 günde ≥10 puanlık düşüş 0, `+1 km` kovası 0 → değişiklik
--   yok. ⚠️ Ölçüm KISMİ: bir aracın serisi 100.000 satır tavanına dayandı.
--   galzura-demo ölçülmedi (gerçek müşteri değil).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- KAPSAM — ÜÇ FONKSİYON, TEK DEĞİŞİKLİK
-- ═══════════════════════════════════════════════════════════════════════════
--
--   report_fuel_stats            (2 arg)  ← 027'nin gövdesi
--   report_fuel_stats_vehicle    (3 arg)  ← 052'nin gövdesi
--   report_fuel_stats_vehicle_v2 (3 arg)  ← 102'nin gövdesi
--
-- Üçü BİRLİKTE değişmek zorunda: 2 argümanlı sürüm 050/052'nin geri düşüş
-- yolu, v2 ise ön-etiketli okuma yolu. Biri eksik kalırsa aynı pencere üç
-- farklı sayı verir (095'in kendi uyarısının aynısı).
--
-- ⚠️ GÖVDELER DEPODAN ÜRETİLDİ, ELLE KOPYALANMADI. Tek fark
-- `odo - prev_odo < 1` → `odo - prev_odo between -1 and 1` (her gövdede 2 yer,
-- toplam 6). Ters çevirme testi yapıldı: değişiklik geri alındığında gövdeler
-- kaynak dosyalarla BAYT-BAYT aynı çıkıyor.
--
-- ⚠️ 027'NİN 2 ARGÜMANLI SÜRÜMÜ BAŞKA EŞİKLER TAŞIR ve bu BİLEREK korundu:
-- düşüş eşiği 8 (3 argümanlıda 10), ek olarak 3600 sn'lik adım kapısı, dolum
-- adım başına (seri birleştirme yok). Onlar bu turun konusu değil; yalnız
-- odometre kapısı hizalandı.
--
-- ⚠️ 026/027/050/052/102 DOSYALARINA DOKUNULMADI (095 kalıbı: uygulanmış
-- migration geriye dönük düzenlenmez). Değişiklik bu dosyada yaşar.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- GERİ ALMA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 027 / 052 / 102'deki gövdeleri yeniden çalıştırmak yeter (hepsi
-- `create or replace`). ⚠️ AMA ÜÇÜ BİRLİKTE — biri geri alınırsa yollar
-- ayrışır. Geri alma HAK61'in müşteriye giden "şüpheli kayıp" rakamını
-- %3,7 DÜŞÜRÜR; sessiz yapılmamalıdır.
--
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ════════════ 1 · report_fuel_stats (2 arg) — 027'nin gövdesi ══════════════
--    Kaynak: db/migrations/027_fuel_stats_edge_fix.sql

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
        and odo - prev_odo between -1 and 1
        and extract(epoch from (recorded_at - prev_at)) <= 3600
    )::bigint                                                 as drop_count,
    coalesce(sum(prev_fuel - fuel) filter (
      where prev_fuel is not null
        and prev_fuel - fuel >= 8
        and prev_odo is not null and odo is not null
        and odo - prev_odo between -1 and 1
        and extract(epoch from (recorded_at - prev_at)) <= 3600
    ), 0)                                                     as drop_pct
  from stepped
  group by vehicle_id;
$$;

-- ════════════ 2 · report_fuel_stats_vehicle (3 arg) — 052'nin gövdesi ══════
--    Kaynak: db/migrations/052_shift_distance_and_refill_merge.sql

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
        and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1
    )::bigint                                       as drop_count,
    (select coalesce(sum(prev_fuel - fuel), 0) from stepped
      where prev_fuel is not null and prev_fuel - fuel >= 10
        and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1
    )                                               as drop_pct
  where exists (select 1 from clean);
$$;

-- ════════════ 3 · report_fuel_stats_vehicle_v2 — 102'nin gövdesi ══════════
--    Kaynak: db/migrations/102_yakit_v2_pencere_duzeltme.sql

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
        and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1
    )::bigint                                       as drop_count,
    (select coalesce(sum(prev_fuel - fuel), 0) from stepped
      where prev_fuel is not null and prev_fuel - fuel >= 10
        and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1
    )                                               as drop_pct
  where exists (select 1 from clean);
$$;

commit;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (uygulandıktan sonra, üç kiracıda da)
-- ═══════════════════════════════════════════════════════════════════════════
-- select proname, pronargs,
--        pg_get_functiondef(oid) like '%odo - prev_odo < 1%'              as depo_eski,
--        pg_get_functiondef(oid) like '%odo - prev_odo between -1 and 1%' as hizalandi
-- from pg_proc
-- where proname in ('report_fuel_stats','report_fuel_stats_vehicle',
--                   'report_fuel_volume_stats','report_fuel_volume_stats_vehicle',
--                   'report_fuel_stats_vehicle_v2')
-- order by proname, pronargs;
-- -- beklenen: HER SATIRDA depo_eski false · hizalandi true
