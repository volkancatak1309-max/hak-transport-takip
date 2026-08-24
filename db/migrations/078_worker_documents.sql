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

begin;

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

commit;

-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select count(*) from public.document_types;      → 0 beklenir
-- select count(*) from public.worker_documents;    → 0 beklenir
--
-- Kiracı ilk türünü panelden açar (/admin/workers → Belge Türleri).
-- Örnek bir tür ELLE eklemek isterseniz:
--   insert into public.document_types (code, label, warn_days, requires_number)
--   values ('src', 'SRC Belgesi', 30, true);
