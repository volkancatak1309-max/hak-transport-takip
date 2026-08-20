-- ═══════════════════════════════════════════════════════════════════════
-- ŞEMA ENVANTERİ — SALT OKUMA. Hiçbir şeyi değiştirmez, migration DEĞİLDİR.
--
-- NİÇİN VAR: üç ayrı veritabanı var (hak-transport-takip · galzura-demo ·
-- sendigo) ve "migration koşuldu" cümlesi hangisinde koşulduğunu söylemiyor
-- (Bekleyen-Isler #128). 20.08.2026'da bu boşluk gerçek bir arızaya döndü:
-- demo'da 063 uygulanmamıştı ve beş mobil bölge ucu sessizce 503 veriyordu.
--
-- KULLANIM: her veritabanında ayrı ayrı çalıştır, çıktıları yan yana koy.
-- Fark varsa hangi migration'ın eksik olduğu kolon/indeks/RPC adından okunur.
--
-- HAK61 REFERANSI (20.08.2026 tarihli, PostgREST OpenAPI'sinden):
--   public tablo sayısı : 32
--   geofences           : id, name, type, center_lat, center_lng, radius_m,
--                         rule_kind, active, created_at, purpose, archived_at,
--                         category, customer_name, customer_ref, min_dwell_s
--   zone_visits         : id, vehicle_id, zone_id, worker_id, started_at,
--                         ended_at, last_seen_at, end_reason, created_at
--   RPC (11)            : autoshift_telemetry_batch, first_ignition_batch,
--                         idle_episode_cursors_batch, last_recorded_at_batch,
--                         latest_telemetry_batch, report_coolant_daily,
--                         report_coolant_stats, report_fuel_stats,
--                         report_fuel_stats_vehicle, report_fuel_volume_stats,
--                         shift_odometer_spans
-- ═══════════════════════════════════════════════════════════════════════

select 'KOLON' as tur, table_name as nesne, string_agg(column_name, ', ' order by ordinal_position) as icerik
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('geofences','zone_visits','vehicles','workers','time_entries',
                      'device_telemetry','idle_episodes','vehicle_dtc')
 group by table_name
union all
select 'TABLO', 'public tablo sayisi', count(*)::text
  from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
union all
select 'TABLO ADLARI', 'liste', string_agg(table_name, ', ' order by table_name)
  from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
union all
select 'FONKSIYON', 'rpc', string_agg(p.proname, ', ' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f'
union all
select 'INDEKS', c.relname, string_agg(i.relname, ', ' order by i.relname)
  from pg_index x
  join pg_class c on c.oid = x.indrelid
  join pg_class i on i.oid = x.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relname in ('geofences','zone_visits')
 group by c.relname
union all
select 'KISIT', rel.relname, string_agg(con.conname || ' = ' || pg_get_constraintdef(con.oid), ' ;; ' order by con.conname)
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
 where n.nspname='public' and rel.relname in ('geofences','zone_visits') and con.contype='c'
 group by rel.relname
order by 1, 2;
