-- HAK61 — Migration 045 (PATRON KADEMESİ + GÜVENLİK İZİ)
-- =====================================================================
-- Üç şey ekler, hiçbir mevcut kolona/tabloya DOKUNMAZ:
--
--   a) workers.is_owner        — yöneticinin ÜSTÜNDE bir kademe
--   b) workers.session_version — tek oturum kilidi + uzaktan kesme sayacı
--   c) login_sessions          — kim, ne zaman, nereden, hangi cihazdan girdi
--   d) audit_log               — sayfa görüntüleme + önemli eylem izi
--
-- ── NEDEN AYRI KADEME (is_owner) ─────────────────────────────────────
-- Bugün tek yönetici kademesi var (workers.is_admin, 001) ve 19 yönetici
-- sayfasının hepsi requireAdmin() ile korunuyor. Güvenlik ekranı oturum
-- geçmişi, IP ve cihaz parmak izi gösteriyor — bu, "panele bakan herkesin"
-- değil, HESAP SAHİBİNİN görmesi gereken bir veri. is_admin'i bölmek yerine
-- ÜSTÜNE bir kademe konuldu: mevcut 19 sayfa aynen requireAdmin'de kalır,
-- yalnız yeni ekran requireOwner() arkasına girer. Böylece bu migration
-- çalıştırılmadan önce yazılmış hiçbir yetki kararı değişmez.
--
-- Desen migration 029'un (managed_fleet) birebir aynısı: tek nullable kolon +
-- kod tarafında bir kapı fonksiyonu. Yeni rol TABLOSU yok.
--
-- ⚠️ VARSAYILAN false: bu dosya çalıştırıldığı anda kimse owner olmaz.
--    Owner'ı ayrıca siz atarsınız (aşağıdaki nota bakın).
--
-- ── NEDEN session_version ────────────────────────────────────────────
-- Oturum iron-session ile ÇEREZDE taşınıyor (lib/session.ts) ve sunucuda
-- hiçbir kaydı yok — yani bugün bir oturumu uzaktan düşürmek teknik olarak
-- imkânsız. Bu sayaç mobil taraftaki workers.token_version (044) ile aynı
-- fikri web çerezine getirir: çerez mühürlenirken içine o anki değer konur,
-- her istekte DB'deki değerle karşılaştırılır, sayaç artınca eski çerez ölür.
--
-- Tekrar çalıştırılabilir (idempotent). Supabase SQL Editor'da çalıştırın.
--
-- ⚠️ BU DOSYA GÜNCELLENDİ (login_sessions.source + canlılık indeksi eklendi).
--    Daha önce çalıştırdıysanız TEKRAR ÇALIŞTIRIN — her adım idempotent, var
--    olan satırlara ve kolonlara dokunmaz.
-- =====================================================================

begin;

-- ── a) PATRON KADEMESİ ───────────────────────────────────────────────
-- nullable + default false: mevcut satırlar false olur, kimse yetki kazanmaz.
alter table public.workers
  add column if not exists is_owner boolean not null default false;

comment on column public.workers.is_owner is
  'Yöneticinin üstünde kademe (045). Yalnız /admin/guvenlik ekranını açar; '
  'diğer 19 yönetici sayfası is_admin ile korunmaya devam eder.';

-- Owner sayısı tipik olarak 1-2; kısmi indeks tam da bu dağılım için.
create index if not exists idx_workers_is_owner
  on public.workers(id)
  where is_owner;

-- ── b) OTURUM SÜRÜMÜ ─────────────────────────────────────────────────
-- Artınca o kişinin TÜM web çerezleri geçersizleşir (tek oturum kilidi ve
-- "oturumları sonlandır" düğmesi bunu artırır).
alter table public.workers
  add column if not exists session_version integer not null default 0;

comment on column public.workers.session_version is
  'Web oturum iptal sayacı (045). Çerez mühürlenirken içine yazılır; '
  'DB değeri artınca eski çerez reddedilir. Mobil karşılığı: token_version (044).';

-- ── c) GİRİŞ OTURUMLARI ──────────────────────────────────────────────
-- Bugün BAŞARILI giriş hiçbir yere yazılmıyor: login_attempts (012) yalnız
-- BAŞARISIZ denemeyi tutar ve başarılı girişte o satır SİLİNİR
-- (lib/auth-core.ts:143). Yani "kim ne zaman girdi" verisi hiç yok.
create table if not exists public.login_sessions (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references public.workers(id) on delete cascade,
  started_at    timestamptz not null default now(),
  -- Oturum CANLILIĞI. Korumalı her sayfa isteğinde ileri taşınır
  -- (lib/session.ts → touchLoginSession). "Açık" ile "canlı" farklı şeyler:
  -- tarayıcıyı çıkış yapmadan kapatan biri açık kalır ama canlı değildir —
  -- bu yüzden çoklu-oturum işareti started_at değil BU alana bakar.
  last_seen_at  timestamptz not null default now(),
  -- NULL = hâlâ açık. Dolu = kapandı (aşağıdaki sebeple).
  ended_at      timestamptz,
  ended_reason  text check (ended_reason is null or ended_reason in
                  ('logout','single_session','revoked','expired')),
  ip            text,
  user_agent    text,
  -- Cihaz parmak izi: UA + dil başlığının sha256'sı (lib/request-context.ts).
  -- ⚠️ Kesin kimlik DEĞİL — aynı tarayıcı sürümü + aynı dil aynı izi üretir.
  -- "Yeni cihaz" işareti bu yüzden bir İPUCU, kanıt değil.
  device_hash   text,
  -- Vercel'in ücretsiz coğrafya başlıklarından (x-vercel-ip-city / -country).
  -- Dış servis YOK, ek maliyet YOK. Vercel dışında çalışırken NULL kalır.
  city          text,
  country       text,
  -- Bu oturum açılırken aynı kişinin başka açık oturumu var mıydı?
  concurrent    boolean not null default false,
  -- Bu cihaz izi o kişide daha önce hiç görülmedi mi?
  new_device    boolean not null default false,
  -- Hangi kapıdan girildi: tarayıcı çerezi mi, mobil token ucu mu?
  -- İki giriş kapısı var (app/actions/auth.ts ve app/api/mobile/auth/login) ve
  -- ikisi de buraya yazar; ayırt edilmezse "aynı hesap iki cihazda" işareti
  -- telefondan+masaüstünden çalışan bir kişide yanlış alarma dönüşür.
  source        text not null default 'web'
);

-- 045'i DAHA ÖNCE çalıştırmış kurulumlar için: tablo zaten vardı, kolon yoktu.
alter table public.login_sessions
  add column if not exists source text not null default 'web';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'login_sessions_source_chk'
  ) then
    alter table public.login_sessions
      add constraint login_sessions_source_chk check (source in ('web','mobile'));
  end if;
end $$;

-- Patron ekranının ana sorgusu: kişi bazında en yeniden eskiye.
create index if not exists idx_login_sessions_worker_time
  on public.login_sessions(worker_id, started_at desc);

-- "Aktif oturumlar" listesi ve çoklu-oturum tespiti. last_seen_at indekste:
-- canlılık sorgusu (açık VE son N dakikada görülmüş) tek geçişte çözülsün.
--
-- ⚠️ ADI DEĞİŞTİ (idx_login_sessions_open → _live). `create index if not exists`
--    var olan bir ADI görürse kolonları FARKLI olsa bile hiçbir şey yapmaz ve
--    sessizce eski tanımı bırakırdı; bu yüzden eskisi adıyla düşürülüyor.
drop index if exists public.idx_login_sessions_open;

create index if not exists idx_login_sessions_live
  on public.login_sessions(worker_id, last_seen_at desc)
  where ended_at is null;

-- Tüm kullanıcılar arası zaman çizelgesi (giriş geçmişi ekranı).
create index if not exists idx_login_sessions_time
  on public.login_sessions(started_at desc);

-- ── d) EYLEM İZİ ─────────────────────────────────────────────────────
-- Sayfa görüntüleme + önemli eylem (rapor açma, PDF, dışa aktarma).
-- worker_id NULL olabilir: oturumsuz bir eylem de kaydedilebilsin.
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  worker_id  uuid references public.workers(id) on delete set null,
  at         timestamptz not null default now(),
  -- 'page_view' | 'export_csv' | 'export_pdf' | 'session_revoke' | 'freeze' …
  action     text not null,
  -- Eylemin hedefi: sayfa yolu, rapor adı, etkilenen kullanıcı id'si.
  target     text,
  meta       jsonb,
  ip         text
);

create index if not exists idx_audit_log_time
  on public.audit_log(at desc);

create index if not exists idx_audit_log_worker_time
  on public.audit_log(worker_id, at desc);

-- Ekranda tür bazlı süzme (yalnız dışa aktarmaları göster vb.).
create index if not exists idx_audit_log_action_time
  on public.audit_log(action, at desc);

-- NOT: RLS bu iki tabloda da KAPALI kalır — şemanın geri kalanıyla tutarlı;
-- yalnız service-role istemcisi okuyup yazıyor (bkz. 012/014/015'teki aynı not).

commit;

-- =====================================================================
--  ÇALIŞTIRDIKTAN SONRA — owner'ı siz atarsınız
--
--    update public.workers set is_owner = true where phone = '+905535910471';
--
--  Doğrulama:
--    select name, phone, is_admin, is_owner from public.workers where is_owner;
--    select count(*) from public.login_sessions;   -- 0 (ilk girişte dolar)
--
--  ⚠️ Bu migration TEK BAŞINA hiçbir davranış değiştirmez. Katmanı açan şey
--     SECURITY_LAYER_ENABLED env'idir (lib/tenant.ts) ve VARSAYILANI false —
--     yani HAK61/Sendigo'da tablo yaratılsa bile hiçbir şey yazılmaz.
-- =====================================================================
