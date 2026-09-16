-- 103 — LİTRE HATTI İÇİN SERİ ÖN-ETİKETLEME (101'in birebir ikizi)  —  ÇALIŞTIRILDI 17.09.2026
--
-- ✅ ÜÇ KİRACIDA DA UYGULANDI (17.09.2026): HAK61 · Sendigo · galzura-demo.
--    Doğrulama: tablo 2 · yeni fonksiyon 4 · ESKİ fonksiyonlar 2 ·
--    eski_cerceve false (102'nin O(n²) çerçevesi yok).
-- ═══════════════════════════════════════════════════════════════════════════
-- NEDEN (galzura-demo canlı ölçümü, 17.09.2026 — 101+102 uygulandıktan SONRA)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 101+102 yüzde hattını %40 hızlandırdı ama `buildFuelReport` hedefi tutmadı.
-- Aşama aşama ölçüldü ("ay" penceresi, 29 araç, mapBounded 6):
--
--     1. yüzde  report_fuel_stats_vehicle    ×29   7.151 ms
--        yüzde  report_fuel_stats_vehicle_v2 ×29   4.296 ms   ← 101+102
--     2. LİTRE  report_fuel_volume_stats_vehicle ×10  5.171 ms  ← DOKUNULMAMIŞTI
--     3. 097    getFleetDistanceSpans (tek RPC)       4.351 ms
--     4.        getVehicleFuelSpan ×29                  406 ms
--     5.        device_telemetry sıfır sayımı           938 ms
--
-- Yani 102'den sonra **en pahalı kalem artık yüzde değil, LİTRE hattı**.
-- Üstelik yalnız 10 araç için çağrılıyor (16. maddede süzülmüştü) ve yine de
-- 5,2 saniye yakıyor. Şekli yüzde ikizinin aynısı: araç başına 31 satırlık
-- iki kayan maksimum.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 101 İLE AYNI FİKİR, ÜÇ YERDE FARKLI KURAL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Saklanan şey yine satır başına, ZAMANDAN BAĞIMSIZ iki sayı: ±30 komşudaki
-- en yüksek hacim. 090'ın günlük-özet yasağı burada da delinmiyor.
--
-- ⚠️ AMA LİTRE MOTORU YÜZDE MOTORUNUN KOPYASI DEĞİL. 094'ten birebir taşınan
-- ve 101'dekinden AYRIŞAN üç kural:
--
--   1. DE-GLITCH EŞİĞİ 5 (yüzdede 10). Litre ölçeği başka; 094'ün kendi
--      eşiği neyse o.
--   2. UÇ SATIR KURALI YOK. 052 ilk/son satırda tek taraflı test yapar;
--      094 yapmaz — koşul bütün satırlarda simetriktir. Pencerenin ilk
--      satırında `bwd_max = fuel` olduğu için fark sıfır çıkar ve satır
--      zaten elenmez. Bu davranış AYNEN korundu.
--   3. SERİ BİRLEŞTİRME YOK. 052 yükselişleri 15 dakikalık serilere toplayıp
--      seri başına eşiğe bakar; 094 her ADIMA tek tek bakar
--      (`fuel - prev_fuel >= 5`). Yani burada `run_id` diye bir şey YOK ve
--      olmamalı.
--
--   Ayrıca sifon kapısı `odo - prev_odo between -1 and 1` (yüzdede `< 1`).
--   Gerekçesi ve ölçümü docs/YAKIT-DUSUS-FARKI.md'de; aynen taşındı.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 102'NİN DERSİ BAŞTAN UYGULANDI
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 101 ilk hâlinde ileri kenar düzeltmesini
-- `rows between current row and unbounded following` ile yazmıştı. `max()`
-- için ters geçiş fonksiyonu olmadığından çerçevenin BAŞI ilerledikçe
-- Postgres her satırda baştan tarar → O(n²). Ölçüldü (PGlite, aynı veri):
--
--     satır   ileri-sınırsız   desc-artımlı
--     10.000      4.800 ms         21 ms
--     20.000     19.619 ms         35 ms
--     40.000     69.537 ms         68 ms
--
-- Bu dosyada ileri düzeltme DOĞRUDAN `order by ... desc` + `unbounded
-- preceding` ile yazıldı. Aynı küme, artımlı hesap.
--
-- ⚠️ `kuyruk` CTE'sindeki `current row and 30 following` SORUN DEĞİL: çerçeve
-- genişliği sabit olduğu için satır başına en çok 31 değer taranır.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- GERİ ALINABİLİRLİK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Additive + idempotent. `report_fuel_volume_stats_vehicle` (094) ve
-- `report_fuel_volume_stats` (039) OLDUĞU GİBİ DURUR. Uygulama
-- `YAKIT_OZET_ENABLED=false` ile ya da v2 bulunamadığında onlara geri düşer.
--
-- Geri alma (veri kaybı YOK):
--     drop function if exists public.report_fuel_volume_stats_vehicle_v2(timestamptz, timestamptz, uuid);
--     drop function if exists public.yakit_hacim_seri_etiketle(timestamptz, timestamptz, uuid);
--     drop view if exists public.fuel_volume_seri_kapsama;
--     drop table if exists public.fuel_volume_seri;
--
-- ⚠️ 101 GEREKMİYOR ama birlikte kurulmalı: ikisi ayrı tablo, ayrı fonksiyon.
-- Uygulama ikisini de aynı bayrakla açar; biri yoksa O HAT eski yola düşer.
--
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════ 1 · ETİKET TABLOSU ══════════════════════════════════

create table if not exists public.fuel_volume_seri (
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  recorded_at timestamptz not null,

  /** Ham okuma — device_telemetry.fuel_volume_l'in kopyası. */
  fuel double precision not null,
  /** Ham odometre; sifon kapısı için. NULL olabilir. */
  odo double precision,

  /**
   * ±30 komşudaki en yüksek hacim. 094'ün de-glitch kuralı YALNIZ bu ikisine
   * bakar ve ikisi de satırın KENDİ komşuluğundan gelir — sorulan rapor
   * penceresinden bağımsızdır.
   *
   * ⚠️ EŞİK BURADA SAKLANMIYOR. Saklanan şey ham maksimumlar; 5 puanlık eşik
   * okuma anında uygulanır. Böylece eşik bir gün değişirse tablo yeniden
   * üretilmek zorunda kalmaz.
   */
  bwd_max double precision not null,
  fwd_max double precision not null,

  etiketlendi_at timestamptz not null default now(),
  etiket_surumu text not null default '103.1',

  primary key (vehicle_id, recorded_at)
);

comment on table public.fuel_volume_seri is
  'Litre serisinin satır-başına ön-etiketi (103) — 101''in fuel_seri ikizi. Günlük ÖZET DEĞİL: kolonlar satırın ±30 komşusundan gelir, rapor penceresinden bağımsızdır.';

comment on column public.fuel_volume_seri.bwd_max is
  'max(fuel) · 30 önceki satır + bu satır. 094 de-glitch kuralının geri yarısı.';
comment on column public.fuel_volume_seri.fwd_max is
  'max(fuel) · bu satır + 30 sonraki satır. 094 de-glitch kuralının ileri yarısı.';

-- ════════════════════ 2 · ETİKETLEME FONKSİYONU ═══════════════════════════
--
-- 101'in `yakit_seri_etiketle`siyle aynı şekil; tek fark okunan kolon
-- (`fuel_volume_l`) ve yazılan tablo.
--
-- ⚠️ 30 SATIRLIK ÖRTÜŞME: aralığın iki yanından araç başına TAM 30 satır
-- LATERAL ile genişletilir, yazma yalnız [p_from, p_to] içinedir. Örtüşme
-- olmasaydı gün gün etiketleme kenar kırpması üretirdi (090'ın +%15,6'sı).

create or replace function public.yakit_hacim_seri_etiketle(
  p_from       timestamptz,
  p_to         timestamptz,
  p_vehicle_id uuid default null
)
returns bigint
language plpgsql
as $$
declare
  v_yazilan bigint := 0;
begin
  with hedef as (
    select v.id
    from public.vehicles v
    where p_vehicle_id is null or v.id = p_vehicle_id
  ),
  ham as (
    select dt.vehicle_id,
           dt.recorded_at,
           dt.fuel_volume_l::double precision as fuel,
           dt.odometer_km::double precision   as odo
    from public.device_telemetry dt
    join hedef h on h.id = dt.vehicle_id
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.fuel_volume_l is not null

    union all

    select o.vehicle_id, o.recorded_at, o.fuel, o.odo
    from hedef h
    cross join lateral (
      select dt.vehicle_id,
             dt.recorded_at,
             dt.fuel_volume_l::double precision as fuel,
             dt.odometer_km::double precision   as odo
      from public.device_telemetry dt
      where dt.vehicle_id = h.id
        and dt.recorded_at < p_from
        and dt.fuel_volume_l is not null
      order by dt.recorded_at desc
      limit 30
    ) o

    union all

    select o.vehicle_id, o.recorded_at, o.fuel, o.odo
    from hedef h
    cross join lateral (
      select dt.vehicle_id,
             dt.recorded_at,
             dt.fuel_volume_l::double precision as fuel,
             dt.odometer_km::double precision   as odo
      from public.device_telemetry dt
      where dt.vehicle_id = h.id
        and dt.recorded_at > p_to
        and dt.fuel_volume_l is not null
      order by dt.recorded_at asc
      limit 30
    ) o
  ),
  pencereli as (
    select
      m.vehicle_id,
      m.recorded_at,
      m.fuel,
      m.odo,
      max(m.fuel) over (
        partition by m.vehicle_id order by m.recorded_at
        rows between 30 preceding and current row
      ) as bwd_max,
      max(m.fuel) over (
        partition by m.vehicle_id order by m.recorded_at
        rows between current row and 30 following
      ) as fwd_max
    from ham m
  )
  insert into public.fuel_volume_seri as f
    (vehicle_id, recorded_at, fuel, odo, bwd_max, fwd_max, etiketlendi_at, etiket_surumu)
  select p.vehicle_id, p.recorded_at, p.fuel, p.odo, p.bwd_max, p.fwd_max, now(), '103.1'
  from pencereli p
  where p.recorded_at >= p_from
    and p.recorded_at <= p_to
  on conflict (vehicle_id, recorded_at) do update
    set fuel           = excluded.fuel,
        odo            = excluded.odo,
        bwd_max        = excluded.bwd_max,
        fwd_max        = excluded.fwd_max,
        etiketlendi_at = excluded.etiketlendi_at,
        etiket_surumu  = excluded.etiket_surumu;

  get diagnostics v_yazilan = row_count;
  return v_yazilan;
end;
$$;

comment on function public.yakit_hacim_seri_etiketle(timestamptz, timestamptz, uuid) is
  'fuel_volume_seri''yi [p_from,p_to] için üretir (upsert). Araç başına 30 SATIRLIK örtüşme: kenar kırpması olmadan gün gün çağrılabilir.';

-- ════════════════════ 3 · report_fuel_volume_stats_vehicle_v2 ═════════════
--
-- 094'teki `report_fuel_volume_stats_vehicle` ile AYNI ÇIKTI. Fark tek: 31
-- satırlık iki kayan maksimum okuma anında hesaplanmıyor, tablodan okunuyor.
--
-- ⚠️ PENCEREYE GÖRE DÜZELTME BURADA DA ŞART. 094 kayan pencereyi PENCERENİN
-- İÇİNDE kırpar; etiketteki değer pencere dışındaki komşulara da bakar.
-- İlk 31 ve son 31 satır bu yüzden pencere içinde yeniden hesaplanır.
--   · rn = 31'in 30 öncekisi tam 1..31'dir (hepsi pencerede) → 32'den itibaren
--     etiket değeri zaten pencereyle aynı.
--   · simetrik olarak rn = cnt - 30'un 30 sonrakisi tam cnt'te biter.
--
-- ⚠️ 094'TE UÇ SATIR KURALI YOK — koşul bütün satırlarda simetrik. 052'nin
-- `rn = 1` / `rn = cnt` istisnası buraya KOPYALANMADI ve kopyalanmamalı.
--
-- ⚠️ KUYRUK CANLI HESAPLANIR (melez okuma): gecelik cron'dan bu yana gelen
-- telemetri rapora TAM girer. Bölme noktasında sapma doğmaz — birleştirilen
-- şey satır-başına komşuluk değeridir, gün özeti değil.
--
-- ⚠️ TABLO BOŞSA v2 = v1: eşik '-infinity' olur, her şey canlı hesaplanır.

create or replace function public.report_fuel_volume_stats_vehicle_v2(
  p_from       timestamptz,
  p_to         timestamptz,
  p_vehicle_id uuid
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
  with esik as (
    -- Etiketli serinin GÜVENLİ ucu: sondaki 30 satırın ileri penceresi
    -- eksik olabilir, onlar canlı hesaplanır.
    select coalesce(
      (select fs.recorded_at
         from public.fuel_volume_seri fs
        where fs.vehicle_id = p_vehicle_id
        order by fs.recorded_at desc
        offset 30 limit 1),
      '-infinity'::timestamptz
    ) as t
  ),
  etiketli as (
    select fs.recorded_at, fs.fuel, fs.odo, fs.bwd_max, fs.fwd_max
    from public.fuel_volume_seri fs, esik e
    where fs.vehicle_id = p_vehicle_id
      and fs.recorded_at >= p_from
      and fs.recorded_at <= p_to
      and fs.recorded_at < e.t
  ),
  kuyruk_ham as (
    select dt.recorded_at,
           dt.fuel_volume_l::double precision as fuel,
           dt.odometer_km::double precision   as odo
    from public.device_telemetry dt, esik e
    where dt.vehicle_id = p_vehicle_id
      and dt.fuel_volume_l is not null
      and dt.recorded_at >= e.t
      and dt.recorded_at <= p_to
    union all
    -- + tam 30 satırlık geri örtüşme (kuyruğun bwd_max'ı doğru çıksın)
    select o.recorded_at, o.fuel, o.odo
    from esik e
    cross join lateral (
      select dt.recorded_at,
             dt.fuel_volume_l::double precision as fuel,
             dt.odometer_km::double precision   as odo
      from public.device_telemetry dt
      where dt.vehicle_id = p_vehicle_id
        and dt.fuel_volume_l is not null
        and dt.recorded_at < e.t
      order by dt.recorded_at desc
      limit 30
    ) o
  ),
  kuyruk as (
    select k.recorded_at, k.fuel, k.odo,
           max(k.fuel) over (order by k.recorded_at rows between 30 preceding and current row) as bwd_max,
           max(k.fuel) over (order by k.recorded_at rows between current row and 30 following) as fwd_max
    from kuyruk_ham k
  ),
  base as (
    select recorded_at, fuel, odo, bwd_max, fwd_max from etiketli
    union all
    /**
     * ⚠️ `recorded_at >= e.t` ŞART: `kuyruk` içindeki 30 satırlık geri
     * örtüşme yalnız pencere fonksiyonunu beslemek için var, o satırlar
     * `etiketli`de zaten bulunuyor. Koşul olmasa aynı satırlar iki kez sayılır.
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
     * ⚠️ İLERİ DÜZELTME `desc` + `unbounded preceding` İLE (102'nin dersi).
     * `rows between current row and unbounded following` aynı kümeyi verir
     * ama `max()` artımlı güncellenemediği için O(n²) olur.
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
    -- 094'ten birebir: eşik 5, UÇ SATIR İSTİSNASI YOK.
    select p_vehicle_id as vehicle_id, recorded_at, fuel, odo
    from bounded
    where not (bwd_w - fuel >= 5 and fwd_w - fuel >= 5)
  ),
  stepped as (
    select c.*,
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
    -- Sifon kapısı `between -1 and 1` — 094'ten birebir (docs/YAKIT-DUSUS-FARKI.md).
    count(*) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 5
        and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1
    )::bigint                                       as drop_count,
    coalesce(sum(prev_fuel - fuel) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 5
        and prev_odo is not null and odo is not null and odo - prev_odo between -1 and 1
    ), 0)                                           as drop_l,
    coalesce(max(abs(fuel - prev_fuel)) filter (where prev_fuel is not null), 0)
                                                    as max_step_l
  from stepped
  group by vehicle_id;
$$;

comment on function public.report_fuel_volume_stats_vehicle_v2(timestamptz, timestamptz, uuid) is
  'report_fuel_volume_stats_vehicle (094) ile BİREBİR aynı çıktı; 31 satırlık iki kayan maksimum fuel_volume_seri''den okunur. Etiketin ucundan sonrası CANLI (melez), tablo boşsa tamamen canlı.';

-- ════════════════════ 4 · KAPSAMA GÖRÜNÜMÜ ════════════════════════════════

create or replace view public.fuel_volume_seri_kapsama as
  select
    fs.vehicle_id,
    min(fs.recorded_at) as ilk_an,
    max(fs.recorded_at) as son_an,
    count(*)            as satir,
    max(fs.etiketlendi_at) as son_etiket
  from public.fuel_volume_seri fs
  group by fs.vehicle_id;

comment on view public.fuel_volume_seri_kapsama is
  'Litre etiket kapsaması (103) — hangi araç hangi ana kadar etiketli.';

commit;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (uygulandıktan sonra)
-- ═══════════════════════════════════════════════════════════════════════════
-- select
--   (select count(*) from information_schema.tables
--     where table_schema='public' and table_name='fuel_volume_seri')          as tablo,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='yakit_hacim_seri_etiketle')     as etiketleme_fn,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='report_fuel_volume_stats_vehicle_v2') as v2_fn,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='report_fuel_volume_stats_vehicle')    as eski_duruyor;
-- -- beklenen: tablo 1 · etiketleme_fn 1 · v2_fn 1 · eski_duruyor 1
