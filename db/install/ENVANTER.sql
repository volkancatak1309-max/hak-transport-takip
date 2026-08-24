-- ═══════════════════════════════════════════════════════════════════════════
--  ŞEMA ENVANTERİ — SALT OKUMA. Hiçbir şey yaratmaz, değiştirmez, silmez.
--  hak-transport-takip · 24.08.2026
-- ═══════════════════════════════════════════════════════════════════════════
--
--  NE İŞE YARAR
--  Bir kiracının veritabanının 078 şemasına göre NEREDE olduğunu söyler:
--  hangi tablo/kolon/RPC eksik, hizalama dosyası neyi ekleyecek, riskli bir
--  veri durumu var mı.
--
--  NASIL
--  Supabase → SQL Editor → hepsini yapıştır → Run. Tek bir sonuç tablosu
--  döner; "Copy" ile alıp olduğu gibi paylaşabilirsiniz.
--
--  ⚠️ TEK BİR YAZMA İFADESİ YOKTUR. Üretimde çalıştırmak güvenlidir.
--
--  BÖLÜMLER
--    1 TABLO    — 078'de olması gereken tablolar (VAR / EKSİK)
--    2 KOLON    — 043 sonrası eklenen kolonlar (VAR / EKSİK)
--    3 RPC      — rapor ve toplu okuma fonksiyonları
--    4 SAYIM    — canlı veri hacmi (hizalamanın süresini belirler)
--    5 RİSK     — hizalamayı DURDURACAK veri durumları
--    6 SONUÇ    — özet
-- ═══════════════════════════════════════════════════════════════════════════

with beklenen_tablo(ad, migration) as (values
  ('action_snoozes','058'), ('audit_log','045'), ('conversation_members','073'),
  ('conversations','071'), ('country_approvals','046'), ('device_approvals','046'),
  ('document_types','078'), ('fleets','059'), ('fuel_price_reference','077'),
  ('kill_switch','046'), ('kill_switch_attempts','046'), ('kill_switch_secret','046'),
  ('login_sessions','045'), ('message_receipts','071'), ('messages','071'),
  ('pdf_fingerprints','047'), ('push_tokens','074'), ('seferler','066'),
  ('tenant_cost_rates','076'), ('vehicle_fault_reports','056'),
  ('worker_documents','078'), ('zone_visits','064')
),
beklenen_kolon(tablo, kolon, migration) as (values
  ('geofences','archived_at','069'), ('geofences','category','063'),
  ('geofences','customer_name','064'), ('geofences','customer_ref','064'),
  ('geofences','min_dwell_s','064'),
  ('vehicles','device_model','055'),
  ('workers','access_hours_start','046'), ('workers','access_hours_end','046'),
  ('workers','allowed_countries','046'), ('workers','fleet','072'),
  ('workers','gate_exempt','048'), ('workers','is_owner','045'),
  ('workers','session_version','045'), ('workers','token_version','044'),
  ('vehicle_fault_reports','closed_at','057'), ('vehicle_fault_reports','closed_by','057')
),
beklenen_rpc(ad, migration) as (values
  ('last_recorded_at_batch','060'), ('idle_episode_cursors_batch','061'),
  ('autoshift_telemetry_batch','062'), ('latest_telemetry_batch','065'),
  ('first_ignition_batch','067'), ('report_fuel_stats_vehicle','050'),
  ('shift_odometer_spans','052'), ('purge_old_telemetry','054 (yalnız demo)')
),
t as (
  select '1 TABLO' as bolum,
         b.ad || '  (' || b.migration || ')' as ad,
         case when x.table_name is null then '✗ EKSİK' else '✓ var' end as durum
    from beklenen_tablo b
    left join information_schema.tables x
      on x.table_schema = 'public' and x.table_name = b.ad
),
k as (
  select '2 KOLON' as bolum,
         b.tablo || '.' || b.kolon || '  (' || b.migration || ')' as ad,
         case
           when not exists (select 1 from information_schema.tables
                             where table_schema='public' and table_name=b.tablo)
             then '– tablo yok'
           when x.column_name is null then '✗ EKSİK'
           else '✓ var'
         end as durum
    from beklenen_kolon b
    left join information_schema.columns x
      on x.table_schema='public' and x.table_name=b.tablo and x.column_name=b.kolon
),
r as (
  select '3 RPC' as bolum,
         b.ad || '  (' || b.migration || ')' as ad,
         case when x.proname is null then '✗ EKSİK' else '✓ var' end as durum
    from beklenen_rpc b
    left join (
      select p.proname from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
    ) x on x.proname = b.ad
),
s as (
  select '4 SAYIM' as bolum, ad, durum from (
    select 'workers' as ad, (select count(*)::text from public.workers) as durum
    union all select 'vehicles', (select count(*)::text from public.vehicles)
    union all select 'time_entries', (select count(*)::text from public.time_entries)
    union all select 'geofences', (select count(*)::text from public.geofences)
    union all select 'device_telemetry  ⚠️ indeks süresi buna bağlı',
                     (select count(*)::text from public.device_telemetry)
    union all select 'toplam tablo sayısı',
                     (select count(*)::text from information_schema.tables
                       where table_schema='public' and table_type='BASE TABLE')
  ) q
),
riskler as (
  select '5 RİSK' as bolum, ad, durum from (
    -- 059: fleets(code) FK'si yalnız bordo/mavi tanır.
    select 'vehicles.fleet tanımsız kod (059 DURDURUR)' as ad,
           coalesce((select string_agg(distinct fleet, ', ') from public.vehicles
                      where fleet is not null and fleet not in ('bordo','mavi')),
                    '✓ yok') as durum
    union all
    select 'workers.managed_fleet tanımsız kod (059 DURDURUR)',
           coalesce((select string_agg(distinct managed_fleet, ', ') from public.workers
                      where managed_fleet is not null and managed_fleet not in ('bordo','mavi')),
                    '✓ yok')
    union all
    -- 064: purpose kısıtı yeniden kurulacak.
    select 'geofences.purpose izinsiz değer (064 DURDURUR)',
           coalesce((select string_agg(distinct purpose, ', ') from public.geofences
                      where purpose is not null and purpose not in ('rule','depot','customer')),
                    '✓ yok')
    union all
    -- Telegram kalıntısı: hizalama DOKUNMAZ, yalnız bilgi.
    select 'workers.telegram_chat_id dolu satır (bilgi)',
           case when exists (select 1 from information_schema.columns
                              where table_schema='public' and table_name='workers'
                                and column_name='telegram_chat_id')
                then (select count(*)::text from public.workers where telegram_chat_id is not null)
                else 'kolon yok (temiz)' end
    union all
    -- 075 uygulanmamışsa kaç numara etkilenir (hizalama BUNU YAPMAZ).
    select 'workers.phone ulusal trunk sıfırlı (075, ayrı karar)',
           (select count(*)::text from public.workers
             where phone ~ '^\+(43|49|41|90|44|33|31|32)0\d')
  ) q
),
sonuc as (
  select '6 SONUÇ' as bolum, ad, durum from (
    select 'eksik tablo' as ad, (select count(*)::text from t where durum like '✗%') as durum
    union all select 'eksik kolon', (select count(*)::text from k where durum like '✗%')
    union all select 'eksik RPC', (select count(*)::text from r where durum like '✗%')
    union all select 'hizalama gerekli mi',
      case when (select count(*) from t where durum like '✗%')
              + (select count(*) from k where durum like '✗%') = 0
           then 'HAYIR — bu kurulum 078 hizasında'
           else 'EVET — <musteri>-hizalama-078.sql çalıştırın' end
  ) q
)
select * from (
  select * from t
  union all select * from k
  union all select * from r
  union all select * from s
  union all select * from riskler
  union all select * from sonuc
) hepsi
order by bolum, (durum like '✗%') desc, ad;
