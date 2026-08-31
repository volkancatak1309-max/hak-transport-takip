# Odometre kuralını asıl kaynağa bağlama

> 31.08.2026 · Dal `fix/odometre-kaynak` · **push/deploy YOK** ·
> migration **097 ÇALIŞTIRILMADI**. Ölçüm HAK61'de **salt okuma**.
> Öncesi: [`BOZUK-TELEMETRI.md`](BOZUK-TELEMETRI.md)

---

## 0 · KISA CEVAP

| soru | cevap |
|---|---|
| Sorgu maliyeti kabul edilebilir mi? | **Uygulamada temizleme HAYIR** — 20,3× yavaş, 590.084 satır. **SQL'de EVET** — 1 sorgu, bugünküyle aynı süre. § 1 |
| DO-777GS raporlarda 36.187 mi diyordu? | 🔴 **HAYIR.** Ölçüldü: raporlar zaten **1.141** diyordu. 36.187 yalnız `telemetry_month_spans` çıktısıydı ve o kolon hiçbir ekranda okunmuyor. § 3 |
| 096 yeterli miydi? | **HAYIR** — ölçümle bulundu, üç araçta hâlâ imkansız değer üretiyor. 097 gerekti. § 2 |
| Kazanç? | km'si ölçülen **25 → 29 araç**, filo km **16.596 → 18.577** (+%11,9), L/100km **21 → 23 araç**, `buildFuelReport` **5,96 → 5,11 sn** ve **60 sorgu → 1**. § 4 |

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
"Sonrası" için RPC `lib/odometre.ts` çıktısıyla şimlendi (097 çalıştırılmadı).

| | 097 öncesi | 097 sonrası |
|---|---:|---:|
| `buildFuelReport` süresi | 5,96 sn | **5,11 sn** *(1,17× hızlı)* |
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

## 8 · ÖLÇEMEDİKLERİM

- **097'nin gerçek SQL çıktısı** — migration çalıştırılmadı; ölçüm
  `lib/odometre.ts` (aynı kural, JS) ile yapıldı. SQL'in birebir aynı sonucu
  verdiği ancak çalıştırıldıktan sonra doğrulanabilir (§ 7/1).
- **`fleet_odometer_spans` süresi** — `telemetry_month_spans` ölçüsünden
  (2,99 sn) türetildi; ay gruplaması olmadığı için daha hızlı olması beklenir,
  **ölçülmedi**.
- **Sendigo / galzura-demo etkisi** — bozuk okuma envanteri o kiracılarda
  çıkarılmadı.
- **2026-08 ve öncesi aylar** — yalnız 2026-07 ölçüldü.
- **`DO-753GS`'in 12.543–124.801 aralığı** — 097 kuralı 981 km veriyor ve makul,
  ama serideki 24 dağınık düşük okumanın kaynağı hâlâ `ÖLÇÜLMEDİ`.
