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

begin;

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

commit;

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
