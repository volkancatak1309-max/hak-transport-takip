-- 033_device_config_epochs.sql — Aşırı hız eşiği 120→131 dönem kaydı (Modül 5)
--
-- device_config_epochs ZATEN VAR (22.07.2026'da elle kuruldu, alarm eşiği kaydı
-- içeriyor). `create table if not exists` → mevcut tabloya ve VERİSİNE DOKUNMAZ;
-- yalnız temiz bir ortamda tabloyu kurar (repoda migration'ı yoktu, ekleniyor).
--
-- Sonra: aşırı hız uyarı eşiğinin 120'den 131 km/s'e çıktığını işaretleyen bir
-- EPOCH satırı ekler; raporlar bu sınırı aşan trendleri gizler / not düşer
-- (lib/config-epoch.ts). Guard: 11104 için zaten epoch varsa tekrar EKLEMEZ.
--
-- Komut GÖNDERİLDİ: 28 cihaza `setparam 11104:131` + DO-505GS kuyruk düzeltmesi,
-- gönderim anı UTC 2026-07-23T21:38:09Z (flespi commands-queue). Epoch changed_at
-- bu ana SABİTLENDİ — migration'ı ne zaman çalıştırırsan çalıştır sınır doğru
-- kalır (raporlar bu sınırı aşan trendleri gizler / not düşer).

create table if not exists public.device_config_epochs (
  id         uuid primary key default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  params     text,
  note       text
);
alter table public.device_config_epochs disable row level security;

insert into public.device_config_epochs (changed_at, params, note)
select timestamptz '2026-07-23T21:38:09.579Z',
       '11104: 120->131',
       'Asiri hiz uyari esigi 120->131 km/s (28 cihaz + DO-505GS kuyruk; gonderim UTC 2026-07-23T21:38)'
where not exists (
  select 1 from public.device_config_epochs where params like '%11104%'
);

notify pgrst, 'reload schema';
