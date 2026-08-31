# Bozuk telemetri okumaları — odometre

> 31.08.2026 · Dal `fix/bozuk-telemetri` → **main'de** · 096 **üç kiracıda
> çalıştırıldı** (Volkan, 31.08).
> Ölçüm HAK61'de **salt okuma** (`globalThis.fetch` sarmalandı; `GET`/`HEAD` ve
> `POST /rpc` dışındaki her istek reddedildi). Ham veriye **dokunulmadı** —
> hiçbir satır silinmedi, güncellenmedi. Kaynak: [`CO2-SURE.md`](CO2-SURE.md) § 7.2.

---

## 0 · KISA CEVAP

| soru | cevap |
|---|---|
| Sıfır her zaman mı geçersiz? | **Sıfır ayrı bir kural değil.** Geçersizlik iki fiziksel kapıdan çıkar; sıfır bunlardan birine takılan özel bir durumdur. |
| Yeni araç gerçekten 0'dan başlayabilir mi? | Teorik olarak evet — bu yüzden "0 ⇒ geçersiz" YAZILMADI. Bu filoda en düşük gerçek okuma **12.543**; hiçbir araç 0'da değil. |
| Sayaç sıfırlanması (cihaz değişimi) var mı? | **HAYIR** — ölçüldü. Bozukluk **tekil ve geçici**, seri hemen normale dönüyor. Kalıcı bir sıfırlanma hiç görülmedi. |
| Kazanç? | RPC seviyesinde: 2026-07'de ölçülebilen araç **23 → 26** (+3), `DO-777GS` km **36.187 → 1.141**. Öngörü canlıda **11/11 birebir tuttu** (§ 4.3). |
| Müşteri rakamı değişiyor mu? | 🔴 **HAYIR.** Ölçüldü: tazeleme `km` ve `olculemedi_sebep`'i **hiç** değiştirmiyor, yalnız hiçbir yerde okunmayan `odometre_ilk/son` kolonlarını. Sebebi ve asıl kaldıraç: § 4.2. |

---

## 1 · ENVANTER — ne kadar bozuk var

HAK61 canlı, tüm `device_telemetry`:

```
toplam satır            1.803.566
odometre dolu           1.518.613  (%84,2)
odometer_km = 0               114  (%0,0075 · 4/30 araç)
odometer_km < 0                 0
odometer_km > 2.000.000         0
monotonluk ihlali             123  (13/30 araç · en büyüğü 113.009 km)
```

Sıfırlar **7 ayrı güne** yayılmış (tek olay değil): 14.07 (22), 21.07 (1),
23.07 (6), 30.07 (2), 11.08 (8), 12.08 (6), **20.08 (69)**.

### 1.1 Diğer alanlar — TEMİZ

18 kontrol koşuldu, **hiçbirinde sınır ihlali yok**:

| alan | kontrol | bulgu |
|---|---|---|
| `fuel_level_pct` | `< 0`, `> 100` | 0 |
| `fuel_volume_l` | `< 0`, `> 1500` | 0 |
| `speed_kmh` | `< 0`, `> 200`, `> 300` | 0 |
| `engine_rpm` | `< 0`, `> 6000` | 0 |
| `engine_load_pct` | `< 0`, `> 100` | 0 |
| `coolant_temp_c` | `< -50`, `> 150` | 0 |
| `power_voltage` / `battery_voltage` | `< 0`, `> 60` | 0 |
| `satellites` | `< 0`, `> 64` | 0 |
| `altitude_m` | `< -500`, `> 9000` | 0 |
| `heading` | `< 0`, `> 360` | 0 |
| `latitude` / `longitude` | aralık dışı | 0 |
| `fuel_consumption` | `< 0` | 0 |

**Bu bir kalıp değil, odometreye özgü.** Sebebi anlaşılır: diğer alanlar anlık
durum bildirir ve tek bozuk okuma bir sonrakiyle düzelir; odometre ise
**kümülatif** — ondan bir *açıklık* hesaplanıyor ve açıklığın uçları tek satıra
bağlı.

`fuel_level_pct = 0` 5.995 satırda (%0,33) var ama **meşru**: depo gerçekten
boşalabilir. Zaten `telemetry_month_spans` bunu `yakit_sifir_okuma` olarak
ayrıca sayıyor (090'dan beri).

---

## 2 · KURAL — veriden türetildi

### 2.1 Bozukluk tekil ve geçici, sıfırlanma DEĞİL

```
DO-753GS   10:01:19   123836
           10:01:20   123836
           10:01:21    24063   ← tek satır
           10:01:23   123836   ← hemen geri
           10:01:24   123836
```

Aynı desen `DO-775GS`'te de. Gerçek bir sayaç sıfırlanması olsaydı düşük değer
**devam ederdi**. Etmiyor. Bu yüzden "sıfırlanmayı tanı ve yeni seri başlat"
mantığına gerek yok — kural basit kalabiliyor.

### 2.2 İki kapı, ikisi de fizikten

> **① Monotonluk.** Odometre azalmaz. Koşan maksimumdan geri giden okuma
> bozuktur. *(Sıfır ayrı kural değil — o da bir azalmadır.)*
>
> **② Fiziksel atlama.** İki okuma arasındaki artış, geçen sürede mümkün
> olandan büyük olamaz. Üst hız **veriden ölçüldü**: 1,8M satırda
> `speed_kmh > 200` olan **hiç** satır yok.

### 2.3 🔴 ① tek başına YETMEZ — ölçüldü

Bozuk okuma serinin **başındaysa** azalma değil, artıştır (`0 → 98.783`).
Monotonluk onu görmez. Ölçüm:

| kural | 2026-07 kazanç | 2026-08 kazanç |
|---|---:|---:|
| yalnız ① monotonluk | **+0** | +0 |
| ① + ② fiziksel atlama | **+1** *(ilk/son yolunda)* · **+3** *(min/max yolunda)* | +0 |

İlk hipotezim "monotonluk yeter" idi; **ölçüm çürüttü.** İkisi birlikte gerekli.

### 2.4 Ölçekten bağımsızlık

Kuralda **plaka yok, araç sayısı yok, filoya özel eşik yok**. Girdi yalnız
`(odometer_km, recorded_at)` çiftleri. 10 araçta da 1000 araçta da, araçların
yarısı bakımdayken de, hangi araç hangi gün bozuk okursa okusun aynı çalışır.

Tek sabit `UST_HIZ_KMS = 200` ve o bir **fiziksel sınır**, filo özelliği değil —
üstelik veriden ölçülerek seçildi. `mumkunArtisKm()` 1 km taban tutuyor ki aynı
saniyeye düşen iki okuma yuvarlama yüzünden elenmesin.

---

## 3 · UYGULAMA — ve odometre okuyan HER yer

### 3.1 Düzeltilen

| yer | ne yapıldı |
|---|---|
| **`lib/odometre.ts`** | **YENİ** — kuralın tek evi: `odometreTemizle` · `odometreSpani` · `mumkunArtisKm` |
| **`db/migrations/096`** | `telemetry_month_spans` ham `min`/`max` yerine pencere fonksiyonlu filtre. **İmza değişmedi** — çağıranlar dokunulmadan çalışır. ✅ **üç kiracıda çalıştırıldı** |

### 3.2 Odometre okuyan tüm yerler — tarandı

| dosya | ne yapıyor | risk | durum |
|---|---|---|---|
| `db/migrations/090` → `telemetry_month_spans` | ayın `min`/`max`'ı | 🔴 **YÜKSEK** — tek bozuk satır ayı götürüyor | **096 ile düzeltildi** |
| `lib/analytics.ts` `getVehicleDistanceSpan` | ilk/son **zamanlı** okuma | 🟡 orta — uçtaki satır bozuksa. Ama `diff < 0` ve `MAX_PLAUSIBLE_KM_PER_DAY` kapıları var → **sessiz yanlış üretmiyor**, "ölçülemedi" diyor | ölçüldü: temizleme +1 araç (2026-07). **Değiştirilmedi** — § 5 |
| `lib/admin-dashboard.ts:1080` | ilk/son okuma | 🟡 aynı desen | değiştirilmedi |
| `lib/backfill.ts:340` | ilk/son dolu okuma | 🟡 aynı desen | değiştirilmedi |
| `lib/bakim-db.ts:155,200` | **tek anlık** okuma (bakım km'si) | 🟢 düşük — açıklık değil | dokunulmadı |
| `lib/karlilik-db.ts:112` | **tek anlık** okuma | 🟢 düşük | dokunulmadı |
| `lib/auto-shift.ts` · `lib/shift-end.ts` | vardiya açılış/kapanış sayacı | 🟡 orta — `km-quality.ts` ayrı kapı koyuyor | dokunulmadı |
| `lib/telemetry.ts` · `lib/flespi.ts` | **yazma** yolu | — | dokunulmadı: ham veri değişmez |

🔴 **Kapsam kararı ve gerekçesi:** ölçüm, kazancın **`min`/`max` yolunda**
olduğunu gösterdi (+3), ilk/son yolunda **+1**. İlk/son okuyan üç yer aynı
düzeltmeyi hak ediyor ama her biri bugün **iki satır** çekiyor; temizleme tüm
seriyi gerektirir ve o sorgu maliyeti ölçülmedi. Bu turda **yapılmadı** —
`lib/odometre.ts` hazır, bağlamak ayrı bir iş ve kendi ölçümünü ister.

---

## 4 · ÖLÇÜM — önce / sonra

### 4.1 `min`/`max` yolu (096'nın düzelttiği) — 2026-07, HAK61

| plaka | SQL min | SQL max | SQL km | temiz ilk | temiz son | **temiz km** | durum |
|---|---:|---:|---:|---:|---:|---:|---|
| DO-512GT | **0** | 99.540 | 99.540 | 98.783 | 99.540 | **757** | 🟢 KAZANILDI |
| DO-775GS | **13.055** | 119.096 | 106.041 | 118.119 | 119.096 | **977** | 🟢 KAZANILDI |
| DO-776GS | **12.543** | 116.788 | 104.245 | 116.303 | 116.788 | **485** | 🟢 KAZANILDI |
| DO-777GS | **140** | 36.327 | 36.187 | 35.186 | 36.327 | **1.141** | 🔴 km düzeldi *(%3.070 hata)* |
| DO-318GZ | 45.756 | 46.417 | 661 | 45.761 | 46.417 | 656 | km düzeldi |
| DO-719GV | 71.473 | 71.745 | 272 | 71.482 | 71.745 | 263 | km düzeldi |
| DO-746GU | 74.217 | 74.365 | 148 | 74.218 | 74.365 | 147 | km düzeldi |
| DO-805HK | 24.792 | 25.544 | 752 | 24.797 | 25.544 | 747 | km düzeldi |
| DO-806HK | 23.618 | 24.394 | 776 | 23.620 | 24.394 | 774 | km düzeldi |
| DO-808HK | 15.676 | 16.059 | 383 | 15.680 | 16.059 | 379 | km düzeldi |
| DO-818HF | 45.193 | 45.320 | 127 | 45.196 | 45.320 | 124 | km düzeldi |

**ölçülebilen araç: 23 → 26 (+3)** · ayrıca **8 araçta km düzeltmesi**

🔴 `DO-777GS` en tehlikelisi: 36.187 km "geçerli" görünüyordu (31 gün ×
1.500 km/gün makullük kapısının altında) ve **sessizce yanlış** raporlanıyordu.
Kapsama kaybı gürültülü, bu sessiz.

### 4.2 🔴 HANGİ RAPOR ETKİLENİR — ilk iddiam YANLIŞTI, ölçümle düzeltildi

Bu belgenin ilk sürümü *"km'si kurtulan araç `odometre_yok`'tan çıkıp CO₂ oran
kümesine girer"* diyordu. **096 çalıştırıldıktan sonra ölçüldü — yanlış.**

`ayOzetiYaz` iki AYRI kaynaktan besleniyor:

```
km, litre, olculemedi_sebep  ←  buildFuelReport(ay)        (lib/analytics.ts yolu)
odometre_ilk, odometre_son   ←  telemetry_month_spans RPC  (096'nın düzelttiği)
```

096 yalnız **ikinci** kaynağı düzeltiyor. `km` kolonu `buildFuelReport`'tan
geliyor ve o `getVehicleDistanceSpan`'i kullanıyor — 096'nın hiç dokunmadığı
bir yol. `olculemedi_sebep` de `km === null` kontrolünden türüyor, dolayısıyla
o da değişmiyor.

**Tazeleme simülasyonu** (096 canlıdayken, `ayOzetiYaz("2026-07-01")` gerçekten
koşturuldu, `upsert` HTTP katmanında yakalanıp gönderilmedi):

| alan | değişen araç |
|---|---:|
| `km` | **0** |
| `olculemedi_sebep` | **0** |
| `odometre_ilk` / `odometre_son` | **11** |

```
ölçülen araç   21 → 21        litre 1.392,10 → 1.392,10
```

Ve `odometre_ilk`/`odometre_son` kolonları **hiçbir yerde okunmuyor** —
depo genelinde tek geçtikleri yer kendi yazıldıkları satır
(`lib/saklama-db.ts:403-404`). Yani:

> 🔴 **096 + tazeleme bugün hiçbir müşteri rakamını değiştirmez.**
> Kolonlar doğru olur, ekranlar aynı kalır.

**Asıl düzeltme yeri `lib/analytics.ts` → `getVehicleDistanceSpan`.** § 3.2'de
"değiştirilmedi, kazanç +1" diye bıraktığım yer, ölçümden sonra **tek gerçek
kaldıraç** olarak görünüyor: CO₂'nin `odometre_yok` dediği araçlar oradan
geliyor.

### 4.3 096 canlı doğrulaması — RPC seviyesinde öngörü TAM TUTTU

096 üç kiracıda çalıştırıldı. `telemetry_month_spans('2026-07-01','2026-08-01')`
canlı çağrıldı (29 satır):

| plaka | `odometre_ilk` | `odometre_son` | km | öngörü | |
|---|---:|---:|---:|---:|---|
| DO-318GZ | 45.761 | 46.417 | 656 | 656 | ✅ |
| DO-512GT | **98.783** *(önce 0)* | 99.540 | 757 | 757 | ✅ |
| DO-719GV | 71.482 | 71.745 | 263 | 263 | ✅ |
| DO-746GU | 74.218 | 74.365 | 147 | 147 | ✅ |
| DO-775GS | **118.119** *(önce 13.055)* | 119.096 | 977 | 977 | ✅ |
| DO-776GS | **116.303** *(önce 12.543)* | 116.788 | 485 | 485 | ✅ |
| DO-777GS | **35.186** *(önce 140)* | 36.327 | **1.141** | 1.141 | ✅ |
| DO-805HK | 24.797 | 25.544 | 747 | 747 | ✅ |
| DO-806HK | 23.620 | 24.394 | 774 | 774 | ✅ |
| DO-808HK | 15.680 | 16.059 | 379 | 379 | ✅ |
| DO-818HF | 45.196 | 45.320 | 124 | 124 | ✅ |

**Ölçülebilen araç 26** — öngörü 26. **11/11 birebir.**

Yani kural ve SQL doğru çalışıyor; yalnız çıktısını tüketen kolon bugün
kimseye görünmüyor.

### 4.4 Atılan satır oranı — kural aşırı geniş değil

```
DO-512GT   3 / 1.671    (%0,18)
DO-775GS   9 / 25.949   (%0,03)
DO-776GS  17 / 20.231   (%0,08)
```

Binde birin altında. Kural bir "temizlik süpürgesi" değil, tekil aykırıları
alıyor.

---

## 5 · MUHAFIZ — `npm run lint:telemetri-siniri`

`scripts/check-telemetri-siniri.mjs`, `verify` zincirinde.

**Yakaladığı:** SQL'de `min(odometer_km)` / `max(odometer_km)` (ham uç değer),
ve TS'te odometre okuyup açıklık çıkaran ama `lib/odometre.ts` kullanmayan kod.

**Eskimiş migration muafiyeti — fonksiyon bazında.** Bir SQL fonksiyonu birden
çok migration'da tanımlanabilir; çalışan tanım **en yüksek numaralı** olandır.
090 hem `telemetry_month_spans`'i (096'da yenilendi) hem `purge_*`'ı (hâlâ
güncel) tanımlıyor — dosyayı toptan muaf tutmak ikincisini de kör ederdi.
Muhafız satırın hangi fonksiyon gövdesinde olduğunu bulup karar veriyor.

**Bilinçli istisna:** tek anlık okuma açıklık değildir —
`// telemetri-sinir: <gerekçe>` (SQL'de `-- telemetri-sinir:`). Gerekçesiz
muafiyet yok, pencere 8 satır.

### 5.1 Muhafızın kusuru yakaladığı — kanıt

096 geçici olarak kaldırıldı → 090 en yeni tanım oldu:

```
✗ TELEMETRİ SINIR RİSKİ — 2 bulgu
  db/migrations/090_saklama_politikasi.sql:583  [SQL ham uç değer]
      min(dt.odometer_km) filter (where dt.odometer_km is not null)::numeric as odometre_ilk,
  db/migrations/090_saklama_politikasi.sql:584  [SQL ham uç değer]
```

096 geri kondu → `✓ TELEMETRİ SINIRI — ham odometre uç değeri filtresiz
kullanılmıyor`.

### 5.2 `lib/odometre.ts` birim testleri — 8/8

`üst hız 200` · `1 sn'de ≥1 km tolerans` · `1 saatte 200 km` ·
`aşağı sapan atılıyor` · **`baştaki sıfır soyuluyor (monotonluk YETMEZ)`** ·
`açıklık doğru (757)` · `tek okuma → km null, "0 km" DEĞİL` ·
`atılan sayısı dışarı çıkıyor`.

Canlı veriye karşı da doğrulandı: **+3 araç**, beklenen değerlerle birebir
(DO-512GT 757 · DO-775GS 977 · DO-776GS 485).

---

## 6 · AÇIK KALANLAR

- ✅ **096 üç kiracıda çalıştırıldı** (31.08). Canlı doğrulama § 4.3 — öngörü
  11/11 tuttu.
- 🔴 **Asıl kaldıraç yapılmadı:** `lib/analytics.ts` → `getVehicleDistanceSpan`
  `lib/odometre.ts`'e bağlanmadı. Ölçüm (§ 4.2) bunun **tek gerçek kaldıraç**
  olduğunu gösterdi — CO₂'nin `odometre_yok` dediği araçlar oradan geliyor.
  096'nın düzelttiği kolonlar hiçbir ekranda okunmuyor.
- **İlk/son okuyan üç yer** (`analytics.ts`, `admin-dashboard.ts`,
  `backfill.ts`) bağlanmadı — § 3.2'deki gerekçe; sorgu maliyeti ölçülmeli.
- **20.08'de 69 sıfır** neden geldi `ÖLÇÜLMEDİ` — o günün cihaz olayı ayrı
  bir soru (kesinti? yeniden başlatma?).
- **`DO-753GS` 12.543 → 124.801 aralığı** — temizlemeden sonra da Temmuz'da
  ölçülemez kaldı. Seride iki ayrı odometre düzeyi var gibi görünüyor;
  gerçek cihaz değişimi olabilir. `ÖLÇÜLMEDİ`.
- **Sendigo / galzura-demo'da bozuk okuma envanteri** `ÖLÇÜLMEDİ`.
- Diğer 18 alan bugün temiz; bu bir **anlık** ölçüm, muhafız onları
  denetlemiyor (odometre dışı alanlarda açıklık hesabı yok).
