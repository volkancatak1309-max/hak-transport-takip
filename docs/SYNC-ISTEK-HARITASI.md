# flespi sync turu — veritabanı istek haritası

> 28.08.2026 · **SALT OKUMA TURU.** Kodda tek harf değişmedi, dosya
> düzenlenmedi, migration yazılmadı, DB'ye tek yazma yapılmadı, dal açılmadı.
> Kaynak: kod okuma + `pg_stat_statements` çıktısının koda bağlanması.

---

## 0 · CEVAP ÖNCE: HİPOTEZ GEÇMİŞTE DOĞRU, BUGÜN YANLIŞ

> **Hipotez:** "bu sorgular sync turunda araç başına ayrı ayrı koşuyor
> (29 araç × N sorgu × tur), toplu tek sorgu yerine."

**Geçmiş için DOĞRU. Bugünkü kod için ÇÜRÜK.** `pg_stat_statements` sayaçları
**kümülatiftir** ve bu sayaçların ~%78'i, toplu okumaların koda girdiği
**18-20.08.2026'dan ÖNCE** birikti.

Listedeki 14 imzanın **7'si** bugün artık araç başına koşmuyor; kodda
toplu okumaya çevrilmişler. Kalan yükün en net tekil kalemi ise
`UPDATE vehicles SET vin` (§ 3).

### 0.1 Çapa: tur sayısı

`vehicles WHERE flespi_device_id IS NOT NULL` (136.096) tur başına **tam bir
kez** koşuyor (`sync/route.ts:64`) ve bu select listesiyle başka çağıranı yok.
→ **sayaç penceresi = 136.096 tur.**

Sync aralığı önceki turda ölçüldü: **30 sn** (p50 30 · min 29 · maks 31,
`ingested_at` kümelenmesinden). 136.096 × 30 sn = **47,3 gün** →
pencere ~**12.07.2026**'da başlıyor. `device_telemetry`nin en eski kaydı
13.07 — tutuyor.

### 0.2 Toplu okumaların git tarihleri `[DOĞRULANDI]`

| Tarih | Commit | Ne değişti |
|---|---|---|
| 18.08 | `87af357` | #84 Adım 1 — `lastRecordedAtBatch` (imleç 29 → 1) |
| 18.08 | `00b5c58` | #84 Adım 2 — `idleCursorsBatch` (rölanti 58 → 1) |
| 18.08 | `b90b552` | #84 Adım 3 — `saveTelemetryBatch` (yazma 29 → parti) |
| 19.08 | `4150623` | #84 Adım 4 — `turMemo` (depo bölgeleri 6-7 → 1) |
| 19.08 | `424a053` | #116a — `activeDtcBatch` (`vehicle_dtc` 29 → 1) |
| 19.08 | `ab3732e` | #116b — `latestTelemetryBatch` (canlı telemetri 29 → 2) |
| 20.08 | `c1bc8b3` | #131a — `workersByIdBatch` (şoför künyesi 29 → 1) |

Pencerenin optimizasyon **öncesi** payı: 18.08'e kadar 37 gün =
**106.560 tur (%78,3)** · 19.08'e kadar 109.440 (%80,4) · 20.08'e kadar
112.320 (%82,5).

### 0.3 🔑 KANIT: sayılar optimizasyon-öncesi tur sayısına bölününce 29'a oturuyor

Bu, tarih tesadüfü olmadığının kanıtı. Üç bağımsız imza, üç bağımsız fit:

| imza | çağrı | ÷ 136.096 (tüm pencere) | ÷ opt-öncesi tur | beklenen |
|---|---:|---:|---:|---|
| `device_telemetry` son `recorded_at` | 2.939.811 | 21,6 | **27,6** | **29** — döngüde koşulsuz ✓ |
| `device_telemetry` 19 kolon (canlı) | 2.969.248 | 21,8 | **27,1** | **29** — döngüde koşulsuz ✓ |
| `geofences active+purpose` | 773.204 | 5,68 | **7,06** | **"6-7"** — `turMemo` yorumunun kendi ölçümü ✓ |

Üçüncüsü belirleyici: `lib/query-counter.ts:60` içinde, benim ölçümümden
bağımsız olarak yazılmış bir cümle var — *"Ölçüldü: senkron turu başına 6-7
`geofences` sorgusu"*. Ben aynı sayıyı `pg_stat_statements`ten
**7,06** olarak buldum. İki ölçüm birbirini doğruluyor ve ikisi de
`turMemo` öncesini anlatıyor.

Koşullu olanlar da tutarlı (29'un ALTINDA kalmaları beklenir, çünkü yalnız
verisi olan araçta koşuyorlar):

| imza | ÷ opt-öncesi | koşul |
|---|---:|---|
| `idle_episodes` (çift) | 24,1 | `if (idle.length > 0)` |
| `device_telemetry` INSERT 21 kolon | 17,5 | `if (points.length > 0)` |
| `vehicle_dtc` aktif liste | 11,8 | `if (dtc.length > 0)` |
| `workers WHERE id` | 7,5 | yalnız auto-start adayları |

---

## 1 · TURUN TAM ÇAĞRI HARİTASI (bugünkü kod)

V = cihazlı araç sayısı = **29**. `Vp` = bu turda noktası gelen araç,
`Vi` = rölanti okuması gelen araç, `Vd` = DTC anlık görüntüsü gelen araç,
`Vv` = VIN bildiren araç. Hepsi ≤ V.

### A · DÖNGÜDEN ÖNCE — araç sayısından BAĞIMSIZ

| # | dosya:satır | tablo / RPC | filtre | tur başına |
|---|---|---|---|---:|
| A1 | `sync/route.ts:64` | `vehicles` | `flespi_device_id not null` | **1** |
| A2 | `telemetry.ts:79` | RPC `last_recorded_at_batch` | `p_vehicle_ids` | **1** |
| A3 | `telemetry.ts:606` | RPC `idle_episode_cursors_batch` | `p_vehicle_ids` | **1** |
| A4 | `zone-visits.ts:84` | `geofences` | `active=true, purpose='customer'` | **1** |
| A5 | `zone-visits.ts:107` | `zone_visits` | `ended_at is null` | **1** · yalnız A4 > 0 satır dönerse |

> A5 HAK61'de bugün **koşmuyor**: `geofences` tablosunda toplam 2 satır var
> (önceki turda ölçüldü) ve rota yorumu "HAK61'de müşteri bölgesi tanımlı
> değil" diyor. Bölge tanımlanırsa A5 + § C4 devreye girer.

### B · ARAÇ DÖNGÜSÜ — `for (const v of vehicles)`, **SIRALI**

| # | dosya:satır | tablo | döngüde? | tur başına | not |
|---|---|---|---|---:|---|
| B0 | `flespi.ts:504` | *(flespi HTTP)* | ✅ içinde | **V = 29** | DB değil; `count=1000` |
| B1 | `telemetry.ts:45` | `device_telemetry` | ✅ içinde | **0** | yalnız A2 `null` dönerse → V |
| B2 | `telemetry.ts:559` | `idle_episodes` (açık) | ✅ içinde | **0** | yalnız A3 `null` dönerse → Vi |
| B3 | `telemetry.ts:571` | `idle_episodes` (son kapalı) | ✅ içinde | **0** | aynı |
| B4 | `telemetry.ts:677/698/715` | `idle_episodes` **YAZMA** | ✅ içinde | **0..n** | rölanti geçişi başına 1 |
| B5 | `telemetry.ts:690` | `idle_episodes` (yarış) | ✅ içinde | **0** | yalnız 23505 |
| B6 | `telemetry.ts:361` | `vehicle_events` | ✅ **iç içe döngü** | **0..(Vₑ×T)** | T = bu araçta bulunan farklı cooldown'lu olay türü |
| B7 | `telemetry.ts:399` | `vehicle_events` **YAZMA** | ✅ içinde | **0..Vₑ** | |
| B8 | `telemetry.ts:1490` | `vehicles` **YAZMA** | ✅ içinde | **Vv ≈ 2,7** | 🔴 § 3 |
| B9 | `zone-visits.ts:172` | — | ✅ içinde | **0** | saf geometri, sorgu YOK |

> **B6 tek gerçek iç içe döngüdür.** `saveVehicleEvents` içinde
> `for (const type of cooldownTypes) { … }` — araç × olay türü. Olay yoksa
> hiç koşmaz; `vehicle_events` günde 95 satır büyüyor, yani nadir.

### C · DÖNGÜDEN SONRA

| # | dosya:satır | tablo | tur başına | not |
|---|---|---|---|---:|
| C1 | `telemetry.ts:180` | `device_telemetry` **YAZMA** | **⌈satır/500⌉ ≈ 1** | parti sınırı 500 |
| C2 | `telemetry.ts:264` | `device_telemetry` sayım | **1** | geri-okuma muhafızı; yalnız satır varsa |
| C3 | `telemetry.ts:1200` | `vehicle_dtc` | **1** | `activeDtcBatch` |
| C4 | `telemetry.ts:1279` | `vehicle_dtc` | **0..(Vd−1)** | 1. anlık görüntü tohumdan; 2.+ CANLI okunur |
| C5 | `telemetry.ts:1293/1299/1316` | `vehicle_dtc` **YAZMA** | **0..n** | kod başına |
| C6 | `telemetry.ts:1256` | `device_telemetry` odometre | **0..Vd** | yalnız YENİ kod eklenirken, çağrı başına ≤1 |
| C7 | `telemetry.ts:1438` | `vehicle_dtc` sayım | **0..Vd** | `reconcileDtc`, `dtcNumber != null` ise |
| C8 | `telemetry.ts:1450` | `vehicle_dtc` en yeni | **0..Vd** | yalnız C7 sayımı uyuşmazsa |
| C9 | `zone-visits.ts:346/365/384` | `zone_visits` **YAZMA** | **0..3** | yalnız bölge varsa |
| C10 | `sefer-bridge.ts:141` | `seferler` | **1** | aday yoksa hemen çıkar |
| C11 | `sefer-bridge.ts:177` | `zone_visits` | **0..1** | yalnız bekleyen durak varsa |
| C12 | `telemetry.ts:743` | `idle_episodes` | **1+** | sayfalı bekçi |

### D · `processAutoShifts()` — turun sonunda, tek çağrı

| # | dosya:satır | tablo / RPC | tur başına |
|---|---|---|---:|
| D1 | `auto-shift.ts:471` | `vehicles` | **1** |
| D2 | `auto-shift.ts:491` | `time_entries` (açık) | **1** |
| D3 | `shift-day.ts` (`workersWithShiftToday`) | `time_entries` | **1** |
| D4 | `leaves` (`approvedLeaveWorkerIdsForDay`) | `worker_leaves` | **1** |
| D5 | `depot.ts:72` | `geofences` depo | **1** *(turMemo)* |
| D6 | `telemetry.ts:1006` | `device_telemetry` (`latestTelemetryBatch`) | **2** (29 araç → 2 parça) |
| D7 | `auto-shift.ts:390` | `workers` (`workersByIdBatch`) | **1** |
| D8 | `auto-shift.ts:607` | `workers` tekil | **0** — D7 fallback'i |
| D9 | `depot.ts:313` | `device_telemetry` iz | **0..Va** | 🔴 § 4.2 |
| D10 | `auto-shift.ts:634` | `time_entries` | **0..Va** | `resolveStartKm` |
| D11 | `auto-shift.ts:654` | `time_entries` **YAZMA** | **0..Va** | vardiya açılışı |
| D12 | otomatik BİTİRME bloğu | — | **0** | 🔴 `SHIFT_AUTO_END` varsayılanı **`off`** → `auto-shift.ts:733` `continue` |

`Va` = auto-start kapılarının hepsinden geçen araç sayısı. Günde ~10-15
vardiya açıldığına göre `Va` turların ezici çoğunluğunda **0**.

> **D12 önemli:** otomatik bitirme kapalı olduğu için `lastActivityMs`in
> **araç başına 4 paralel sorgusu** (`auto-shift.ts:310-345`),
> `lastFixInDepot` ve `resolveEndKm` HAK61'de **hiç koşmuyor**. Bayrak
> açılırsa tur başına +4×(açık vardiya) sorgu gelir — kapalı olduğu için
> bu haritada 0.

### E · FORMÜL

```
TUR_TOPLAMI ≈ 5 (A)                    ← A5 bölge yoksa 4
            + 0 (B, toplu yol sağlamken)
            + Vv         (B8  · VIN güncellemesi)
            + B4 + B6 + B7 (rölanti/olay yazmaları — genelde ~0)
            + 1 (C1) + 1 (C2) + 1 (C3) + 1 (C10) + 1 (C12)
            + C4..C8     (DTC kuyruğu, ≤ 4×Vd)
            + 8 (D1..D7, D6 iki sayılır)
            + 3×Va       (D9,D10,D11)

SABİT TABAN ≈ 17-18 sorgu/tur   ·   ARAÇ EKSENLİ ≈ Vv + DTC kuyruğu + 3Va
```

> Karşılaştırma: `#84 Adım 0` ölçümü optimizasyon öncesi **169 sorgu/tur**
> demişti. Bugünkü taban ~17-18. `pg_stat_statements`'ta hâlâ görünen büyük
> sayılar o 169'luk dönemin kalıntısı.

---

## 2 · 14 İMZANIN KODA BAĞLANMASI

| # | çağrı | ÷tur | bağlandığı yer | bugün hâlâ araç başına mı? |
|---|---:|---:|---|---|
| 1 | 20.307.720 `set_config` | 149,2 | PostgREST'in **her** isteğinin başı | ⚠️ sync'e ait DEĞİL — § 2.1 |
| 2 | 2.969.248 `device_telemetry` 19 kolon | 21,8 | `telemetry.ts:910` `latestVehicleTelemetry` | ❌ **19.08'de toplu** (`latestTelemetryBatch`) |
| 3 | 2.939.811 `device_telemetry` son `recorded_at` | 21,6 | `telemetry.ts:45` `lastRecordedAt` | ❌ **18.08'de toplu** |
| 4 | 2.569.304 `idle_episodes … IS NULL` | 18,9 | `telemetry.ts:559` `getOpenEpisode` | ❌ **18.08'de toplu** |
| 5 | 2.569.283 `idle_episodes … IS NOT NULL` | 18,9 | `telemetry.ts:571` `latestClosedEndMs` | ❌ aynı çift |
| 6 | 1.865.086 `device_telemetry` INSERT 21 kolon | 13,7 | `telemetry.ts:249` (tekil) **ya da** `:180` (parti) | ⚠️ § 2.2 |
| 7 | 1.290.857 `vehicle_dtc … cleared_at IS NULL` | 9,5 | `telemetry.ts:1279` `saveDtc` | ⚠️ **kısmen** — § 2.3 |
| 8 | 906.178 `device_telemetry` INSERT 20 kolon | 6,7 | `telemetry.ts:190/253` `fuel_volume_l` geri düşüşü | ⚠️ § 2.4 |
| 9 | 904.277 `device_telemetry` lat/lng/ign + aralık | 6,6 | `depot.ts:313` `firstDepotEntryInRange` | ✅ **EVET, hâlâ** — § 4.2 |
| 10 | 840.299 `workers WHERE id=$1` | 6,2 | `auto-shift.ts:607` + başka çağıranlar | ❌ **20.08'de toplu** (sync payı) |
| 11 | 773.204 `geofences active+purpose` | 5,68 | `depot.ts:73` `activeDepotZones` | ❌ **19.08'de `turMemo`** |
| 12 | 370.013 `vehicles UPDATE vin` | 2,7 | `telemetry.ts:1490` `maybeBackfillVin` | ✅ **EVET, hâlâ** — § 3 |
| 13 | 296.740 `device_telemetry WHERE vehicle_id=…` | 2,2 | **emin değilim** — § 2.5 |
| 14 | 136.096 `vehicles WHERE flespi_device_id NOT NULL` | 1,0 | `sync/route.ts:64` | tur başına 1 — çapa |

### 2.1 `set_config` — sync'e ait değil

PostgREST her HTTP isteğinde rol/JWT/başlık ayarı için `set_config` çağırır.
20,3 M **bütün sistemin** PostgREST isteğidir: yönetici paneli, mobil uygulama,
sekiz cron, takip linki ve sync. Sync payını bu sayıdan çıkaramam
**`ÖLÇÜLMEDİ`** — ayrıştırmak için rol/uygulama etiketi gerekir.

### 2.2 INSERT 21 kolon — tekil mi parti mi? `[VARSAYIM]`

İki yazma yolu da aynı 21 kolonu üretiyor (`telemetriSatirlari`, tek kaynak).
Ayırt edici tek şey `RETURNING`: parti `.select("id, vehicle_id")`, tekil
`.select("id")`. Verilen imza metninde `RETURNING` görünmüyor, **ayıramıyorum**.

Ama sayı ayırıyor: **13,7/tur**. Parti yolu tur başına ⌈satır/500⌉ ≈ **1**
üretir; tekil yol araç başına 1 üretir. 13,7 ancak tekil yolla açıklanır
→ ağırlıklı olarak **18.08 öncesi `saveTelemetry`**. Opt-öncesi tura
bölününce 17,5 çıkıyor ve bu "noktası gelen araç sayısı"na oturuyor.

### 2.3 `vehicle_dtc` aktif liste — kısmen hâlâ araç başına

`activeDtcBatch` (19.08) yalnız **ilk anlık görüntünün** okumasını tohumluyor.
`saveDtc` içindeki döngü, aynı çağrıda **ikinci ve sonraki** snapshot için
`tohum`u boşaltıp **canlı okuyor** (`telemetry.ts:1271-1285`) — ve bu bilinçli:
ilk snapshot yazma yapmış olabilir, bayat liste temizlenmiş kodu yeniden
"aktif" sayardı. Yani C4 bugün de araç başına koşabilir, ama yalnız çok
snapshot'lı turlarda.

### 2.4 INSERT 20 kolon — `fuel_volume_l` geri düşüşü

906.178 / 1.865.086 = **%48,6**. Yani 21 kolonluk yazmaların yaklaşık yarısı
bir kolon hatası alıp `fuel_volume_l` düşürülerek **tekrar** gönderilmiş.
Bu ancak `fuel_volume_l` kolonu YOKKEN olur — yani migration 039 canlıya
girmeden önceki dönem.

Kolon **bugün var** (önceki turda ölçüldü: 591.468 satırda dolu), yani bu
yol bugün susmuş olmalı. ⚠️ Ama doğrulamadım `ÖLÇÜLMEDİ` — sayaç kümülatif
ve bugünkü oranı gösteremiyor. Eğer hâlâ koşuyorsa **her telemetri yazması
iki gidiş-dönüş** demektir; `pg_stat_statements` sıfırlanıp bir gün beklenerek
kesinleşir.

> Ayrıca not: geri düşüş koşulu `/fuel_volume_l|column/i` — mesajında "column"
> geçen **herhangi** bir hata 500 satırlık partinin tamamını tekrarlatır.
> Gözlem; bu turda değiştirilmedi.

### 2.5 🔴 KAYNAĞI BULUNAMADI — 296.740 `device_telemetry WHERE vehicle_id = …`

Verilen imza metni select listesini ve ek filtreleri göstermiyor; bu tabloya
`vehicle_id` ile giden **34 sorgu** var. En olası aday
`telemetry.ts:1256` (`saveDtc`in odometre okuması: `select odometer_km`,
`odometer_km not null`, `order recorded_at desc limit 1`) — 2,2/tur, yeni DTC
kodu eklenme sıklığına oturuyor. **Ama emin değilim.** Kesinleştirmek için
sorgunun tam metni (select listesi + `ORDER BY`) gerekir.

### 2.6 Sync DIŞINDAN gelenler

| imza | sync dışı çağıranlar |
|---|---|
| #2 `latestVehicleTelemetry` | `depot.ts:153,536` · `shift-end.ts:121` · `vehicles.ts:370` · `offline.ts:80` · `shift.ts:269,521,842` · `admin/araclar/[id]/page.tsx:52` |
| #10 `workers WHERE id` | `fleet-scope.ts:102` · `access-gates.ts:121` · `haftalik-aksiyon-db.ts:616` · `auth-core.ts:192` (her oturum açılışı) |
| #11 `geofences` | `activeDepotZones` panel yollarından da çağrılıyor (`depot.ts:92,204,230,270,487,533`) — `turMemo` yalnız sync kabında çalışır |
| #9 `firstDepotEntryInRange` | `depot.ts:463,491` — `resolveShiftStartAt`, panel "önerilen başlangıç" |

Bu yüzden #2, #10, #11'in **tamamı** sync'e yazılamaz. Panel payını
`ÖLÇMEDİM`.

---

## 3 · 🔴 `UPDATE vehicles SET vin … WHERE vin IS NULL` — 370.013 kez

### Neden her turda gönderiliyor

```ts
// sync/route.ts:209
const vin = points.find((p) => p.vin)?.vin ?? null;
if (vin) { await maybeBackfillVin(v.id, vin); }

// telemetry.ts:1485
export async function maybeBackfillVin(vehicleId: string, vin: string) {
  if (!VIN_BACKFILL_ENABLED) return;
  await supabaseAdmin.from("vehicles").update({ vin })
    .eq("id", vehicleId).is("vin", null);
}
```

Zincir üç adımda kırılıyor:

1. **Cihaz VIN'i her mesaj partisinde gönderiyor.** Teltonika `vehicle.vin`
   alanı CAN karesinde sürekli var, "bir kez" değil. Yani `vin` her turda dolu.
2. **Kod "zaten dolu mu" diye BAKMIYOR.** Tek koruma `.is("vin", null)` ve o
   **WHERE koşulu** — yani karar sunucuda veriliyor, istemcide değil. İstek
   gidiyor, 0 satır eşleşiyor, boş dönüyor.
3. **Değer bellekte VAR ama okunmuyor.** Tur girişindeki sorgu
   (`sync/route.ts:66`) `id, plate, flespi_device_id, assigned_worker_id`
   seçiyor — **`vin` seçili değil**. Kod yerel olarak bilemiyor.

Yani "VIN doluysa istek hiç yapılmıyor" değil, **"istek yapılıyor ve boşa
dönüyor"**. 370.013 / 136.096 = **2,7 istek/tur** — 29 aracın ~3'ü VIN
bildiriyor demek `[VARSAYIM]`; hangi araçlar olduğu `ÖLÇÜLMEDİ`.

Maliyeti bir `SELECT`ten pahalı: `UPDATE` yazma yolu açar, satır kilidi dener,
0 satır bulur, WAL yazmaz ama işlem yine de kurulur.

---

## 4 · TOPLU SORGUYA ÇEVRİLEBİLİR Mİ? (uygulanmadı, yalnız cevap)

Aşağıdakiler **bugün hâlâ araç başına koşan** kalemlerdir. Zaten toplulaşmış
7 imza için soru anlamsız (§ 0.2).

### 4.1 `maybeBackfillVin` — EVET, hem de sorgu eklemeden

**(a) Hangi kod yeniden yazılır**
`sync/route.ts:66` select listesine `vin` eklenir; `sync/route.ts:210`
koşulu `if (vin && v.vin === null)` olur. `maybeBackfillVin`in kendisine
**dokunulmaz** — `.is("vin", null)` kapısı yerinde kalır (ikinci çağıran
`/api/flespi/ingest` var ve o korunmalı).

**(b) Davranış riski**
Çok düşük. Kapı ikiye katlanır: istemcide "bildiğim kadarıyla boş" +
sunucuda `.is("vin", null)`. Yarış hâlinde (tur başında NULL, tur ortasında
biri elle VIN girdi) sunucu kapısı yine tutar. Ters yön — tur başında dolu
görünüp aslında boş olması — mümkün değil, çünkü bu turdan başka VIN yazan
yok.
⚠️ Tek gerçek fark: aynı turda **elle silinen** bir VIN aynı turda geri
yazılmaz, bir sonraki turda yazılır. 30 saniyelik gecikme.

**(c) Bellek** — `[VARSAYIM]` 29 araç × 17 karakter VIN ≈ **~0,5 KB**.
Zaten okunan satıra bir kolon eklemek; ölçülebilir bir artış değil.

**Kazanç:** tur başına **−2,7 yazma isteği**, günde ~7.800.

### 4.2 `firstDepotEntryInRange` (depo iz okuması) — EVET ama gerekmez

904.277 çağrı / 6,6 tur başına. Ama bu, auto-start kapılarını geçen araç
başına koşuyor ve **her çağrı sayfalı** (`depot.ts:313`, `range`), yani bir
"çağrı" birden çok istek.

**(a)** `depotArrivalTrigger` araç listesi alacak şekilde imzası genişletilir;
tek `.in("vehicle_id", ids)` + gün penceresi ile okunur, `firstDepotEntryIn`
geometrisi araç başına bellekte koşar.

**(b) Davranış riski — ORTA.** Sayfalama araç ekseninden gün eksenine
kayar ve **PostgREST 1000 satır tavanı** devreye girer: 29 araç × bir günün
noktaları çok rahat 40.000 satır eder. `fetchAllRows` ile sayfalanmazsa
**sessiz kırpma** olur ve bazı araçlarda "depoya hiç girmemiş" görünür →
vardiya açılmaz. Bu, bu depoda daha önce yaşanmış bir arıza sınıfı.

**(c) Bellek** `[VARSAYIM]`: 29 araç × ~1.180 satır/gün × 4 kolon ≈
**34.000 satır ≈ 3-4 MB**. Bir günün tamamı yerine yalnız "bugün"
penceresi okunursa bu; pencere büyürse doğrusal artar.

**Değer/risk yargım: DÜŞÜK ÖNCELİK.** `Va` turların çoğunda 0 olduğu için
gerçek tasarruf küçük, risk (sessiz kırpma → vardiya açılmaması) büyük.

### 4.3 `saveDtc` 2.+ snapshot okuması — HAYIR, toplulaştırılmamalı

Kod bunu bilerek canlı okuyor (`telemetry.ts:1236-1238`): aynı çağrıda ilk
snapshot yazma yapmış olabilir; bayat liste **temizlenmiş bir kodu yeniden
aktif sayar**. Toplulaştırmak doğruluk kaybıdır, hız kazancı değil.

### 4.4 `saveVehicleEvents` cooldown okuması — EVET, ama kazanç yok

Araç × olay-türü iç içe döngüsü (`telemetry.ts:360`). Tek sorguda
`.in("vehicle_id", …).in("event_type", …)` ile "araç+tür başına en yeni"
istenirse **RPC gerekir** (PostgREST `DISTINCT ON` yapamaz) — yani migration.
`vehicle_events` günde 95 satır büyüyor, yani bu döngü turların çoğunda hiç
koşmuyor. **Maliyeti migration'a değmez.**

### 4.5 `reconcileDtc` sayım + en-yeni okuması — EVET

C7 (`telemetry.ts:1438`) her `dtcNumber != null` araçta bir `count` atıyor.
Bu sayım `activeDtcBatch`in tur başında zaten okuduğu listeden **bellekte**
türetilebilir (`aktifDtc.get(v.id)?.length`).

**(b) Risk — DÜŞÜK ama sıfır değil:** tohum tur başında okundu; aynı turda
`saveDtc` o aracın satırlarını değiştirmiş olabilir. O hâlde bellekteki sayı
bayat olur ve bekçi ya gereksiz tetiklenir ya da atlar. Bugünkü kod bunu
canlı okuyarak garantiliyor.

**(c) Bellek:** `activeDtcBatch` zaten okuyor — **ek bellek 0**.

---

## 5 · 🔴 RİSK BÖLÜMÜ — bu döngü telemetri YAZAN yol

Ortak zemin: `device_telemetry` yazması **idempotenttir**
(`onConflict: vehicle_id,recorded_at`, `ignoreDuplicates`) ve imleç DB'deki
son satırdan türetilir. Bu ikisi birlikte, **kaçan bir tur bir sonraki turda
kendini kapatır**. Aşağıdaki riskler bu emniyeti bozan yerlerdir.

### 5.1 § 4.1 VIN — 🟢 veri kaybı riski YOK

- **Yanlış giderse:** `vin` kolonu select'e eklenmez ya da tip uyuşmaz →
  derleme hatası. Çalışma zamanında en kötü hâl: VIN'i boş bir araca VIN
  yazılmaz.
- **Nasıl fark ederiz:** `select count(*) from vehicles where vin is null` —
  değişiklikten önce ve sonra aynı olmalı. Ayrıca yeni bir araç eklendiğinde
  bir tur sonra VIN'in dolduğu gözlenir.
- **Geri dönüş:** tek satır; `if` koşulundan `&& v.vin === null` çıkarılır.
- **Telemetriye teması YOK** — VIN yolu zaten kendi `try/catch`inde ve
  `sync/route.ts:213` hatayı yutup akışı sürdürüyor.

### 5.2 § 4.2 depo iz okuması — 🔴🔴 **VERİ KAYBI DEĞİL, VARDİYA KAYBI**

- **Yanlış giderse:** 1000 satır tavanına takılan toplu okuma bazı araçların
  noktalarını hiç döndürmez → `firstDepotEntryIn` "depoya girmemiş" der →
  **o gün o şoförün vardiyası hiç açılmaz.** Sessizdir: hata yok, log yok,
  yalnız eksik bir vardiya.
- Bu tam olarak 25.07'de yaşanan sınıf: "auto-start'ı bozan yarıçap değil,
  telemetri boşluğuydu."
- **Nasıl fark ederiz:** günlük açılan otomatik vardiya sayısı
  (`time_entries where auto_started and started_at >= bugün`) değişiklik
  öncesi/sonrası karşılaştırılmalı; ayrıca `processAutoShifts`in `huni`
  teşhis sayacında `tetikYok` kaleminin sıçraması.
- **Geri dönüş:** fonksiyonun tekil sürümü korunmalı ve toplu okuma `null`
  dönerse ona düşülmeli — bu depodaki #84 "Adım 5 geri düşüş" deseninin
  aynısı.
- **Şart:** toplu okuma `fetchAllRows` ile sayfalanmalı, ham `.limit()`
  **yasak**.

### 5.3 § 4.5 `reconcileDtc` bellekten sayım — 🟡 sessiz yanlış durum

- **Yanlış giderse:** bayat sayım yüzünden bekçi tetiklenmez → temizlenmiş
  bir arıza kodu "aktif" görünmeye devam eder ya da tersi. Panelde yanlış
  DTC rozeti.
- **Veri kaybı YOK** — `vehicle_dtc` satırları silinmiyor, yalnız
  `cleared_at` damgası geç/erken düşer.
- **Nasıl fark ederiz:** `vehicle_dtc where cleared_at is null` sayısı ile
  cihazın bildirdiği `dtc_number` toplamı arasındaki fark. Zaten bekçinin
  ölçtüğü şey bu.
- **Geri dönüş:** tek satır, canlı `count`a dönülür.

### 5.4 Her değişiklik için ortak kapı

`sync/route.ts` **`sayacIle` kabında** koşuyor ve her tur şunu logluyor:

```
[flespi/sync] SORGU toplam=<N> kaynak={"device_telemetry":x,"idle_episodes":y,…}
```

Yani **öncesi/sonrası ölçümü zaten hazır**: değişiklikten önceki turların
`toplam` ve `kaynak` dökümü Vercel logundan alınır, sonrakiyle karşılaştırılır.
Tahmin gerekmez. ⚠️ Ben bu logu **okuyamadım** — Vercel CLI kurulu değil,
MCP bu projeyi görmüyor `ÖLÇÜLMEDİ`.

### 5.5 🔴 Dokunulmaması gerekenler

| Yer | Neden |
|---|---|
| `geriOkumaMuhafizi` (`telemetry.ts:264`) | Sessiz kırpmayı yakalayan tek kapı. Kaldırmak veri kaybını görünmez yapar. |
| `saveIdleEpisodes` 23505 yeniden okuması (`:690`) | Yarış korumasıdır; tohumlanamaz, canlı olmalı. |
| `saveDtc` 2.+ snapshot canlı okuması (`:1279`) | § 4.3. |
| Her `try/catch` sarmalı (rölanti, olay, VIN, DTC, ziyaret, sefer) | Yan işlerin GPS akışını düşürmemesini sağlıyor. Hepsi ayrı ayrı bilinçli. |
| `.is("vin", null)` sunucu kapısı | İkinci çağıran `/api/flespi/ingest` da bu kapıya güveniyor. |

---

## 6 · TURUN ZAMANLAMASI

### 6.1 Eşzamanlılık: **YOK — tur tamamen sıralı**

`for (const v of vehicles)` içinde `await fetchDeviceMessages(...)`.
29 araç **sırayla** çekiliyor. `Promise.all` yalnız `lastActivityMs` içinde
var ve o blok kapalı (D12). Yani tur boyunca **aynı anda en fazla 1 flespi
isteği ve en fazla 1 PostgREST isteği** açık.

### 6.2 Süre: doğrudan ÖLÇÜLMEDİ, ama üstten sınırlı

Vercel logunu okuyamadım `ÖLÇÜLMEDİ`. Ama önceki turda `ingested_at`
kümelenmesinden turlar arası aralık ölçüldü: **min 29 sn · p50 30 · maks 31**,
12 dakikada 25 tur. Zamanlayıcı sabit 30 sn'de tetiklerken aralık sapmıyorsa,
**her tur 30 saniyeden belirgin biçimde kısa bitiyor** demektir — aksi hâlde
turlar üst üste biner ve `ingested_at` kümeleri kayardı. `[VARSAYIM]` ama
dayanağı ölçüm.

DB tarafının payı önceki turda ölçüldü: sabit okuma tabanı **9 gidiş-dönüş ≈
137 ms gerçek DB zamanı** (ağ RTT'si düşülmüş). Kalan sürenin büyük kısmı
**29 sıralı flespi HTTP çağrısı** olmalı `[VARSAYIM]` — flespi yanıt süresi
`ÖLÇÜLMEDİ`.

### 6.3 Zaman aşımı ve yeniden deneme: **hiçbiri yok**

| | durum |
|---|---|
| `maxDuration` | **ayarlanmamış** — Vercel varsayılanı geçerli |
| flespi `fetch` timeout / `AbortSignal` | **YOK** — asılı bir istek turu süresiz bekletebilir |
| flespi yeniden deneme | **YOK** — HTTP ≠ 2xx ise `throw` |
| istek başına `count` tavanı | `MAX_PER_POLL = 1000` (`flespi.ts:27`) |
| telemetri parti sınırı | `TELEMETRI_PARTI_SINIRI = 500` (`telemetry.ts:147`) |

### 6.4 Hata olursa ne oluyor — katman katman

| Katman | Davranış |
|---|---|
| **Araç döngüsü** (`route.ts:262`) | `try/catch` araç başına. Bir aracın flespi hatası yalnız o aracı düşürür; `perVehicle[].error` dolar, tur devam eder. |
| **Yan işler** (rölanti, olay, VIN, DTC, ziyaret) | Her biri kendi `try/catch`inde, yalnız `console.error`. GPS akışını ASLA düşürmez. |
| **Toplu telemetri yazması** | Hata → `null` döner → araç-araç `saveTelemetry`ye düşer (Adım 5). Kısmen yazılmış parti zararsız (idempotent). |
| **Toplu okumalar** (A2, A3, C3, D6, D7) | Hata → `null` → çağıran araç-araç eski yola düşer. **Davranış aynı, yalnız yavaş.** |
| **`vehicles` sorgusu** (A1) | `throw` → tur 500 döner. Bilinçli: sessiz `{ok:true, vehicles:0}` olmasın. |
| **`processAutoShifts`** | Asla `throw` etmez; hatalar `summary.errors`e yazılır. |
| **Kaçan tur** | Bir sonraki tur imleci DB'den okuduğu için **kendini kapatır**. 28.08 kesintisinde bu ölçüldü: 4 saatlik kesinti sonrası tek turda 13.888 satır telafi edildi, **veri kaybı olmadı**. |

---

## 7 · ÖLÇEMEDİKLERİM

- Sync'in `set_config` (20,3 M) içindeki payı — rol/uygulama etiketi yok
- İmza #13'ün (296.740) kesin kaynağı — select listesi verilmemiş
- Bugünkü tur başına gerçek sorgu sayısı — Vercel logundaki
  `[flespi/sync] SORGU toplam=` satırı okunamadı (CLI yok, MCP projeyi görmüyor)
- Bir turun gerçek süresi (saniye)
- flespi HTTP yanıt süresi
- 20 kolonluk INSERT'in **bugün** hâlâ tetiklenip tetiklenmediği
- `Vv` (VIN bildiren araç) ve `Vd` (DTC bildiren araç) kimliği
- Panel/mobil trafiğinin #2, #10, #11 içindeki payı

**Hepsinin tek çözümü aynı:** `pg_stat_statements`i sıfırlayıp
(`select pg_stat_statements_reset();`) bir gün sonra aynı sorguyu tekrar
almak. O zaman sayaçlar yalnız **bugünkü kodu** ölçer ve bu raporun
tarih-temelli ayrıştırmasına gerek kalmaz.
