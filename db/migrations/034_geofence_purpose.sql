-- 034_geofence_purpose.sql — DEPO BÖLGESİ (Modül 3)
--
-- geofences.purpose: bölgenin NE İŞE yaradığı (üçüncü eksen). Mevcut alanlar:
--   type      = geometri (yalnız 'circle')
--   rule_kind = ihlal semantiği ('forbidden' / 'allowed_only')
--   purpose   = amaç ('rule' = klasik uyarı bölgesi, 'depot' = depo → panelde
--               "mesaiyi başlat?" önerisi tetikler)
--
-- Additive + idempotent: mevcut satırlar 'rule' olur (davranış değişmez).
-- Tablo yoksa (015 çalıştırılmadıysa) bu migration da başarısız olur — 015'ten
-- sonra çalıştır. Panel okuması best-effort: kolon yoksa öneri sessizce çıkmaz.

alter table public.geofences
  add column if not exists purpose text not null default 'rule'
  check (purpose in ('rule','depot'));

notify pgrst, 'reload schema';
