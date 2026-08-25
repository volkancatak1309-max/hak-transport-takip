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

begin;

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

commit;

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
