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
