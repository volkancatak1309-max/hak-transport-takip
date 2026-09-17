# 16b · Yakıt serisi ön-etiketi — DURUM

> Son güncelleme: **17.09.2026**. Migration **101 · 102 · 103 · 104** üç
> kiracıda da **CANLI**; cron kaydı (11. iş) üç kiracıda da kurulu.

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
tek başına 179 ms, rekabet altında 1,4 sn/sorgu. O kolonda **kısmi indeks
YOK** — 093 bir zamanlar `idx_device_telemetry_fuel`i düşürdü ve hiçbir
migration yeniden yaratmıyor. 16c adım 3 burası.

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
