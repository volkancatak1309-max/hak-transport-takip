-- ═══════════════════════════════════════════════════════════════════════════
--  GALZURA DEMO — 7 GÜNLÜK DOLGU SONRASI SORGU PLANI BAKIMI
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ── ÖNCE ÖLÇÜM: YENİ İNDEKS GEREKMİYOR ───────────────────────────────────
--
--  Depodaki TÜM `device_telemetry` sorguları tarandı (lib/ + app/, 20 sorgu):
--
--     19 × .eq("vehicle_id", …) + recorded_at aralığı
--      1 × .upsert(…)  → lib/telemetry.ts:97, çakışma hedefi
--                        (vehicle_id, recorded_at)
--      0 × araç filtresi olmayan okuma
--      0 × araç LİSTESİ (.in) ile okuma
--
--  Yani her okuma (vehicle_id, recorded_at) önekiyle giriyor ve bu indeks
--  migration 014'ten beri VAR — üstelik UNIQUE:
--     idx_device_telemetry_vehicle_recorded (vehicle_id, recorded_at)   [014:27]
--     idx_device_telemetry_device_recorded  (flespi_device_id, …desc)   [014:31]
--
--  Dolgunun yazacağı diğer üç tablo da tam kaplı:
--     vehicle_events : idx_vehicle_events_vehicle_time · idx_vehicle_events_time
--                      · uq_vehicle_events_dedup                        [018]
--     idle_episodes  : uq_idle_open_per_vehicle · idx_idle_vehicle_time
--                      · idx_idle_time                                  [024]
--     time_entries   : worker · started_date · vehicle · open
--                      · uq_time_entries_one_open · start_source        [001-038]
--
--  ⚠️ DÜZELTME — 57014 TIMEOUT'U UYGULAMANIN SORGUSU DEĞİLDİ.
--  HAK61'de timeout veren sorgu şuydu:
--     select count(*) from device_telemetry where recorded_at >= now()-'1h'
--  Araç filtresi YOK. Bu, bir TEŞHİS BETİĞİNİN sorgusudur (bu oturumda ben
--  çalıştırdım); uygulama böyle bir sorgu HİÇ atmıyor (yukarıdaki sayım: 0).
--  Ona indeks eklemek, hiçbir ekranı hızlandırmadan her INSERT'i yavaşlatırdı —
--  301 bin satırlık bir dolguda bedeli doğrudan yazma süresine biner.
--  Bu yüzden `(recorded_at)` indeksi BİLEREK eklenmedi.
--
--  ── PEKİ NE GEREKİYOR: İSTATİSTİK ────────────────────────────────────────
--
--  Soğuk-cache'te takılmanın buradaki gerçek sebebi indeks yokluğu değil,
--  toplu yüklemeden sonra PLANLAYICI İSTATİSTİKLERİNİN BAYAT kalmasıdır.
--  301 bin satır tek seferde girdiğinde autovacuum'un ANALYZE'ı dakikalar
--  sonra çalışır; o pencerede planlayıcı tabloyu hâlâ neredeyse boş sanır ve
--  indeks yerine seq scan seçebilir. Demo tam o pencereye denk gelirse ekran
--  saniyelerce asılır.
--
--  Aşağısı bunu kapatır. Şema DEĞİŞMEZ: tek bir indeks/tablo/kolon
--  eklenmez, silinmez. Yalnız planlayıcıya "tablo artık dolu" denir.
--
--  ⚠️ DOLGUDAN SONRA ÇALIŞTIRIN (önce değil — boş tabloyu analiz etmek işe
--     yaramaz). Tekrar çalıştırmak zararsızdır.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) İSTATİSTİK TAZELE ───────────────────────────────────────────────────
-- Dolgunun dokunduğu dört tablo. `analyze` kilit almaz, tabloyu bloklamaz.
analyze public.device_telemetry;
analyze public.vehicle_events;
analyze public.idle_episodes;
analyze public.time_entries;

-- ── 2) recorded_at İÇİN HİSTOGRAM ÇÖZÜNÜRLÜĞÜ ──────────────────────────────
-- Varsayılan 100 kova, 7 günlük dar bir aralıkta 301 bin satırı temsil etmek
-- için kaba kalıyor: planlayıcı "son 24 saat" gibi dilimlerin seçiciliğini
-- yanlış tahmin edip indeks yerine seq scan seçebiliyor. 100 → 250 dar bir
-- artış (maliyeti yalnız ANALYZE süresi), kolon bazında ve YALNIZ bu kolonda.
alter table public.device_telemetry
  alter column recorded_at set statistics 250;

-- Ayar ancak yeniden analiz edilince etkili olur.
analyze public.device_telemetry;

-- ── 3) DENETİM ─────────────────────────────────────────────────────────────
do $denetim$
declare
  v_satir    bigint;
  v_analiz   timestamptz;
  v_indeks   int;
begin
  select n_live_tup, greatest(last_analyze, last_autoanalyze)
    into v_satir, v_analiz
    from pg_stat_user_tables
   where schemaname = 'public' and relname = 'device_telemetry';

  select count(*) into v_indeks
    from pg_indexes
   where schemaname = 'public' and tablename = 'device_telemetry';

  raise notice 'device_telemetry: % satir, % indeks, son analiz %',
    v_satir, v_indeks, v_analiz;

  if v_analiz is null then
    raise exception 'ANALYZE kaydi yok — istatistik tazelenmemis.';
  end if;
  if v_indeks < 3 then
    raise exception 'Beklenen en az 3 indeks (pkey + 2), bulunan %.', v_indeks;
  end if;
end
$denetim$;

-- ═══════════════════════════════════════════════════════════════════════════
--  NOT — İLERİSİ İÇİN (şimdi YAPILMADI, bilerek)
--
--  `idx_device_telemetry_device_recorded (flespi_device_id, recorded_at desc)`
--  bu depoda HİÇBİR sorgu tarafından kullanılmıyor (yukarıdaki tarama: 0 kez
--  flespi_device_id ile filtreleme). 301 bin satırlık dolguda yalnız yazma
--  maliyeti üretir. Yine de DÜŞÜRÜLMEDİ: HAK61 ve Sendigo ile şema farkı
--  yaratmak, ileride "hangi kurulumda hangi indeks var" sorusunu doğurur.
--  Düşürmek istenirse üç kurulumda birden ve ayrı bir kararla yapılmalı.
-- ═══════════════════════════════════════════════════════════════════════════
