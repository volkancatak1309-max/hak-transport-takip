-- 097 · ODOMETRE: ARDIŞIK EŞİT BLOK + FİLO SPAN RPC
--
-- ═══ 096 EKSİK ÇIKTI — ölçümle bulundu (31.08.2026) ══════════════════════
--
-- 096 komşu ÇİFTE bakıyor: `sonraki_km - odometer_km > izin` ise satırı atar.
-- Bozuk okuma TEK ise çalışıyor (DO-512GT: 0 → 98.783, tek sıfır, atıldı).
-- Ama bozuk okuma ARDIŞIK TEKRARLIYORSA çalışmıyor:
--
--   DO-505GS, 2026-07 başı:  0 · 0 · 0 … (13 ardışık sıfır) … → 120.849
--
-- `0 → 0` geçişi fiziksel olarak kusursuz (artış 0), kapı onları geçiriyor;
-- yalnız SON sıfır `0 → 120.849` çiftinde takılıyor. Geriye 12 sıfır kalıyor
-- ve `min(odometer_km)` hâlâ 0.
--
-- 096 sonrası canlı ölçüm (telemetry_month_spans, 2026-07):
--   DO-505GS  120.899 km   🔴 hâlâ imkansız
--   DO-571GR   95.765 km   🔴
--   DO-753GS  124.801 km   🔴
--   DO-512GT      757 km   ✅ (tek sıfır olduğu için 096 çözmüştü)
--
-- ═══ ÇÖZÜM: BLOĞU TEK BİRİM SAY ══════════════════════════════════════════
--
-- Bir okumayı SONRAKİ FARKLI DEĞERE bağla. Ardışık eşitler tek blok sayılır
-- ve bütün olarak soyulur. **Ek sabit gerekmez** — kuralın kendi uzantısı.
-- `lib/odometre.ts` ile aynı mantık (orada `sonrakiFarkli`/`oncekiFarkli`).
--
-- Düzeltilmiş kuralla ölçüm (uygulama katmanında, canlı veriye karşı):
--   ölçülebilen araç  bugünkü 25 · 096 RPC 26 · **YENİ 29**
--   DO-505GS  →     50 km      DO-571GR  →   248 km
--   DO-753GS  →    981 km      DO-512GT  →   757 km
--   filo km   16.596 → 18.577  (+%11,9)
--
-- ═══ İKİNCİ İŞ: fleet_odometer_spans ═════════════════════════════════════
--
-- `lib/reports.ts` bugün araç araç `getVehicleDistanceSpan` çağırıyor
-- (iki fan-out noktası: loadBase ve yakıt raporu). Sorgu maliyeti ölçüldü:
--
--   bugünkü (araç başına 2 sorgu)      2,85 sn ·  60 sorgu ·       2 satır
--   tüm seriyi çekip uygulamada temizle 57,87 sn · 605 sorgu · 590.084 satır
--   SQL RPC (tüm filo tek sorgu)       2,99 sn ·   1 sorgu ·      29 satır
--
-- Uygulamada temizleme **20,3× yavaş** ve 590 bin satır taşıyor — kabul
-- edilemez. Bu yüzden temizleme SQL'de kalıyor ve rapor katmanı tek çağrıya
-- iniyor. Ayrıntı: `docs/ODOMETRE-KAYNAK-BAGLAMA.md`.
--
-- ⚠️ HAM VERİYE DOKUNULMAZ. Filtre yalnız OKUMA anında.

begin;

set local lock_timeout = '3s';

-- ── Ortak temizleme: monotonluk → blok indirgeme → fiziksel atlama ────────
-- Not: fonksiyon gövdesinde tekrar ediyor çünkü PostgreSQL'de CTE paylaşımı
-- fonksiyonlar arası yapılamıyor. İki fonksiyon da AYNI üç adımı uygular;
-- ayrışmasınlar diye adımlar birebir aynı sırayla ve aynı sabitle yazıldı.

create or replace function public.telemetry_month_spans(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  vehicle_id uuid,
  ay date,
  ornek_sayisi bigint,
  ilk_kayit timestamptz,
  son_kayit timestamptz,
  odometre_ilk numeric,
  odometre_son numeric,
  yakit_ornek_sayisi bigint,
  yakit_sifir_okuma bigint
)
language sql
stable
as $$
  with ham as (
    select dt.vehicle_id,
           date_trunc('month', dt.recorded_at)::date as ay,
           dt.recorded_at, dt.odometer_km, dt.fuel_level_pct
    from public.device_telemetry dt
    where dt.recorded_at >= p_from and dt.recorded_at < p_to
  ),
  -- Sayımlar HAM satırlardan: "kaç okuma geldi" filtreden etkilenmemeli.
  sayimlar as (
    select vehicle_id, ay,
           count(*)                                          as ornek_sayisi,
           min(recorded_at)                                  as ilk_kayit,
           max(recorded_at)                                  as son_kayit,
           count(*) filter (where fuel_level_pct is not null) as yakit_ornek_sayisi,
           count(*) filter (where fuel_level_pct = 0)         as yakit_sifir_okuma
    from ham group by 1, 2
  ),
  -- ① monotonluk
  monoton as (
    select vehicle_id, ay, recorded_at, odometer_km,
           -- telemetri-sinir: bu max FILTRENIN KENDISI, filtresiz uc deger degil
           max(odometer_km) over (
             partition by vehicle_id, ay order by recorded_at
             rows between unbounded preceding and 1 preceding
           ) as kosan_max
    from ham where odometer_km is not null
  ),
  gecerli as (
    select vehicle_id, ay, recorded_at, odometer_km
    from monoton where kosan_max is null or odometer_km >= kosan_max
  ),
  -- ② ardışık eşit bloğu tek birime indir: her bloğun İLK satırı
  bloklu as (
    select *, lag(odometer_km) over (partition by vehicle_id, ay order by recorded_at) as onc_km
    from gecerli
  ),
  blok_basi as (
    select vehicle_id, ay, recorded_at, odometer_km
    from bloklu where onc_km is null or odometer_km <> onc_km
  ),
  -- ③ fiziksel atlama — artık "sonraki" gerçekten FARKLI bir değer
  kapili as (
    select *,
           lead(odometer_km) over (partition by vehicle_id, ay order by recorded_at) as sonraki_km,
           lead(recorded_at) over (partition by vehicle_id, ay order by recorded_at) as sonraki_an
    from blok_basi
  ),
  temiz as (
    select vehicle_id, ay, odometer_km
    from kapili
    where sonraki_km is null
       or sonraki_km - odometer_km
          <= greatest(1, extract(epoch from (sonraki_an - recorded_at)) / 3600.0 * 200)
  )
  select s.vehicle_id, s.ay, s.ornek_sayisi, s.ilk_kayit, s.son_kayit,
         -- telemetri-sinir: uc deger TEMIZ CTE'den geliyor, ham tablodan DEGIL
         min(t.odometer_km)::numeric, max(t.odometer_km)::numeric,
         s.yakit_ornek_sayisi, s.yakit_sifir_okuma
  from sayimlar s
  left join temiz t on t.vehicle_id = s.vehicle_id and t.ay = s.ay
  group by s.vehicle_id, s.ay, s.ornek_sayisi, s.ilk_kayit, s.son_kayit,
           s.yakit_ornek_sayisi, s.yakit_sifir_okuma
$$;

-- ── YENİ: filo geneli, RASTGELE aralık (ay gruplaması YOK) ────────────────
-- `lib/reports.ts` araç araç 2 sorgu atıyordu; bu tek sorguya indiriyor.
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
  with ham as (
    select dt.vehicle_id, dt.recorded_at, dt.odometer_km
    from public.device_telemetry dt
    where dt.recorded_at >= p_from and dt.recorded_at < p_to
      and dt.odometer_km is not null
  ),
  monoton as (
    select vehicle_id, recorded_at, odometer_km,
           -- telemetri-sinir: filtrenin kendisi
           max(odometer_km) over (
             partition by vehicle_id order by recorded_at
             rows between unbounded preceding and 1 preceding
           ) as kosan_max
    from ham
  ),
  gecerli as (
    select vehicle_id, recorded_at, odometer_km
    from monoton where kosan_max is null or odometer_km >= kosan_max
  ),
  bloklu as (
    select *, lag(odometer_km) over (partition by vehicle_id order by recorded_at) as onc_km
    from gecerli
  ),
  blok_basi as (
    select vehicle_id, recorded_at, odometer_km
    from bloklu where onc_km is null or odometer_km <> onc_km
  ),
  kapili as (
    select *,
           lead(odometer_km) over (partition by vehicle_id order by recorded_at) as sonraki_km,
           lead(recorded_at) over (partition by vehicle_id order by recorded_at) as sonraki_an
    from blok_basi
  ),
  temiz as (
    select vehicle_id, recorded_at, odometer_km
    from kapili
    where sonraki_km is null
       or sonraki_km - odometer_km
          <= greatest(1, extract(epoch from (sonraki_an - recorded_at)) / 3600.0 * 200)
  ),
  sayim as (select vehicle_id, count(*) as okuma_sayisi from ham group by 1)
  select
    t.vehicle_id,
    -- telemetri-sinir: TEMIZ seriden; ayrica ilk/son ZAMANLI okuma aliniyor
    (array_agg(t.odometer_km order by t.recorded_at asc))[1]::numeric  as odometre_ilk,
    (array_agg(t.odometer_km order by t.recorded_at desc))[1]::numeric as odometre_son,
    min(t.recorded_at) as ilk_an,
    max(t.recorded_at) as son_an,
    max(s.okuma_sayisi) as okuma_sayisi,
    count(*) as temiz_sayisi
  from temiz t
  join sayim s on s.vehicle_id = t.vehicle_id
  group by t.vehicle_id
$$;

commit;

-- ═══ ÇALIŞTIRDIKTAN SONRA — EŞDEĞERLİK DENETİMİ ══════════════════════════
--
-- Beklenen (HAK61, 2026-07) — uygulama katmanında ölçülen değerler:
--   DO-505GS   50   DO-512GT  757   DO-571GR  248   DO-753GS  981
--   DO-671GY  599   DO-672GY  465   DO-719GV  263
-- ve HİÇBİR araçta bir ayda 46.500 km'yi (31 × 1.500) aşan değer OLMAMALI.
--
--   select v.plate,
--          s.odometre_ilk, s.odometre_son,
--          (s.odometre_son - s.odometre_ilk) as km,
--          s.okuma_sayisi, s.temiz_sayisi
--   from public.fleet_odometer_spans('2026-07-01'::timestamptz,
--                                    '2026-08-01'::timestamptz) s
--   join public.vehicles v on v.id = s.vehicle_id
--   order by km desc;
--
-- 🔴 46.500'ü aşan satır çıkarsa kod deploy EDİLMEMELİ — kural o araçta hâlâ
-- yetmiyor demektir (096'da tam bu oldu).
--
-- ⚠️ Bu migration ÇALIŞTIRILMADI (31.08.2026). Kod tarafı fail-safe:
-- `fleet_odometer_spans` yoksa rapor katmanı bugünkü araç-araç yoluna düşer
-- ve davranış değişmez.
