# Odometre kuralını asıl kaynağa bağlama

> 31.08.2026 · Dal `fix/odometre-kaynak` → **main'de** · migration **097 üç
> kiracıda çalıştırıldı** (Volkan). Ölçüm HAK61'de **salt okuma**.
> Öncesi: [`BOZUK-TELEMETRI.md`](BOZUK-TELEMETRI.md)

---

## 0 · KISA CEVAP

| soru | cevap |
|---|---|
| Sorgu maliyeti kabul edilebilir mi? | **Uygulamada temizleme HAYIR** — 20,3× yavaş, 590.084 satır. **SQL'de EVET** — 1 sorgu, bugünküyle aynı süre. § 1 |
| DO-777GS raporlarda 36.187 mi diyordu? | 🔴 **HAYIR.** Ölçüldü: raporlar zaten **1.141** diyordu. 36.187 yalnız `telemetry_month_spans` çıktısıydı ve o kolon hiçbir ekranda okunmuyor. § 3 |
| 096 yeterli miydi? | **HAYIR** — ölçümle bulundu, üç araçta hâlâ imkansız değer üretiyor. 097 gerekti. § 2 |
| Kazanç? | km'si ölçülen **25 → 29 araç**, filo km **16.596 → 18.577** (+%11,9), L/100km **21 → 23 araç**, odometre sorgusu **60 → 1**. ⚠️ Süre **düşmedi, %13 arttı** (5,96 → 6,73 sn) — öngörü tutmadı, § 9.3. |

---

## 1 · SORGU MALİYETİ — önce ölçüldü, sonra karar verildi

HAK61, 2026-07, 30 araç:

| yol | süre | sorgu | taşınan satır |
|---|---:|---:|---:|
| **bugünkü** — araç başına 2 sorgu (`limit 1` × 2) | **2,85 sn** | 60 | 2 |
| **uygulamada temizleme** — tüm seriyi çek | **57,87 sn** | 605 | **590.084** |
| **SQL RPC** — tüm filo tek sorgu | **2,99 sn** | **1** | 29 |

Ay penceresinde araç başına ortalama **19.669** odometre satırı var; 7 günlük
pencerede bile 197.013 satır.

🔴 **Uygulamada temizleme reddedildi.** 20,3× yavaşlama ve yarım milyon satır
taşımak, düzelttiği 4 aracın değerinden pahalı. Kural **SQL'de** kalıyor;
rapor katmanı yalnız çağırıyor — ve bunu yaparken araç-araç fan-out'u da
tek sorguya iniyor.

---

## 2 · 🔴 096 EKSİK ÇIKTI — bağlamadan önce yakalandı

Bağlama işi "096 doğru" varsayımına dayanıyordu. İlk ölçüm onu çürüttü:
096'nın "temizlenmiş" değerleri üç araçta hâlâ imkansızdı.

```
getVehicleDistanceSpan (bugünkü)   vs   096 telemetry_month_spans
  DO-505GS   null (inconsistent)          120.899 km   🔴
  DO-571GR   null (inconsistent)           95.765 km   🔴
  DO-753GS   null (inconsistent)          124.801 km   🔴
  DO-512GT   null (inconsistent)              757 km   ✅
```

Filo toplamı 16.596 → 358.809 km olurdu: **+%2062**. Bugünkü `inconsistent`
kapısı bu araçları eliyor ve **doğru yapıyor**.

### 2.1 Sebep: ardışık eşit blok

`DO-505GS`, 2026-07 başı: **13 ardışık sıfır**, sonra 120.849.

096'nın kapısı komşu ÇİFTE bakıyor: `sonraki − mevcut > izin` ise mevcut satırı
atar. `0 → 0` geçişi fiziksel olarak kusursuz (artış 0) — kapı geçiriyor.
Yalnız SON sıfır `0 → 120.849` çiftinde takılıyor; geriye **12 sıfır** kalıyor
ve `min` hâlâ 0. `DO-512GT` çözülmüştü çünkü sıfırı **tekti**.

Değer dağılımı (10.000 km kovaları) kanıtı:

```
DO-505GS      0–  9.999   █ 13          DO-753GS      0–  9.999  █ 9
        120.000–129.999   ████ 1.866            10.000– 69.999  █ 24 (dağınık)
                                               120.000–129.999  ████ 33.115
flespi_device_id: TEK cihaz — yani cihaz değişimi DEĞİL
```

### 2.2 Düzeltme: bloğu tek birim say

> Bir okumayı **sonraki FARKLI değere** bağla. Ardışık eşitler tek blok sayılır
> ve bütün olarak soyulur.

**Ek sabit gerekmez** — kuralın kendi uzantısı. `lib/odometre.ts` içinde
`sonrakiFarkli`/`oncekiFarkli`; SQL'de `lag` ile blok başı çıkarımı (097).

Düzeltilmiş kuralla, canlı veriye karşı:

| araç | bugünkü | 096 | **097 kuralı** |
|---|---:|---:|---:|
| DO-505GS | null | **120.899** 🔴 | **50** ✓ |
| DO-512GT | null | 757 | **757** ✓ |
| DO-571GR | null | **95.765** 🔴 | **248** ✓ |
| DO-753GS | null | **124.801** 🔴 | **981** ✓ |
| DO-671GY | 619 | 619 | 599 |
| DO-672GY | 491 | 491 | 465 |
| DO-719GV | 272 | 263 | 263 |

Ölçülen araç: bugünkü **25** · 096 **26** · **097 kuralı 29**.

---

## 3 · KİM NEREDEN OKUYOR — tam tarama

| rapor / ekran | odometre kaynağı | 096'dan etkilendi mi | 097'den etkilenir mi |
|---|---|---|---|
| **Yakıt raporu** (`buildFuelReport`) `km`, `L/100km` | `getVehicleDistanceSpan` — araç başına 2 sorgu (`reports.ts:1158`) | ❌ hayır | ✅ **evet** |
| **Mesafe raporu** (`buildDistanceReport`) | `loadBase.distanceByVehicle` → aynı fonksiyon (`reports.ts:248`) | ❌ | ✅ |
| **Hız raporu** `per100Km` | aynı `loadBase` | ❌ | ✅ |
| **CO₂ panosu** (`co2Panosu`) `km`, `g/km` | `buildFuelReport` satırları | ❌ | ✅ |
| **Aylık metrik** `vehicle_month_metrics.km` | `buildFuelReport` | ❌ | ✅ |
| `vehicle_month_metrics.odometre_ilk/son` | `telemetry_month_spans` | ✅ evet | ✅ |
| **Maliyet raporu** €/km | `CostBasis.km` ← **vardiya `start_km`/`end_km`** (`time_entries`) | ❌ | ❌ **ayrı kaynak** |
| **Şoför skoru** | `shiftKmForScoring` ← vardiya sayaç farkı | ❌ | ❌ **ayrı kaynak** |
| **Haftalık aksiyon** yakıt sapması | `buildFuelReport.lPer100Km` | ❌ | ✅ |
| Bakım km'si · kârlılık sefer km'si | **tek anlık** okuma | ❌ | ❌ açıklık değil |

🔴 **Önemli ayrım:** maliyet ve şoför skoru odometre telemetrisinden
**beslenmiyor** — vardiya sayaç farkından (`time_entries.start_km/end_km`)
geliyor ve orada `lib/km-quality.ts` ayrı bir kapı tutuyor. Bu iş onları
etkilemiyor.

### 3.1 DO-777GS yanlış anlaşılması — düzeltildi

Görev metni *"DO-777GS hâlâ 36.187 km rapor ediyor"* diyordu. **Ölçüldü:
hayır.** Raporlar zaten **1.141 km** gösteriyordu; `getVehicleDistanceSpan`
ilk/son **zamanlı** okumayı alıyor ve o araçta uçlar temizdi. 36.187 yalnız
`telemetry_month_spans`'in ham `min`/`max` çıktısıydı — ve o kolon
(`odometre_ilk`/`odometre_son`) depo genelinde hiçbir ekranda okunmuyor.

Yani %3.070'lik hata gerçekti ama **görünmez** bir kolondaydı.

---

## 4 · ÖLÇÜM — 097 öncesi / sonrası

`buildFuelReport` + `buildDistanceReport` + `buildSpeedReport`, 2026-07, HAK61.
"Sonrası" için RPC `lib/odometre.ts` çıktısıyla şimlendi (o an 097
çalıştırılmamıştı). ⚠️ **Şim ağ maliyetini içermiyordu** — süre satırı bu
yüzden yanıltıcı; 097 canlıyken alınan gerçek ölçüm § 9.3'te.

| | 097 öncesi | 097 sonrası |
|---|---:|---:|
| `buildFuelReport` süresi | 5,96 sn | **5,11 sn** *(1,17× hızlı)* ⚠️ **bu sayı ŞİMLİ ölçümdür; gerçeği 6,73 sn — § 9.3**|
| odometre sorgusu | 60 | **1** |
| km'si ölçülen araç | 25/29 | **29/29** |
| **filo km** | **16.596** | **18.577** *(+1.981 · %11,9)* |
| L/100km ölçülen araç | 21 | **23** |
| mesafe raporu | 16.596 km · 25/29 | **18.577 km · 29/29** |
| hız raporu `per100Km` | 25/29 | **29/29** |

**Kazanılan dört araç:**

| araç | km | L/100km |
|---|---:|---|
| DO-753GS | 981 | — *(yakıt verisi yok)* |
| DO-512GT | **757** | **7,05** |
| DO-571GR | **248** | **16,03** |
| DO-505GS | 50 | — |

Kaybedilen araç: **yok**. Mevcut 25 aracın km'si **değişmedi**.

---

## 5 · 🔴 MÜŞTERİ ETKİSİ — bu sefer rakamlar gerçekten değişiyor

| ekran | değişim | müşteri fark eder mi |
|---|---|---|
| **Mesafe raporu** filo toplamı | 16.596 → **18.577 km** (+%11,9) | 🔴 **EVET** — en görünür değişim |
| Mesafe raporu kapsama | 25/29 → **29/29** | 🔴 evet — "4 araç daha ölçüldü" |
| **Yakıt raporu** L/100km satır sayısı | 21 → 23 araç | 🟡 iki yeni satır dolar |
| **Hız raporu** ihlal/100km | 25 → 29 araçta hesaplanır | 🟡 dört yeni satır |
| **CO₂ panosu** km ve g/km | filo km +%11,9 → **g/km düşer** (aynı kg, büyük payda) | 🔴 **EVET** |
| Aylık metrik `km` | tazelenen aylarda artar | 🟡 trend grafiğinde |
| **Maliyet** €/km · €/paket | **değişmez** — ayrı kaynak | ❌ |
| **Şoför skoru** | **değişmez** — ayrı kaynak | ❌ |

**"Km neden arttı?" sorusunun cevabı:** artmadı — *daha önce ölçülemeyen dört
araç artık ölçülüyor*. Filo daha çok yol yapmadı; rapor daha çok aracı
kapsıyor. Kapsama sayısı (`25/29 → 29/29`) bunu ekranda gösteriyor, o yüzden
cevap zaten yüzeyde.

⚠️ **CO₂ g/km düşecek** çünkü payda büyüyor, pay (kg) aynı kalıyor — kazanılan
dört aracın ikisinde yakıt verisi yok. Bu **doğru** yönde bir düzelme:
daha önce o araçların kilometresi hiç sayılmıyordu.

---

## 6 · YAPILAN İŞ

| dosya | değişiklik |
|---|---|
| `lib/odometre.ts` | ardışık eşit blok soyma (`sonrakiFarkli`/`oncekiFarkli`) |
| `db/migrations/097` | **YENİ** — `telemetry_month_spans` blok kuralıyla düzeltildi + **`fleet_odometer_spans`** (filo geneli, rastgele aralık, tek sorgu) |
| `lib/analytics.ts` | **`getFleetDistanceSpans`** — RPC'yi çağırır, yoksa `null` döner |
| `lib/reports.ts` | iki fan-out noktası (`loadBase` · yakıt raporu) tek çağrıya bağlandı; RPC yoksa bugünkü araç-araç yoluna düşer |

**FAIL-SAFE:** 097 çalıştırılmadan davranış **değişmiyor** — ölçüldü:
097 öncesi turda km 25/29, filo 16.596 km, yani bugünkü değerlerin aynısı.
`filoSpanRpcVar` bayrağı RPC'nin yokluğunu bir kez öğrenir, her istekte
yeniden denemez.

---

## 7 · SIRADAKİ ADIM — çalıştırma sırası

1. **097'yi üç kiracıda çalıştır.** Sonra migration sonundaki eşdeğerlik
   sorgusunu koştur: **hiçbir araçta 46.500 km'yi (31 × 1.500) aşan değer
   olmamalı.** Aşan çıkarsa kod deploy EDİLMEMELİ — kural o araçta hâlâ
   yetmiyor demektir (096'da tam bu oldu).
2. **Kodu deploy et.** RPC hazır olduğu için ilk istekte devreye girer.
3. **Tazele** — artık anlamlı, çünkü `km` gerçekten değişiyor:

```
GET https://<dağıtım>/api/cron/aylik-metrik?geri=2&tazele=1
Authorization: Bearer <o kiracının CRON_SECRET'i>
```

| kiracı | tam URL |
|---|---|
| HAK61 | `https://hak-transport-takip.vercel.app/api/cron/aylik-metrik?geri=2&tazele=1` |
| Sendigo | `https://sendigo-delta.vercel.app/api/cron/aylik-metrik?geri=2&tazele=1` |
| galzura-demo | `https://demo.galzura.com/api/cron/aylik-metrik?geri=2&tazele=1` |

`geri=2` → 2026-07 ve 2026-06. Bozuk okuma yalnız 07–08'de; 08 açık ay olduğu
için zaten yazılmıyor.

**Risk:** gerçek `upsert`, HAK61 canlı müşteri. Bu sefer değerler **gerçekten
değişecek** (§ 5). Geri alınamaz. **Süre:** ~10–12 sn, `maxDuration = 300`
rahat yeter.
**Sıra önemli:** önce 097, sonra deploy, en son tazele. Tazelemeyi deploy'dan
önce yaparsanız eski kodla eski değerler yeniden yazılır ve hiçbir şey değişmez.

---

## 9 · 097 CANLI — doğrulama (31.08.2026 akşamı)

097 üç kiracıda çalıştırıldı, kod main'e alındı, üç kiracıda deploy
**success**. HAK61 canlı, salt okuma:

### 9.1 RPC devrede

```
fleet_odometer_spans        ✅ 29 araç · 2,02 sn
buildFuelReport sorgu dökümü:
    device_telemetry                      81   ← yakıt penceresi fan-out'u
    rpc:report_fuel_stats_vehicle         29
    rpc:report_fuel_volume_stats_vehicle  29
    rpc:fleet_odometer_spans               1   ← ÖNCE 60 device_telemetry idi
    vehicles 2 · workers 2                     TOPLAM 144
```

### 9.2 Sayılar — öngörü 6/6 tuttu

| ölçüm | önce | **gerçek** | öngörü | |
|---|---:|---:|---:|---|
| km'si ölçülen araç | 25/29 | **29/29** | 29/29 | ✅ |
| filo km (yakıt raporu) | 16.596 | **18.577** | 18.577 | ✅ |
| L/100km ölçülen araç | 21 | **23** | 23 | ✅ |
| mesafe raporu km | 16.596 | **18.577** | 18.577 | ✅ |
| mesafe kapsama | 25/29 | **29/29** | 29/29 | ✅ |
| hız `per100Km` ölçülen | 25/29 | **29/29** | 29/29 | ✅ |

Kazanılan dört araç, **birebir**:

```
DO-753GS  981 km            DO-512GT  757 km · L/100km 7,05
DO-571GR  248 km · 16,03    DO-505GS   50 km
```

### 9.3 🔴 SÜRE ÖNGÖRÜSÜ TUTMADI — sebebi ölçüldü

| | öngörü | gerçek |
|---|---:|---:|
| `buildFuelReport` | 5,11 sn *(1,17× hızlı)* | **6,73 sn** *(3 tur medyan)* — 097 öncesi 5,96 sn'ydi |

**%13 YAVAŞLADI, hızlanmadı.** Sebep, ölçüm yönteminin kusuru: § 4'teki
"sonrası" turunda RPC bir **şimle** karşılanıyordu, yani ağ maliyeti sıfırdı.
Gerçek RPC **2,02 sn** sürüyor. Aradaki fark (6,73 − 5,11 ≈ 1,6 sn) tam olarak
bu.

Karşılaştırma dürüst hâliyle:

```
097 öncesi   5,96 sn · odometre için 60 paralel `limit 1` sorgusu (mapBounded 6)
097 sonrası  6,73 sn · odometre için 1 ağır pencere-fonksiyonu sorgusu (2,02 sn)
```

60 hafif indeksli sorgu, 1 ağır sorgudan **hızlıydı**. Sorgu sayısı düştü ama
duvar saati arttı. **Kabul edildi**: +0,77 sn karşılığında 4 araç kazanıldı ve
km'ler doğrulandı. Doğruluk hız için feda edilmez — ama ölçüm bunu "hızlanma"
diye satmamalı.

⚠️ § 8'de bu risk zaten yazılıydı: *"`fleet_odometer_spans` süresi
`telemetry_month_spans` ölçüsünden türetildi, **ölçülmedi**"*. Türetim yanlış
çıktı.

### 9.4 Tazelemenin gerçek etkisi — ölçüldü (yazmadan)

`ayOzetiYaz("2026-07-01")` 097 canlıyken koşturuldu, `upsert` HTTP katmanında
yakalanıp gönderilmedi:

| alan | değişen araç |
|---|---:|
| `km` | **7** |
| `olculemedi_sebep` | **3** |
| `odometre_ilk` / `odometre_son` | 16 |

```
ölçülen araç   21 → 24        litre 1.392,10 → 1.485,46  (+93,36 L)
```

Sebep değişen üç araç: `DO-512GT` · `DO-571GR` · `DO-505GS` —
`odometre_yok` → `null`. Bu tam olarak
[`ORAN-KUME-KURALI.md`](ORAN-KUME-KURALI.md) § 1'deki üç araç: litresi bilinen
ama km'si olmadığı için CO₂ **oran kümesinin dışında** kalanlar. Artık
içerideler.

🔴 **BOZUK-TELEMETRI.md § 4.2'deki "müşteri rakamı değişmez" tespiti artık
GEÇERSİZ.** O, 096 için doğruydu (`km` başka kaynaktan geliyordu). 097 + bu
bağlama işi o kaynağı da düzelttiği için tazeleme **gerçekten değiştiriyor**.

---

## 8 · ÖLÇEMEDİKLERİM

- ✅ **097'nin gerçek SQL çıktısı** — çalıştırıldı, doğrulandı (§ 9.2).
  Volkan'ın eşdeğerlik sorgusu: 29/29 araç, imkansız değer yok, en yüksek
  km 2.011 (DO-788GS).
- ✅ **`fleet_odometer_spans` süresi** — ölçüldü: **2,02 sn**. Türetim
  yanlıştı, § 9.3.
- **Sendigo / galzura-demo etkisi** — bozuk okuma envanteri o kiracılarda
  çıkarılmadı.
- **2026-08 ve öncesi aylar** — yalnız 2026-07 ölçüldü.
- **`DO-753GS`'in 12.543–124.801 aralığı** — 097 kuralı 981 km veriyor ve makul,
  ama serideki 24 dağınık düşük okumanın kaynağı hâlâ `ÖLÇÜLMEDİ`.

---

# 9 · 17.09.2026 — 105: TEK ÇEKİRDEK (16c, adım 1)

> 097 bir ölçüm kuralını SQL'e taşıdı. Ama uygulamadaki **yedek yol**
> (`getVehicleDistanceSpan`) o kurala hiç geçmedi: aralığın **ham** ilk ve son
> odometre okumasını alıyordu. İki yol aynı araca farklı km veriyordu ve
> hangisinin koştuğu **yüke** bağlıydı.

## 9.1 · Ayrışma ölçüldü — kural farkı, veri değil

İki kiracıda, **iki ayrı yönde** (17.09.2026, salt okuma):

| kiracı · araç | pencere | 097 (temiz) | yedek yol (ham uçlar) | fark |
|---|---|---:|---:|---|
| galzura-demo · `W-GF-107` | 30 gün | **592 km** | `null` — ham `0 → 97.296` makul değil | eksik |
| HAK61 · `DO-512GT` | 14 gün | **692 km** | **751 km** — ham `101.900 → 102.651` | **+%8,5** |

Yani yedek yol bir araçta **eksik**, öbüründe **fazla** sayıyor. Sebep veri
değil **kural**: 097 monoton filtre + blok başı + fiziksel atlama kapısından
geçirilmiş uçları kullanıyor, yedek yol hiçbirini uygulamıyordu.

Bunun görünür sonucu `buildFuelReport.fleetLPer100Km`ti: demo'da aynı kapalı
pencerede **72,475250** ya da **75,250365** (%3,8) çıkıyordu. 101–104
şüphelenilmişti; RPC seviyesinde o pencerede **sapan 0** ölçüldü — sebep
paydaydı.

## 9.2 · 097'nin maliyet profili (önce)

3 koşum medyan, canlı, rakipsiz:

| pencere | demo satır / süre | HAK61 satır / süre |
|---|---:|---:|
| 3 gün | 87.726 / **562 ms** | 87.864 / **424 ms** |
| 7 gün | 185.334 / **993 ms** | 185.335 / **718 ms** |
| 14 gün | 377.537 / **1.800 ms** | 380.537 / **1.205 ms** |
| 30 gün | 821.026 / **3.922 ms** | 873.446 / **2.403 ms** |
| 60 gün | 994.026 / **4.701 ms** | — |

Satır başına maliyet **düz** (demo ~4,7 µs · HAK61 ~2,75 µs) — yani darboğaz
tek bir patlayan adım değil, **taranan satır sayısı**. 8 sn'lik ifade tavanına
demo'da 60 günde yaklaşılıyor; tavanı aşınca RPC `null` dönüyor ve yedek yol
devreye giriyordu.

## 9.3 · Plan: neden indeks kullanılamıyordu

097'nin `where`i yalnız `recorded_at` aralığı. Araç yüklemi olmadığı için
053'ün `(vehicle_id, recorded_at) include (odometer_km)` indeksi devre dışı.
PGlite'ta ölçüldü (216.000 satır · 30 araç · aynı indeksler):

```
Seq Scan on device_telemetry ... rows=216.000
GroupAggregate ... temp read=2165 written=2168      ← DİSKE TAŞIYOR
```

LATERAL sürümde her araç kendi indeks aralığından **zaten sıralı** gelir;
küresel sıralama ve disk taşması kalkar:

| | süre |
|---|---:|
| A · bugünkü (kapsamsız + sort) | 480 ms |
| B · LATERAL (araç başına indeks) | **302 ms** (−%37) |

ve iki sürümün çıktısı **30/30 araçta birebir aynı**.

## 9.4 · 105 ne yapıyor

```
vehicle_odometer_span(p_from, p_to, p_vehicle_id)   ← KURALIN TEK EVİ
fleet_odometer_spans(p_from, p_to)                  ← onu LATERAL ile çağırır
```

Gövde 097'den birebir taşındı; tek fark `partition by vehicle_id` kalktı
(tek araç zaten tek bölüm). Uygulamadaki araç-araç yol da artık aynı
fonksiyonu çağırıyor — **ayrışma kaynağında bitti**.

⚠️ **Dürüst sınır:** %37 tek başına "< 1 sn" hedefini tutturmaz. HAK61 30 gün
2.403 ms → beklenen ~1,5–2,5 sn. Bu turda kazanılan asıl şey **doğruluk**.
Ek hızlanma (pencere kırpma, float8 iç hesap) ayrı bir tur; ikisi de kuralı
değiştirme riski taşıdığı için ALINMADI.

## 9.5 · "Ölçülemedi" — yanlış sayının yerine

Geçici hatada (ifade tavanı dâhil) artık **ham uçlara düşülmüyor**. Ham uçlar
başka bir kural; oraya düşmek *yanlış bir sayı* üretir. Yeni sebep:

| sebep | anlamı | yöneticiye söylediği |
|---|---|---|
| `no_odometer` | aralıkta hiç odometre okuması yok | cihazı kontrol ettir |
| `inconsistent` | sayaç geri saymış / makul sınırı aşmış | cihaz değişimi mi? |
| **`olculmedi`** | **ölçüm yapılamadı** | veri sağlam, **biz okuyamadık** |

`olculmedi` cihaz kusuru **değildir** ve ekranda öyle görünmemelidir; üç dilde
ayrı karşılığı var (`ratio_reason_olculmedi`, `fuel_reason_olculmedi`,
`fuel_reason_short_olculmedi`).

⚠️ 105 uygulanmamış kiracıda araç-araç yol **bugünkü ham-uç davranışına**
düşer (latch'li, `missing_function` ile) — davranış birebir değişmez.

## 9.6 · Bilerek yapılan iki davranış değişikliği

1. Filo sürümü artık `public.vehicles` üzerinden geçiyor. `device_telemetry`de
   olup `vehicles`te olmayan araç çıktıya **girmez** (097'de girerdi).
   Tüketicilerin hepsi zaten `vehicles` ile eşliyor.
2. Araç-araç yolun zaman yüklemi `>= p_from and < p_to` oldu (097'nin biçimi);
   eski uygulama yolu `<= endISO` kullanıyordu. İki yol aynı olsun diye.

## 9.7 · Kanıt

- `npm run verify:filo-span` — PGlite, **21/21**: dört pencerede 097 = 105
  bayt-bayt · tek çekirdek 8/8 araç · bilinen tek fark ölçüldü · **yedi arıza
  enjeksiyonunun yedisi de yakalandı**.
- `npm run lint:filo-span` — **26 denetim**; arıza enjeksiyonu **6/6**
  (sessiz geri düşüş, kural kopyası, eşik sapması, kapı taşınması, RPC
  kopması, eksik dil anahtarı).
- Canlı önce/sonra ölçümü **105 uygulandıktan sonra** yapılabilir; bu belgeye
  o zaman eklenecek.

## 9.8 · Ölçülemeyen bir değişiklik — kayda geçirildi

`odometer_km >= kosan_max` yerine `> kosan_max` yazmak **çıktıyı
değiştirmiyor**: blok başı indirgemesi (`odometer_km <> onc_km`) eşit satırı
zaten atıyor. PGlite'ta dört pencerede ölçüldü, sapma yok. Bunu arıza
enjeksiyonu listesine koymak testi *sahte bir boşluk* raporlamaya iterdi;
koymayıp susmak da kimseye sebebini söylemezdi. Ölçüp yazdık
(`verify-filo-span-tek-cekirdek.mjs` § 5).
