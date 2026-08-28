-- HAK61 / Galzura Fleet — Migration 095 (YAKIT DÜŞÜŞ KAPISI HİZALAMA)
-- =====================================================================
-- Additive + idempotent (`create or replace`). Supabase SQL Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 BU BİR ŞEMA HİZALAMASIDIR — KÖKENİ ELLE MÜDAHALE
-- ═══════════════════════════════════════════════════════════════════════
--
-- 28.08.2026'da 094'ün eşdeğerlik kapısı HAK61'de DÜŞTÜ. Sebep 094 değildi:
-- **HAK61'in canlı `report_fuel_volume_stats` fonksiyonu depodaki 039
-- dosyasından FARKLIYDI.**
--
--     depo 039        :  odo - prev_odo <  1
--     HAK61 canlı     :  odo - prev_odo between -1 and 1     ← elle değişmiş
--     Sendigo canlı   :  odo - prev_odo <  1                 (depoyla aynı)
--     galzura canlı   :  odo - prev_odo <  1                 (depoyla aynı)
--
-- Depoda kaydı olmayan üçüncü canlı nesne (öncekiler:
-- `idx_device_telemetry_fuel` indeksi ve `vehicles.tank_capacity_l` kolonu).
-- Ne zaman ve kim tarafından değiştirildiği BİLİNMİYOR.
--
-- KARAR (Volkan, 28.08.2026): **canlı biçim DOĞRU kabul edilir, üç kiracı da
-- ona hizalanır.** Yakıt hırsızlığı uyarısı kaçırılmamalı; fazla uyarı
-- incelenip elenir, eksik olan hiç görülmez.
--
-- Bu dosya kapsamsız (2 argümanlı) sürümü hizalar. Araç eksenli (3 argümanlı)
-- ikizi 094'tedir ve **ikisi BİRLİKTE çalıştırılmalıdır** — biri eksik
-- kalırsa iki yol farklı sayı verir ve eşdeğerlik kapısı düşer.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜLDÜ — SINIRIN GERÇEKTE NE YAPTIĞI (HAK61, 147.097 gerçek satır)
-- ═══════════════════════════════════════════════════════════════════════
--
-- ≥5 L düşüşlerin odometre farkı dağılımı (19–28 Ağu, 13 araç):
--
--     odo farkı        düşüş    litre     `<1`   `between -1 and 1`
--     ─────────────    ─────   ───────    ────   ──────────────────
--     < -1 km (geri)       0       0,0     ✓            ✗
--     = -1 km              0       0,0     ✓            ✓
--     =  0 km            743    5741,6     ✓            ✓
--     = +1 km             67     542,7     ✗            ✓
--     > +1 km              4      28,1     ✗            ✗
--
-- ⚠️ İKİ DÜRÜST NOT — bir sonraki kişi yanlış gerekçe devralmasın:
--
--  1) `+1` SINIRI İŞ YAPIYOR. Kazanılan 67 olay / 542,7 L uydurma değil:
--     örnek satırlar 8,3 L / 9 saniye, 6,1 L / 16 saniye, 7,7 L / 147 saniye
--     — hepsinde odometre 1 km ilerlemiş. Bir çekici ~0,3 L/km yakar; 1 km
--     8,3 litreyi AÇIKLAYAMAZ (27 katı). Bunlar ya sensör çalkalanması ya
--     gerçek çekimdir, ama "araç hareket etti, normaldir" değildir.
--
--  2) `-1` SINIRI BUGÜN ÖLÜ. Ham veride tam −1 km fark **HİÇ YOK** (0 satır).
--     Odometre gerçekten 25 kez geri gitti ama hepsi **1 km'den fazla** geri
--     — yani `between -1 and 1` onları KAPSAMIYOR, dışarıda bırakıyor.
--     "Negatif taraf bozuk odometreyi yakalıyor" cümlesi ölçümle
--     DESTEKLENMİYOR. Sınır yine de korunuyor: amaç canlı davranışı BİREBİR
--     korumak; gerekçesi zayıf bir sınırı budamak ayrı bir karardır ve bu
--     migration'ın işi değildir.
--
-- ═══════════════════════════════════════════════════════════════════════
-- KİRACI ETKİSİ — ÖLÇÜLDÜ
-- ═══════════════════════════════════════════════════════════════════════
--
--   HAK61        : DEĞİŞİKLİK YOK — canlı zaten bu biçimde.
--                  (Kapsamsız sürüm depo metnine dönmüyor; olduğu gibi kalıyor.)
--   Sendigo      : 20–27 Ağu penceresinde DEĞİŞİKLİK YOK (13 düşüş / 75,8 L
--                  → 13 / 75,8). 19–28 Ağu'da +1 düşüş / +7,1 L.
--                  Yani beklenenin çok altında.
--   galzura-demo : ÖLÇÜLEMEDİ (service key yok). Demo telemetrisi 14 günde
--                  temizleniyor, etki küçük beklenir.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 MÜŞTERİYE GİDEN RAKAM
-- ═══════════════════════════════════════════════════════════════════════
--
-- Bu sayı panelde "şüpheli yakıt kaybı" olarak gösteriliyor. HAK61'de
-- değişmiyor. Sendigo'da ölçülen etki bir olay / 7,1 litre — ama ARTIŞ
-- yönünde ve sessiz olmamalı: Sendigo'ya bu migration koşulduğunda
-- rakamın yukarı oynayabileceği söylenmelidir.

begin;

set local lock_timeout = '3s';

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
    -- 🔴 HİZALANAN SATIR — gerekçe ve ölçüm başlıkta. 039: `< 1`.
    count(*) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 5
        and prev_odo is not null and odo is not null
        and odo - prev_odo between -1 and 1
    )::bigint                                       as drop_count,
    coalesce(sum(prev_fuel - fuel) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 5
        and prev_odo is not null and odo is not null
        and odo - prev_odo between -1 and 1
    ), 0)                                           as drop_l,
    coalesce(max(abs(fuel - prev_fuel)) filter (where prev_fuel is not null), 0)
                                                    as max_step_l
  from stepped
  group by vehicle_id;
$$;

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- 🔴 GERİ ALMA
-- =====================================================================
--
-- Depo 039 biçimine (`< 1`) döndürmek için: 039'un gövdesini yeniden
-- çalıştırın (`db/migrations/039_fuel_volume.sql` içindeki
-- `create or replace function public.report_fuel_volume_stats`).
--
-- ⚠️ AMA TEK BAŞINA GERİ ALMAYIN. 094 araç eksenli sürümü de
-- `between -1 and 1` taşıyor; yalnız bunu geri almak iki yolu ayrıştırır ve
-- eşdeğerlik kapısı düşer. İkisi BİRLİKTE geri alınmalıdır.
--
-- Geri alma HAK61'de müşteriye giden rakamı %8,1 DÜŞÜRÜR (43 olay · 373,2 L,
-- 20–27 Ağu ölçümü) — sessiz yapılmamalıdır.

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL
-- =====================================================================
--
--   select pg_get_functiondef(oid) from pg_proc
--    where proname = 'report_fuel_volume_stats' and pronargs = 2;
--   → gövdede `odo - prev_odo between -1 and 1` geçmeli (üç kiracıda da)
--
--   select proname, pronargs from pg_proc
--    where proname like 'report_fuel_volume_stats%' order by proname;
--   → 2 satır: report_fuel_volume_stats (2) · report_fuel_volume_stats_vehicle (3)
--
-- Eşdeğerlik sorgusu 094'ün başlığında; 094 + 095 birlikte koşulduktan sonra
-- dört sütun da 0 vermelidir.
--
-- MEVCUT VERİYE ETKİSİ: **SIFIR SATIR** değişir. Bu migration yalnız bir
-- fonksiyon gövdesini değiştirir.
-- =====================================================================
