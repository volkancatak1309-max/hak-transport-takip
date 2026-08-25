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

begin;

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

commit;

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
