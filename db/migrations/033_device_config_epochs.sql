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
-- ⚠️ Bu INSERT'i, cihazlara `setparam 11104:131` komutunu GÖNDERDİĞİN anda
-- çalıştır — changed_at=now() o anı işaretler. Önce/sonra çalıştırırsan sınır
-- gerçek değişim anıyla birkaç dakika kayar (kritik değil, ama isabetli olsun).

create table if not exists public.device_config_epochs (
  id         uuid primary key default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  params     text,
  note       text
);
alter table public.device_config_epochs disable row level security;

insert into public.device_config_epochs (params, note)
select '11104: 120->131', 'Asiri hiz uyari esigi 120->131 km/s (28 cihaz)'
where not exists (
  select 1 from public.device_config_epochs where params like '%11104%'
);

notify pgrst, 'reload schema';
