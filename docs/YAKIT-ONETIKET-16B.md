# 16b · Yakıt serisi ön-etiketi — DURUM

> Son güncelleme: **17.09.2026**. Migration **101 · 102 · 103 · 104 · 105** üç
> kiracıda da **CANLI**; cron kaydı (11. iş) üç kiracıda da kurulu.
>
> ## ⚖️ 16c KAPANDI — durum tek bakışta
>
> | | durum |
> |---|---|
> | **Adım 1 · 105** (odometre açıklığı tek çekirdek) | ✅ **Üç kiracıda CANLI** |
> | **Adım 2 · uygulama tarafı** (aşama örtüşmesi) | ✅ **CANLI** |
> | **Adım 2 · migration 106** (son toplama tek geçiş) | ⏸️ **BEKLEMEDE** |
> | **Adım 3 · migration 107** (`zero_count`) | ⏸️ **BEKLEMEDE** |
>
> **Karar (Volkan, 17.09.2026):** 106 ve 107'nin ölçülen kazancı ~1–2 sn'de
> kaldı; **30 günlük pencere 13–15 sn de olsa mobilde açılacak.** Dosyalar
> silinmedi, `db/migrations/_beklemede/` altına alındı ve kurulum sırasından
> (`gen-install-sql.mjs` ORDER) çıkarıldı. Kanıtları duruyor ve koşuyor
> (`verify:yakit-son-toplama`, 35 denetim) — bir gün gerekirse hazırlar.
>
> ⚠️ **Uygulama tarafı KALDI ve KALMALI.** `zero_count` gelirse okunuyor,
> gelmezse eski 19 sorgulu yol koşuyor. 107 uygulanmadığı için **bugün koşan
> yol eskisidir** — yani hiçbir sayı değişmedi. Aşama örtüşmesi ise
> 106/107'den bağımsız ve canlıda.

---

## Ne yapıldı

`report_fuel_stats_vehicle` / `report_fuel_volume_stats_vehicle` her çağrıda
aracın bütün yakıt okumalarını **31 satırlık iki kayan maksimumdan** geçiriyordu.
O iki sayı satırın **kendi komşuluğundan** gelir, sorulan pencereden değil —
yani bir kez hesaplanıp saklanabilir.

| migration | ne getirdi |
|---|---|
| **101** | `fuel_seri` (yüzde) + etiketleme fonksiyonu + `report_fuel_stats_vehicle_v2` |
| **102** | 101'in v2'sindeki **O(n²) pencere çerçevesi** düzeltmesi (`desc` + `unbounded preceding`) |
| **103** | `fuel_volume_seri` (litre) — 101'in birebir ikizi |
| **104** | Yüzde hattı odometre kapısı `between -1 and 1` (28.08 kararının tamamlanması) |

🔴 **090'ın günlük-özet yasağı delinmedi.** Saklanan şey günlük ÖZET değil,
satır başına ve **zamandan bağımsız** bir ara değer. Etiketleme gün gün koşar,
okuma gün gün TOPLANMAZ. PGlite'ta ölçüldü: aynı veride günlük parçalama
%8,9 sapma üretiyor, bu yol **%0,000000**.

## Ölçülen kazanç

**galzura-demo · canlı uç, gerçek girişle (17.09.2026):**

| uç | önce | sonra |
|---|---:|---:|
| `karsilastir?donem=hafta` | 3.821 ms | **~2,3 sn** |
| `karsilastir?donem=ay` | 15.949 ms | **~13–15 sn** |
| `buildFuelReport` (ay) | 18.772 ms | 14.538 ms |

**HAK61 · RPC seviyesinde (etiket dolu):**

| | v1 | v2 |
|---|---:|---:|
| tek araç · 30 gün | 636 ms | **381 ms** (−40%) |
| tek araç · 7 gün | 214 ms | **149 ms** (−30%) |
| filo · 30 gün (30 araç) | 4.179 ms | **2.378 ms** (−43%) |

Etiket boyutu: HAK61 1.537.526 (yüzde) + 896.495 (litre) · demo 710.912 +
497.629 · Sendigo 403.809 + 143.279.

## Denklik

Her turda **bayt-bayt** kıyaslandı (v1 vs v2, tüm kolonlar, kapalı pencerelerde):

- **HAK61**: yüzde 33 kıyas · litre 22 kıyas → **sapan 0**
- **demo**: yüzde 32 kıyas · litre 21 kıyas → **sapan 0**
- **Sendigo**: yüzde 3 · litre 1 → **sapan 0**
- PGlite (offline, `verify:yakit-seri-etiket`): **36/36**, arıza enjeksiyonu
  8+8+2 senaryoda iki katmanda da yakalanıyor

HAK61'in müşteriye giden "şüpheli kayıp" rakamı korundu: son 30 gün
**192 düşüş / 2.411 puan**, v1 = v2 = beklenen.

## ⚠️ "30 gün" mobilde gizli

Mobil arayüzde 30 günlük pencere **gösterilmiyor**; kullanıcının gördüğü en
geniş pencere hafta. Yani bugünkü hâliyle mobil tarafta hissedilen süre
**~2,3 sn**. "ay" penceresi panel/rapor tarafında ve API'de kullanılıyor.

## 16c — BEKLİYOR

Aşama ölçümü (demo, "ay", 29 araç) kalan yükün nerede olduğunu söylüyor:

| aşama | süre | durum |
|---|---:|---|
| yüzde RPC ×29 | 7.151 → **4.296 ms** | ✅ 101+102 |
| litre RPC ×10 | 5.388 → **1.129 ms** | ✅ 103 |
| **097 `getFleetDistanceSpans`** | 4.351 → **2.041 ms** | ✅ 105 — ama KRİTİK YOLDA DEĞİL (§ 9.9) |
| **052'nin son toplaması** | ~780 ms/araç | ⏳ 16c |
| kenar sorgular | ~1.400 ms | — |

### 🔴 16c'nin ilk maddesi artık bir DOĞRULUK sorunu da

17.09.2026'da ölçüldü (galzura-demo, kapalı pencere 12.08–16.09, aynı süreçte
arka arkaya): `buildFuelReport`ın **`fleetLPer100Km`** alanı iki farklı değer
verebiliyor — **72,475250** ya da **75,250365** (%3,8).

Sebep 101–104 DEĞİL; RPC seviyesinde o pencerede **sapan 0** ölçüldü. Sebep
`getFleetDistanceSpans` (097) ile araç-araç yedek yolunun **aynı araca farklı
km vermesi**:

```
W-GF-107 :  097 → 925 km        ·  araç-araç → null (sebep: inconsistent)
toplam   :  097 → 30.497 km     ·  araç-araç → 29.572 km   (1/30 araçta fark)
```

097 tek gövdeli bir ifade ve **8 sn'lik tavana yakın** koşuyor (ölçüldü:
4.653 / 5.187 / 7.705 ms). Tavanı aşarsa `null` döner ve yedek yol devreye
girer → o aracın km'si değişir → L/100 paydası değişir → **aynı pencere iki
farklı sayı verir.**

✅ **17.09.2026 — kapatıldı (105).** Ayrışmanın sebebi ölçüldü: 097 temizlenmiş
uçları, yedek yol HAM uçları kullanıyordu — bir araçta eksik, öbüründe %8,5 fazla.
105 kuralı `vehicle_odometer_span`a taşıdı, iki yol artık aynı çekirdeği çağırıyor;
tavan aşılırsa sessiz yedek yerine `olculmedi` dönüyor. Ayrıntı:
[ODOMETRE-KAYNAK-BAGLAMA.md](ODOMETRE-KAYNAK-BAGLAMA.md) § 9.

Bu **101 öncesinde de vardı**; 16b yalnız zamanlamayı değiştirdiği için
görünür hâle getirdi. 16c'de 097 ele alınırken bu ayrışma da kapatılmalı:
iki yolun aynı km'yi vermesi gerekir, yoksa hangisinin koştuğu sonucu
belirlemeye devam eder.

## Bilinen sınırlar

- `pg_database_size` PostgREST'ten **okunamıyor**; disk gözetimi tahminle
  yapıldı (satır × 144 B). HAK61 backfill'i sırasında 1,950 → 2,276 GB tahmin
  edildi, durak tetiklenmedi, tek 53100 çıkmadı.
- "ay" penceresinin sonu **ŞİMDİ** olduğu için o pencerede önce/sonra bayt
  kıyası **imkânsız**: 17.09'da ölçüldü, birkaç saat içinde `/analytics` km
  21.635 → 22.224, vardiya 435 → 450, alarm 3.092 → 3.159 oldu. Denklik hep
  **kapalı pencerede** ölçülür.

---

# 16c adım 2 — buildFuelReport'un son toplaması (17.09.2026)

## 1 · Aşamalar ARDIŞIKTI — ölçüldü

Ürün kodu değiştirilmeden, `globalThis.fetch` sarılarak gerçek çağrının izi
alındı (galzura-demo, 30 gün, 29 araç, **121 istek**, toplam **16.518 ms**):

| aşama | istek | Σ süre | pencere (baş → bit) | bağımlılık |
|---|---:|---:|---|---|
| 0 araç + personel | 4 | 444 ms | 0 → 242 | — |
| 1 yüzde RPC ×29 | 29 | 26.094 ms | 242 → 5.025 | yalnız `vehicles` |
| 2 litre RPC ×10 | 10 | 4.317 ms | 5.025 → 6.267 | **stats** |
| 3 filo span (105) | 1 | 4.955 ms | 6.268 → 11.223 | yalnız `vehicles` |
| 4 yakıt penceresi ×29 | 58 | 4.609 ms | 11.224 → 11.670 | yalnız `vehicles` |
| 5 sıfır sayımı ×19 | 19 | 27.974 ms | 11.671 → 16.510 | **stats** |

"hiç istek olmayan süre: 14 ms" — yani boşta beklemiyor, **sırayla** bekliyor.
3 ve 4 hiçbir şeyi beklemiyordu; 2 ve 5 birbirini beklemiyordu.

## 2 · Örtüşme tavanı kışkırtıyor — bu da ölçüldü

Naif çözüm ("hepsini `Promise.all`a al") **denendi ve geri alındı**. Tepe
eşzamanlılık 6 → 19 ifadeye çıkıyor; `lib/db-fanout.ts`in ölçtüğü gibi
statement timeout **ifadeye** uygulandığı için tek başına ~5 sn olan filo span
8 sn'yi aşıp `null` dönüyor ve araç-araç yedeğe düşülüyor.

> 105 sayesinde bu düşüş **sayıyı değiştirmiyor** (aynı çekirdek) — ama
> +2,5 sn maliyeti var. Ölçüldü: `karsilastir?donem=ay` demo'da
> **14,3 → 16,8 sn** ile GERİLEDİ.

Seçilen düzen: **yakıt penceresi erken başlatılmaz**, tepe eşzamanlılık 7'de
kalır (6 yüzde RPC + 1 span):

```
span  ──────────────────────────────┐
yüzde ×29 ─────┐                    │
               ├─ litre ×10 ─┐      │
               └─ sıfır ×19 ─┼──────┼─ yakıt penceresi ×29 ─► tek dalga
```

## 3 · Migration 106 — "11 alt sorgu" varsayımı KÜÇÜLDÜ

`report_fuel_stats_vehicle` ve `_v2` sonuçlarını onbir skaler alt sorguyla
üretiyordu. 106 bunları 094'ün `group by` kalıbına çevirdi (`array_agg` ile
ilk/son, `filter`lı `count`/`sum`). `rises` seri ekseninde olduğu için ayrı
CTE kaldı; **runs/rises mantığı hiç değişmedi**.

🔴 **Beklenti ölçümle küçüldü.** PGlite, canlı ölçekte (68.000 yakıt okuması):

| | 104 | 106 | kazanç |
|---|---:|---:|---:|
| `report_fuel_stats_vehicle` | 690 ms | 669 ms | %3 |
| `report_fuel_stats_vehicle_v2` | 335 ms | 300 ms | **%10** |

Sebep planda: CTE'ler ikiden fazla anıldığı için Postgres onları **zaten bir
kez** maddeleştiriyor. Asıl maliyet `numbered`/`bounded`/`kuyruk` **pencere
zinciri** ve 106 ona dokunmuyor. "381 ms → 150 ms" hedefi bu yolla tutmaz.

## 4 · Sonuç — ÖNCE / SONRA (canlı, aynı oturum)

`buildFuelReport`, 3 koşum medyan:

| | ÖNCE | SONRA | kazanç |
|---|---:|---:|---:|
| demo · kapalı Ağustos | 9.513 ms | **5.117 ms** | −%46 |
| demo · kayan 30 gün | 18.754 ms | **14.579 ms** | −%22 |
| HAK61 · kapalı Ağustos | 9.439 ms | **7.664 ms** | −%19 |
| HAK61 · kayan 30 gün | 12.237 ms | **9.253 ms** | −%24 |

Uçtan uca:

| | ÖNCE | SONRA |
|---|---:|---:|
| demo · `karsilastir` hafta | 2.602 ms | 2.627 ms |
| demo · `karsilastir` ay | 14.294 ms | 14.714 ms |
| demo · CO₂ panosu ay | 25.560 ms | **19.047 ms** (−%25) |
| HAK61 · `karsilastir` hafta | 3.151 ms | **2.117 ms** (−%33) |
| HAK61 · `karsilastir` ay | 6.150 ms | 6.428 ms |
| HAK61 · CO₂ panosu ay | 14.885 ms | **8.861 ms** (−%40) |

🔴 **HEDEF TUTMADI.** "`buildFuelReport` 30 gün demo < 5 sn · `karsilastir`
ay < 5 sn · hafta < 2 sn" hedefinin yalnız biri yakınına gelindi (HAK61 hafta
2,1 sn). Kalan yükün nerede olduğu ÖLÇÜLÜ:

| kalem | demo · kayan 30 gün | not |
|---|---:|---|
| yüzde RPC ×29 | ~4,8 sn | 106 %10 aldı; kalanı pencere zinciri |
| **sıfır sayımı ×19** | **~4,8 sn** | tek başına 179 ms · Σ 28 sn |
| filo span | ~5,0 sn | 105 kapalı pencerede 2,0 sn'ye indirdi |
| litre RPC ×10 | ~1,2 sn | 103 aldı |

🔑 **Sıradaki en büyük tek kalem `fuel_level_pct = 0` sayımı.** 19 sorgu,
tek başına 179 ms, rekabet altında 1,4 sn/sorgu. 16c adım 3 burası.

> ⚠️ **DÜZELTME (adım 3):** burada "093 o kolonun indeksini düşürdü"
> yazıyordu — yanlıştı. 093'ün düşürdüğü `idx_device_telemetry_fuel`,
> 053'ün indeksinin BİREBİR KOPYASIYDI ve yüklemi `fuel_level_pct IS NOT
> NULL`dı, `= 0` değil. Kalan indeks yerinde duruyor.

## 5 · Sayılar değişmedi

Kapalı Ağustos penceresinde `buildFuelReport`ın **tüm çıktısı** (11 özet alanı
+ 29 satırın her kolonu) JSON olarak alınıp `git stash` ile önce/sonra
kıyaslandı: **iki kiracıda da BİREBİR AYNI**.

- `verify:yakit-son-toplama` (PGlite) **20/20** — 4 pencere × 3 etiket durumu
  (tam · melez · boş) × 7 araç × 11 kolon, 104 ↔ 106 bayt-bayt; **5 arıza
  enjeksiyonunun 5'i de yakalandı**.
- `verify:yakit-seri-etiket` **36/36** (106 uygulanmış hâlde).
- `lint:yakit-etiket` **106 → 122 denetim**; yeni 106 denetimlerinde arıza
  enjeksiyonu **6/6**. Denetimler kaynak dosya adını yazmıyor — `yururlukte()`
  en yüksek numaralı migration'ı bulur, 107 gelirse kendiliğinden taşınır.

---

# 16c adım 3 — sıfır sayımı aynı taramadan (migration 107)

## 1 · Ne yapıldı

`buildFuelReport` arızalı sensör tespiti için araç başına ayrı bir
`count(exact, head)` sorgusu atıyordu. 107 o sayıyı yüzde RPC'sinin yanıtına
`zero_count` olarak ekledi — sayı zaten o RPC'nin taradığı satırlardan geliyor.

- **107 = 106'nın gövdeleri + 12. kolon.** 106 hiçbir kiracıda çalıştırılmadı;
  107 onu kapsıyor. (Kurulum dosyalarında ikisi de sırayla var: yeni bir
  kiracıda 106 `create or replace`, 107 `drop`+`create`.)
- Dönüş tipi değiştiği için **drop + create, tek işlemde** (100 kalıbı) +
  `lock_timeout 3s`.
- Uygulama kararı **yanıta** bakıyor, bayrağa değil:
  `statRows.some((r) => r.zero_count !== undefined)`. Kolon yoksa eski 19
  sorgulu yol aynen koşuyor.

## 2 · Kısmi indeks gerekiyor mu — HAYIR, ve 093 yanlış hatırlanmıştı

🔴 **Adım 2'de "093 `fuel_level_pct = 0` indeksini düşürdü" yazılmıştı. Yanlıştı.**
093'ün düşürdüğü `idx_device_telemetry_fuel`, 053'ün
`idx_device_telemetry_vehicle_fuel_pct` indeksinin **birebir kopyasıydı** ve
yüklemi `fuel_level_pct IS NOT NULL`dı, `= 0` değil. Kalan indeks yerinde
duruyor ve tam o yüklemi taşıyor. 093'ün kendi başlığı bunu satır satır
anlatıyor — okunmadan aktarılmış.

`= 0` için ayrı bir kısmi indeks de **gerekmiyor**, ve bunun kanıtı saat değil
**plan**:

| | 106 | 107 |
|---|---:|---:|
| `device_telemetry` tarama düğümü | 2 | **2** |
| `CTE Scan on base` | 0 | **2** |

107'de `base` iki tüketicili olduğu için Postgres onu **maddeleştiriyor**:
tablo bir kez taranıyor, `sifir` CTE'si maddeleşmiş sonucu okuyor. Yani
`zero_count` ikinci bir erişim yolu açmıyor.

⚠️ **PGlite'ın saati bu soruyu çözemez** ve öyle davranılmadı: aynı gövde
ardışık turlarda 335–450 ms arası oynuyor (WASM), ve oradaki "ayrı sayım
sorgusu" 8 ms çıkıyor çünkü veritabanı bellekte — canlıda aynı sorgu 179 ms.

## 3 · Beklenen kazanç — ölçülen aritmetikle, ve hedefin ALTINDA

107 hiçbir kiracıda uygulanmadı; canlı SONRA ölçümü uygulandıktan sonra
yapılabilir. Beklenti tahmin değil, **ölçülmüş aşama pencerelerinden** türedi
(fetch izi, 30 gün, 29 araç):

| | demo | HAK61 |
|---|---:|---:|
| yüzde RPC biter | 6.315 ms | 3.828 ms |
| litre RPC biter | 13.834 ms | 9.897 ms |
| **sıfır sayımı biter** | **15.778 ms** | **10.899 ms** |
| → 107 ile dalganın bitişi | 13.834 ms | 9.897 ms |
| **doğrudan kazanç** | **~1,9 sn** | **~1,0 sn** |

🔴 **Hedef (demo 14,6 → ~10 sn · HAK61 9,3 → ~5 sn) BU ARİTMETİKLE TUTMUYOR.**
Doğrudan kazanç ~1–2 sn. Sebep: sıfır sayımı **litre RPC'siyle paralel**
koşuyordu (adım 2'nin düzeni), yani 4,8 sn'lik duvar saatinin yalnız litreyi
aşan kısmı kritik yolda.

İkinci bir kazanç **mümkün ama ölçülmedi**: 19 eşzamanlı sayım sorgusu
kalkınca tepe eşzamanlılık **25 → ~13**'e iniyor. Filo span'i (tek ifade)
şu anda tam da bu rekabet yüzünden 8 sn'lik tavanı aşıp `null` dönüyor ve
araç-araç yedeğe düşülüyor (demo'da +2,8 sn, HAK61'de +1,6 sn). Rekabet
azalınca span tavanın altında kalabilir — **kalırsa** demo ~11 sn, HAK61
~8 sn olur. Bu bir hipotez; 107 uygulanınca ölçülecek.

## 4 · Kanıt

- `verify:yakit-son-toplama` (PGlite) **35/35**:
  - 104 ↔ 107 **11 kolon bayt-bayt**, 4 pencere × 3 etiket durumu × 7 araç
  - `zero_count` = uygulamanın ESKİ sayımı, **8/8** (v1 ve v2, dört pencere)
  - **yanıt sözleşmesi**: 104'ün yanıtında kolon YOK (11), 107'de VAR (12),
    ve 11 kolonun adları/sırası değişmedi — `zero_count` **sona** eklendi
  - **7 arıza enjeksiyonunun 7'si** yakalandı (ikisi yalnız `zero_count`u
    bozuyor; 11 kolonluk kıyas onları göremediği için **ayrı bir dedektör**
    eklendi — eski sayım sorgusuyla karşılaştırma)
  - plan denetimi: ek `device_telemetry` erişimi yok
- `verify:yakit-seri-etiket` **36/36** (106 + 107 uygulanmış hâlde)
- `lint:yakit-etiket` **122 → 138 denetim**; 107 denetimlerinde arıza **8/8**

### 🔴 Muhafızda yakalanan gerçek kusur

`check-yakit-etiket.mjs`in `govde()` okuyucusu yalnız
`create or replace function` arıyordu. 107 `drop` + **düz** `create function`
kullandığı için okuyucu onu **görmüyor** ve "yürürlükteki gövde" olarak 106'yı
döndürüyordu — yani bütün eşik/kapı denetimleri sessizce **geçmişi** denetler
hâle gelmişti. Ölçümle yakalandı (denetim 106'yı gösterdi), okuyucu iki biçimi
de tanıyacak şekilde düzeltildi.

---

# 16c KAPANIŞI (17.09.2026)

## Ne canlıya gitti

| iş | durum | ölçülen etki |
|---|---|---|
| **105** · `vehicle_odometer_span` + LATERAL | üç kiracıda canlı | span −%44 (HAK61) / −%71 (demo, kapalı pencere); **ayrışan araç 1/30 → 0/30** |
| **Uygulama** · aşama örtüşmesi | canlı | `buildFuelReport` demo −%22 · HAK61 −%24; CO₂ panosu demo −%25 · HAK61 −%40; `karsilastir` hafta HAK61 −%33 |
| **Uygulama** · `zero_count` varsa oku | canlı (uykuda) | kolon olmadığı için eski yol koşuyor — **sayı değişmedi** |

## Ne beklemeye alındı ve neden

| dosya | ölçülen kazanç | neden beklemede |
|---|---|---|
| `_beklemede/106_yakit_son_toplama.sql` | v2 %10 · v1 %3 (PGlite, 68.000 okuma) | "11 alt sorgu pahalı" varsayımı ölçümle çürüdü: CTE'ler zaten bir kez maddeleşiyor, asıl maliyet pencere zinciri |
| `_beklemede/107_yakit_sifir_sayimi.sql` | ~1,9 sn (demo) · ~1,0 sn (HAK61) | sıfır sayımı litre RPC'siyle **paralel** koşuyordu; yalnız litreyi aşan kısmı kritik yolda |

⚖️ **Karar: uygulanmayacak.** 30 günlük pencere ~13–15 sn de olsa mobilde
açılacak. İki migration da canlı bir şemayı `drop`+`create` ile değiştiriyor
(107) ya da iki fonksiyonu birden yeniden yazıyor (106); ~1–2 sn için bu risk
alınmadı.

## Silinmediler — ve muhafız bunu koruyor

`lint:yakit-etiket` şu dört şeyi donduruyor:

1. Dosyalar `_beklemede/` altında **var**.
2. `db/migrations` kökünde **yok** (yani uygulanmıyor).
3. `gen-install-sql.mjs` ORDER'ında **yok** (yeni kiracıya gitmiyor).
4. İçerikleri bugün ölçülen sözleşmeyi taşıyor (tek geçiş kuyruğu, `zero_count`
   HAM seriden, kolon sonda, drop+create tek işlemde, lock_timeout, litre/2-arg
   hattına dokunmama).

Kazara geri taşınırlarsa (2) ve (3) kırılır — ikisi de arıza enjeksiyonuyla
sınandı. `verify:yakit-son-toplama` (35 denetim) `_beklemede/` altındaki
dosyaları okumaya devam ediyor: bozulurlarsa **bugün** bilinir, uygulandığı
gün değil.

## Kalan bilinen yükler (16c'de kapatılmadı)

| kalem | demo · kayan 30 gün | not |
|---|---:|---|
| yüzde RPC ×29 | ~5,8 sn | asıl maliyet `numbered`/`bounded`/`kuyruk` pencere zinciri |
| sıfır sayımı ×19 | ~1,9 sn (kritik yolda) | 107 beklemede |
| filo span | ~5 sn, rekabet altında 8 sn tavanını aşıyor → yedeğe düşüyor | 105 sayesinde **aynı sayı**, yalnız yavaş |
| litre RPC ×10 | ~7,5 sn | 103 aldı |
