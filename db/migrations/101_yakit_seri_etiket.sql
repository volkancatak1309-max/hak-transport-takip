-- 101 — YAKIT SERİSİ ÖN-ETİKETLEME (16b, A yolu)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NEDEN (ölçüldü, 16.09.2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `/api/mobile/fleets/karsilastir` turunun %80'i tek bir yerde yanıyor:
-- `report_fuel_stats_vehicle` araç başına çağrılıyor ve her çağrı o aracın
-- aralıktaki BÜTÜN yakıt okumalarını dört pencere fonksiyonundan geçiriyor.
--
--     en yoğun araç, 30 günde 68.572 yüzde satırı
--       30 gün   HAK61   969 ms · demo 1.466 ms
--        7 gün   HAK61   284 ms · demo   368 ms
--        1 gün   HAK61   156 ms · demo   175 ms
--     → marjinal maliyet ~12,8 µs/satır; sabit yük ~100 ms
--
--     29 araç × 30 gün, mapBounded(6):  HAK61 4,3 sn · demo 7,7 sn
--     SOĞUK ≈ SICAK (7.725 vs 7.567 ms) → disk değil CPU; indeks çözmez
--     (053'ün kapsayan indeksleri üç kiracıda da ZATEN kurulu).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 NEDEN "GÜNLÜK ÖZET" DEĞİL — 090 BUNU ÖLÇTÜ VE REDDETTİ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 090'ın başlığındaki ÖLÇÜM 2 (HAK61 canlı, 26.08.2026): 28 günlük gerçek
-- cevap 2.602,6 L; aynı pencere GÜNLÜK parçalara bölünüp toplandığında
-- 3.009,9 L = **+%15,6** (ikinci ölçüm 14 günde +%28,9). Sebep: yakıt motoru
-- ardışık okuma DİZİSİ üzerinde çalışıyor (30 satırlık de-glitch penceresi,
-- 15 dakikalık seri birleştirme) ve gün sınırı diziyi kesiyor.
--
-- Bu migration günlük ÖZET yazmıyor. Yazdığı şey SATIR BAŞINA, ZAMANDAN
-- BAĞIMSIZ bir ara değer: her okumanın ±30 komşusundaki en yüksek yakıt
-- seviyesi. Bu iki sayı yalnız satırın KENDİ komşuluğuna bağlıdır; hangi
-- pencerede sorulduğuna bağlı DEĞİLDİR. Dolayısıyla gün gün üretilip
-- aylık okunabilir — parçalama sapması matematiksel olarak doğmaz.
--
-- ⚠️ Ölçüldü (16.09.2026): gün sınırını (Viyana 23:45–00:15) kesen yükseliş
-- adımı 30 günde HAK61'de 0, demo'da 0. Yani 090'ın +%15,6'sı gece yarısı
-- dolumundan DEĞİL, gün kenarında KIRPILAN de-glitch penceresinden geliyordu.
-- Bu migration tam olarak o pencereyi kırpılmaz hâle getiriyor.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NEDEN AYRI İNCE TABLO, device_telemetry'ye KOLON DEĞİL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Üç ölçülebilir sebep:
--
--   1. device_telemetry'nin BUGÜN 9 indeksi var (014×2, 039, 049×2, 053×2,
--      090 BRIN, 093). Postgres'te UPDATE = yeni satır sürümü; 1,54 milyon
--      yüzde satırını etiketlemek 1,54 milyon ölü tuple ve DOKUZ indekste
--      bakım demek. INSERT-only ince tabloda tek indeks var.
--   2. device_telemetry SICAK tablo: flespi senkronu 30-60 saniyede bir
--      upsert ediyor. Etiketleme UPDATE'i onunla aynı satırlara yazardı.
--   3. GERİ ALINABİLİRLİK. `drop table public.fuel_seri` — device_telemetry'ye
--      hiç dokunulmamış olur. Kolon eklenseydi geri alma, canlı yazma altındaki
--      2,36 milyon satırlık tabloda ALTER olurdu.
--
-- Bedeli: HAK61'de ~1,54 M satır × ~64 bayt ≈ 100 MB + PK. Kabul edilebilir
-- (device_telemetry'nin kendisi 2,36 M satır).
--
-- KISMİ İNDEKSE GEREK YOK: tablo zaten `fuel_level_pct is not null`
-- projeksiyonunun ta kendisi. Kaynak tarafta 053'ün
-- `idx_device_telemetry_vehicle_fuel_pct` indeksi etiketleme sorgusunu
-- besliyor; yeni indeks EKLENMEDİ (093 mükerrer indeks dersi).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- GERİ ALINABİLİRLİK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Additive + idempotent. Hiçbir veri değişmez, HİÇBİR mevcut fonksiyon
-- düşmez. `report_fuel_stats_vehicle` (052) OLDUĞU GİBİ DURUYOR ve uygulama
-- `YAKIT_OZET_ENABLED=false` ile ya da v2 bulunamadığında ona geri düşüyor.
--
-- Geri alma (veri kaybı YOK):
--     drop function if exists public.report_fuel_stats_vehicle_v2(timestamptz, timestamptz, uuid);
--     drop function if exists public.yakit_seri_etiketle(timestamptz, timestamptz, uuid);
--     drop table if exists public.fuel_seri;
--
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════ 1 · ETİKET TABLOSU ══════════════════════════════════

create table if not exists public.fuel_seri (
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  recorded_at timestamptz not null,

  /** Ham okuma — device_telemetry.fuel_level_pct'in kopyası. */
  fuel double precision not null,
  /**
   * Ham odometre. `drop_count`/`drop_pct` "depo düştü ama araç yol almadı"
   * testini yapıyor; o test olmadan sifon şüphesi ile normal tüketim ayrılamaz.
   * NULL olabilir (odometresiz cihaz).
   */
  odo double precision,

  /**
   * ⚠️ TURUN TAMAMI BU İKİ KOLON İÇİN.
   *
   * `bwd_max` = max(fuel) · 30 önceki satır + bu satır
   * `fwd_max` = max(fuel) · bu satır + 30 sonraki satır
   *
   * 027'nin de-glitch kuralı ("iki yandan da 10 puan aşağıdaysa bu satır
   * sensör çukurudur") YALNIZ bu ikisine bakar. İkisi de satırın KENDİ
   * komşuluğundan gelir — sorulan rapor penceresinden bağımsızdır. Pahalı
   * olan (31 satırlık kayan maksimum, iki kez) burada BİR KEZ hesaplanır,
   * okuma anında hiç hesaplanmaz.
   *
   * Komşuluk SATIR sayısıyla tanımlı, ZAMANLA değil — etiketleme işi bu
   * yüzden sabit bir saat örtüşmesi değil, tam 30 SATIRLIK örtüşme kullanır
   * (seyrek okuyan park hâlindeki araçta saat örtüşmesi 30 satırı tutmazdı).
   */
  bwd_max double precision not null,
  fwd_max double precision not null,

  etiketlendi_at timestamptz not null default now(),
  /** Etiket mantığı değişirse tablo topluca yeniden üretilebilsin. */
  etiket_surumu text not null default '101.1',

  primary key (vehicle_id, recorded_at)
);

comment on table public.fuel_seri is
  'Yakıt serisinin satır-başına ön-etiketi (101). Günlük ÖZET DEĞİL: kolonlar satırın ±30 komşusundan gelir, rapor penceresinden bağımsızdır — 090''ın ölçtüğü günlük parçalama sapması (+%15,6) bu yüzden doğmaz.';

comment on column public.fuel_seri.bwd_max is
  'max(fuel) · 30 önceki satır + bu satır. 027 de-glitch kuralının geri yarısı.';
comment on column public.fuel_seri.fwd_max is
  'max(fuel) · bu satır + 30 sonraki satır. 027 de-glitch kuralının ileri yarısı.';
comment on column public.fuel_seri.etiket_surumu is
  'Etiket mantığının sürümü. Mantık değişirse bu değerle eski satırlar bulunup yeniden üretilir.';

-- ════════════════════ 2 · ETİKETLEME FONKSİYONU ═══════════════════════════
--
-- [p_from, p_to] aralığındaki satırları etiketler. `p_vehicle_id` verilmezse
-- TÜM araçlar.
--
-- ⚠️ 30 SATIRLIK ÖRTÜŞME: bir satırın `bwd_max`/`fwd_max` değeri aralığın
-- DIŞINDAKİ komşularına da bakmak zorunda. Bu yüzden ham küme, aralığın iki
-- yanından araç başına tam 30 satır LATERAL ile genişletilir; yazma yine
-- yalnız [p_from, p_to] içindir. Örtüşme olmasaydı gün gün etiketleme, tam
-- da 090'ın reddettiği kenar kırpmasını üretirdi.
--
-- ⚠️ SON SATIRLAR GEÇİCİDİR: serinin en yeni 30 satırının ileri penceresi
-- henüz dolmamıştır. Onlar sonraki koşuda upsert ile düzelir; ayrıca okuma
-- yolu (v2) güvenlik payı olarak son 30 etiketli satırı zaten CANLI yeniden
-- hesaplar. Yani geçici değer hiçbir rapora sızmaz.

create or replace function public.yakit_seri_etiketle(
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
    -- Aralığın kendisi
    select dt.vehicle_id,
           dt.recorded_at,
           dt.fuel_level_pct::double precision as fuel,
           dt.odometer_km::double precision    as odo
    from public.device_telemetry dt
    join hedef h on h.id = dt.vehicle_id
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.fuel_level_pct is not null

    union all

    -- Araç başına TAM 30 önceki satır
    select o.vehicle_id, o.recorded_at, o.fuel, o.odo
    from hedef h
    cross join lateral (
      select dt.vehicle_id,
             dt.recorded_at,
             dt.fuel_level_pct::double precision as fuel,
             dt.odometer_km::double precision    as odo
      from public.device_telemetry dt
      where dt.vehicle_id = h.id
        and dt.recorded_at < p_from
        and dt.fuel_level_pct is not null
      order by dt.recorded_at desc
      limit 30
    ) o

    union all

    -- Araç başına TAM 30 sonraki satır
    select o.vehicle_id, o.recorded_at, o.fuel, o.odo
    from hedef h
    cross join lateral (
      select dt.vehicle_id,
             dt.recorded_at,
             dt.fuel_level_pct::double precision as fuel,
             dt.odometer_km::double precision    as odo
      from public.device_telemetry dt
      where dt.vehicle_id = h.id
        and dt.recorded_at > p_to
        and dt.fuel_level_pct is not null
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
  insert into public.fuel_seri as f
    (vehicle_id, recorded_at, fuel, odo, bwd_max, fwd_max, etiketlendi_at, etiket_surumu)
  select p.vehicle_id, p.recorded_at, p.fuel, p.odo, p.bwd_max, p.fwd_max, now(), '101.1'
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

comment on function public.yakit_seri_etiketle(timestamptz, timestamptz, uuid) is
  'fuel_seri''yi [p_from,p_to] için üretir (upsert). Araç başına 30 SATIRLIK örtüşme kullanır: kenar kırpması olmadan gün gün çağrılabilir.';

-- ════════════════════ 3 · report_fuel_stats_vehicle_v2 ════════════════════
--
-- 052'deki `report_fuel_stats_vehicle` ile AYNI ÇIKTIYI üretir. Fark tek:
-- 31 satırlık iki kayan maksimum artık okuma anında hesaplanmıyor,
-- `fuel_seri`den okunuyor. De-glitch kuralı, 15 dakikalık seri birleştirme,
-- ≥5 puanlık dolum eşiği, ≥10 puanlık düşüş + "odometre 1 km'den az" testi
-- BİREBİR aynı satırlardan kopyalandı.
--
-- ⚠️ ÜÇ NOKTADA PENCEREYE GÖRE DÜZELTME ŞART (yoksa çıktı BİREBİR olmaz):
--
--   1. İlk 31 satır — 052'de geri pencere PENCERENİN İÇİNDE kırpılır
--      (rn ≤ 31 iken "30 önceki" = 1..rn). Etiketteki değer ise pencere
--      dışındaki komşulara da bakar. Bu yüzden baştaki 31 satırın `bwd_max`ı
--      pencere içinde YENİDEN hesaplanır (kümülatif maksimum — ucuz).
--   2. Son 31 satır — aynısının ileri yarısı.
--   3. rn = 1 ve rn = cnt satırlarında 052'nin UÇ SATIR KURALI geçerli:
--      tek taraflı test. Aynen taşındı.
--
--   Eşik neden 31 ve neden > cnt - 31: rn = 31'in 30 öncekisi tam olarak
--   1..31'dir (hepsi pencerede), rn = 32'ninki 2..32'dir (yine hepsi
--   pencerede) → 32'den itibaren etiket değeri zaten pencereyle aynı.
--   Simetrik olarak rn = cnt - 30'un 30 sonrakisi tam cnt'te biter.
--
-- ⚠️ KUYRUK CANLI HESAPLANIR (melez okuma). Etiketli serinin son 30 satırı
-- ve ondan sonraki HAM satırlar okuma anında hesaplanır: gecelik cron'dan
-- bu yana gelen telemetri (bugünün kısmi günü) böylece rapora TAM girer ve
-- "hafta"/"ay" gibi ŞİMDİ biten pencereler bayat kalmaz. Bölme noktasında
-- sapma DOĞMAZ: birleştirilen şey satır-başına komşuluk değerleridir, gün
-- özeti değil (090 farkının tam olarak doğmadığı yer burası).
--
-- ⚠️ TABLO BOŞSA v2 = v1. `fuel_seri`de o araç için satır yoksa eşik
-- '-infinity' olur, her şey canlı hesaplanır ve sonuç 052'nin birebir aynısı
-- çıkar. Yani migration uygulanıp cron kurulmadan önce de DOĞRU çalışır,
-- yalnız hızlı çalışmaz.

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
    -- PENCEREYE GÖRE DÜZELTME (yukarıdaki 1 ve 2 numaralı notlar)
    select n.*,
           case when n.rn <= 31
                then max(n.fuel) over (order by n.recorded_at rows between unbounded preceding and current row)
                else n.bwd_max end as bwd_w,
           case when n.rn > n.cnt - 31
                then max(n.fuel) over (order by n.recorded_at rows between current row and unbounded following)
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
  'report_fuel_stats_vehicle (052) ile BİREBİR aynı çıktı; 31 satırlık iki kayan maksimum fuel_seri''den okunur. Etiketin ucundan sonrası CANLI hesaplanır (melez), tablo boşsa tamamen canlı.';

-- ════════════════════ 4 · KAPSAMA GÖRÜNÜMÜ ════════════════════════════════
-- Cron ve teşhis için: hangi araç nereye kadar etiketli.

create or replace view public.fuel_seri_kapsama as
  select
    fs.vehicle_id,
    min(fs.recorded_at) as ilk_an,
    max(fs.recorded_at) as son_an,
    count(*)            as satir,
    max(fs.etiketlendi_at) as son_etiket
  from public.fuel_seri fs
  group by fs.vehicle_id;

comment on view public.fuel_seri_kapsama is
  'Etiket kapsaması (101) — hangi araç hangi ana kadar etiketli. Cron teşhisi ve backfill takibi için.';

commit;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (uygulandıktan sonra bu bloğu ayrıca çalıştırın)
-- ═══════════════════════════════════════════════════════════════════════════
-- select
--   (select count(*) from information_schema.tables
--     where table_schema='public' and table_name='fuel_seri')            as tablo,
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='fuel_seri'
--       and column_name in ('bwd_max','fwd_max','odo','fuel'))           as kolon,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public'
--       and p.proname in ('yakit_seri_etiketle','report_fuel_stats_vehicle_v2')) as fonksiyon,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='report_fuel_stats_vehicle')  as eski_duruyor,
--   (select count(*) from public.fuel_seri)                              as etiketli_satir;
-- -- beklenen: tablo 1 · kolon 4 · fonksiyon 2 · eski_duruyor 1 · etiketli_satir 0
