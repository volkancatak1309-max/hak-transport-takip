-- 037_manual_shift_start.sql — YÖNETİCİ/ŞEF MANUEL VARDİYA BAŞLATMA (iz)
--
-- Depo-tetikli otomatik vardiya (Modül 7) telemetri düştüğünde açılmaz; o
-- boşlukta vardiyayı yönetici ya da FİLO ŞEFİ personel adına elle başlatır
-- (startShiftForWorkerAction). Bu iki kolon "kim, kimin adına, hangi yolla"
-- sorusunun kalıcı cevabıdır:
--
--   started_by   = eylemi yapan (yönetici/şef) — worker_id ise "kimin adına".
--                  "ne zaman" zaten started_at. shift_edit_log ALAN-değişikliği
--                  için tasarlı (ve SQL'i ayrıca bekliyor); başlatma bir YARATMA
--                  olduğundan buraya kolon olarak yazmak daha temiz ve panele
--                  (Dikkat/Aksiyon) doğrudan kaynak olur.
--   start_source = başlatma yolu: 'self' (şoför kendi), 'auto' (depo tetiği),
--                  'admin' (patron elle), 'chief' (filo şefi elle).
--                  Dikkat panosu YALNIZ 'chief' olanları "şef manuel başlattı"
--                  bildirimi olarak gösterir.
--
-- Additive + idempotent. Kolon yoksa uygulama best-effort: action önce bu
-- kolonlarla insert dener, kolon hatası alırsa kolonsuz tekrar dener (vardiya
-- ASLA iz eksikliğiyle kırılmaz); Dikkat sorgusu error → boş → kalem çıkmaz.
-- ⚠️ Şef manuel başlatma CANLIYA çıkmadan ÖNCE bu migration çalışmalı.

alter table public.time_entries
  add column if not exists started_by uuid references public.workers(id) on delete set null;

alter table public.time_entries
  add column if not exists start_source text not null default 'self'
  check (start_source in ('self', 'auto', 'admin', 'chief'));

-- Bugünkü Dikkat sorgusu start_source='chief' + started_at üzerinden gider.
create index if not exists idx_time_entries_start_source
  on public.time_entries(start_source, started_at);

notify pgrst, 'reload schema';
