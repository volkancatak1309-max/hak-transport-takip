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

begin;

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

commit;

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
