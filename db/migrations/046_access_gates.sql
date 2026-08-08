-- HAK61 — Migration 046 (ERİŞİM KAPILARI)
-- =====================================================================
-- Dört kapı, hepsi 045'in üstüne biner ve hepsi TEK bayrakla açılır
-- (ACCESS_GATES_ENABLED, lib/tenant.ts). Bayrak kapalıyken bu tabloların
-- hiçbirine dokunulmaz — HAK61/Sendigo'da tablolar yaratılsa bile tek satır
-- yazılmaz, tek sorgu atılmaz.
--
--   KAPI 1  device_approvals    yeni cihazdan giriş patron onayına düşer
--   KAPI 2  country_approvals   liste dışı ülkeden giriş patron onayına düşer
--   KAPI 3  workers.access_hours_start/end  kişi bazında saat aralığı
--   KAPI 4  kill_switch (+ _attempts, _secret)  ölü adam anahtarı
--
-- ── NEDEN ONAY TABLOSU, NEDEN BEYAZ LİSTE DEĞİL ──────────────────────
-- Cihaz ve ülke kararları GEÇMİŞİ olan kararlardır: kim, ne zaman, nereden
-- istedi ve kim onayladı. Tek bir `allowed_devices text[]` kolonu bu izi
-- tutamaz — reddedilen bir istek hiç görünmez, oysa asıl bilmek istediğimiz
-- şey reddedilenlerdir. Bu yüzden durum makinesi olan bir tablo.
--
-- ── workers.allowed_countries NEDEN AYRICA VAR ───────────────────────
-- country_approvals "bu kullanıcı bu ülkeden giriş istedi" olayını tutar;
-- allowed_countries ise patronun ÖNCEDEN açtığı ülkeleri (onay beklemeden).
-- NULL = kiracı varsayılanı (ACCESS_COUNTRIES env, öntanımlı TR,AT).
-- Boş dizi = "hiçbir ülke serbest değil, hepsi onaydan geçsin" demektir ve
-- NULL'dan farklıdır — bu ayrım bilinçli.
--
-- Tekrar çalıştırılabilir (idempotent). Supabase SQL Editor'da çalıştırın.
-- ⚠️ ÖNCE 045 çalıştırılmış olmalı (workers.is_owner buradaki kapıların
--    muafiyet ölçütü).
-- =====================================================================

begin;

-- ── KAPI 1: CİHAZ ONAYI ──────────────────────────────────────────────
-- device_hash lib/request-context.ts'ten gelir: UA + Accept-Language sha256'sı.
-- ⚠️ KASITLI OLARAK ZAYIF bir iz (bkz. 045): aynı tarayıcı sürümünü aynı dille
-- kullanan iki kişi AYNI izi üretir. Yani bu kapı "cihazı tanır" demez,
-- "tanımadığım bir imza gördüm, insana sor" der. Güvenliği sağlayan şey
-- parmak izinin gücü değil, ONAY ADIMIDIR.
create table if not exists public.device_approvals (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references public.workers(id) on delete cascade,
  device_hash   text not null,
  status        text not null default 'pending'
                  check (status in ('pending','approved','denied')),
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.workers(id) on delete set null,
  -- İlk görüldüğü andaki bağlam — patron kararı buna bakarak veriyor.
  first_ip      text,
  first_city    text,
  first_country text,
  user_agent    text
);

-- Kişi + cihaz çifti TEKTİR: aynı cihaz için ikinci bir pending satır açılmaz,
-- yoksa her giriş denemesi listeye yeni bir satır atar ve patron ekranı
-- kullanılamaz hâle gelir.
create unique index if not exists idx_device_approvals_worker_device
  on public.device_approvals(worker_id, device_hash);

-- Patron ekranının ana sorgusu: bekleyenler, en yeniden eskiye.
create index if not exists idx_device_approvals_pending
  on public.device_approvals(requested_at desc)
  where status = 'pending';

-- ── KAPI 2: ÜLKE ONAYI ───────────────────────────────────────────────
-- Ülke Vercel'in x-vercel-ip-country başlığından okunur (ücretsiz, dış servis
-- yok). ⚠️ Başlık YOKSA (yerel geliştirme, Vercel dışı barındırma) kapı
-- AÇIK kalır: bilinmeyen bir ülkeyi "yasak" saymak, başlık üretmeyen her
-- ortamda herkesi kilitlerdi. Kapının işi bilinen-yabancı ülkeyi durdurmak.
create table if not exists public.country_approvals (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references public.workers(id) on delete cascade,
  -- ISO 3166-1 alpha-2, BÜYÜK harf (kod tarafında normalize edilir).
  country       text not null,
  status        text not null default 'pending'
                  check (status in ('pending','approved','denied')),
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.workers(id) on delete set null
);

create unique index if not exists idx_country_approvals_worker_country
  on public.country_approvals(worker_id, country);

create index if not exists idx_country_approvals_pending
  on public.country_approvals(requested_at desc)
  where status = 'pending';

-- Patronun ÖNCEDEN açtığı ülkeler. NULL = kiracı varsayılanı (TR,AT).
alter table public.workers
  add column if not exists allowed_countries text[];

comment on column public.workers.allowed_countries is
  'Onay beklemeden serbest ülkeler (046). NULL = kiracı varsayılanı; '
  'BOŞ DİZİ = hiçbiri serbest değil (NULL ile aynı şey DEĞİL).';

-- ── KAPI 3: SAAT KİLİDİ ──────────────────────────────────────────────
-- İkisi de NULL = bu kişide saat kısıtı YOK (kiracı varsayılanı uygulanır).
-- Gece devreden aralık (22:00-06:00) DESTEKLENİR: start > end ise aralık
-- gece yarısını sarar, kod tarafında öyle değerlendirilir.
alter table public.workers
  add column if not exists access_hours_start time;

alter table public.workers
  add column if not exists access_hours_end time;

comment on column public.workers.access_hours_start is
  'Giriş serbest saat aralığının başı (046, Europe/Istanbul). NULL = kısıt yok. '
  'start > end ise aralık gece yarısını sarar.';

-- ── KAPI 4: ÖLÜ ADAM ANAHTARI ────────────────────────────────────────
-- Her satır BİR AKTİVASYONDUR. Açık kayıt = deactivated_at IS NULL.
-- Anahtar "aktif mi" sorusunun cevabı: böyle bir satır var mı.
create table if not exists public.kill_switch (
  id              uuid primary key default gen_random_uuid(),
  activated_at    timestamptz not null default now(),
  activated_by    uuid references public.workers(id) on delete set null,
  deactivated_at  timestamptz,
  deactivated_by  uuid references public.workers(id) on delete set null,
  reason          text
);

-- Aynı anda birden çok açık aktivasyon olamaz.
create unique index if not exists idx_kill_switch_open
  on public.kill_switch((deactivated_at is null))
  where deactivated_at is null;

create index if not exists idx_kill_switch_time
  on public.kill_switch(activated_at desc);

-- Her aşama denemesi buraya yazılır — kilit durumu BURADAN TÜRETİLİR,
-- ayrı bir sayaç kolonu tutulmaz (iki yerde saklanan sayaç ayrışır).
create table if not exists public.kill_switch_attempts (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  worker_id  uuid references public.workers(id) on delete set null,
  ip         text,
  -- 'confirm' = "ONAYLIYORUM" yazımı · 'secret' = gizli soru cevabı
  stage      text not null check (stage in ('confirm','secret')),
  success    boolean not null default false
);

create index if not exists idx_kill_switch_attempts_time
  on public.kill_switch_attempts(at desc);

-- Kilit türetmesi bu indeksi kullanır: son N 'secret' denemesi.
create index if not exists idx_kill_switch_attempts_secret
  on public.kill_switch_attempts(at desc)
  where stage = 'secret';

-- ── GİZLİ SORUNUN CEVABI ─────────────────────────────────────────────
-- ⚠️ DÜZ METİN HİÇBİR YERDE YOK — ne bu dosyada, ne kodda, ne env'de.
-- Yalnız bcrypt hash'i duruyor ve doğrulama bcrypt.compare ile yapılır
-- (lib/kill-switch.ts). Hash'i geri çevirmek pratikte imkânsız; cevabı
-- değiştirmek isteyen yeni bir hash üretip bu satırı günceller.
--
-- Neden tabloda, neden env'de değil: env değeri Vercel panelinde okunabilir
-- durumda duruyor ve üç kiracıya kopyalanırdı. Cevap kiracıya ait bir SIR,
-- bir yapılandırma değil.
create table if not exists public.kill_switch_secret (
  id           uuid primary key default gen_random_uuid(),
  answer_hash  text not null,
  updated_at   timestamptz not null default now(),
  -- Tek satır olmalı: sabit true kolonu + tekil indeks bunu şemada zorlar.
  singleton    boolean not null default true
);

create unique index if not exists idx_kill_switch_secret_singleton
  on public.kill_switch_secret(singleton);

-- Idempotent: satır varsa dokunulmaz (cevabı elle değiştirdiyseniz korunur).
insert into public.kill_switch_secret (answer_hash)
select '$2b$10$vOjXw4BeoSHqOzOGvQZ2ke4zVHwWtAx5WsLE7k6I4CoLqrKtfQxDy'
where not exists (select 1 from public.kill_switch_secret);

-- NOT: RLS bu tabloların hepsinde KAPALI kalır — şemanın geri kalanıyla
-- tutarlı; yalnız service-role istemcisi okuyup yazıyor (bkz. 045).

commit;

-- =====================================================================
--  ÇALIŞTIRDIKTAN SONRA
--
--  Doğrulama:
--    select count(*) from public.device_approvals;   -- 0
--    select count(*) from public.country_approvals;  -- 0
--    select count(*) from public.kill_switch;        -- 0 (anahtar kapalı)
--    select count(*) from public.kill_switch_secret; -- 1
--
--  Kişiye özel saat aralığı (örnek):
--    update public.workers set access_hours_start='08:00', access_hours_end='18:00'
--     where phone = '+43...';
--
--  Kişiye özel serbest ülke (onay beklemeden):
--    update public.workers set allowed_countries = array['TR','AT','DE']
--     where phone = '+43...';
--
--  ⚠️ Bu migration TEK BAŞINA hiçbir davranış değiştirmez. Kapıları açan şey
--     ACCESS_GATES_ENABLED env'idir (lib/tenant.ts) ve VARSAYILANI false.
-- =====================================================================
