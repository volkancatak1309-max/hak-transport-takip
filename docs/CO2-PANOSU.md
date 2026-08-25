# CO₂ panosu

**Migration 089 · `/admin/co2` · `lib/co2.ts` + `lib/co2-db.ts`**

AB'de büyük müşteriler tedarikçiden CO₂ raporu istiyor; küçük filo
sağlayamayınca ihaleyi kaybediyor. Bu bir **satış** meselesi.

> Bu belge ölçümlerin kaydıdır. Sayılar 25.08.2026'da HAK61 canlı verisinde
> ölçüldü.

---

## 1 · Bugün ne kırıktı (ÖLÇÜLDÜ)

| Sorun | Ölçüm |
|---|---|
| **Girdi boş** | `fuel_entries` **1 satır**, onaylı **0** → rapor bugün açılsa **0 kg** basardı |
| **Erişilemez** | `/admin/yakit` sayfası `FUEL_ENABLED` tanımsızken `/admin`e yönlendiriyor; CO₂ butonu oraya gömülü |
| **Pano yok** | Tek çıktı PDF indirmesi |
| **Gerçek veri başka yerde** | Telemetri 30 günde **2.584,7 L** ölçüyor · 29 araçtan **23'ü** · filo 11,57 L/100km |

**Kararlar:** CO₂ girdisi telemetri litresi oldu · pano kendi sayfasında ve
**bayraksız** · ölçülemeyen 6 araç (`DO-505GS · DO-506GS · DO-753GS ·
DO-775GS · DO-776GS · DO-945HL`) **"ölçülemedi"** diyor, 0 kg demiyor.

---

## 2 · 🔴 Katsayı etiketi yanlıştı

`lib/co2.ts` yorumu *"EU well-to-tank tailpipe convention"* diyordu. Cümle
kendi içinde çelişkili ve etiket yanlış:

| Kısaltma | Ne |
|---|---|
| **TTW** (tank-to-wheel) | egzozdan çıkan · doğrudan yanma · Scope 1 |
| **WTT** (well-to-tank) | yakıtın çıkarılması, rafinesi, dağıtımı · yukarı akış |
| **WTW** (well-to-wheel) | WTT + TTW · lojistik raporlamasının istediği |

**2,64 kg CO₂/L bir TTW katsayısıdır.** "Well-to-tank" diye etiketlemek
denetimde ters teper: müşteri WTW beklerken TTW alır ve rakam **%23,1** düşük
görünür (canlı ölçüm: 6.824 kg → 8.400 kg).

**Sayılar DEĞİŞMEDİ, etiket düzeltildi** ve WTT companion katsayıları eklendi
(dizel 0,61 · benzin 0,58 · LPG 0,24 kg CO₂e/L mertebesi).

---

## 3 · Hangi standart

**GLEC Framework**, **ISO 14083:2023** olarak uluslararası standart hâline
getirildi; **CDP, SBTi ve CSRD/ESRS E1** bu standarda atıf yapıyor. Lojistik
raporlamasında istenen büyüklük **WTW**'dir (WTT + TTW).

Kaynaklar: [Smart Freight Centre — GLEC FAQ](https://www.smartfreightcentre.org/en/our-programs/emissions-accounting/global-logistics-emissions-council/glec-faq/) ·
[GLEC Framework / ISO 14083 özeti](https://greencalculus.com/standards/glec-framework-logistics-emissions/) ·
[DEFRA/DESNZ dönüşüm katsayıları](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026)

**KARAR: ürün her iki esası da üretir ve hangisi olduğunu HER çıktıda yazar.**
Varsayılan **TTW** — bugünkü sayıların devamı.

### ⚠️ Standart değişimi geriye dönük kıyası nasıl yönetiliyor

1. **Esas tek yerde durur** (`tenant_co2.esas`), kiracı ayarıdır.
2. **Her çıktı esası ve katsayı kümesi sürümünü taşır** (`2026.1`); PDF'in
   kapağına ve metodoloji bölümüne basılır.
3. **CO₂ hiçbir yerde SAKLANMIYOR** — her istekte litreden türetiliyor. Esas
   değiştiğinde geçmiş dönemler de yeni esasla hesaplanır, yani *"eski rapor
   bir esasta, yeni rapor başka esasta"* durumu **oluşmaz**; ekranın tamamı tek
   cetvelle konuşur. QA'da ölçüldü: esas TTW→WTW yapılınca aylık serinin
   geçmiş ayı da 712,8 → 877,5 kg oldu.
4. Elde basılmış bir PDF varsa **üstünde esas yazılıdır** ve hangi cetvelle
   üretildiği belgeden okunur.

> Bu, 088'deki kalibrasyon sorununun **tersi**: orada ham veri değişmişti ve
> yeniden hesap düzeltmiyordu; burada değişen yalnız çarpan, veri aynı.

---

## 4 · `vehicles.fuel_type` yoktu

**CANLI:** `select fuel_type from vehicles` → **42703 (kolon yok)**.
`fuel_type` yalnız `fuel_expenses` (şoför fişi) üzerindeydi. Yani her araç
dizel sayılıyordu ve **elektrikli bir araç dizel katsayısıyla çarpılırdı**.

089 kolonu araca ekliyor. Varsayılan `'diesel'` — kolon yokken bugünkü davranış
buydu, yani migration **hiçbir sayıyı değiştirmez**.

---

## 5 · Elektrikli araçta CO₂

| Esas | Değer | Neden |
|---|---|---|
| **TTW** | **0 kg** — ve bu bir **ölçüm** | Egzoz yok. Doğru. |
| **WTW** | **`null` — "ölçülemedi"** | Şebekeden gelen elektrik üretilirken CO₂ çıkıyor; yoğunluk ülkeye göre değişir |

Veri kaynağı var: **EEA — "Greenhouse gas emission intensity of electricity
generation"** (ülke bazlı gCO₂e/kWh, UNFCCC + Eurostat kaynaklı,
[EEA göstergesi](https://www.eea.europa.eu/en/analysis/indicators/greenhouse-gas-emission-intensity-of-1)).
Otomatik çekim **yok** → kiracı girer (`tenant_co2.sebeke_g_kwh`, kaynak ve
yıl alanlarıyla birlikte).

⚠️ **Girilmediği sürece 0 yazılmaz.** Bilmediğimiz sayıyı 0 yazmak elektrikli
filoyu sıfır emisyonlu göstermek olurdu ve bu ihalede **yanlış beyandır**.

---

## 6 · Müşteri kırılımı — ihale formatı

Bu, segmentteki boşluğun kendisi: büyük oyuncularda sürdürülebilirlik modülü
var ama **müşteri bazlı ihale formatı** yok.

```
müşterinin CO₂'si = Σ (seferin ÖLÇÜLEN km'si × aracın ÖLÇÜLEN g/km'si)
```

⚠️ **Bu bir PAYLAŞTIRMA değil ÖLÇÜMDÜR.** Sefer km'si odometre penceresinden
ölçülüyor (085) ve aracın g/km'si telemetri litresinden. İkisi de ölçüm;
çarpımları da öyle. **Km'si ölçülemeyen sefer toplama girmez ve ayrıca
sayılır.**

QA ölçümü: `Alpen Markt 3 sefer · 270 km · 48,4 kg` · `Nord Logistik 1 sefer ·
ölçülemedi · 1 sefer ölçüm dışı`.

### ⚠️ Şoför kırılımı filo toplamına birebir eşit olmayabilir

İki farklı km kaynağı: filo km'si aracın **odometre açıklığından**, şoför
km'si **vardiya sayaç farklarından**. QA'da ölçüldü: 3.980 km vs 4.000 km →
**%0,5 fark**. İkisi de doğru — araç vardiya dışında da hareket eder.
**Dışarıya verilen beyan filo ve müşteri satırıdır**; şoför kırılımı iç
kullanım içindir ve ekran bunu söyler.

---

## 7 · i18n kusuru

`messages/tr.json → co2.report_title` **Almanca** yazılmıştı
(`"CO₂-Emissionsbericht"`). i18n muhafızı **anahtar paritesine** bakıyor,
değerin diline değil — bu yüzden yakalamıyordu. Düzeltildi
(`"CO₂ Emisyon Raporu"`) ve blok üç dilde yeniden yazıldı.

---

## 8 · PDF

Üç dil (`tr` · `de` · `en`), üç sayfa. **Sayı biçimi de dile uyar** —
Almanca biçimli bir sayıyı İngilizce belgede basmak `2.584 L`'yi `2,584 L`
gibi okutur, bin kat hata.

**Metodoloji sayfası zorunlu** ve şunları taşır: esas (TTW/WTW) · kullanılan
katsayılar · katsayı kümesi sürümü · girdi kaynağı (telemetri, fiş değil) ·
standart atfı (ISO 14083/GLEC) · **kapsama** (kaç araçtan kaçı ölçüldü) ·
**ölçülemeyen araçların plakaları**.

Esas **kapakta da** yazılı: belgeyi eline alan ilk saniyede hangi cetvel
olduğunu görmeli.

---

## 9 · Prova (QA harness)

```bash
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < db/migrations/089_co2_panosu.sql
docker exec -i hak-qa psql -U postgres -d hak -c \
  "grant all on all tables in schema public to service_role, anon, authenticated;"
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < <tohum>.sql

set -a; . <qa env>; set +a
npm run verify:co2      # 36 iddia
```

### Bu provanın yakaladığı kusurlar

1. **🔴 Kare dalga tohum 0 L ölçtürdü.** `report_fuel_stats_vehicle` bir
   de-glitch süzgeci uyguluyor (027): bir okuma ±30 satırlık pencerenin
   maksimumundan **10 puan ve daha fazla** aşağıdaysa arıza sayılıp atılıyor.
   Tohum günde iki okuma yazıyordu (90 ve 40) ve her 40 tam olarak bu kurala
   takılıyordu. Gerçek veri kademeli düşer — tohum günde 10 okumalı bir düşüş
   eğrisine çevrildi.
2. **Odometre zamanla azalıyordu.** Tohumda `g` **gün-önce** indeksiydi ve
   `g*100` yazınca en yeni okuma en küçük odometreyi taşıyordu → mesafe
   negatif, km `null`. `(21 - g)` ile ters çevrildi.

Her ikisi de **tohum** kusuruydu, ürün kusuru değil — ama fark edilmeseydi
"CO₂ hesaplandı" iddiası sıfır veriyle geçerdi.

---

## 10 · Kapılar

| İşlem | Kapı |
|---|---|
| Panoyu görmek | `requireFleetView` — **bayrak yok** |
| PDF indirmek | aynı kapı; dil indirmeden önce seçilir |
| Esas / şebeke / hedef ayarı | `requireAdmin` — esas raporun tamamının anlamını değiştirir |

Mobil Analiz ucu (`/api/mobile/analytics`) aynı motordan `co2` alanını taşıyor:
`kg` · `gKm` · `esas` · **kapsama** (ölçülen/toplam + ölçülemeyen plakalar).
İkinci bir hesap yazmak, mobil ile web'in farklı sayı göstermesine giden en
kısa yol olurdu.

---

## 11 · Hedef

Hedef **yoğunluk** olarak konur (g/km), mutlak kg olarak değil: mutlak hedef
filo büyürken kendiliğinden ihlal edilir ve kimseye bir şey söylemez. İhale
dokümanlarında da yoğunluk isteniyor.
