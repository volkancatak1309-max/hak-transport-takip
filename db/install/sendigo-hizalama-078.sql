-- ═══════════════════════════════════════════════════════════════════════════
--  SENDIGO — ŞEMA HİZALAMA 043 → 091
--  hak-transport-takip · üreten: scripts/gen-align-sql.mjs
-- ═══════════════════════════════════════════════════════════════════════════
--
--  NE İŞE YARAR
--  MEVCUT ve CANLI VERİSİ OLAN bir kurulumu bugünkü şemaya çeker. Eksik
--  tabloları, kolonları, indeksleri ve RPC''leri ekler.
--
--  ⚠️ BOŞ VERİTABANINDA KULLANMAYIN — onun dosyası sendigo-full.sql.
--
--  BU KİRACIDA NE DEĞİŞECEK — ÖLÇÜLDÜ (24.08.2026, canlı Sendigo şeması)
--    · +22 TABLO: action_snoozes · audit_log · conversations · conversation_members
--      · country_approvals · device_approvals · document_types · fleets
--      · fuel_price_reference · kill_switch · kill_switch_attempts
--      · kill_switch_secret · login_sessions · message_receipts · messages
--      · pdf_fingerprints · push_tokens · seferler · tenant_cost_rates
--      · vehicle_fault_reports · worker_documents · zone_visits
--    · +13 KOLON: geofences(archived_at, category, customer_name, customer_ref,
--      min_dwell_s) · vehicles(device_model) · workers(access_hours_start,
--      access_hours_end, allowed_countries, fleet, gate_exempt, is_owner,
--      session_version)
--    · +5 RPC: last_recorded_at_batch · idle_episode_cursors_batch
--      · autoshift_telemetry_batch · latest_telemetry_batch · first_ignition_batch
--    · SİLİNEN SATIR: 0.  DÜŞÜRÜLEN TABLO/KOLON: 0.
--
--  CANLI VERİ (24.08.2026): 9 personel · 5 araç · 26 vardiya · 0 bölge
--  · 207.388 device_telemetry satırı. Bölge tablosu BOŞ olduğu için 063/064/069
--  kısıt ve geri-doldurma adımları bu kiracıda hiçbir satıra dokunmaz.
--  vehicles.fleet''in 5 satırının hepsi 'mavi' → 059''un FK''si sorunsuz kurulur.
--  telegram_chat_id dolu 0 satır → Telegram kalıntısı kimseyi etkilemiyor.
--
--  NASIL ÇALIŞIR — HEPSİ YA DA HİÇBİRİ
--  Dosyanın tamamı TEK transaction içindedir. Bir ifade hata verirse HİÇBİR
--  ŞEY uygulanmaz; yarım şema oluşmaz. Baştaki ön denetimler, sorunu kısıt
--  hatasından önce okunur bir cümleyle söyler.
--
--  TEKRAR ÇALIŞTIRILABİLİR (idempotent). İkinci koşum hiçbir şey değiştirmez;
--  boş bir PostgreSQL 16 üzerinde iki kez üst üste ölçüldü.
--
--  VERİ KAYBI RİSKİ
--  · Hiçbir tablo ya da kolon DÜŞÜRÜLMEZ. Hiçbir satır SİLİNMEZ.
--  · Tek DROP: `vehicle_odometer_spans` FONKSİYONU (051) — veri değil, kod;
--    yerine 052''nin `shift_odometer_spans`ı geliyor ve uygulama onu çağırıyor.
--  · Yazma yapan üç yer var, üçü de YENİ kolonları dolduruyor:
--      063/069 → geofences.category (yalnız varsayılanda kalmış satırlar)
--      072     → workers.fleet (araç atamasından ve son vardiyadan türetilir)
--    Mevcut hiçbir kolonun değeri EZİLMEZ.
--  · Telefon numaralarına DOKUNULMAZ: 075 bilerek dahil edilmedi (saf veri
--    onarımı; ayrı ve bilinçli bir karar olmalı — dosyanın sonundaki nota bakın).
--
--  ÇALIŞTIRMA
--  Supabase → SQL Editor → hepsini yapıştır → Run. Sakin bir saatte çalıştırın:
--  `lock_timeout` 20 sn''dir, canlı yazma trafiği kilidi tutarsa dosya kendini
--  düşürür ve HİÇBİR ŞEY uygulanmaz — tekrar çalıştırmak güvenlidir.
--
--  SONRASINDA
--    select count(*) from information_schema.tables
--     where table_schema='public' and table_type='BASE TABLE';
--    -- 48 bekleniyor: 47 (bugünkü şema) + telegram_link_codes.
--    --    Telegram temizliğini de çalıştırdıysanız 47 olur (dosya sonundaki not).
--    --    Bu kiracıda ölçülen taban 26 → 26 + 22 = 48.
--    select code, name from public.fleets;          -- bordo, mavi
--    select count(*) from public.document_types;    -- 0 (türleri panelden açarsınız)
--
--  ⚠️ Uygulama kodu ZATEN 078''i bekliyor ve eksik tabloları kademeli düşüşle
--  karşılıyor (tablo yoksa özellik sessizce kapalı). Yani bu dosya "önce kod,
--  sonra şema" sırasını bozmaz; hizalamadan sonra özellikler AÇILIR.
-- ═══════════════════════════════════════════════════════════════════════════
--  KAPSAM: 46 migration (044 → 091)
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════════
--  ÖN DENETİMLER — sorun varsa BURADA ve OKUNUR biçimde durur
-- ═══════════════════════════════════════════════════════════════════════════

-- Zaman aşımları: büyük tablolarda indeks kurulacak (device_telemetry).
-- lock_timeout kısa: canlı uygulamayı dakikalarca bekletmektense hızlı düş,
-- sakin bir saatte tekrar çalıştır.
set local statement_timeout = '15min';
set local lock_timeout = '20s';

do $on_denetim$
declare
  v_eksik text;
  v_kotu  text;
begin
  -- 1) BU DOSYA MEVCUT KURULUM İÇİNDİR. Boş veritabanında yanlış araç.
  select string_agg(t, ', ' order by t) into v_eksik
    from unnest(array['workers','vehicles','time_entries','device_telemetry']) t
   where not exists (
     select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
   );
  if v_eksik is not null then
    raise exception
      'DURDURULDU: temel tablolar yok (%). Bu dosya MEVCUT bir kurulumu 078''e çeker; SIFIRDAN kurulum için db/install/sendigo-full.sql kullanın.',
      v_eksik;
  end if;

  -- 2) 043 TABANI: 023 (vehicles.fleet) ve 019 (must_change_pin) burada mı?
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='vehicles' and column_name='fleet'
  ) then
    raise exception
      'DURDURULDU: vehicles.fleet yok — bu kurulum 023''ten eski. Hizalama 043 tabanı varsayar; önce eski migration''ları uygulayın.';
  end if;

  -- 3) 059 ÖN DENETİMİ — CHECK''ten FK''ye geçiş.
  --    fleets tablosunda yalnız 'bordo' ve 'mavi' olacak. Mevcut satırlarda
  --    başka bir kod varsa FK eklenemez ve işlem geri alınır.
  select string_agg(distinct fleet, ', ') into v_kotu
    from public.vehicles
   where fleet is not null and fleet not in ('bordo','mavi');
  if v_kotu is not null then
    raise exception
      'DURDURULDU (059): vehicles.fleet''te tanımsız filo kodu var: %. fleets tablosuna eklenecek kodlar yalnız bordo/mavi; önce bu satırları düzeltin.',
      v_kotu;
  end if;

  select string_agg(distinct managed_fleet, ', ') into v_kotu
    from public.workers
   where managed_fleet is not null and managed_fleet not in ('bordo','mavi');
  if v_kotu is not null then
    raise exception
      'DURDURULDU (059): workers.managed_fleet''te tanımsız filo kodu var: %.', v_kotu;
  end if;

  -- 4) 064 ÖN DENETİMİ — geofences.purpose kısıtı yeniden kurulacak.
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='geofences' and column_name='purpose'
  ) then
    select string_agg(distinct purpose, ', ') into v_kotu
      from public.geofences
     where purpose is not null and purpose not in ('rule','depot','customer');
    if v_kotu is not null then
      raise exception
        'DURDURULDU (064): geofences.purpose''ta izinli olmayan değer var: %. İzinli küme: rule/depot/customer.',
        v_kotu;
    end if;
  end if;

  raise notice 'Ön denetimler geçti — hizalama başlıyor.';
end
$on_denetim$;


-- ── KÖPRÜ KOLONLARI (migration DEĞİL) ──────────────────────────────────────
-- İkisi de `if not exists`: zaten varsa hiçbir şey olmaz.
-- KÖPRÜ 2, 063''ten ÖNCE gelmek ZORUNDA — 063 o kolona kısmi indeks kuruyor
-- ama kolonu 069 ekliyor (boş PostgreSQL 16''da ölçüldü: 063 patlıyor).

-- ═══════════════════════════════════════════════════════════════════════════
-- KÖPRÜ 1 — vehicles.tank_capacity_l   (migration DEĞİL, eksik DDL tamamlaması)
-- ═══════════════════════════════════════════════════════════════════════════
-- Bu kolon HİÇBİR migration dosyasında yaratılmıyor: canlı HAK61 veritabanına
-- 2026 ortasında Supabase SQL Editor'dan elle eklenmiş ve repoya hiç girmemiş.
-- Boş bir veritabanında yokluğu ZİNCİRİ KIRAR:
--   • 028_test_data_flag.sql → insert into public.vehicles (... tank_capacity_l ...)
--     "column tank_capacity_l of relation vehicles does not exist" → 028-040 çalışmaz.
--   • lib/reports.ts:630 → .select("id, plate, assigned_worker_id, tank_capacity_l")
--     yakıt raporu kolon hatası döndürür.
-- Tip/ölçek canlı HAK61 şemasından alındı (numeric, litre; NULL = bilinmiyor).
alter table public.vehicles
  add column if not exists tank_capacity_l numeric;

comment on column public.vehicles.tank_capacity_l is
  'Depo kapasitesi (litre). Yakıt raporunda yüzde→litre çevrimi için; NULL ise litre hesaplanmaz.';


-- ═══════════════════════════════════════════════════════════════════════════
-- KÖPRÜ 2 — geofences.archived_at   (migration DEĞİL, SIRA düzeltmesi)
-- ═══════════════════════════════════════════════════════════════════════════
-- 063_geofence_category.sql son adımında şu kısmi indeksi kuruyor:
--     create index ... on public.geofences (active) where archived_at is null;
-- ama kolonu KENDİSİ eklemiyor — daha eskisinin eklediğini varsayıyor. Kolonu
-- gerçekte 069 ekliyor, yani ALTI DOSYA SONRA.
--
-- ÖLÇÜLDÜ (24.08.2026, boş PostgreSQL 16 üzerinde): köprüsüz kurulum
--   "ERROR: column archived_at does not exist" ile 063'te DURUYOR.
-- Tüm dosya tek transaction olduğu için sonuç YARIM ŞEMA değil, HİÇ ŞEMA.
-- 069'un başlığındaki "kuvvetli şüphe" böylece ölçülmüş bir olgu oldu.
--
-- Kolon, geofences tablosunun yaratıldığı 015'in HEMEN ARDINDAN eklenir;
-- 069'daki `add column if not exists` sonra no-op'a döner ve sonuçtaki şema
-- canlı HAK61'inkiyle BİREBİR aynı kalır.
alter table public.geofences
  add column if not exists archived_at timestamptz;

comment on column public.geofences.archived_at is
  'Arşivlenme anı (NULL = etkin). 063 bu kolona kısmi indeks kuruyor, 069 ekliyor; kurulum dosyasında sıra düzeltildi.';



-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  044_mobile_token_version.sql                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 044 — MOBİL TOKEN İPTAL SAYACI
--
-- ⚠️ BU DOSYA HENÜZ ÇALIŞTIRILMADI. Volkan'ın Supabase SQL editöründe
--    çalıştırması bekleniyor (HAK61 ve Sendigo projelerinde ayrı ayrı).
--
-- NE İŞE YARAR
-- Mobil uygulama çerez kullanamadığı için /api/mobile/* uçları mühürlü token
-- ile çalışıyor (lib/mobile-auth.ts). Token durumsuz olduğu için, verildikten
-- sonra "bunu iptal et" demenin tek yolu sunucuda karşılaştırılacak bir sayaç
-- tutmaktır. Token mühürlenirken o anki token_version içine gömülür; her
-- istekte DB'deki değerle karşılaştırılır. Sayaç artınca o kişinin TÜM mobil
-- token'ları (access + refresh, her cihazda) anında ölür.
--
-- NEDEN AYRI TABLO DEĞİL
-- Oturum tablosu cihaz başına iptal ve denetim izi verirdi, ama büyüyen bir
-- tablo + temizlik politikası + rotasyon kodu getirirdi. Bu filoda kişi başına
-- tek cihaz var ve gerçek senaryolar (işten çıkış, pasife alma, PIN sıfırlama,
-- kayıp telefon) hesap ekseninde iptalle zaten karşılanıyor. Kararın tam
-- karşılaştırması ve bilinçli kabul edilen bedeli (tek cihazdan çıkış diğer
-- cihazları da düşürür) tasarım turunda verildi.
-- İleride cihaz yönetimi gerekirse token'a jti eklenip tablo YANINA konabilir;
-- bu kolon o zaman da geçerli kalır, kırıcı bir değişiklik olmaz.
--
-- SAYACI ARTIRAN DÖRT OLAY (kod tarafında bağlı):
--   • POST /api/mobile/auth/logout        → app/api/mobile/auth/logout/route.ts
--   • PIN değişimi (şoför kendi değiştirir) → app/actions/auth.ts changePinAction
--   • PIN sıfırlama (yönetici)             → app/actions/workers.ts setWorkerPinAction
--   • Aktif/pasif çevirme                  → app/actions/workers.ts toggleActiveAction
--   • İşten çıkarma                        → app/actions/workers.ts terminateWorkerAction
--
-- MIGRATION ÖNCESİ DAVRANIŞ (kod buna göre yazıldı, kırılmaz):
--   /login, /refresh, /me  → TAM ÇALIŞIR, sürüm denetimi atlanır
--   /logout                → 503 mobile_store_missing (sessizce başarılı SAYMAZ)
--   bumpTokenVersion(...)  → sessiz no-op, mevcut yönetici akışları etkilenmez
--
-- RLS: şemanın geri kalanıyla tutarlı olarak KAPALI — bu kolon yalnız
-- service-role istemcisi tarafından okunup yazılır (bkz. 012, 014, 019, 021).

alter table public.workers
  add column if not exists token_version integer not null default 0;

comment on column public.workers.token_version is
  'Mobil token iptal sayacı. Artınca o kişinin tüm mobil token''ları geçersizleşir. Tarayıcı oturum çerezini (hak_session) ETKİLEMEZ.';

-- İndeks GEREKMEZ: kolon her zaman workers.id (birincil anahtar) üzerinden
-- tek satır okunuyor, hiçbir sorguda filtre ya da sıralama anahtarı değil.

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  045_owner_security.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

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
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
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
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
-- =====================================================================
--  ÇALIŞTIRDIKTAN SONRA — owner'ı siz atarsınız
--
--    update public.workers set is_owner = true where phone = '+XXXXXXXXXXXX';
--
--  Doğrulama:
--    select name, phone, is_admin, is_owner from public.workers where is_owner;
--    select count(*) from public.login_sessions;   -- 0 (ilk girişte dolar)
--
--  ⚠️ Bu migration TEK BAŞINA hiçbir davranış değiştirmez. Katmanı açan şey
--     SECURITY_LAYER_ENABLED env'idir (lib/tenant.ts) ve VARSAYILANI false —
--     yani HAK61/Sendigo'da tablo yaratılsa bile hiçbir şey yazılmaz.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  046_access_gates.sql                                               ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

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
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
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
-- ═══ [birleştirici] HAK61'İN GİZLİ SORU HASH'İ ÇIKARILDI ═════════════════
-- Özgün 046, tabloyu kurduktan sonra HAK61'in cevabının bcrypt hash'ini de
-- yazıyordu. O satır BU MÜŞTERİYE AİT DEĞİLDİR: hash'i taşımak, HAK61'in
-- cevabını bilen birinin burada da ölü adam anahtarını açabilmesi demekti.
--
-- SATIRSIZ DAVRANIŞ GÜVENLİ: lib/kill-switch.ts verifySecret() satır yoksa
-- `false` döner (fail-closed) — anahtar AÇILAMAZ, sistem normal çalışır.
--
-- Kendi cevabınızı belirlemek için (düz metin hiçbir yere yazılmaz):
--   node -e "console.log(require('bcryptjs').hashSync('CEVABINIZ', 10))"
--   insert into public.kill_switch_secret (answer_hash) values ('<hash>');

-- NOT: RLS bu tabloların hepsinde KAPALI kalır — şemanın geri kalanıyla
-- tutarlı; yalnız service-role istemcisi okuyup yazıyor (bkz. 045).
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
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


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  047_pdf_fingerprints.sql                                           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 047 (PDF PARMAK İZİ)
-- =====================================================================
-- Üretilen her PDF'e gömülen benzersiz işaretin KAYIT DEFTERİ.
--
-- ── İŞARET NEDEN OPAK ────────────────────────────────────────────────
-- İşaretin içine "kim, ne zaman, hangi IP" yazmak CAZİPTİ ve YAPILMADI:
-- filigranlı bir PDF elden ele dolaşmak üzere üretiliyor ve o belge
-- kaybolduğunda içindeki kişisel veri de kaybolur. Bunun yerine işaret
-- ANLAMSIZ bir tekil dize; kim/ne zaman/hangi IP bilgisi YALNIZ bu tabloda
-- durur. Belge sızarsa sızan şey bir kimlik değil, bir numaradır — ve o
-- numara patron ekranında sorgulanınca kime ait olduğunu söyler.
--
-- ── NEDEN SUNUCUDA ÜRETİLİYOR ────────────────────────────────────────
-- PDF'ler TARAYICIDA üretiliyor (@react-pdf/renderer). İşaret de istemcide
-- üretilseydi kullanıcı kendi tarayıcısında başka bir değer koyabilir ya da
-- hiç koymayabilirdi. Bu yüzden işaret bir SUNUCU ACTION'ında üretilip
-- BURAYA yazılıyor, sonra istemciye veriliyor. İstemci onu belgeden
-- silebilir — ama silmesi indirmenin KAYDINI silmez: satır burada durur.
--
-- Tekrar çalıştırılabilir (idempotent). Supabase SQL Editor'da çalıştırın.
-- ⚠️ 045 gerekir (audit_log / is_owner ile aynı katmanın parçası).
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
create table if not exists public.pdf_fingerprints (
  id           uuid primary key default gen_random_uuid(),
  worker_id    uuid references public.workers(id) on delete set null,
  at           timestamptz not null default now(),
  ip           text,
  -- 'azg' | 'co2' | 'fuel' | 'performance' | 'shift' (lib/pdf-fingerprint.ts)
  report_type  text not null,
  -- Belgeye gömülen dize. Biçim: HAK-XXXX-XXXX-XXXX (Crockford base32).
  fingerprint  text not null
);

-- Sorgulama ekranının ANA ERİŞİMİ: yapıştırılan işaretle tek satır bulunur.
-- Tekil: aynı işaret iki belgeye verilemez (çakışma olursa yazma patlar ve
-- sessizce ikinci bir sahip doğmaz).
create unique index if not exists idx_pdf_fingerprints_value
  on public.pdf_fingerprints(fingerprint);

-- "Bu kişi neler indirdi" listesi.
create index if not exists idx_pdf_fingerprints_worker_time
  on public.pdf_fingerprints(worker_id, at desc);

create index if not exists idx_pdf_fingerprints_time
  on public.pdf_fingerprints(at desc);

-- NOT: RLS KAPALI kalır — şemanın geri kalanıyla tutarlı; yalnız service-role
-- istemcisi okuyup yazıyor (bkz. 045/046).
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
-- =====================================================================
--  ÇALIŞTIRDIKTAN SONRA
--    select count(*) from public.pdf_fingerprints;   -- 0
--
--  Bir işareti elle sorgulamak (patron ekranı bunu yapıyor):
--    select w.name, f.at, f.ip, f.report_type
--      from public.pdf_fingerprints f
--      left join public.workers w on w.id = f.worker_id
--     where f.fingerprint = 'HAK-XXXX-XXXX-XXXX';
--
--  ⚠️ Bu migration TEK BAŞINA hiçbir davranış değiştirmez. Parmak izini açan
--     şey SECURITY_LAYER_ENABLED (sunucu) + NEXT_PUBLIC_SECURITY_LAYER_ENABLED
--     (istemci) bayraklarıdır; ikisi de HAK61/Sendigo'da tanımsız.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  048_gate_exempt.sql                                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 048 (ERİŞİM KAPILARI MUAFİYETİ)
-- =====================================================================
-- Tek kolon: workers.gate_exempt
--
-- ── NEDEN KOLON, NEDEN TELEFON NUMARASI DEĞİL ────────────────────────
-- Muafiyeti bir telefon numarasına gömmek (kodda ya da env'de) üç şeyi
-- birden bozardı: numara değişince muafiyet sessizce kaybolur, kimin
-- neden muaf olduğu hiçbir yerde görünmez, ve muafiyeti kaldırmak için
-- kod değişikliği + deploy gerekir. Kolon, patron ekranından açılıp
-- kapanabilen ve audit_log'a düşen bir VERİ kararıdır.
--
-- Aynı gerekçe 029 (managed_fleet) ve 045 (is_owner) için de geçerliydi:
-- bu depoda rol ve muafiyet HER ZAMAN tek nullable/boolean kolon + kod
-- tarafında bir kapı olarak yaşar. Yeni rol TABLOSU yok.
--
-- ── NEYDEN MUAF, NEYDEN DEĞİL ────────────────────────────────────────
-- MUAF   : cihaz onayı (046 kapı 1) · ülke onayı (kapı 2) · saat kilidi (kapı 3)
-- MUAF DEĞİL: ÖLÜ ADAM ANAHTARI (kapı 4).
--
-- Bu ayrım anahtarın anlamıdır: "sistemi kapat" dendiğinde patron DIŞINDA
-- herkesin düşmesi gerekiyor. Muafiyet bunu delseydi anahtar, kapattığını
-- sandığın ama iki kişinin içeride kaldığı bir düğmeye dönerdi — yani acil
-- durum aracı olmaktan çıkardı.
--
-- ⚠️ MUAFİYET GÖRÜNÜRLÜK VERMEZ. gate_exempt=true olan biri hâlâ:
--    • /admin/guvenlik'i AÇAMAZ (requireOwner, is_owner ister)
--    • patronu personel listelerinde GÖREMEZ (045 görünmezliği ayrı eksen)
--    İki kavram bilerek ayrı: biri "kapıdan geç", diğeri "kademe".
--
-- Tekrar çalıştırılabilir (idempotent). Supabase SQL Editor'da çalıştırın.
-- ⚠️ 045 + 046 gerekir.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
alter table public.workers
  add column if not exists gate_exempt boolean not null default false;

comment on column public.workers.gate_exempt is
  'Erişim kapılarından muaf (048): cihaz onayı, ülke onayı ve saat kilidi '
  'uygulanmaz. ÖLÜ ADAM ANAHTARI bundan etkilenmez — orada tek istisna '
  'is_owner. Görünürlük/yetki VERMEZ.';

-- Muaf sayısı tipik olarak 1-2; kısmi indeks tam da bu dağılım için.
create index if not exists idx_workers_gate_exempt
  on public.workers(id)
  where gate_exempt;
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
-- =====================================================================
--  ÇALIŞTIRDIKTAN SONRA — muafiyeti siz atarsınız
--
--    update public.workers set gate_exempt = true where phone = '+XXXXXXXXXXXX';
--
--  Doğrulama:
--    select name, phone, is_admin, is_owner, gate_exempt
--      from public.workers where gate_exempt or is_owner;
--
--  Panelden de yapılabilir: /admin/guvenlik → "Erişim kuralları" sekmesi,
--  kişi satırındaki "Kapılardan muaf" düğmesi. Oradan yapılan değişiklik
--  audit_log'a eski/yeni değeriyle düşer; SQL'le yapılan düşmez.
--
--  ⚠️ Bu migration TEK BAŞINA hiçbir davranış değiştirmez: kolon varsayılanı
--     false ve kapıları açan şey ACCESS_GATES_ENABLED env'idir.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  049_fuel_report_index.sql                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 049_fuel_report_index.sql — YAKIT RAPORU ZAMAN AŞIMI (57014)
--
-- SORUN (canlıda ölçüldü 09.08.2026, HAK61 üretim):
--   /admin/raporlar/yakit → report_fuel_stats soğuk cache'te 8,2 sn sonra
--   57014 (statement timeout) → sayfa available:false basıyor. Ödeyen müşteri
--   raporu hiç göremiyor.
--
-- TEŞHİS — süre ARALIKTAN BAĞIMSIZ, yani indeks HİÇ kullanılmıyor:
--     7 gün  : 7.037 ms (soğuk) / 2.239 ms (sıcak)
--    30 gün  : 7.861 ms / 6.930 ms
--   tüm zaman: 6.905 ms / 6.841 ms
--   Aralığı 4 katına çıkarmak süreyi değiştirmiyor → 1.038.145 satırlık
--   SEQ SCAN. Sayfanın VARSAYILAN aralığı "hafta" (raporlar/yakit/page.tsx:26),
--   yani her normal açılış bu 7 saniyeyi ödüyor ve yük altında tavanı aşıyor.
--
-- NEDEN indeks yok: device_telemetry'deki üç indeksin ÜÇÜ DE recorded_at'i
-- İKİNCİ kolonda tutuyor —
--   014: (vehicle_id, recorded_at) unique
--   014: (flespi_device_id, recorded_at desc)
--   039: (vehicle_id, recorded_at) where fuel_volume_l is not null
-- Rapor fonksiyonları ise ARAÇ FİLTRESİ OLMADAN yalnız recorded_at aralığı +
-- "yakıt alanı dolu" ile süzüyor (026/027 satır 60-63, 039 satır 78-81).
-- recorded_at baştaki kolon olmadığı için hiçbiri aralık taramasına hizmet
-- edemiyor.
--
-- ÇÖZÜM: recorded_at BAŞTA olan kısmi + kapsayan (covering) indeks.
--   • kısmi (where ... is not null) → yalnız yakıt okuması olan satırlar
--     (fuel_level_pct: 687.111/1.038.145 = %66; fuel_volume_l: 273.692 = %26)
--   • include(...) → fonksiyonun okuduğu her kolon indekste, heap'e hiç
--     gidilmiyor (index-only scan)
--   • recorded_at başta → 7 günlük rapor 7 günlük veriyi tarar, tabloyu değil.
--     Asıl kazanç bu: tablo büyüdükçe rapor YAVAŞLAMAZ.
--
-- 039'un kendi indeksi (vehicle_id başta) DURUYOR — düşürmüyoruz: pencere
-- fonksiyonunun partition by vehicle_id sıralamasına hâlâ hizmet edebilir ve
-- düşürmek geri alınamaz bir risk olurdu. Maliyeti yalnız disk.
--
-- Additive + idempotent. Uygulanmazsa davranış bugünkü hâliyle aynı kalır.
--
-- ⚠️ CANLIDA KESİNTİSİZ İSTENİRSE: aşağıdaki iki create index'i
--    `create index concurrently if not exists ...` olarak, HER BİRİNİ AYRI
--    çalıştırın (CONCURRENTLY transaction bloğu içinde çalışmaz). Bu dosyadaki
--    düz sürüm ~2-5 sn ACCESS EXCLUSIVE kilidi alır; flespi sync upsert'i
--    idempotent olduğu için o pencerede kaçan tur bir sonraki turda kapanır.

-- YÜZDE hattı — report_fuel_stats (migration 026 + 027).
create index if not exists idx_device_telemetry_fuel_pct_time
  on public.device_telemetry (recorded_at)
  include (vehicle_id, fuel_level_pct, odometer_km)
  where fuel_level_pct is not null;

-- LİTRE hattı — report_fuel_volume_stats (migration 039). Aynı kusur: 039'un
-- indeksi vehicle_id ile başlıyor, fonksiyon ise yalnız recorded_at süzüyor.
create index if not exists idx_device_telemetry_fuel_volume_time
  on public.device_telemetry (recorded_at)
  include (vehicle_id, fuel_volume_l, odometer_km)
  where fuel_volume_l is not null;

analyze public.device_telemetry;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  050_report_perf.sql                                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 050_report_perf.sql — RAPOR HIZLANDIRMA (iki fonksiyon, şema değişikliği yok)
--
-- İki ayrı darboğaz, ikisi de canlıda ölçüldü (09.08.2026, HAK61 üretim):
--
--  1) /admin/raporlar/yakit 30 GÜN → 8.277 ms → 57014 statement timeout.
--     049'daki indeks DEVREYE GİRDİ (süre artık aralıkla ölçekleniyor:
--     1 gün 429 ms, 7 gün 3.714 ms, 30 gün timeout) ama 30 günde ~690 bin
--     satır üstünde İKİ pencere fonksiyonu (max() over rows 30 preceding/
--     following) + lag + iki array_agg dönüyor. Bu CPU/sort maliyeti, indeksin
--     çözebileceği bir şey DEĞİL. Çözüm: aynı işi araç araç yap — her araç
--     ~1/29 veri görür, pencere fonksiyonları küçük partition'larda koşar,
--     ve 29 çağrı PARALEL gider.
--
--  2) /admin/analiz 6,4 sn'nin 5.485 ms'i getVehicleDistanceSpan'in 58 ARDIŞIK
--     sorgusu (29 araç × asc+desc limit 1). Veri hacmi değil ROUND-TRIP sayısı:
--     her sorgu ~95 ms ağ gidiş-dönüşü, dönen veri 1 satır. Çözüm: tek
--     DISTINCT ON sorgusu.
--
-- Additive + idempotent. Uygulanmazsa uygulama eski yoluna düşer (kod her iki
-- fonksiyonu da PGRST202'de yakalayıp mevcut davranışa geri döner).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) TEK ARAÇ İÇİN YAKIT İSTATİSTİĞİ
--
-- Gövde 027'deki report_fuel_stats ile BİREBİR AYNI (de-glitch → adım →
-- toplulaştırma, eşikler 10 puan). TEK fark: `p_vehicle_id` filtresi. İki
-- fonksiyon aynı sayıyı üretmek ZORUNDA — biri diğerinin araç-kırpılmış hâli.
-- Mantık değişirse İKİSİ BİRDEN değişmeli (027'nin gövdesi tek doğruluk kaynağı).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.report_fuel_stats_vehicle(
  p_from       timestamptz,
  p_to         timestamptz,
  p_vehicle_id uuid
)
returns table (
  vehicle_id   uuid,
  sample_count bigint,
  avg_pct      double precision,
  min_pct      double precision,
  max_pct      double precision,
  first_pct    double precision,
  last_pct     double precision,
  refill_count bigint,
  refill_pct   double precision,
  drop_count   bigint,
  drop_pct     double precision
)
language sql
stable
as $$
  with base as (
    select
      dt.vehicle_id,
      dt.recorded_at,
      dt.fuel_level_pct::double precision as fuel,
      dt.odometer_km::double precision    as odo
    from public.device_telemetry dt
    where dt.vehicle_id = p_vehicle_id
      and dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.fuel_level_pct is not null
  ),
  numbered as (
    select b.*,
           row_number() over (order by b.recorded_at) as rn,
           count(*) over ()                           as cnt
    from base b
  ),
  bounded as (
    select
      n.*,
      max(n.fuel) over (order by n.recorded_at rows between 30 preceding and current row) as bwd_max,
      max(n.fuel) over (order by n.recorded_at rows between current row and 30 following) as fwd_max
    from numbered n
  ),
  clean as (
    -- UÇ SATIR KURALI (027): ilk satırda geriye, son satırda ileriye pencere
    -- YOKTUR; tek yönlü kanıt yeterli sayılır, yoksa gerçek dolum kırpılırdı.
    select vehicle_id, recorded_at, fuel, odo
    from bounded
    where not (
      case
        when rn = 1   then fwd_max - fuel >= 10
        when rn = cnt then bwd_max - fuel >= 10
        else bwd_max - fuel >= 10 and fwd_max - fuel >= 10
      end
    )
  ),
  stepped as (
    select c.*,
           lag(c.fuel) over w as prev_fuel,
           lag(c.odo)  over w as prev_odo
    from clean c
    window w as (order by c.recorded_at)
  )
  select
    p_vehicle_id                                    as vehicle_id,
    count(*)::bigint                                as sample_count,
    avg(fuel)                                       as avg_pct,
    min(fuel)                                       as min_pct,
    max(fuel)                                       as max_pct,
    (array_agg(fuel order by recorded_at asc))[1]   as first_pct,
    (array_agg(fuel order by recorded_at desc))[1]  as last_pct,
    count(*) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 10
    )::bigint                                       as refill_count,
    coalesce(sum(fuel - prev_fuel) filter (
      where prev_fuel is not null and fuel - prev_fuel >= 10
    ), 0)                                           as refill_pct,
    count(*) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 10
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    )::bigint                                       as drop_count,
    coalesce(sum(prev_fuel - fuel) filter (
      where prev_fuel is not null and prev_fuel - fuel >= 10
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    ), 0)                                           as drop_pct
  from stepped
  having count(*) > 0;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) TÜM ARAÇLARIN ODOMETRE UÇ NOKTALARI — TEK SORGUDA
--
-- getVehicleDistanceSpan'in 58 ardışık sorgusunun yerine geçer. km-guard'ı
-- (negatif fark, MAX_PLAUSIBLE_KM_PER_DAY = 800 km/gün) BURADA UYGULAMAZ:
-- kural JS tarafında (lib/analytics.ts:352-358) yaşamaya devam eder ki tek
-- doğruluk kaynağı bölünmesin. Bu fonksiyon yalnız UÇ NOKTALARI getirir.
--
-- `distinct on (vehicle_id)` iki kez: bir asc bir desc. Her ikisi de
-- (vehicle_id, recorded_at) indeksinden gider — 049'un eklediği kısmi indeks
-- burada gerekmez, 014'teki unique indeks yeterli.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.vehicle_odometer_spans(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  vehicle_id uuid,
  first_km   double precision,
  first_at   timestamptz,
  last_km    double precision,
  last_at    timestamptz
)
language sql
stable
as $$
  with f as (
    select distinct on (dt.vehicle_id)
           dt.vehicle_id,
           dt.odometer_km::double precision as km,
           dt.recorded_at
    from public.device_telemetry dt
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.odometer_km is not null
    order by dt.vehicle_id, dt.recorded_at asc
  ),
  l as (
    select distinct on (dt.vehicle_id)
           dt.vehicle_id,
           dt.odometer_km::double precision as km,
           dt.recorded_at
    from public.device_telemetry dt
    where dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.odometer_km is not null
    order by dt.vehicle_id, dt.recorded_at desc
  )
  select f.vehicle_id, f.km, f.recorded_at, l.km, l.recorded_at
  from f join l on l.vehicle_id = f.vehicle_id;
$$;

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  051_drop_odometer_spans.sql                                        ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 051_drop_odometer_spans.sql — 050'DEKİ İKİNCİ FONKSİYONU GERİ ÇEK
--
-- `vehicle_odometer_spans` (migration 050) YANLIŞ BİR TEŞHİSE dayanıyordu ve
-- canlıda ölçüldüğünde hem GEREKSİZ hem ZARARLI çıktı. İkisi de 09.08.2026'da
-- HAK61 üretiminde ölçüldü:
--
--  1) GEREKSİZ. "Analiz sayfasındaki 58 ardışık sorgu 5.485 ms sürüyor" bulgusu
--     HATALIYDI: o rakam benim SIRALI test döngümün maliyetiydi, ürün kodunun
--     değil. Gerçek kod zaten tam paralel —
--       • lib/analytics.ts:324  getVehicleDistanceSpan içinde Promise.all([asc, desc])
--       • app/admin/analiz/page.tsx:64  Promise.all(vehicles.map(...))
--     Aynı 58 sorgu paralel atıldığında ÖLÇÜLEN süre: 1.010 ms (soğuk) /
--     286 ms (sıcak). Hedef "< 1 sn" zaten karşılanıyordu; ortada çözülecek
--     bir N+1 yoktu.
--
--  2) ZARARLI. Fonksiyonun kendisi 30 günlük aralıkta 8.333 ms sonra 57014
--     (statement timeout) veriyor — yani çağrılsaydı çalışan bir yolu BOZARDI.
--     Sebep: `distinct on (vehicle_id) ... order by vehicle_id, recorded_at`
--     iki kez, `odometer_km is not null` süzgeciyle. Bu şekil (vehicle_id,
--     recorded_at) indeksinden gidemiyor; aralıktaki tüm satırları sıralıyor.
--     Doğru şekli `vehicles`e LATERAL join + araç başına limit 1 olurdu — ama
--     madde 1 yüzünden buna İHTİYAÇ YOK, o yüzden yazmıyoruz: kullanılmayan
--     ikinci bir kod yolu ileride yanlışlıkla benimsenecek bir tuzaktır.
--
-- 050'nin BİRİNCİ fonksiyonu (report_fuel_stats_vehicle) DURUYOR ve canlıda
-- kullanılıyor: 30 günlük yakıt raporu 8,3 sn timeout → 6,0 sn / 29 araç.
--
-- Idempotent. Fonksiyon hiç uygulanmadıysa da sorunsuz geçer.

drop function if exists public.vehicle_odometer_spans(timestamptz, timestamptz);

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  052_shift_distance_and_refill_merge.sql                            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 052 — VARDİYA PENCERELİ KM + DOLUM BİRLEŞTİRME
--
-- İki ayrı doğruluk kusuru, ikisi de 09.08.2026'da canlıda ölçüldü.
--
-- ═══ 1) shift_odometer_spans — KM ARTIK VARDİYADAN, ARALIKTAN DEĞİL ═══
--
-- Kusur: getVehicleDistanceSpan aracın km'sini ARALIĞIN uçlarından ölçüyor.
-- Şoför o aracı 1 gün sürmüş olsa bile aracın 30 GÜNLÜK km'si ona yazılıyordu:
--     Mustafa Karakoç   809 km / 1 çalışılan gün
--     Ekrem Gyuler    1.163 km / 3 gün  (işten çıkmış)
--     Bayram Çöymen     917 km / 3 gün  (işten çıkmış)
-- Şişirilmiş km → düşük ceza/1000km → ŞİŞİRİLMİŞ SKOR. Puan eşiği çalışılan
-- güne çekilince (adc04df) bu uyuşmazlık daha da büyüdü, o yüzden o değişiklik
-- bayrakla kapatıldı ve buranın düzelmesi bekleniyor.
--
-- Neden SQL: JS'te vardiya başına 2 sorgu = 373 vardiya × 2 = 746 istek.
-- ÖLÇÜLDÜ: paralel bile 26.926 ms / 38.786 ms. Kabul edilemez. Buradaki iki
-- LATERAL, araç başına (vehicle_id, recorded_at) indeksine tek seek yapar;
-- 373 vardiya tek sorguda, tek gidiş-dönüşte döner.
--
-- KM-GUARD BURADA UYGULANMAZ. Ham uç noktalar döner, guard (negatif fark +
-- MAX_PLAUSIBLE_KM_PER_DAY = 800 km/gün) lib/analytics.ts'te kalır — tek
-- doğruluk kaynağı bölünmesin. Bu fonksiyon yalnız "hangi vardiyada odometre
-- nereden nereye gitti" sorusunu cevaplar.
--
-- AÇIK VARDİYA: ended_at null ise pencere p_to'da kapanır.
-- ARALIKLA KESİŞEN her vardiya döner (başlangıcı aralıktan önce olsa bile),
-- böylece gece yarısını aşan / devreden vardiya kaybolmaz.

create or replace function public.shift_odometer_spans(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  time_entry_id uuid,
  worker_id     uuid,
  vehicle_id    uuid,
  started_at    timestamptz,
  ended_at      timestamptz,
  first_km      double precision,
  last_km       double precision
)
language sql
stable
as $$
  select
    te.id,
    te.worker_id,
    te.vehicle_id,
    te.started_at,
    te.ended_at,
    f.km,
    l.km
  from public.time_entries te
  left join lateral (
    select dt.odometer_km::double precision as km
    from public.device_telemetry dt
    where dt.vehicle_id = te.vehicle_id
      and dt.odometer_km is not null
      and dt.recorded_at >= te.started_at
      and dt.recorded_at <= coalesce(te.ended_at, p_to)
    order by dt.recorded_at asc
    limit 1
  ) f on true
  left join lateral (
    select dt.odometer_km::double precision as km
    from public.device_telemetry dt
    where dt.vehicle_id = te.vehicle_id
      and dt.odometer_km is not null
      and dt.recorded_at >= te.started_at
      and dt.recorded_at <= coalesce(te.ended_at, p_to)
    order by dt.recorded_at desc
    limit 1
  ) l on true
  where te.vehicle_id is not null
    and te.worker_id is not null
    and te.started_at <= p_to
    and (te.ended_at is null or te.ended_at >= p_from);
$$;

-- ═══ 2) report_fuel_stats_vehicle — DOLUM BİRLEŞTİRME ═══
--
-- Kusur: tek fiziksel dolum ardışık okumalara bölününce her parça ayrı dolum
-- sayılıyordu. ÖLÇÜLDÜ (7 gün, canlı): gerçek 16 dolum serisine karşılık
-- sistem 19 adım saymış. Örnek — DO-719GV, 70 L, 06.08:
--     06:53:18  %18
--     06:54:20  %33  (+15 puan)  ← ayrı dolum sayılıyordu
--     06:56:36  %100 (+67 puan)  ← ayrı dolum sayılıyordu
--   toplam +82 puan = 57 L, tek fiziksel dolum.
--
-- ÇÖZÜM: ardışık YÜKSELİŞLER, aralarında MERGE_GAP'ten uzun boşluk yoksa TEK
-- dolum sayılır ve puanları toplanır. 15 dakika: ölçülen dolum içi adım aralığı
-- 1-3 dakika, iki AYRI dolum arasındaki en kısa mesafe ise saatler — 15 dk ikisi
-- arasında geniş bir güvenlik payı bırakıyor.
--
-- EŞİK 10 → 5 PUAN. Birleştirmeden ÖNCE 10 puan gerekliydi çünkü eşik hem
-- "gürültüyü ele" hem "dolumu yakala" işini birden yapıyordu. Artık gürültüyü
-- birleştirme+seri toplamı eliyor, eşik yalnız "bu seri gerçek bir dolum mu"
-- sorusunu cevaplıyor. ÖLÇÜLDÜ: 10 puanlık eşik DO-623GL'de gerçek bir dolumun
-- 7 puanlık ilk parçasını (4 L) düşürüyordu. 5 puan (~3,5 L) hâlâ sensör
-- gürültüsünün (1 puan = 0,7 L) çok üstünde.
--
-- Düşüş (drop) tarafı DEĞİŞMEDİ: 10 puan + odometre durağan şartı aynen duruyor.
-- Şüpheli düşüş bir HIRSIZLIK sinyali; onu gevşetmek yanlış alarm üretirdi.

create or replace function public.report_fuel_stats_vehicle(
  p_from       timestamptz,
  p_to         timestamptz,
  p_vehicle_id uuid
)
returns table (
  vehicle_id   uuid,
  sample_count bigint,
  avg_pct      double precision,
  min_pct      double precision,
  max_pct      double precision,
  first_pct    double precision,
  last_pct     double precision,
  refill_count bigint,
  refill_pct   double precision,
  drop_count   bigint,
  drop_pct     double precision
)
language sql
stable
as $$
  with base as (
    select
      dt.recorded_at,
      dt.fuel_level_pct::double precision as fuel,
      dt.odometer_km::double precision    as odo
    from public.device_telemetry dt
    where dt.vehicle_id = p_vehicle_id
      and dt.recorded_at >= p_from
      and dt.recorded_at <= p_to
      and dt.fuel_level_pct is not null
  ),
  numbered as (
    select b.*,
           row_number() over (order by b.recorded_at) as rn,
           count(*) over ()                           as cnt
    from base b
  ),
  bounded as (
    select
      n.*,
      max(n.fuel) over (order by n.recorded_at rows between 30 preceding and current row) as bwd_max,
      max(n.fuel) over (order by n.recorded_at rows between current row and 30 following) as fwd_max
    from numbered n
  ),
  clean as (
    -- UÇ SATIR KURALI (027): ilk satırda geriye, son satırda ileriye pencere yok.
    select recorded_at, fuel, odo
    from bounded
    where not (
      case
        when rn = 1   then fwd_max - fuel >= 10
        when rn = cnt then bwd_max - fuel >= 10
        else bwd_max - fuel >= 10 and fwd_max - fuel >= 10
      end
    )
  ),
  stepped as (
    select c.*,
           lag(c.fuel)        over w as prev_fuel,
           lag(c.odo)         over w as prev_odo,
           lag(c.recorded_at) over w as prev_at
    from clean c
    window w as (order by c.recorded_at)
  ),
  marked as (
    -- YENİ SERİ BAŞLANGICI: yükseliş değilse, ya da önceki okumadan 15 dk'dan
    -- uzun süre geçmişse. Bu bayrağın kümülatif toplamı seri kimliğidir.
    select s.*,
           case
             when s.prev_fuel is null then 1
             when s.fuel - s.prev_fuel <= 0 then 1
             when s.recorded_at - s.prev_at > interval '15 minutes' then 1
             else 0
           end as new_run
    from stepped s
  ),
  runs as (
    select m.*, sum(m.new_run) over (order by m.recorded_at) as run_id
    from marked m
  ),
  rises as (
    -- Seri başına toplam yükseliş. Yalnız POZİTİF adımlar toplanır: seriyi
    -- açan satırın kendisi yükseliş olmayabilir (new_run=1 iken).
    select run_id,
           sum(greatest(fuel - coalesce(prev_fuel, fuel), 0)) as total_rise
    from runs
    group by run_id
  )
  select
    p_vehicle_id                                    as vehicle_id,
    (select count(*) from clean)::bigint            as sample_count,
    (select avg(fuel) from clean)                   as avg_pct,
    (select min(fuel) from clean)                   as min_pct,
    (select max(fuel) from clean)                   as max_pct,
    (select fuel from clean order by recorded_at asc  limit 1) as first_pct,
    (select fuel from clean order by recorded_at desc limit 1) as last_pct,
    (select count(*) from rises where total_rise >= 5)::bigint as refill_count,
    (select coalesce(sum(total_rise), 0) from rises where total_rise >= 5) as refill_pct,
    (select count(*) from stepped
      where prev_fuel is not null and prev_fuel - fuel >= 10
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    )::bigint                                       as drop_count,
    (select coalesce(sum(prev_fuel - fuel), 0) from stepped
      where prev_fuel is not null and prev_fuel - fuel >= 10
        and prev_odo is not null and odo is not null and odo - prev_odo < 1
    )                                               as drop_pct
  where exists (select 1 from clean);
$$;

notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  053_covering_indexes.sql                                           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 053 — SOĞUK CACHE ZAMAN AŞIMI: ARAÇ EKSENLİ KAPSAYAN İNDEKSLER
--
-- ═══ NEDEN (canlıda ölçüldü, 09.08.2026, HAK61 üretim) ═══
--
-- İki fonksiyon da soğukta statement timeout (57014) alıyor, SICAKTA almıyor:
--
--   shift_odometer_spans (30 gün)   1. çağrı 8.290 ms → 57014
--                                   2. çağrı 1.198 ms → 373 vardiya
--   report_fuel_stats_vehicle       soğuk turda 30 aracın 12'si 57014
--                                   sıcak turda 30/30, 5.512 ms
--
-- 7 katlık soğuk/sıcak farkı CPU değil DİSK imzasıdır. Aynı sorgu, aynı satır,
-- aynı plan — tek fark sayfaların bellekte olup olmaması.
--
-- ═══ SEBEP: OKUNAN KOLONLAR HİÇBİR İNDEKSTE YOK ═══
--
-- Bugünkü device_telemetry indeksleri:
--   014  (vehicle_id, recorded_at) unique                    — INCLUDE YOK
--   014  (flespi_device_id, recorded_at desc)
--   039  (vehicle_id, recorded_at) where fuel_volume_l is not null
--   049  (recorded_at) include(vehicle_id, fuel_level_pct, odometer_km)
--          where fuel_level_pct is not null                  — recorded_at BAŞTA
--
-- İki fonksiyon da ARAÇ + ZAMAN süzüp odometer_km / fuel_level_pct OKUYOR.
-- Araç-eksenli tek indeks 014 ve o hiçbir veri kolonu taşımıyor → eşleşen her
-- satır için HEAP'e gitmek zorunlu. shift_odometer_spans'ın iki LATERAL'i
-- 373 vardiya × 2 = 746 ayrı seek yapar; soğukta 746 rastgele disk okuması
-- ≈ 8 sn. Ölçülen sayı tam olarak bu.
--
-- 049 bu iki fonksiyonu KURTARMAZ: recorded_at başta olduğu için araç-eksenli
-- erişimde ya kullanılamaz ya da aralığın TÜM filo satırını (687.111) tarayıp
-- vehicle_id'yi INCLUDE'dan süzmek zorunda kalır.
--
-- ═══ ÇÖZÜM ═══
--
-- 039'un LİTRE hattı için yaptığının aynısını yüzde ve odometre hatları için
-- yapmak: araç-eksenli KISMİ + KAPSAYAN indeks. Böylece ilgili taramalar
-- index-only olur, heap'e hiç gidilmez, soğuk turda rastgele disk okuması
-- ortadan kalkar.
--
-- Kısmi (where ... is not null) çünkü fonksiyonlar zaten yalnız dolu satırla
-- ilgileniyor: odometer_km 1.038.145 satırın bir kısmında, fuel_level_pct
-- 687.111'inde dolu. Kısmi indeks hem küçük hem tam olarak sorgunun süzgeciyle
-- örtüşüyor.
--
-- ⚠️ BU MIGRATION UYGULANMASA DA KOD DOĞRU ÇALIŞIR: uygulama tarafında
-- eşzamanlılık tavanı (lib/db-fanout.ts, mapBounded=6) ve zaman aşımında tek
-- seferlik tekrar (retryOnTimeout) zaten devrede. Bu indeksler o iki muhafızın
-- YERİNE değil, ALTINA konur — muhafızlar kusuru yönetir, indeks kusuru
-- kaynağında keser.
--
-- ⚠️ CANLIDA KESİNTİSİZ İSTENİRSE: her create index'i `concurrently` ile ve
-- AYRI çalıştırın (CONCURRENTLY transaction bloğunda çalışmaz). Düz sürüm
-- ~3-8 sn ACCESS EXCLUSIVE kilidi alır; flespi sync upsert'i idempotent olduğu
-- için o pencerede kaçan tur bir sonraki turda kapanır.
--
-- Additive + idempotent. Hiçbir veri değişmez, hiçbir fonksiyon değişmez.

-- ── 1) ODOMETRE HATTI — shift_odometer_spans + getVehicleDistanceSpan ────────
-- Fonksiyon (vehicle_id, recorded_at) ile seek edip odometer_km okuyor.
-- INCLUDE ile bu tek seek index-only olur.
create index if not exists idx_device_telemetry_vehicle_odo
  on public.device_telemetry (vehicle_id, recorded_at)
  include (odometer_km)
  where odometer_km is not null;

-- ── 2) YÜZDE HATTI — report_fuel_stats_vehicle ──────────────────────────────
-- 049'un araç-eksenli ikizi. 049 DURUYOR: araç filtresi OLMAYAN eski
-- report_fuel_stats'a hâlâ hizmet ediyor (Sendigo/demo geri düşüş yolu).
create index if not exists idx_device_telemetry_vehicle_fuel_pct
  on public.device_telemetry (vehicle_id, recorded_at)
  include (fuel_level_pct, odometer_km)
  where fuel_level_pct is not null;

analyze public.device_telemetry;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  055_vehicle_device_model.sql                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 055_vehicle_device_model.sql — TAKİP CİHAZININ ADI (künye satırı)
--
-- ⚠️ BU DOSYA CLAUDE TARAFINDAN ÇALIŞTIRILMADI. Volkan Supabase SQL editöründe
-- kendisi çalıştırır. Uç tarafı kolon olsa da olmasa da çalışır (aşağıya bak).
--
-- ── NE İÇİN ────────────────────────────────────────────────────────────────
-- Mobil araç künyesindeki "Takip cihazı" satırı bugün ÜRETİLEMİYOR:
--   flespi_device_id → bir sayı (ör. 6237914), cihaz adı değil
--   imei             → bir seri numarası
--   vin              → aracın şasi numarası, cihazla ilgisi yok
-- Cihaz modeli ("Teltonika FMC003") depoda YALNIZ kod yorumlarında geçiyor —
-- veri olarak hiçbir tabloda durmuyor (10.08.2026 ölçümü: `vehicles.device_model`
-- kolonu YOK, hata 42703). Referans tasarımdaki "Galzura Tracker GT-4" satırı
-- bu yüzden uydurma olurdu.
--
-- ── NEDEN KOLON, NEDEN SABİT DEĞİL ─────────────────────────────────────────
-- Filodaki her cihaz aynı model DEĞİL (26 cihaza FMC003 kurulum komutu basıldı,
-- toplam 29 cihazlı araç var). Kodda tek bir sabit yazmak üç aracı yanlış
-- etiketlerdi ve yanlış olduğu hiçbir yerden anlaşılmazdı. Doğru yer kayıt
-- bazında bir alandır.
--
-- ── GERİYE DÖNÜK ETKİ YOK ──────────────────────────────────────────────────
-- Additive ve nullable: hiçbir sorgu, hiçbir sayı, hiçbir ekran değişmez.
-- Kolon eklendiği anda `getVehicleDetail`in `select("*")`i onu getirmeye başlar
-- ve `/api/mobile/vehicles/[id]` → `cihaz.ad` doldurulur. Kolon EKLENMEZSE uç
-- aynı alanı null döndürür ve hiçbir yerde hata olmaz — mobil ekran o satırı
-- boş satır çizmez, düşürür ("boş satır çizilmez" kuralı).
--
-- ── DOLDURMA ───────────────────────────────────────────────────────────────
-- Elle. Kolon eklendikten sonra bilinen filoya toplu yazmak istenirse (ÖRNEK,
-- çalıştırılmadı — hangi aracın hangi cihazı taşıdığı Volkan'da):
--   update public.vehicles set device_model = 'Teltonika FMC003'
--   where flespi_device_id is not null and device_model is null;
-- Bu satır BİLEREK migration'ın dışında: 29 cihazın hepsinin FMC003 olduğu
-- DOĞRULANMADI ve doğrulanmadan yazmak, uydurmayı veriye çevirmek olurdu.
--
-- Gizlilik: bu dosyada plaka/isim YOK.

alter table public.vehicles
  add column if not exists device_model text;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  056_vehicle_fault_reports.sql                                      ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 056_vehicle_fault_reports.sql — ELLE ARIZA BİLDİRİMİ (U7)
--
-- ⚠️ BU DOSYA CLAUDE TARAFINDAN ÇALIŞTIRILMADI. Volkan Supabase SQL
-- editöründe kendisi çalıştırır.
--
-- ── NEDEN vehicle_dtc'YE YAZILMIYOR ────────────────────────────────────────
-- `vehicle_dtc` CİHAZIN gerçeğidir: flespi akışı her anlık görüntüde tabloyu
-- uzlaştırıyor (`saveDtc` + `reconcileDtc`). Oraya elle bir satır girilirse bir
-- sonraki senkron turunda "artık listede yok" sayılıp `cleared_at` ile kapanır
-- ya da tamamen kaybolur. Bu tablo İNSANIN beyanıdır — ayrı yaşamak zorunda.
-- İkisi aynı ekranda yan yana gösterilebilir; aynı satırda DEĞİL.
--
-- ── ALANLAR ────────────────────────────────────────────────────────────────
-- reported_by  → bildiren kişi. Depo `created_by` / `updated_by` / `approved_by`
--                adlandırmasını kullanıyor, bu da onun kardeşi.
--                CASCADE YOK (bilerek): bildirim, bildireni silinse bile
--                kayıttır. Zaten bu sistemde personel silinmiyor,
--                `terminated_at` ile ayrılıyor.
-- aciklama     → serbest metin. Uzunluk sınırı UÇTA (2000 karakter), burada
--                CHECK olarak DEĞİL: sınır bir ürün kararıdır ve değiştiğinde
--                migration yazmak gerekmesin.
-- durum        → 'acik' | 'kapali'. Ara durum ('islemde') BİLEREK yok —
--                bugün onu değiştirecek bir yüzey yok, olmayan bir iş akışını
--                şemaya yazmak onu var sanmaya yol açar. Gerektiğinde CHECK
--                genişletmek tek satırlık additive bir iştir.
--
-- Adlandırma notu: `aciklama` ve `durum` TÜRKÇE, tablodaki diğer kolonlar ve
-- deponun geri kalanı İNGİLİZCE. Volkan'ın verdiği isimler bunlar; İngilizce
-- karşılıkları `note` ve `status` olurdu. Karar onun.
--
-- ── GERİYE DÖNÜK ETKİ YOK ──────────────────────────────────────────────────
-- Yeni tablo; mevcut hiçbir sorgu, sayı ya da ekran değişmez.
--
-- Gizlilik: bu dosyada plaka/isim YOK.

create table if not exists public.vehicle_fault_reports (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  reported_by uuid not null references public.workers(id),
  aciklama    text not null,
  durum       text not null default 'acik' check (durum in ('acik', 'kapali')),
  created_at  timestamptz not null default now()
);

-- Araç detayının okuması: tek aracın bildirimleri, yeniden eskiye.
create index if not exists idx_vehicle_fault_reports_vehicle
  on public.vehicle_fault_reports(vehicle_id, created_at desc);

-- RLS KAPALI — şemanın geri kalanıyla tutarlı. Bu tabloya yalnız service-role
-- istemcisi (sunucu tarafı uçlar) yazıyor ve okuyor; tarayıcıya anon anahtarla
-- açılan bir yolu yok.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  057_fault_report_closed.sql                                        ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 057_fault_report_closed.sql — ARIZA BİLDİRİMİNDE KAPATMA İZİ
--
-- ⚠️ BU DDL VOLKAN TARAFINDAN 11.08.2026'DA SUPABASE'DE ÇALIŞTIRILDI ve HAK61
-- canlısında UYGULANMIŞ durumdadır (kolonlar ölçüldü: `closed_at` VAR,
-- `closed_by` VAR). Bu dosya deponun ŞEMA KAYDIDIR — yeni bir kurulum
-- migration listesini buradan yürütecek. Claude tarafından çalıştırılmadı.
--
-- ── NEDEN GEREKLİ ──────────────────────────────────────────────────────────
-- 056 bildirimin AÇILIŞINI kaydediyordu (`reported_by`, `created_at`) ama
-- KAPANIŞINI kaydetmiyordu. `durum` alanı tek başına "şu an kapalı" der;
-- "kim, ne zaman kapattı" sorusunun cevabı yoktu. Kapatma bir yönetici
-- kararıdır ve izsiz bırakılırsa geriye dönük hesabı sorulamaz.
--
-- ── NEDEN İKİ KOLON, NEDEN AYRI TABLO DEĞİL ────────────────────────────────
-- Bildirimin YALNIZ İKİ durumu var (056: 'acik' | 'kapali') ve kapanış
-- tekildir — açılıp kapanma döngüsünün geçmişi tutulmuyor. Ayrı bir olay
-- tablosu, olmayan bir ihtiyacı şemaya yazmak olurdu. Yeniden açılan bildirimde
-- ikisi de NULL'a döner: "şu an açık" ile "kapatılmış ama sonra açılmış" aynı
-- şeydir, çünkü açık bir bildirimin kapatma anı YOKTUR.
--
-- ── GERİYE DÖNÜK ETKİ YOK ──────────────────────────────────────────────────
-- İkisi de nullable ve varsayılansız: mevcut satırlar NULL kalır, hiçbir sorgu
-- ve hiçbir sayı değişmez. 056'sı olup 057'si olmayan bir kurulumda uç
-- ÇALIŞMAYA DEVAM EDER — kolon eksikse yalnız durum yazılır ve yanıt
-- `kapatmaIzi: false` ile bunu SÖYLER (lib/fault-reports-db.ts).
--
-- `closed_by`'da CASCADE YOK, 056'daki `reported_by` ile aynı gerekçe: iz,
-- izi bırakan kişi silinse bile kayıttır. Zaten personel silinmiyor,
-- `terminated_at` ile ayrılıyor.
--
-- Gizlilik: bu dosyada plaka/isim YOK.

alter table public.vehicle_fault_reports
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.workers(id);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  058_action_snoozes.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 058_action_snoozes.sql — AKSİYON ERTELEME (alarm / dikkat kalemi / izin talebi)
--
-- ⚠️ BU DDL VOLKAN TARAFINDAN 11.08.2026'DA SUPABASE'DE ÇALIŞTIRILDI ve HAK61
-- canlısında UYGULANMIŞ durumdadır. Bu dosya deponun ŞEMA KAYDIDIR — yeni bir
-- kurulum migration listesini buradan yürütecek. Claude tarafından çalıştırılmadı.
--
-- ── NEDEN GEREKLİ ──────────────────────────────────────────────────────────
-- Mobildeki Aksiyon Merkezi üç kaynağı (cihaz olayları, dikkat kalemleri, izin
-- talepleri) tek listede topluyor. "Bunu şimdi değil, yarın sabah hallederim"
-- diyebilmek listenin işe yaraması için şart: erteleyemeyen yönetici kalemi
-- görmezden gelmeyi öğrenir ve liste gürültüye döner.
--
-- ── NEDEN CİHAZDA DEĞİL SUNUCUDA ───────────────────────────────────────────
-- Telefonda ertelenen bir uyarı panelde ve ikinci telefonda "bekliyor"
-- görünürdü; iki yönetici aynı filoyu iki farklı listeyle yönetirdi. Erteleme
-- ancak sunucuda kalıcıysa DOĞRUDUR. Bu, mobilde "Ertelenen" sekmesinin
-- 11.08.2026'ya kadar KAPALI ÖZELLİK olarak durmasının da sebebiydi.
--
-- ── NEDEN YABANCI ANAHTAR YOK ──────────────────────────────────────────────
-- Ertelenebilir kalemler ÜÇ ayrı kaynaktan geliyor (vehicle_events,
-- TÜRETİLMİŞ dikkat kalemleri, worker_leaves) ve tek bir tabloya bağlanamaz.
-- Türetilmiş kalemlerin (ör. "kör araç", "belge süresi doluyor") veritabanında
-- SATIRI BİLE YOK — hesaplanıyorlar. Bu yüzden kalem, (tür + kimlik) çiftiyle
-- tanımlanıyor. Başka bir yol yok; FK yokluğu bir eksiklik değil, kaynağın
-- doğasının sonucu.
--
-- item_id `text`, uuid DEĞİL: üç kaynağın kimlik uzayı farklı. vehicle_events.id
-- uuid, dikkat kalemi kimliği türetilmiş bir dizge ("silent:<aracId>" gibi),
-- worker_leaves.id uuid. Kolonu uuid yapmak dikkat kalemlerini dışarıda bırakırdı.
--
-- ── NEDEN cancelled_at, NEDEN DELETE DEĞİL ─────────────────────────────────
-- "Şimdi geri al" satırı SİLMEZ, iptal işaretler. Silmek "kim ertelemişti, kim
-- geri aldı" sorusunun cevabını yok ederdi; erteleme bir yönetici kararıdır ve
-- kararın izi kalır. `closed_at`/`closed_by` (057) ile aynı gerekçe.
--
-- ── SÜRE DOLUNCA OTOMATİK GERİ DÖNÜŞ — CRON GEREKMİYOR ─────────────────────
-- Liste ucu `snoozed_until > now()` koşuluyla süzüyor; süresi geçen kalem
-- kendiliğinden bekleyene döner. Zamanlanmış iş yazmak, sorgunun zaten
-- yaptığı şeyi ikinci kez yapmak olurdu.
--
-- ── GERİYE DÖNÜK ETKİ YOK ──────────────────────────────────────────────────
-- Yeni tablo; mevcut hiçbir sorgu, sayı ya da ekran değişmez. Bu tablosu
-- olmayan kurulumda (Sendigo/galzura-demo) erteleme uçları `tablo_yok` der ve
-- liste uçları `ertelemeler: []` + `ertelemeDurumu: "tablo_yok"` ile SÖYLER —
-- sessizce "hiç erteleme yok" gibi görünmez.
--
-- Gizlilik: bu dosyada plaka/isim YOK.

create table if not exists public.action_snoozes (
  id            uuid primary key default gen_random_uuid(),
  -- 'alarm' | 'attention' | 'leave' — mobil istemcinin kaynak öneki.
  item_source   text not null check (item_source in ('alarm','attention','leave')),
  -- Kaynağın kendi kimliği (vehicle_events.id, dikkat kalem kimliği, leave id).
  item_id       text not null,
  -- Kalem bir araca/kişiye bağlıysa taşınır: ileride "bu aracın tüm
  -- ertelemelerini göster" sorgusu tablo taraması gerektirmesin.
  vehicle_id    uuid references public.vehicles(id) on delete cascade,
  worker_id     uuid references public.workers(id) on delete cascade,
  snoozed_until timestamptz not null,
  snoozed_by    uuid not null references public.workers(id),
  created_at    timestamptz not null default now(),
  -- Geri alma SİLME DEĞİL: kim ne zaman geri aldı izi kalsın.
  cancelled_at  timestamptz
);

-- Bir kalemin AYNI ANDA tek etkin ertelemesi olur.
--
-- ⚠️ KISMİ indeks: PostgREST'in `on_conflict` parametresi WHERE yüklemini
-- taşıyamadığı için bu indeks `.upsert()` ile ARBITER olarak KULLANILAMAZ.
-- lib/action-snoozes-db.ts bu yüzden oku-sonra-yaz yapıyor ve yarışta dönen
-- 23505'i güncellemeye çeviriyor. (Ölçüldü, 11.08.2026.)
create unique index if not exists idx_action_snoozes_item_active
  on public.action_snoozes(item_source, item_id)
  where cancelled_at is null;

-- "Şu an ertelenmiş olanlar" sorgusunun taradığı yol.
create index if not exists idx_action_snoozes_until
  on public.action_snoozes(snoozed_until)
  where cancelled_at is null;

-- Servis-rol istemcisi dışında erişim yok (projedeki diğer tablolarla aynı).
alter table public.action_snoozes disable row level security;

-- PostgREST şema önbelleğini yenile (yeni tablo hemen görünür olsun).
notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  059_fleets.sql                                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 059_fleets.sql — İSİMLİ FİLOLAR (kiracı başına en fazla 5)
--
-- ⚠️ BU DDL VOLKAN TARAFINDAN 11.08.2026'DA SUPABASE'DE ÇALIŞTIRILDI ve HAK61
-- canlısında UYGULANMIŞ durumdadır. Bu dosya deponun ŞEMA KAYDIDIR — yeni bir
-- kurulum migration listesini buradan yürütecek. Claude tarafından çalıştırılmadı.
--
-- ── UYGULANDIKTAN SONRA CANLIDA ÖLÇÜLDÜ (11.08.2026) ──────────────────────
-- PostgREST pg_catalog'a erişemediği için kısıtlar ADIYLA değil DAVRANIŞLARIYLA
-- ölçüldü (CHECK satır düzeyinde, FK AFTER trigger → CHECK önce patlar; yani
-- 23503 almak "eski CHECK düştü VE FK kuruldu" demektir):
--   · fleets 2 satır — bordo/1/name=null · mavi/2/name=null            ✓
--   · sort_order 6/0/-1 → 23514 · sıra 1 ikinci kez → 23505 (tavan yapısal) ✓
--   · vehicles.fleet='yok'  → 23503 (23514 DEĞİL) → eski CHECK düştü, FK var ✓
--   · üçüncü filo kodu açılıp araç oraya taşınabildi                    ✓
--   · içinde aracı olan filo silinemedi → 23503 (on delete restrict)    ✓
--   · workers.managed_fleet='yok' → 23503                               ✓
--   · idx_vehicles_fleet: ÖLÇÜLMEDİ — PostgREST pg_catalog'u dışa açmıyor.
--     SQL Editor'da doğrulanır:
--       select indexname from pg_indexes where indexname = 'idx_vehicles_fleet';
--
-- Uygulanmamış kurulumda (Sendigo/galzura-demo) uçların davranışı:
--   · GET  /api/mobile/fleets            ÇALIŞIR (filolar vehicles.fleet'ten türetilir)
--   · POST /api/mobile/fleets/[id]/atamalar ÇALIŞIR (yazdığı kolon zaten var)
--   · POST /api/mobile/fleets  ve  PATCH /api/mobile/fleets/[id]  →  503 tablo_yok
--
-- ═══════════════════════════════════════════════════════════════════════════
--  ÖNCE ÖLÇÜLDÜ (canlı HAK61, 11.08.2026)
-- ═══════════════════════════════════════════════════════════════════════════
--  · Ayrı bir `fleets` tablosu YOK (PGRST205 ile doğrulandı).
--  · Filo üyeliği İKİ metin kolonunda yaşıyor:
--      vehicles.fleet        — not null, default 'mavi', check in ('bordo','mavi')   [023]
--      workers.managed_fleet — nullable,                 check in ('bordo','mavi')   [029]
--    İkincisi ÜYELİK DEĞİL ŞEFLİK ("bu kişi o filonun şefi").
--  · Şoförün filosu HİÇBİR YERDE TUTULMUYOR; türetiliyor:
--      vehicles.fleet → vehicles.assigned_worker_id  (lib/fleet-scope.ts)
--  · Kiracı kolonu YOK ve OLMAMALI: her müşteri AYRI bir Supabase veritabanı
--    (db/install/sendigo-full.sql, galzura-full.sql "boş veritabanı" denetimiyle
--    başlıyor). Kiracı kimliği env'de (NEXT_PUBLIC_TENANT), satırda değil.
--    Bu yüzden "kiracı başına 5 filo" = BU VERİTABANINDA 5 SATIR.
--  · Dağılım: 30 araç (10 bordo / 20 mavi, 1'i test aracı) · 34 personel
--    (3 filo şefi: 1 bordo, 2 mavi).
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN fleet_id DEĞİL, KOD KÖPRÜSÜ
-- ═══════════════════════════════════════════════════════════════════════════
--  `vehicles.fleet` metni 60+ dosyada, iki CHECK kısıtında, FLEET_STYLE renk
--  eşlemesinde, ACTIVE_FLEETS env'inde ve İKİ BAŞKA KİRACININ kurulum SQL'inde
--  geçiyor. Onu `fleet_id uuid` ile değiştirmek, tek turda o yüzeylerin hepsini
--  yeniden yazmak ve 059'u çalıştırmamış kiracıları kırmak demekti.
--
--  Bunun yerine ÜYELİK OLDUĞU YERDE KALIYOR (`vehicles.fleet` = filo KODU) ve
--  bu tablo yalnız üç şey ekliyor: AD · SIRA · O KODUN VAR OLMASI.
--  Sonuç: mevcut 'bordo'/'mavi' verisi tek satır bile değişmeden korunur —
--  aşağıda araç/personel tablolarına DOKUNAN tek ifade CHECK→FK dönüşümüdür,
--  hiçbir UPDATE yok.
--
--  KAZANÇ: izin verilen filo kümesi artık KOD DEĞİL VERİ. 023'ün CHECK'i
--  üçüncü filoyu imkânsız kılıyordu; FK, kümeyi `fleets` satırlarına bağlar.
--  Referans bütünlüğü de CHECK'ten güçlü: olmayan filoya araç yazılamaz ve
--  içinde aracı olan filo SİLİNEMEZ (on delete restrict) — "silme yok, yoksa
--  içindekiler öksüz kalır" kararı böylece şemayla da güvenceye alınmış olur.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN AYRI BİR uuid `id` YOK
-- ═══════════════════════════════════════════════════════════════════════════
--  Filonun kimliği ZATEN 30 araç satırında metin olarak duruyor. Yanına bir
--  uuid koymak aynı şeye İKİNCİ bir kimlik verirdi ve veri yine metin olanı
--  kullanmaya devam ederdi: uçlar hangisini kabul edecek, istemci hangisini
--  saklayacak? Üstelik tablo YOKKEN (bugün) uuid diye bir şey hiç yok, yani
--  uçların migration öncesi ve sonrası kimliği FARKLI olurdu.
--  Bir kimlik: `code`. URL'deki `[id]` segmenti de odur (/api/mobile/fleets/mavi).
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN `name` NULL OLABİLİYOR
-- ═══════════════════════════════════════════════════════════════════════════
--  Bugün filo adı i18n sözlüğünden geliyor ("Bordo Filo" / "Bordo-Flotte") ve
--  kiracı env'iyle ezilebiliyor (NEXT_PUBLIC_FLEET_*_LABEL, lib/tenant.ts).
--  Tohumda Türkçe adı YAZSAYDIK, Almanca kurulumda 059 çalıştığı an ad sessizce
--  Türkçeye dönerdi. NULL = "kiracı henüz ad vermedi" → görünen ad bugünkü
--  kaynaktan gelir. PATCH ad yazar, boş ad tekrar NULL'a döndürür.
--  Bu yüzden 059 çalıştırıldığında GÖRÜNEN HİÇBİR AD DEĞİŞMEZ.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN TAVAN ŞEMADA (check 1..5), UYGULAMADA DEĞİL
-- ═══════════════════════════════════════════════════════════════════════════
--  "En fazla 5" satır SAYISINA ait bir kural; CHECK satır sayamaz. Uygulamada
--  say-sonra-yaz yapılırsa iki yönetici aynı anda 6. filoyu açabilir.
--  `sort_order` 1..5 aralığında ve BENZERSİZ olduğu için tavan YAPISALDIR:
--  beşten fazla satır fiziksel olarak sığmaz, yarışın kaybedeni 23505 alır.
--  Sıra aynı zamanda "N. Filo" varsayılan adının N'i ve listenin kararlı sırası.
--  DEFERRABLE: ileride bir yeniden sıralama ucu yazılırsa iki filonun sırası
--  TEK transaction içinde takas edilebilsin (yoksa geçici çakışma engellerdi).
--  Tavanı değiştirmek isteyen bu CHECK'i VE lib/fleets.ts:FILO_TAVANI'nı birlikte
--  değiştirir; scripts/check-filo-yonetimi.mjs ikisinin ayrışmasını yakalar.
--
--  Ad uzunluğu sınırı BİLEREK ŞEMADA DEĞİL: o bir ÜRÜN kararı ve her fikir
--  değişikliğinde migration istemesin (056'daki ARIZA_ACIKLAMA_MAX ile aynı gerekçe).
--
-- ═══════════════════════════════════════════════════════════════════════════
--  GERİYE DÖNÜK ETKİ
-- ═══════════════════════════════════════════════════════════════════════════
--  Yeni tablo + iki kısıt dönüşümü. Hiçbir satır güncellenmiyor, hiçbir kolon
--  düşmüyor, hiçbir mevcut sorgu değişmiyor: 'bordo'/'mavi' yazan/okuyan her
--  kod aynen çalışmaya devam eder (FK o iki kodu kabul eder, çünkü tohumda var).
--  Bu tablosu olmayan kurulumda (Sendigo/galzura-demo) uçlar `tablo_yok` DER —
--  sessizce "filo yok" gibi görünmez.
--
--  Gizlilik: bu dosyada plaka/isim/e-posta YOK.

-- ── 1 · FİLO TANIMLARI ─────────────────────────────────────────────────────
create table if not exists public.fleets (
  -- Kimlik = kod. vehicles.fleet ve workers.managed_fleet bunu tutuyor.
  code       text primary key,
  -- NULL = kiracı ad vermedi; görünen ad i18n/env'den gelir (yukarıdaki not).
  name       text,
  -- 1..5 · benzersiz → tavan YAPISAL. Aynı zamanda kararlı liste sırası.
  sort_order smallint not null check (sort_order between 1 and 5),
  created_at timestamptz not null default now(),
  constraint fleets_sort_order_key unique (sort_order) deferrable initially deferred
);

comment on table public.fleets is
  'İsimli filolar (en fazla 5). Üyelik BURADA DEĞİL: araç vehicles.fleet=code ile bağlı, personel araçtan türetilir (lib/fleet-scope.ts).';
comment on column public.fleets.name is
  'NULL ise görünen ad i18n/env''den gelir (lib/vehicle-ui.ts fleetLabel). Yeniden adlandırma bunu yazar.';

-- ── 2 · TOHUM — MEVCUT VERİYİ KORUR ────────────────────────────────────────
-- Ad BİLEREK NULL (yukarıdaki gerekçe). Sıra bugünkü arayüz sırası:
-- FLEET_STYLE ve ACTIVE_FLEETS varsayılanı ikisinde de bordo önce geliyor.
insert into public.fleets (code, name, sort_order) values
  ('bordo', null, 1),
  ('mavi',  null, 2)
on conflict (code) do nothing;

-- ── 3 · CHECK → FK · İZİN VERİLEN KÜME ARTIK VERİ ──────────────────────────
-- Kısıt adları 023/029'da AÇIKÇA VERİLMEDİ, yani PostgreSQL'in ürettiği ada
-- (vehicles_fleet_check / workers_managed_fleet_check) güvenmek zorunda
-- kalırdık — kurulumdan kuruluma değişebilir. Onun yerine 'bordo' geçen CHECK
-- kısıtları ADIYLA DEĞİL TANIMIYLA bulunup düşürülüyor. İdempotent: ikinci
-- çalıştırmada düşürecek bir şey bulamaz ve sessizce geçer.
do $fleet_check$
declare c record;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
      from pg_constraint
     where contype = 'c'
       and conrelid in ('public.vehicles'::regclass, 'public.workers'::regclass)
       and pg_get_constraintdef(oid) ilike '%bordo%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    raise notice 'düşürüldü: % on %', c.conname, c.tbl;
  end loop;
end
$fleet_check$;

-- Araç → filo. RESTRICT: içinde aracı olan filo silinemez (öksüz araç olmaz).
-- CASCADE (update): bir kodun kendisi değiştirilirse araçlar birlikte taşınır.
do $fk_vehicles$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vehicles_fleet_fkey'
      and conrelid = 'public.vehicles'::regclass
  ) then
    alter table public.vehicles
      add constraint vehicles_fleet_fkey foreign key (fleet)
      references public.fleets(code) on update cascade on delete restrict;
  end if;
end
$fk_vehicles$;

-- Şeflik → filo. NULL serbest (herkes şef değil); FK NULL'ı zaten denetlemez.
do $fk_workers$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workers_managed_fleet_fkey'
      and conrelid = 'public.workers'::regclass
  ) then
    alter table public.workers
      add constraint workers_managed_fleet_fkey foreign key (managed_fleet)
      references public.fleets(code) on update cascade on delete restrict;
  end if;
end
$fk_workers$;

-- ── 4 · İNDEKS ─────────────────────────────────────────────────────────────
-- FK'nin referans veren tarafı indekssizdi. Filo başına araç sayımı ve
-- ileride bir filo silme denemesi bu indeksi kullanır.
create index if not exists idx_vehicles_fleet on public.vehicles (fleet);

-- Servis-rol istemcisi dışında erişim yok (projedeki diğer tablolarla aynı).
alter table public.fleets disable row level security;

-- PostgREST şema önbelleğini yenile (yeni tablo hemen görünür olsun).
notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  060_last_recorded_at_batch.sql                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 060 — SENKRON TURUNUN İMLEÇ OKUMASI TEK SORGUYA (#84 Adım 1)
--
-- ═══ SORUN ═══
-- `/api/flespi/sync` her turda araç başına bir "son kayıt anı" sorgusu atıyor
-- (lib/telemetry.ts → lastRecordedAt). 29 araçta 29 gidiş-dönüş.
--
-- 18.08.2026'da CANLIDA ÖLÇÜLDÜ (sorgu sayacı, #84 Adım 0): tur başına
-- 169 PostgREST çağrısı, dökümü:
--     92  device_telemetry     ← imleç okuması bunun büyük kısmı
--     59  idle_episodes
--      7  workers · 6 geofences · 2 vehicles · 2 time_entries · 1 worker_leaves
--
-- ═══ NEDEN SQL (JS'te toplanamıyor) ═══
-- PostgREST "araç başına max(recorded_at)" ifadesini kuramaz: GROUP BY yok,
-- DISTINCT ON yok. JS tarafında yapılabilecek tek şey son N satırı çekip
-- bellekte gruplamaktı — ama o SESSİZ KIRPMAYA açık: yoğun bir araç tek başına
-- 1000 satırı doldurursa başka bir aracın imleci hiç görünmez ve o araç için
-- pencere yanlış hesaplanır. Kasadaki ders açık: sessiz kırpma başarı gibi
-- görünür. Bu yüzden toplama SQL tarafında yapılıyor.
--
-- LATERAL, araç başına (vehicle_id, recorded_at) indeksine TEK seek yapar —
-- 052'deki shift_odometer_spans ile aynı desen. Tablo taranmaz.
--
-- ═══ SÖZLEŞME ═══
-- Girdi : araç id listesi (senkronun o turda işlediği araçlar)
-- Çıktı : her araç için son telemetri anı. HİÇ kaydı olmayan araç SATIR
--         DÖNDÜRMEZ (null döndürmez) — çağıran tarafta "kayıt yok" ile
--         "sorgu başarısız" birbirine karışmasın diye.
--
-- ═══ GERİYE UYUM ═══
-- Bu fonksiyon ÇALIŞTIRILMASA DA uygulama çalışır: lib/telemetry.ts'teki
-- toplu okuma, fonksiyon yoksa araç-araç eski yola (lastRecordedAt) düşer ve
-- tur bugünküyle birebir aynı davranır — yalnız sorgu sayısı düşmez.
-- Yani deploy sırası serbest: kod önce çıkabilir, migration sonra koşabilir.

create or replace function public.last_recorded_at_batch(
  p_vehicle_ids uuid[]
)
returns table (
  vehicle_id  uuid,
  recorded_at timestamptz
)
language sql
stable
as $$
  select v.id as vehicle_id, son.recorded_at
  from unnest(p_vehicle_ids) as v(id)
  cross join lateral (
    select dt.recorded_at
    from public.device_telemetry dt
    where dt.vehicle_id = v.id
    order by dt.recorded_at desc
    limit 1
  ) as son
$$;

comment on function public.last_recorded_at_batch(uuid[]) is
  'Senkron turunun imlec okumasi: arac basina son device_telemetry ani, TEK sorguda (#84 Adim 1). Kaydi olmayan arac icin satir donmez.';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  061_idle_episode_cursors_batch.sql                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 061 — RÖLANTİ EPİZOD İMLEÇLERİ TEK SORGUYA (#84 Adım 2)
--
-- ═══ SORUN ═══
-- `saveIdleEpisodes` her araç için İKİ okuma yapıyor (lib/telemetry.ts):
--     getOpenEpisode(vehicleId)     → açık epizod (varsa)
--     latestClosedEndMs(vehicleId)  → son KAPALI epizodun bitiş anı
-- 29 araçta 58 gidiş-dönüş.
--
-- CANLIDA ÖLÇÜLDÜ (#84 sayacı, HAK61):
--     Adım 0 tabanı        : 169 sorgu/tur — idle_episodes 59
--     Adım 1 (migration 060): 141 sorgu/tur — idle_episodes HÂLÂ 59
-- Yani `idle_episodes` artık turun en büyük kalemi.
--
-- ═══ NEDEN SQL ═══
-- 060 ile aynı sebep: PostgREST "araç başına en yeni satır" kuramaz (GROUP BY
-- yok, DISTINCT ON yok). Bellekte gruplamak sessiz kırpmaya açık olurdu.
-- İki LATERAL, araç başına (vehicle_id, ended_at) indeksine birer seek yapar.
--
-- ═══ SÖZLEŞME ═══
-- Girdi : araç id listesi
-- Çıktı : HER araç için TEK satır (LEFT JOIN — açık epizodu ya da kapalı
--         epizodu olmayan araç da döner, ilgili alanları null).
--         open_id            : açık epizodun id'si, yoksa null
--         open_started_at    : açık epizodun başlangıcı
--         open_last_seen_at  : açık epizodun son doğrulanmış anı
--         latest_closed_end  : son KAPALI epizodun ended_at'i, yoksa null
--
-- `getOpenEpisode` açıklar arasında `started_at desc limit 1` alıyor; tekil
-- indeks zaten araç başına en fazla bir açık epizoda izin veriyor ama buradaki
-- sıralama o savunmacı davranışı BİREBİR taklit eder — davranış farkı kalmasın.
--
-- ═══ 23505 YARIŞ KORUMASI BU FONKSİYONA DEVREDİLMEZ ═══
-- `saveIdleEpisodes` içinde insert 23505 (tekil ihlal) alırsa açık epizodu
-- YENİDEN okuyor. O okuma CANLI kalmak ZORUNDA: yarışı kaybettiğimiz an
-- karşı tarafın az önce yazdığı satırı öğrenmek istiyoruz, tur başında
-- çekilmiş bayat bir değeri değil. Bu yüzden kod tarafında o çağrı
-- `getOpenEpisode(vehicleId)` olarak AYNEN kalır; bu fonksiyon yalnız tur
-- BAŞINDAKİ ilk okumayı toplulaştırır.
--
-- ═══ GERİYE UYUM ═══
-- Çalıştırılmasa da uygulama çalışır: toplu okuma null dönerse
-- `saveIdleEpisodes` araç-araç eski yola düşer ve davranış birebir aynı kalır
-- (060'ta canlıda kanıtlanan desen). Deploy sırası serbest.

create or replace function public.idle_episode_cursors_batch(
  p_vehicle_ids uuid[]
)
returns table (
  vehicle_id        uuid,
  open_id           uuid,
  open_started_at   timestamptz,
  open_last_seen_at timestamptz,
  latest_closed_end timestamptz
)
language sql
stable
as $$
  select
    v.id as vehicle_id,
    a.id            as open_id,
    a.started_at    as open_started_at,
    a.last_seen_at  as open_last_seen_at,
    k.ended_at      as latest_closed_end
  from unnest(p_vehicle_ids) as v(id)
  left join lateral (
    select ie.id, ie.started_at, ie.last_seen_at
    from public.idle_episodes ie
    where ie.vehicle_id = v.id
      and ie.ended_at is null
    order by ie.started_at desc
    limit 1
  ) as a on true
  left join lateral (
    select ie.ended_at
    from public.idle_episodes ie
    where ie.vehicle_id = v.id
      and ie.ended_at is not null
    order by ie.ended_at desc
    limit 1
  ) as k on true
$$;

comment on function public.idle_episode_cursors_batch(uuid[]) is
  'Senkron turunun rolanti imlecleri: arac basina acik epizod + son kapali bitis ani, TEK sorguda (#84 Adim 2). 23505 yaris korumasindaki yeniden okuma bunu KULLANMAZ, canli kalir.';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  062_autoshift_telemetry_batch.sql                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 062 — OTOMATİK VARDİYA TELEMETRİ OKUMALARI TEK SORGUYA (#116b)
--
-- ═══ SORUN ═══
-- `processAutoShifts` her turda araç/vardiya başına ayrı telemetri sorgusu
-- atıyor (lib/auto-shift.ts):
--     firstIgnitionToday(vehicleId)   → bugünün İLK kontak-açık anı   (araç başına 1)
--     lastActivityMs(vehicleId, shift)→ vardiya başlangıcından beri
--                                        son kontak-açık + son HAREKET (vardiya başına 2)
--
-- CANLIDA ÖLÇÜLDÜ (19.08.2026, #84 sayacı, yoğun tur):
--     device_telemetry 37 sorgu/tur
--     13 açık vardiya, 29 cihazlı araç → 2×13 + (29−13) = 42 beklenen, 37 ölçülen
--     (fark: daha önceki filtrelerle elenen araçlar)
-- #84 Adım 0-4 bittikten sonra turun EN BÜYÜK kalemi bu.
--
-- ⚠️ NOT: bu kalem başta "saveDtc odometre okuması" sanılmıştı. Ölçüm yanlışı
-- düzeltti — saveDtc'nin odometre okuması TEMBEL (yalnız yeni bir arıza kodu
-- eklenirken) ve pratikte neredeyse hiç tetiklenmiyor.
--
-- ═══ NEDEN SQL ═══
-- 060/061 ile aynı sebep: PostgREST "araç başına EN YENİ/EN ESKİ satır"
-- kuramaz (GROUP BY yok, DISTINCT ON yok) ve her aracın penceresi FARKLI
-- (`p_since` vardiya başlangıcı). Bellekte gruplamak için tüm telemetriyi
-- çekmek gerekirdi — yoğun günde araç başına binlerce satır, ve 1000 satırlık
-- PostgREST tavanı yüzünden SESSİZ KIRPMAYA açık.
--
-- Üç LATERAL, araç başına (vehicle_id, recorded_at) indeksine birer seek yapar.
--
-- ═══ SÖZLEŞME ═══
-- Girdi : eşleşen üç dizi — araç id'leri ve her araç için pencere başlangıcı.
--         `p_since[i]` NULL ise o araç için vardiya penceresi yok; yalnız
--         `first_ignition_today` hesaplanır (diğer ikisi NULL döner).
-- Çıktı : her araç için TEK satır (LEFT JOIN — hiç kaydı olmayan araç da döner).
--         first_ignition_today : p_day_start'tan sonraki İLK kontak-açık anı
--         last_ignition_on     : p_since'ten sonraki SON kontak-açık anı
--         last_movement        : p_since'ten sonraki SON hareket anı
--                                (speed_kmh >= p_move_kmh)
--
-- Hız eşiği PARAMETRE: JS tarafındaki MOVE_SPEED_KMH tek kaynak olarak kalsın;
-- SQL'e sabit gömülseydi iki yerde iki farklı eşik olur ve biri değişince
-- öteki sessizce geride kalırdı.
--
-- ═══ GERİYE UYUM ═══
-- Çalıştırılmasa da uygulama çalışır: toplu okuma null dönerse auto-shift
-- araç-araç eski yola düşer ve davranış birebir aynı kalır (060/061'de
-- canlıda iki kez kanıtlanan desen). Deploy sırası serbest.

create or replace function public.autoshift_telemetry_batch(
  p_vehicle_ids uuid[],
  p_since       timestamptz[],
  p_day_start   timestamptz,
  p_move_kmh    double precision
)
returns table (
  vehicle_id           uuid,
  first_ignition_today timestamptz,
  last_ignition_on     timestamptz,
  last_movement        timestamptz
)
language sql
stable
as $$
  select
    v.id as vehicle_id,
    ilk.recorded_at  as first_ignition_today,
    sonKontak.recorded_at as last_ignition_on,
    sonHareket.recorded_at as last_movement
  from unnest(p_vehicle_ids, p_since) as v(id, since)
  left join lateral (
    select dt.recorded_at
    from public.device_telemetry dt
    where dt.vehicle_id = v.id
      and dt.ignition_on = true
      and dt.recorded_at >= p_day_start
    order by dt.recorded_at asc
    limit 1
  ) as ilk on true
  left join lateral (
    select dt.recorded_at
    from public.device_telemetry dt
    where v.since is not null
      and dt.vehicle_id = v.id
      and dt.ignition_on = true
      and dt.recorded_at >= v.since
    order by dt.recorded_at desc
    limit 1
  ) as sonKontak on true
  left join lateral (
    select dt.recorded_at
    from public.device_telemetry dt
    where v.since is not null
      and dt.vehicle_id = v.id
      and dt.speed_kmh >= p_move_kmh
      and dt.recorded_at >= v.since
    order by dt.recorded_at desc
    limit 1
  ) as sonHareket on true
$$;

comment on function public.autoshift_telemetry_batch(uuid[], timestamptz[], timestamptz, double precision) is
  'Otomatik vardiya motorunun telemetri okumalari: arac basina bugunun ilk kontagi + vardiya penceresindeki son kontak/son hareket, TEK sorguda (#116b). Hiz esigi parametre — JS tarafi tek kaynak.';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  063_geofence_category.sql                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 063 (BÖLGE GÖRSEL KATEGORİSİ)
-- =====================================================================
-- Mobil Bölgeler ekranının kategori rozeti. Additive + idempotent.
-- ⚠️ 015 (geofences) ve 034 (purpose) uygulanmış olmalı. Arşiv kolonu
-- (archived_at) ayrı bir migration'la zaten canlıda.
--
-- ═══ NEDEN `purpose` GENİŞLETİLMİYOR DA YENİ KOLON AÇILIYOR ═══
--
-- `purpose` bugün İKİ işi birden yapıyor: görsel rozet VE davranış anahtarı.
-- purpose='depot' olan bölge şunları sürüyor:
--   (a) otomatik vardiya başlatma tetiği   lib/auto-shift.ts
--   (b) manuel başlatmada depo kilidi      app/actions/shift.ts
--   (c) vardiya başlangıç anını türetir    app/actions/shift.ts
--   (d) şoför panelinde öneri/kilit rozeti app/panel/page.tsx
--   (e) KURAL değerlendirmesinden muafiyet app/admin/araclar/[id]/page.tsx
--
-- `purpose`u 'customer','restricted','custom' ile genişletseydik, mobilde bir
-- bölgenin kategorisini depot→customer çevirmek bu BEŞ davranışı birden
-- sessizce kapatırdı. Büyüklüğü ölçüldü (18.08.2026, HAK61): son 30 günde
-- 511 vardiyanın 346'sı (%68) depo tetiğiyle açılmış ve canlıda yalnız 2 depo
-- bölgesi var — tek bir açılır menü seçimi filonun üçte iki vardiya kaydını
-- durdurabilirdi, hata mesajı olmadan.
--
-- Bu yüzden eksenler AYRI:
--   category = GÖRSEL kategori (mobil/panel rozeti) — motor OKUMAZ
--   purpose  = DAVRANIŞ anahtarı — CHECK'i DEĞİŞMEZ, motor kodu değişmez
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
alter table public.geofences
  add column if not exists category text not null default 'custom';

-- Kısıt ayrı: kolon zaten varsa da kısıt garanti altına alınsın.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'geofences_category_check'
  ) then
    alter table public.geofences
      add constraint geofences_category_check
      check (category in ('depot','customer','restricted','custom'));
  end if;
end $$;

-- Geriye dönük doldurma: davranış anahtarı görsel kategoriye yansısın.
-- Yalnız varsayılanda kalmış satırlara dokunur (elle değiştirilmiş satır
-- ezilmez) — migration tekrar çalıştırılabilir kalsın diye.
update public.geofences
   set category = 'depot'
 where purpose = 'depot' and category = 'custom';

-- Varsayılan liste ve motor okumaları "arşivde değil" filtresiyle çalışır.
create index if not exists idx_geofences_not_archived
  on public.geofences (active)
  where archived_at is null;
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  064_customer_zone_visits.sql                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 064 — MÜŞTERİ BÖLGESİ + ZİYARET ÖLÇÜMÜ (FAZ C)
-- =====================================================================
-- "Bölgede geçirilen süre raporu (faturalama kanıtı)" — GOLD paketinde
-- zaten satılan özelliğin veri katmanı.
--
-- ⚠️ 063 (geofences.category) uygulanmış olmalı. Numara 063 dolu → 064.
--
-- ═══ NEDEN `purpose`, `category` DEĞİL (Volkan kararı B, 19.08.2026) ═══
--
-- 063 iki ekseni ayırdı ve gerekçesi ölçülmüştü:
--     category = GÖRSEL rozet — MOTOR OKUMAZ, mobil serbestçe yazar
--     purpose  = DAVRANIŞ anahtarı
--
-- Ziyaret ölçümü `category='customer'`e bağlansaydı, mobil uygulamada bir
-- kategori açılır menüsüne dokunmak FATURALAMA KANITI üretimini sessizce
-- başlatır ya da durdururdu — hata mesajı olmadan. 063 tam olarak bu kaza
-- sınıfını önlemek için yazılmıştı (son 30 günde 511 vardiyanın %68'i depo
-- tetiğiyle açılıyor); aynı tehlike burada en yüksek bahisli tüketiciye,
-- müşteri faturasına dokunuyor.
--
-- Volkan'ın kararı ve gerekçesi:
--   "ÖLÇÜM DAVRANIŞTIR, ROZET DEĞİL; FATURA KANITI TELEFON MENÜSÜNDEN
--    DEĞİŞEMEZ."
--
-- Sonuç: bir bölge, `purpose='customer'` ise müşteri sahasıdır.
-- `category='customer'` rozeti YANINDA durur (panel ikisini birlikte yazar).
-- Mobil `purpose` YAZAMIYOR (lib/geofences-db.ts, bilinçli) → ölçüm yalnız
-- panelden, bilerek açılabilir.
--
-- 063'ün saydığı depo tehlikesi BURADA YOK: 'customer' hiçbir mevcut satırda
-- olmayan YENİ bir değer; purpose='depot' satırlarına dokunulmuyor ve o beş
-- depo davranışı (otomatik vardiya tetiği, depo kilidi, başlangıç anı türetme,
-- şoför paneli rozeti, kural muafiyeti) aynen çalışmaya devam ediyor.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ── 1) purpose'a 'customer' ──────────────────────────────────────────
-- 034 kısıtı kolon tanımının İÇİNDE açmıştı (adı Postgres tarafından
-- üretildi). Adı varsaymak yerine purpose üzerindeki CHECK kısıtı BULUNUP
-- düşürülüyor — migration tekrar çalıştırılabilir kalsın.
do $$
declare k text;
begin
  select con.conname into k
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public'
     and rel.relname = 'geofences'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%purpose%'
   limit 1;
  if k is not null then
    execute format('alter table public.geofences drop constraint %I', k);
  end if;
end $$;

alter table public.geofences
  add constraint geofences_purpose_check
  check (purpose in ('rule','depot','customer'));

-- ── 2) Müşteri kimliği ───────────────────────────────────────────────
-- Ayrı müşteri TABLOSU açılmıyor: bugün "müşteri kaydı" diye bir kavram yok,
-- iki kolon yetiyor. Gerekirse sonra ilişkiye çevrilir; şimdiden tablo açmak
-- kullanılmayan bir yapıyı bakım yüküne çevirirdi.
alter table public.geofences
  add column if not exists customer_name text,
  add column if not exists customer_ref  text;

-- ── 3) Histerezis eşiği ──────────────────────────────────────────────
-- Depo tetiği 3 dakika kullanıyor. Müşteri sahası için AYRI ve ayarlanabilir
-- olmalı: bir teslimat 90 saniye sürebilir ve 3 dakikalık eşik onu TAMAMEN
-- kaçırırdı. Varsayılan 120 sn (Volkan onayı).
-- Çok kısa seçilirse yoldan geçiş "ziyaret" sayılır ve FATURAYA girer —
-- bu bir fatura doğruluğu ayarıdır, kozmetik değil.
alter table public.geofences
  add column if not exists min_dwell_s integer not null default 120
  constraint geofences_min_dwell_pos check (min_dwell_s > 0);

-- ── 4) ZİYARET EPİZODLARI ────────────────────────────────────────────
-- idle_episodes'un (024) birebir kardeşi. Aynı ilke: GÖZLEMLENMEMİŞ SÜRE
-- ASLA SAYILMAZ. Süre daima ended_at - started_at; "şu an - started_at"
-- HİÇBİR YERDE hesaplanmaz.
create table if not exists public.zone_visits (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id)  on delete cascade,
  zone_id      uuid not null references public.geofences(id) on delete cascade,
  -- Ziyaret anındaki şoför. Araç el değiştirirse GEÇMİŞ BOZULMASIN diye
  -- burada donduruluyor (vehicles.assigned_worker_id'den türetilmiyor).
  worker_id    uuid references public.workers(id) on delete set null,
  -- Histerezis dolduğu an — yoldan geçiş değil, GERÇEK varış.
  started_at   timestamptz not null,
  -- NULL = araç hâlâ içeride.
  ended_at     timestamptz,
  -- İçeride olduğunu doğrulayan SON telemetri. Sinyal kesilirse ziyaret
  -- bununla kapanır; sinyalsiz geçen süre faturaya girmez.
  last_seen_at timestamptz not null,
  end_reason   text check (end_reason in ('exit','gap_timeout','shift_end')),
  created_at   timestamptz not null default now(),
  -- Bitmiş ziyaret geriye akamaz.
  constraint zone_visits_sira check (ended_at is null or ended_at >= started_at)
);

-- KRİTİK DEĞİŞMEZ: araç + bölge başına EN FAZLA BİR açık ziyaret.
-- idle_episodes'un uq_idle_open_per_vehicle deseninin aynısı: iki ingest yolu
-- (stream + poll) yarışırsa veritabanı reddeder, kod yarışı çözer.
create unique index if not exists uq_zone_visit_open
  on public.zone_visits (vehicle_id, zone_id)
  where ended_at is null;

-- Rapor okuması: "şu tarih aralığında şu bölgedeki ziyaretler".
create index if not exists idx_zone_visits_zone_time
  on public.zone_visits (zone_id, started_at desc);
-- Tur okuması: açık ziyaretlerin tamamı (tur başına TEK sorgu).
create index if not exists idx_zone_visits_open
  on public.zone_visits (vehicle_id)
  where ended_at is null;

-- RLS — kardeş tablo `idle_episodes` (024) ile BİREBİR aynı duruş:
-- tablo yalnız service-role (supabaseAdmin) ile okunur/yazılır ve service-role
-- RLS'i bypass eder. public/anon/authenticated erişimi OLMAMALI →
-- RLS AÇIK + policy YOK (varsayılan deny).
-- Kasadaki kural (17 Tem): yeni migration'da RLS zorunlu.
alter table public.zone_visits enable row level security;
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  065_latest_telemetry_batch.sql                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 065 — CANLI TELEMETRİ PENCERESİ TOPLU (#116b'nin GERÇEK karşılığı)
-- =====================================================================
-- ═══ SORUN ═══
-- `processAutoShifts` döngüsünün İLK satırı, KOŞULSUZ:
--     lib/auto-shift.ts:494   const latest = await latestVehicleTelemetry(v.id);
-- Araç başına 1 sorgu → 29 araçta 29 gidiş-dönüş.
--
-- CANLIDA ÖLÇÜLDÜ (19.08.2026, #84 sayacı, yoğun tur): `device_telemetry` 37;
-- bunun 29'u bu çağrı, kalanı `depotArrivalTrigger` sayfalı okumaları ve
-- vardiya açılırken `resolveStartKm`.
--
-- ⚠️ Bu kalem önce "saveDtc odometre", sonra "migration 062" sanılmıştı. İkisi
-- de ÖLÇÜMLE yanlış çıktı: saveDtc'nin odometre okuması tembel, 062'nin
-- kapsadığı üç okuma da HAK61 yapılandırmasında (SHIFT_START_TRIGGER=
-- depot_entry, SHIFT_AUTO_END=off) hiç çalışmıyor. Gerçek kaynak burası.
--
-- ═══ NEDEN 060 DESENİNİN AYNISI DEĞİL ═══
-- `latestVehicleTelemetry` TEK SATIR döndürmüyor: en yeni 40 satırlık bir
-- PENCERE çekip seyrek CAN/OBD alanlarını (yakıt, rpm, hararet…) o pencerede
-- gerçekten değer bildiren EN YENİ satırdan tamamlıyor. En yeni kare motor
-- verisi taşımadığında detay kartı "—" göstermesin diye.
--
-- Bu yüzden bu fonksiyon da PENCERE döndürür — tek satır değil.
--
-- ═══ BİRLEŞTİRME (coalesce) SQL'E TAŞINMADI — BİLİNÇLİ ═══
-- Alanları SQL tarafında doldurmak, aynı kuralın İKİNCİ bir uygulaması
-- olurdu ve iki uygulama ilk değişiklikte birbirinden sapardı. Kural
-- JS'te TEK KAYNAK olarak kalıyor (lib/telemetry.ts); SQL yalnız satırları
-- getiriyor. Aynı gerekçe `telemetriSatirlari()` ve `MOVE_SPEED_KMH`
-- parametresinde de uygulandı.
--
-- ═══ ⚠️ SATIR TAVANI — ÇAĞIRAN PARÇALAYARAK ÇAĞIRMALI ═══
-- 29 araç × 40 satır = 1160 satır. PostgREST sonuçları 1000 satırda SESSİZCE
-- keser; tek çağrıda tüm filoyu istemek bazı araçların penceresini yarıda
-- kırpar ve bunu HİÇBİR HATA BİLDİRMEZ — kasadaki en pahalı hata sınıfı.
-- Bu yüzden çağıran taraf araç listesini parçalara böler:
--     parça = floor(900 / pencere)   → 40'lık pencerede 22 araç
-- 29 araç = 2 çağrı (29 yerine). Pencere değişirse parça boyu kendiliğinden
-- ayarlanır; sabit bir sayı yazmak o günü sessiz kırpmaya çevirirdi.
--
-- ═══ GERİYE UYUM ═══
-- Çalıştırılmasa da uygulama çalışır: toplu okuma null dönerse çağıran
-- araç-araç `latestVehicleTelemetry`'ye düşer ve davranış birebir aynı kalır
-- (060/061'de canlıda iki kez kanıtlanan desen).
-- =====================================================================

create or replace function public.latest_telemetry_batch(
  p_vehicle_ids uuid[],
  p_window      integer
)
returns table (
  vehicle_id       uuid,
  latitude         double precision,
  longitude        double precision,
  speed_kmh        double precision,
  heading          double precision,
  ignition_on      boolean,
  fuel_level_pct   double precision,
  odometer_km      double precision,
  engine_rpm       double precision,
  engine_load_pct  double precision,
  coolant_temp_c   double precision,
  fuel_consumption double precision,
  power_voltage    double precision,
  battery_voltage  double precision,
  gsm_signal       double precision,
  altitude_m       double precision,
  satellites       double precision,
  dtc_number       integer,
  recorded_at      timestamptz
)
language sql
stable
as $$
  select
    p.vehicle_id, p.latitude, p.longitude, p.speed_kmh, p.heading,
    p.ignition_on, p.fuel_level_pct, p.odometer_km, p.engine_rpm,
    p.engine_load_pct, p.coolant_temp_c, p.fuel_consumption,
    p.power_voltage, p.battery_voltage, p.gsm_signal, p.altitude_m,
    p.satellites, p.dtc_number, p.recorded_at
  from unnest(p_vehicle_ids) as v(id)
  cross join lateral (
    select
      dt.vehicle_id, dt.latitude, dt.longitude, dt.speed_kmh, dt.heading,
      dt.ignition_on, dt.fuel_level_pct, dt.odometer_km, dt.engine_rpm,
      dt.engine_load_pct, dt.coolant_temp_c, dt.fuel_consumption,
      dt.power_voltage, dt.battery_voltage, dt.gsm_signal, dt.altitude_m,
      dt.satellites, dt.dtc_number, dt.recorded_at
    from public.device_telemetry dt
    where dt.vehicle_id = v.id
    order by dt.recorded_at desc
    limit p_window
  ) as p
$$;

comment on function public.latest_telemetry_batch(uuid[], integer) is
  'Arac basina en yeni p_window telemetri satiri, TEK sorguda (#116b). Seyrek CAN alanlarinin birlestirilmesi SQL''e TASINMADI - kural JS''te tek kaynak. Cagiran, PostgREST 1000 satir tavanina karsi arac listesini floor(900/p_window) buyuklugunde parcalara bolmek ZORUNDA.';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  066_seferler.sql                                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 066 (SEFER / GÖREV ATAMA — Tur 1 temeli)
-- =====================================================================
-- Yönetici gün için sefer oluşturur, şoföre atar; şoför telefonda görür ve
-- durum çizgisini ilerletir. Additive + idempotent; mevcut hiçbir tabloya
-- DOKUNULMAZ. Supabase SQL Editor'da çalıştırın.
--
-- ⚠️ NUMARA: 064/065 diğer zincirde (FAZ C müşteri bölgesi + telemetri partisi).
-- Bu dosya o zincirden BAĞIMSIZ: zone_visits'e ne yazar ne okur.
--
-- ═══ NEDEN `assignments` (006) KULLANILMIYOR ═══
--
-- 006'daki tablo bir "çoklu duraklı sipariş" modeli: stops jsonb, start_km/
-- end_km, kategori (lieferung/abholung/kurier/verteilung), Telegram bildirim
-- damgası. Canlıda 0 satır — hiç kullanılmadı. Onaylanan model ise DURAK
-- LİSTESİ OLMAYAN, gün eksenli sade bir sefer. Eski tabloyu bu şekle zorlamak
-- kullanılmayan altı alanı taşımak ve durum makinesini (assigned/started/
-- completed/cancelled) yeniden yazmak demekti. 006 OLDUĞU GİBİ bırakılıyor;
-- panelin /admin/seferler sayfası bugünkü hâliyle çalışmaya devam eder.
--
-- ═══ NEDEN `tarih date`, timestamptz DEĞİL ═══
--
-- Sefer bir GÜN birimidir ("19 Ağustos, Wolfurt bölgesi, Ahmet"). Saatli bir
-- alan, olmayan bir kesinlik vaat ederdi ve kiracı diliminde (Europe/Vienna)
-- gün sınırı sorusunu her okumada yeniden doğururdu. Durumun NE ZAMAN
-- değiştiği ayrı damgalarda zaten saatli tutuluyor.
--
-- ═══ TEST VERİSİ ELEMESİ İÇİN KOLON YOK — BİLEREK ═══
--
-- Depodaki desen `worker_id` üzerinden eler (`lib/test-data.ts`
-- withoutTestRows(q, "worker_id", scope.workerIds)). `seferler.worker_id`
-- zorunlu olduğu için aynı süzgeç buraya da uygulanır; ikinci bir `is_test`
-- kolonu iki ayrı gerçek doğururdu.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Tabloya yalnız service-role
-- istemcisi yazar; okuma sunucu bileşenleri ve /api/mobile uçları üzerinden.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
create table if not exists public.seferler (
  id uuid primary key default gen_random_uuid(),

  -- Operasyon günü (kiracı takvimi). Sefer bir GÜN birimidir.
  tarih date not null,

  -- Kime atandı. Sefer şoförsüz var olamaz.
  worker_id uuid not null references public.workers(id) on delete cascade,

  -- Hangi araçla. Atama anında belli olmayabilir; araç silinirse sefer kalır.
  vehicle_id uuid references public.vehicles(id) on delete set null,

  -- Hedef bölge (geofences). Tur 1'de yalnız YAPISAL bağ: hiçbir motor bunu
  -- okumuyor. Otomatik "varıldı" köprüsü (zone_visits) Tur 3'ün işi.
  -- Bölge silinirse sefer kaybolmaz, hedefi boşalır.
  zone_id uuid references public.geofences(id) on delete set null,

  -- Planlanan paket adedi. null = hedef verilmedi (0 DEĞİL).
  paket_hedef integer check (paket_hedef is null or paket_hedef >= 0),

  -- Serbest not. ⚠️ Kolon adı `notlar`: `not` PostgreSQL'de REZERVE kelime,
  -- kolon adı olarak her yerde çift tırnak isterdi.
  notlar text,

  -- ── DURUM ÇİZGİSİ ────────────────────────────────────────────────────
  -- atandi → kabul → yolda → tamamlandi   (+ iptal: yalnız yönetici)
  -- "Reddet" YOK (Volkan kararı 3): şoför seferi reddedemez.
  durum text not null default 'atandi'
    check (durum in ('atandi','kabul','yolda','tamamlandi','iptal')),

  -- Her geçişin anı ayrı damgada: "ne zaman kabul etti", "yola ne zaman
  -- çıktı" soruları tek bir updated_at'ten cevaplanamaz.
  atandi_at     timestamptz not null default now(),
  kabul_at      timestamptz,
  yolda_at      timestamptz,
  tamamlandi_at timestamptz,
  iptal_at      timestamptz,

  -- Seferi kim oluşturdu (yalnız yönetici). Hesap silinirse sefer kalır.
  created_by uuid references public.workers(id) on delete set null,

  created_at timestamptz not null default now()
);

-- Günün seferleri: mobil listenin birincil sorgusu (tarih + şoför).
create index if not exists idx_seferler_tarih_worker
  on public.seferler (tarih desc, worker_id);

-- Şoförün AÇIK seferleri — kapanmış/iptal satırlar indekse hiç girmez.
create index if not exists idx_seferler_acik
  on public.seferler (worker_id, tarih)
  where durum in ('atandi','kabul','yolda');
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorgusu):
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='seferler'
--    order by ordinal_position;
--
--   → 15 satır: id, tarih, worker_id, vehicle_id, zone_id, paket_hedef,
--     notlar, durum, atandi_at, kabul_at, yolda_at, tamamlandi_at, iptal_at,
--     created_by, created_at
--
--   select count(*) from public.seferler;   → 0
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  067_first_ignition_batch.sql                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 067 — OTOMATİK VARDİYANIN "BUGÜNKÜ İLK KONTAK" OKUMASI TEK SORGUYA (#131b)
--
-- ═══ SORUN — VE NASIL GÖRÜLDÜ ═══
-- `lib/auto-shift.ts` → `firstIgnitionToday(vehicleId)`: otomatik başlatma
-- kapısını geçen HER araç için ayrı bir `device_telemetry` sorgusu.
--
-- Bu kalem #84 boyunca HİÇ görülmedi ve sebebi öğreticiydi: bütün ölçümler
-- `curl` ile ELLE tetiklenen turlardan alınıyordu. Cron 30 saniyede bir
-- koştuğu için el çağrısı hep bir turun hemen ardına düşüyor ve bu yol 8'de
-- kalıyordu. 20.08.2026'da ölçüm aracı değiştirildi — sayaç zaten her tur
-- `[flespi/sync] SORGU toplam=…` diye loglanıyordu — ve CRON'UN KENDİ turunda
-- gerçek şu çıktı:
--
--     gece turu (57 sorgu):  device_telemetry 22  +  workers 22   = 44
--     gündüz turu (56):      vehicle_dtc 23 baskın, bu yol 8'de
--
-- `workers` ayağı #131a ile migration'sız kapatıldı (8 → 1, canlıda ölçüldü).
-- Kalan ayak bu.
--
-- ═══ NEDEN SQL (JS'te toplanamıyor) ═══
-- İstenen şey araç başına "bugünün İLK kontak-açık satırı". PostgREST bunu
-- kuramaz (GROUP BY / DISTINCT ON yok). JS'te yapılabilecek tek şey günün tüm
-- kontak satırlarını çekip bellekte gruplamaktı — ama o SESSİZ KIRPMAYA açık:
-- 1000 satır tavanına yoğun bir araç tek başına dayanırsa başka bir aracın ilk
-- kontağı hiç görünmez ve o araç için vardiya YANLIŞ saatte açılır. Kasadaki
-- ders net: sessiz kırpma başarı gibi görünür. 060 ve 065 aynı gerekçeyle
-- SQL'e taşınmıştı; bu onların üçüncüsü.
--
-- LATERAL, `(vehicle_id, recorded_at)` indeksine araç başına TEK seek yapar.
--
-- ⚠️ `ignition_on` üzerinde ayrı bir indeks GEREKMEZ: seek zaten araç+zaman
-- üzerinden gidiyor, `ignition_on = true` süzgeci seek içinde uygulanıyor ve
-- pencere tek bir kiracı-günü. Yeni indeks eklemek yazma yolunu (turun en
-- yoğun kalemi olan telemetri partisini) yavaşlatırdı.
--
-- ═══ SÖZLEŞME ═══
-- Girdi : araç id listesi + kiracı-gününün başlangıcı (Viyana 04:00 sınırı
--         JS'te hesaplanır — `startOfTodayVienna()`; DST mantığı TEK YERDE
--         kalsın diye SQL'e taşınmadı).
-- Çıktı : araç başına bugünkü İLK kontak-açık anı. Bugün hiç kontak açmamış
--         araç SATIR DÖNDÜRMEZ (null değil) — "kontak yok" ile "sorgu
--         başarısız" birbirine karışmasın.
--
-- ═══ GERİYE UYUM ═══
-- Bu fonksiyon KOŞULMASA DA uygulama çalışır: `lib/auto-shift.ts` toplu okuma
-- null dönerse araç-araç eski yola (`firstIgnitionToday`) düşer ve davranış
-- birebir aynı kalır — yalnız kazanç gerçekleşmez. Deploy sırası serbest.
--
-- ⚠️ ÜÇ VERİTABANI VAR (bkz. Bekleyen-Isler #128): hak-transport-takip ·
-- galzura-demo · sendigo. "Koşuldu" üç ayrı kutucuktur.

create or replace function public.first_ignition_batch(
  p_vehicle_ids uuid[],
  p_day_start   timestamptz
)
returns table (
  vehicle_id   uuid,
  first_at     timestamptz
)
language sql
stable
as $$
  select v.id as vehicle_id, ilk.recorded_at as first_at
  from unnest(p_vehicle_ids) as v(id)
  cross join lateral (
    select dt.recorded_at
    from public.device_telemetry dt
    where dt.vehicle_id = v.id
      and dt.ignition_on = true
      and dt.recorded_at >= p_day_start
    order by dt.recorded_at asc
    limit 1
  ) as ilk
$$;

comment on function public.first_ignition_batch(uuid[], timestamptz) is
  'Otomatik vardiya: arac basina BUGUNUN ilk kontak-acik ani, TEK sorguda (#131b). Bugun kontak acmamis arac icin satir donmez.';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  068_zone_visit_zone_closed.sql                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 068 — ZİYARET KAPANIŞ SEBEBİNE 'zone_closed' EKLE (#136)
-- =====================================================================
-- ⚠️ 064 (zone_visits) uygulanmış olmalı.
--
-- ═══ NEDEN GEREKLİ ═══
-- 20.08.2026 canlı testinde görüldü: demo'da müşteri bölgesi pasifleştirilince
-- o bölgenin AÇIK ziyaretleri askıda kaldı. Sebep yapısal — hem ölçüm hem gap
-- bekçisi `active = true` müşteri bölgeleri kapısının ARDINDA çalışıyor; bölge
-- kapanınca o satırları kapatacak hiçbir yol kalmıyor ve fatura eki süresiz
-- "devam ediyor" satırı taşıyor.
--
-- Kod artık bölge pasifleştirildiğinde/arşivlendiğinde açık ziyaretleri
-- `ended_at = last_seen_at` ile kapatıyor. Ama bu kapanış, ötekilerden AYRI bir
-- şey söylüyor ve ayrı işaretlenmeli:
--
--   'exit'        → araç çıktı. Süre TAM.
--   'gap_timeout' → cihaz sustu. Süre EKSİK olabilir — araç hâlâ içeride
--                   olabilirdi, bilmiyoruz.
--   'zone_closed' → ÖLÇÜMÜ BİZ DURDURDUK. Süre EKSİK olabilir — araç hâlâ
--                   içerideydi, ama artık ölçmüyoruz.
--
-- Son ikisi "bu süre eksik olabilir" der; SEBEPLERİ farklıdır ve raporda ayrı
-- rozet taşırlar. Üçünü tek etikete koymak, ölçümü kendi kararımızla
-- kestiğimizi müşteriden gizlerdi.
--
-- ═══ 068 KOŞULMAZSA NE OLUR ═══
-- Kod düşer ama DURMAZ: CHECK reddedince (23514) satır **sebepsiz** kapanır.
-- Ziyaret yine askıda kalmaz, yalnız raporda "Ölçüm durdu" rozeti çıkmaz.
-- Yani bu migration doğruluk için değil, ŞEFFAFLIK için gerekli.
--
-- ⚠️ ÜÇ VERİTABANI VAR (bkz. Bekleyen-Isler #128): hak-transport-takip ·
-- galzura-demo · sendigo. "Koşuldu" üç ayrı kutucuktur.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- Kısıt adı 064'te açıkça verilmişti; yine de adı VARSAYMAK yerine
-- `end_reason` üzerindeki CHECK bulunup düşürülüyor (tekrar çalıştırılabilir).
do $$
declare k text;
begin
  select con.conname into k
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public'
     and rel.relname = 'zone_visits'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%end_reason%'
   limit 1;
  if k is not null then
    execute format('alter table public.zone_visits drop constraint %I', k);
  end if;
end $$;

alter table public.zone_visits
  add constraint zone_visits_end_reason_check
  check (end_reason in ('exit','gap_timeout','shift_end','zone_closed'));
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  069_geofence_category_repair.sql                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 069 — 063'ÜN ONARIMI: `geofences.category` her kurulumda GERÇEKTEN olsun
-- =====================================================================
-- ═══ NEDEN GEREKLİ — CANLIDA ÖLÇÜLDÜ (20.08.2026) ═══
-- Demo'da `GET /api/mobile/geofences` **503** veriyor. Panel çalışıyor, çünkü
-- `app/actions/geofences.ts` → `selectZones` `category` kolonunu OKUMUYOR;
-- mobil yol (`lib/geofences-db.ts` → `listGeofences`) okuyor. Yani 063 demo'da
-- uygulanmamış ve bu, beş mobil bölge ucunu sessizce ölü bırakmış.
--
-- ═══ 063 NEDEN YARIM KALMIŞ OLABİLİR (kuvvetli şüphe) ═══
-- 063'ün son adımı şu indeksi kuruyor:
--     create index ... on public.geofences (active) where archived_at is null;
-- ama `archived_at` kolonunu KENDİSİ eklemiyor — daha eski bir migration'ın
-- eklediğini varsayıyor. O migration koşmamış bir veritabanında bu satır
-- hata verir; 063 tek bir `begin/commit` içinde olduğu için **tamamı geri
-- alınır** ve `category` de eklenmemiş olur. Dışarıdan görünen tek belirti
-- mobil uçların 503 vermesidir — kimse bakmazsa aylarca sürer.
--
-- Bu dosya o zinciri kırar: eksik olabilecek HER parçayı ayrı ayrı ve
-- koşulsuz-güvenli biçimde tamamlar.
--
-- ═══ GÜVENLİK ═══
-- • IDEMPOTENT: istediğin kadar çalıştır, ikincisi hiçbir şey yapmaz.
-- • Bölge SİLMEZ, TAŞIMAZ, yarıçap/merkez/amaç DEĞİŞTİRMEZ.
-- • Geriye doldurma DAR: yalnız hâlâ varsayılan `custom` değerinde duran
--   satırlara dokunur. Elle değiştirilmiş bir kategori EZİLMEZ.
-- • 063 zaten uygulanmış bir veritabanında (HAK61) çalıştırmak zararsızdır ve
--   hiçbir satırı değiştirmez.
--
-- ⚠️ ÜÇ VERİTABANI VAR (bkz. Bekleyen-Isler #128): hak-transport-takip ·
-- galzura-demo · sendigo. "Koşuldu" üç ayrı kutucuktur. Bu dosyanın asıl
-- hedefi **galzura-demo**.
--
-- Salt-okuma envanter için: db/maintenance/sema-envanteri.sql
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ── 1) archived_at ───────────────────────────────────────────────────
-- 063'ün varsaydığı ama eklemediği kolon. Önce bu gelir, yoksa aşağıdaki
-- kısmi indeks patlar ve tüm işlem geri alınır (bkz. yukarıdaki şüphe).
alter table public.geofences
  add column if not exists archived_at timestamptz;

-- ── 2) category ──────────────────────────────────────────────────────
-- Mobil bölge uçlarının okuduğu kolon. NOT NULL + varsayılan 'custom':
-- mevcut satırlar otomatik dolar, yazma yolları değişmeden çalışır.
alter table public.geofences
  add column if not exists category text not null default 'custom';

-- ── 3) CHECK kısıtı ──────────────────────────────────────────────────
-- Kısıt adını VARSAYMAK yerine `category` üzerindeki mevcut CHECK bulunup
-- düşürülüyor, sonra doğru hâliyle ekleniyor. Böylece dosya, kısıt farklı bir
-- adla oluşturulmuş bir veritabanında da tekrar çalıştırılabilir kalıyor
-- (064'te aynı desen `purpose` için kullanıldı).
do $$
declare k text;
begin
  select con.conname into k
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public'
     and rel.relname = 'geofences'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%category%'
   limit 1;
  if k is not null then
    execute format('alter table public.geofences drop constraint %I', k);
  end if;
end $$;

alter table public.geofences
  add constraint geofences_category_check
  check (category in ('depot','customer','restricted','custom'));

-- ── 4) GERİYE DOLDURMA ───────────────────────────────────────────────
-- 063'ün yaptığının aynısı, AYNI dar koşulla: yalnız varsayılanda duran
-- depo bölgeleri etiketlenir.
update public.geofences
   set category = 'depot'
 where purpose = 'depot' and category = 'custom';

-- 064'ten sonra doğan müşteri bölgeleri de rozetine kavuşsun. `category` bir
-- ROZET, `purpose` DAVRANIŞTIR (064 kararı) — bu satır davranışı değiştirmez,
-- yalnız rozeti davranışla tutarlı hâle getirir.
update public.geofences
   set category = 'customer'
 where purpose = 'customer' and category = 'custom';

-- ── 5) İndeks ────────────────────────────────────────────────────────
-- Arşivli olmayan bölgelerin listelenmesi (063'ün son adımı).
create index if not exists idx_geofences_not_archived
  on public.geofences (active)
  where archived_at is null;
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- ── SONUÇ — koştuktan sonra bunu da çalıştır, çıktıyı bildir ─────────
select category, purpose, count(*) as adet
  from public.geofences
 group by category, purpose
 order by 1, 2;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  070_sefer_koprular.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 — Migration 070 (SEFER TUR 3 — OTOMATİK KÖPRÜLER)
-- =====================================================================
-- Seferin iki alanı ARTIK ELLE DOLDURULMUYOR:
--   · vardi_at         → araç hedef bölgeye VARDI (zone_visits'ten okunur)
--   · paket_gerceklesen→ o günün vardiyasında girilen teslim sayısı
--
-- Additive + idempotent. `seferler` dışında HİÇBİR tabloya dokunulmaz;
-- zone_visits ve shift_packages YALNIZ OKUNUR. Supabase SQL Editor'da
-- çalıştırın.
--
-- ⚠️ NUMARA: bu dosya Volkan'a "069" olarak verildi ve canlıda O HÂLİYLE
-- çalıştırıldı. Aynı anda diğer zincir de 069'u aldı
-- (069_geofence_category_repair.sql, main'e önce girdi), o yüzden REPO
-- DOSYASI 070'e taşındı. ⚠️ DDL BAYT BAYT AYNI — veritabanında değişen
-- hiçbir şey yok, yalnız kurulum sırası tekilleşti.
-- 067/068 de diğer zincirde. Bu dosya onlardan BAĞIMSIZ; yalnız 066'nın
-- (seferler) ve 064'ün (zone_visits) var olmasını bekler.
--
-- ═══ NEDEN YENİ DURUM DEĞİL, BİLGİ DAMGASI ═══
--
-- "vardi" bir DURUM olsaydı çizgi atandi→kabul→vardi→yolda→tamamlandi olur
-- ve şoförün elle ilerlettiği akışa, ŞOFÖRÜN BASMADIĞI bir adım girerdi.
-- O zaman "şoför yolda'ya basmadan sistem vardi yazdı" gibi bir sıra sorunu
-- doğar, geçiş kuralları (Tur 1 İK2) ikiye bölünürdü. Varış bir OLAY: oldu ya
-- da olmadı. Durum çizgisi Tur 1'deki gibi AYNEN kalıyor.
--
-- ═══ NEDEN DAMGA BİR KEZ DÜŞER ═══
--
-- Araç bölgeye gün içinde üç kez girip çıkabilir (park, ikinci teslim, geri
-- dönüş). "İlk varış" tek ve tekrar etmez; damgayı her ziyarette güncellemek
-- "ne zaman vardı" sorusunun cevabını akşama kaydırırdı. Yazma koşulu
-- `vardi_at is null` — köprü idempotenttir, aynı turda iki kez koşsa da
-- ikinci kez yazmaz.
--
-- ═══ NEDEN zone_visit id'si SAKLANMIYOR ═══
--
-- Sefer bir GÜN birimi ve hedefi TEK bölge; "hangi ziyaret" sorusu
-- (zone_id, vehicle_id, gün) üçlüsüyle zaten cevaplanabiliyor. Bir FK daha
-- eklemek ziyaret silindiğinde damgayı da düşürme/koruma kararı doğururdu —
-- oysa damga bir OLAY kaydı: ziyaret satırı sonradan temizlense bile "o gün
-- vardı" doğru kalmalı.
--
-- ═══ NEDEN paket_gerceklesen AYRI KOLON, time_entries'ten TÜRETME DEĞİL ═══
--
-- Türetseydik her okumada "o günün hangi vardiyası" kuralını yeniden
-- uygulamak gerekirdi ve kural iki yerde yaşardı; kolon, bağlamanın SONUCUNU
-- tek yerde tutuyor.
--
-- ⚠️ DEĞER DONDURULMAZ, TAZELENİR (ilk taslakta tersi yazıyordu — DDL aynı,
-- yorum uygulanan davranışa göre düzeltildi). Yönetici `cargo_count`u
-- sonradan düzeltebiliyor (shift_edit_log); dondursaydık sefer, düzeltilmiş
-- vardiyanın YANLIŞ sayısını taşımaya devam ederdi. Köprü hedef seferi her
-- çağrıda yeniden çözer ve yalnız O seferin değerini günceller; başka hiçbir
-- seferin değeri elle sürülmez (bkz. lib/sefer-bridge.ts).
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
alter table public.seferler
  -- Hedef bölgeye VARIŞ anı (zone_visits.started_at'ten kopyalanır).
  -- null = henüz varılmadı ya da hedef bölge tanımsız.
  add column if not exists vardi_at timestamptz,

  -- O günün vardiyasından bağlanan teslim sayısı (time_entries.cargo_count).
  -- null = henüz bağlanmadı; 0 GEÇERLİ bir değerdir ("hiç teslim edilmedi").
  add column if not exists paket_gerceklesen integer
    check (paket_gerceklesen is null or paket_gerceklesen >= 0);
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- İNDEKS EKLENMEDİ — BİLEREK
--
-- Köprü sorgusu günün seferlerini `tarih` ile okuyor; 066'daki
-- idx_seferler_tarih_worker bunu zaten karşılıyor. Tablo günde ~30 satır
-- büyüyor; `vardi_at is null` için ayrı bir kısmi indeks, kazanmadığı bir
-- yazma maliyeti eklerdi. Tablo büyürse ölçülüp eklenir.
-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorgusu):
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='seferler'
--      and column_name in ('vardi_at','paket_gerceklesen');
--
--   → 2 satır:
--       vardi_at            timestamptz  YES
--       paket_gerceklesen   integer      YES
--
--   select count(*) from public.seferler where vardi_at is not null;  → 0
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  071_messaging.sql                                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 071_messaging.sql — UYGULAMA İÇİ MESAJLAŞMA (yönetici ↔ şoför)
--
-- ⚠️ BU DDL HENÜZ ÇALIŞTIRILMADI. Volkan Supabase'de çalıştıracak.
--    Claude tarafından çalıştırılmadı; bu dosya deponun ŞEMA KAYDIDIR.
--
-- ── NE ÇÖZÜYOR ─────────────────────────────────────────────────────────────
-- Telegram katmanı 20.08.2026'da tamamen söküldü ve o günden beri sistemde
-- şoföre ULAŞAN HİÇBİR KANAL YOK: veri tek yönlü akıyor (şoför üretir, yönetici
-- okur). `driver_reports` (020) var ama tek yönlü ve dört sabit seçenekli;
-- serbest metin yok, cevap yok.
--
-- ── KURAL: ŞOFÖRLER BİRBİRİYLE MESAJLAŞAMAZ ────────────────────────────────
-- Bu kural ŞEMAYA gömülü, koda değil. `conversations.worker_id` UNIQUE ve
-- konuşmanın sahibi DAİMA bir şofördür; şoför-şoför konuşması TEMSİL EDİLEMEZ.
-- Bir kontrol satırı unutulabilir, tablo şekli unutulamaz.
--
-- ── NEDEN ŞOFÖR BAŞINA TEK KONUŞMA, (yönetici,şoför) ÇİFTİ BAŞINA DEĞİL ────
-- Şoför alıcı SEÇMEZ — "Yönetim"e yazar. Çift ekseninde kursaydık aynı şoför
-- üç yöneticiyle üç ayrı geçmiş taşırdı: "bunu kime söylemiştim" sorusunun
-- cevabı kaybolurdu ve yönetici devri geçmişi parçalardı. Samsara ve Motive'in
-- şoför tarafı da alıcı seçtirmiyor (dispatch tek muhatap).
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- Kapalı — deponun kuralı. Bu kurulumda anon key YOK ve RLS politikası 0;
-- tüm erişim service-role ile sunucudan geçiyor, yetki uygulama kodunda
-- (lib/mobile-scope.ts, lib/session.ts). Burada RLS AÇMAK yanlış güven
-- duygusu verirdi: politika yazılmadan açılan RLS hiçbir şey korumaz.
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ── 1) conversations — şoför başına TEK konuşma ────────────────────────────
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),

  -- KONUŞMANIN SAHİBİ = ŞOFÖR. UNIQUE: bir şoförün tek konuşması olur.
  -- on delete cascade: personel silinirse konuşması da gider (GDPR md. 17
  -- silme yolu). "Ayrılan personel" için silme DEĞİL is_active=false
  -- kullanılıyor (032) — o kişinin geçmişi durur.
  worker_id uuid not null unique
    references public.workers(id) on delete cascade,

  -- DENORMALİZE — yönetici listesi için. 1000 şoförlü filoda liste ekranı
  -- her satır için "son mesaj" sorgusu atsaydı 1000 sorgu olurdu; burada tek
  -- sorgu + tek indeks. Mesaj yazılırken güncellenir.
  last_message_at      timestamptz,
  last_message_preview text,
  last_sender_role     text check (last_sender_role in ('driver', 'admin')),

  created_at timestamptz not null default now()
);

-- ── 2) messages ────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,

  -- GERÇEKTE YAZAN KİŞİ. on delete set null: personel silinse bile mesaj
  -- konuşmada kalır — karşı taraf için "cevap gelmiş miydi" sorusunun cevabı
  -- kaybolmamalı. Kim olduğu düşer, ne dediği kalır.
  sender_worker_id uuid references public.workers(id) on delete set null,

  -- GÖNDERİM ANINDA DONDURULUR. Kişinin rolü sonradan değişebilir (şoför
  -- şef olur, yönetici yetkisi alınır); o değişiklik GEÇMİŞ mesajın kimden
  -- geldiğini değiştirmemeli. Aynı gerekçe: zone_visits.worker_id dondurma.
  sender_role text not null check (sender_role in ('driver', 'admin')),

  -- Boş mesaj gönderilemez; tavan 4000 karakter. Sınır ŞEMADA da var çünkü
  -- istemci doğrulaması atlanabilir ve sınırsız metin bir DoS yüzeyidir.
  body text not null check (char_length(btrim(body)) between 1 and 4000),

  -- FİLO DUYURUSU: tek duyuru her şoförün konuşmasına BİRER satır olarak
  -- yazılır, hepsi aynı broadcast_id'yi taşır. Neden dağıtım: okuma modeli
  -- tekdüze kalır, okundu durumu şoför başına doğal olur, gelen cevap zaten
  -- kendi konuşmasına düşer. 500 şoför = 500 satır, önemsiz.
  broadcast_id uuid,

  -- ── SAKLAMA VE SİLME ─────────────────────────────────────────────────────
  -- GDPR md. 5(1)(e): saklama süresi TANIMLANMAK ZORUNDA. Süre dolduğunda
  -- silen süpürge `legal_hold = true` satırlara DOKUNMAZ. Gerekçesi somut:
  -- şoför sohbete "kaza yaptım" yazarsa o mesaj bir kayıttır ve saklama
  -- süresi dolduğu için sessizce yok edilmesi kabul edilemez.
  legal_hold boolean not null default false,

  -- Yumuşak silme (moderasyon + GDPR). Satırı gerçekten silmek "buradan bir
  -- mesaj kaldırıldı" bilgisini de yok ederdi.
  deleted_at timestamptz,
  deleted_by uuid references public.workers(id) on delete set null,

  created_at timestamptz not null default now()
);

-- ── 3) message_receipts — MESAJ BAŞINA ✓✓ ──────────────────────────────────
--
-- NEDEN AYRI TABLO, NEDEN messages.read_at DEĞİL: şoförün yazdığı bir mesajı
-- BİRDEN ÇOK yönetici okuyabilir. Tek kolon "Volkan okudu, Serkan okumadı"
-- durumunu ifade edemez ve ikinci yöneticinin okumamış olması görünmez olurdu.
--
-- ⚠️ NEXT_PUBLIC_READ_RECEIPTS_ENABLED=false olan kurulumda bu tabloya
-- HİÇBİR SATIR YAZILMAZ (uç seviyesinde, arayüzde gizleyerek değil). Avusturya
-- §96(1)3 ArbVG / Almanya §87 BetrVG: çalışanı izleyen teknik sistem işyeri
-- konseyi onayına bağlı. "Tutmuyoruz" diyip yazmaya devam etmek yanlış beyan
-- olurdu — bu yüzden kapı yazma yolunda.
create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  worker_id  uuid not null references public.workers(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, worker_id)
);

-- ── İNDEKSLER ──────────────────────────────────────────────────────────────

-- Konuşma ekranı: son N mesaj, sayfalı.
create index if not exists idx_messages_conversation
  on public.messages (conversation_id, created_at desc);

-- Yönetici liste ekranı: en son konuşulan üstte. NULLS LAST — hiç mesajı
-- olmayan konuşma (yeni açılmış) listenin sonunda kalır.
create index if not exists idx_conversations_recent
  on public.conversations (last_message_at desc nulls last);

-- Duyurunun kopyalarını toplamak (yönetici "bu duyuruyu kim okudu").
create index if not exists idx_messages_broadcast
  on public.messages (broadcast_id)
  where broadcast_id is not null;

-- Okunmamış sayacı: "bana ait makbuzu OLMAYAN mesajlar" (NOT EXISTS).
-- PK (message_id, worker_id) bu yönde işe yaramaz; ters sıra gerekiyor.
create index if not exists idx_receipts_worker
  on public.message_receipts (worker_id, message_id);

-- Saklama süpürgesi: dokunulabilir satırları taramak. Kısmi indeks, çünkü
-- legal_hold ve silinmiş satırlar süpürgenin ilgi alanı dışında.
create index if not exists idx_messages_retention
  on public.messages (created_at)
  where legal_hold = false and deleted_at is null;

-- ── RLS: deponun kuralı (yukarıdaki nota bakın) ────────────────────────────
alter table public.conversations    disable row level security;
alter table public.messages         disable row level security;
alter table public.message_receipts disable row level security;

comment on table public.conversations is
  'Sofor basina TEK konusma. worker_id UNIQUE oldugu icin sofor-sofor '
  'mesajlasmasi semada TEMSIL EDILEMEZ.';
comment on column public.messages.sender_role is
  'Gonderim aninda dondurulur — kisinin rolu sonradan degisse bile gecmis '
  'mesajin kimden geldigi degismez.';
comment on column public.messages.legal_hold is
  'true ise saklama supurgesi DOKUNMAZ (kaza/ihtilaf kaydi).';
comment on table public.message_receipts is
  'Mesaj basina okundu (✓✓). NEXT_PUBLIC_READ_RECEIPTS_ENABLED=false olan '
  'kurulumda hic satir yazilmaz (DACH §96 ArbVG / §87 BetrVG).';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  072_worker_fleet.sql                                               ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 072_worker_fleet.sql — ŞOFÖRÜN FİLO BAĞLILIĞI (araçtan bağımsız)
--
-- ⚠️ BU DDL HENÜZ ÇALIŞTIRILMADI. Volkan Supabase'de çalıştıracak.
--    071'den BAĞIMSIZ — sırası önemli değil, ikisi ayrı konu.
--
-- ── HANGİ ARIZAYI KAPATIYOR ────────────────────────────────────────────────
-- Filo şefinin kapsamı bugüne kadar YALNIZ `vehicles.assigned_worker_id`'den
-- türüyordu (lib/fleet-scope.ts getFleetScope). Sessiz sonucu: aracı atanmamış
-- şoför HİÇBİR şefin kapsamına girmiyor. Şefi onu göremiyor, izin talebini
-- onaylayamıyor, raporunda bulamıyor, mesaj atamıyor.
--
-- CANLIDA ÖLÇÜLDÜ (HAK61, 22.08.2026): 28 şoförün 2'si bu durumdaydı ve
-- BİRİ O AN AÇIK VARDİYADAYDI, son kullandığı araç bordo filosundandı.
-- Delik teorik değildi — o gün ısırıyordu.
--
-- ── NEDEN YENİ KOLON ───────────────────────────────────────────────────────
-- Şoföru filoya bağlayan bir alan YOKTU; "araç = kimlik" HAK61'in tesadüfi
-- durumuydu, tasarım kararı değil. Dünya ölçeğinde araçsız şoför kuraldır:
-- havuz filosu, yeni işe giren, aracı serviste olan, yalnız römork çeken.
--
-- Kolaycı alternatif — "araçsız şoför TÜM şeflere görünsün" — reddedildi:
-- o kişinin vardiyası, km'si ve olayı İKİ filonun raporunda birden sayılırdı.
-- Bağlılık AÇIKÇA tutulmalı.
--
-- ── GERİYE DÖNÜK ETKİ: SIFIR ───────────────────────────────────────────────
-- Aşağıdaki geri dolgu kolonu MEVCUT araç atamasından türetiyor. Yani atanmış
-- 26 şoför için kapsam BİREBİR AYNI kalır (aynı kişi hem araç yolundan hem
-- kolon yolundan gelir, küme değişmez). Değişen tek şey araçsızların artık
-- görünmesi.
--
-- Kod bu migration OLMADAN da çalışır: kolon yoksa sorgu hata verir ve kapsam
-- bugünkü hâliyle devam eder (lib/fleet-scope.ts, missing-column dalı).
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- Alan adı `vehicles.fleet` ile AYNI ve aynı kısıtı taşıyor: iki tabloda iki
-- farklı filo sözlüğü olamaz. NULL = bağlılık bilinmiyor.
alter table public.workers
  add column if not exists fleet text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workers_fleet_check'
  ) then
    alter table public.workers
      add constraint workers_fleet_check
      check (fleet is null or fleet in ('bordo', 'mavi'));
  end if;
end $$;

-- ── GERİ DOLGU 1: mevcut araç ataması ──────────────────────────────────────
-- Bugün kapsamda olan herkes kolonda da aynı filoya düşer → davranış aynı.
update public.workers w
set    fleet = v.fleet
from   public.vehicles v
where  v.assigned_worker_id = w.id
  and  v.is_test is not true
  and  w.is_test is not true      -- test hesabina gercek filo YAZILMAZ
  and  v.fleet in ('bordo', 'mavi')
  and  w.fleet is null;           -- yeniden kosulabilir: dolu satiri ezmez

-- ── GERİ DOLGU 2: aracı yoksa SON KULLANDIĞI aracın filosu ─────────────────
-- Araçsız şoförün bağlılığı tahmin edilmiyor, GEÇMİŞTEN OKUNUYOR: en son
-- hangi filonun aracıyla vardiya açtıysa o filoya bağlanır. HAK61 ölçümünde
-- bu, açık vardiyadaki şoförü doğru filoya (bordo) koyuyor.
-- Hiç vardiyası olmayanda NULL kalır — uydurmuyoruz.
update public.workers w
set    fleet = son.fleet
from (
  select distinct on (t.worker_id)
         t.worker_id, v.fleet
  from   public.time_entries t
  join   public.vehicles v on v.id = t.vehicle_id
  where  v.fleet in ('bordo', 'mavi')
    and  v.is_test is not true
  order  by t.worker_id, t.started_at desc
) son
where son.worker_id = w.id
  and w.fleet is null
  and w.is_test is not true;

-- Şefin kapsam sorgusu: fleet + is_active + test dışı.
create index if not exists idx_workers_fleet
  on public.workers (fleet)
  where fleet is not null;

comment on column public.workers.fleet is
  'Soforun filo bagliligi — ARACTAN BAGIMSIZ. Araci atanmamis sofor de '
  'sefin kapsaminda kalsin diye (22.08.2026 olcumu: 2/28 sofor kapsam '
  'disiydi, biri acik vardiyadaydi). NULL = baglilik bilinmiyor.';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
-- ── ÇALIŞTIRILDI: 22.08.2026 · SONUÇ ÖLÇÜLDÜ ───────────────────────────────
--
--   fleet=bordo : 10 (aktif  9 · pasif 1)
--   fleet=mavi  : 19 (aktif 18 · pasif 1)
--   fleet=NULL  :  4 (hepsi aktif — 3 yonetici + 1 hic vardiyasi olmayan sofor)
--
-- Sef kapsami: bordo 9→11, mavi 19→20. HICBIR SEFIN KAPSAMINDA OLMAYAN
-- SOFOR: 2 → 0. Aracsiz ama acik vardiyadaki sofor son kullandigi aracin
-- filosuna (bordo) doğru sekilde baglandi. Test hesabi NULL kaldi ve hicbir
-- kapsama sizmadi.
--
-- Geri dolgu PASIF calisani da dolduruyor (is_active suzmuyor) — bilincli:
-- arac hala ustunde duran pasif kisi bugun de sefin kapsaminda ve kolon
-- bunu degistirmemeli.
--
-- Dogrulama sorgusu (yeniden kosulabilir):
--
--   select coalesce(fleet, '(NULL)') as filo,
--          count(*) filter (where is_active)     as aktif,
--          count(*) filter (where not is_active) as pasif
--   from public.workers
--   where is_test is not true
--   group by 1 order by 1;
--
-- ── NULL KALAN SOFOR NE OLUR ───────────────────────────────────────────────
-- Filosu bilinmeyen sofor HER SEFIN kapsamindadir (lib/fleet-scope.ts, "IKI
-- KATMAN"). Gorunmez birakmak, kapatmak icin bu migration'i yazdigimiz
-- deligin aynisini yeni personel icin acik tutardi; bu depoda sessiz eksik
-- yasak. Cift gorunme kabul edildi ve gurultuludur: kisiye panelden filo
-- atanir atanmaz kendiliginden duzelir.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  073_messaging_groups.sql                                           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 073_messaging_groups.sql — GRUP MESAJLAŞMASI (yönetici kurar, şoförler grup içinde konuşur)
--
-- ⚠️ BU DDL HENÜZ ÇALIŞTIRILMADI. Volkan Supabase'de çalıştıracak.
--    Claude tarafından çalıştırılmadı; bu dosya deponun ŞEMA KAYDIDIR.
--
-- ── NE EKLİYOR ─────────────────────────────────────────────────────────────
-- 071 "şoför başına TEK konuşma" kuruyordu (conversations.worker_id UNIQUE).
-- Grup bunu kırıyor: 5 şoförü ortak bir işe yönlendirmek için tek mesaj.
--
-- ── NEDEN AYRI `groups` TABLOSU DEĞİL ──────────────────────────────────────
-- Ayrı tablo, mesaj + makbuz + okunmamış sayacı + önizleme + saklama süpürgesi
-- + legal_hold makinesinin TAMAMINI ikinci kez yazmayı gerektirirdi ve her
-- okuma yolu bir UNION olurdu. Burada tek `conversations` tablosuna TİP
-- ekleniyor: `messages` ve `message_receipts` HİÇ DEĞİŞMİYOR. Grup mesajı
-- sıradan bir mesajdır, yalnız conversation_id'si bir gruba işaret eder.
--
-- ── "ŞOFÖRLER BİRBİRİYLE MESAJLAŞAMAZ" KURALI DURUYOR ──────────────────────
-- Kural 071'de şemaya gömülüydü ve BOZULMUYOR: `direct` konuşmanın sahibi
-- hâlâ tek bir şofördür (aşağıdaki CHECK bunu zorunlu kılıyor). Grup AÇIKÇA
-- farklı bir tür ve üyeliği açık — türetilmiş değil. Gruptan birebir sohbete
-- giden yol YOKTUR: şoför grupta başka şoförü görür ama onun `direct`
-- konuşmasına erişemez (lib/messaging.ts erisimCoz, kendi kimliği kuralı).
--
-- ── GERİYE DÖNÜK ETKİ: SIFIR ───────────────────────────────────────────────
-- Tamamı eklemeli. `kind` varsayılanı mevcut satırları kendiliğinden 'direct'
-- yapar; tek satır yeniden yazılmaz. 22.08.2026 ölçümü: conversations 0,
-- messages 0, message_receipts 0 satır — CHECK zaten trivial olarak sağlanır.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- Kapalı — deponun kuralı (anon key yok, RLS politikası 0, yetki uygulama
-- kodunda). 071'in aynı gerekçesi.
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ── 1) conversations — TİP KAZANIYOR ───────────────────────────────────────

alter table public.conversations
  add column if not exists kind text not null default 'direct';

-- Grup adı. `direct` konuşmada NULL (muhatabın adı workers'tan geliyor).
alter table public.conversations
  add column if not exists title text;

alter table public.conversations
  add column if not exists created_by uuid references public.workers(id) on delete set null;

-- ── ARŞİV = SİLME DEĞİL ────────────────────────────────────────────────────
-- Grup silinmez, arşivlenir: herkes için SALT OKUNUR olur, geçmiş bozulmaz.
-- Gerekçe deponun mevcut felsefesi (messages.deleted_at, legal_hold,
-- action_snoozes.cancelled_at): "silmek kim ne yaptı bilgisini de yok eder".
-- Grup akışı bir OPERASYON KAYDIDIR — sevkiyat talimatları orada duruyor.
alter table public.conversations
  add column if not exists archived_at timestamptz;
alter table public.conversations
  add column if not exists archived_by uuid references public.workers(id) on delete set null;

-- `worker_id` artık zorunlu DEĞİL — grupta sahip yok.
-- ⚠️ UNIQUE kısıtına DOKUNULMUYOR ve bu bilinçli: PostgreSQL unique kısıtında
-- BİRDEN ÇOK NULL'a izin verir, yani gruplar (worker_id IS NULL) birbiriyle
-- çakışmaz. Kısıtı düşürüp kısmi indeksle yeniden kurmak aynı sonucu verirdi
-- ama "şoför başına tek konuşma" güvencesini bir an için ortadan kaldırırdı.
alter table public.conversations
  alter column worker_id drop not null;

-- ── BİÇİM KISITI — ASIL KORUMA BURADA ──────────────────────────────────────
-- direct ⇒ sahibi var, başlığı yok.   group ⇒ sahibi yok, başlığı var.
-- Bu kısıt olmadan "başlıklı ama sahipli" ya da "sahipsiz ve başlıksız" gibi
-- anlamsız satırlar yazılabilirdi ve okuma yolları sessizce yanlış davranırdı.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_kind_check') then
    alter table public.conversations
      add constraint conversations_kind_check
      check (kind in ('direct', 'group'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_shape_check') then
    alter table public.conversations
      add constraint conversations_shape_check
      check (
        (kind = 'direct' and worker_id is not null and title is null)
        or
        (kind = 'group'  and worker_id is null     and title is not null)
      );
  end if;
end $$;

-- ── 2) conversation_members — GRUP ÜYELİĞİ ─────────────────────────────────
--
-- ⚠️ ÇIKARILAN ÜYENİN SATIRI SİLİNMEZ, `left_at` İŞARETLENİR.
-- WhatsApp davranışı: çıkarılan kişi grubu listesinde görmeye devam eder,
-- geçmişi okur, yeni mesaj almaz. Filo ürününde ek ve daha güçlü gerekçe:
-- o şoföre o grupta bir TALİMAT verildi ("yarın 06:30 A deposu"). Gruptan
-- çıkarmak, ona söylenmiş şeyi ekranından silmemeli — 071'deki "kaza yaptım
-- kaydını sessizce yok etme" sorununun aynısı.
--
-- Okuma penceresi: üye `left_at`'ten SONRAKİ mesajları GÖRMEZ. Süzgeç uygulama
-- kodunda (messages.created_at <= left_at); şemada tutulamaz çünkü aynı mesaj
-- farklı üyeler için farklı görünürlükte.
create table if not exists public.conversation_members (
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,
  worker_id uuid not null
    references public.workers(id) on delete cascade,

  joined_at timestamptz not null default now(),
  -- Kim ekledi — yetki tartışmasında "bunu kim yaptı" sorusunun cevabı.
  added_by uuid references public.workers(id) on delete set null,
  -- null = AKTİF üye. Dolu = çıkarıldı; geçmişi bu ana kadar okur.
  left_at timestamptz,
  -- Kim çıkardı. Çıkarılma bir yönetici kararıdır ve izi kalır.
  removed_by uuid references public.workers(id) on delete set null,

  -- PK çifti: aynı kişi iki kez eklenemez. Yeniden ekleme `left_at`'i
  -- temizler (upsert), yeni satır AÇMAZ — yoksa "kaç kez çıkarıldı" gürültüsü
  -- üyelik sorgusunu belirsizleştirirdi.
  primary key (conversation_id, worker_id)
);

-- ── 3) ARŞİV KİLİDİ — ŞEMAYA GÖMÜLÜ ────────────────────────────────────────
--
-- Arşivlenmiş grupta HİÇ KİMSE yazamaz: şoför de, şef de, patron da.
--
-- ⚠️ BU TETİKLEYİCİ UÇ KAPISININ YERİNE GEÇMEZ, ALTINA KONULUYOR.
-- Uç (POST /messages/[id]) arşivi ÖNCE denetleyip temiz bir 409 döndürecek;
-- bu tetikleyici, o kapının unutulduğu ya da atlandığı her yol için son hat:
-- yeni bir uç, duyuru dağıtımı, elle çalıştırılan bir SQL. Deponun kuralı
-- budur — koruma "kapı eklemekle" değil, YAPISAL OLARAK MÜMKÜN OLMAMAKLA
-- sağlanır (bkz. conversations.worker_id UNIQUE = şoför-şoför sohbeti yok).
--
-- SQLSTATE 'HK001' özel bir sınıf (PostgreSQL 'HK' sınıfını kullanmıyor).
-- Uç bunu yakalarsa 409 'conversation_archived' döndürmeli; yakalamazsa
-- 500 write_failed olur ve detayda bu mesaj görünür — sessiz başarı ASLA.
create or replace function public.mesaj_arsive_yazilamaz()
returns trigger
language plpgsql
as $$
declare
  ark timestamptz;
begin
  select archived_at into ark
  from public.conversations
  where id = new.conversation_id;

  if ark is not null then
    raise exception
      'arsivlenmis konusmaya mesaj yazilamaz (conversation_id=%, archived_at=%)',
      new.conversation_id, ark
      using errcode = 'HK001';
  end if;
  return new;
end;
$$;

-- `drop ... if exists` + `create`: yeniden çalıştırılabilir, ad çakışmasında
-- patlamaz.
drop trigger if exists trg_mesaj_arsive_yazilamaz on public.messages;
create trigger trg_mesaj_arsive_yazilamaz
  before insert on public.messages
  for each row
  execute function public.mesaj_arsive_yazilamaz();

-- ── İNDEKSLER ──────────────────────────────────────────────────────────────

-- "Benim gruplarım" — şoför/şef listesinin tek sorgusu. Kısmi: çıkmış üyeler
-- de listelenecek (salt okunur), bu yüzden left_at süzgeci indekste YOK.
create index if not exists idx_conv_members_worker
  on public.conversation_members (worker_id);

-- Grubun üye listesi + "n/m okudu" paydası.
create index if not exists idx_conv_members_conversation
  on public.conversation_members (conversation_id);

-- Yönetici liste ekranı gruplarda da sıralı gelsin; arşivlenmişler ayrı
-- bölümde gösterileceği için kısmi indeks AKTİF grupları hedefliyor.
create index if not exists idx_conversations_group_active
  on public.conversations (last_message_at desc nulls last)
  where kind = 'group' and archived_at is null;

comment on column public.conversations.kind is
  'direct = sofor basina tek konusma (071 kurali korunuyor) · group = uyeleri '
  'conversation_members''ta tutulan ortak oda.';
comment on column public.conversations.archived_at is
  'Dolu ise grup SALT OKUNUR — trg_mesaj_arsive_yazilamaz hicbir yazmaya izin '
  'vermez. Grup SILINMEZ, arsivlenir.';
comment on column public.conversation_members.left_at is
  'null = aktif uye. Dolu = cikarildi; gecmisi YALNIZ bu ana kadar okur '
  '(suzgec uygulama kodunda: messages.created_at <= left_at).';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
-- ── ÇALIŞTIRDIKTAN SONRA — DOĞRULAMA SORGULARI ─────────────────────────────
--
-- 1) Mevcut konusmalarin hepsi 'direct' mi (beklenen: group=0):
--
--    select kind, count(*) from public.conversations group by 1;
--
-- 2) Bicim kisiti calisiyor mu — IKISI DE HATA VERMELI:
--
--    insert into public.conversations (kind, worker_id, title)
--      values ('group', gen_random_uuid(), null);      -- sahipli grup -> RED
--    insert into public.conversations (kind, worker_id, title)
--      values ('direct', null, 'olmaz');               -- sahipsiz birebir -> RED
--
-- 3) Arsiv kilidi calisiyor mu (gecici bir grupla):
--
--    begin;
--      insert into public.conversations (kind, title, archived_at)
--        values ('group','KILIT TESTI', now()) returning id;   -- <id> not al
--      insert into public.messages (conversation_id, sender_role, body)
--        values ('<id>', 'admin', 'gecmemeli');   -- HK001 HATASI BEKLENIYOR
--    rollback;   -- ⚠️ ROLLBACK: test verisi birakmaz
--
-- Beklenen hata: 'arsivlenmis konusmaya mesaj yazilamaz ...' (SQLSTATE HK001)


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  074_push_tokens.sql                                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- 074_push_tokens.sql — PUSH BİLDİRİM ADRESLERİ (cihaz başına Expo jetonu)
--
-- ⚠️ BU DDL HENÜZ ÇALIŞTIRILMADI. Volkan Supabase'de çalıştıracak.
--    Claude tarafından çalıştırılmadı; bu dosya deponun ŞEMA KAYDIDIR.
--
-- ── NE ÇÖZÜYOR ─────────────────────────────────────────────────────────────
-- 071/073 mesajlaşmayı kurdu ama kanal GÜVENİLMEZ: şoför uygulamayı açmazsa
-- mesajı görmüyor. Çekme (polling) yalnız uygulama önplandayken çalışıyor
-- (use-messages: 12/30 sn) — telefon cebindeyken hiçbir şey akmıyor.
-- Bu tablo "o kişiye ULAŞILABİLECEK adresleri" tutar; gönderimi sunucu yapar.
--
-- ── NEDEN `token` BİRİNCİL ANAHTAR ─────────────────────────────────────────
-- Jeton bir KURULUMU temsil eder, bir kişiyi değil. Aynı telefonda iki şoför
-- sırayla giriyor (ortak araç telefonu — bu filoda gerçek). `token` PK olunca
-- ikinci giriş aynı satırı DEVRALIR: `worker_id` güncellenir ve önceki kişi o
-- adresten düşer. (worker_id, token) çifti PK olsaydı iki satır yan yana
-- dururdu ve çıkan kişinin mesajları yeni kullanıcının telefonuna DÜŞERDİ —
-- rahatsızlık değil, mahremiyet kusuru.
--
-- ── NEDEN CİHAZ BAŞINA DEĞİL, JETON BAŞINA ─────────────────────────────────
-- Expo jetonu sabit değil: uygulama verisi silinince, cihaz geri yüklenince
-- ya da FCM kaydı yenilenince değişir. "Cihaz kimliği" diye güvenilir bir şey
-- yok; olan tek kararlı olgu jetonun kendisi. Bir kişinin birden çok satırı
-- olması NORMAL (telefon + tablet) ve isteniyor.
--
-- ── ÖLÜ JETONLAR NASIL TEMİZLENİYOR ────────────────────────────────────────
-- İki yol, ikisi de yazılı:
--   1. ÇIKIŞTA — uygulama `DELETE /api/mobile/push/token` çağırıyor.
--   2. GÖNDERİMDE — Expo `DeviceNotRegistered` döndüğünde satır silinir
--      (lib/push.ts, `olenleriSil`). Kullanıcı uygulamayı sildiğinde tek
--      haber kaynağı budur; başka sinyal yok.
-- `last_seen_at` üçüncü bir ağ değil, teşhis: "bu jeton en son ne zaman
-- tazelendi" sorusu, bildirim gelmiyor şikâyetinde ilk bakılacak yerdir.
--
-- ── NEDEN `tenant_id` YOK ───────────────────────────────────────────────────
-- Bu kurulumda kiracı ayrımı VERİTABANI başına (HAK61 ve Sendigo ayrı Supabase
-- projeleri) — `workers` tablosunda da tenant kolonu yok. Buraya eklemek, bu
-- şemada karşılığı olmayan bir alan uydurmak olurdu.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- Kapalı — deponun kuralı (anon key yok, RLS politikası 0, yetki uygulama
-- kodunda: lib/mobile-scope.ts). Politika yazılmadan açılan RLS hiçbir şey
-- korumaz, yalnız yanlış güven duygusu verir.
--
-- ── GERİYE DÖNÜK ETKİ: SIFIR ───────────────────────────────────────────────
-- Tamamı eklemeli; var olan hiçbir tabloya dokunulmuyor.
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
create table if not exists public.push_tokens (
  -- Expo jetonu: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]".
  -- Uzunluk sınırı KOYULMADI: biçim Expo'nun ve değişebilir; dar bir CHECK
  -- ileride sessizce kayıt düşürürdü.
  token text primary key,

  -- Bu adresin ŞU ANKİ sahibi. Devralma yoluyla değişebilir (yukarıya bak).
  -- on delete cascade: personel silinince adresi de gider (GDPR md. 17).
  worker_id uuid not null
    references public.workers(id) on delete cascade,

  platform text not null check (platform in ('ios', 'android')),

  -- Teşhis için: "hangi telefon". Kullanıcının verdiği cihaz adı, kimlik değil.
  device_name text,

  created_at   timestamptz not null default now(),
  -- Her açılışta tazelenir. Ölü jeton avında ilk bakılacak kolon.
  last_seen_at timestamptz not null default now()
);

-- Gönderim yolunun TEK sorgusu: "bu kişilerin adresleri".
-- Alıcı kümesi her mesajda çözülüyor; indekssiz her bildirim tam tarama olurdu.
create index if not exists push_tokens_worker_idx
  on public.push_tokens (worker_id);
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
-- ── ÇALIŞTIRDIKTAN SONRA — DOĞRULAMA SORGULARI ─────────────────────────────
--
-- 1) Tablo ve indeks yerinde mi (beklenen: 1 satir + 2 indeks):
--
--    select count(*) from information_schema.tables
--      where table_schema='public' and table_name='push_tokens';
--    select indexname from pg_indexes
--      where schemaname='public' and tablename='push_tokens';
--
-- 2) Platform kisiti calisiyor mu — HATA VERMELI:
--
--    insert into public.push_tokens (token, worker_id, platform)
--      values ('T1', (select id from public.workers limit 1), 'web');  -- RED
--
-- 3) DEVRALMA calisiyor mu (ortak telefon senaryosu):
--
--    begin;
--      insert into public.push_tokens (token, worker_id, platform)
--        values ('ExponentPushToken[TEST]', (select id from public.workers order by id limit 1), 'android');
--      insert into public.push_tokens (token, worker_id, platform)
--        values ('ExponentPushToken[TEST]', (select id from public.workers order by id offset 1 limit 1), 'android')
--        on conflict (token) do update
--          set worker_id = excluded.worker_id, last_seen_at = now();
--      -- BEKLENEN: tek satir, worker_id IKINCI kisi.
--      select token, worker_id from public.push_tokens where token='ExponentPushToken[TEST]';
--    rollback;   -- ⚠️ ROLLBACK: test verisi birakmaz


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  076_tenant_cost_rates.sql                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 076 (MALİYET ORANLARI, KİRACI GİRDİSİ)
-- =====================================================================
-- €/km ve €/paket hesabının üç PARASAL oranını kiracının kendisi panelden
-- girebilsin: yakıt litre fiyatı, şoför-saati işçilik maliyeti, araç günlük
-- sabit gideri. Additive + idempotent; mevcut hiçbir tabloya DOKUNULMAZ.
-- Supabase SQL Editor'da çalıştırın.
--
-- ═══ NEDEN TABLO, NEDEN ENV DEĞİL (Volkan kararı, 23.08.2026) ═══
--
-- Oranlar ilk turda yalnız env'deydi (FUEL_PRICE_EUR_PER_L, LABOR_EUR_PER_HOUR,
-- VEHICLE_EUR_PER_DAY). Bu, tek müşterili bir kurulumda çalışır ama ürün dünya
-- pazarına satılacak ve orada üç şey birden bozuluyor:
--
--   1. Env değiştirmek DEPLOY gerektirir. Müşteri kendi sigorta primini
--      güncellemek için bizden yeni bir dağıtım isteyemez.
--   2. Env'i yalnız BİZ yazabiliyoruz (Vercel proje ayarları). Müşterinin kendi
--      rakamını girmesi için bize e-posta atması gerekirdi.
--   3. Oran bir AYAR değil, müşteriye ait bir VERİDİR: "şoför saati bize 21,40 €'ya
--      mal oluyor" cümlesi o firmanın bordro gerçeği. Verinin yeri veritabanı.
--
-- Env KALDIRILMADI, rolü DEĞİŞTİ: artık yalnız VARSAYILAN sağlıyor. Öncelik
-- sırası kodda tek yerde (lib/cost-rates-db.ts):
--        panel satırı (bu tablo)  >  env  >  koddaki varsayılan
--
-- ═══ NEDEN L/100km BU TABLODA YOK ═══
--
-- Tüketim ÖLÇÜLÜYOR — telemetriden, aracın kendi yakıt sensöründen
-- (report_fuel_stats / report_fuel_volume_stats, migration 026 + 039).
-- Elle girilebilir yapsaydık kullanıcı, ürünün ZATEN ÖLÇTÜĞÜ bir büyüklüğü
-- tahminle geçersiz kılabilirdi ve €/km sessizce bir varsayıma dayanırdı.
-- Ölçülen değer varsa o kazanır; kolon açmıyoruz ki "geçersiz kılma" diye bir
-- kapı hiç doğmasın. (Env'deki FLEET_L_PER_100KM yalnız ölçüm HİÇ yapılamadığı
-- kurulumlar için yedektir ve ekranda "varsayılan" diye etiketlenir.)
--
-- ═══ NEDEN TEK SATIR (singleton) ═══
--
-- Bu mimaride her kiracının KENDİ veritabanı var (bkz. lib/brand.ts REGISTRY:
-- hak61 / sendigo / galzura-demo ayrı Supabase projeleri). Yani "kiracı" ayrımı
-- satır düzeyinde DEĞİL, veritabanı düzeyinde. Bir `tenant_id` kolonu açmak
-- hiçbir zaman ikinci bir değer almayacak bir eksen doğururdu — ve o eksen
-- unutulan bir WHERE ile sessiz bir sızıntı kapısına dönerdi.
--
-- Tekilliği CHECK garanti eder: `id` yalnız 'singleton' olabilir. İkinci satır
-- INSERT'i birincil anahtara takılır; "hangi satır geçerli" sorusu doğmaz.
--
-- ═══ NEDEN HER KOLON NULL'LANABİLİR ═══
--
-- NULL = "kiracı bu oranı GİRMEDİ" demek ve varsayılana düşülür. Kolonu NOT
-- NULL + varsayılan değerli yapsaydık, satır bir kez oluştuğunda üç oran da
-- "girilmiş" görünürdü ve ekran GİRİLDİ / VARSAYILAN ayrımını yapamazdı.
-- O ayrım bu özelliğin ana vaadi: hangi sayının müşteriye, hangisinin bize ait
-- olduğu ekranda okunmalı.
--
-- ═══ NEDEN numeric, double precision DEĞİL ═══
--
-- Bunlar PARA oranı. `double precision` ikili kayan nokta: 2.043 tam olarak
-- saklanamaz ve "girdiğim sayı geri gelmiyor" sınıfı bir kusur doğurur.
-- numeric(12,4) dört ondalık basamağa kadar TAM saklar — akaryakıt fiyatı
-- (2,0430) ve saatlik ücret (19,1000) için fazlasıyla yeterli.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Tabloya yalnız service-role
-- istemcisi yazar; yetki uygulama kodunda (requireAdmin).
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
create table if not exists public.tenant_cost_rates (
  -- Tekillik kilidi: tek satır, adı sabit.
  id text primary key default 'singleton'
    check (id = 'singleton'),

  -- ── ÜÇ PARASAL ORAN ─────────────────────────────────────────────────
  -- Üçü de NULL'lanabilir: NULL = "girilmedi, varsayılan kullanılsın".
  -- CHECK'ler > 0: sıfır ya da negatif bir oran hesabı sessizce bozardı
  -- (€/km 0'a düşer ve filo bedava görünür). Girdi doğrulaması uygulama
  -- katmanında da var; bu son hat.

  -- Yakıt litre fiyatı (EUR/L). Filo kartıyla alan müşteri kendi anlaşmalı
  -- fiyatını yazar; varsayılan piyasa ortalamasıdır.
  fuel_eur_per_l numeric(12,4)
    check (fuel_eur_per_l is null or fuel_eur_per_l > 0),

  -- İşçilik (EUR / şoför-saati) — İŞVEREN TOPLAM MALİYETİ, brüt ücret değil
  -- (Lohnnebenkosten + 13./14. maaş dâhil). Filo ORTALAMASIDIR: kişi bazlı
  -- ücret bordro verisidir ve buraya girmez.
  labor_eur_per_hour numeric(12,4)
    check (labor_eur_per_hour is null or labor_eur_per_hour > 0),

  -- Araç sabit gideri (EUR / ÇALIŞILAN araç-günü): leasing/amortisman +
  -- sigorta + vergi + servis payı. Payda TAKVİM GÜNÜ DEĞİL — o gün en az bir
  -- vardiya görmüş (araç, gün) çiftidir (bkz. lib/cost-model.ts).
  vehicle_eur_per_day numeric(12,4)
    check (vehicle_eur_per_day is null or vehicle_eur_per_day > 0),

  -- ── İZ ──────────────────────────────────────────────────────────────
  -- Kim ne zaman değiştirdi. Bir € oranı filo kararlarını sürüklüyor; "bu
  -- rakamı kim koydu" sorusu altı ay sonra sorulacak.
  -- Hesap silinirse oran KALIR (set null): sayı firmanın, kişinin değil.
  updated_at timestamptz not null default now(),
  updated_by uuid references public.workers(id) on delete set null
);

comment on table public.tenant_cost_rates is
  'Maliyet oranlarının kiracıya ait değerleri (€/km motoru). Tek satır: id=''singleton''. NULL kolon = girilmedi, env/kod varsayılanı kullanılır.';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select * from public.tenant_cost_rates;
--   → 0 satır beklenir: tablo yaratıldı ama kiracı henüz oran girmedi,
--     yani üç oran da VARSAYILAN etiketiyle görünür. Panel ilk kaydetmede
--     satırı kendisi oluşturur (upsert).


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  077_fuel_price_reference.sql                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 077 (YAKIT FİYATI REFERANSI, ÜLKE EKSENİ)
-- =====================================================================
-- Yakıt litre fiyatı artık elle yazılmıyor: AB Komisyonu Weekly Oil Bulletin'den
-- günlük bir cron ile çekilip buraya yazılıyor. Additive + idempotent; mevcut
-- hiçbir tabloya DOKUNULMAZ. Supabase SQL Editor'da çalıştırın.
--
-- ⚠️ 076 (tenant_cost_rates) uygulanmış olmalı — bu tablo onun ÜSTÜNE biner,
-- yerine geçmez: kiracı kendi sözleşme fiyatını girmişse o kazanır, bu tablo
-- yalnız REFERANS sağlar.
--
-- ═══ NEDEN AYRI TABLO, tenant_cost_rates'e KOLON DEĞİL ═══
--
-- Yakıt fiyatı KİRACIYA ait değil, ÜLKEYE ait bir olgudur. Avusturya'daki üç
-- kiracı aynı 2,043 €/L'yi okur. Kolon eklemek aynı sayıyı N kiracı için N kez
-- yazmak, N kez tazelemek ve N yoldan tutarsızlaşmak demekti: 50 kiracılı bir
-- kurulumda cron 50 satır güncellemek zorunda kalır, biri başarısız olursa iki
-- kiracı farklı fiyat görür — sessiz ve teşhisi zor bir kusur.
--
-- Bu şemada cron 1 SATIR yazar, N kiracı AYNI satırı okur.
--
-- ═══ KAYNAK: AB WEEKLY OIL BULLETIN — NEDEN BU, NEDEN BAŞKASI DEĞİL ═══
--
-- ÖLÇÜLDÜ (24.08.2026): dosyadaki Avusturya dizel değeri 2043 EUR/1000 L, yani
-- 2,043 €/L — kodda elle yazılı olan sabitin BİREBİR AYNISI (WKO, 17.08.2026).
-- Yani kaynak değişikliği hiçbir sayıyı oynatmıyor, yalnız güncelleme işini
-- otomatikleştiriyor.
--
-- Elenen adaylar ve gerekçeleri (araştırma, 24.08.2026):
--   · WKO (bugünkü kaynak) — hiçbir yeniden kullanım izni yayımlamıyor;
--     yayıncı kamu otoritesi değil, sektör birliği. Yalnız kazımayla alınır.
--   · E-Control REST API — yalnız EN UCUZ 5/10 istasyonu döndürüyor (yasanın
--     amacı bu); ortalaması sistematik olarak gerçeğin ALTINDA kalır.
--   · E-Control medyan XLSX — günlük ve daha taze, ama (a) lisans metni YOK,
--     (b) MEDYAN yayınlıyor, ürün ORTALAMA kullanıyor — sessiz metodoloji
--     değişikliği olurdu, (c) tek ülke.
--   · Tankerkönig — şartları bu tasarımı adıyla yasaklıyor ("Regelmäßige,
--     nicht explizit vom User initiierte Requests sind zu vermeiden").
--   · OilPriceAPI / fuel-prices.eu — ücretli ama ticari kullanıma kapalı
--     ("We grant no rights in the data" / "personal, non-commercial use").
--
-- LİSANS: CC BY 4.0. Dosyanın kendi telif notu birebir: "Reproduction is
-- authorised provided the source is acknowledged. © European Communities".
-- Ürün ekranda metin atıf gösterir. ⚠️ AB LOGOSU/AMBLEMİ KULLANILMAZ ve
-- "AB onaylı / iş ortağı" denmez (Karar 2011/833/EU Md.2(2)(a) logoları
-- kapsam dışı bırakıyor; CC BY 4.0 Md.2(a)(6) "No endorsement").
--
-- ═══ NEDEN price VE price_eur AYRI ═══
--
-- Bugün AT ve DE kapsamda ve ikisi de EUR — iki kolon aynı değeri taşıyacak.
-- Ama İsviçre (CHF) ve Türkiye (TRY) sonraki turlarda gelecek ve o gün ham
-- değeri kaybetmiş olmak, kur hatasını geri alınamaz kılardı. `price` her
-- zaman KAYNAĞIN yazdığı sayıdır; `price_eur` bizim türettiğimizdir.
--
-- ═══ NEDEN statistic KOLONU VAR ═══
--
-- WOB ORTALAMA yayınlıyor, E-Control MEDYAN. İkisi aynı sayı değil (17.08 vs
-- 22.08 ölçümü: 2,043 ve 2,029). Kaynak değiştiğinde sayının "kendiliğinden"
-- değiştiği izlenimini önleyen tek şey bu kolonun ekranda görünmesi.
--
-- ═══ NEDEN reference_date, fetched_at DEĞİL ═══
--
-- reference_date = KAYNAĞIN ölçtüğü Pazartesi (17.08). fetched_at = bizim
-- indirdiğimiz an. Bayatlık HER ZAMAN reference_date'ten hesaplanır: cron her
-- gün başarıyla koşup aynı haftalık satırı yeniden yazsa bile veri yaşlanır.
-- fetched_at'e bakan bir bayatlık ölçüsü, çalışan bir cron'u "taze veri"
-- sanardı.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı (78 migration'ın yalnız 2'si açıyor).
-- Tabloya yalnız service-role istemcisi yazar.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
create table if not exists public.fuel_price_reference (
  id uuid primary key default gen_random_uuid(),

  -- ── KİMLİK ──────────────────────────────────────────────────────────
  -- ISO 3166-1 alpha-2. Bugün yalnız 'AT' ve 'DE' yazılıyor; CHECK bilerek
  -- YOK — yeni ülke eklemek migration gerektirmesin. Kapsam kodda (kaynak
  -- eşlemesi) belirleniyor, şemada değil.
  country_code text not null check (country_code = upper(country_code) and length(country_code) = 2),

  -- 'diesel' | 'petrol95'. Bugün yalnız dizel yazılıyor (€/km motorunun
  -- ihtiyacı o); benzin sütunu aynı dosyada duruyor, ileride bedavaya gelir.
  fuel_type text not null check (fuel_type in ('diesel', 'petrol95')),

  -- KAYNAĞIN referans tarihi (WOB'da Pazartesi). Bizim çekim anımız DEĞİL.
  reference_date date not null,

  -- ── DEĞER ───────────────────────────────────────────────────────────
  -- Kaynağın yazdığı ham sayı, kaynağın para biriminde, LİTRE başına.
  -- ⚠️ WOB dosyası 1000 LİTRE başına yayınlıyor (2043) — bölme işlemi
  -- ayrıştırıcıda yapılır, buraya 2.0430 olarak girer.
  price numeric(12,4) not null check (price > 0),
  currency text not null check (currency = upper(currency) and length(currency) = 3),

  -- € karşılığı. EUR kaynakta ise price ile aynıdır ve fx_rate null kalır.
  price_eur numeric(12,4) not null check (price_eur > 0),
  fx_rate numeric(18,8) check (fx_rate is null or fx_rate > 0),

  -- ── KÖKEN ───────────────────────────────────────────────────────────
  -- 'mean' | 'median'. Metodolojiyi ASLA örtme (bkz. başlık).
  statistic text not null check (statistic in ('mean', 'median')),

  -- Kaynak anahtarı — kodda tanımlı sağlayıcıya karşılık gelir.
  -- Bugün yalnız 'eu_wob'. UNIQUE'in parçası: aynı gün için iki farklı
  -- kaynaktan gelen satırlar yan yana yaşayabilsin (çapraz kontrol).
  source_key text not null,
  source_url text not null,

  -- Ekranda gösterilecek atıf satırı. Şemada tutuluyor çünkü lisans
  -- KAYNAĞA bağlı: ikinci bir sağlayıcı eklendiğinde onun atfı farklı olur
  -- ve kodda sabit bir cümle yanlış kaynağı atfetmeye başlardı.
  license_note text not null,

  -- Kaynağın YAYIN PERİYODU (gün). WOB haftalık → 7. Bayatlık eşiği bundan
  -- TÜRETİLİR, sabit yazılmaz: aylık bir kaynağa (İsviçre BFS) 10 günlük
  -- eşik uygulamak onu doğduğu gün bayat ilan ederdi.
  expected_period_days integer not null default 7 check (expected_period_days > 0),

  fetched_at timestamptz not null default now(),

  -- Aynı gün + aynı ürün + aynı kaynak = TEK satır. Cron günde bir kez koşar
  -- ama beş kez koşsa da tek satır kalır (upsert bu kısıta çarpar).
  constraint fuel_price_reference_uq
    unique (country_code, fuel_type, reference_date, source_key)
);

-- Okuma deseni: "şu ülke + şu yakıt için EN YENİ satır". Tarihe göre azalan
-- kısmi tarama yeter; tablo yılda ~52 satır/ülke büyüyor, yani küçük kalacak.
create index if not exists fuel_price_reference_lookup_idx
  on public.fuel_price_reference (country_code, fuel_type, reference_date desc);

comment on table public.fuel_price_reference is
  'Ülke ekseninde yakıt fiyatı referansı (€/km motoru). Kaynak: AB Weekly Oil Bulletin, CC BY 4.0. Kiracıya değil ÜLKEYE aittir; tenant_cost_rates.fuel_eur_per_l doluysa O kazanır.';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select count(*) from public.fuel_price_reference;
--   → 0 satır beklenir. Cron ilk koştuğunda AT ve DE için birer satır düşer.
--
-- Cron koştuktan sonra:
-- select country_code, fuel_type, reference_date, price, currency, price_eur,
--        statistic, source_key, expected_period_days
--   from public.fuel_price_reference
--  order by reference_date desc, country_code;
--   → AT 2.0430 EUR ve DE 2.2660 EUR, reference_date = kaynağın Pazartesi'si.


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  078_worker_documents.sql                                           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 078 (ŞOFÖR BELGE TAKİBİ)
-- =====================================================================
-- Şoförün süresi dolan belgelerini takip et, dolmadan uyar. Additive +
-- idempotent; mevcut hiçbir tabloya DOKUNULMAZ. Supabase SQL Editor'da
-- çalıştırın.
--
-- ═══ NEDEN TABLO, NEDEN workers'A KOLON DEĞİL ═══
--
-- Belge türleri ÜLKEYE göre değişiyor ve ürün dünya pazarına satılacak:
-- TR'de SRC + psikoteknik, DACH'ta Aufenthaltstitel + Fahrerqualifizierungs-
-- nachweis, AB genelinde CPC, taşınan yüke göre ADR. Kolon modelinde her yeni
-- ülke YENİ BİR MIGRATION demek olurdu — yani müşteri kendi belgesini bizden
-- dağıtım isteyerek ekleyecekti.
--
-- ⚠️ SABİT TÜR LİSTESİ YAZILMADI, CHECK KISITI DA YOK. Türleri KİRACI tanımlar
-- (`document_types`). Bir enum ya da CHECK, aynı hatanın şema düzeyindeki hâli
-- olurdu: Portekiz'in belgesini eklemek için ALTER TABLE gerekirdi.
--
-- ═══ EHLİYET NEDEN BURAYA TAŞINMIYOR ═══
--
-- `workers.license_no` / `license_expiry` OLDUĞU GİBİ KALIYOR. Taşımak 15+
-- çağrı yerini kırardı: lib/worker-ui.ts licenseState, iki şoför formu,
-- /admin/workers listesi ve detay ekranı, iki mobil uç (`ehliyetSon`,
-- `ehliyet.no`), güvenlik ekranı alan etiketi, install SQL'leri ve
-- lib/admin-dashboard.ts'teki kalem kuralı.
--
-- ⚠️ Ehliyetin dikkat kalemi de AYNEN kalıyor ve KENDİ kuralıyla çalışıyor:
-- dolmuş ehliyetin ALT SINIRI YOKTUR (lib/admin-dashboard.ts:1429). Bu tablo
-- ona dokunmuyor; iki eksen yan yana yaşıyor.
--
-- ⚠️ SONUÇ OLARAK BİR TUZAK DOĞUYOR: kiracı "Ehliyet" adında bir belge türü
-- tanımlarsa aynı gerçek İKİ YERDE takip edilir ve pano iki kalem üretir.
-- Şema bunu yasaklayamaz (tür adları serbest, yasaklamak da dünya pazarında
-- yanlış olurdu). Panel bu yüzden tür ekleme ekranında UYARI gösteriyor.
--
-- ═══ NEDEN İKİ TABLO ═══
--
-- `document_types` = kiracının SÖZLÜĞÜ (hangi belgeler var, kaç gün önce uyar).
-- `worker_documents` = KİŞİYE ait kayıt (kimin belgesi, ne zaman doluyor).
-- Tek tabloda tutulsaydı tür adı ve eşik her satırda tekrarlanır, bir türün
-- eşiğini değiştirmek N satır güncellemek olurdu ve iki satır sessizce
-- ayrışabilirdi.
--
-- ═══ NEDEN warn_days TÜR BAŞINA ═══
--
-- Görev "kiracı ayarı, varsayılan 30 gün" diyordu; tür başına yapmak kesin
-- olarak daha doğru: oturma izni 90 gün önce haber vermezse yenilenemez
-- (randevu süresi), sağlık raporu için 30 gün fazlasıyla yeter. Tek bir
-- kiracı eşiği, en kritik belgeyi en gevşek belgeye eşitlerdi. Varsayılan
-- yine 30 — kiracı hiçbir şey yapmazsa görevde yazan davranış aynen geçerli.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar; yetki
-- uygulama kodunda (requireAdmin / requireFleetView).
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ── 1) KİRACININ BELGE SÖZLÜĞÜ ──────────────────────────────────────
create table if not exists public.document_types (
  id uuid primary key default gen_random_uuid(),

  -- Makine adı: kod içinde ve i18n anahtarında kullanılır. Kiracı serbestçe
  -- belirler ('src', 'adr', 'aufenthaltstitel', 'cpc', 'psikoteknik'…).
  -- ⚠️ SABİT LİSTE YOK — CHECK kısıtı bilerek konulmadı (başlık bloğu).
  code text not null,

  -- Ekranda görünen ad. i18n sözlüğüne GİRMEZ: kiracıya ait bir veri, ürün
  -- metni değil. Almanca kurulumda "Aufenthaltstitel" yazan bir kiracının
  -- etiketini bizim çeviri dosyamıza koymak, müşterinin verisini ürünün
  -- kaynak koduna taşımak olurdu.
  label text not null check (length(btrim(label)) between 1 and 80),

  -- Kaç gün önce uyarılsın. Tür başına — gerekçe başlık bloğunda.
  warn_days integer not null default 30
    check (warn_days between 1 and 365),

  -- Belge numarası bu tür için anlamlı mı (SRC'nin numarası var, sağlık
  -- raporunun genelde yok). Yalnız FORMU sadeleştirir; veri kaybı yaratmaz.
  requires_number boolean not null default false,

  -- Kapatılan tür GEÇMİŞİ SİLMEZ: kayıtlar kalır, yeni kayıt açılamaz ve
  -- uyarı üretilmez. Silme yerine pasifleştirme, çünkü bir belge türünü
  -- kaldırmak o belgeye sahip kişilerin geçmişini yok etmemeli.
  active boolean not null default true,

  -- Listede sıra. Aynı sıradakiler label'a göre dizilir.
  sort_order integer not null default 100,

  created_at timestamptz not null default now(),
  created_by uuid references public.workers(id) on delete set null,

  -- Aynı kod iki kez tanımlanamaz. Büyük/küçük harf farkı bir tür DEĞİLDİR:
  -- 'SRC' ve 'src' aynı belgedir ve ikisini birden açmak sessiz bir çift
  -- kayıt kapısıdır.
  constraint document_types_code_uq unique (code)
);

-- ── 2) KİŞİYE AİT BELGE KAYDI ───────────────────────────────────────
create table if not exists public.worker_documents (
  id uuid primary key default gen_random_uuid(),

  -- Personel silinirse belgesi de gider: kişiye ait, kişisiz anlamı yok.
  worker_id uuid not null references public.workers(id) on delete cascade,

  -- Tür silinemez (yalnız pasifleştirilir), o yüzden restrict: yanlışlıkla
  -- silme denemesi sessizce N kaydı götürmesin.
  type_id uuid not null references public.document_types(id) on delete restrict,

  -- ⚠️ ZORUNLU. Bu tablonun VARLIK SEBEBİ süre takibi; tarihsiz bir satır
  -- hiçbir uyarı üretmez ve "belge var" yanılsaması yaratırdı — kayıtlı ama
  -- takip edilmeyen bir belge, hiç kaydedilmemiş olandan daha tehlikelidir.
  expires_at date not null,

  -- Opsiyonel: belge numarası ve serbest not.
  document_no text check (document_no is null or length(btrim(document_no)) between 1 and 80),
  note text check (note is null or length(note) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.workers(id) on delete set null,

  -- Bir kişinin bir türden TEK GEÇERLİ kaydı olur. Yenileme = mevcut satırın
  -- tarihini ileri almak, ikinci satır açmak DEĞİL.
  --
  -- ⚠️ NEDEN GEÇMİŞ SÜRÜM TUTULMUYOR: "2023'te hangi tarihti" sorusunun bugün
  -- bir tüketicisi yok ve sürümlü bir tablo, her okumada "hangisi geçerli"
  -- kuralını her yere taşırdı. Gerekirse ayrı bir iz tablosu eklenir; bu
  -- kısıt o gün kaldırılmaz, iz tablosu ONUN YANINA gelir.
  constraint worker_documents_uq unique (worker_id, type_id)
);

-- Okuma deseni: "süresi yaklaşan/dolmuş belgeler" — tarihe göre artan tarama.
create index if not exists worker_documents_expiry_idx
  on public.worker_documents (expires_at);

-- Kişi ekranı: "bu şoförün belgeleri".
create index if not exists worker_documents_worker_idx
  on public.worker_documents (worker_id);

comment on table public.document_types is
  'Kiracının tanımladığı belge türleri (SRC, ADR, oturma izni, CPC…). SABİT LİSTE YOK: türleri kiracı belirler. warn_days tür başına uyarı eşiği, varsayılan 30.';
comment on table public.worker_documents is
  'Şoför belgelerinin bitiş tarihleri. Ehliyet BURAYA GİRMEZ — workers.license_expiry kendi ekseninde kalır (bkz. migration başlığı).';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select count(*) from public.document_types;      → 0 beklenir
-- select count(*) from public.worker_documents;    → 0 beklenir
--
-- Kiracı ilk türünü panelden açar (/admin/workers → Belge Türleri).
-- Örnek bir tür ELLE eklemek isterseniz:
--   insert into public.document_types (code, label, warn_days, requires_number)
--   values ('src', 'SRC Belgesi', 30, true);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  079_sefer_takip_linkleri.sql                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 079 (MÜŞTERİ CANLI TAKİP LİNKİ)
-- =====================================================================
-- Yönetici bir sefer için süreli bir link üretir, müşteriye gönderir. Müşteri
-- GİRİŞSİZ bir sayfada aracın konumunu, tahmini varışı ve durumu görür.
-- Additive + idempotent; mevcut hiçbir tabloya DOKUNULMAZ. Supabase SQL
-- Editor'da çalıştırın.
--
-- ═══ NEDEN AYRI TABLO, seferler'E KOLON DEĞİL ═══
--
-- Bir sefer için BİRDEN FAZLA link gerekebilir: alıcı, gönderici ve çağrı
-- merkezi aynı seferi izleyebilir ve biri iptal edilirken diğeri yaşamalıdır.
-- Kolon modelinde "linki iptal et" = "herkesinkini iptal et" olurdu.
-- Ayrıca link bir KAYIT: kim üretti, ne zaman doldu, kaç kez açıldı. Bunlar
-- seferin alanları değil, linkin kendi hayatıdır.
--
-- ═══ NEDEN TOKEN AÇIK METİN (HASH DEĞİL) — BİLİNÇLİ TAKAS ═══
--
-- Oturum parolası gibi bir sır olsaydı hash saklanırdı. Bu bir TAŞIYICI
-- YETKİ (bearer capability) ve varlık sebebi PAYLAŞILMAK: SMS/WhatsApp ile
-- gönderiliyor, müşteri linke defalarca dönüyor, yönetici "linki tekrar
-- gönder" diyebilmeli. Hash saklasaydık düz metin yalnız üretim anında
-- görünürdü ve her "tekrar gönder" YENİ bir link doğururdu.
--
-- Bedeli ve karşı önlemleri açıkça:
--   · Veritabanı sızarsa AÇIK linkler de sızar. Karşılığında: link kısa ömürlü
--     (varsayılan 2 saat), iptal edilebilir, sefer bitince ölür ve arkasında
--     YALNIZ konum + ETA + durum var. Şoför adı, plaka, filo YOK.
--   · Tahmin edilemezlik entropiden gelir: 32 bayt (256 bit) rastgelelik.
--     Kaba kuvvet, hız sınırı olmasa bile anlamsız.
--
-- ═══ NEDEN "KAPALI" BAYRAĞI YOK ═══
--
-- Link üç yoldan ölür: (a) süre doldu, (b) yönetici iptal etti, (c) SEFER
-- kapandı (tamamlandi/iptal). (c) için tabloya bir bayrak KOYULMADI: seferin
-- durumu zaten `seferler.durum`da ve okuma anında bakılıyor. Bayrak koysaydık
-- sefer kapandığında N linki güncelleyen ikinci bir yazma yolu doğar ve iki
-- gerçek sessizce ayrışırdı ("sefer kapalı ama link hâlâ açık").
--
-- ═══ NEDEN SAYAÇ VAR AMA HER İSTEKTE YAZILMIYOR ═══
--
-- `hit_count` / `last_hit_at` kötüye kullanım izidir: link yayıldıysa görünür.
-- Ama yoklama sayfası dakikada bir çağrılıyor ve HER istekte UPDATE atmak,
-- okuma yükünü yazma yüküne çevirirdi. Uygulama katmanı bu iki alanı
-- KISILMIŞ yazar: en fazla dakikada bir (lib/takip-db.ts). Sayı bu yüzden
-- "yaklaşık"tır ve öyle olması yeterlidir — burada aranan şey trend, muhasebe
-- değil.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role okur/yazar;
-- girişsiz sayfa da sunucuda çalışır ve token'ı ANAHTARLI okur.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
create table if not exists public.sefer_takip_linkleri (
  id uuid primary key default gen_random_uuid(),

  -- Hangi sefer. Sefer silinirse linkleri de gider: linkin seferden bağımsız
  -- anlamı yok.
  sefer_id uuid not null references public.seferler(id) on delete cascade,

  -- URL'deki gizli parça. 32 bayt rastgele → base64url (43 karakter).
  -- ⚠️ Açık metin; gerekçesi ve bedeli başlık bloğunda.
  token text not null,

  -- MUTLAK bitiş. Süre kiracı ayarı (TAKIP_LINK_TTL_MIN, varsayılan 120 dk)
  -- ama linke YAZILIR: ayar sonradan değişse bile dağıtılmış linkin ömrü
  -- değişmez. "Gönderdiğim link ne zaman ölecek" sorusunun cevabı sabit olmalı.
  expires_at timestamptz not null,

  -- Yönetici iptali. null = iptal edilmedi.
  revoked_at timestamptz,
  revoked_by uuid references public.workers(id) on delete set null,

  -- Yöneticinin kendi notu: "hangi müşteriye gönderdim". Bir seferin birden
  -- fazla linki olabildiği için ayırt edici. ⚠️ GİRİŞSİZ SAYFADA GÖSTERİLMEZ.
  alici_not text check (alici_not is null or length(btrim(alici_not)) between 1 and 80),

  created_by uuid references public.workers(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Kötüye kullanım izi. KISILMIŞ yazılır (başlık bloğu).
  hit_count integer not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz,

  -- Aynı token iki kez var olamaz. Anahtarlı okuma da bu indeksten gider.
  constraint sefer_takip_token_uq unique (token),

  -- Biçim kısıtı: base64url alfabesi ve makul uzunluk. Yanlışlıkla kısa ya da
  -- boşluklu bir token yazmak şema düzeyinde imkânsız.
  constraint sefer_takip_token_bicim
    check (token ~ '^[A-Za-z0-9_-]{32,86}$'),

  -- Süre geçmişe yazılamaz: ölü doğan link, sessiz bir hata olurdu.
  constraint sefer_takip_sure_ileri check (expires_at > created_at)
);

-- Seferin linklerini listele / topluca iptal et.
create index if not exists sefer_takip_sefer_idx
  on public.sefer_takip_linkleri (sefer_id);

-- "Şu an açık linkler" — yönetici ekranı ve temizlik işleri.
-- Kısmi indeks: iptal edilmişler taranmaz.
create index if not exists sefer_takip_acik_idx
  on public.sefer_takip_linkleri (expires_at)
  where revoked_at is null;

comment on table public.sefer_takip_linkleri is
  'Müşteriye gönderilen süreli canlı takip linkleri (079). Girişsiz sayfa YALNIZ konum + ETA + durum gösterir; şoför adı/plaka/filo göstermez.';
comment on column public.sefer_takip_linkleri.token is
  'URL''deki gizli parça, 32 bayt rastgele (base64url). Açık metin saklanır — taşıyıcı yetki, tekrar gönderilebilmeli (bkz. migration başlığı).';
comment on column public.sefer_takip_linkleri.expires_at is
  'Mutlak bitiş. Kiracı ayarı değişse bile dağıtılmış linkin ömrü değişmez.';
comment on column public.sefer_takip_linkleri.hit_count is
  'Yaklaşık açılma sayısı. Uygulama katmanı en fazla dakikada bir günceller.';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select count(*) from public.sefer_takip_linkleri;           → 0 beklenir
-- \d public.sefer_takip_linkleri                              → 2 indeks + 3 kısıt
--
-- ⚠️ 079 UYGULANMAZSA: takip özelliği KAPALI kalır, panel ve mobil normal
-- çalışır. Okuma yolları `tabloYok` ile boş döner (aynı kademeli düşüş
-- deseni 056/058/077/078'de de var).


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  080_teslimat_kaniti.sql                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 080 (TESLİMAT KANITI · ePOD)
-- =====================================================================
-- Şoför teslimatta kanıt bırakır: imza, fotoğraf, not, alıcı adı. Kayıt sefere
-- bağlanır; yönetici panelden görür; anlaşmazlıkta delil olur. Additive +
-- idempotent; mevcut hiçbir tabloya DOKUNULMAZ. Supabase SQL Editor'da
-- çalıştırın.
--
-- ═══ NEDEN shift_photos'A EKLENMEDİ ═══
--
-- ÖLÇÜLDÜ (25.08.2026): `shift_photos` VARDİYA fotoğrafıdır — `time_entry_id`e
-- bağlı, "şoför vardiya sırasında bir şey fotoğrafladı" demek. Teslimat kanıtı
-- ise TESLİMATA bağlı olmak zorunda: "hangi seferin hangi durağında, kime,
-- hangi imzayla". İkisini aynı tabloda tutsaydık "şu teslimatın kanıtı hangi
-- satırlar" sorusu türetilemezdi (vardiya boyunca çekilmiş onlarca fotoğrafın
-- içinden hangisi delil?). Ayrıca kanıtın DEĞİŞMEZ olması gerekiyor, vardiya
-- fotoğrafının böyle bir yükümlülüğü yok.
--
-- ═══ NEDEN İKİ TABLO ═══
--
-- `teslimatlar` = OLAY (kim, ne zaman, nerede, kime, imza).
-- `teslimat_fotograflari` = o olaya ait 0..N görüntü. Görev "birden fazla
-- olabilir" diyor; fotoğrafı kolona koymak (foto1, foto2…) tavanı şemaya
-- gömmek olurdu.
--
-- ═══ ÇOK DURAKLI TESLİMAT — BUGÜN TEK, YARIN N ═══
--
-- ÖLÇÜLDÜ: `seferler` bugün TEK hedefli (`zone_id` tek kolon) ve canlıdaki
-- seferlerin hiçbirinde hedef bile dolu değil. Ama dünya pazarında çok duraklı
-- tur standarttır (Onfleet/Track-POD/Bringg üçü de durak listesiyle çalışır).
--
-- Model buna göre kuruldu: kanıt SEFERE değil, seferin BİR DURAĞINA bağlanıyor
-- (`durak_no`). Bugün her seferde tek satır olur (`durak_no = 1`); durak listesi
-- eklendiği gün aynı tablo N satır taşır ve HİÇBİR ŞEMA DEĞİŞİKLİĞİ gerekmez.
-- Tersini yapıp kanıtı sefere 1-1 bağlasaydık, çok duraklı tura geçiş bu
-- tablonun yeniden yazılması demekti.
--
-- ⚠️ `unique (sefer_id, durak_no)`: aynı durağın iki kanıtı olamaz. Yeniden
-- teslim denemesi YENİ BİR DURAK numarasıdır — üzerine yazmak, ilk denemenin
-- delilini yok etmek olurdu.
--
-- ═══ İMZA: VEKTÖR BİRİNCİL, RASTER YEDEK ═══
--
-- İmza `imza_svg` metin kolonunda SVG yol verisi olarak duruyor. Ölçü: tipik
-- bir imza 2-6 KB yol verisi; aynı imzanın PNG'si 20-80 KB VE bir Storage
-- nesnesi + imzalı URL + silme sorumluluğu demek. Vektör ayrıca ölçeklenir
-- (mahkemeye giden PDF'te bulanıklaşmaz) ve veritabanı yedeğinin İÇİNDE
-- taşınır — Storage ayrı yedeklenir, kanıtın yarısının başka yerde olması
-- kötü bir bölünmedir.
--
-- `imza_yol` yalnız YEDEK yol: imzayı yol verisi olarak üretemeyen bir istemci
-- (ör. hazır bir imza bileşeni yalnız PNG veriyorsa) raster yükleyebilsin.
-- İkisi birden dolu olamaz — hangisinin gerçek olduğu belirsiz kalırdı.
--
-- ═══ FOTOĞRAF NEREDE ═══
--
-- Mevcut düzenle AYNI: özel (public=false) Supabase Storage kovası, 5 MB tavan,
-- görüntü MIME'ları; okuma kısa ömürlü imzalı URL ile (lib/storage.ts).
-- Kova BURADA yaratılıyor — 007 ve 020 de kovalarını kendi migration'ında
-- yaratıyor, aynı desen.
--
-- ⚠️ SAKLAMA SÜRESİ: kanıt SİLİNMEZ. Telemetri temizliği (054) buraya
-- UYGULANMAZ; bir teslimat delili, faturanın ömrü kadar yaşamalı (AT: § 132
-- BAO, yedi yıl). Maliyet küçük: 1600px/q0.85 JPEG ≈ 250 KB; günde 30 teslimat
-- × 2 fotoğraf ≈ 15 MB/gün ≈ 5,5 GB/yıl.
--
-- ═══ DEĞİŞMEZLİK — KANITIN TEK GERÇEK ÖZELLİĞİ ═══
--
-- Sonradan düzenlenebilen bir kayıt delil değildir. `teslimat_degismez`
-- tetikleyicisi bu tablodaki HER GÜNCELLEMEYİ reddeder; tek istisna İPTAL
-- (`iptal_at` / `iptal_sebep` / `iptal_eden`). Yani kanıt yazıldıktan sonra
-- yeniden yazılamaz, yalnız GEÇERSİZ İLAN EDİLEBİLİR ve o da sebebiyle
-- kayıtlıdır. Gerçek ePOD ürünleri de böyle çalışır: düzeltme, eski kaydın
-- üzerine değil YANINA yazılır.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar; yetki
-- uygulama katmanında (şoför yalnız KENDİ seferine kanıt bırakır).
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ── 1) TESLİMAT OLAYI ───────────────────────────────────────────────
create table if not exists public.teslimatlar (
  id uuid primary key default gen_random_uuid(),

  -- Hangi sefer. Sefer silinirse kanıt da gider: seferi olmayan bir teslimat
  -- kanıtının bağlamı yoktur.
  sefer_id uuid not null references public.seferler(id) on delete cascade,

  /**
   * Seferin KAÇINCI durağı. Bugün her seferde tek teslimat var ve bu 1'dir;
   * durak listesi geldiğinde aynı tablo N satır taşır.
   */
  durak_no smallint not null default 1 check (durak_no between 1 and 999),

  -- Kanıtı bırakan şoför.
  -- ⚠️ `on delete restrict` BİLEREK: kanıt taşıyan bir personel kaydını
  -- silmek, delili sessizce yok etmektir. Silme girişimi HATA vermeli ve
  -- insan karar vermeli. (Depoda personel zaten silinmez, pasifleştirilir.)
  worker_id uuid not null references public.workers(id) on delete restrict,

  -- Hangi bölgeye teslim edildi (varsa). Bölge silinirse kanıt kalır.
  zone_id uuid references public.geofences(id) on delete set null,

  -- Teslim alan kişi. Opsiyonel: kapıya bırakma (safe drop) da bir teslimattır.
  alici_ad text check (alici_ad is null or length(btrim(alici_ad)) between 1 and 80),

  notlar text check (notlar is null or length(notlar) <= 500),

  -- İMZA — vektör birincil (başlık bloğundaki gerekçe).
  imza_svg text check (imza_svg is null or length(imza_svg) between 8 and 200000),
  -- İmza RASTER yedek yolu (Storage). Vektör üretemeyen istemci için.
  imza_yol text,

  /**
   * KANITIN DEĞERİ BURADA: an ve yer.
   * `teslim_at` sunucu saatinden yazılır — istemci saatine güvenilmez, telefon
   * saati elle değiştirilebilir ve delilin zamanı tartışmaya açık olamaz.
   */
  teslim_at timestamptz not null default now(),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  konum_dogruluk_m double precision check (konum_dogruluk_m is null or konum_dogruluk_m >= 0),

  -- İPTAL — tek meşru "değişiklik". Kanıt silinmez, geçersiz ilan edilir.
  iptal_at timestamptz,
  iptal_sebep text check (iptal_sebep is null or length(btrim(iptal_sebep)) between 3 and 300),
  iptal_eden uuid references public.workers(id) on delete set null,

  created_at timestamptz not null default now(),

  -- Aynı durağın iki kanıtı olamaz (başlık bloğu).
  constraint teslimat_durak_uq unique (sefer_id, durak_no),

  -- İmzanın iki biçimi birden olamaz: hangisi gerçek belirsiz kalırdı.
  constraint teslimat_imza_tek_bicim
    check (imza_svg is null or imza_yol is null),

  -- İptal edildiyse sebebi de vardır. Sebepsiz iptal, iz bırakmayan bir
  -- geri alma olurdu.
  constraint teslimat_iptal_butun
    check ((iptal_at is null and iptal_sebep is null) or (iptal_at is not null and iptal_sebep is not null))
);

-- Yöneticinin sorusu: "bu seferin kanıtı".
create index if not exists teslimat_sefer_idx on public.teslimatlar (sefer_id);
-- Şoför ekseni ve tarih taraması ("dün ne teslim ettim").
create index if not exists teslimat_worker_zaman_idx
  on public.teslimatlar (worker_id, teslim_at desc);

-- ── 2) TESLİMAT FOTOĞRAFLARI ────────────────────────────────────────
create table if not exists public.teslimat_fotograflari (
  id uuid primary key default gen_random_uuid(),

  -- Fotoğraf teslimata aittir; teslimat giderse fotoğrafın anlamı kalmaz.
  teslimat_id uuid not null references public.teslimatlar(id) on delete cascade,

  -- Storage yolu: {workerId}/{yyyy}/{mm}/{uuid}.{ext} (lib/storage.ts deseni).
  storage_path text not null check (length(btrim(storage_path)) > 0),

  -- Fotoğrafın KENDİ anı ve yeri — teslimat damgasından farklı olabilir
  -- (kapıda çekildi, imza arabada alındı).
  taken_at timestamptz not null default now(),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  konum_dogruluk_m double precision check (konum_dogruluk_m is null or konum_dogruluk_m >= 0),

  created_at timestamptz not null default now(),

  -- Aynı dosya iki kez bağlanamaz (çift yükleme kazası).
  constraint teslimat_foto_yol_uq unique (storage_path)
);

create index if not exists teslimat_foto_teslimat_idx
  on public.teslimat_fotograflari (teslimat_id);

-- ── 3) DEĞİŞMEZLİK TETİKLEYİCİSİ ────────────────────────────────────
-- Kanıt yazıldıktan sonra YENİDEN YAZILAMAZ. Tek istisna iptal alanları.
create or replace function public.teslimat_degismez()
returns trigger
language plpgsql
as $$
begin
  if
    new.sefer_id          is distinct from old.sefer_id          or
    new.durak_no          is distinct from old.durak_no          or
    new.worker_id         is distinct from old.worker_id         or
    new.zone_id           is distinct from old.zone_id           or
    new.alici_ad          is distinct from old.alici_ad          or
    new.notlar            is distinct from old.notlar            or
    new.imza_svg          is distinct from old.imza_svg          or
    new.imza_yol          is distinct from old.imza_yol          or
    new.teslim_at         is distinct from old.teslim_at         or
    new.latitude          is distinct from old.latitude          or
    new.longitude         is distinct from old.longitude         or
    new.konum_dogruluk_m  is distinct from old.konum_dogruluk_m  or
    new.created_at        is distinct from old.created_at
  then
    raise exception
      'teslimat kaniti DEGISTIRILEMEZ (id=%). Yalnizca iptal alanlari guncellenebilir; duzeltme icin YENI bir durak kaydi acin.',
      old.id
      using errcode = 'HK080';
  end if;
  return new;
end
$$;

drop trigger if exists trg_teslimat_degismez on public.teslimatlar;
create trigger trg_teslimat_degismez
  before update on public.teslimatlar
  for each row execute function public.teslimat_degismez();

-- Fotoğraf satırı da değişmez: yolu değiştirmek, kanıtı başka bir görüntüyle
-- takas etmek olurdu. (Silme AYRI bir yetki sorunudur ve uygulama kapatır.)
create or replace function public.teslimat_foto_degismez()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'teslimat fotografi DEGISTIRILEMEZ (id=%).', old.id
    using errcode = 'HK080';
end
$$;

drop trigger if exists trg_teslimat_foto_degismez on public.teslimat_fotograflari;
create trigger trg_teslimat_foto_degismez
  before update on public.teslimat_fotograflari
  for each row execute function public.teslimat_foto_degismez();

-- ── 4) STORAGE KOVASI ───────────────────────────────────────────────
-- Diğer dört kovayla AYNI desen: özel, 5 MB, yalnız görüntü.
-- ⚠️ Bu satır Supabase'e özgüdür (storage şeması). Düz PostgreSQL'de
-- `storage.buckets` yoktur; kurulum dosyası bunu zaten böyle taşıyor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'teslimat-kaniti', 'teslimat-kaniti', false, 5242880,
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do nothing;

comment on table public.teslimatlar is
  'Teslimat kanıtı (ePOD, 080): imza + not + alıcı + an/yer damgası. DEĞİŞMEZ — yalnız iptal edilebilir. Kanıt seferin BİR DURAĞINA bağlıdır (durak_no), bugün tek durak.';
comment on table public.teslimat_fotograflari is
  'Teslimat kanıtı fotoğrafları (080). Özel kova: teslimat-kaniti. Satır DEĞİŞMEZ.';
comment on column public.teslimatlar.imza_svg is
  'İmza, SVG yol verisi (vektör). Birincil biçim: ~2-6 KB, ölçeklenir, DB yedeğinin içinde taşınır.';
comment on column public.teslimatlar.teslim_at is
  'Teslim anı — SUNUCU saatinden yazılır. İstemci saati elle değiştirilebilir; delilin zamanı tartışmaya açık olamaz.';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select count(*) from public.teslimatlar;             → 0 beklenir
-- select count(*) from public.teslimat_fotograflari;   → 0 beklenir
-- select id, public from storage.buckets where id = 'teslimat-kaniti';
--
-- Değişmezliği sınamak (satır varken):
--   update public.teslimatlar set notlar = 'x' where id = '<id>';
--   → HATA HK080 "teslimat kaniti DEGISTIRILEMEZ"
--   update public.teslimatlar set iptal_at = now(), iptal_sebep = 'yanlis adres'
--    where id = '<id>';   → GEÇER
--
-- ⚠️ 080 UYGULANMAZSA: teslimat kanıtı özelliği KAPALI kalır; panel ve şoför
-- ekranı normal çalışır, kanıt bölümü "bu kurulumda kapalı" der (aynı kademeli
-- düşüş 056/058/077/078/079'da da var).


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  081_dvir_ve_bakim.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 081 (ARAÇ KONTROL FORMU + İŞ EMRİ + PERİYODİK BAKIM)
-- =====================================================================
-- Üç parça, TEK migration: kontrol formunda işaretlenen kusur doğrudan iş
-- emrine dönüşüyor ve periyodik bakım aynı iş emri kuyruğuna düşüyor. Ayrı
-- migration'lara bölmek, aralarındaki yabancı anahtarı yarım bırakırdı.
-- Additive + idempotent. Supabase SQL Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM ÖNCE — DÖRT SORU, CANLI CEVAP (25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1) MEVCUT İKİ TABLO NE DURUMDA
--    · vehicle_maintenance (007): 0 SATIR. Plakayla bağlı (vehicle_id YOK),
--      service_type'ı SABİT listeli, next_service_km/date alanları VAR.
--      Yani bu tablo bir "yapılmış servis kaydı" — iş emri değil (durum,
--      öncelik, atanan, kapanış yok). KULLANILIYOR: aşağıda genişletiliyor.
--    · vehicle_fault_reports (056/057): 0 SATIR ama CANLIDA. vehicle_id FK'li,
--      durum acik/kapali, reported_by, closed_at/closed_by. Şoförün "arıza
--      bildir" yüzeyi (mobil U7) buraya yazıyor.
--    · vehicle_dtc: 1008 KAYIT, 15'i AÇIK — tek gerçekten dolu olan tablo.
--
-- 2) KUSUR NEREYE YAZILIR — ÖLÇÜME DAYALI KARAR
--    `vehicle_fault_reports` İŞ EMRİ TABLOSUNA DÖNÜŞTÜRÜLÜYOR (aşağıda
--    genişletiliyor), yeni bir tablo AÇILMIYOR. Gerekçe: "bu araçta ne sorun
--    var" sorusunun İKİ ayrı listesi olamaz. Şoförün bildirdiği arıza, kontrol
--    formundaki kusur ve elle açılan iş emri aynı kuyruğun üç kaynağıdır
--    (`kaynak` kolonu bunu söylüyor). Ayrı tablo açsaydık yönetici iki listeye
--    bakmak zorunda kalır, "araç sorunlu mu" sorusu iki yerden hesaplanırdı.
--    Tablo 0 satırda olduğu için genişletmenin veri maliyeti de sıfır.
--
-- 3) DTC İŞ EMRİNE BAĞLANMIYOR — ama ELLE DÖNÜŞTÜRÜLEBİLİR
--    1008 DTC kaydının 15'i açık ve çoğu ECU tarafından kendiliğinden
--    temizleniyor. Her kodu iş emrine çevirmek, kapanışını kimsenin yapmadığı
--    binlerce satır üretirdi. DTC bir BELİRTİ, iş emri bir KARAR. Bağ tek yönlü
--    ve İSTEĞE BAĞLI: yönetici bir kodu iş emrine çevirdiğinde `kaynak='dtc'`
--    ve açıklamada kod geçer. Şema düzeyinde zorunlu bir FK YOK — olsaydı DTC
--    silindiğinde iş emri de yetim kalırdı.
--
-- 4) ODOMETRE TELEMETRİDEN NE KADAR GÜVENİLİR (km bazlı bakımın temeli)
--    ÖLÇÜLDÜ: 30 aktif aracın 29'unda odometre okuması VAR, ama yalnız 18'i
--    48 saatten taze (medyan yaş 14 saat, en kötü 607 saat ≈ 25 gün).
--    SONUÇ: km eşiği tek başına yeterli DEĞİL. Bu yüzden plan tablosunda
--    aralık_km ve aralık_ay AYRI AYRI verilebiliyor ve motor ikisinden
--    hangisi önce dolarsa onu kullanıyor. Cihazı susmuş bir araçta km
--    ilerlemez; süre eşiği o aracı yine de yakalar. "Km okunamıyor" hâli
--    sessizce "bakım gerekmiyor"a dönüşemez.
--
-- ═══ KAYIT DEĞİŞMEZLİĞİ — 080'İN DESENİ ═══
--
-- Kontrol formu ve yanıtları, teslimat kanıtındaki kuralın aynısıyla korunuyor:
-- yazıldıktan sonra GÜNCELLENEMEZ, yalnız sebebiyle İPTAL edilebilir. Bir
-- kontrol formu hukuki bir beyandır ("aracı şu hâlde teslim aldım"); sonradan
-- düzeltilebilen bir beyanın değeri yoktur.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar; yetki
-- uygulama katmanında.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ═══════════════════════════════════════════════════════════════════════
-- A) KONTROL FORMU
-- ═══════════════════════════════════════════════════════════════════════

-- ── A1) KİRACININ MADDE SÖZLÜĞÜ ─────────────────────────────────────
-- 078'deki `document_types` deseninin aynısı: SABİT LİSTE YOK. Maddeler
-- ülkeye ve araç tipine göre değişir (TIR'da fren hattı, panelvanda yok);
-- bir enum ya da CHECK, her yeni ülke için dağıtım gerektirirdi.
create table if not exists public.dvir_maddeleri (
  id uuid primary key default gen_random_uuid(),

  -- Makine adı (kod içinde ve raporda). Kiracı serbestçe belirler.
  kod text not null,
  -- Ekranda görünen ad. i18n sözlüğüne GİRMEZ: kiracı verisi, ürün metni değil.
  etiket text not null check (length(btrim(etiket)) between 1 and 120),
  aciklama text check (aciklama is null or length(aciklama) <= 300),

  /**
   * Hangi kontrolde sorulur. Sefer öncesi ve sonrası AYNI madde kümesi
   * olmak zorunda değil: "yakıt seviyesi" dönüşte anlamlı, "lastik basıncı"
   * çıkışta.
   */
  tur text not null default 'ikisi' check (tur in ('once', 'sonra', 'ikisi')),

  /**
   * Hangi araç tipinde sorulur. NULL = HEPSİ. Serbest metin, çünkü araç tipi
   * de kiracıya göre değişiyor ve `vehicles` tablosunda tip kolonu YOK —
   * bugün eşleştirme yapılmıyor, alan ileriye dönük ve boş bırakılabilir.
   */
  arac_tipi text check (arac_tipi is null or length(btrim(arac_tipi)) between 1 and 40),

  sira integer not null default 100,

  -- Kapatılan madde GEÇMİŞ YANITLARI SİLMEZ: eski formlar okunur kalır,
  -- yeni formda madde çıkmaz (078'deki `active` ile aynı gerekçe).
  aktif boolean not null default true,

  created_at timestamptz not null default now(),
  created_by uuid references public.workers(id) on delete set null,

  -- Aynı kod iki kez tanımlanamaz; büyük/küçük harf farkı yeni madde DEĞİLDİR.
  constraint dvir_madde_kod_uq unique (kod)
);

create index if not exists dvir_madde_aktif_idx
  on public.dvir_maddeleri (sira) where aktif;

-- ── A2) DOLDURULMUŞ FORM ────────────────────────────────────────────
create table if not exists public.dvir_formlari (
  id uuid primary key default gen_random_uuid(),

  vehicle_id uuid not null references public.vehicles(id) on delete cascade,

  -- ⚠️ `on delete restrict`: form bir BEYANDIR, beyanı veren silinerek
  -- beyanın sahibi belirsizleştirilemez (080'deki aynı gerekçe).
  worker_id uuid not null references public.workers(id) on delete restrict,

  -- Hangi sefere ait (varsa). Sefer silinse form kalır: kontrol aracın
  -- durumunun kaydı, seferin eki değil.
  sefer_id uuid references public.seferler(id) on delete set null,

  tur text not null check (tur in ('once', 'sonra')),

  /**
   * ODOMETRE — telemetriden okunur, ELLE GİRDİRİLMEZ (görev kararı).
   * `odometre_kaynak` ölçümün nereden geldiğini söyler: cihaz sustuysa
   * `yok` yazılır ve km NULL kalır. Sessizce 0 yazmak, km bazlı bakımı
   * "hep sıfırda" bırakırdı (lib/km-quality.ts'teki aynı ders).
   */
  odometre_km integer check (odometre_km is null or odometre_km between 0 and 9999999),
  odometre_kaynak text not null default 'yok'
    check (odometre_kaynak in ('telemetri', 'yok')),

  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  konum_dogruluk_m double precision check (konum_dogruluk_m is null or konum_dogruluk_m >= 0),

  -- SUNUCU saatinden. İstemci saati elle değiştirilebilir.
  dolduruldu_at timestamptz not null default now(),

  -- İPTAL — tek meşru "değişiklik" (080 deseni).
  iptal_at timestamptz,
  iptal_sebep text check (iptal_sebep is null or length(btrim(iptal_sebep)) between 3 and 300),
  iptal_eden uuid references public.workers(id) on delete set null,

  created_at timestamptz not null default now(),

  constraint dvir_form_iptal_butun
    check ((iptal_at is null and iptal_sebep is null) or (iptal_at is not null and iptal_sebep is not null))
);

create index if not exists dvir_form_arac_zaman_idx
  on public.dvir_formlari (vehicle_id, dolduruldu_at desc);
create index if not exists dvir_form_worker_idx
  on public.dvir_formlari (worker_id, dolduruldu_at desc);
create index if not exists dvir_form_sefer_idx
  on public.dvir_formlari (sefer_id) where sefer_id is not null;

-- ── A3) YANITLAR ────────────────────────────────────────────────────
create table if not exists public.dvir_yanitlari (
  id uuid primary key default gen_random_uuid(),

  form_id uuid not null references public.dvir_formlari(id) on delete cascade,

  -- ⚠️ `restrict`: yanıtı okunur tutan şey maddenin ETİKETİ. Madde silinirse
  -- eski formlar "hangi soruya cevap" bilgisini kaybederdi. Maddeler zaten
  -- silinmez, pasifleştirilir.
  madde_id uuid not null references public.dvir_maddeleri(id) on delete restrict,

  durum text not null check (durum in ('tamam', 'kusurlu', 'uygulanamaz')),

  notlar text check (notlar is null or length(notlar) <= 500),
  -- Storage yolu: {workerId}/{yyyy}/{mm}/{uuid}.{ext} (lib/storage.ts deseni).
  foto_yolu text,

  created_at timestamptz not null default now(),

  -- Aynı maddeye iki yanıt olamaz.
  constraint dvir_yanit_uq unique (form_id, madde_id),

  /**
   * ⚠️ KUSURDA FOTOĞRAF VE NOT ZORUNLU — şema düzeyinde.
   * Uygulama katmanında da denetleniyor ama kural buraya yazıldı: "kusurlu"
   * diyip hiçbir kanıt bırakmayan bir satır, iş emrini gerekçesiz açardı ve
   * servisteki kişi neye bakacağını bilemezdi.
   */
  constraint dvir_kusur_kanit_sart
    check (
      durum <> 'kusurlu'
      or (foto_yolu is not null and length(btrim(foto_yolu)) > 0
          and notlar is not null and length(btrim(notlar)) > 0)
    )
);

create index if not exists dvir_yanit_form_idx on public.dvir_yanitlari (form_id);
-- "Bu maddede kaç kusur çıktı" — madde ekseninde rapor.
create index if not exists dvir_yanit_kusur_idx
  on public.dvir_yanitlari (madde_id) where durum = 'kusurlu';

-- ── A4) DEĞİŞMEZLİK ─────────────────────────────────────────────────
-- 080'deki kuralın aynısı: form ve yanıt yazıldıktan sonra düzeltilemez.
create or replace function public.dvir_form_degismez()
returns trigger
language plpgsql
as $$
begin
  if
    new.vehicle_id       is distinct from old.vehicle_id       or
    new.worker_id        is distinct from old.worker_id        or
    new.sefer_id         is distinct from old.sefer_id         or
    new.tur              is distinct from old.tur              or
    new.odometre_km      is distinct from old.odometre_km      or
    new.odometre_kaynak  is distinct from old.odometre_kaynak  or
    new.latitude         is distinct from old.latitude         or
    new.longitude        is distinct from old.longitude        or
    new.konum_dogruluk_m is distinct from old.konum_dogruluk_m or
    new.dolduruldu_at    is distinct from old.dolduruldu_at    or
    new.created_at       is distinct from old.created_at
  then
    raise exception
      'kontrol formu DEGISTIRILEMEZ (id=%). Yalnizca iptal alanlari guncellenebilir; duzeltme icin YENI form doldurun.',
      old.id
      using errcode = 'HK081';
  end if;
  return new;
end
$$;

drop trigger if exists trg_dvir_form_degismez on public.dvir_formlari;
create trigger trg_dvir_form_degismez
  before update on public.dvir_formlari
  for each row execute function public.dvir_form_degismez();

create or replace function public.dvir_yanit_degismez()
returns trigger
language plpgsql
as $$
begin
  raise exception 'kontrol yaniti DEGISTIRILEMEZ (id=%).', old.id using errcode = 'HK081';
end
$$;

drop trigger if exists trg_dvir_yanit_degismez on public.dvir_yanitlari;
create trigger trg_dvir_yanit_degismez
  before update on public.dvir_yanitlari
  for each row execute function public.dvir_yanit_degismez();

-- ═══════════════════════════════════════════════════════════════════════
-- B) İŞ EMRİ — vehicle_fault_reports GENİŞLETİLİYOR
-- ═══════════════════════════════════════════════════════════════════════
-- Yeni tablo AÇILMIYOR (başlıktaki 2. madde). Mevcut satır sayısı 0, yani
-- genişletme geriye dönük bir veri sorunu doğurmuyor.
alter table public.vehicle_fault_reports
  -- Nereden doğdu: şoför bildirimi, kontrol formu kusuru, DTC kodu,
  -- periyodik bakım ya da elle. Varsayılan 'surucu' — mevcut mobil ucun
  -- (U7) yazdığı satırlar aynen o kaynaktan geliyor.
  add column if not exists kaynak text not null default 'surucu'
    check (kaynak in ('surucu', 'dvir', 'dtc', 'periyodik', 'elle')),

  /**
   * Kusurdan doğan iş emrinin KAYNAK YANITI. Yalnız `kaynak='dvir'` yolunda
   * dolu; DTC ve elle açılışta NULL (başlıktaki 3. madde: DTC'ye zorunlu FK
   * kurulmadı). Yanıt silinirse iş emri yetim kalmasın diye `set null`.
   */
  add column if not exists dvir_yanit_id uuid
    references public.dvir_yanitlari(id) on delete set null,

  add column if not exists oncelik text not null default 'normal'
    check (oncelik in ('dusuk', 'normal', 'yuksek', 'kritik')),

  -- Kime atandı (servis sorumlusu). Hesap silinirse iş emri kalır.
  add column if not exists atanan_id uuid references public.workers(id) on delete set null,

  add column if not exists maliyet numeric(10,2) check (maliyet is null or maliyet >= 0),
  add column if not exists servis_at timestamptz,
  add column if not exists kapanis_notu text check (kapanis_notu is null or length(kapanis_notu) <= 500);

/**
 * DURUM ÜÇE ÇIKIYOR: acik → serviste → kapali.
 *
 * Eski kısıt yalnız acik/kapali tanıyordu. "Serviste" ara durumu olmadan
 * yönetici "haberdarım ve iş serviste" ile "hiç dokunulmadı"yı ayıramıyordu.
 * ⚠️ Mobil uç (U7 PATCH) yalnız acik/kapali gönderiyor — genişletme onu
 * BOZMAZ, sadece panelden üçüncü durum atanabilir.
 */
do $durum$
declare
  k text;
begin
  for k in
    select conname from pg_constraint
     where conrelid = 'public.vehicle_fault_reports'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%durum%'
  loop
    execute format('alter table public.vehicle_fault_reports drop constraint %I', k);
  end loop;
  alter table public.vehicle_fault_reports
    add constraint vehicle_fault_reports_durum_chk
    check (durum in ('acik', 'serviste', 'kapali'));
end
$durum$;

-- "Bu araçta AÇIK iş emri var mı" — araç 'sorunlu' rozetinin kaynağı.
-- ⚠️ Rozet için `vehicles`a bayrak KOYULMADI: açık iş emrinin varlığı zaten
-- gerçeğin kendisi; ikinci bir kolon senkron tutulacak ikinci bir gerçek olurdu.
create index if not exists fault_acik_arac_idx
  on public.vehicle_fault_reports (vehicle_id)
  where durum <> 'kapali';

create index if not exists fault_kaynak_idx
  on public.vehicle_fault_reports (kaynak, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════
-- C) PERİYODİK BAKIM
-- ═══════════════════════════════════════════════════════════════════════

-- ── C1) vehicle_maintenance'A ARAÇ BAĞI ─────────────────────────────
/**
 * Tablo bugün araca PLAKA METNİYLE bağlı (007) ve yabancı anahtarı yok.
 * Plaka değişebilir; km bazlı bakım ise telemetriyi `vehicle_id` üzerinden
 * okuyor. İkisini birbirine bağlayacak kolon ekleniyor.
 *
 * ⚠️ `vehicle_plate` KALDIRILMIYOR: yakıt raporu ve CO₂ hesabı hâlâ onu
 * kullanıyor. Yeni kayıtlar İKİSİNİ birden yazar; eski davranış bozulmaz.
 */
alter table public.vehicle_maintenance
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists bakim_plani_id uuid;

create index if not exists vehicle_maintenance_arac_idx
  on public.vehicle_maintenance (vehicle_id, serviced_at desc);

-- ── C2) BAKIM PLANI ─────────────────────────────────────────────────
create table if not exists public.bakim_planlari (
  id uuid primary key default gen_random_uuid(),

  -- NULL = TÜM FİLO. "Her araçta 8.000 km'de yağ" tek satırla kurulur;
  -- araca özel istisna aynı tabloda ikinci bir satırdır.
  vehicle_id uuid references public.vehicles(id) on delete cascade,

  -- Bakım türü SERBEST METİN — kiracı belirler (007'deki sabit liste bu
  -- tabloya taşınmadı; ülkeye göre "Pickerl", "TÜV", "muayene" hepsi farklı ad).
  tip text not null check (length(btrim(tip)) between 1 and 60),

  /**
   * İKİ EŞİK, "HANGİSİ ÖNCE" MANTIĞI.
   * Yalnız km yazsaydık, cihazı susmuş araç (ölçüldü: 30 araçtan 12'sinde
   * odometre 48 saatten eski) hiç bakıma girmezdi. Yalnız ay yazsaydık, çok
   * çalışan araç zamanından önce yıpranırdı. İkisinden biri zorunlu.
   */
  aralik_km integer check (aralik_km is null or aralik_km between 100 and 500000),
  aralik_ay integer check (aralik_ay is null or aralik_ay between 1 and 120),

  -- Sayacın başlangıcı: son bakımın km'si ve tarihi.
  son_bakim_km integer check (son_bakim_km is null or son_bakim_km >= 0),
  son_bakim_at timestamptz,

  -- Ne kadar önce uyarılsın (Dikkat panosu + push eşiği).
  uyari_km integer not null default 500 check (uyari_km between 0 and 50000),
  uyari_gun integer not null default 14 check (uyari_gun between 0 and 365),

  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.workers(id) on delete set null,

  -- En az bir eşik olmalı; ikisi de boş bir plan hiçbir zaman tetiklenmez.
  constraint bakim_plani_esik_sart
    check (aralik_km is not null or aralik_ay is not null),

  -- Aynı araç + aynı tip için iki aktif plan olamaz. (NULL vehicle_id =
  -- filo geneli; Postgres'te NULL'lar tekil kısıtta çakışmaz, o yüzden
  -- filo geneli plan da tip başına tektir — kısmi indeksle aşağıda.)
  constraint bakim_plani_arac_tip_uq unique (vehicle_id, tip)
);

-- Filo geneli planlarda (vehicle_id NULL) tip başına tek satır: yukarıdaki
-- tekil kısıt NULL'ları çakıştırmadığı için ayrı kısmi indeks gerekiyor.
create unique index if not exists bakim_plani_filo_tip_uq
  on public.bakim_planlari (tip) where vehicle_id is null;

create index if not exists bakim_plani_aktif_idx
  on public.bakim_planlari (aktif) where aktif;

comment on table public.dvir_maddeleri is
  'Kiracının tanımladığı araç kontrol maddeleri (081). SABİT LİSTE YOK: ülkeye ve araç tipine göre değişir.';
comment on table public.dvir_formlari is
  'Doldurulmuş araç kontrol formu (081). DEĞİŞMEZ — yalnız iptal edilebilir. Odometre TELEMETRİDEN, saat SUNUCUDAN.';
comment on table public.dvir_yanitlari is
  'Kontrol formu yanıtları (081). Kusurda fotoğraf VE not şema düzeyinde zorunlu. Satır DEĞİŞMEZ.';
comment on table public.bakim_planlari is
  'Periyodik bakım kuralı (081): km ve/veya ay aralığı. Hangisi önce dolarsa o tetikler; cihazı susmuş araç süre eşiğiyle yakalanır.';
comment on column public.vehicle_fault_reports.kaynak is
  'İş emrinin doğduğu yer: surucu | dvir | dtc | periyodik | elle. DTC bağı isteğe bağlıdır — kod bir belirti, iş emri bir karardır.';

-- ── KOVA ──────────────────────────────────────────────────────────────
-- Kusur fotoğrafları için ayrı özel kova. Neden mevcut kovalardan birine
-- değil: kontrol formu fotoğrafı bir KANITTIR ve saklama süresi/erişimi
-- fiş fotoğraflarından farklı yönetilebilmeli. `storage` şeması yoksa
-- (yerel Postgres) bu blok sessizce atlanır — kurulum dosyası da böyle taşıyor.
do $kova$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'dvir-fotolari', 'dvir-fotolari', false, 5242880,
      array['image/jpeg','image/png','image/webp','image/heic']
    )
    on conflict (id) do nothing;
  end if;
end
$kova$;
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select count(*) from public.dvir_maddeleri;    → 0 (maddeleri panelden açarsınız)
-- select count(*) from public.dvir_formlari;     → 0
-- select count(*) from public.bakim_planlari;    → 0
-- select durum, count(*) from public.vehicle_fault_reports group by 1;
-- \d public.vehicle_fault_reports                → kaynak/oncelik/atanan_id/... görünür
--
-- Değişmezliği sınamak (form varken):
--   update public.dvir_formlari set tur = 'sonra' where id = '<id>';
--   → HATA HK081 "kontrol formu DEGISTIRILEMEZ"
--   update public.dvir_formlari set iptal_at = now(), iptal_sebep = 'yanlis arac'
--    where id = '<id>';   → GEÇER
--
-- Kusurda kanıt zorunluluğu:
--   insert into public.dvir_yanitlari (form_id, madde_id, durum)
--   values ('<form>', '<madde>', 'kusurlu');
--   → HATA: dvir_kusur_kanit_sart
--
-- ⚠️ 081 UYGULANMAZSA: kontrol formu, iş emri alanları ve periyodik bakım
-- KAPALI kalır; mevcut arıza bildirimi (U7) ve panel aynen çalışır (kademeli
-- düşüş deseni 056/058/077/078/079/080'de de var).


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  082_sefer_duraklari.sql                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 082 (ÇOK DURAKLI SEFER)
-- =====================================================================
-- Sefer artık TEK hedefli değil: sıralı bir DURAK LİSTESİ taşıyor. Additive +
-- idempotent; hiçbir satır silinmez, hiçbir kolon düşürülmez. Supabase SQL
-- Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM ÖNCE — DÖRT SORU, CANLI CEVAP (25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1) MEVCUT `seferler.zone_id` NASIL TAŞINACAK
--    ÖLÇÜLDÜ (PostgREST, üç kiracı):
--      · HAK61   : 11 sefer — `zone_id` DOLU olan **0**, `vehicle_id` dolu 0,
--                  `vardi_at` dolu 0. teslimatlar 0, takip linkleri 0.
--      · Sendigo : 0 sefer, 0 geofence.
--      · galzura-demo: service anahtarı yok (kasıtlı, bkz. proje notları);
--                  şema 081 hizasında, veri ölçülemedi.
--    Yani geriye dönük taşıma HAK61 ve Sendigo'da **hiçbir satıra dokunmaz**.
--    Yine de yazıldı: galzura ve ileride açılacak kiracılar için doğru olmak
--    zorunda. Kural — `zone_id` DOLU olan her sefer 1 numaralı durağını alır;
--    `zone_id` BOŞ olan sefer durak ALMAZ. Boş hedefli bir sefere isimsiz bir
--    yer tutucu durak açmak, olmayan bir veriyi uydurmak olurdu.
--
-- 2) SERBEST ADRES Mİ, HER DURAK BİR BÖLGE Mİ — SEKTÖR NE YAPIYOR
--    Ölçüldü (25.08.2026, üretici belgeleri):
--      · Samsara — durak konumu İKİ biçimde verilir: kayıtlı **Address**
--        (kendi geofence'i, varsayılan 250 m, özelleştirilebilir) ya da
--        **singleUseLocation** (`address` + `latitude` + `longitude`, dairesel
--        geofence, varsayılan 300 m, `radiusMeters` ile geçilebilir). Samsara
--        singleUseLocation için JEOKODLAMA YAPMAZ: koordinatı çağıran verir.
--      · Onfleet — `destination.address`; `unparsed` verilirse otomatik
--        jeokodlanır, `[lng,lat]` verilirse jeokodlama ATLANIR.
--      · Routific — `location.coords` yoksa `location.address` jeokodlanır.
--    Üçünde de ortak: hedef ya KAYITLI bir yer ya SERBEST bir yer, ve serbest
--    yerde koordinat verilebiliyorsa jeokodlama atlanıyor. Model buna göre:
--    her durak `zone_id` (kayıtlı bölge) VEYA serbest `adres` + isteğe bağlı
--    `latitude/longitude` + `yaricap_m` taşır.
--
-- 3) JEOKODLAMA GEREKİYOR MU — HANGİ SERVİS, MALİYET NE
--    ÖLÇÜLDÜ: depoda jeokodlama YOK (`grep` → Nominatim/Mapbox/Google/HERE
--    çağrısı sıfır; docs/MOBIL-KESIF.md:2331 aynı şeyi söylüyor). Bu turda da
--    EKLENMİYOR. Gerekçe üç ölçüm:
--      a) Nominatim'in kullanım politikası bu ürünü ADIYLA dışarıda bırakıyor:
--         "package/vehicle tracking applications … must run their own service"
--         + kamuya açık uçta saniyede 1 istek tavanı. Yani meşru yol kendi
--         sunucumuzu işletmek — bir jeokodlama sunucusu bu turun konusu değil.
--      b) Ticari servis maliyeti (1.000 istek): Google 5,00 $ · HERE 0,83 $ ·
--         Mapbox 0,75 $ · LocationIQ 0,49 $. Ücretsiz kademe HERE 250k/ay,
--         Mapbox 100k/ay. Günde 80 durak × 30 araç ≈ 72k/ay → ücretsiz
--         kademeye sığar ama üçüncü tarafa YENİ bir dış bağımlılık ve her
--         kiracıya ayrı anahtar demek.
--      c) Gerek YOK: koordinat zaten haritadan tıklanarak alınıyor
--         (`components/GeofencePickerMap.tsx` bugün bölge merkezi için tam
--         bunu yapıyor) ve Samsara'nın singleUseLocation'ı da koordinatı
--         çağırandan istiyor. Adres bir ETİKET, koordinat bir ÖLÇÜMDÜR.
--    ⚠️ ŞEMA JEOKODLAMAYA HAZIR: `adres` dolu + `latitude/longitude` boş bir
--    durak BUGÜN meşrudur (otomatik varış çalışmaz, elle işaretlenir). Bir gün
--    jeokodlama eklenirse o satırların koordinatını doldurur — ŞEMA DEĞİŞMEZ.
--
-- 4) 070 VARIŞ KÖPRÜSÜ DURAK EKSENİNE NASIL TAŞINIR
--    070 bugün `zone_visits` okuyup `seferler.vardi_at` damgalıyor. Aynı üç
--    kural (bölge eşleşmesi · seferin günü ve açılışından sonra · VARDİYA
--    kimlik kontrolü) durak eksenine taşınıyor:
--      · `zone_id`li durak → `zone_visits` üzerinden (motor aynen kullanılır,
--        `zone_visits`e TEK BİR SATIR yazılmaz).
--      · koordinatlı durak → flespi turunun BELLEKTEKİ noktalarıyla dairesel
--        test. Ek sorgu YOK; noktalar tur içinde zaten çekiliyor.
--    `seferler.vardi_at` ANLAMINI KORUYOR: seferin İLK varışı. Durak listesi
--    olan seferde ilk durağın varışı onu da damgalar; durak listesi olmayan
--    seferde eski `zone_id` yolu aynen çalışır (geriye uyum).
--
-- ═══ NEDEN AYRI TABLO, `seferler`e KOLON DEĞİL ═══
--
-- Durak sayısı 1 değil N (son-mil dağıtımda günde 30-80). Kolona sığmaz;
-- jsonb'ye koymak ise `assignments` (006) hatasının tekrarı olurdu — o tablo
-- durakları `stops jsonb` tutuyordu ve canlıda 0 satırla öldü. jsonb'de durak
-- durumu güncellenemez (tüm diziyi yeniden yazmak gerekir, iki şoför yarışır),
-- durağa YABANCI ANAHTAR verilemez (teslimat kanıtı bağlanamaz) ve "bugün kaç
-- durak bekliyor" sorusu indekslenemez.
--
-- ═══ "DURAK" KELİMESİ İKİ ANLAMDA KULLANILIYOR — KARIŞTIRMAYIN ═══
--
-- `/api/mobile/vehicles/[id]/duraklar` GPS'ten TÜRETİLMİŞ durakları döndürür
-- (araç nerede kaç dakika durdu — `lib/metrics-trips.ts`). Bu tablo ise
-- PLANLANMIŞ duraklardır: yönetici yazar, şoför ilerletir. İkisi ayrı gerçek;
-- bu tablo o uca ne yazar ne okur.
--
-- ═══ RLS ═══
-- Kapalı — 066/079/080/081 ile tutarlı. Yalnız service-role yazar; yetki
-- uygulama katmanında (şoför yalnız KENDİ seferinin durağını ilerletir).
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ── 1) DURAK ────────────────────────────────────────────────────────
create table if not exists public.sefer_duraklari (
  id uuid primary key default gen_random_uuid(),

  -- Durak seferin parçasıdır; sefer giderse durağın bağlamı kalmaz.
  sefer_id uuid not null references public.seferler(id) on delete cascade,

  /**
   * SIRA — şoförün göreceği düzen. 1'den başlar, boşluksuz tutulur (yeniden
   * sıralama tüm satırları yeniden numaralar).
   */
  sira smallint not null check (sira between 1 and 999),

  /**
   * DURAĞIN ADI — ZORUNLU ve tek zorunlu insan alanı.
   *
   * ⚠️ Bölge seçilse bile ad AYRI tutuluyor, `geofences.name`den her okumada
   * türetilmiyor: ad seferin yazıldığı ANIN anlık görüntüsüdür. Bölge yarın
   * yeniden adlandırılırsa ya da silinirse ("Metzgerei Huber" → "Müşteri 12"),
   * dün yapılan seferin kaydı "Metzgerei Huber" demeye devam etmeli.
   * `zone_visits.worker_id`in donduruluş gerekçesiyle aynı ilke.
   */
  ad text not null check (length(btrim(ad)) between 1 and 120),

  -- ── HEDEF: İKİ BİÇİM (Samsara Address / singleUseLocation ayrımı) ──
  /**
   * A) KAYITLI BÖLGE. Doluysa varış `zone_visits` motorundan gelir ve
   * yarıçap bölgenin kendi `radius_m`sidir (`yaricap_m` yok sayılır).
   *
   * ⚠️ `on delete set null` — bölge silinirse durak KAYBOLMAZ, hedefi boşalır.
   * Bu yüzden "hedef mutlaka dolu olmalı" diye bir CHECK KONMADI: öyle bir
   * kısıt, bölge silme işlemini (ON DELETE SET NULL bir UPDATE'tir ve CHECK
   * denetlenir) hata ile düşürürdü. `seferler.zone_id` ile aynı duruş.
   */
  zone_id uuid references public.geofences(id) on delete set null,

  /**
   * B) SERBEST HEDEF. `adres` bir ETİKETTİR (jeokodlanmaz, bkz. başlık §3);
   * ölçüm yapan şey koordinattır. İkisi de opsiyonel:
   *   · adres + koordinat → otomatik varış ÇALIŞIR
   *   · yalnız adres      → otomatik varış YOK, şoför elle işaretler
   * İkinci hâl bilerek meşru: 30 durağı elle haritadan tıklatmak yerine
   * adresleri yazıp yola çıkmak gerçek bir kullanım.
   */
  adres text check (adres is null or length(btrim(adres)) between 1 and 300),
  latitude  double precision check (latitude  is null or latitude  between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),

  /**
   * Serbest hedefin varış yarıçapı. Sektör ölçüsü: Samsara kayıtlı adreste
   * 250 m, tek kullanımlık konumda 300 m varsayılan. Son-mil dağıtımda 250 m
   * komşu sokağı da kapsıyor; varsayılan 150 m seçildi. Alt sınır 50 m —
   * altında GPS gürültüsü (tipik ±10-30 m, tünel/kanyon daha kötü) ölçümün
   * kendisinden büyük olur ve varış rastgele düşer.
   * `zone_id` doluysa bu alan KULLANILMAZ.
   */
  yaricap_m integer not null default 150 check (yaricap_m between 50 and 5000),

  -- ── PLAN ────────────────────────────────────────────────────────────
  /**
   * ZAMAN PENCERESİ — `time`, `timestamptz` DEĞİL.
   * Sefer bir GÜN birimidir (066). Pencere o günün saat aralığıdır; tam
   * damgalı bir alan, olmayan bir kesinlik vaat eder ve gün sınırı sorusunu
   * her okumada yeniden doğururdu. Biri boş olabilir: "12:00'dan önce" da
   * "14:00'ten sonra" da gerçek bir müşteri kısıtıdır.
   */
  pencere_bas time,
  pencere_bit time,

  -- Durakta geçmesi beklenen süre (dk). Rota planlaması için değil, şoförün
  -- günü okuyabilmesi için — bu depoda rota motoru YOK ve bu alan onu ima
  -- etmiyor.
  tahmini_sure_dk smallint check (tahmini_sure_dk is null or tahmini_sure_dk between 1 and 1440),

  notlar text check (notlar is null or length(notlar) <= 500),

  -- ── DURUM ÇİZGİSİ ───────────────────────────────────────────────────
  /**
   * bekliyor → varildi → tamamlandi   (+ atlandi: SEBEBİYLE)
   *
   * ⚠️ SEFERİN durum çizgisinden (atandi/kabul/yolda/tamamlandi/iptal) AYRI ve
   * ona bağlı DEĞİL. Sefer "yolda" iken duraklar tek tek ilerler; seferi
   * kapatmak şoförün ayrı bir eylemidir (066 kararı korunuyor).
   *
   * `atlandi` bir başarısızlık değil, GERÇEK bir sonuçtur: kapalı dükkân,
   * ulaşılamayan alıcı, yanlış adres. Sebepsiz atlama, iz bırakmayan bir
   * "yapmadım" olurdu — CHECK sebebi zorunlu kılıyor.
   */
  durum text not null default 'bekliyor'
    check (durum in ('bekliyor','varildi','tamamlandi','atlandi')),

  atlama_sebep text check (atlama_sebep is null or length(btrim(atlama_sebep)) between 3 and 300),
  constraint sefer_durak_atlama_butun
    check (durum <> 'atlandi' or atlama_sebep is not null),

  varildi_at    timestamptz,
  tamamlandi_at timestamptz,
  atlandi_at    timestamptz,

  /**
   * VARIŞI KİM DAMGALADI.
   *
   * 070'in ilkesi burada da geçerli ama BİR ADIM ÖTEYE gidiyor: orada "vardı"
   * bir durum değil bilgi damgasıydı, çünkü şoförün basmadığı bir adım durum
   * çizgisine giremezdi. Durakta ise "varıldı" GERÇEK bir adım ve hem sistem
   * hem şoför yazabiliyor. O yüzden KAYNAK kayda geçiyor: "sistem mi gördü,
   * şoför mü söyledi" sorusu sonradan cevaplanamaz olmamalı.
   */
  varis_kaynak text check (varis_kaynak is null or varis_kaynak in ('sofor','otomatik')),

  created_at timestamptz not null default now(),

  constraint sefer_durak_pencere_sira
    check (pencere_bas is null or pencere_bit is null or pencere_bas <= pencere_bit),

  /**
   * SIRA SEFER İÇİNDE TEKİL — ama ERTELENMİŞ.
   *
   * ⚠️ `deferrable initially deferred` ZORUNLU: yeniden sıralama, iki durağın
   * numarasını takas eder. Ertelenmemiş bir tekillikte tek bir toplu UPDATE
   * bile satır satır denetlendiği için ARADA çakışır ve reddedilir; çözüm
   * "önce geçici numaraya taşı" gibi bir hile olurdu. Ertelenmişte denetim
   * COMMIT'te yapılır ve tek ifade sorunsuz geçer.
   *
   * ⚠️ BEDELİ: ertelenmiş bir tekil kısıt `ON CONFLICT` hakemi OLAMAZ
   * (`upsert(onConflict:"sefer_id,sira")` → 42P10). Yeniden sıralama zaten
   * upsert kullanmıyor: aşağıdaki `sefer_duraklari_sirala()` fonksiyonu tek
   * `update` ifadesiyle yazıyor — gerekçesi o fonksiyonun başlığında.
   */
  constraint sefer_durak_sira_uq unique (sefer_id, sira) deferrable initially deferred
);

-- Şoförün ve panelin birincil okuması: seferin durakları, sırasıyla.
create index if not exists idx_sefer_durak_sefer
  on public.sefer_duraklari (sefer_id, sira);

-- VARIŞ KÖPRÜSÜNÜN okuması: yalnız BEKLEYEN duraklar. Kapanmış/atlanmış
-- satırlar indekse hiç girmez — köprü her turda koşuyor, tarama dar kalmalı.
create index if not exists idx_sefer_durak_bekleyen
  on public.sefer_duraklari (sefer_id)
  where durum = 'bekliyor';

/**
 * YENİDEN SIRALAMA — TEK İFADE, VERİTABANINDA.
 *
 * ═══ NEDEN FONKSİYON, PostgREST upsert'i DEĞİL ═══
 *
 * ÖLÇÜLDÜ (25.08.2026, QA yığınında): supabase-js `upsert` çağrısı yalnız
 * `id`+`sira` gövdesiyle **23502 ile düşüyor** — "null value in column
 * `sefer_id`". Sebep PostgREST'in upsert'i INSERT olarak kurması ve eksik
 * kolonları NULL'la doldurması; çakışma çözülse bile NOT NULL denetimi önce
 * çalışıyor. Tek çıkış yolu TAM SATIR göndermekti ve o da EŞZAMANLI DURUM
 * DEĞİŞİKLİĞİNİ EZERDİ: yönetici sıralarken şoför bir durağı "tamamlandı"
 * yaparsa, okunmuş eski `durum` geri yazılır ve şoförün eylemi SİLİNİRDİ.
 *
 * Bu fonksiyon yalnız `sira` kolonuna dokunuyor. Tek `update` ifadesi olduğu
 * için `sefer_durak_sira_uq` (ertelenmiş) COMMIT'te bir kez denetleniyor —
 * takas (1↔3) sorunsuz geçiyor.
 *
 * ⚠️ `p_sefer` KAPI DEĞİL, EMNİYET KİLİDİ: kimlik denetimi uygulama
 * katmanında (app/actions/duraklar.ts). Buradaki `d.sefer_id = p_sefer`
 * koşulu, yanlış seferin kimliklerinin sızmasını imkânsız kılıyor.
 *
 * ⚠️ EKSİK LİSTE SESSİZ KALMAZ: dizide adı geçmeyen durak eski numarasında
 * kalır ve tekillik ihlali doğar (23505). Uygulama zaten TAM liste şartı
 * koyuyor; bu, o şartın veritabanındaki karşılığı.
 */
create or replace function public.sefer_duraklari_sirala(p_sefer uuid, p_ids uuid[])
returns integer
language plpgsql
as $$
declare
  v_etkilenen integer;
begin
  update public.sefer_duraklari d
     set sira = x.yeni
    from (
      select t.id, t.ord::smallint as yeni
        from unnest(p_ids) with ordinality as t(id, ord)
    ) x
   where d.id = x.id
     and d.sefer_id = p_sefer
     and d.sira is distinct from x.yeni;
  get diagnostics v_etkilenen = row_count;
  return v_etkilenen;
end
$$;

comment on function public.sefer_duraklari_sirala(uuid, uuid[]) is
  'Durakları verilen kimlik sırasına göre 1..N numaralar. TEK ifade — ertelenmiş tekillik takasa izin verir. Yalnız `sira` kolonuna dokunur (eşzamanlı durum değişikliği ezilmez).';

comment on table public.sefer_duraklari is
  'Seferin PLANLANMIŞ durakları (082). Sıralı liste; hedef ya kayıtlı bölge (zone_id) ya serbest adres+koordinat. GPS''ten türetilen duraklarla (metrics-trips) ilgisi YOKTUR.';
comment on column public.sefer_duraklari.ad is
  'Durağın adı — bölge seçilse bile AYRI tutulur: seferin yazıldığı anın anlık görüntüsü, bölge yeniden adlandırılsa/silinse bile doğru kalır.';
comment on column public.sefer_duraklari.yaricap_m is
  'Serbest hedefin varış yarıçapı (m). zone_id doluysa KULLANILMAZ — o durumda bölgenin kendi radius_m''si geçerlidir.';
comment on column public.sefer_duraklari.varis_kaynak is
  'Varışı kim damgaladı: sofor (elle) | otomatik (telemetri/zone_visits). null = henüz varılmadı.';

-- ── 2) TESLİMAT KANITI DURAĞA BAĞLANIYOR ────────────────────────────
--
-- 080 kanıtı zaten `durak_no` ile seferin BİR DURAĞINA bağlıyordu ve "durak
-- listesi eklendiği gün aynı tablo N satır taşır, HİÇBİR ŞEMA DEĞİŞİKLİĞİ
-- gerekmez" diyordu. Bir tek şey eksikti: `durak_no` bir SAYI, durak ise artık
-- bir SATIR. Sayı yeniden sıralamada değişir; kanıtın bağı değişmemeli.
--
-- ⚠️ `on delete set null` — durak silinirse kanıt DURUR. Delil, bağlandığı
-- planlama satırından uzun yaşar; kanıtı silmek 080'in tüm duruşuna aykırı
-- olurdu (kanıt silinmez, yalnız geçersiz ilan edilir).
alter table public.teslimatlar
  add column if not exists durak_id uuid references public.sefer_duraklari(id) on delete set null;

comment on column public.teslimatlar.durak_id is
  'Kanıtın bağlı olduğu durak satırı (082). durak_no ile FARKI: durak_no yeniden sıralamada değişebilen bir SAYI (yazıldığı andaki sıra), durak_id KALICI bağdır.';

/**
 * TEKİLLİK İKİYE BÖLÜNÜYOR — GARANTİ KORUNUYOR.
 *
 * 080'deki `teslimat_durak_uq (sefer_id, durak_no)` "aynı durağın iki kanıtı
 * olamaz" diyordu ve durak_no sabitken doğruydu. Duraklar yeniden
 * sıralanabildiği an ikisi birden bozuluyor: A durağı 1 numarayken kanıt
 * bıraktı, sıralama değişti, B durağı 1 oldu ve kanıt bırakamıyor — oysa hiç
 * kanıtı yok.
 *
 * Yerine İKİ KISMİ tekil indeks:
 *   · durak_id BOŞ satırlar (durak listesi olmayan eski/sade seferler)
 *     BUGÜNKÜ garantiyi aynen sürdürür: (sefer_id, durak_no) tekil.
 *   · durak_id DOLU satırlarda garanti DURAĞIN KENDİSİNE bağlanır ve
 *     `iptal_at is null` ile sınırlanır: bir durağın AYNI ANDA tek GEÇERLİ
 *     kanıtı olur. Geçersiz ilan edilmiş kanıt yeni denemeyi ENGELLEMEZ —
 *     yanlış kanıt zaten sebebiyle kayıtta duruyor (080), üstüne doğrusunu
 *     yazabilmek düzeltmenin ta kendisi.
 *
 * ⚠️ HİÇBİR SATIR SİLİNMİYOR/DEĞİŞMİYOR. Yalnız kısıt kısmi indekse çevriliyor.
 */
alter table public.teslimatlar drop constraint if exists teslimat_durak_uq;

create unique index if not exists teslimat_durak_no_uq
  on public.teslimatlar (sefer_id, durak_no)
  where durak_id is null;

create unique index if not exists teslimat_durak_id_uq
  on public.teslimatlar (durak_id)
  where durak_id is not null and iptal_at is null;

/**
 * DEĞİŞMEZLİK TETİKLEYİCİSİ GENİŞLETİLİYOR (080'in trg_teslimat_degismez).
 *
 * ⚠️ ZORUNLU: yeni bir kolon eklendiğinde tetikleyici onu SAYMAZSA, o kolon
 * kanıtın DEĞİŞTİRİLEBİLİR tek alanı olur. `durak_id` tam da kanıtın hangi
 * teslimata ait olduğunu söyleyen alan — güncellenebilir kalması, bir kanıtı
 * başka bir durağa taşımak demekti.
 *
 * Gövde 080'dekiyle AYNI, tek fark `durak_id` satırı. Yeniden yazılıyor çünkü
 * plpgsql fonksiyonu kısmi güncellenemez.
 */
create or replace function public.teslimat_degismez()
returns trigger
language plpgsql
as $$
begin
  if
    new.sefer_id          is distinct from old.sefer_id          or
    new.durak_no          is distinct from old.durak_no          or
    new.durak_id          is distinct from old.durak_id          or
    new.worker_id         is distinct from old.worker_id         or
    new.zone_id           is distinct from old.zone_id           or
    new.alici_ad          is distinct from old.alici_ad          or
    new.notlar            is distinct from old.notlar            or
    new.imza_svg          is distinct from old.imza_svg          or
    new.imza_yol          is distinct from old.imza_yol          or
    new.teslim_at         is distinct from old.teslim_at         or
    new.latitude          is distinct from old.latitude          or
    new.longitude         is distinct from old.longitude         or
    new.konum_dogruluk_m  is distinct from old.konum_dogruluk_m  or
    new.created_at        is distinct from old.created_at
  then
    raise exception
      'teslimat kaniti DEGISTIRILEMEZ (id=%). Yalnizca iptal alanlari guncellenebilir; duzeltme icin YENI bir durak kaydi acin.',
      old.id
      using errcode = 'HK080';
  end if;
  return new;
end
$$;

-- ── 3) GERİYE TAŞIMA: tek hedefli sefer → 1 duraklı sefer ────────────
--
-- ÖLÇÜLDÜ: HAK61'de 0, Sendigo'da 0 satır etkilenir (başlık §1). Yazılmasının
-- sebebi galzura-demo ve ileride açılacak kiracılar.
--
-- · `zone_id` BOŞ olan sefer durak ALMAZ — yer tutucu uydurulmaz.
-- · `not exists` koruması: dosya ikinci kez çalışırsa durak İKİLENMEZ.
-- · `ad` bölgenin O ANKİ adından donduruluyor; bölge adsızsa kaba bir yedek
--   yazılır ki NOT NULL kısıtı taşımayı düşürmesin.
-- · Durum `bekliyor` DEĞİL, seferin durumundan türetiliyor: kapanmış bir
--   seferin durağını "bekliyor" diye açmak, bitmiş işi açık göstermek olurdu.
--   `vardi_at` damgası varsa varış anı da taşınıyor (varis_kaynak='otomatik':
--   o damgayı 070 köprüsü yazmıştı, şoför değil).
insert into public.sefer_duraklari
  (sefer_id, sira, ad, zone_id, durum, varildi_at, varis_kaynak, tamamlandi_at)
select
  s.id,
  1,
  coalesce(nullif(btrim(g.name), ''), 'Hedef'),
  s.zone_id,
  case
    when s.durum = 'tamamlandi' then 'tamamlandi'
    when s.vardi_at is not null then 'varildi'
    else 'bekliyor'
  end,
  s.vardi_at,
  case when s.vardi_at is not null then 'otomatik' end,
  case when s.durum = 'tamamlandi' then s.tamamlandi_at end
  from public.seferler s
  left join public.geofences g on g.id = s.zone_id
 where s.zone_id is not null
   and not exists (
     select 1 from public.sefer_duraklari d where d.sefer_id = s.id
   );

/**
 * `seferler.zone_id` DÜŞÜRÜLMÜYOR — ama artık OKUNMUYOR.
 *
 * Kolon duruyor çünkü (a) düşürmek geri alınamaz, (b) taşımanın doğruluğu
 * ancak kaynağı yerinde dururken denetlenebilir, (c) 070 köprüsünün eski yolu
 * durak listesi OLMAYAN seferlerde hâlâ çalışıyor.
 *
 * Kod tarafındaki kural TEK CÜMLE: **durak listesi varsa duraklar konuşur;
 * yoksa eski tek hedef.** Çözüm tek yerde (lib/sefer-duraklari.ts →
 * `seferHedefi`), böylece iki gerçek doğmuyor.
 */
comment on column public.seferler.zone_id is
  'ESKİ tek hedef (066). 082''den sonra YALNIZ durak listesi olmayan seferler için geçerlidir — hedef çözümü lib/sefer-duraklari.ts:seferHedefi() üzerinden yapılır. Yeni yüzeyler bu kolonu OKUMAZ.';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (ayrı çalıştırın)
--
--   select count(*) from public.sefer_duraklari;
--   → HAK61: 0 · Sendigo: 0 (zone_id dolu sefer yok — ölçüldü 25.08.2026)
--
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='sefer_duraklari';
--   → 20  (id, sefer_id, sira, ad, zone_id, adres, latitude, longitude,
--          yaricap_m, pencere_bas, pencere_bit, tahmini_sure_dk, notlar,
--          durum, atlama_sebep, varildi_at, tamamlandi_at, atlandi_at,
--          varis_kaynak, created_at)
--
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='teslimatlar'
--      and column_name='durak_id';                          → 1
--
--   select count(*) from pg_proc where proname='sefer_duraklari_sirala';  → 1
--
--   select indexname from pg_indexes
--    where schemaname='public' and tablename='teslimatlar'
--      and indexname in ('teslimat_durak_no_uq','teslimat_durak_id_uq');
--   → 2 satır
--
--   select conname from pg_constraint
--    where conrelid='public.teslimatlar'::regclass and conname='teslimat_durak_uq';
--   → 0 satır (kısmi indekslere çevrildi)
--
--   select condeferred from pg_constraint where conname='sefer_durak_sira_uq';
--   → t  (ertelenmiş — yeniden sıralamanın ön koşulu)
--
-- ERTELENMİŞ TEKİLLİĞİ SINAMAK (durak varken):
--   begin;
--     update public.sefer_duraklari set sira=2 where id='<A>';
--     update public.sefer_duraklari set sira=1 where id='<B>';
--   commit;        → GEÇER (ertelenmemiş kısıtta ilk UPDATE'te 23505 verirdi)
--
-- ⚠️ 082 UYGULANMAZSA: çok duraklı sefer KAPALI kalır. Panel ve şoför ekranı
-- normal çalışır, durak bölümü "bu kurulumda kapalı" der ve sefer eski TEK
-- hedefli davranışını sürdürür (aynı kademeli düşüş 056/058/077/078/079/080'de
-- de var).
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  083_takip_durak.sql                                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 083 (TAKİP LİNKİ DURAĞA BAĞLANIYOR)
-- =====================================================================
-- Takip linki (079) SEFERE bağlıydı. 12 duraklı bir seferde müşteri kendi
-- durağının değil, aracın SIRADAKİ durağının varış saatini görüyordu — yani
-- yanlış bilgi. Link artık bir DURAĞA bağlanabiliyor. Additive + idempotent;
-- hiçbir satır silinmez, hiçbir kolon düşürülmez. Supabase SQL Editor'da
-- çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM ÖNCE — ÜÇ SORU, KAYNAKLI CEVAP (25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1) SEKTÖR MÜŞTERİ TAKİP SAYFASINDA NE GÖSTERİYOR
--    · ONFLEET (support.onfleet.com — "Customized Recipient Experience"):
--      "Organizations have the option to configure the NUMBER OF STOPS they
--       would like to be displayed to recipients by enabling the option and
--       then entering the number of stops you would like to display. If the
--       setting is unchecked, the number of stops is not shown."
--      Ayrıca: "Dispatchers can choose whether to display the NAMES OF THE
--       DRIVERS on the recipient tracking page" (yani şoför adı KAPALI
--       olabilen bir seçenek — bizde varsayılan kapalı, TAKIP_SOFOR_ADI).
--      ETA için: "you will be able to display an ETA RANGE and add a BUFFER
--       to the ETA shown to recipients" — yani yanlış kesinlik sektörde de
--       bilinçle törpüleniyor.
--    · TRACK-POD (track-pod.com/blog/track-and-trace, /blog/notifications-2-0):
--      müşteri linke tıklayınca "a map with the exact location of their
--      driver" ve "dynamic ETA available for them on the same page" görüyor;
--      bildirim "after the driver left the PREVIOUS stop" tetikleniyor — yani
--      referans nokta KENDİ durağı, seferin tamamı değil.
--    · BRINGG (bringg.com/resources/real-time-delivery-tracking):
--      "the driver's live location" + "estimated arrival times using GPS,
--      traffic data, and DELIVERY PROGRESS", ve sektör pratiği olarak
--      "automated 'next stop' alerts when delivery is ONE STOP AWAY".
--    SONUÇ: "önünüzde N durak var" gerçek bir sektör öğesi ve AÇILIP
--    KAPANABİLİR olmalı. Uyguladık: `TAKIP_SIRA_ESIGI` (varsayılan 10) —
--    eşiğin üstünde sayı GÖSTERİLMEZ ("önünüzde 47 durak" hem cesaret kırıcı
--    hem düşük güvenilirlikte bir tahmindir).
--
-- 2) ETA DURAK EKSENİNE NASIL TAŞINIR
--    Sektör formülü (upperinc.com/blog/delivery-eta, locus.sh guide):
--      "A scheduled ETA is calculated as: distance to stop divided by expected
--       travel speed, PLUS planned service time at the stop, PLUS CUMULATIVE
--       TIME FROM PRIOR STOPS."
--    Ve uyarısı: "Applying a UNIFORM service time estimate, such as 3 minutes
--    per stop, ignores the wide variance ... and is often the LARGEST SOURCE
--    OF ETA ERROR on multi-stop routes."
--    Bizde bu uyarının cevabı ZATEN ŞEMADA: `sefer_duraklari.tahmini_sure_dk`
--    durak başına planlanan süre. ETA zinciri şöyle kuruluyor
--    (lib/takip-eta.ts → `durakEtaHesapla`):
--      araç → S1 → S2 → … → MÜŞTERİNİN DURAĞI
--      her bacak: haversine × yol katsayısı ÷ etkin hız
--      her ARA durak: `tahmini_sure_dk` (yoksa kiracı varsayılanı)
--      müşterinin KENDİ durağının servis süresi SAYILMAZ — sorulan şey VARIŞ.
--    ⚠️ Bu tabloya kolon EKLENMEDİ: hesabın tüm girdileri zaten var
--    (`sefer_duraklari` + `device_telemetry`). Bir "hesaplanmış ETA" kolonu,
--    her telemetri turunda tazelenmesi gereken ikinci bir gerçek olurdu.
--
-- 3) MEVCUT SEFER BAZLI LİNKLER NASIL KORUNUR
--    ÖLÇÜLDÜ (canlı, 25.08.2026): HAK61 ve Sendigo'da `sefer_takip_linkleri`
--    **0 satır** — ne açık ne kapalı tek bir link yok. galzura-demo service
--    anahtarı yok, ölçülemedi.
--    Yani bu bir VERİ taşıma sorunu değil, SÖZLEŞME sorunu. Korunma şekli:
--      · `durak_id` NULLABLE ve `durak_bagli` varsayılanı FALSE → var olan her
--        satır otomatik olarak "sefer bazlı link"tir, hiçbir güncelleme
--        gerekmez.
--      · Okuma yolu (`lib/takip-db.ts`) `durak_bagli=false` satırlarda
--        079'daki kodun AYNISINI çalıştırır; ETA fonksiyonu bile aynı
--        (`etaHesapla` DEĞİŞMEDİ, `durakEtaHesapla` AYRI eklendi).
--
-- ═══ NEDEN İKİ KOLON — `durak_id` YETMİYOR ═══
--
-- Durak SİLİNİRSE ne olmalı? Üç seçenek denendi, üçü de kusurlu:
--   (a) `on delete cascade` → link SATIRI yok olur. Ama 079 linki bir KAYIT
--       sayıyor ("kim üretti, kaç kez açıldı"); müşteriye link gönderdiğimizin
--       izini silmek o duruşa aykırı. Müşteri de "bulunamadı" görür — yani
--       "yanlış kopyaladım" der, oysa link gerçekti.
--   (b) `on delete set null` TEK BAŞINA → link sessizce SEFER BAZLI linke
--       dönüşür ve müşteri BAŞKA BİR MÜŞTERİNİN durağının ETA'sını görmeye
--       başlar. Sessiz ve yanlış: kabul edilemez.
--   (c) `on delete restrict` → yönetici durağı silemez. Link 2 saatte ölüyor;
--       meşru bir işlemi geçici bir kayıt yüzünden bloklamak yanlış.
-- Seçilen: `set null` + AYRI bir `durak_bagli` bayrağı. Üçlü ayrım netleşiyor:
--   durak_bagli=false                 → SEFER bazlı link (079 davranışı)
--   durak_bagli=true,  durak_id dolu  → DURAK bazlı link
--   durak_bagli=true,  durak_id NULL  → durağı silinmiş link → LİNK KAPANDI
-- Üçüncü hâlde müşteri dürüst bir "bu takip sona erdi" cümlesi görür ve link
-- KAYDI yerinde kalır.
--
-- ⚠️ Uygulama katmanı ayrıca durağı silmeden ÖNCE linklerini İPTAL EDİYOR
-- (app/actions/duraklar.ts): normal yolda müşteri "gönderen linki kapattı"
-- görür, ki en doğru cümle odur. (c) hâli yalnız ham SQL ile silinirse oluşur.
--
-- ═══ NEDEN DÖRDÜNCÜ ÖLÜM YOLU TABLOYA YAZILMIYOR ═══
--
-- Link dört yoldan ölür: (a) süre doldu, (b) yönetici iptal etti, (c) SEFER
-- kapandı, (d) DURAK kapandı (tamamlandi/atlandi). 079 (c) için bayrak
-- koymamıştı — durum zaten `seferler.durum`da. (d) için de koyulmuyor: durum
-- `sefer_duraklari.durum`da ve okuma anında bakılıyor. Bayrak, durak kapanınca
-- N linki güncelleyen ikinci bir yazma yolu doğurur ve iki gerçek sessizce
-- ayrışırdı.
--
-- ═══ RLS ═══
-- Kapalı — 079 ile aynı. Yalnız service-role okur/yazar.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
/**
 * DURAK BAĞI.
 *
 * `on delete set null` — gerekçesi başlıktaki üç seçenek karşılaştırmasında.
 * Sefer silinince link zaten 079'un `on delete cascade`ıyla gidiyor; bu FK
 * yalnız DURAK ekseni için.
 */
alter table public.sefer_takip_linkleri
  add column if not exists durak_id uuid references public.sefer_duraklari(id) on delete set null;

/**
 * "BU LİNK BİR DURAĞA BAĞLIYDI" — kalıcı işaret.
 *
 * `durak_id` NULL'a düştüğünde (durak silindi) linkin NE OLDUĞUNU söyleyen tek
 * şey bu. Varsayılan `false`: mevcut satırların hepsi sefer bazlıdır ve
 * taşımaya gerek yoktur (§3 ölçümü — canlıda zaten 0 satır).
 */
alter table public.sefer_takip_linkleri
  add column if not exists durak_bagli boolean not null default false;

/**
 * TUTARLILIK: `durak_id` doluysa `durak_bagli` da DOLU olmalı.
 *
 * Tersi serbest (bagli=true + id=null → durağı silinmiş link). Kısıt olmadan
 * "durak bağlı ama bayrak false" gibi anlamsız bir satır yazılabilirdi ve
 * okuma yolu onu sefer bazlı sanardı — yani sessizce yanlış ETA.
 *
 * `do $$ … $$` sarmalı: `add constraint if not exists` PostgreSQL'de YOK,
 * dosya ikinci kez çalıştığında düşmesin.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sefer_takip_linkleri'::regclass
       and conname = 'sefer_takip_durak_butun'
  ) then
    alter table public.sefer_takip_linkleri
      add constraint sefer_takip_durak_butun
      check (durak_id is null or durak_bagli);
  end if;
end $$;

/**
 * "BU DURAĞIN LİNKLERİ" — iki çağrı noktası:
 *   · panel durak satırında link listesi,
 *   · durak silinmeden önce linkleri iptal etme (uygulama katmanı).
 * Kısmi indeks: sefer bazlı linkler (çoğunluk) indekse hiç girmez.
 */
create index if not exists sefer_takip_durak_idx
  on public.sefer_takip_linkleri (durak_id)
  where durak_id is not null;

comment on column public.sefer_takip_linkleri.durak_id is
  'Linkin bağlı olduğu durak (083). NULL + durak_bagli=false → sefer bazlı link (079 davranışı). NULL + durak_bagli=true → durağı silinmiş, link KAPANMIŞ sayılır.';
comment on column public.sefer_takip_linkleri.durak_bagli is
  'Bu link bir DURAĞA bağlı olarak üretildi mi. durak_id NULL''a düştüğünde (durak silindi) linkin ne olduğunu söyleyen tek işaret — bkz. migration 083 başlığı.';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (ayrı çalıştırın)
--
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='sefer_takip_linkleri'
--      and column_name in ('durak_id','durak_bagli');            → 2
--
--   select count(*) from pg_constraint
--    where conrelid='public.sefer_takip_linkleri'::regclass
--      and conname='sefer_takip_durak_butun';                    → 1
--
--   select count(*) from pg_indexes
--    where schemaname='public' and indexname='sefer_takip_durak_idx';  → 1
--
--   -- MEVCUT LİNKLER BOZULMADI: hepsi sefer bazlı olarak kaldı.
--   select count(*) filter (where durak_bagli) as durak_bazli,
--          count(*) filter (where not durak_bagli) as sefer_bazli
--     from public.sefer_takip_linkleri;
--   → HAK61: 0 / 0 · Sendigo: 0 / 0  (ölçüldü 25.08.2026 — hiç link yok)
--
--   -- Tutarlılık kısıtı GERÇEKTEN çalışıyor mu (satır YAZMADAN sınama):
--   --   insert … (durak_id, durak_bagli) values ('<durak>', false);
--   --   → HATA: sefer_takip_durak_butun
--
-- ⚠️ 083 UYGULANMAZSA: takip linki 079 davranışını sürdürür (sefer bazlı) ve
-- durak bazlı link üretimi KAPALI kalır. Panel "bu kurulumda kapalı" der;
-- girişsiz sayfa aynen çalışır. Aynı kademeli düşüş 056/058/077/078/079/080/
-- 082'de de var.
--
-- ⚠️ ÖN KOŞUL: 079 (sefer_takip_linkleri) ve 082 (sefer_duraklari). İkisi de
-- yoksa bu dosya FK'yi kuramaz ve okunur bir hatayla durur.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  084_haftalik_aksiyon.sql                                           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 084 (HAFTALIK AKSİYON PANELİ)
-- =====================================================================
-- "Gölge filo müdürü": sistem her hafta EN FAZLA 5 YAPILACAK İŞ üretir.
-- Gösterge değil AKSİYON; kural tabanlı, yapay zeka DEĞİL; her kalem hangi
-- sayıdan ve hangi eşikten çıktığını taşır. Additive + idempotent; mevcut
-- hiçbir tabloya DOKUNULMAZ. Supabase SQL Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM ÖNCE — DÖRT SORU, CANLI CEVAP (25.08.2026, HAK61)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1) HANGİ SİNYALLER ELİMİZDE — hepsi tarandı ve SAYILDI:
--
--    SİNYAL              CANLI DURUM                         KARAR
--    ─────────────────────────────────────────────────────────────────────
--    güvenlik skoru      haftada 3-4 şoför skorlanıyor;      KULLANILIYOR
--                        2 şoför İKİ ardışık haftada;        (2 pencere)
--                        **0 şoför ÜÇ haftada**
--    yakıt L/100km       30 gün: 22/29 araç ölçülebilir,     KULLANILIYOR
--                        ort 11,4; 7 gün: yalnız 10/29       (30 gün)
--    sessiz araç         ≥24s: 8 · ≥72s: 7 · ≥7g: 6          KULLANILIYOR
--    açık iş emri        0 satır                             KULLANILIYOR
--    belge bitişi        0 satır (worker_documents boş)      KULLANILIYOR
--    periyodik bakım     0 plan                              KULLANILIYOR
--    kapanmamış vardiya  9 (son 7 gün, 100 vardiyada)        KULLANILIYOR
--    rölanti             177 epizod/14 araç, medyan 16,9     KULLANILMIYOR
--                        dk/HAFTA — max 45 dk                (aksiyon değeri yok)
--    açık DTC            0 (cleared_at is null)              KULLANILMIYOR
--                                                            (Dikkat'te zaten var)
--    sefer tamamlanma    11 sefer, 9'u iptal                 KULLANILMIYOR
--                                                            (n çok küçük)
--    mesaj okunmama      `message_reads` TABLOSU YOK,        SİNYAL YOK
--                        `messages` 0 satır
--
--    ⚠️ DÖRT KURAL BUGÜN HAK61'DE 0 KALEM ÜRETİR (belge, bakım, iş emri ve
--    büyük ihtimalle skor). Bu bir kusur DEĞİL: kurallar veri geldiğinde
--    çalışsın diye yazıldı ve her biri "kaç aday tarandı, kaçı eşiği geçti"
--    sayısını `haftalik_aksiyon_turlari.tarama` alanına yazıyor — yani "kural
--    çalışmadı" ile "kural çalıştı, eşiği geçen yok" AYIRT EDİLEBİLİR.
--
-- 2) EŞİK NASIL BELİRLENDİ — SİNYALİN DOĞASINA GÖRE ÜÇ AYRI YOL:
--
--    a) FİLO-GÖRELİ (yakıt). Sabit bir L/100km eşiği yanlış olurdu: filo
--       ortalaması 11,4 ve araç tipine göre değişir. Sapma yüzdesi ÖLÇÜLDÜ:
--         %15 üstü → 5 araç  (5 kalemin TAMAMINI yakıt doldururdu)
--         %25 üstü → 2 araç  ✅ SEÇİLDİ
--         %35 üstü → 1 araç  (gerçek sapmayı kaçırırdı)
--       Pencere 30 GÜN, 7 değil: 7 günde yalnız 10/29 araç ölçülebiliyor
--       (`too_little_fuel` 14 araçta), 30 günde 22/29.
--
--    b) SABİT (sessiz araç, belge, bakım, iş emri). Fiziksel ya da yasal
--       anlamı olan eşik. Sessiz araçta 72 SAAT: Dikkat panosu 24 saatte
--       "bak" diyor, haftalık panel 3 günde "cihaza bakılmalı" diyor —
--       AYNI SİNYAL, FARKLI İŞ (bkz. §4). Ölçüm: ≥24s 8 araç, ≥72s 7 araç.
--
--    c) TREND (skor). Mutlak eşik bir insanı sabit bir çizgiye göre yargılar;
--       trend onu KENDİSİYLE kıyaslar. ÖLÇÜLDÜ: üç ardışık hafta skoru olan
--       şoför SIFIR — "3 haftadır düşüyor" kuralı bugün ÖLÜ olurdu. Kural
--       İKİ ardışık pencere + en az 10 puan düşüş olarak kuruldu; üç pencere
--       varsa gerekçe onu da yazar.
--
-- 3) ÖNCELİKLENDİRME — PUAN, ÜÇ EKSEN. En yüksek 5 kalem gösterilir.
--       taban    : kuralın türsel ağırlığı (yasal/güvenlik > para > düzen)
--       büyüklük : sapmanın kendisi (yüzde, gün, puan)
--       kesinlik : ölçüm ne kadar sağlam (kapsama, örneklem)
--    ⚠️ ÇEŞİTLİLİK KURALI — ölçümle gerekti: 7 sessiz araç var ve saf puan
--    sıralaması 5 kalemin TAMAMINI sessiz araçla doldururdu. Kural başına en
--    fazla 2 kalem; kalanlar "N benzer kalem daha" diye toplanır.
--
-- 4) DİKKAT PANOSU (058) İLE İLİŞKİ — ÇAKIŞMIYOR, KATMANLI:
--       Dikkat  = ANLIK. "Bugün ne var." 19 çeşit, canlıdan hesaplanıyor,
--                 kalıcı kaydı yok (yalnız erteleme). Bugün doğru, yarın yok.
--       Haftalık= YORUM. "Bu hafta ne yap." Trend ve filo-göreli; KALICI
--                 kayıt, çünkü sorulan soru "3 hafta önce ne demişti, düzeldi mi".
--    Aynı sinyal iki yerdeyse haftalık panel DAHA YÜKSEK eşik kullanır ve
--    FARKLI bir iş önerir (sessiz araç: 24s "bak" ↔ 72s "cihaza bakılmalı").
--
--    ⚠️ `action_snoozes` GENİŞLETİLMEDİ. O tablonun `item_source` CHECK'i üç
--    değerli ('alarm','attention','leave') ve modeli ERTELEME: "şimdi değil,
--    sonra". Haftalık aksiyonun kapatması bir KARARDIR: "yaptım" (iş bitti) ya
--    da "ilgisiz" (bu kural bu özne için geçersiz). İkisini aynı tabloya
--    sıkıştırmak, iki farklı anlamı tek kolonun altına saklamak olurdu.
--
-- ═══ NEDEN AYRI SUSTURMA TABLOSU YOK ═══
--
-- "İlgisiz" bir SÜRE susturuyor ve bu süre `haftalik_aksiyonlar`dan TÜRETİLİR:
-- aynı kural + aynı özne için EN SON 'ilgisiz' kapatmanın üstünden
-- HAFTALIK_SUSTURMA_GUN geçmediyse kalem üretilmez (lib/haftalik-aksiyon.ts).
-- Ayrı tablo, aynı gerçeğin ikinci kopyası olurdu ve ikisi ayrışabilirdi.
--
-- ═══ NEDEN "TUR" VE "AKSİYON" AYRI TABLOLAR ═══
--
-- Turun kendi gerçekleri var: ne zaman koştu, kaç aday tarandı, bildirim
-- gitti mi. Bunları her aksiyon satırında tekrarlamak, 5 satıra aynı cevabı
-- beş kez yazmak olurdu — ve "bu hafta hiç aksiyon çıkmadı" hâli hiç
-- kaydedilemezdi (0 satır = "koştu ama temiz" ile "hiç koşmadı" ayrılmaz).
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar; okuma
-- yönetici kapısının ardından (requireFleetView).
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ── 1) HAFTALIK TUR ─────────────────────────────────────────────────
create table if not exists public.haftalik_aksiyon_turlari (
  id uuid primary key default gen_random_uuid(),

  /**
   * Turun kapsadığı haftanın PAZARTESİSİ (kiracı takvimi, Europe/Vienna).
   *
   * ⚠️ `date`, `timestamptz` DEĞİL: hafta bir GÜN birimidir ve turun koştuğu
   * AN ayrı alanda (`uretildi_at`). İkisini tek alana sıkıştırmak "hangi
   * haftanın turu" sorusunu saat dilimi sorusuna çevirirdi (066'daki
   * `seferler.tarih` ile aynı gerekçe).
   *
   * TEKİL: bir haftanın tek turu olur. Cron iki kez koşarsa ikinci koşum
   * satır YAZMAZ ve bunu SÖYLER — "günde tam 1" (bakim-alerts) deseninin
   * haftalık karşılığı. Yeniden üretmek isteyen önce turu siler.
   */
  hafta_basi date not null,

  /** Turun GERÇEKTEN koştuğu an. */
  uretildi_at timestamptz not null default now(),

  /**
   * TARAMA SAYAÇLARI — "kural çalışmadı" ile "kural çalıştı, eşiği geçen yok"
   * ayrımı BURADA yaşıyor.
   *
   * Şekli: {"kural_adi": {"aday": 29, "gecen": 2, "esik": "%25"}, …}
   * ⚠️ Bu alan olmadan boş bir hafta sessiz bir arızadan ayırt edilemezdi —
   * ölçüldü ki dört kural HAK61'de bugün 0 kalem üretiyor (§1) ve bunun
   * "veri yok" olduğunu ancak bu sayaç söyleyebilir.
   */
  tarama jsonb not null default '{}'::jsonb,

  /** Üretilen (kaydedilen) aksiyon sayısı — en fazla 5. */
  aksiyon_sayisi integer not null default 0 check (aksiyon_sayisi >= 0),
  /** Eşiği geçen AMA 5 sınırına/çeşitliliğe takılan kalem sayısı. */
  elenen_sayisi integer not null default 0 check (elenen_sayisi >= 0),

  /**
   * BİLDİRİM SONUCU — kaç yöneticiye, kaç cihaza gitti.
   *
   * ⚠️ `push.ts` bilerek `void` döndürüyor ("bildirim mesajı düşürmez").
   * Burada SONUÇ kaydediliyor çünkü haftalık panel "bildirim gitti mi"
   * sorusunu cevaplayabilmeli: ölçüldü ki HAK61'de bugün push jetonu SIFIR,
   * yani gönderim yolu çalışsa bile hiçbir cihaz çalmaz. Bunu "gitti"
   * saymak yalan olurdu.
   *
   * 🔴 NULL = DENENMEDİ. `not null default 0` ilk yazımdaydı ve QA'da yakalandı:
   * turu cron DIŞINDA üreten bir yol (doğrudan `haftalikTuruUret`) bildirim
   * göndermiyor, ama satır 0/0 ile açıldığı için panel "kayıtlı cihaz yok"
   * yazıyordu — DENENMEMİŞ gönderimi BAŞARISIZ gönderim gibi göstermek.
   * Aynı hata sınıfı: "sessiz eksik". Üç durum ayrı: NULL denenmedi ·
   * 0 denendi/cihaz yok · >0 gitti.
   */
  bildirim_alici integer check (bildirim_alici >= 0),
  bildirim_jeton integer check (bildirim_jeton >= 0),
  bildirim_hata text,

  created_at timestamptz not null default now(),

  constraint haftalik_tur_hafta_uq unique (hafta_basi),
  -- Hafta PAZARTESİ olmalı: 0=Pazar … 1=Pazartesi (ISO değil, Postgres `dow`).
  constraint haftalik_tur_pazartesi check (extract(dow from hafta_basi) = 1)
);

create index if not exists idx_haftalik_tur_hafta
  on public.haftalik_aksiyon_turlari (hafta_basi desc);

comment on table public.haftalik_aksiyon_turlari is
  'Haftalık aksiyon üretiminin TURU (084): ne zaman koştu, ne tarandı, bildirim gitti mi. Boş hafta da kayıtlıdır — "koştu ama temiz" ile "hiç koşmadı" ayrılabilsin.';
comment on column public.haftalik_aksiyon_turlari.tarama is
  'Kural başına {aday, gecen, esik} sayaçları. "Kural çalışmadı" ile "eşiği geçen yok" ayrımının TEK kaynağı.';

-- ── 2) AKSİYON ──────────────────────────────────────────────────────
create table if not exists public.haftalik_aksiyonlar (
  id uuid primary key default gen_random_uuid(),

  tur_id uuid not null references public.haftalik_aksiyon_turlari(id) on delete cascade,

  /**
   * KURAL KİMLİĞİ — kod tarafındaki kural adı (`lib/haftalik-aksiyon.ts`).
   *
   * ⚠️ CHECK ile KISITLANMADI, bilerek. Yeni bir kural eklemek bir migration
   * gerektirmemeli; kural kümesi kodda yaşıyor ve orada tek kaynak
   * (`KURALLAR`). Şemaya CHECK koymak, her yeni kuralı üç kiracıda SQL
   * çalıştırmaya bağlardı — 063'ün `category` kararında öğrenilen ders.
   */
  kural text not null check (length(btrim(kural)) between 1 and 60),

  /** Aksiyonun ÖZNESİ. Filo geneli kalemlerde ikisi de null. */
  worker_id uuid references public.workers(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,

  /**
   * ÖNCELİK PUANI — büyük olan üstte. Hesap kodda (§3), burada SONUÇ duruyor.
   * Saklanıyor çünkü "geçen hafta bu neden 1. sıradaydı" sorusu sonradan
   * cevaplanabilmeli; yeniden hesaplamak o günün verisini gerektirirdi.
   */
  oncelik integer not null check (oncelik between 0 and 10000),

  /** Kullanıcının okuduğu tek cümle — YAPILACAK İŞ. */
  baslik text not null check (length(btrim(baslik)) between 1 and 200),

  /**
   * GEREKÇE — hangi sayıdan çıktı. "Skoru 68'den 41'e düştü, iki hafta üst
   * üste." Başlık İŞİ söyler, gerekçe SEBEBİ.
   */
  gerekce text not null check (length(btrim(gerekce)) between 1 and 500),

  /**
   * KANIT — açıklanabilirliğin makine tarafı.
   *
   * Şekli kurala göre değişir ama ÜÇ ALAN HER ZAMAN VAR:
   *   {"olculen": 16.3, "esik": 14.25, "birim": "L/100km", …}
   * Ekran bunu "16,3 ölçüldü · eşik 14,25 L/100km" diye basar; kullanıcı
   * kalemin nereden çıktığını GÖREBİLİR. Görmezse bu bir kara kutudur ve
   * kural tabanlı olmasının hiçbir anlamı kalmaz.
   */
  kanit jsonb not null,

  /**
   * HEDEF EKRAN — tıklayınca nereye gidilecek (şoför kartı, araç detayı…).
   * Göreli yol; null = hedef yok (filo geneli kalem).
   */
  hedef_yol text check (hedef_yol is null or hedef_yol ~ '^/[A-Za-z0-9/_-]*$'),

  /**
   * DURUM.
   *   acik     → yapılacak
   *   yapildi  → iş bitti (o haftaya ait, kalıcı)
   *   ilgisiz  → bu kural bu özne için geçersiz → kuralı BİR SÜRE susturur
   *
   * ⚠️ SİLME YOK. Kapatılan kalem listeden düşer ama KAYITTA kalır: haftalık
   * panelin vaadi "3 hafta önce ne demişti, düzeldi mi" ve silinen bir kalem
   * o soruyu cevaplayamaz.
   */
  durum text not null default 'acik' check (durum in ('acik','yapildi','ilgisiz')),
  kapatan uuid references public.workers(id) on delete set null,
  kapatildi_at timestamptz,
  /** "İlgisiz" derken yazılan serbest not (opsiyonel). */
  kapatma_notu text check (kapatma_notu is null or length(btrim(kapatma_notu)) between 1 and 300),

  created_at timestamptz not null default now(),

  -- Kapatıldıysa ANI da vardır; kapatan kişi silinmiş olabilir (set null).
  constraint haftalik_aksiyon_kapanis_butun
    check ((durum = 'acik' and kapatildi_at is null) or (durum <> 'acik' and kapatildi_at is not null))
);

/**
 * BİR TURDA AYNI KURAL + AYNI ÖZNE İKİ KEZ OLAMAZ.
 *
 * `coalesce` ile ifade indeksi: özne şoför, araç ya da FİLO GENELİ (ikisi de
 * null) olabiliyor ve düz bir `unique (tur_id, kural, worker_id, vehicle_id)`
 * NULL'ları farklı sayacağı için filo geneli kalemi iki kez yazmayı serbest
 * bırakırdı.
 */
create unique index if not exists haftalik_aksiyon_tekil
  on public.haftalik_aksiyonlar (
    tur_id,
    kural,
    coalesce(worker_id, vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Panelin birincil okuması: turun kalemleri, önceliğe göre.
create index if not exists idx_haftalik_aksiyon_tur
  on public.haftalik_aksiyonlar (tur_id, oncelik desc);

/**
 * SUSTURMA SORGUSU — "bu kural bu özne için son ne zaman 'ilgisiz' kapandı".
 * Kısmi indeks: açık ve yapılmış kalemler taranmaz.
 */
create index if not exists idx_haftalik_aksiyon_ilgisiz
  on public.haftalik_aksiyonlar (kural, kapatildi_at desc)
  where durum = 'ilgisiz';

comment on table public.haftalik_aksiyonlar is
  'Haftalık üretilen AKSİYONLAR (084). Gösterge değil yapılacak iş; her satır hangi sayıdan/eşikten çıktığını `kanit` alanında taşır. Kapatılan kalem SİLİNMEZ — geçmiş sorusu ("düzeldi mi") ona bağlı.';
comment on column public.haftalik_aksiyonlar.kanit is
  'Açıklanabilirlik: {olculen, esik, birim, …}. Ekran bunu okunur cümleye çevirir. Bu alan olmadan kural tabanlı olmanın anlamı kalmaz.';
comment on column public.haftalik_aksiyonlar.durum is
  'acik | yapildi | ilgisiz. "ilgisiz" aynı kural+özne için üretimi BİR SÜRE susturur (süre kodda: HAFTALIK_SUSTURMA_GUN).';
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (ayrı çalıştırın)
--
--   select count(*) from public.haftalik_aksiyon_turlari;   → 0
--   select count(*) from public.haftalik_aksiyonlar;        → 0
--
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='haftalik_aksiyon_turlari';  → 10
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='haftalik_aksiyonlar';       → 15
--
--   select indexname from pg_indexes where schemaname='public'
--    and tablename in ('haftalik_aksiyon_turlari','haftalik_aksiyonlar')
--    order by 1;
--   → haftalik_aksiyon_tekil, haftalik_aksiyon_turlari_pkey,
--     haftalik_aksiyonlar_pkey, haftalik_tur_hafta_uq,
--     idx_haftalik_aksiyon_ilgisiz, idx_haftalik_aksiyon_tur,
--     idx_haftalik_tur_hafta
--
-- KISITLARI SINAMAK (satır yazmadan):
--   insert into public.haftalik_aksiyon_turlari (hafta_basi) values (current_date + 1);
--   → PAZARTESİ değilse HATA: haftalik_tur_pazartesi
--
--   insert into public.haftalik_aksiyonlar (…, durum, kapatildi_at)
--     values (…, 'yapildi', null);
--   → HATA: haftalik_aksiyon_kapanis_butun
--
-- ⚠️ 084 UYGULANMAZSA: haftalık panel KAPALI kalır. Yönetici ekranı "bu
-- kurulumda kapalı" der, cron 503 döner, Dikkat panosu ve diğer her şey
-- normal çalışır (aynı kademeli düşüş 056/058/077/078/079/080/082/083'te de var).
--
-- ⚠️ CRON KAYDI: haftalık üretim `POST /api/cron/haftalik-aksiyon` ile
-- tetikleniyor — dış zamanlayıcıya HAFTADA BİR kayıt eklenmeli
-- (bkz. docs/CRON-KAYITLARI.md). Kayıt kurulmazsa panel boş kalır; sessizce
-- değil: ekran "bu hafta için tur üretilmemiş" der.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  085_sefer_karlilik.sql                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 085 (SEFER BAZLI KÂRLILIK — GELİR TARAFI)
-- =====================================================================
-- Maliyet motoru 076/077 ile hazır (€/km, €/paket). Eksik olan GELİR.
-- Bu migration gelir tarafını ve MÜŞTERİ eksenini kuruyor.
-- Additive + idempotent; mevcut hiçbir tablonun kolonu DEĞİŞTİRİLMEZ,
-- yalnız yeni kolonlar eklenir. Supabase SQL Editor'da çalıştırın.
--
-- ⚠️ 066 (seferler), 082 (sefer_duraklari), 076 (tenant_cost_rates) ve
-- 084 (haftalik_aksiyonlar) uygulanmış olmalı. 084 şart çünkü bu migration
-- ona ÜÇÜNCÜ bir özne ekseni (musteri_id) ekliyor ve tekil indeksini
-- yeniden kuruyor.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 1 — SEKTÖRDE TARİFE NASIL KURULUYOR (25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- TEK BİR STANDART YOK; taban sözleşmenin türüne göre değişiyor ve ciddi
-- TMS'ler taban TİPİNİ bir alan olarak tutuyor:
--
--   · nuVizz (Last Mile TMS, faturalama modülü) müşteri faturalamasında
--     "per stop, per route, mileage, volumetric, zone-based, dimensional
--     weight" tabanlarını ve ayrı kalem olarak accessorial/fuel surcharge
--     satırlarını destekliyor; şoför hakedişinde "per-stop, per-route,
--     weight- or volume-based, piece-rate, hourly".
--   · Son-mil taşımacılığında fatura "by the package, by the route, or by
--     the day" kuruluyor — klasik yük taşımacılığının "by the mile"ından
--     BİLEREK farklı.
--   · Tam yük (FTL) Avrupa'da km ekseninde: 2025/26 için 1,10–1,90 €/km
--     bandı; kısa mesafede sabit giderler daha az km'ye yayıldığı için
--     €/km yükseliyor (200 km'de 1,80–2,50 €/km).
--
-- KARAR: dört taban destekleniyor — `sefer` (götürü), `km`, `paket`, `saat`.
-- Bu dördü yukarıdaki kaynakların "per-route / per-mile / piece-rate /
-- hourly" dörtlüsünün birebir karşılığı. Ağırlık ve hacim BUGÜN YOK: ne
-- `seferler` ne `sefer_duraklari` ağırlık taşıyor, ölçemediğimiz bir tabanı
-- form alanı olarak sunmak kullanıcıya olmayan bir kesinlik vaat ederdi.
-- CHECK genişletilebilir; şema hazır, veri değil.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 2 — MÜŞTERİ: YENİ TABLO, `geofences` GENİŞLETMESİ DEĞİL
-- ═══════════════════════════════════════════════════════════════════════
--
-- CANLI ÖLÇÜM (HAK61, 25.08.2026): `geofences` toplam **2 satır**, ikisi de
-- `purpose='depot'`. **`purpose='customer'` sıfır satır.** Yani korunacak
-- müşteri verisi YOK — seçim geçmişe değil, modele göre yapıldı.
--
-- Bölge bir YERDİR, müşteri bir MUHATAPTIR. İkisi bire bir değil:
--   · bir müşterinin birden çok sahası olur (üç depo, tek fatura adresi);
--   · bir saha zamanla başka müşteriye geçer (kiracı değişir);
--   · müşterinin hiç sahası olmayabilir (adresine teslim, geofence yok).
-- `geofences`i muhatap tablosu yapmak bu üç durumu da tek satıra sıkıştırıp
-- "hangi müşteri" sorusunu cevaplanamaz hâle getirirdi. 064 zaten aynı
-- ayrımı bir kez yapmıştı: `purpose` DAVRANIŞ, `category` ETİKET.
--
-- BAĞ ÜÇ YERDE, ÜÇÜ DE `null` OLABİLİR:
--   seferler.musteri_id        — seferin parasını kim ödüyor (KARAR, türetme değil)
--   sefer_duraklari.musteri_id — çok duraklı seferde durak kimin (082)
--   geofences.musteri_id       — bu saha kimin (ziyaret raporunu müşteriye bağlar)
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 3 — MALİYET SEFER EKSENİNE İNER Mİ (en kritik ölçüm)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Maliyet motoru (lib/cost-model.ts) VARDİYA ekseninde çalışıyor: dört payda
-- (km, saat, araç-günü, paket) `time_entries`ten toplanıyor. Sefer ekseni
-- için her paydanın AYRI AYRI ölçülebilir olması gerekiyordu.
--
-- ── KM: ODOMETRE PENCERESİ, TELEMETRİ İNTEGRALİ DEĞİL ────────────────────
--
-- İki aday vardı, ikisi de canlı veride ölçüldü (14 gün, araçlı+kapanmış
-- vardiya pencereleri, HAK61):
--
--     yöntem                     ölçülen/örnek   sayaca oran (medyan)
--     odometre farkı (uçtan uca)     13/15              1,032
--     telemetri integrali            15/15              0,871
--
-- Telemetri integrali HER pencerede eksik saydı (medyan −%13, bir pencerede
-- −%53) çünkü cihaz sessizliğinde köprü kurmuyor (GAP_MAX_MS) — bilinçli
-- olarak eksik sayan bir yöntem. MALİYET için bu ZARARLIDIR: eksik km,
-- eksik yakıt, ŞİŞMİŞ kâr demek. Sefer km'si odometre farkından ölçülür.
--
-- Odometre okumasının pencere kenarına uzaklığı da ölçüldü (40 pencere,
-- 80 uç): medyan 0,1 dk · p75 4,2 dk · p90 249,8 dk. Kuyruk uzun, çünkü
-- cihaz sessizliği pencerenin dışına taşıyor.
--     eşik  1 dk → uçların %61,8'i geçer
--     eşik 15 dk → %81,6
--     eşik 60 dk → %85,5   ← +3,9 puan için 13 saate kadar bayat okuma
-- KARAR: **kenar eşiği 15 dk.** 60 dk'nın getirisi marjinal, riski büyük:
-- pencereden saatler uzaktaki bir okuma BAŞKA bir seferin km'sini içerir.
--
-- 15 dk eşiğiyle canlı kapsama (60 pencere): **%61,7 ölçüldü** · 21 kenar
-- bayat · 2 uç okuması yok · 0 negatif fark. Ölçülenlerde odometre/sayaç
-- oranı medyan 1,025.
--
-- ⚠️ ÖLÇÜLEMEYEN PENCERE `null` DÖNER, 0 DEĞİL (lib/km-quality.ts dersi).
-- "0 km'lik sefer" bedava sefer gibi görünür ve kârı sonsuza şişirir.
--
-- ── İŞÇİLİK: SEFERİN KENDİ PENCERESİ ─────────────────────────────────────
-- `yolda_at` → `tamamlandi_at` arası saat × €/saat. AZG günlük tavanı
-- (12 sa) burada da uygulanır — vardiya motorundaki `hourCapShifts` ile
-- aynı gerekçe: geç kapatılmış kayıt çalışma değildir.
--
-- ── ARAÇ SABİT GİDERİ: **ATFEDİLEMEZ** ───────────────────────────────────
-- €/gün bir GÜN birimidir. Bir günün sabit giderini o günün seferlerine
-- bölmek PAYLAŞTIRMADIR, ölçüm değil. Hangi anahtarla bölünürse bölünsün
-- (km payı, süre payı, sefer sayısı) sonuç bir varsayımdır ve kârlılık
-- sıralamasını sessizce değiştirir.
--
-- Bu yüzden sefer satırının ürettiği sayı NET KÂR DEĞİL, **KATKI PAYI**dır:
--        katkı payı = gelir − (atfedilebilen yakıt + atfedilebilen işçilik)
-- Atfedilemeyen sabit gider panelde AYRI ve AÇIK bir kalem olarak durur;
-- gizlenmez, dağıtılmaz. "Tek seferlik günde tamamını yükleyelim" seçeneği
-- de REDDEDİLDİ: o zaman bazı seferler sabit gider taşır bazıları taşımaz,
-- seferler birbiriyle kıyaslanamaz hâle gelirdi.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 4 — ÇOK DURAKLI SEFERDE GELİR: İKİSİ DE
-- ═══════════════════════════════════════════════════════════════════════
--
-- nuVizz "fully customized rates at the stop or route level" diyor: taban
-- hem durak hem rota düzeyinde tanımlanabiliyor. Son-mil faturalaması da
-- "by the package, by the route, or by the day" — yani tek eksen dayatmıyor.
--
-- KARAR: gelir satırı SEFERE bağlıdır; `durak_id` OPSİYONELDİR.
--   · durak_id null  → sefer düzeyinde gelir (götürü rota ücreti)
--   · durak_id dolu  → o durağın geliri (12 duraklı seferde 12 müşteri)
-- Seferin toplam geliri her iki tür satırın TOPLAMIDIR; ikisi bir arada
-- kullanılabilir (rota ücreti + duraklara ek hizmet bedeli).
--
-- ⚠️ `durak_id` silinirse gelir satırı SİLİNMEZ, yalnız bağı kopar
-- (`on delete set null`). 083'teki takip linkinin aksine burada İKİNCİ bir
-- "durak_bagli" kolonuna gerek yok: takip linki durak ölünce ÖLMELİYDİ,
-- gelir ölmez — para kazanılmıştır, durağın silinmesi bunu geri almaz.
-- Seferin toplamı her iki durumda da aynı kalır.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ═════════════════════════ MÜŞTERİ ═════════════════════════════════════

create table if not exists public.musteriler (
  id uuid primary key default gen_random_uuid(),

  -- Ticari ad. Fatura ünvanı DEĞİL: panelde görünen ad.
  ad text not null check (length(btrim(ad)) between 1 and 120),

  -- Kiracının kendi müşteri kodu (ERP/muhasebe eşleşmesi). Serbest metin:
  -- her firmanın kendi şeması var, biçim dayatmıyoruz.
  kod text check (kod is null or length(btrim(kod)) between 1 and 40),

  -- UID/VAT. Doğrulanmaz — yalnız saklanır ve raporda görünür.
  vergi_no text check (vergi_no is null or length(btrim(vergi_no)) <= 40),

  adres text,
  iletisim text,
  notlar text,

  -- Pasif müşteri SİLİNMEZ: geçmiş seferlerin ve gelirin muhatabı odur.
  -- (`lint:crud` iki aşamalı silme kuralı: FK varsa pasifleştir.)
  aktif boolean not null default true,

  created_by uuid references public.workers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.musteriler is
  'Taşımanın MUHATABI (085). Bölge (geofences) bir YER, bu bir MUHATAP — bire bir değil: bir müşterinin çok sahası olur, saha el değiştirir, müşterinin hiç sahası olmayabilir.';

-- Aynı adın iki kez girilmesi tipik veri kirliliği kaynağı; büyük/küçük harf
-- duyarsız tekillik yalnız AKTİF satırlarda — pasif eski kayıt aynı adın
-- yeniden kullanılmasını engellemesin.
create unique index if not exists musteri_ad_uq
  on public.musteriler (lower(btrim(ad)))
  where aktif;

create index if not exists idx_musteri_aktif on public.musteriler (aktif, ad);

-- ═════════════════════ MÜŞTERİ BAĞLARI (3 yer) ═════════════════════════

alter table public.seferler
  add column if not exists musteri_id uuid references public.musteriler(id) on delete set null;

alter table public.sefer_duraklari
  add column if not exists musteri_id uuid references public.musteriler(id) on delete set null;

alter table public.geofences
  add column if not exists musteri_id uuid references public.musteriler(id) on delete set null;

comment on column public.seferler.musteri_id is
  'Seferin parasını kim ödüyor. KARAR, türetme değil: bölgeden/duraktan çıkarılmaz.';
comment on column public.geofences.musteri_id is
  'Bu saha kimin. purpose=customer ile ilgisi yok — o DAVRANIŞ anahtarı, bu MUHATAP bağı.';

create index if not exists idx_seferler_musteri
  on public.seferler (musteri_id, tarih desc)
  where musteri_id is not null;

create index if not exists idx_durak_musteri
  on public.sefer_duraklari (musteri_id)
  where musteri_id is not null;

-- ═════════════════════════ GELİR ═══════════════════════════════════════

create table if not exists public.sefer_gelirleri (
  id uuid primary key default gen_random_uuid(),

  sefer_id uuid not null references public.seferler(id) on delete cascade,

  -- Durak düzeyinde gelir (082). null → sefer düzeyinde (götürü rota ücreti).
  -- Durak silinirse bağ kopar, SATIR KALIR: para kazanılmıştır.
  durak_id uuid references public.sefer_duraklari(id) on delete set null,

  -- ── TARİFE TABANI ──────────────────────────────────────────────────
  -- Ölçüm 1'deki dört taban. Ağırlık/hacim BUGÜN YOK (veri yok).
  model text not null check (model in ('sefer','km','paket','saat')),

  -- Taban birim fiyatı. model='sefer' ise götürü tutarın kendisi (miktar=1).
  -- numeric(12,4): 076'daki oran kolonlarıyla aynı hassasiyet.
  birim_fiyat numeric(12,4) not null check (birim_fiyat >= 0),

  -- Kaç birim. model='sefer' için 1.
  miktar numeric(12,3) not null default 1 check (miktar >= 0),

  /**
   * TUTAR ÜRETİLMİŞ KOLON — elle yazılamaz.
   *
   * İlk taslakta `tutar_eur` ayrı bir kolondu ve `birim_fiyat`/`miktar` yalnız
   * "açıklama" için duruyordu. İkisinin çelişmesi an meselesiydi: birim fiyat
   * düzeltilir, tutar eski kalır ve rapor ile fatura ayrışır. Üretilmiş kolon
   * bu çelişkiyi ŞEMA DÜZEYİNDE imkânsız kılar.
   */
  tutar_eur numeric(12,2)
    generated always as (round(birim_fiyat * miktar, 2)) stored,

  /**
   * MİKTAR NEREDEN GELDİ — kanıt zorunluluğu.
   *
   * 'elle'    kullanıcı yazdı (her modelde geçerli)
   * 'olculdu' sistemin ölçtüğü sayı kullanıldı (km: odometre penceresi,
   *           paket: teslimat sayısı, saat: sefer penceresi)
   *
   * Ekranda ETİKET olarak görünür. Ölçülen ile girilen sayıyı aynı yazı
   * tipinde göstermek, tahmini ölçüm kılığına sokar (076'daki RateSource
   * ayrımının aynısı).
   */
  miktar_kaynak text not null default 'elle'
    check (miktar_kaynak in ('elle','olculdu')),

  -- BUGÜN YALNIZ EUR. CHECK sınırı AÇIK tutuyor: sessizce başka para birimi
  -- kabul edip hepsini toplamak, kârlılığı gürültüye çevirirdi. Çok para
  -- birimi kur tablosu ister — o ayrı bir iştir, yarım yapılmaz.
  para_birimi text not null default 'EUR' check (para_birimi = 'EUR'),

  aciklama text,

  created_by uuid references public.workers(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.sefer_gelirleri is
  'Seferin GELİRİ (085). Satır sefere bağlıdır, durak_id opsiyoneldir: sektör hem rota hem durak düzeyinde tarife kuruyor (nuVizz), biz de ikisini birden destekliyoruz. Toplam = iki türün toplamı.';

create index if not exists idx_gelir_sefer on public.sefer_gelirleri (sefer_id);
create index if not exists idx_gelir_durak on public.sefer_gelirleri (durak_id)
  where durak_id is not null;

-- ═══════════════ ZARAR EDEN MÜŞTERİ — HAFTALIK AKSİYON KÖPRÜSÜ ═════════
-- Hızlı erişim indeksi: "son N gün, müşteri ekseninde tamamlanmış seferler".
create index if not exists idx_seferler_musteri_tamam
  on public.seferler (musteri_id, tamamlandi_at desc)
  where musteri_id is not null and durum = 'tamamlandi';

/**
 * 084'E ÜÇÜNCÜ ÖZNE EKSENİ.
 *
 * Haftalık aksiyon kalemi bugün ya bir ŞOFÖRE ya bir ARACA ya da hiçbirine
 * (filo geneli) bağlı. `musteri_zarar` kuralının öznesi üçünden de değil.
 *
 * ⚠️ KOLON EKLEMEK YETMEZ, TEKİL İNDEKS DE DEĞİŞMELİ. 084'teki indeks
 * `coalesce(worker_id, vehicle_id, '000…')` — müşteri kalemlerinin hepsi
 * sıfır-uuid kovasına düşerdi ve haftada YALNIZ BİR zararlı müşteri
 * yazılabilirdi; ikincisi 23505 ile sessizce reddedilirdi. Kural başına
 * tavan 2 olduğu hâlde.
 *
 * `coalesce` sırası `lib/haftalik-aksiyon.ts → ozneKimligi()` ile BİREBİR
 * aynı: şoför → araç → müşteri → filo. Ayrışırsa susturma iki farklı özneyi
 * aynı sanar.
 */
alter table public.haftalik_aksiyonlar
  add column if not exists musteri_id uuid references public.musteriler(id) on delete cascade;

drop index if exists public.haftalik_aksiyon_tekil;
create unique index if not exists haftalik_aksiyon_tekil
  on public.haftalik_aksiyonlar (
    tur_id,
    kural,
    coalesce(worker_id, vehicle_id, musteri_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorguları):
--
--   select count(*) from public.musteriler;        → 0
--   select count(*) from public.sefer_gelirleri;   → 0
--
--   select column_name, data_type, is_generated
--     from information_schema.columns
--    where table_schema='public' and table_name='sefer_gelirleri'
--    order by ordinal_position;
--   → 12 satır; `tutar_eur` satırında is_generated = 'ALWAYS'
--
--   select table_name from information_schema.columns
--    where table_schema='public' and column_name='musteri_id'
--    order by table_name;
--   → geofences, haftalik_aksiyonlar, sefer_duraklari, seferler   (4 satır)
--
--   select indexdef from pg_indexes
--    where indexname='haftalik_aksiyon_tekil';
--   → coalesce içinde musteri_id GÖRÜNMELİ (084'ün üç argümanlısı değil)
--
-- MEVCUT VERİYE ETKİSİ: sıfır. Üç tabloya null'lanabilir kolon eklendi,
-- hiçbir satır güncellenmedi, hiçbir motor bu kolonları okumuyor.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  086_mevzuat_uyari.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 086 (MEVZUAT ERKEN UYARI — CANLI KATMAN)
-- =====================================================================
-- AZG raporu (geçmişe dönük) DURUYOR. Bu migration onun ÜSTÜNE canlı bir
-- katman ekliyor: ihlal OLMADAN ÖNCE uyarı. Additive + idempotent; mevcut
-- hiçbir tablonun kolonu değiştirilmez. Supabase SQL Editor'da çalıştırın.
--
-- ⚠️ 074 (push_tokens) uygulanmış olmalı — uyarı şoförün telefonuna gidiyor.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 BU MODÜL "YASAL UYUM GARANTİSİ" DEĞİLDİR — ERKEN UYARIDIR
-- ═══════════════════════════════════════════════════════════════════════
--
-- Filoda TAKOGRAF YOK. Takograf, sürüş süresini kartla ve mühürlü cihazla
-- kaydeden ve denetimde KANIT sayılan bir alettir; bizim ölçtüğümüz şey o
-- değil. Ekranda, PDF'te ve bildirimde bu ayrım açıkça yazılır. Bir sayı
-- "uyumluluk" diye satılırsa kullanıcı ona güvenerek denetime girer.
--
-- Ölçebildiğimiz İKİ AYRI şey var ve ikisi AYNI DEĞİL:
--
--   ÇALIŞMA SÜRESİ  (Arbeitszeit)  — ÖLÇÜLÜR.
--       vardiya başlangıcı → bitiş, eksi kayıtlı mola. AZG ve ArbZG'nin
--       düzenlediği büyüklük TAM OLARAK budur. Erken uyarının birincil
--       ekseni bu.
--
--   SÜRÜŞ SÜRESİ    (Lenkzeit)     — TAHMİN EDİLİR, ölçülmez.
--       telemetride hareket görülen süre. AB 561/2006'nın düzenlediği
--       büyüklük bu, ama takograf olmadan üretilen sayı bir tahmindir.
--
-- ── SÜRÜŞ TAHMİNİNİN GERÇEK HATA PAYI (ÖLÇÜLDÜ, HAK61, 7 gün, 12 vardiya)
--
--   sürüş / vardiya oranı        medyan %46,5  (min %0 · max %61)
--   TELEMETRİ BOŞLUĞU            medyan %32,2 of vardiya süresi
--   hiç telemetrisi olmayan       3/12 vardiya  → sürüş süresi ÖLÇÜLEMEZ
--
-- Yani ortalama bir vardiyanın ÜÇTE BİRİ ne sürüş ne durak olarak
-- sınıflanabiliyor: cihaz susuyor. Bu banda "0 sürüş" demek de "sürüş"
-- demek de uydurmadır. `surus_belirsiz_dk` kolonu bu bandı SAYI olarak
-- taşır ve ekranda gösterilir.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM — MOLA KAYDI YOKLUĞU "MOLA YOK" DEMEK DEĞİLDİR
-- ═══════════════════════════════════════════════════════════════════════
--
-- CANLI (HAK61, 30 gün): 6 saati aşan **391** vardiyanın yalnız **150**
-- tanesinde mola kaydı var. Kalan 241'i "mola vermedi" saymak 241 sahte
-- ihlal üretirdi.
--
-- ⚠️ AMA ÖNLEYİCİ YÖNDE BU GÜVENLİ TARAFTIR: mola kaydı yoksa çalışma
-- süresi OLDUĞUNDAN BÜYÜK hesaplanır ve uyarı ERKEN gider. Kârlılıkta
-- (085) eksik ölçüm tehlikeliydi çünkü kârı şişiriyordu; burada eksik
-- ölçüm erken uyarı üretiyor. Yön farkı bilinçlidir ve ekranda yazar:
-- satır "mola kaydı yok" rozetini taşır.
--
-- ═══════════════════════════════════════════════════════════════════════
-- KURAL SETLERİ — ÜLKE EKSENİ, KİRACI AYARI
-- ═══════════════════════════════════════════════════════════════════════
--
-- Hangi mevzuatın uygulanacağı KİRACIYA ait bir VERİDİR, bir env değil
-- (076'daki gerekçenin aynısı: env değiştirmek deploy ister, kiracı kendi
-- hukukunu bize e-posta atarak değiştiremez).
--
--   AT_AZG    Avusturya Arbeitszeitgesetz — ÇALIŞMA süresi
--             § 9 Abs. 1 (12 sa) · § 14 Abs. 2 (gece 10 sa)
--             § 13c Abs. 1 (6 sa→30 dk · 9 sa→45 dk) · § 12 Abs. 1 (11 sa)
--
--   DE_ARBZG  Almanya Arbeitszeitgesetz — ÇALIŞMA süresi
--             § 3 (8 sa; 24 hafta ortalaması 8 sa'i aşmazsa 10 sa'e kadar)
--             § 4 (>6-9 sa → 30 dk · >9 sa → 45 dk)
--             § 5 Abs. 1 (11 sa); Abs. 2 Verkehrsbetriebe'de 1 saat
--             kısaltılabilir, bir ay içinde 12 saate uzatılarak telafi.
--
--   EU_561    AB 561/2006 — SÜRÜŞ süresi (TAHMİN)
--             Art. 7 (4,5 sa sürüş → 45 dk; 15+30 bölünebilir)
--             Art. 6 (günlük 9 sa; haftada 2 kez 10 sa · haftalık 56 sa ·
--             iki haftada 90 sa) · Art. 8 (günlük 11 sa, haftada en çok
--             3 kez 9 sa · haftalık 45 sa, iki haftada bir 24 sa)
--
-- ⚠️ AB 561/2006 KAPSAMI (Art. 2): yük >3,5 t, yolcu >9 kişi. 01.07.2026'dan
-- beri ULUSLARARASI taşıma ve kabotajda >2,5 t da kapsamda (2020/1054) ve
-- akıllı takograf zorunlu. YURT İÇİ taşıma kapsam dışı — orada ulusal
-- mevzuat geçerli.
--
-- HAK61 için ÖLÇÜLDÜ (Volkan teyidi 22.07.2026, lib/azg-rules.ts başlığı):
-- araçların hepsi 2,5 t ALTINDA ve sınır geçmiyor → 561/2006 UYGULANMAZ.
-- Varsayılan kural seti bu yüzden AT_AZG; EU_561 kiracı açıkça seçmedikçe
-- kapalıdır.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ═════════════════════ KİRACI MEVZUAT AYARI ════════════════════════════

create table if not exists public.tenant_mevzuat (
  -- 076'daki desen: tek satır, sabit anahtar.
  id text primary key default 'singleton' check (id = 'singleton'),

  kural_seti text not null default 'AT_AZG'
    check (kural_seti in ('AT_AZG', 'DE_ARBZG', 'EU_561')),

  /**
   * SÜRÜŞ SÜRESİ TAHMİNİ AÇIK MI.
   *
   * Yalnız EU_561 için anlamlı ve VARSAYILAN OLARAK KAPALI. Açık değilken
   * sürüş ekseni hiç hesaplanmaz ve ekranda "ölçülmüyor" yazar — kapalı bir
   * özelliği 0 ile göstermek, ölçülmemiş olanı ölçülmüş gibi okutur.
   */
  surus_tahmini boolean not null default false,

  /**
   * ERKEN UYARI KADEMELERİ (dakika, eşiğe kalan süre).
   *
   * Varsayılan 60/30/15. En dar kademe olan 15 dk UYDURMA DEĞİL: akıllı
   * takografın kendi standardı, sürücüyü 4,5 saatlik kesintisiz sürüşe
   * 15 dakika kala uyarır (165/2014 düzeni). Ürün o eşiği taban alıp
   * ÜSTÜNE iki erken kademe koyuyor — çünkü bizim uyarımız cihazda değil
   * telefonda ve şoförün park yeri bulması zaman ister.
   */
  kademe_erken_dk integer not null default 60 check (kademe_erken_dk > 0),
  kademe_yaklasti_dk integer not null default 30 check (kademe_yaklasti_dk > 0),
  kademe_son_dk integer not null default 15 check (kademe_son_dk > 0),

  updated_at timestamptz not null default now(),
  updated_by uuid references public.workers(id) on delete set null,

  -- Kademeler daralarak gitmeli: 60 > 30 > 15.
  constraint mevzuat_kademe_sirali
    check (kademe_erken_dk > kademe_yaklasti_dk and kademe_yaklasti_dk > kademe_son_dk)
);

comment on table public.tenant_mevzuat is
  'Kiracının tabi olduğu mevzuat ve erken uyarı kademeleri (086). Env DEĞİL veri: kiracı kendi hukukunu deploy beklemeden değiştirebilmeli (076 gerekçesi).';

insert into public.tenant_mevzuat (id) values ('singleton')
on conflict (id) do nothing;

-- ═════════════════════ GÖNDERİLMİŞ UYARI DEFTERİ ═══════════════════════

create table if not exists public.mevzuat_uyarilari (
  id uuid primary key default gen_random_uuid(),

  worker_id uuid not null references public.workers(id) on delete cascade,
  -- Uyarının dayandığı vardiya. Vardiya silinse de uyarı izi kalır.
  time_entry_id uuid references public.time_entries(id) on delete set null,

  -- Viyana günü — tekillik anahtarının parçası.
  gun date not null,

  kural_seti text not null check (kural_seti in ('AT_AZG', 'DE_ARBZG', 'EU_561')),

  /**
   * HANGİ KURAL. CHECK YOK — kural adları KODDA yaşıyor (lib/mevzuat.ts) ve
   * yeni bir mevzuat eklemek migration gerektirmemeli. 084'te aynı karar
   * `haftalik_aksiyonlar.kural` için verilmişti.
   */
  kural text not null,

  /**
   * KADEME — spam'in önlendiği yer.
   *
   * 'erken' → 'yaklasti' → 'son' → 'ihlal'. Aynı (şoför, gün, kural, kademe)
   * için İKİNCİ satır yazılamaz (aşağıdaki tekil indeks). Yani şoför her
   * kademeyi bir kez duyar; tarama 15 dakikada bir koşsa da tekrar etmez.
   */
  kademe text not null check (kademe in ('erken', 'yaklasti', 'son', 'ihlal')),

  /**
   * ÖLÇÜM TEMELİ — bu uyarı neye dayanıyor.
   *
   * 'calisma_suresi' ÖLÇÜLDÜ (vardiya + kayıtlı mola)
   * 'surus_tahmini'  TAHMİN (telemetri hareketi) — ekranda ve bildirimde
   *                  ayrı etiketlenir, "yasal kanıt" diye sunulamaz.
   */
  olcum_temeli text not null check (olcum_temeli in ('calisma_suresi', 'surus_tahmini')),

  -- Uyarı anındaki kalan dakika. null = ölçülemedi (0 DEĞİL).
  kalan_dk integer,
  -- Kuralın eşiği (dakika) — açıklanabilirlik için kayıtta durur.
  esik_dk integer not null check (esik_dk > 0),
  -- O anda ölçülen değer (dakika). null = ölçülemedi.
  olculen_dk integer,

  /**
   * SÜRÜŞ TAHMİNİNİN BELİRSİZLİK BANDI (dakika).
   *
   * Telemetri boşluğu: ne sürüş ne durak sayılabilen süre. ÖLÇÜLDÜ: medyan
   * vardiya süresinin %32,2'si. Çalışma süresi ekseninde null.
   */
  surus_belirsiz_dk integer,

  -- Gönderim akıbeti. null = denenmedi (084'ün bildirim dersi).
  sofor_jeton integer,
  yonetici_jeton integer,
  bildirim_hata text,

  created_at timestamptz not null default now()
);

comment on table public.mevzuat_uyarilari is
  'Gönderilmiş erken uyarı defteri (086). Tekil indeks aynı kademenin tekrar gönderilmesini ŞEMA düzeyinde engeller — spam bir kod kusuru olamaz.';

/**
 * SPAM'İN ŞEMA DÜZEYİNDE ENGELİ.
 *
 * Tarama 15 dakikada bir koşuyor; kademe koşulu sağlandığı sürece her
 * turda tekrar tetiklenirdi. Koşullu bir "gönderdim mi" kontrolü koda
 * yazılabilirdi ama iki tur çakışırsa (cron gecikmesi) ikisi de gönderirdi.
 * Tekillik burada: ikinci insert 23505 ile reddedilir, gönderim yapılmaz.
 */
create unique index if not exists mevzuat_uyari_tekil
  on public.mevzuat_uyarilari (worker_id, gun, kural, kademe);

create index if not exists idx_mevzuat_uyari_gun
  on public.mevzuat_uyarilari (gun desc, worker_id);

create index if not exists idx_mevzuat_uyari_sofor
  on public.mevzuat_uyarilari (worker_id, created_at desc);
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorguları):
--
--   select * from public.tenant_mevzuat;
--   → 1 satır: singleton · AT_AZG · surus_tahmini=false · 60/30/15
--
--   select count(*) from public.mevzuat_uyarilari;   → 0
--
--   select indexname from pg_indexes
--    where tablename='mevzuat_uyarilari' order by indexname;
--   → idx_mevzuat_uyari_gun, idx_mevzuat_uyari_sofor,
--     mevzuat_uyari_tekil, mevzuat_uyarilari_pkey
--
-- MEVCUT VERİYE ETKİSİ: sıfır. İki YENİ tablo; AZG raporu, vardiya motoru
-- ve maliyet motoru bu tabloları hiç okumaz.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  087_vardiya_duzeltme_izi.sql                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 087 (VARDİYA DÜZELTME İZİ — SEBEP ZORUNLU)
-- =====================================================================
-- `shift_edit_log` VAR ve çalışıyor. Bu migration onu DENETİM kaydı hâline
-- getiriyor: sebep, düzeltme grubu, kaynak. Additive + idempotent; mevcut
-- satırlar korunur, hiçbir kolon değiştirilmez. Supabase SQL Editor'da
-- çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 1 — BUGÜN NE VAR (HAK61 canlı, 25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- `shift_edit_log`: **13 satır**, hepsi `started_at` alanına ait.
-- Kolonlar: id · time_entry_id · changed_at · changed_by · field ·
--           old_value · new_value
--
-- Yani "kim, ne zaman, hangi alan, eski→yeni" TAM. Eksik olan tek şey
-- **NEDEN**. Avusturya iş müfettişliği bu raporu okuyor ve "bu çalışma saati
-- neden değişti" sorusunun cevabı bugün kayıtta yok.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 2 — İZ BIRAKMAYAN MUTASYON (en büyük denetim boşluğu)
-- ═══════════════════════════════════════════════════════════════════════
--
-- `adminCloseShiftAction` bir vardiyanın `ended_at` ve `end_km` alanlarını
-- YAZIYOR ama `shift_edit_log`a HİÇBİR ŞEY yazmıyordu. Yani yöneticinin
-- kapattığı bir vardiya, AZG raporunu besleyen `ended_at` alanını değiştirdiği
-- hâlde denetim izinde görünmüyordu. `editEntryAction` iz bırakıyor, kapatma
-- bırakmıyordu — aynı tabloya iki farklı standart.
--
-- 087 sonrası kapatma da iz bırakır ve SEBEP ister.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 3 — SORUNUN BÜYÜKLÜĞÜ (HAK61 canlı)
-- ═══════════════════════════════════════════════════════════════════════
--
--   · 9 vardiya AÇIK; 7'si 24.08'den beri (37–39 saat).
--   · 18–26.08 arasında **20 saatten uzun KAPANMIŞ** 14 vardiya var:
--     en uzunu 52,64 saat (Mehmet Durdu, 19→21.08).
--   · Bir şoför notu: "vardiyayi kapatmayi unutmusum" (Resul Demir, 21.08).
--   · Tipik desen: Muhammed Copur 24.08 07:34 → 25.08 04:30 (20,94 sa),
--     hemen ardından 25.08 04:30'da YENİ vardiya açmış. Yani vardiyayı
--     ertesi sabah, yeni vardiyayı açarken kapatmış.
--
-- ⚠️ Bildirilen "Can Özsavaş" HAK61 kadrosunda YOK (32 aktif personel
-- tarandı; en yakın adlar Sinan Özcan ve Sercan Kalkanli). O vaka başka bir
-- kiracıda olmalı — Sendigo/galzura-demo service-role anahtarları bu makinede
-- yok, oralarda ölçüm yapılamadı. Sorunun SINIFI HAK61'de fazlasıyla
-- doğrulandı; bu migration üç kiracıda da aynı işi görür.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 4 — TÜRETİLMİŞ SAYILAR ÖNBELLEKLİ Mİ
-- ═══════════════════════════════════════════════════════════════════════
--
-- HAYIR. Aranan önbellek tablolarının hiçbiri yok: `surucu_skorlari`,
-- `sofor_skor_ozet`, `vardiya_ozet`, `gunluk_ozet` → TABLO YOK.
--
-- Çalışma saati, km, skor, maliyet, AZG ve mevzuat kalan süresi HEPSİ istek
-- anında `time_entries`ten hesaplanıyor. Yani düzeltme kendiliğinden yayılır
-- ve bu migration'ın yeniden hesaplama için bir şey yapmasına GEREK YOK.
--
-- ⚠️ TEK İSTİSNA VE BİLİNÇLİ: `mevzuat_uyarilari` (086) bir DEFTERDİR.
-- Gönderilmiş bir bildirim, dayandığı vardiya sonradan düzeltilse de
-- silinmez — gönderilmemiş gibi görünmesi denetim izini bozardı. Defter
-- "o an ne biliniyordu"yu saklar, "şimdi ne doğru"yu değil.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
/**
 * SEBEP — DENETİMİN CEVAP BEKLEDİĞİ ALAN.
 *
 * ⚠️ NULL'LANABİLİR OLMAK ZORUNDA: canlıda sebep alanı olmadan yazılmış
 * 13 satır var. `not null` yapmak migration'ı düşürürdü; geriye dönük sebep
 * uydurmak ise denetim kaydına yalan yazmak olurdu.
 *
 * ZORUNLULUK KODDA: yeni düzeltme ve kapatma yolları sebep olmadan
 * ÇALIŞMAZ (sunucu eylemi reddeder). Yani "sebebi olmayan satır" bundan
 * sonra üretilemez, ama geçmiş satırlar dürüstçe `null` kalır ve ekran
 * bunları "sebep kaydedilmemiş (087 öncesi)" diye gösterir.
 */
alter table public.shift_edit_log
  add column if not exists reason text
    check (reason is null or length(btrim(reason)) between 3 and 500);

/**
 * DÜZELTME GRUBU — bir düzeltme, N alan satırı.
 *
 * Bugün her alan ayrı satır ve aynı düzeltmeye ait oldukları yalnız
 * `changed_at`in milisaniyesine bakılarak anlaşılabiliyor. Sebep alan
 * başına değil DÜZELTME başına bir şeydir; grup olmadan aynı cümle N kez
 * kopyalanırdı ve iki ayrı düzeltme aynı saniyeye düşerse birbirine karışırdı.
 */
alter table public.shift_edit_log
  add column if not exists edit_group uuid;

/**
 * KAYNAK — bu satırı hangi yol yazdı.
 *
 * 'duzeltme' yöneticinin vardiya düzenleme formu
 * 'kapatma'  yöneticinin kapanmamış vardiyayı kapatması
 * 'km'       yalnız km düzeltme yolu (adminUpdateKmAction)
 *
 * Denetimde "bu bitiş saatini kim, hangi işlemle yazdı" sorusunun cevabı.
 * CHECK dar tutuldu: yeni bir yol eklenirse bilinçli olarak buraya da
 * eklenmeli, sessizce sızmamalı.
 */
alter table public.shift_edit_log
  add column if not exists kaynak text
    check (kaynak is null or kaynak in ('duzeltme', 'kapatma', 'km'));

comment on column public.shift_edit_log.reason is
  'Düzeltmenin SEBEBİ (087). Yeni yollarda zorunlu; 087 öncesi satırlarda null — geriye dönük sebep uydurulmadı.';
comment on column public.shift_edit_log.edit_group is
  'Tek bir düzeltmenin alan satırlarını birbirine bağlar (087). Sebep alan başına değil düzeltme başınadır.';

-- Bir vardiyanın geçmişi: en sık sorgu (satır detayı + AZG rozeti).
create index if not exists idx_shift_edit_entry
  on public.shift_edit_log (time_entry_id, changed_at desc);

-- Grup içi okuma — "bu düzeltmede başka ne değişti".
create index if not exists idx_shift_edit_group
  on public.shift_edit_log (edit_group)
  where edit_group is not null;
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorguları):
--
--   select column_name, is_nullable from information_schema.columns
--    where table_schema='public' and table_name='shift_edit_log'
--    order by ordinal_position;
--   → 10 satır: id, time_entry_id, changed_at, changed_by, field,
--     old_value, new_value, reason, edit_group, kaynak
--
--   select count(*) from public.shift_edit_log;              → 13 (değişmedi)
--   select count(*) from public.shift_edit_log
--    where reason is not null;                               → 0 (henüz)
--
-- MEVCUT VERİYE ETKİSİ: sıfır. Üç null'lanabilir kolon eklendi, hiçbir satır
-- güncellenmedi, hiçbir motor davranışı değişmedi.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  088_sofor_odul.sql                                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 088 (ŞOFÖR ÖDÜL VE LİDERLİK)
-- =====================================================================
-- Güvenlik skoru motoru VAR ve çalışıyor. Eksik olan: şoförün kendi durumunu
-- görmesi, sıralama, rozet ve DÖNEM GEÇMİŞİ. Additive + idempotent; mevcut
-- hiçbir tabloya dokunulmaz. Supabase SQL Editor'da çalıştırın.
--
-- ⚠️ 060 (device_config_epochs) uygulanmış olmalı — rozetlerin kalibrasyon
-- sınırını bilmesi buna bağlı.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 1 — SKOR MOTORU BUGÜN NE VERİYOR (HAK61 canlı, 25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Eksenler: overspeeding 25 · jamming 25 · harsh_braking 12 ·
-- harsh_cornering 12 · idling 5 · harsh_acceleration 3. Ceza km ile
-- normalize ediliyor (K=500). Skor 0–100 YA DA **null**.
--
-- KAPSAMA (son 30 gün): kadro 28 · **skorlanan 17** · skorsuz 11
--   ortalama 47,0 · en yüksek 92 (Resul Demir) · en düşük 14
--   80+ olan: 2 · 60–79: 3 · <60: 12
--   skorsuzluk sebebi: kapsama_dusuk 8 · km_yetersiz 3
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 2 — HAFTALIK ROZET YAPISAL OLARAK KAZANILAMAZ
-- ═══════════════════════════════════════════════════════════════════════
--
-- Görev "4 hafta üst üste 80+ skor" rozetini istedi. HAFTALIK pencereler
-- canlıda ölçüldü:
--
--     hafta -0   kadro 22 · SKORLANAN 4  · 80+ olan 0
--     hafta -1   kadro 20 · SKORLANAN 3  · 80+ olan 0
--     hafta -2   kadro 22 · SKORLANAN 3  · 80+ olan 0
--     hafta -3   kadro 23 · SKORLANAN 3  · 80+ olan 0
--
-- Yani 7 günlük pencerede şoförlerin **%14–18'i** km kapsama kapısını
-- geçebiliyor ve son dört haftada **hiç kimse** haftalık 80+ almadı.
-- "4 hafta üst üste 80+" rozeti kimsenin kazanamayacağı bir rozettir; böyle
-- bir rozet motivasyon değil, alay üretir.
--
-- 30 GÜNLÜK pencerede aynı ölçüm: **17/28 skorlanıyor**, 2 kişi 80+.
--
-- KARAR: rozetler **AYLIK (30 gün)** pencerede hesaplanır. Bu tablo da o
-- yüzden dönem başına bir satır tutar.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 3 — KALİBRASYON SINIRI: SORUN AĞIRLIKTA DEĞİL, CİHAZDA
-- ═══════════════════════════════════════════════════════════════════════
--
-- Görev "eşik 40→20, ağırlık 12→3 değişti, rozet farklı kalibrasyonlu
-- haftaları karşılaştırmamalı" dedi. Ölçüm bunu İKİYE ayırıyor:
--
--   AĞIRLIK/EŞİK DEĞİŞİMİ (kodda, 13.08.2026) → **SORUN DEĞİL**.
--   Skor geçmişi HİÇBİR YERDE SAKLANMIYOR (aranan tabloların hepsi yok:
--   surucu_skorlari · driver_scores · skor_gecmisi). Her skor istek anında
--   BUGÜNKÜ ağırlıklarla yeniden hesaplanıyor. Geçmiş bir ayı bugün
--   hesaplarsanız bugünkü cetvelle ölçülür — yani kod tarafı kendi içinde
--   tutarlı.
--
--   CİHAZ EŞİĞİ DEĞİŞİMİ (Teltonika setparam, 22–23.07.2026) → **SORUN**.
--   O tarihte hızlanma 2.2→3.3, fren 2.5→3.3, aşırı hız 120→131 km/s
--   yapıldı ve HAM OLAY sayısı değişti. Bu, yeniden hesapla düzelmez:
--   olayın kendisi farklı bir cetvelle üretilmiş.
--
-- Repo bu sınırı zaten tutuyor: `device_config_epochs` + `lib/config-epoch.ts`.
-- CANLI: en son epok **2026-07-23**.
--
-- SONUÇ: bir dönem snapshot'ı, hesaplandığı andaki epok damgasını TAŞIR
-- (`epok_at`). Rozet motoru yalnız AYNI epoktan sonra başlayan dönemleri
-- karşılaştırır. Bugün temiz dönem sayısı **1** — "3 ay üst üste" rozeti
-- henüz kazanılamaz ve ekran bunu SÖYLER, sessizce boş bırakmaz.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 4 — SKORSUZ ŞOFÖR: SIFIR DEĞİL, SEBEP
-- ═══════════════════════════════════════════════════════════════════════
--
-- Motor zaten `scoreGate` üretiyor: `km_yetersiz` · `kapsama_dusuk` ·
-- `vardiya_yok`. Snapshot bunu saklar; liderlik tablosu skorsuz şoförü
-- SIRALAMAYA SOKMAZ, ayrı bir bölümde sebebiyle gösterir.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 5 — SEKTÖR (kaynak gösterildi, bkz. docs/SOFOR-ODUL.md)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Motive **Driver Rewards** (27.05.2026, Vision 26): kural + puan sistemi,
-- gerçek zamanlı rozet ve liderlik tablosu, hediye kartı/para dönüşümü.
-- Samsara **Positive Recognition**: iyi davranış SERİLERİNİ (streak) ve
-- kilometre taşlarını otomatik yakalayıp şoför uygulamasında gösteriyor.
--
-- Ortak mekanik: SERİ + KİLOMETRE TAŞI + ROZET + SIRALAMA. Ödül/para
-- dönüşümü BU TURDA YOK — muhasebe ve bordro bağı ayrı bir iştir.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 İSİM GÖRÜNÜRLÜĞÜ — VARSAYILAN KAPALI (DACH)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Almanya'da § 87 Abs. 1 Nr. 6 BetrVG: çalışanın davranışını veya
-- performansını izlemeye ELVERİŞLİ teknik düzenek işletme kurulunun ORTAK
-- KARARINA tabidir. İçtihat ölçütü işverenin niyeti değil, düzeneğin
-- NESNEL ELVERİŞLİLİĞİ. İsimli bir liderlik tablosu tam olarak budur.
--
-- Bu yüzden `isim_gorunur` varsayılanı **false**: şoför kendi sırasını ve
-- skorunu görür, diğerleri "Şoför #4" olarak görünür. İsimleri açmak
-- kiracının bilinçli kararıdır (ve DE'de işletme kurulu onayı gerektirir).
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ═════════════════════════ KİRACI AYARI ════════════════════════════════

create table if not exists public.tenant_odul (
  id text primary key default 'singleton' check (id = 'singleton'),

  /**
   * LİDERLİK TABLOSUNDA İSİM GÖRÜNÜR MÜ — VARSAYILAN HAYIR.
   *
   * Gerekçe yukarıda (§ 87 Abs. 1 Nr. 6 BetrVG · AT DSG). Kapalıyken şoför
   * KENDİ adını ve sırasını görür, başkaları takma sırayla listelenir.
   */
  isim_gorunur boolean not null default false,

  /** Rozet katmanı açık mı — kapalıysa hiç rozet hesaplanmaz/gösterilmez. */
  rozet_acik boolean not null default true,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.workers(id) on delete set null
);

comment on table public.tenant_odul is
  'Ödül/liderlik kiracı ayarı (088). isim_gorunur VARSAYILAN FALSE: isimli sıralama § 87 Abs. 1 Nr. 6 BetrVG anlamında performans izlemeye elverişli bir düzenektir.';

insert into public.tenant_odul (id) values ('singleton') on conflict (id) do nothing;

-- ═══════════════════ DÖNEM SKOR ANLIK GÖRÜNTÜSÜ ═══════════════════════

create table if not exists public.sofor_skor_donem (
  id uuid primary key default gen_random_uuid(),

  worker_id uuid not null references public.workers(id) on delete cascade,

  /** Dönemin İLK günü (30 günlük pencerenin başı, Viyana günü). */
  donem_bas date not null,
  /** Dönemin SON günü — dahil. */
  donem_bit date not null,

  /**
   * SKOR — 0..100 YA DA NULL. null = yeterli veri yok; `kapi` sebebi söyler.
   * ⚠️ 0 YAZMAK YASAK: "hiç sürmemiş" ile "kötü sürmüş" aynı sayıya düşerdi.
   */
  skor integer check (skor is null or (skor >= 0 and skor <= 100)),

  /**
   * SKOR NEDEN YOK — motorun kendi ürettiği kapı adı (lib/reports.ts).
   * `skor` doluysa null.
   */
  kapi text check (kapi is null or kapi in ('km_yetersiz', 'kapsama_dusuk', 'vardiya_yok')),

  olay_sayisi integer not null default 0 check (olay_sayisi >= 0),
  /** Skorun paydası — ölçülen km. null = ölçülemedi (0 km sürdü DEĞİL). */
  km numeric(10,1),
  /** O şoför için hesaplanan km eşiği — kapı nerede duruyordu. */
  esik_km numeric(10,1),

  /**
   * 🔴 KALİBRASYON DAMGASI — ROZETİN TEMELİ.
   *
   * Bu dönem hesaplanırken yürürlükte olan CİHAZ EŞİĞİ değişiminin anı
   * (`device_config_epochs`in en sonu). Rozet motoru yalnız AYNI damgayı
   * taşıyan dönemleri karşılaştırır: 22–23.07.2026'da cihaz eşikleri
   * gevşetildi ve ham olay sayısı yarıya indi; o sınırın iki yakasındaki
   * skorlar aynı cetvelle ölçülmemiştir.
   *
   * null = hiç epok kaydı yok (yeni kurulum) — o zaman tüm dönemler aynı
   * kabul edilir, çünkü karşılaştırmayı bozan bir olay yaşanmamıştır.
   */
  epok_at timestamptz,

  /** Dönem epok sınırından ÖNCE başlıyor mu — karışık veri uyarısı. */
  epok_oncesi boolean not null default false,

  hesaplandi_at timestamptz not null default now()
);

comment on table public.sofor_skor_donem is
  'Dönemsel skor anlık görüntüsü (088). Skor geçmişi HİÇBİR YERDE saklanmıyordu; rozet "üst üste N dönem" diyebilmek için bu tabloya ihtiyaç duyar. Her satır hesaplandığı kalibrasyon damgasını taşır.';

/**
 * DÖNEM BAŞINA TEK SATIR. İkinci hesaplama aynı satırı GÜNCELLER
 * (upsert), yenisini yazmaz — aksi hâlde "üst üste 3 dönem" sayımı
 * tekrarlanan satırlarla şişerdi.
 */
create unique index if not exists sofor_skor_donem_tekil
  on public.sofor_skor_donem (worker_id, donem_bas);

create index if not exists idx_skor_donem_bas
  on public.sofor_skor_donem (donem_bas desc, skor desc nulls last);

-- ═════════════════════════ ROZETLER ════════════════════════════════════

create table if not exists public.sofor_rozetleri (
  id uuid primary key default gen_random_uuid(),

  worker_id uuid not null references public.workers(id) on delete cascade,

  /**
   * ROZET KODU. CHECK YOK — rozet kuralları KODDA yaşıyor (lib/odul.ts) ve
   * yeni bir rozet eklemek migration gerektirmemeli. 084 ve 086'da aynı
   * karar `kural` kolonu için verilmişti.
   */
  rozet text not null,

  /** Rozetin kazanıldığı dönemin başı — tekillik anahtarının parçası. */
  donem_bas date not null,

  /**
   * KANIT — hangi sayıdan çıktı. Rozet açıklanabilir olmalı: şoför
   * "neden bu rozeti aldım" sorusunu ekranda cevaplayabilmeli.
   */
  kanit jsonb not null default '{}'::jsonb,

  kazanildi_at timestamptz not null default now()
);

comment on table public.sofor_rozetleri is
  'Kazanılmış rozetler (088). Rozet SİLİNMEZ: kazanıldığı dönemin gerçeğidir. Sonraki dönemde skor düşse de geçmiş rozet durur.';

/** Aynı rozet aynı dönem için İKİ KEZ verilemez. */
create unique index if not exists sofor_rozet_tekil
  on public.sofor_rozetleri (worker_id, rozet, donem_bas);

create index if not exists idx_rozet_worker
  on public.sofor_rozetleri (worker_id, kazanildi_at desc);
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorguları):
--
--   select * from public.tenant_odul;
--   → 1 satır: singleton · isim_gorunur=false · rozet_acik=true
--
--   select count(*) from public.sofor_skor_donem;   → 0
--   select count(*) from public.sofor_rozetleri;    → 0
--
--   select indexname from pg_indexes
--    where tablename in ('sofor_skor_donem','sofor_rozetleri')
--    order by indexname;
--   → idx_rozet_worker, idx_skor_donem_bas, sofor_rozet_tekil,
--     sofor_rozetleri_pkey, sofor_skor_donem_pkey, sofor_skor_donem_tekil
--
-- MEVCUT VERİYE ETKİSİ: sıfır. Üç YENİ tablo; skor motoru, AZG raporu ve
-- performans raporu bunları hiç okumaz.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  089_co2_panosu.sql                                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 089 (CO₂ PANOSU — ARAÇ YAKIT TÜRÜ + ESAS)
-- =====================================================================
-- CO₂ katsayı tablosu ve 3 sayfalık PDF zaten vardı ama üçü birden kırıktı:
-- pano yok, sayfa bayrakla kapalı, girdi boş. Bu migration ölçülebilir bir
-- CO₂ katmanının ŞEMA eksiklerini kapatıyor. Additive + idempotent.
-- Supabase SQL Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 1 — GİRDİ BOŞ, GERÇEK VERİ BAŞKA YERDE (HAK61 canlı, 25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
--   fuel_entries (CO₂'nin bugünkü girdisi)  : 1 satır · ONAYLI 0
--   → bugün rapor açılsa 0 kg basardı.
--
--   Telemetri (buildFuelReport, 30 gün)     : **2.584,7 L** · 31.148 km
--     29 araçtan 23'ünün litresi ÖLÇÜLÜYOR · filo 11,57 L/100km
--     litresi ölçülemeyen 6 araç: DO-505GS · DO-506GS · DO-753GS ·
--     DO-775GS · DO-776GS · DO-945HL  (cihaz verisi yok)
--
-- KARAR: CO₂ girdisi `fuel_entries` DEĞİL, telemetri litresi.
-- ⚠️ Ölçülemeyen 6 araç "0 kg" DEĞİL "ölçülemedi" döner.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 2 — KATSAYI ETİKETİ YANLIŞTI
-- ═══════════════════════════════════════════════════════════════════════
--
-- `lib/co2.ts` yorumu "EU well-to-tank tailpipe convention" diyordu. Bu cümle
-- kendi içinde çelişkili ve etiket YANLIŞ:
--
--   TTW (tank-to-wheel)  = egzozdan çıkan · doğrudan yanma · Scope 1
--   WTT (well-to-tank)   = yakıtın çıkarılması, rafinesi, dağıtımı · yukarı akış
--   WTW (well-to-wheel)  = WTT + TTW · lojistik raporlamasının istediği
--
-- 2,64 kg CO₂/L bir **TTW** katsayısıdır (mineral dizel yanması). "Well-to-tank"
-- diye etiketlemek denetimde ters teper: müşteri WTW beklerken TTW alır ve
-- rakam ~%20 düşük görünür.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 3 — HANGİ STANDART
-- ═══════════════════════════════════════════════════════════════════════
--
-- GLEC Framework, **ISO 14083:2023** olarak uluslararası standart hâline
-- getirildi; CDP, SBTi ve **CSRD/ESRS E1** bu standarda atıf yapıyor. Lojistik
-- raporlamasında istenen büyüklük **WTW**'dir (WTT + TTW).
--
-- KARAR: ürün **her iki esası da** üretir ve raporun hangisi olduğunu AÇIKÇA
-- yazar. Varsayılan **TTW** (bugünkü sayıların devamı, geriye dönük kıyas
-- kırılmasın); kiracı WTW'ye geçebilir.
--
-- ⚠️ STANDART DEĞİŞİMİ GERİYE DÖNÜK KIYASI KIRAR — NASIL YÖNETİLİYOR:
--   1. Esas KİRACI AYARIDIR ve tek yerde durur (`tenant_co2.esas`).
--   2. Her rapor/pano çıktısı esası ve katsayı kümesi sürümünü TAŞIR; PDF'in
--      metodoloji bölümüne basılır.
--   3. Esas değiştiğinde GEÇMİŞ SAYILAR YENİDEN HESAPLANIR — CO₂ hiçbir yerde
--      SAKLANMIYOR, her istekte litreden türetiliyor. Yani "eski rapor bir
--      esasta, yeni rapor başka esasta" durumu OLUŞMAZ; tüm ekran tek esasta
--      konuşur. Elde basılmış bir PDF varsa üstünde esas yazılıdır ve hangi
--      cetvelle üretildiği belgeden okunur.
--   Bu, 088'deki kalibrasyon sorununun TERSİ: orada ham veri değişmişti ve
--   yeniden hesap düzeltmiyordu; burada değişen yalnız çarpan, veri aynı.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 4 — ELEKTRİKLİ ARAÇ
-- ═══════════════════════════════════════════════════════════════════════
--
-- TTW'de elektrikli aracın egzozu yok → **0 kg doğru**.
-- WTW'de 0 **YANLIŞ**: şebekeden gelen elektrik üretilirken CO₂ çıkıyor ve
-- yoğunluk ülkeye göre değişiyor (EEA "Greenhouse gas emission intensity of
-- electricity generation", gCO2e/kWh, UNFCCC + Eurostat kaynaklı).
--
-- Repoda otomatik bir şebeke yoğunluğu kaynağı YOK. KARAR: kiracı girer
-- (`tenant_co2.sebeke_g_kwh`, 076'daki oran deseninin aynısı). GİRİLMEDİĞİ
-- SÜRECE WTW esasında elektrikli aracın CO₂'si **null** döner — 0 değil.
-- Bilmediğimiz sayıyı 0 yazmak, elektrikli filoyu sıfır emisyonlu göstermek
-- olurdu ve bu ihalede yanlış beyandır.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 5 — vehicles.fuel_type KOLONU YOK
-- ═══════════════════════════════════════════════════════════════════════
--
-- CANLI: `select fuel_type from vehicles` → **42703 (kolon yok)**.
-- `fuel_type` yalnız `fuel_expenses` (şoför fişi) üzerinde var. Yani bugün her
-- araç dizel sayılıyor ve elektrikli bir araç dizel katsayısıyla çarpılırdı.
-- Bu migration kolonu ARACA ekliyor.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ═════════════════════ ARAÇ YAKIT TÜRÜ ═════════════════════════════════

/**
 * ARACIN YAKIT TÜRÜ — CO₂ katsayısını seçen alan.
 *
 * Varsayılan 'diesel': bugünkü davranışın birebir kendisi (kolon yokken her
 * araç dizel sayılıyordu). Yani migration hiçbir sayıyı DEĞİŞTİRMEZ; yalnız
 * farklı bir türü YAZILABİLİR kılar.
 *
 * CHECK, `fuel_expenses.fuel_type` ile AYNI dört değer — iki tabloda iki
 * farklı tür kümesi olsaydı aynı aracın fişi ile kaydı çelişirdi.
 */
alter table public.vehicles
  add column if not exists fuel_type text not null default 'diesel'
    check (fuel_type in ('diesel', 'benzin', 'lpg', 'elektro'));

comment on column public.vehicles.fuel_type is
  'Aracın yakıt türü (089). CO₂ katsayısını bu belirler. Kolon eklenmeden önce her araç dizel sayılıyordu; varsayılan o davranışı korur.';

-- Elektrikli araç sorgusu: WTW esasında şebeke yoğunluğu gerektiren küme.
create index if not exists idx_vehicles_fuel_type
  on public.vehicles (fuel_type)
  where fuel_type <> 'diesel';

-- ═════════════════════ KİRACI CO₂ AYARI ════════════════════════════════

create table if not exists public.tenant_co2 (
  -- 076'daki desen: tek satır, sabit anahtar.
  id text primary key default 'singleton' check (id = 'singleton'),

  /**
   * RAPORLAMA ESASI.
   *
   * 'TTW' egzoz (Scope 1) — varsayılan, bugünkü sayıların devamı
   * 'WTW' kuyudan tekere (WTT + TTW) — ISO 14083 / GLEC'in istediği
   *
   * Değiştirmek TÜM ekranı yeniden hesaplatır (CO₂ hiçbir yerde saklanmıyor),
   * yani karışık esaslı bir tablo oluşamaz.
   */
  esas text not null default 'TTW' check (esas in ('TTW', 'WTW')),

  /**
   * ŞEBEKE KARBON YOĞUNLUĞU (gCO2e/kWh) — YALNIZ elektrikli araç + WTW için.
   *
   * ⚠️ NULL = BİLİNMİYOR, 0 DEĞİL. Girilmediği sürece WTW esasında elektrikli
   * aracın CO₂'si `null` döner ve ekran "ölçülemedi · şebeke yoğunluğu
   * girilmemiş" der. 0 yazmak elektrikli filoyu sıfır emisyonlu göstermek
   * olurdu — ihalede yanlış beyan.
   *
   * Kaynak: EEA "Greenhouse gas emission intensity of electricity generation"
   * (ülke bazlı, gCO2e/kWh). Otomatik çekim YOK; kiracı kendi ülkesinin
   * güncel değerini girer ve `sebeke_kaynak`/`sebeke_yil` ile belgeler.
   */
  sebeke_g_kwh numeric(8,2) check (sebeke_g_kwh is null or sebeke_g_kwh >= 0),
  sebeke_kaynak text,
  sebeke_yil integer check (sebeke_yil is null or (sebeke_yil between 1990 and 2100)),

  /**
   * HEDEF — g CO₂ / km. null = hedef konulmamış.
   *
   * Yoğunluk (g/km) seçildi, mutlak kg değil: mutlak hedef filo büyürken
   * kendiliğinden ihlal edilir ve kimseye bir şey söylemez. İhale
   * dokümanlarında da yoğunluk isteniyor.
   */
  hedef_g_km numeric(8,2) check (hedef_g_km is null or hedef_g_km > 0),
  hedef_yil integer check (hedef_yil is null or (hedef_yil between 2000 and 2100)),

  updated_at timestamptz not null default now(),
  updated_by uuid references public.workers(id) on delete set null
);

comment on table public.tenant_co2 is
  'CO₂ raporlama ayarı (089): esas (TTW/WTW), şebeke karbon yoğunluğu, hedef. Esas TEK YERDE durur; değiştiği anda tüm ekran aynı cetvele geçer çünkü CO₂ hiçbir yerde saklanmaz.';

insert into public.tenant_co2 (id) values ('singleton') on conflict (id) do nothing;
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorguları):
--
--   select * from public.tenant_co2;
--   → 1 satır: singleton · TTW · sebeke_g_kwh null · hedef null
--
--   select fuel_type, count(*) from public.vehicles group by 1;
--   → tek satır: diesel | <araç sayısı>   (HAK61'de 29)
--
--   select column_name, column_default from information_schema.columns
--    where table_name='vehicles' and column_name='fuel_type';
--   → fuel_type | 'diesel'::text
--
-- MEVCUT VERİYE ETKİSİ: sıfır. Araçlara varsayılanı bugünkü davranışla AYNI
-- olan bir kolon eklendi; hiçbir sayı değişmez.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  090_saklama_politikasi.sql                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 090 (SAKLAMA: UYARI + ELLE SİLME)
-- =====================================================================
-- Additive + idempotent. Supabase SQL Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 BU MIGRATION HİÇBİR OTOMATİK SİLME KURMAZ
-- ═══════════════════════════════════════════════════════════════════════
--
-- Sistem **yalnız hesaplar ve UYARIR**. Silmeye bir insan karar verir,
-- /admin/saklama ekranından, aralığı kendisi seçerek, çift onayla.
--
-- Neden: saklama süresi ve silme kararı **veri sorumlusunun** (müşterinin)
-- kararıdır; Galzura veri İŞLEYENDİR. Ürünün bir kiracının verisini kendi
-- takvimine göre silmesi, işleyenin sorumlu yerine karar vermesi olurdu.
-- Gece koşan iş "şu kadar satırınız eşiği geçti" der ve durur.
--
-- Bu yüzden burada `silme_acik` diye bir anahtar YOK, gün sayısına göre
-- silen bir fonksiyon YOK. Silme fonksiyonları ARALIK alır ve yalnız
-- ekrandan, denetim izi yazılarak çağrılır.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 EŞİK DEĞERLERİ BU MIGRATION'DA UYDURULMUYOR
-- ═══════════════════════════════════════════════════════════════════════
--
-- `saklama_esikleri` tablosu KURULUR ama **BOŞ BIRAKILIR**. Yasal eşikler
-- ayrı bir araştırma turuyla, kaynak linki ve doğrulanma tarihiyle
-- doldurulacak. Uydurma bir gün sayısı DACH müşterisine giderse sorumluluk
-- doğar; ürün "eşik doğrulanmadı" demeyi, yanlış bir sayı demeye tercih eder.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 1 — BUGÜN POLİTİKA YOK (HAK61 canlı, 26.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
--   device_telemetry : 1.611.074 satır · en eski kayıt 13.07.2026 = 44 gün
--
-- 44 gün bir POLİTİKA değil bir TESADÜF: entegrasyon o gün başladı. Hiçbir
-- mekanizma bu sayının 400 güne çıkmasını engellemiyor ve kimse haberdar
-- olmuyor. Bu migration'ın asıl işi **görünürlük**.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 2 — GÜNLÜK ÖZET YANLIŞ SAYI ÜRETİYOR, AYLIK ÜRETMİYOR
-- ═══════════════════════════════════════════════════════════════════════
--
-- buildFuelReport'un 28 günlük gerçek cevabı 2.602,6 L. Aynı pencere
-- parçalara bölünüp toplandığında (HAK61 canlı):
--
--     parça |  toplam L | sapma
--     ------+-----------+-------
--        1g |    3009,9 | +15,6%   ← GÜNLÜK ÖZET
--        7g |    2714,0 |  +4,3%
--       28g |    2602,5 |  -0,0%   ← AYLIK ÖZET
--
-- (14 günlük ikinci ölçüm: gerçek 1.194,98 L, günlük toplam 1.540,1 L = +%28,9)
--
-- SEBEP: yakıt motoru (027 + 052) ardışık okuma DİZİSİ üzerinde çalışıyor —
-- 30 satırlık de-glitch penceresi, 15 dakikalık seri birleştirme. Gün sınırı
-- diziyi kesiyor; gece yarısını aşan dolum iki kez sayılıyor.
--
-- 🔑 KARAR: ÖZET **AYLIK**. Canlıdaki `daily_vehicle_metrics` (20 satır, TEK
-- gün, yazan/okuyan kod yok) bu iş için YANLIŞ ŞEKİL; bu migration ona
-- DOKUNMUYOR.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 3 — SİLME HANGİ YÜZEYİ BOZAR
-- ═══════════════════════════════════════════════════════════════════════
--
--   doğru çalışır : Mevzuat motoru · Bölge ziyaretleri (zone_visits KALICI)
--   boşalır       : Rota geçmişi (KURTARILAMAZ — özette lat/lon yok, bilinçli)
--   sessizce yanlış: Yakıt · Maliyet · CO₂ · Kârlılık · Skor(payda) ·
--                    Haftalık K3 sessiz_arac · Sessiz cihaz alarmı
--
-- Bu yüzden ELLE silme bile ön koşulsuz değildir: aylık özet yazılmadan,
-- vardiya km yargısı dondurulmadan ve cihaz ömür izi çıkarılmadan bir aralık
-- silinemez (bkz. lib/saklama.ts silmeKapisi).
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ═════════════════════ 1 · KİRACI UYARI AYARI ══════════════════════════

create table if not exists public.tenant_saklama (
  -- 076/089'daki desen: tek satır, sabit anahtar.
  id text primary key default 'singleton' check (id = 'singleton'),

  /**
   * UYARI EŞİĞİ (gün) — kiracının kendi hedefi.
   *
   * ⚠️ ADI BİLİNÇLİ `uyari_gun`, `saklama_gun` DEĞİL: bu sayı hiçbir şey
   * silmez. "Bu kadar günü geçen ham satırınız var" uyarısının çıpasıdır.
   * Silme kararı ve zamanı veri sorumlusundadır.
   *
   * Varsayılan 90: CNIL'in ham konum için söylediği 2 ayın bir ay üstü,
   * cezalandırılmış 180 günün yarısı (İtalya/Garante 01/2025, 50.000 €),
   * Almanya'nın orantısız bulduğu 150 ve 400 günün çok altı. Tam gerekçe
   * docs/SAKLAMA-POLITIKASI.md'de.
   *
   * ⚠️ Bu 90, `saklama_esikleri`ndeki YASAL çıpa DEĞİLDİR. Yasal çıpa ayrı
   * tabloda durur ve bugün BOŞTUR (bkz. §3).
   */
  uyari_gun integer not null default 90
    check (uyari_gun between 1 and 3650),

  /**
   * HANGİ ÜLKENİN YASAL ÇIPASI GÖSTERİLSİN.
   *
   * `saklama_esikleri` içinde bu ülkeye ait satır yoksa ekran "yasal çıpa
   * doğrulanmadı" der ve HİÇBİR SAYI göstermez. Varsayılan 'AT' bir
   * ÖLÇÜ değil, bir ARAMA ANAHTARIDIR — dağıtım Avusturya'da.
   */
  ulke_kodu text not null default 'AT' check (ulke_kodu ~ '^[A-Z]{2}$'),

  /** Kiracının uyarı eşiğini neden böyle seçtiği. Serbest metin. */
  gerekce text,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.workers(id) on delete set null
);

comment on table public.tenant_saklama is
  'Saklama UYARI ayarı (090). uyari_gun hiçbir şey SİLMEZ — uyarının çıpasıdır. Silme kararı veri sorumlusunda (müşteri); Galzura veri işleyendir.';

comment on column public.tenant_saklama.uyari_gun is
  'Uyarı eşiği (gün). SİLMEZ. Yasal çıpa ayrı tabloda (saklama_esikleri) ve bugün BOŞ.';

insert into public.tenant_saklama (id) values ('singleton') on conflict (id) do nothing;

-- ═════════════════════ 2 · VERİ KATEGORİLERİ ═══════════════════════════

/**
 * HER TABLO/KOLON ÜÇ KATEGORİDEN BİRİNE DÜŞER.
 *
 *   'kisisel'       → uyarı çıkar, ELLE silinebilir
 *   'arac'          → serbest, uyarı çıkmaz
 *   'yasal_zorunlu' → SİLİNEMEZ; arayüz silme seçeneğini GÖSTERMEZ
 *
 * ═══ HUKUKİ DAYANAK — AYRIM "ARAÇ MI ŞOFÖR MÜ" DEĞİL ═══
 *
 * GPS izi hukuken ŞOFÖRÜN kişisel verisidir, aracın değil. Aracın firmaya
 * ait olması bunu DEĞİŞTİRMEZ. Doğru soru "o an araçta kim vardı": bir konum
 * dizisi, o dizideki kişinin nerede olduğunu, ne zaman durduğunu, ne kadar
 * çalıştığını anlatır. Bu yüzden `device_telemetry` 'arac' değil 'kisisel'.
 *
 * ⚠️ ARAYÜZ BU TABLOYU OKUR. 'yasal_zorunlu' bir satır için silme düğmesi
 * render EDİLMEZ — "silme denendi ve reddedildi" değil, "seçenek hiç yok".
 * Reddetmek bir hatadır ve hata mesajı okunmayabilir; göstermemek bir
 * tasarımdır.
 */
create table if not exists public.veri_kategorileri (
  tablo_adi text not null,
  -- NULL = tablonun TAMAMI. Dolu = yalnız o kolon.
  kolon_adi text,
  kategori text not null check (kategori in ('kisisel', 'arac', 'yasal_zorunlu')),
  /** Bu sınıflandırmanın NEDEN böyle olduğu. Boş bırakılamaz. */
  gerekce text not null,
  guncellendi_at timestamptz not null default now()
);

comment on table public.veri_kategorileri is
  'Veri kategorilendirmesi (090): kisisel | arac | yasal_zorunlu. Arayüz bunu okur; yasal_zorunlu satır için silme seçeneği RENDER EDİLMEZ.';

-- Tablo geneli satırlarda kolon NULL olduğu için basit UNIQUE yetmez.
create unique index if not exists uq_veri_kategorileri
  on public.veri_kategorileri (tablo_adi, coalesce(kolon_adi, '*'));

/**
 * BAŞLANGIÇ SINIFLANDIRMASI.
 *
 * ⚠️ Bunlar YASAL EŞİK DEĞİL, ürünün kendi sınıflandırmasıdır ve gerekçesi
 * her satırda yazılı. Yasal SÜRELER bu tabloda DEĞİL, `saklama_esikleri`nde
 * ve orası bugün BOŞ.
 */
insert into public.veri_kategorileri (tablo_adi, kolon_adi, kategori, gerekce) values
  ('device_telemetry', null, 'kisisel',
   'GPS izi hukuken ŞOFÖRÜN kişisel verisi; aracın firmaya ait olması bunu değiştirmez. Belirleyici soru: o an araçta kim vardı.'),
  ('driver_locations', null, 'kisisel',
   'Telefon GPS kalıntısı. Artık yazılmıyor ama içindeki geçmiş konum aynı hukuki kategoride.'),
  ('idle_episodes', null, 'kisisel',
   'Rölanti epizodu bir konum+süre kaydı; hangi şoförün nerede ne kadar beklediğini anlatır.'),
  ('zone_visits', null, 'kisisel',
   'Bölge ziyareti = kimin nerede olduğu. Ham izden TÜRETİLMİŞ ama aynı bilgiyi taşır.'),
  ('vehicles', null, 'arac',
   'Plaka, filo, yakıt türü, sayaç — araca ait teknik künye. Kişi belirtmez.'),
  ('vehicle_month_metrics', null, 'arac',
   'Aylık ARAÇ toplamı (090). Kişi ekseni yok, gün/saat kırılımı yok; kimin nerede olduğunu anlatmaz.'),
  ('vehicle_telemetry_lifetime', null, 'arac',
   'Aracın ilk/son telemetri ANI — cihazın yaşadığına dair iki damga. Konum içermez.'),
  ('time_entries', null, 'yasal_zorunlu',
   'AZG/ArbZG çalışma süresi kaydı. İş müfettişliğinin okuduğu belge; saklama süresi iş hukukunun konusudur, bu ekranın değil.'),
  ('teslimat_kanitlari', null, 'yasal_zorunlu',
   'ePOD teslimat kanıtı — HK080 tetikleyicisiyle DEĞİŞMEZ. CMR anlaşmazlığında kanıt olan kayıt budur.'),
  ('shift_edit_log', null, 'yasal_zorunlu',
   'Vardiya düzeltme denetim izi (087). Denetim izinin silinebilmesi, izin kendisini anlamsız kılar.'),
  ('security_log', null, 'yasal_zorunlu',
   'Oturum/eylem izi (045). Aynı gerekçe: iz silinebiliyorsa iz değildir.')
on conflict (tablo_adi, coalesce(kolon_adi, '*')) do nothing;

-- ═════════════════════ 3 · ÜLKE BAZLI YASAL EŞİKLER ════════════════════

/**
 * 🔴 BU TABLO BİLEREK BOŞ KURULUR.
 *
 * Yasal eşikler ayrı bir araştırma turuyla, HER SATIR İÇİN kaynak linki ve
 * doğrulanma tarihiyle doldurulacak. Uydurma bir gün sayısı DACH müşterisine
 * giderse sorumluluk doğar.
 *
 * `esik_gun` NULL olabilir ve bu bir EKSİKLİK DEĞİL, bir BEYANDIR:
 * "bu ülke/veri türü için doğrulanmış bir çıpamız yok". Arayüz bu durumda
 * hiçbir sayı göstermez, "yasal çıpa doğrulanmadı" der.
 *
 * ⚠️ `dogrulanma_tarihi` olmadan bir satır anlamsızdır: mevzuat değişir ve
 * "ne zaman bakıldı" sorusu denetimde sorulur. Bu yüzden esik_gun doluysa
 * dayanak, kaynak ve tarih de dolu olmak ZORUNDA (CHECK ile).
 */
create table if not exists public.saklama_esikleri (
  ulke_kodu text not null check (ulke_kodu ~ '^[A-Z]{2}$'),
  /** 'ham_konum' · 'calisma_suresi' · 'teslimat_kaniti' … serbest sözlük. */
  veri_turu text not null,

  /** ⚠️ NULL = DOĞRULANMIŞ ÇIPA YOK. 0 değil, boş değil — bilinmiyor. */
  esik_gun integer check (esik_gun is null or esik_gun >= 0),

  yasal_dayanak text,
  kaynak_url text,
  dogrulanma_tarihi date,

  primary key (ulke_kodu, veri_turu),

  /**
   * Bir sayı yazıldıysa nereden geldiği de yazılmak ZORUNDA. Kaynaksız bir
   * eşik, uydurma bir eşiktir.
   */
  constraint saklama_esikleri_kaynakli check (
    esik_gun is null
    or (yasal_dayanak is not null and kaynak_url is not null and dogrulanma_tarihi is not null)
  )
);

comment on table public.saklama_esikleri is
  'Ülke bazlı yasal saklama çıpaları (090). BİLEREK BOŞ KURULUR — eşikler ayrı bir araştırma turuyla kaynaklı doldurulacak. esik_gun NULL = doğrulanmış çıpa YOK.';

comment on column public.saklama_esikleri.esik_gun is
  'NULL = doğrulanmış çıpa yok (0 DEĞİL). Doluysa yasal_dayanak + kaynak_url + dogrulanma_tarihi de zorunlu (CHECK).';

-- ⚠️ SATIR EKLENMİYOR. Bu boşluk bilinçlidir.

-- ═════════════════════ 4 · ELLE SİLME DENETİM İZİ ══════════════════════

/**
 * HER ELLE SİLME BURAYA YAZILIR — silmeden ÖNCE.
 *
 * Kim, ne zaman, hangi tablo, hangi aralık, kaç satır, hangi sebeple.
 * Sebep zorunlu: "neden sildiniz" sorusunun cevabı ürünün içinde durmalı,
 * birinin hafızasında değil.
 *
 * ⚠️ Bu tablo `veri_kategorileri`nde 'yasal_zorunlu' — kendisi silinemez.
 */
create table if not exists public.saklama_silme_izi (
  id uuid primary key default gen_random_uuid(),
  silen_worker_id uuid references public.workers(id) on delete set null,
  silindi_at timestamptz not null default now(),
  tablo_adi text not null,
  kategori text not null,
  aralik_bas timestamptz not null,
  aralik_bit timestamptz not null,
  satir_sayisi bigint not null,
  sebep text not null check (length(btrim(sebep)) >= 10),
  /** Kullanıcının elle yazdığı onay metni — çift onayın ikinci ayağı. */
  onay_metni text not null,
  check (aralik_bit > aralik_bas)
);

comment on table public.saklama_silme_izi is
  'Elle silme denetim izi (090). Her silme ÖNCE buraya yazılır: kim, ne zaman, hangi aralık, kaç satır, hangi sebeple. Kendisi yasal_zorunlu — silinemez.';

create index if not exists idx_saklama_silme_izi_zaman
  on public.saklama_silme_izi (silindi_at desc);

insert into public.veri_kategorileri (tablo_adi, kolon_adi, kategori, gerekce) values
  ('saklama_silme_izi', null, 'yasal_zorunlu',
   'Silme denetim izinin kendisi. Silinebiliyorsa iz değildir.')
on conflict (tablo_adi, coalesce(kolon_adi, '*')) do nothing;

-- ═════════════════════ 5 · CİHAZ ÖMÜR İZİ ══════════════════════════════

/**
 * ARACIN İLK/SON TELEMETRİ ANI — ham satırlar silinse de yaşar.
 *
 * NEDEN: haftalık aksiyon kuralı K3 "sessiz araç" ve panodaki "sessiz cihaz"
 * alarmı, aracın SON ham satırının yaşına bakıyor. Uzun süredir susmuş bir
 * aracın tüm satırları silinince `son_kayit` NULL döner ve araç uyarı
 * listesinden SESSİZCE DÜŞER — en çok ilgilenilmesi gereken araç görünmez
 * olur. Tam tersi bir sonuç.
 */
create table if not exists public.vehicle_telemetry_lifetime (
  vehicle_id uuid primary key references public.vehicles(id) on delete cascade,
  ilk_kayit timestamptz,
  son_kayit timestamptz,
  toplam_satir bigint,
  guncellendi_at timestamptz not null default now()
);

comment on table public.vehicle_telemetry_lifetime is
  'Aracın ilk/son telemetri anı (090). Ham satırlar silinince "sessiz araç" uyarısının kaybolmaması için ham akıştan bağımsız tutulur.';

-- ═════════════════════ 6 · AYLIK ÖZET ══════════════════════════════════

/**
 * AYLIK ARAÇ ÖZETİ — ham iz silindikten sonra raporun tek kaynağı.
 *
 * ⚠️ GRANÜLERLİK NEDEN AY: yukarıdaki ÖLÇÜM 2. Günlük özet yakıtı
 * %15,6-28,9 şişiriyor; aylık parçanın sapması %0,0.
 *
 * 🔑 DEĞERLER NASIL ÜRETİLİR: raporun KENDİ motoru ayın tamamı için TEK
 * pencere olarak çağrılır ve çıktısı olduğu gibi yazılır. Özet, raporun
 * kendi cevabının dondurulmuş hâlidir — ikinci bir hesap değil.
 *
 * ⚠️ NE KURTARMAZ — dürüst liste:
 *   · ROTA GEÇMİŞİ. lat/lon burada YOK ve olamaz: bir ayın konum dizisini
 *     saklamak "ham izi sakla" demenin başka yolu olurdu.
 *   · GÜN/SAAT KIRILIMI. Ay içi bir pencere özetten üretilemez.
 *   · VARDİYA EKSENİ. Şoför km'si için ayrı dondurma var (§7).
 *
 * 🔑 Bu tablo `veri_kategorileri`nde 'arac': kişi ekseni ve gün kırılımı
 * olmadığı için kimin nerede olduğunu anlatmaz.
 */
create table if not exists public.vehicle_month_metrics (
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,

  -- Ayın İLK GÜNÜ. check ile zorlanıyor: yanlış granülerlikte satır yazılırsa
  -- tablo sessizce gün-bazlı olur ve ÖLÇÜM 2'deki hata geri gelir.
  ay date not null check (ay = date_trunc('month', ay)::date),

  -- ── km (odometre açıklığı) ────────────────────────────────────────────
  km numeric(12,2),
  odometre_ilk numeric(12,2),
  odometre_son numeric(12,2),

  -- ── yakıt (raporun kendi çıktısı, ayın tamamı tek pencere) ────────────
  litre numeric(12,2),
  yuzde_tuketim numeric(10,2),
  dolum_sayisi integer,
  dolum_yuzde numeric(10,2),
  dusus_sayisi integer,
  dusus_yuzde numeric(10,2),
  l_100km numeric(10,2),

  -- ── güvenilirlik (ölçülemedi ≠ 0 için ŞART) ───────────────────────────
  ornek_sayisi bigint,
  yakit_ornek_sayisi bigint,
  yakit_sifir_okuma bigint,
  ilk_kayit timestamptz,
  son_kayit timestamptz,
  /**
   * ⚠️ ÖLÇÜLEMEDİYSE SEBEBİ. NULL = ölçüldü.
   * 'cihaz_yok' · 'yetersiz_okuma' · 'sensor_arizali' · 'odometre_yok'
   * Bu kolon olmadan özet "0 L" ile "ölçülemedi"yi ayıramaz.
   */
  olculemedi_sebep text,

  hesaplandi_at timestamptz not null default now(),
  hesap_surumu text not null default '090.1',
  /** Bu ayın ham satırları silindi mi? Silinmişse özet YENİDEN ÜRETİLEMEZ. */
  ham_silindi_at timestamptz,

  primary key (vehicle_id, ay)
);

comment on table public.vehicle_month_metrics is
  'Aylık araç özeti (090) — ham iz silindikten sonraki tek kaynak. Granülerlik AY: günlük parçalama yakıtı %15,6-28,9 şişiriyor (ölçüldü), aylık parçanın sapması %0,0.';

comment on column public.vehicle_month_metrics.olculemedi_sebep is
  'NULL = ölçüldü. Dolu = bu araç/ay ölçülemedi ve SEBEBİ bu. "0" ile "bilinmiyor" bu kolonla ayrılır.';

comment on column public.vehicle_month_metrics.ham_silindi_at is
  'Bu ayın ham satırlarının silindiği an. Doluysa özet YENİDEN ÜRETİLEMEZ — üzerine yazılmasın.';

create index if not exists idx_vmm_ay on public.vehicle_month_metrics (ay desc);

-- ═════════════════════ 7 · VARDİYA KM DONDURMA ═════════════════════════

/**
 * VARDİYANIN KM ÖLÇÜM YARGISI — ham silinmeden ÖNCE dondurulur.
 *
 * NEDEN: lib/km-quality.ts iki kapıyla "bu vardiyanın km'si gerçekten 0 mı,
 * yoksa ölçülemedi mi" diye soruyor ve İKİNCİ KAPI ham telemetriye bakıyor
 * (vardiya penceresinde speed_kmh >= 5 okuma var mı). Ham silinince kapı her
 * sıfır-farklı vardiyayı "ölçülemedi"ye çevirir — sessizce, geriye dönük ve
 * KULLANICI SEÇİMLİ aralıktaki Excel/PDF çıktısına kadar.
 *
 * ⚠️ SIRA ŞARTI: bu kolon, silmeden ÖNCE doldurulmalıdır. Sonra doldurulursa
 * ham zaten gitmiş olur ve backfill her satıra sessizce "ölçülemedi" yazar —
 * düzeltmek istediği hatayı kalıcılaştırır. Kod bu sırayı zorluyor: aralıkta
 * dondurulmamış vardiya varsa silme REDDEDİLİR.
 */
alter table public.time_entries
  add column if not exists km_dondu boolean;

alter table public.time_entries
  add column if not exists km_dondu_at timestamptz;

comment on column public.time_entries.km_dondu is
  'Ham silinmeden önce dondurulmuş km ölçüm yargısı (090). true = ölçüldü, false = ölçülemedi, NULL = henüz dondurulmadı.';

-- ═════════════════════ 8 · ZAMAN İNDEKSİ ═══════════════════════════════

/**
 * BRIN — "kaç satırım eşiği geçti" sorusunun ucuz cevabı.
 *
 * ÖLÇÜLDÜ (26.08.2026): `recorded_at` üzerinde ÖNDE GELEN kolonlu indeks yok
 * (var olanlar `(vehicle_id, recorded_at)` ya da kısmi). 1,6 milyon satırda
 * `count(*) where recorded_at < x` ifade zaman aşımına (8 sn) takıldı.
 *
 * BRIN seçildi çünkü `recorded_at` append-only ve fiziksel sırayla neredeyse
 * birebir artıyor — btree'nin onda biri yer kaplar ve aralık taraması için
 * yeterli. Uyarı sayacı ve aralık silme ikisi de bunu kullanır.
 */
create index if not exists idx_device_telemetry_recorded_brin
  on public.device_telemetry using brin (recorded_at);

create index if not exists idx_driver_locations_recorded_brin
  on public.driver_locations using brin (recorded_at);

-- ═════════════════════ 9 · UYARI SAYACI ════════════════════════════════

/**
 * EŞİĞİ GEÇEN SATIR SAYISI — tablo tablo.
 *
 * Gece koşan iş bunu çağırır ve UYARI üretir. HİÇBİR ŞEY SİLMEZ.
 *
 * En eski kayıt da dönüyor: uyarı "kaç satır" demenin yanında "ne kadar
 * eski" de demeli; 1.000 satır 91 günlük ise başka, 400 günlük ise başka bir
 * cümledir.
 */
create or replace function public.saklama_eski_satirlar(p_kesim timestamptz)
returns table (
  tablo_adi text,
  satir_sayisi bigint,
  en_eski timestamptz
)
language sql
stable
as $$
  select 'device_telemetry'::text, count(*), min(recorded_at)
  from public.device_telemetry where recorded_at < p_kesim
  union all
  select 'driver_locations'::text, count(*), min(recorded_at)
  from public.driver_locations where recorded_at < p_kesim
$$;

-- ═════════════════════ 10 · ARALIK SİLME ═══════════════════════════════

/**
 * 🔴 ARALIK ALIR, GÜN SAYISI ALMAZ — VE BU BİLİNÇLİ.
 *
 * "Şu kadar günden eskiyi sil" imzası, çağıranın takvimine göre çalışan bir
 * otomatik temizliği DAVET EDER. Bu üründe silme kararı veri sorumlusunun
 * ve her silme bir İNSAN SEÇİMİDİR: hangi hafta, hangi ay, hangi iki tarih
 * arası. Fonksiyon o seçimi birebir uygular, kendi başına bir "eski" tanımı
 * üretmez.
 *
 * ⚠️ Ön koşullar (özet yazıldı mı, km donduruldu mu, kategori silinebilir mi,
 * çift onay verildi mi) UYGULAMA katmanında (lib/saklama-db.ts). Burada
 * zorlanmıyor çünkü SQL katmanı "kim onayladı"yı bilemez; iki yerde iki
 * yarım kapı olmasındansa tek yerde tam kapı olsun.
 *
 * ctid ile parça silme: tek `delete` 1,6 milyon satırda ifade zaman aşımı
 * yer ve HİÇBİR ŞEY silinmez (054'ün dersi).
 */
create or replace function public.purge_telemetry_range(
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 20000
)
returns bigint
language plpgsql
volatile
as $$
declare
  v_deleted bigint;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'gecersiz_aralik: p_from=% p_to=%', p_from, p_to;
  end if;

  with victims as (
    select ctid
    from public.device_telemetry
    where recorded_at >= p_from
      and recorded_at <  p_to
    order by recorded_at
    limit greatest(coalesce(p_limit, 20000), 1)
  )
  delete from public.device_telemetry dt
  using victims v
  where dt.ctid = v.ctid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

/**
 * driver_locations ikizi.
 *
 * ⚠️ ŞEMA CANLIDA DOĞRULANDI (26.08.2026): zaman kolonu `recorded_at`
 * (`created_at` bu tabloda YOK). Yine de AYRI fonksiyon: tek fonksiyona
 * tablo adı parametresi geçirmek (dinamik SQL) silme yüzeyini genişletirdi
 * ve "hangi tablo silinecek" kararını çağırana bırakırdı.
 *
 * Bugünkü hacim ihmal edilebilir (~81 satır) — fonksiyon miktar için değil,
 * POLİTİKA BÜTÜNLÜĞÜ için var: konum verisi hangi tabloda durursa dursun
 * aynı kategoridedir.
 */
create or replace function public.purge_driver_locations_range(
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 20000
)
returns bigint
language plpgsql
volatile
as $$
declare
  v_deleted bigint;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'gecersiz_aralik: p_from=% p_to=%', p_from, p_to;
  end if;

  with victims as (
    select ctid
    from public.driver_locations
    where recorded_at >= p_from
      and recorded_at <  p_to
    order by recorded_at
    limit greatest(coalesce(p_limit, 20000), 1)
  )
  delete from public.driver_locations dl
  using victims v
  where dl.ctid = v.ctid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ═════════════════════ 11 · ÖZET YARDIMCILARI ══════════════════════════

/**
 * AYLIK UÇ DEĞERLER — özet üretiminin SQL ayağı.
 *
 * Yakıt/tüketim raporun kendi motorundan alınıyor (uygulama katmanı); burada
 * YALNIZ odometre açıklığı ve sayım/uç bilgileri var, çünkü bunlar saf
 * SQL'de doğru ve ucuz. İkisini karıştırmamak bilinçli.
 */
create or replace function public.telemetry_month_spans(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  vehicle_id uuid,
  ay date,
  ornek_sayisi bigint,
  ilk_kayit timestamptz,
  son_kayit timestamptz,
  odometre_ilk numeric,
  odometre_son numeric,
  yakit_ornek_sayisi bigint,
  yakit_sifir_okuma bigint
)
language sql
stable
as $$
  select
    dt.vehicle_id,
    date_trunc('month', dt.recorded_at)::date as ay,
    count(*)                                   as ornek_sayisi,
    min(dt.recorded_at)                        as ilk_kayit,
    max(dt.recorded_at)                        as son_kayit,
    min(dt.odometer_km) filter (where dt.odometer_km is not null)::numeric as odometre_ilk,
    max(dt.odometer_km) filter (where dt.odometer_km is not null)::numeric as odometre_son,
    count(*) filter (where dt.fuel_level_pct is not null)                  as yakit_ornek_sayisi,
    count(*) filter (where dt.fuel_level_pct = 0)                          as yakit_sifir_okuma
  from public.device_telemetry dt
  where dt.recorded_at >= p_from
    and dt.recorded_at <  p_to
  group by 1, 2
$$;

/**
 * CİHAZ ÖMÜR İZİNİ TAZELE — silmeden ÖNCE çağrılır.
 *
 * `greatest`/`least` ile birleştirme: ham kısmen silinmiş olsa bile daha eski
 * bir `ilk_kayit` KAYBEDİLMEZ, daha yeni bir `son_kayit` GERİ GİTMEZ. Yani
 * fonksiyon defalarca çalıştırılabilir ve her koşuda doğrudur.
 */
create or replace function public.refresh_telemetry_lifetime()
returns bigint
language plpgsql
volatile
as $$
declare
  v_rows bigint;
begin
  insert into public.vehicle_telemetry_lifetime (vehicle_id, ilk_kayit, son_kayit, toplam_satir, guncellendi_at)
  select dt.vehicle_id, min(dt.recorded_at), max(dt.recorded_at), count(*), now()
  from public.device_telemetry dt
  group by dt.vehicle_id
  on conflict (vehicle_id) do update set
    ilk_kayit      = least(public.vehicle_telemetry_lifetime.ilk_kayit, excluded.ilk_kayit),
    son_kayit      = greatest(public.vehicle_telemetry_lifetime.son_kayit, excluded.son_kayit),
    toplam_satir   = excluded.toplam_satir,
    guncellendi_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorguları):
--
--   select * from public.tenant_saklama;
--   → 1 satır: singleton · uyari_gun=90 · ulke_kodu='AT' · gerekce=null
--     ⚠️ `silme_acik` diye bir kolon YOK — otomatik silme YOK.
--
--   select count(*) from public.saklama_esikleri;
--   → 0        ⚠️ BİLEREK BOŞ. Yasal eşikler ayrı araştırma turuyla gelecek.
--
--   select kategori, count(*) from public.veri_kategorileri group by 1;
--   → arac 3 · kisisel 4 · yasal_zorunlu 5
--
--   select count(*) from public.saklama_silme_izi;
--   → 0        (elle silme yapılmadı)
--
--   select proname from pg_proc where proname in
--     ('purge_telemetry_range','purge_driver_locations_range',
--      'saklama_eski_satirlar','telemetry_month_spans',
--      'refresh_telemetry_lifetime');
--   → 5 satır
--     ⚠️ `purge_old_telemetry` LİSTEDE YOK ve olmamalı — o 054'ün
--        (galzura-demo) fonksiyonu, bu migration ona DOKUNMAZ.
--
-- MEVCUT VERİYE ETKİSİ: **SIFIR SATIR SİLİNİR.** Bu migration tablo, indeks
-- ve fonksiyon kurar. Silen tek yol /admin/saklama ekranıdır ve her çağrı
-- saklama_silme_izi'ne yazılır.
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  091_takograf.sql                                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- HAK61 / Galzura Fleet — Migration 091 (TAKOGRAF: .ddd ARŞİVİ VE HAM VERİ)
-- =====================================================================
-- Additive + idempotent. Supabase SQL Editor'da çalıştırın.
-- ⚠️ 090 (saklama politikası) ÖNCE çalıştırılmış olmalı — bu migration
--    `veri_kategorileri` tablosuna satır ekliyor.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÜRÜNÜN SATIŞ VAADİ: DOSYA ARŞİVİ
-- ═══════════════════════════════════════════════════════════════════════
--
-- Müşteri bugün .ddd dosyalarını kendi bilgisayarında bir klasörde tutuyor.
-- Bu ürün o işi devralıyor: dosya Supabase Storage'da KALICI durur, denetimde
-- oradan indirilir, indirilen bayt bayt ORİJİNALDİR.
--
-- Bunun şemadaki üç karşılığı:
--   1. Dosya satırı DEĞİŞMEZ (HK091 tetikleyicisi, 080 deseni)
--   2. `depo_yolu` ve `sha256` UPDATE ile DEĞİŞTİRİLEMEZ
--   3. Ayrıştırma başarısız olsa bile satır ve dosya DURUR —
--      `ayristirma_durumu='basarisiz'` yazılır, kayıt silinmez
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜMLER (kaynak: docs/TAKOGRAF-OLCUM.md, docs/TAKOGRAF-SERVIS.md)
-- ═══════════════════════════════════════════════════════════════════════
--
--   Gerçek dosya boyutları  : kart 10,4-34,9 KB · araç ünitesi 96-155 KB
--   Ayrıştırma (saf)        : 0,5-5,5 ms
--   Uçtan uca (HTTP, sunucu): kart 53-62 ms · VU 121-144 ms
--   → SENKRON ayrıştırma. Kuyruk gereksiz.
--
--   Bir VU dosyası 3.430 faaliyet satırı üretiyor (365 günlükte ≈13.000).
--   ⚠️ Satır yazım süresi HENÜZ ÖLÇÜLMEDİ; `ayristirma_durumu` kolonu bu
--   yüzden şemada duruyor — ölçüm ters çıkarsa asenkrona geçiş bir kod
--   değişikliği olur, migration değil.
--
--   DETAILED_SPEED bloğu ayrıştırılmıyor: dosyanın %93,5'i ama ayrıştırma
--   SÜRESİNE katkısı yok; kazanç JSON yükünde (2,15 MB → 131 KB).
--   ⚠️ Dosya yine de TAM saklanıyor — atlanan yalnız ayrıştırma.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================
-- [birleştirici] kaldırıldı: begin;  (dosyanın tamamı tek transaction içinde)
-- ═════════════════════ 1 · DOSYA KÜNYESİ ═══════════════════════════════

create table if not exists public.takograf_dosyalari (
  id uuid primary key default gen_random_uuid(),

  /**
   * DOSYA TÜRÜ.
   *   'kart' — sürücü kartı (son 28 gün, şoförün kendi verisi)
   *   'vu'   — araç ünitesi (son 365 gün, o araçta kimin sürdüğü)
   *
   * ⚠️ İKİSİ AYNI TABLODA, bilinçli: ikisi de aynı soruyu cevaplıyor —
   * "kim, ne zaman, ne yaptı". Ayrı tablo her ekranı ve her sorguyu ikiye
   * katlardı. Fark bu kolonda ve dolu olan alanlarda görünür.
   */
  tur text not null check (tur in ('kart', 'vu')),

  -- ── ARŞİV (satış vaadinin kendisi) ────────────────────────────────────
  depo_yolu text not null,
  dosya_adi text not null,
  bayt integer not null check (bayt > 0),

  /**
   * 🔑 AYNI DOSYA İKİ KEZ YÜKLENEMEZ.
   *
   * İkinci yükleme reddedilir ve ekran "bu dosya {tarih}'te {kişi}
   * tarafından zaten yüklendi" der. Sessizce kabul etmek faaliyet
   * satırlarını ikiye katlar ve her raporu bozar.
   */
  sha256 text not null unique check (length(sha256) = 64),

  nesil text check (nesil in ('GEN1', 'GEN2', 'GEN2_V2', 'KARMA', 'BILINMIYOR')),

  -- ── DOĞRULAMA (mühür) ─────────────────────────────────────────────────
  /**
   * ⚠️ ÜÇ DEĞER, ÜÇÜ DE FARKLI ŞEY:
   *   'dogrulandi'     — denendi, TUTTU
   *   'dogrulanamadi'  — denendi, TUTMADI ya da sertifika bulunamadı
   *   'denenmedi'      — hiç denenmedi (servis erişilemedi vb.)
   *
   * "Doğrulanamadı" ile "doğrulanmadı" AYNI ŞEY DEĞİLDİR; ekran da bu
   * ayrımı korur. Varsayılan 'denenmedi': henüz bir şey söylemedik.
   *
   * ⚠️ ÖLÇÜLDÜ (26.08.2026): kütüphane doğrulamayı bir DURUM olarak
   * döndürmüyor, HATA fırlatıyor. Servis o hatayı yakalayıp bu üç değerden
   * birine çeviriyor ve metnini `muhur_sebep`e yazıyor.
   */
  muhur_durumu text not null default 'denenmedi'
    check (muhur_durumu in ('dogrulandi', 'dogrulanamadi', 'denenmedi')),
  muhur_sebep text,

  -- ── AYRIŞTIRMA ────────────────────────────────────────────────────────
  /**
   * 🔴 'basarisiz' DOSYANIN SİLİNECEĞİ ANLAMINA GELMEZ.
   *
   * Dosya kanunen saklanması gereken belgenin kendisidir; bizim
   * ayrıştırıcımızın onu okuyamaması, müşterinin yasal kaydını yok etmek
   * için sebep değildir. `ayristirici_surum` saklandığı için ayrıştırıcı
   * güncellenince YENİDEN DENENEBİLİR.
   *
   * 'bekliyor' — servis erişilemedi, sonra denenecek
   */
  ayristirma_durumu text not null default 'bekliyor'
    check (ayristirma_durumu in ('bekliyor', 'tamam', 'basarisiz')),
  ayristirma_hata text,
  ayristirici_surum text,

  -- ── KÜNYE (ayrıştırmadan gelir; çözülemezse NULL) ─────────────────────
  kart_no text,
  arac_vin text,
  arac_plaka text,

  /**
   * TÜRETİLMİŞ BAĞ — çözülebilirse.
   *
   * ⚠️ NULL bir hata değil: yüklenen dosya sistemde kayıtlı olmayan bir
   * şoföre/araca ait olabilir (yeni işe giren, satılan araç). Ekran o zaman
   * ham kart numarasını / VIN'i gösterir, uydurma bir eşleşme yapmaz.
   */
  worker_id uuid references public.workers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,

  donem_bas timestamptz,
  donem_bit timestamptz,

  -- ── İZ ────────────────────────────────────────────────────────────────
  yukleyen_worker_id uuid references public.workers(id) on delete set null,
  yuklendi_at timestamptz not null default now(),
  guncellendi_at timestamptz not null default now()
);

comment on table public.takograf_dosyalari is
  'Takograf .ddd arşivi (091). Dosya Storage''da KALICI durur; ayrıştırılamasa bile SİLİNMEZ. Satır DEĞİŞMEZ (HK091): depo_yolu, sha256, bayt, tur, yuklendi_at güncellenemez.';
comment on column public.takograf_dosyalari.sha256 is
  'Dosyanın SHA-256''sı. UNIQUE: aynı dosya iki kez yüklenemez, ikincisi reddedilir.';
comment on column public.takograf_dosyalari.muhur_durumu is
  'dogrulandi | dogrulanamadi | denenmedi. "Doğrulanamadı" (denendi, tutmadı) ile "denenmedi" AYNI ŞEY DEĞİLDİR.';
comment on column public.takograf_dosyalari.ayristirma_durumu is
  'bekliyor | tamam | basarisiz. "basarisiz" dosyanın silineceği anlamına GELMEZ — dosya durur, ayrıştırıcı güncellenince yeniden denenir.';

create index if not exists idx_takograf_dosya_zaman
  on public.takograf_dosyalari (yuklendi_at desc);
create index if not exists idx_takograf_dosya_donem
  on public.takograf_dosyalari (donem_bas, donem_bit);
create index if not exists idx_takograf_dosya_worker
  on public.takograf_dosyalari (worker_id) where worker_id is not null;
create index if not exists idx_takograf_dosya_vehicle
  on public.takograf_dosyalari (vehicle_id) where vehicle_id is not null;

-- ═════════════════════ 2 · DEĞİŞMEZLİK (HK091) ═════════════════════════

/**
 * 080'deki `teslimat_degismez` deseninin aynısı.
 *
 * Sonradan düzenlenebilen bir kayıt delil değildir. Arşivin değeri, içindeki
 * dosyanın yüklendiği gibi durduğuna güvenilebilmesinden gelir.
 *
 * DEĞİŞTİRİLEBİLEN alanlar (ayrıştırma sonradan tamamlanabilir / yeniden
 * denenebilir, eşleşme elle düzeltilebilir):
 *   muhur_*, ayristirma_*, kart_no, arac_*, worker_id, vehicle_id,
 *   donem_*, nesil, guncellendi_at
 *
 * DOKUNULAMAYAN alanlar: id, tur, depo_yolu, dosya_adi, bayt, sha256,
 *   yukleyen_worker_id, yuklendi_at
 */
create or replace function public.takograf_dosya_degismez()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.tur is distinct from old.tur
     or new.depo_yolu is distinct from old.depo_yolu
     or new.dosya_adi is distinct from old.dosya_adi
     or new.bayt is distinct from old.bayt
     or new.sha256 is distinct from old.sha256
     or new.yukleyen_worker_id is distinct from old.yukleyen_worker_id
     or new.yuklendi_at is distinct from old.yuklendi_at
  then
    raise exception
      'takograf dosya kimligi degistirilemez (091): arsivin degeri dosyanin yuklendigi gibi durmasindan gelir'
      using errcode = 'HK091';
  end if;
  new.guncellendi_at := now();
  return new;
end;
$$;

drop trigger if exists trg_takograf_dosya_degismez on public.takograf_dosyalari;
create trigger trg_takograf_dosya_degismez
  before update on public.takograf_dosyalari
  for each row execute function public.takograf_dosya_degismez();

/**
 * SİLME ENGELİ.
 *
 * Arşiv sözü "dosya durur" demek. Satırı silmek dosyayı yetim bırakır ve
 * müşterinin denetimde indireceği kaydı yok eder.
 *
 * ⚠️ 090'ın elle silme aracı bu tabloya HİÇ GELMEZ: `veri_kategorileri`nde
 * 'yasal_zorunlu' olduğu için silme seçicisinde <option> olarak
 * üretilmiyor. Bu tetikleyici SON savunma.
 */
create or replace function public.takograf_dosya_silinemez()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'takograf dosyasi silinemez (091): arsiv urunun satis vaadi; denetimde bu kayittan indirilecek'
    using errcode = 'HK091';
end;
$$;

drop trigger if exists trg_takograf_dosya_silinemez on public.takograf_dosyalari;
create trigger trg_takograf_dosya_silinemez
  before delete on public.takograf_dosyalari
  for each row execute function public.takograf_dosya_silinemez();

-- ═════════════════════ 3 · HAM FAALİYET SATIRLARI ══════════════════════

create table if not exists public.takograf_faaliyetleri (
  id uuid primary key default gen_random_uuid(),

  /**
   * ⚠️ CASCADE ama dosya zaten SİLİNEMİYOR (§2). Cascade yalnız
   * "yeniden ayrıştır" akışında satırları temizlemek için: önce faaliyetler
   * silinir, sonra yenileri yazılır. Dosya satırı yerinde kalır.
   */
  dosya_id uuid not null references public.takograf_dosyalari(id) on delete cascade,

  kart_no text,
  worker_id uuid references public.workers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,

  gun date,
  baslangic timestamptz,
  bitis timestamptz,
  sure_dk integer check (sure_dk is null or sure_dk >= 0),

  /**
   * AB 561/2006'nın dört faaliyeti. Kod değeri ÇEVRİLMEZ; ekran çevirir.
   *   surus — Lenkzeit / Driving
   *   is    — Andere Arbeiten / Other work
   *   hazir — Bereitschaft / Availability
   *   mola  — Ruhezeit / Rest
   */
  faaliyet text check (faaliyet in ('surus', 'is', 'hazir', 'mola', 'bilinmiyor')),
  slot text check (slot is null or slot in ('surucu', 'yardimci')),
  kaynak_nesil text,

  /** Dosya içindeki sıra — satır numarası oluğu ve kararlı sıralama için. */
  sira integer not null default 0
);

comment on table public.takograf_faaliyetleri is
  'Takograf ham faaliyet satırları (091). Her satır KAYNAK DOSYASINI taşır (dosya_id): çakışan dönemler BİRLEŞTİRİLMEZ, kart ve araç ünitesi aynı olayı iki yandan anlatır ve bu bir çapraz doğrulama fırsatıdır.';

create index if not exists idx_takograf_faaliyet_dosya
  on public.takograf_faaliyetleri (dosya_id, sira);
create index if not exists idx_takograf_faaliyet_zaman
  on public.takograf_faaliyetleri (baslangic);
create index if not exists idx_takograf_faaliyet_worker
  on public.takograf_faaliyetleri (worker_id, gun) where worker_id is not null;

-- ═════════════════════ 4 · OLAY VE ARIZALAR ════════════════════════════

/**
 * Olayın süresi ve öznesi faaliyetten FARKLI; tek tabloya sıkıştırmak
 * 085'te müşteriyi araç/şoför eksenine sıkıştırma hatasının aynısı olurdu.
 */
create table if not exists public.takograf_olaylari (
  id uuid primary key default gen_random_uuid(),
  dosya_id uuid not null references public.takograf_dosyalari(id) on delete cascade,
  tur text,
  bas timestamptz,
  bit timestamptz,
  ciddiyet text,
  arac_plaka text,
  sira integer not null default 0
);

comment on table public.takograf_olaylari is
  'Takograf olay ve arıza kayıtları (091): kart çıkarma, güç kesintisi, hız aşımı. Manipülasyon denetiminin baktığı yer.';

create index if not exists idx_takograf_olay_dosya
  on public.takograf_olaylari (dosya_id, sira);

-- ═════════════════════ 5 · VERİ KATEGORİLERİ (090) ═════════════════════

/**
 * ⚠️ ÜÇÜ DE 'yasal_zorunlu' → 090'ın elle silme ekranı bu tablolar için
 * silme seçeneğini RENDER ETMEZ. Reddetmek bir hatadır ve hata mesajı
 * okunmayabilir; göstermemek bir tasarımdır.
 *
 * ⚠️ 090'ın ZAMAN KÖRLÜĞÜ bu fazda ÇÖZÜLMÜYOR (Volkan kararı):
 * 'yasal_zorunlu' bugün "hiç silinmez" demek; takograf ise "AT'de 24 ay,
 * DE'de 1 yıl silinemez — SONRA silinmelidir" ve Almanya'da silme bir
 * ZORUNLULUKTUR (izleyen yılın 31 Mart'ı). Model bunu henüz ifade edemiyor.
 * Not düşülmüştür; çözüm ayrı bir turun işi.
 */
insert into public.veri_kategorileri (tablo_adi, kolon_adi, kategori, gerekce) values
  ('takograf_dosyalari', null, 'yasal_zorunlu',
   'Takograf indirmesi kanunla emredilen kayittir (AT § 17b AZG 24 ay, DE 1 yil, AB tabani 165/2014 Md. 33(2)). Mufettisin okudugu birincil belge ve urunun arsiv vaadi: dosya silinmez, denetimde buradan indirilir.'),
  ('takograf_faaliyetleri', null, 'yasal_zorunlu',
   'Dosyadan turetilmis ama ayni hukuki kaydin icerigi: kim, ne zaman, ne kadar surdu. Surucunun kisisel verisi olmakla birlikte saklanmasi emredilmistir.'),
  ('takograf_olaylari', null, 'yasal_zorunlu',
   'Kart cikarma, guc kesintisi ve hiz asimi kayitlari manipulasyon denetiminin konusudur; silinebilir olmasi denetimi anlamsiz kilar.')
on conflict (tablo_adi, coalesce(kolon_adi, '*')) do nothing;

-- ═════════════════════ 6 · STORAGE KOVASI ══════════════════════════════

/**
 * Diğer altı kovayla AYNI desen: özel, 5 MB.
 *
 * ⚠️ 5 MB cömert: ÖLÇÜLEN en büyük gerçek dosya 155 KB (araç ünitesi,
 * Gen2v2, 100 blok). 33 kat pay bırakıyor.
 *
 * ⚠️ `.ddd`'nin tescilli bir MIME türü YOK; `application/octet-stream`
 * kullanılıyor. Tarayıcı bazı sistemlerde boş tür gönderebildiği için
 * boş dize de kabul ediliyor — gerçek denetim uzantı + boyut + servisin
 * "okuyamadım" cevabı.
 *
 * ⚠️ Bu satır Supabase'e özgüdür (storage şeması). Düz PostgreSQL'de
 * `storage.buckets` yoktur; kurulum dosyası bunu zaten böyle taşıyor.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'takograf', 'takograf', false, 5242880,
  array['application/octet-stream', 'application/x-tachograph', '']
)
on conflict (id) do nothing;
-- [birleştirici] kaldırıldı: commit;  (dosyanın tamamı tek transaction içinde)
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (ayrı çalıştırın):
--
--   select count(*) from public.takograf_dosyalari;      → 0
--   select count(*) from public.takograf_faaliyetleri;   → 0
--   select count(*) from public.takograf_olaylari;       → 0
--
--   select kategori, count(*) from public.veri_kategorileri group by kategori;
--   → arac 3 · kisisel 4 · yasal_zorunlu 8   (090'daki 5 + bu migration'daki 3)
--
--   select id, public, file_size_limit from storage.buckets where id='takograf';
--   → takograf | false | 5242880
--
--   select tgname from pg_trigger where tgrelid='public.takograf_dosyalari'::regclass;
--   → trg_takograf_dosya_degismez · trg_takograf_dosya_silinemez
--
-- MEVCUT VERİYE ETKİSİ: SIFIR. Yalnız yeni tablo/indeks/tetikleyici/kova
-- kurulur; hiçbir mevcut satır okunmaz ya da değiştirilmez.
-- =====================================================================


-- ═══════════════════════════════════════════════════════════════════════════
--  BİTTİ — şema 078 hizasında.
-- ═══════════════════════════════════════════════════════════════════════════
-- PostgREST şema önbelleğini tazele: yeni tablolar API''de hemen görünsün.
notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  DOĞRULAMA (commit''ten SONRA, ayrı çalıştırın)
-- ═══════════════════════════════════════════════════════════════════════════
-- select count(*) from information_schema.tables
--  where table_schema='public' and table_type='BASE TABLE';
-- select code from public.fleets order by sort_order;      -- bordo, mavi
-- select count(*) from public.messages;                    -- 0
-- select count(*) from public.worker_documents;            -- 0
-- select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and proname like '%_batch' order by 1;   -- 5 satır
--
-- ═══════════════════════════════════════════════════════════════════════════
--  BU DOSYANIN YAPMADIĞI İKİ ŞEY — bilinçli, ayrı karar gerektirir
-- ═══════════════════════════════════════════════════════════════════════════
--
--  1) TELEGRAM KALINTISI DÜŞÜRÜLMEDİ.
--     Katman 20.08.2026''da söküldü; kodda tek satır yok. Bu kurulumda
--     `telegram_link_codes` tablosu ve `workers.telegram_*` dört kolonu
--     hâlâ duruyor (canlı HAK61''de düşürüldü). Uygulama onları hiç okumuyor,
--     yani zararsızlar — ama biri (telegram_username) kişisel veridir.
--     Silmek İSTERSENİZ, ayrı ve bilinçli bir adım olarak:
--
--       begin;
--       drop table if exists public.telegram_link_codes;
--       alter table public.workers
--         drop column if exists telegram_chat_id,
--         drop column if exists telegram_username,
--         drop column if exists telegram_linked_at,
--         drop column if exists telegram_locale;
--       commit;
--
--     ⚠️ GERİ ALINAMAZ. Önce `select count(*) from public.workers
--        where telegram_chat_id is not null;` ile ne kaybedeceğinizi görün.
--
--  2) TELEFON NUMARASI NORMALİZASYONU (075) YAPILMADI.
--     075, "+430660…" biçimindeki numaralardan ulusal trunk sıfırını atar
--     ("+43660…"). Bu bir ŞEMA değişikliği değil, VERİ değişikliğidir ve
--     `workers.phone` UNIQUE olduğu için çakışma üretebilir. Kod her iki
--     biçimi de tanıyor (lib/phone.ts phoneVariants), yani giriş bozulmuyor.
--     Uygulamak isterseniz db/migrations/075_phone_trunk_zero.sql''i AYRI
--     çalıştırın: içindeki DO bloğu çakışma varsa kendini durdurur.
