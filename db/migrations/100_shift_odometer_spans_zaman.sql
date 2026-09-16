-- 100_shift_odometer_spans_zaman.sql — 052'ye OKUMA ZAMANLARI EKLENİYOR
--
-- ⚠️ BU DDL VOLKAN TARAFINDAN 16.09.2026'DA SUPABASE'DE ÇALIŞTIRILDI ve ÜÇ
-- KİRACIDA DA (HAK61 · Sendigo · galzura-demo) UYGULANMIŞ durumdadır. Bu dosya
-- deponun ŞEMA KAYDIDIR. Claude tarafından çalıştırılmadı.
--
-- ── UYGULANDIKTAN SONRA CANLIDA ÖLÇÜLDÜ (16.09.2026) ──────────────────────
-- SQL Editor'da (pg_get_function_result): ilk_an ✓ · son_an ✓ · aynı adlı
-- fonksiyon sayısı 1 (mükerrer aşırı yükleme YOK) — üç kiracıda da.
-- PostgREST üzerinden davranışla doğrulandı: RPC dönüşü artık 9 kolon ve
-- `ilk_an`/`son_an` satırlarda VAR (HAK61 31 satır · Sendigo 4 · demo 31).
--
-- ── KAPSAMA KAPISI ARTIK GERÇEKTEN ÇALIŞIYOR (son 30 gün) ─────────────────
--   HAK61  cihaz 195 · sayac 146 · olculmedi 78
--          B elenme sebepleri: kapsama_yetersiz 142 · okuma_yok 81 · negatif 1
--   demo   cihaz 402 · sayac  41 · olculmedi  8
--          kapsama_yetersiz 33 · okuma_yok 9 · sahte_sifir 3 · makul_disi 3 ·
--          negatif 1
-- ⚠️ Bu sayılar, 100 uygulanmadan ÖNCE zaman damgaları device_telemetry'den
-- elle toplanarak yapılan ölçümle BİREBİR AYNI çıktı — yani tahmin doğrulandı,
-- kural canlıda beklendiği gibi davranıyor.
--
-- ⚠️ KM DEĞERLERİ DEĞİŞMEDİ: bu tur yalnız ETİKET ekliyor; uçların `km` alanı
-- hâlâ sayaç ekseninde (13. madde Adım 3'e kadar).
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN GEREKLİ — 15 DAKİKALIK KAPSAMA KURALI BESLENEMİYOR
-- ═══════════════════════════════════════════════════════════════════════════
--  13. madde km'yi 052 eksenine taşıyor ve kuralın bir kapısı var: cihaz
--  vardiyanın BAŞINDAN SONUNA kadar konuşmuş olmalı. Ölçütü Volkan koydu:
--  ilk okuma vardiya başlangıcından en çok 15 dk sonra, son okuma bitişten en
--  çok 15 dk önce. Bu ölçüt OKUMA ANLARINI gerektirir.
--
--  052 bugün yalnız `first_km` / `last_km` döndürüyor — hangi ANDA okunduğunu
--  söylemiyor. Yani kapsama sorusu MEVCUT sözleşmeyle cevaplanamaz.
--
--  ═══ NEDEN ÖNEMLİ: ÖLÇÜLDÜ (HAK61, son 30 gün) ═══
--  052 ile sayaç ekseni 324 vardiyada birlikte ölçülebiliyor ve YALNIZ %27,2'si
--  birebir aynı. En büyük ayrışma A=348 km → B=37 km (−311). Bu fark 052'nin
--  "yanlış" olmasından değil, cihazın vardiyanın YALNIZ BİR BÖLÜMÜNDE
--  konuşmasından geliyor: pencere içindeki ilk ve son odometre okuması
--  birbirine yakınsa 052 gerçek yolun küçük bir dilimini ölçer. Zaman damgası
--  olmadan bu durumu "az yol gidildi"den ayırt etmek İMKÂNSIZ.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN DROP + CREATE (create or replace DEĞİL)
-- ═══════════════════════════════════════════════════════════════════════════
--  PostgreSQL `create or replace function`ta DÖNÜŞ TİPİNİ değiştirmeye izin
--  vermez; `returns table`a kolon eklemek dönüş tipini değiştirmektir. Bu
--  yüzden önce düşürülüp yeniden kuruluyor ve İKİSİ TEK İŞLEMDE: begin/commit
--  arasında başka bir oturum ya eski ya yeni hâli görür, "fonksiyon yok" ara
--  durumunu GÖRMEZ.
--
--  ⚠️ GERİYE DÖNÜK UYUMLU. Eklenen iki kolon SONA geliyor; mevcut çağıran
--  (lib/analytics.ts getWorkerShiftDistance) satırları ADIYLA okuyor, sırayla
--  değil. Yani 100 uygulanmadan önce yazılmış kod aynen çalışmaya devam eder.
--
--  ⚠️ GÖVDE MANTIĞI DEĞİŞMEDİ. İki LATERAL aynı, filtreler aynı, km-guard yine
--  lib/analytics.ts'te. Bu migration YALNIZ iki kolon ekler — hiçbir satırın
--  km'si değişmez.

begin;

drop function if exists public.shift_odometer_spans(timestamptz, timestamptz);

create function public.shift_odometer_spans(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  time_entry_id uuid,
  worker_id     uuid,
  vehicle_id    uuid,
  started_at    timestamptz,
  ended_at      timestamptz,
  first_km      double precision,
  last_km       double precision,
  -- YENİ (100): odometre okumalarının ANLARI. Kapsama kapısı bunları okur.
  -- Adlandırma 097'nin (fleet_odometer_spans) `ilk_an`/`son_an` deseniyle aynı.
  ilk_an        timestamptz,
  son_an        timestamptz
)
language sql
stable
as $$
  select
    te.id,
    te.worker_id,
    te.vehicle_id,
    te.started_at,
    te.ended_at,
    f.km,
    l.km,
    f.an,
    l.an
  from public.time_entries te
  left join lateral (
    select dt.odometer_km::double precision as km, dt.recorded_at as an
    from public.device_telemetry dt
    where dt.vehicle_id = te.vehicle_id
      and dt.odometer_km is not null
      and dt.recorded_at >= te.started_at
      and dt.recorded_at <= coalesce(te.ended_at, p_to)
    order by dt.recorded_at asc
    limit 1
  ) f on true
  left join lateral (
    select dt.odometer_km::double precision as km, dt.recorded_at as an
    from public.device_telemetry dt
    where dt.vehicle_id = te.vehicle_id
      and dt.odometer_km is not null
      and dt.recorded_at >= te.started_at
      and dt.recorded_at <= coalesce(te.ended_at, p_to)
    order by dt.recorded_at desc
    limit 1
  ) l on true
  where te.vehicle_id is not null
    and te.worker_id is not null
    and te.started_at <= p_to
    and (te.ended_at is null or te.ended_at >= p_from);
$$;

comment on function public.shift_odometer_spans(timestamptz, timestamptz) is
  'Vardiya pencereli odometre uclari + OKUMA ANLARI (052 + 100). ilk_an/son_an kapsama kapisi icindir: cihaz vardiyanin basindan sonuna konusmus mu. km-guard burada DEGIL, lib/analytics.ts te.';

-- Yeni kolonlar PostgREST'te hemen görünsün.
notify pgrst, 'reload schema';

commit;
