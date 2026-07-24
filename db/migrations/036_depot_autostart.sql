-- 036_depot_autostart.sql — DEPO-TETİKLİ OTOMATİK VARDİYA (Modül 7)
--
-- (1) vehicles.auto_start_enabled: bu araçta depo-tetikli otomatik vardiya açık mı.
--     Paylaşılan/sorunlu araçlarda yönetici kapatır → yalnız elle başlatma
--     (G-riski: yanlış kişi adına vardiya açılmasın). Varsayılan true.
--
-- (2) workers.panel_seen_at: şoför paneli en son ne zaman aktifti (panel açıkken
--     ping'ler). "Vardiya auto açıldı ama şoför 2 saattir panele girmemiş →
--     belki o araçta değil" Dikkat kalemi için (G post-hoc yakalama).
--
-- Additive + idempotent. Kolon yoksa best-effort: auto-shift auto_start_enabled'ı
-- seçemezse motor no-op olur (elle başlatma çalışmaya devam eder), panel_seen_at
-- yoksa ping/Dikkat sessizce atlanır. ⚠️ AUTO açılmadan ÖNCE bu migration çalışmalı.

alter table public.vehicles
  add column if not exists auto_start_enabled boolean not null default true;

alter table public.workers
  add column if not exists panel_seen_at timestamptz;

notify pgrst, 'reload schema';
