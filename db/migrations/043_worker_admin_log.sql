-- 043_worker_admin_log.sql — YÖNETİCİ YETKİSİ DEĞİŞİKLİK İZİ
--
-- workers.is_admin artık çalışan DÜZENLEME formundan da değiştirilebiliyor
-- (eskiden yalnız EKLEME formunda vardı; bir kez yönetici yapılan kişinin
-- yetkisi panelden geri alınamıyordu). Yetki vermek/almak sistemin en ağır
-- kararı: kim kime ne zaman hangi yöne yetki verdi, izsiz kalmamalı.
--
-- NE YAZILIR: kim (changed_by), kimi (worker_id), ne zaman (changed_at),
-- hangi yöne (granted: true = yetki verildi, false = yetki alındı).
--
-- SİLİNEN PERSONEL: iki taraf da `on delete set null` — shift_edit_log,
-- leave_edit_log ve login_unlock_log ile aynı gerekçe: kayıt silinse de İZ
-- KALIR (§ 132 BAO, 7 yıl).
--
-- Best-effort: lib/worker-admin-log.ts tablo yoksa sessizce geçer. Yetki
-- değişikliğinin KENDİSİ buna dayanmaz — migration çalıştırılmadı diye
-- yanlışlıkla yönetici yapılmış biri düzeltilemez duruma DÜŞMEZ.

create extension if not exists pgcrypto;

create table if not exists public.worker_admin_log (
  id         uuid primary key default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  changed_by uuid references public.workers(id) on delete set null,
  worker_id  uuid references public.workers(id) on delete set null,
  granted    boolean not null
);

comment on table public.worker_admin_log is
  'workers.is_admin değişikliklerinin izi. granted=true yetki verildi, false alındı. Yazan: lib/worker-admin-log.ts.';

-- Bir çalışanın yetki geçmişi — en sık sorgu bu eksende ve tarih sırasında.
create index if not exists worker_admin_log_worker_idx
  on public.worker_admin_log (worker_id, changed_at desc);

notify pgrst, 'reload schema';
