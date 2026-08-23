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

begin;

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

commit;

-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select * from public.tenant_cost_rates;
--   → 0 satır beklenir: tablo yaratıldı ama kiracı henüz oran girmedi,
--     yani üç oran da VARSAYILAN etiketiyle görünür. Panel ilk kaydetmede
--     satırı kendisi oluşturur (upsert).
