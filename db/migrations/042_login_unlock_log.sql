-- 042_login_unlock_log.sql — GİRİŞ KİLİDİ KALDIRMA İZİ
--
-- Yönetici panelindeki "Giriş kilidini kaldır" düğmesi bir GÜVENLİK ÖNLEMİNİ
-- elle geçersiz kılar: o kişinin `login_attempts` satırlarını siler, yani
-- kaba-kuvvet sayacını sıfırlar. Böyle bir yetkinin izsiz kullanılması olmaz.
--
-- NE YAZILIR: kim (unlocked_by), kimi (worker_id), ne zaman (unlocked_at) ve
-- kaç satır temizlendi (cleared_rows — kaç ayrı IP'den deneme birikmişti).
--
-- NE YAZILMAZ: IP adresi ve telefon. İz "yetki kullanıldı mı" sorusunu
-- cevaplamak için var, kişiyi ağ üzerinden izlemek için değil; satır sayısı
-- olayın büyüklüğünü zaten anlatıyor. (Kilit satırının kendisi silindiği için
-- IP'yi buraya kopyalamak, silinen veriyi başka bir tabloda diriltmek olurdu.)
--
-- SİLİNEN PERSONEL: iki taraf da `on delete set null`. shift_edit_log ve
-- leave_edit_log ile aynı gerekçe — kayıt silinse de İZ KALIR (§ 132 BAO).
--
-- Best-effort: lib/login-unlock-log.ts tablo yoksa sessizce geçer. Kilidi
-- kaldırmak izden önce gelir — migration çalıştırılmadı diye yönetici kilitli
-- bir şoförü açamaz duruma DÜŞMEZ.

create extension if not exists pgcrypto;

create table if not exists public.login_unlock_log (
  id           uuid primary key default gen_random_uuid(),
  unlocked_at  timestamptz not null default now(),
  unlocked_by  uuid references public.workers(id) on delete set null,
  worker_id    uuid references public.workers(id) on delete set null,
  cleared_rows int not null default 0
);

comment on table public.login_unlock_log is
  'Giriş kilidinin yönetici tarafından elle kaldırılma izi. Yazan: lib/login-unlock-log.ts.';

-- Bir çalışanın kilit-kaldırma geçmişi; en sık sorgu bu eksende ve tarih sırasında.
create index if not exists login_unlock_log_worker_idx
  on public.login_unlock_log (worker_id, unlocked_at desc);

notify pgrst, 'reload schema';
