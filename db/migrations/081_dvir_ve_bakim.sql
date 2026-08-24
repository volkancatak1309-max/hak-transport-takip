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

begin;

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

commit;

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
