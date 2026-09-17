-- 105 — ODOMETRE AÇIKLIĞI: TEK ÇEKİRDEK + ARAÇ EKSENLİ PLAN (16c, Adım 1)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 SORUN İKİ KATLI: AYNI ARACA İKİ FARKLI KM, VE YÜKE GÖRE HANGİSİ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `loadBase` ve `buildFuelReport` önce filo geneli `fleet_odometer_spans`i
-- (097) çağırıyor; o `null` dönerse araç-araç yedek yola düşüyor
-- (`getVehicleDistanceSpan`). İKİ YOL AYNI KURALI UYGULAMIYOR:
--
--     097          : monoton filtre + blok başı + kapı → TEMİZLENMİŞ uçlar
--     araç-araç    : HAM ilk ve son okuma, temizlik YOK
--
-- Ölçüldü (17.09.2026, canlı, salt okuma) — iki kiracıda iki AYRI yönde:
--
--   galzura-demo · W-GF-107 · 30 gün
--     ham uçlar    0 → 97.296        → yedek: 97.296 km makul değil → null
--     097 temiz    96.704 → 97.296   → 592 km
--     (ilk okuma odometre 0; yedek yol onu eleyemiyor)
--
--   HAK61 · DO-512GT · 14 gün
--     ham uçlar    101.900 → 102.651 → yedek: 751 km
--     097 temiz                      → 692 km
--     (yedek yol %8,5 FAZLA sayıyor)
--
-- Yani yedek yol bir yönde eksik, öbür yönde fazla veriyor. Hangisinin
-- koştuğu 097'nin 8 sn'lik ifade tavanını aşıp aşmamasına bağlı → AYNI
-- PENCERE İKİ FARKLI SAYI veriyor. `buildFuelReport.fleetLPer100Km` demo'da
-- 72,475250 ya da 75,250365 (%3,8) çıkıyordu; bkz. docs/YAKIT-ONETIKET-16B.md.
--
-- ⚠️ MAKULLÜK KAPISI (`< 0` ve `> gün × 800 km`) UYGULAMADA ve İKİ YOLDA DA
-- AYNI. Bu migration ona dokunmuyor; ayrışan şey yalnız SQL TEMİZLİĞİYDİ.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ÇÖZÜM: KURAL TEK YERDE, FİLO ONU ÇAĞIRIR
-- ═══════════════════════════════════════════════════════════════════════════
--
--   vehicle_odometer_span(p_from, p_to, p_vehicle_id)   ← YENİ · KURALIN EVİ
--   fleet_odometer_spans(p_from, p_to)                  ← artık onu LATERAL
--                                                          ile araç araç çağırır
--
-- Gövde 097'den BİREBİR taşındı; tek fark `partition by vehicle_id`
-- kalktı (tek araç zaten tek bölüm). Filo sürümü artık kendi kopyasını
-- taşımıyor — iki yol AYNI SATIRLARDAN besleniyor ve ayrışamaz.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NEDEN AYNI ZAMANDA DAHA HIZLI
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 097'nin `where`i yalnız `recorded_at` aralığıydı; araç yüklemi olmadığı için
-- 053'ün `(vehicle_id, recorded_at) include (odometer_km)` indeksi
-- KULLANILAMIYORDU. Plan ölçüldü (PGlite, 216.000 satır, 30 araç):
--
--     Seq Scan on device_telemetry  ... rows=216.000
--     GroupAggregate ... temp read=2165 written=2168     ← DİSKE TAŞIYOR
--
-- LATERAL sürümde her araç kendi indeks aralığından, ZATEN SIRALI gelir;
-- küresel sıralama ve disk taşması ortadan kalkar. Aynı veride ölçüldü:
--
--     A · bugünkü (kapsamsız + sort)   480 ms
--     B · LATERAL (araç başına indeks) 302 ms      → %37
--     ve iki sürümün çıktısı 30/30 araçta BİREBİR AYNI.
--
-- ⚠️ DÜRÜST SINIR: %37 tek başına "< 1 sn" hedefini tutturmaz. Canlı ölçüm
-- (rakipsiz): HAK61 30 gün 2.403 ms · demo 30 gün 3.922 ms. LATERAL sonrası
-- beklenen ~1,5–2,5 sn. Asıl kazanılan şey DOĞRULUK: artık tavan aşılsa bile
-- yedek yol AYNI sayıyı verir, yani "yüke göre değişen km" biter.
-- Ek hızlanma (pencere kırpma / float8 iç hesap) ayrı bir tur; ikisi de
-- kuralı değiştirme riski taşıyor ve bu turda ALINMADI.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DAVRANIŞ FARKLARI — İKİSİ DE BİLEREK
-- ═══════════════════════════════════════════════════════════════════════════
--
--  1. Filo sürümü artık `public.vehicles`ten geçiyor. `device_telemetry`de
--     olup `vehicles`te olmayan bir araç varsa çıktıya girmez. Eski sürüm
--     girerdi. Tüketicilerin hepsi zaten `vehicles` ile eşliyor (loadBase,
--     buildFuelReport), yani görünür bir fark yok.
--  2. Araç-araç yolun zaman yüklemi artık `>= p_from and < p_to` — 097'nin
--     kuralı. Eski uygulama yolu `<= endISO` (kapsayıcı) kullanıyordu. İki
--     yolun AYNI olması için 097'nin biçimi seçildi.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- GERİ ALMA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 097'deki `fleet_odometer_spans` gövdesini yeniden çalıştırmak yeter
-- (`create or replace`). `vehicle_odometer_span` ortada kalır ve zararsızdır;
-- istenirse `drop function if exists public.vehicle_odometer_span(timestamptz, timestamptz, uuid);`
-- ⚠️ Geri alma "aynı araca iki farklı km" kusurunu GERİ GETİRİR.
--
-- ⚠️ HİÇBİR FONKSİYON DÜŞÜRÜLMEZ, hiçbir tablo/veri değişmez.
--
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ════════════ 1 · KURALIN EVİ — tek araç ═══════════════════════════════════
-- Gövde 097'den birebir; `partition by vehicle_id` kalktı (tek bölüm).

create or replace function public.vehicle_odometer_span(
  p_from timestamptz,
  p_to timestamptz,
  p_vehicle_id uuid
)
returns table (
  vehicle_id uuid,
  odometre_ilk numeric,
  odometre_son numeric,
  ilk_an timestamptz,
  son_an timestamptz,
  okuma_sayisi bigint,
  temiz_sayisi bigint
)
language sql
stable
as $$
  with ham as (
    select dt.recorded_at, dt.odometer_km
    from public.device_telemetry dt
    where dt.vehicle_id = p_vehicle_id
      and dt.recorded_at >= p_from and dt.recorded_at < p_to
      and dt.odometer_km is not null
  ),
  monoton as (
    select recorded_at, odometer_km,
           -- telemetri-sinir: filtrenin kendisi
           max(odometer_km) over (
             order by recorded_at
             rows between unbounded preceding and 1 preceding
           ) as kosan_max
    from ham
  ),
  gecerli as (
    select recorded_at, odometer_km
    from monoton where kosan_max is null or odometer_km >= kosan_max
  ),
  bloklu as (
    select *, lag(odometer_km) over (order by recorded_at) as onc_km
    from gecerli
  ),
  blok_basi as (
    select recorded_at, odometer_km
    from bloklu where onc_km is null or odometer_km <> onc_km
  ),
  kapili as (
    select *,
           lead(odometer_km) over (order by recorded_at) as sonraki_km,
           lead(recorded_at) over (order by recorded_at) as sonraki_an
    from blok_basi
  ),
  temiz as (
    select recorded_at, odometer_km
    from kapili
    where sonraki_km is null
       or sonraki_km - odometer_km
          <= greatest(1, extract(epoch from (sonraki_an - recorded_at)) / 3600.0 * 200)
  ),
  sayim as (select count(*) as okuma_sayisi from ham)
  select
    p_vehicle_id,
    -- telemetri-sinir: TEMIZ seriden; ayrica ilk/son ZAMANLI okuma aliniyor
    (array_agg(t.odometer_km order by t.recorded_at asc))[1]::numeric  as odometre_ilk,
    (array_agg(t.odometer_km order by t.recorded_at desc))[1]::numeric as odometre_son,
    min(t.recorded_at) as ilk_an,
    max(t.recorded_at) as son_an,
    (select okuma_sayisi from sayim) as okuma_sayisi,
    count(*) as temiz_sayisi
  from temiz t
  having count(*) > 0
$$;

comment on function public.vehicle_odometer_span(timestamptz, timestamptz, uuid) is
  'Odometre açıklığı kuralının TEK EVİ (105). fleet_odometer_spans bunu LATERAL ile çağırır; uygulamadaki araç-araç yol da bunu çağırır — iki yol ayrışamaz.';

-- ════════════ 2 · FİLO SÜRÜMÜ — artık kuralı ÇAĞIRIYOR ════════════════════

create or replace function public.fleet_odometer_spans(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  vehicle_id uuid,
  odometre_ilk numeric,
  odometre_son numeric,
  ilk_an timestamptz,
  son_an timestamptz,
  okuma_sayisi bigint,
  temiz_sayisi bigint
)
language sql
stable
as $$
  select s.*
  from public.vehicles v
  cross join lateral public.vehicle_odometer_span(p_from, p_to, v.id) s
$$;

comment on function public.fleet_odometer_spans(timestamptz, timestamptz) is
  'Filo geneli odometre açıklığı (097 → 105). Kural artık vehicle_odometer_span''da; burada yalnız araç araç LATERAL ile çağrılıyor — 053''ün (vehicle_id, recorded_at) indeksi kullanılabilir hâle gelir, küresel sıralama ve disk taşması kalkar.';

commit;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA (uygulandıktan sonra)
-- ═══════════════════════════════════════════════════════════════════════════
-- select
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='vehicle_odometer_span')          as yeni_fn,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='fleet_odometer_spans')           as filo_fn,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname='shift_odometer_spans')           as vardiya_fn_durur,
--   (select count(*) from pg_get_functiondef(
--      (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='public' and p.proname='fleet_odometer_spans')
--    ) t where t like '%cross join lateral%')                                  as lateral_var;
-- -- beklenen: yeni_fn 1 · filo_fn 1 · vardiya_fn_durur 1 · lateral_var 1
--
-- EŞDEĞERLİK (097'nin kendi denetimi — aynen geçerli):
--   select v.plate, s.odometre_ilk, s.odometre_son,
--          (s.odometre_son - s.odometre_ilk) as km, s.okuma_sayisi, s.temiz_sayisi
--   from public.fleet_odometer_spans('2026-07-01'::timestamptz,
--                                    '2026-08-01'::timestamptz) s
--   join public.vehicles v on v.id = s.vehicle_id
--   order by km desc;
-- 🔴 Bir ayda 46.500 km'yi (31 × 1.500) aşan satır çıkarsa DEPLOY EDİLMEZ.
