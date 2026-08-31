# Oran küme kuralı — pay ve payda aynı kümeden

> 31.08.2026 · Dal `fix/oran-kume-kurali` · **push/deploy YOK.**
> Ölçüm turu HAK61'de **salt okuma** (`globalThis.fetch` sarmalandı,
> `GET`/`HEAD` ve `POST /rpc` dışındaki her istek reddedildi).
> Kaynak: [`CO2-SURE.md`](CO2-SURE.md) § 7.3.

---

## 0 · KURAL

> **Bir oran hesaplanırken pay ve payda AYNI kümeden gelir.**
> Küme, o an **her iki değeri de ölçülmüş** kayıtlardır.
> Küme dinamiktir — araç sayısına, bakıma, cihaz arızasına göre kendiliğinden
> değişir. **Hiçbir yere sabit sayı yazılmaz.**

Üç ayrı sayı, üç ayrı küme:

| sayı | kümesi |
|---|---|
| toplam **kg** | kg'si bilinen kayıtlar |
| toplam **km** | km'si bilinen kayıtlar |
| **oran** (g/km) | 🔴 **yalnız ikisi de bilinen** kayıtlar |

Toplamlar birbirinden geniş olabilir ve bu **bilgi saklamamak** demektir:
ölçülen bir yakıt, km'si bilinmiyor diye yok sayılmaz. Ama **oran** o iki
toplamdan hesaplanamaz — kendi kümesini ister.

Bu bir sayı sorunu değil, **mantık sorunu**: kaç araç olduğu önemsiz. 10
araçta da 1000 araçta da, araçların yarısı bakımdayken de aynı hata çıkar.

---

## 1 · KUSUR — nasıl görünüyordu

`lib/co2-db.ts`, düzeltme öncesi:

```ts
const olculen  = araclar.filter((a) => a.kg !== null);          // 24 araç
const toplamKg = olculen.reduce((s, a) => s + (a.kg ?? 0), 0);  // 24'ten
const toplamKm = olculen.reduce((s, a) => s + (a.km ?? 0), 0);  // 24'ten AMA
//                                              ^^^^^^^^^
//              km'si olmayan araç kg'sini paya ekliyor, paydaya 0 ekliyor
gKm: gPerKm(toplamKg, toplamKm)
```

**Pay 24 araçtan, payda fiilen 21 araçtan.** HAK61 2026-07'de ölçüldü: üç
araç (`DO-512GT`, `DO-571GR`, `DO-505GS`) `odometre_ilk = 0` okuduğu için
km'si `null`; litreleri (93,36 L) ve dolayısıyla CO₂'leri hesaplanabiliyor
ama kilometreleri bilinmiyor.

Sonuç, aynı ekranın iki parçasının çelişmesi:

| | kg | km | g/km |
|---|---:|---:|---:|
| üst kart (kusurlu) | 3.921,61 | 13.698 | **286,29** |
| trend (doğru) | 3.675,14 | 13.698 | **268,30** |

**%6,7 şişik** — ve müşteriye giden bir emisyon yoğunluğu rakamı.

---

## 2 · DÜZELTME

```ts
const kgOlculen    = araclar.filter((a) => a.kg !== null);
const kmOlculen    = araclar.filter((a) => a.km !== null);
const litreOlculen = araclar.filter((a) => a.litre !== null);
/** ORAN KÜMESİ: pay ve payda buradan, başka hiçbir yerden. */
const oranKumesi   = araclar.filter((a) => a.kg !== null && a.km !== null);

kg:    topla(kgOlculen,    (a) => a.kg)
km:    topla(kmOlculen,    (a) => a.km)
litre: topla(litreOlculen, (a) => a.litre)
gKm:   gPerKm(topla(oranKumesi, (a) => a.kg), topla(oranKumesi, (a) => a.km))
```

Kapsama üç ayrı sayı olarak dışarı çıkıyor (`CO2Toplam`):

```
kgArac · kmArac · oranArac        (+ toplamArac)
oranDisiPlakalar                  ← kg'si var ama orana giremeyen araçlar
```

`oranArac <= min(kgArac, kmArac)` her zaman. Hangi sayının kaç araçtan
geldiği artık gövdede yazılı — "24/29" demek yetmiyordu.

### 2.1 ÖNCE / SONRA — HAK61 canlı, her range

| range | | kg | km | litre | **g/km** | kapsama (kg·km·**oran**) |
|---|---|---:|---:|---:|---:|---|
| `gun` | önce | 3.260,7 | 907 | 1.235,12 | 3.595,06 | |
| | sonra | 3.260,7 | 907 | 1.235,12 | **3.595,06** *(±0)* | 18 · 18 · **18** / 29 |
| `hafta` | önce | 5.844,1 | 4.536 | 2.213,68 | 1.288,39 | |
| | sonra | 5.844,1 | **6.268** | 2.213,68 | **1.288,39** *(±0)* | 17 · 21 · **17** / 29 |
| `ay` | önce | 10.575,5 | 19.645 | 4.005,87 | 538,33 | |
| | sonra | 10.575,5 | **28.255** | 4.005,87 | **538,33** *(±0)* | 22 · 27 · **22** / 29 |
| `tumzaman` | önce | 14.855,7 | 30.931 | 5.627,15 | 480,28 | |
| | sonra | 14.855,7 | **40.756** | 5.627,15 | **454,08** | 24 · 25 · **21** / 29 |
| | | | | | **−%5,46** | oran dışı: DO-571GR, DO-512GT, DO-505GS |
| `ozel` (Temmuz) | önce | 3.921,6 | 13.698 | 1.485,46 | 286,29 | |
| | sonra | 3.921,6 | **16.596** | 1.485,46 | **268,30** | 24 · 25 · **21** / 29 |
| | | | | | **−%6,28** | oran dışı: DO-512GT, DO-571GR, DO-505GS |

**İki şey değişti:**

1. **`g/km` düzeldi** — ama yalnız kg kümesi ⊄ km kümesi olan pencerelerde.
   `gun`/`hafta`/`ay`'da fark **±0**: orada kg'si olan her aracın km'si de
   var, yani kusur tetiklenmiyordu. Kusurun her pencerede görünmemesi onu
   daha tehlikeli yapıyor — sessizce bazı dönemlerde çıkıyor.
2. **`km` toplamı arttı** (Temmuz +2.898, `tumzaman` +9.825). Artık km'si
   ölçülen **tüm** araçlardan geliyor; eskiden yalnız CO₂'si de hesaplanan
   araçlardan geliyordu. Bu **bilgi saklamamak**: km ölçüldüyse toplamda
   görünür. Oran ise ondan hesaplanmıyor.

### 2.2 🔴 En güçlü kanıt: üst kart ile trend artık aynı

```
Temmuz üst kart g/km : 268,30
Temmuz trend   g/km : 268,30      → BİREBİR AYNI
```

Düzeltmeden önce 286,29 ≠ 268,30 idi. Aynı ekranın iki parçası artık aynı
kümeden konuşuyor.

---

## 3 · AYNI KUSUR BAŞKA NEREDE — tam tarama

`lib/` ve `app/` altındaki tüm oran üretim noktaları tarandı.

### 3.1 🔴 Bulunan ve düzeltilen

| # | yer | kusur | canlı etki |
|---|---|---|---|
| 1 | `lib/co2-db.ts` `co2Panosu.toplam` | pay 24 / payda 21 | **%6,28–6,7 şişik** — ölçüldü |
| 2 | `app/actions/fuel.ts:262` `avgGPerKm` | `km = max(0, maxKm−minKm)` tek fişli araçta **0**; o araç CO₂'sini paya ekleyip paydaya 0 ekliyor | modül **kapalı** (`NEXT_PUBLIC_FUEL_ENABLED` varsayılan `false`), `fuel_entries` **1 satır** → sapma `ÖLÇÜLEMEDİ`, kalıp aynı |
| 3 | `lib/karlilik.ts:279` `marj` | `gelir` her seferden, `maliyet` yalnız `atfedilenEur !== null` olanlardan → katkı payı ve marj **şişer** | `sefer_gelirleri` **0 satır** → sapma `ÖLÇÜLEMEDİ` |

**2 ve 3 canlıda bugün etkisiz** ama kalıp birebir aynı; ilk veri girdiğinde
sessizce yanlış sayı üretirlerdi. Düzeltildi.

`marj` düzeltmesi bir davranış değişikliğidir: ölçümü eksik satırda artık
`null` döner — *"0 marj" değil, "bilinmiyor"*. `maliyetsizSefer` /
`eksikMaliyetliSefer` sayaçları hangi satırın neden dışarıda kaldığını
söylüyor. Not: bu ekran aynı hatayı bir kez zaten yaşamıştı (maliyetinin
yarısı ölçülemeyen bir müşteri "en kârlı" listesinde ikinci sıraya çıkmıştı)
ve orada **sıralama kapısıyla** çözülmüştü — sayının kendisi şişik kalıyordu.

### 3.2 ✅ Tarandı, TEMİZ — ve neden temiz

| yer | neden temiz |
|---|---|
| `lib/cost-model.ts` `eurPerKm` / `eurPerParcel` / `fuelShare` | `ratio(pay, payda)` — payda 0 ise `null`. Başlıkta kural yazılı: *"ölçülen litre yalnız 23/29 araçta var ve o araç kümesi km paydasının kümesiyle aynı değil. Farklı evrenleri bölmek €/km'yi sessizce bozardı."* **Bu dosya kuralı zaten biliyordu.** |
| `lib/reports.ts` `CostBasis` (§ 1588) | `km` yalnız `kmDiff !== null && > 0` vardiyalardan; `kmShifts` / `hourShifts` / `parcelShifts` sayaçları ayrı. Yorumda gerekçe: *"bu kapı olmasaydı 18.307 km'lik payda, hiç ölçülmemiş vardiyaların 0'larıyla…"* |
| `lib/reports.ts` `buildSpeedReport.per100Km` | Oran **satır bazında**, tek aracın kendi payı/paydası. Ayrıca `checkKmDenominator` payda kapısı var (2 km giden araçtaki 1 ihlal "50 ihlal/100 km" olmasın diye). |
| `lib/reports.ts` `buildDistanceReport.totalKm` | `measuredRows` (`km !== null`) üzerinden **ve** `measured` sayacı ayrı raporlanıyor. |
| `lib/reports.ts` `buildPerformanceReport.avgScore` | `scored` kümesinden toplanıp `scored.length`e bölünüyor — aynı küme. `kmMeasuredShifts` / `kmUnmeasuredShifts` ayrı. |
| `lib/reports.ts` `lPer100Km` (yakıt, araç satırı) | Satır bazında, `gate === null && km` kapısıyla. |
| `lib/haftalik-aksiyon-db.ts:444` | `olculen` (`lPer100Km !== null && > 0 && !dataUnreliable`) kümesinden toplanıp aynı kümenin uzunluğuna bölünüyor. |
| `lib/karlilik.ts` kalem hesabı | `durum !== "olculdu"` ise `eur: null`; `atfedilenEur` hiçbiri ölçülemediyse `null`. Satır düzeyinde temiz — kusur yalnız **toplamda** idi (§ 3.1/3). |
| mobil uçlar (`app/api/mobile/**`) | Kendi oranlarını hesaplamıyor; `co2Panosu` / `reports.ts` çıktısını taşıyor. Düzeltme oraya kendiliğinden yansır. |

### 3.3 ⬜ Ölçülemedi

- **Sapmanın diğer kiracılardaki büyüklüğü** — Sendigo'da CO₂ verisi bu
  pencerelerde yok, galzura-demo'da service key yok.
- **2 ve 3'ün gerçek sapması** — canlıda veri yok (§ 3.1).
- **Açık ayda (2026-08) sapma** — pencere kayıyor, kapanmış pencerede
  ölçüldü (Temmuz).

---

## 4 · MUHAFIZ — `npm run lint:oran-kume`

`scripts/check-oran-kume.mjs`. `verify` zincirine eklendi.

**Ne yakalar:** `reduce(… ?? 0)` / `reduce(… || 0)` ile üretilen bir toplam,
aynı dosyada bir **bölmede** ya da bilinen bir oran yardımcısında
(`gPerKm`, `ratio`, `per100`, `perKm`, `yuzde`, `oran`) kullanılıyorsa.
`?? 0` orada *"bu değer yoksa 0 say"* demektir; oranın bir ucunda yapılıp
diğerinde yapılmazsa kümeler ayrışır.

**Bilinçli istisna** — küme zaten filtrelenmişse `?? 0` yalnız tür kapısıdır:

```ts
// oran-kume: küme çağrıdan ÖNCE filtrelenmiş halde geliyor; buradaki
// `?? 0` yalnız tür kapısıdır, hiçbir satırı sessizce 0 saymaz.
```

Gerekçesiz muafiyet yok — yorum metni boş olamaz. Pencere **6 satır**
(gerekçe çok satırlı olur; dar pencere gerçek gerekçeyi kaçırıp yanlış bulgu
üretiyordu — ilk sürümde tam bu oldu).

### 4.1 Muhafızın kusuru gerçekten yakaladığı — kanıt

Düzeltmeler `git stash` ile geçici kaldırıldı ve muhafız **eski kod
üzerinde** koşturuldu:

```
✗ ORAN KÜME RİSKİ — 2 bulgu
  lib/co2-db.ts:306  (toplamKg → satır 318'de oranda)
      const toplamKg = olculen.length ? olculen.reduce((s, a) => s + (a.kg ?? 0), 0) : null;
  lib/co2-db.ts:308  (toplamKm → satır 318'de oranda)
      ? olculen.reduce((s, a) => s + (a.km ?? 0), 0)
```

Tam da kusurun iki satırını ve `gPerKm` çağrısının satırını gösterdi.
Düzeltilmiş kodda: `✓ ORAN KÜMESİ — '?? 0' ile toplanıp orana giren değer yok`.

### 4.2 Muhafızın sınırları — ne YAKALAMAZ

Bu bir regex taraması, tip denetimi değil:

- Toplam **başka dosyada** üretilip burada bölünüyorsa görmez (dosya içi).
- `?? 0` yerine `filter` unutulmuşsa (`kg`i olan listeden `km` toplamak ama
  `?? 0` yazmamak — TypeScript buna izin vermez, o yüzden pratikte dar bir
  boşluk) görmez.
- Payı ve paydayı iki **ayrı filtreden** alan ama filtreleri farklı olan bir
  kodu görmez: `filter(a => a.kg !== null)` ile `filter(a => a.km !== null)`
  toplamlarını bölmek sözdizimsel olarak temiz görünür.

Son madde gerçek bir boşluk. Kapatmanın yolu tip düzeyinde bir "küme
etiketi" olurdu (aynı etiketli iki toplam bölünebilsin); **bu turda
yapılmadı**, ayrı iş.

---

## 5 · DEĞİŞEN DOSYALAR

| dosya | değişiklik |
|---|---|
| `lib/co2.ts` | `CO2Toplam`'a `kgArac` · `kmArac` · `oranArac` · `oranDisiPlakalar`; `CO2ReportData`'ya `oranAracSayisi` · `aracSayisi` (ikisi de opsiyonel — eski çağıranlar kırılmaz) |
| `lib/co2-db.ts` | üç ayrı küme + `oranKumesi`; `gKm` yalnız oran kümesinden |
| `app/actions/fuel.ts` | `avgGPerKm` `km > 0` kümesinden; kapsama sayaçları |
| `lib/karlilik.ts` | `marj` yalnız ölçümü tam satırlarda |
| `scripts/check-oran-kume.mjs` | **YENİ** muhafız |
| `package.json` | `lint:oran-kume` + `verify` zinciri |

**Doğrulama:** `tsc` 0 · `build` başarılı · `lint:oran-kume` YEŞİL ·
`check-test-filters` 1 bulgu (taban, değişmedi) · eslint 43/28/15 (taban,
değişmedi) · 11 muhafız YEŞİL.
