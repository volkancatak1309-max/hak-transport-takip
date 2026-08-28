# Analiz ekranı yavaşlığı — ölçüm

> 28.08.2026 · 🔴 **SALT OKUMA TURU.** Kodda tek harf değişmedi, migration
> yazılmadı, dal açılmadı, DB'ye tek satır yazılmadı. Ölçüm geçici betiklerle
> yapıldı ve betikler silindi.
>
> ⚠️ Ölçüm **HAK61 canlıda** yapıldı — galzura-demo'nun service key'i bende yok
> (`.env.local` = HAK61, `.env.sendigo` = Sendigo, galzura yok). Sayfanın tek
> yazması olan `audit()` **çağrılmadı**; geri kalan her şey `SELECT`/`stable RPC`.
>
> ⚠️ Süreler benim makinemden ölçüldü, **çağrı başına ~85 ms ağ gidiş-dönüşü
> içeriyor**. Vercel'den (Supabase ile aynı bölge) süreler daha kısadır; **çağrı
> SAYILARI ise ortamdan bağımsızdır** ve bu raporun asıl kanıtı odur.

---

## 0 · KISA CEVAP

**İki ekran aynı değil — iki ayrı yol, iki ayrı sebep.**

| | yol | çağrı | süre |
|---|---|---:|---:|
| **Admin** `/admin/analiz` | `app/admin/analiz/page.tsx` | **161** | **6,3 sn** |
| **Mobil** Analiz | `app/api/mobile/analytics/route.ts` | **1.301** | **41,8 sn** |

🔴 **Mobilin hiç gelmemesinin tek sebebi bulundu ve kanıtlandı:**
`co2Panosu()` tek başına **36,71 sn ve 1.115 sorgu** — toplam çağrının %86'sı.
Sebebi `lib/co2-db.ts:415` içindeki `aylikSeri()`: **son 6 ayı `for` döngüsünde,
sırayla, her ay için TAM bir `buildFuelReport` koşturuyor.**

Admin ekranı co2 panosunu **çağırmıyor** — o yüzden geliyor, ama yavaş: 161
çağrının **116'sı** araç başına odometre span sorgusu.

---

## 1 · ADMIN `/admin/analiz` VERİ YOLU

### 1.1 Zincir — üç blok, **birbirini bekliyor**

```
requireAdmin()                          ← ölçülmedi
audit(page_view)                        ← 🔴 YAZMA (audit_log INSERT), ölçülmedi
getLatestConfigEpoch()          ─┐
getTestScope()                   │ SIRALI ön zincir
listVehiclesAndWorkers()        ─┘
        ↓ bekler
BLOK A · loadPeriod(range)              ← seçili dönem
        ↓ bekler
BLOK B · Promise.all[arşiv olay, arşiv rölanti]   ← TÜM GEÇMİŞ
        ↓ bekler
BLOK C · loadPeriod(prevRange)          ← önceki dönem, TREND için
```

`loadPeriod` kendi içinde:

```
Promise.all[ listEventsInRange · listIdleEpisodesInRange · time_entries ]   ← 3 paralel
        ↓ bekler
getWorkerShiftDistance()   (RPC shift_odometer_spans)                       ← SIRALI
        ↓ bekler
mapBounded(6) × 29 araç × getVehicleDistanceSpan (araç başına 2 sorgu)      ← SIRALI
```

**Paralellik yalnız iki yerde:** `loadPeriod`un üçlü bloğu ve `mapBounded(6)`.
Üst seviyedeki A→B→C **tamamen sıralı** ve aralarında veri bağımlılığı **yok**
— B (arşiv) ne A'ya ne C'ye bakıyor.

### 1.2 Ölçüm — aralık = "hafta" (7 gün), sıcak önbellek

| blok | süre | sorgu |
|---|---:|---:|
| 1· `getLatestConfigEpoch` | 0,21 sn | 1 |
| 2· `getTestScope` | 0,38 sn | 2 |
| 3· `listVehiclesAndWorkers` | 0,86 sn | 7 |
| **A** a) paralel üçlü | 0,56 sn | 9 |
| **A** b) `getWorkerShiftDistance` (RPC) | 0,12 sn | 1 |
| **A** c) `mapBounded × 29 araç` | 0,84 sn | **58** |
| **B** arşiv (6.056 olay · 1.273 epizod) | **1,98 sn** | 15 |
| **C** a) paralel üçlü | 0,37 sn | 9 |
| **C** b) `getWorkerShiftDistance` | 0,11 sn | 1 |
| **C** c) `mapBounded × 29 araç` | 0,73 sn | **58** |
| **TOPLAM** | **6,33 sn** | **161** |

Tablo bazında:

```
116 × device_telemetry     ← %72 · 29 araç × 2 sorgu × 2 dönem
 16 × vehicles
 11 × workers
  9 × vehicle_events
  4 × idle_episodes
  2 × time_entries
  2 × rpc:shift_odometer_spans
  1 × device_config_epochs
```

### 1.3 Aralık büyütmek neredeyse hiçbir şeyi değiştirmiyor

| aralık | sorgu |
|---|---:|
| hafta (7 gün) | 161 |
| ay (30 gün) | 166 |

Çünkü maliyet **aralığa değil ARAÇ SAYISINA ve arşive** bağlı: 116 span
sorgusu her aralıkta aynı, arşiv bloğu zaten aralıktan bağımsız.

### 1.4 JS hesabı sebep DEĞİL — ölçüldü

```
computeMonthlyPivot(6.056 olay + 1.273 epizod)  →  0,30 sn (iki koşumda da)
```

---

## 2 · 🔴 MOBİL: AYRI YOL, AYRI SEBEP

Mobil Analiz ekranı `/admin/analiz`i **çağırmıyor**. Kendi ucu var:
`app/api/mobile/analytics/route.ts`.

### 2.1 Ölçüm — aralık = "hafta"

| blok | süre | sorgu |
|---|---:|---:|
| `getLatestConfigEpoch` | 0,29 sn | 1 |
| 🔴 **`co2Panosu`** | **36,71 sn** | **1.115** |
| `listVehiclesAndWorkers` | 0,56 sn | 7 |
| `buildPerformanceReport(current)` | 1,79 sn | 80 |
| paralel[olay + rölanti] | 0,35 sn | 8 |
| `getWorkerShiftDistance` | 0,09 sn | 1 |
| `buildPerformanceReport(prev)` | 1,55 sn | 80 |
| paralel[olay + rölanti] | 0,37 sn | 8 |
| `getWorkerShiftDistance` | 0,09 sn | 1 |
| **TOPLAM** | **~41,8 sn** | **1.301** |

### 2.2 KÖK NEDEN — `aylikSeri()` altı ayı sırayla koşuyor

`lib/co2-db.ts:415`:

```ts
for (let i = 5; i >= 0; i--) {
  ...
  const r = await buildFuelReport({ start: ayBas, end: ayBit });   // ← SIRALI, 6 KEZ
  ...
}
```

`co2Panosu` = **1** `buildFuelReport` (seçili aralık, satır 163) **+ 6**
`buildFuelReport` (aylık seri) = **7 tam yakıt raporu, ardışık**.

**Kanıt — aritmetik birebir tutuyor** `[DOĞRULANDI]`:

| ölçüm | değer |
|---|---|
| tek `buildFuelReport` (1 ay) | **171 sorgu · 10,97 / 11,35 sn** |
| 7 × 171 | **1.197** çağrı beklenir |
| `co2Panosu` ölçülen | **1.115** çağrı (boş aylar daha ucuz) ✓ |
| sayaçta `rpc:report_fuel_volume_stats` | **7** — tam olarak 7 rapor ✓ |
| sayaçta `rpc:report_fuel_stats_vehicle` | **203** = 7 × 29 araç ✓ |

Ve her `buildFuelReport`ın içindeki en pahalı tek kalem, `docs/HAK61-SAGLIK.md`
§ 8.2'de zaten ölçülmüştü: **`report_fuel_volume_stats` kapsamsız tek gövde,
4,6–5,1 sn, her rapor render'ında koşulsuz.** 7 rapor × ~5 sn ≈ **35 sn** —
ölçülen 36,71 sn ile örtüşüyor.

### 2.3 Zaman aşımı sınırı

| katman | durum |
|---|---|
| `app/api/mobile/analytics/route.ts` `maxDuration` | **ayarlanmamış** → Vercel varsayılanı |
| Mobil istemcinin fetch timeout'u | **`BİLMİYORUM`** — React Native uygulaması bu depoda değil |
| Gözlem | 14 sn ve 30 sn'de vazgeçti |

Sunucu tarafı ölçülen **41,8 sn**; istemci 14/30 sn'de vazgeçtiyse ekran veriye
**hiçbir zaman ulaşamaz**. Gözlemle ölçüm tutarlı `[DOĞRULANDI]`.

---

## 3 · VOLKAN'IN SQL EDITOR'A YAPIŞTIRACAĞI SORGU

Sayaç bugün **10:30 UTC**'de sıfırlandı, yani rakamlar bugünkü kodu anlatıyor.

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- ANALİZ EKRANININ SORGULARI — SÜREYE GÖRE. SALT OKUMA.
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1) EN PAHALI 20 — toplam süreye göre
select
  round(total_exec_time)::bigint            as toplam_ms,
  calls                                     as cagri,
  round(mean_exec_time, 1)                  as ort_ms,
  round(max_exec_time)::bigint              as en_kotu_ms,
  shared_blks_read                          as diskten_blok,
  shared_blks_hit                           as onbellekten_blok,
  left(regexp_replace(query, '\s+', ' ', 'g'), 110) as sorgu
from pg_stat_statements
order by total_exec_time desc
limit 20;

-- 2) YAKIT RAPORU HATTI — co2Panosu'nun 7 kez kosturdugu iki RPC.
--    `report_fuel_volume_stats` KAPSAMSIZ tek govde: cagri basina ~5 sn.
--    `report_fuel_stats_vehicle` arac eksenli: cagri = rapor x 29.
select
  round(total_exec_time)::bigint  as toplam_ms,
  calls, round(mean_exec_time,1)  as ort_ms,
  left(query, 70)                 as sorgu
from pg_stat_statements
where query ilike '%report_fuel_volume_stats%'
   or query ilike '%report_fuel_stats_vehicle%'
   or query ilike '%shift_odometer_spans%'
order by total_exec_time desc;

-- 3) ARAC BASINA ODOMETRE SPAN — admin ekranindaki 116 cagri.
--    Tek tek ucuz olmali (~10-30 ms); toplam_ms buyukse sorun SAYIDA.
select
  round(total_exec_time)::bigint  as toplam_ms,
  calls, round(mean_exec_time,2)  as ort_ms
from pg_stat_statements
where query ilike '%device_telemetry%'
  and query ilike '%odometer_km%'
  and query ilike '%vehicle_id = $%'
order by total_exec_time desc
limit 5;

-- 4) DISK MI CPU MU: onbellekten okuma orani.
--    Oran %99'un altina duserse darbogaz bellek, sorgu degil.
select
  round(100.0 * sum(shared_blks_hit)
        / nullif(sum(shared_blks_hit + shared_blks_read), 0), 2) as onbellek_isabet_yuzde,
  sum(shared_blks_read) as toplam_diskten_blok
from pg_stat_statements;
```

---

## 4 · YAVAŞLIĞIN SINIFLANDIRMASI

| sınıf | mobil | admin | kanıt |
|---|---|---|---|
| **Sıralı bekleme zinciri** | 🔴 **BİRİNCİL** | 🟡 ikincil | `aylikSeri` 6 ayı `for`+`await` ile koşuyor; admin'de A→B→C aralarında veri bağımlılığı olmadan sıralı |
| **Tek ağır sorgu** | 🔴 **BİRİNCİL** | ❌ yok | `report_fuel_volume_stats` kapsamsız, 4,6–5,1 sn, **7 kez** koşuyor |
| **Çok sayıda küçük sorgu** | 🟡 var (1.301) | 🔴 **BİRİNCİL** | admin'de 161 çağrının 116'sı (%72) araç başına span sorgusu |
| **Eksik indeks** | ❌ **kanıt YOK** | ❌ **kanıt YOK** | tek araç `getVehicleDistanceSpan` **0,11–0,14 sn** (ağ RTT'si ~85 ms dahil) → indeksten gidiyor. Ayrıca `docs/HAK61-SAGLIK.md` § 3.2'de eksik indeks belirtisi bulunmamıştı |
| **Soğuk önbellek / bellek** | `ÖLÇÜLMEDİ` | `ÖLÇÜLMEDİ` | § 3'ün 4. sorgusu cevaplar |

### 4.1 Admin'in 15 saniyesinin ~9 saniyesi ÖLÇÜLEMEDİ

Ben veri yolunu **6,33 sn** ölçtüm (uzaktan, ~85 ms RTT'li, sıcak önbellekle).
Vercel'den bu daha da kısa olmalı. Volkan'ın gördüğü ~15 sn ile arasındaki fark
**`ÖLÇÜLMEDİ`**. Ölçmediğim adaylar:

- **Vercel soğuk başlatma** — sayfa `force-dynamic`, ISR yok, `maxDuration` yok
- **`requireAdmin()` + `audit()`** — `audit()` `audit_log`a INSERT ediyor; salt
  okuma kuralı gereği çağırmadım
- **Soğuk DB önbelleği** — ilk açılış günün ilk okuması olabilir
- **RSC render + tarayıcıya transfer** — 30 şoförlük tablo + 89 günlük pivot

Bunlar `[VARSAYIM]` adaylardır; hiçbirini ölçmedim ve tahmin sırası vermiyorum.

---

## 5 · DÜZELTME SEÇENEKLERİ (sıralı, **UYGULANMADI**)

### S1 · `aylikSeri`in 6 raporunu paralelleştir — mobil · **DÜŞÜK RİSK**

`for`+`await` yerine `mapBounded(3)` (bu depodaki eşzamanlılık tavanı deseni).
6 ardışık rapor → 2 dalga.

- **Kazanç** `[VARSAYIM]`: co2Panosu 36,7 sn → **~12-15 sn**. Çağrı sayısı
  **DEĞİŞMEZ** (1.115).
- **Risk:** düşük ama sıfır değil — `docs/HAK61-SAGLIK.md` § 8.2'nin ölçümü,
  30 eşzamanlı çağrıda ifade başına zaman aşımı payının 1,04×'e düştüğünü
  gösteriyor. Tavan **mutlaka** sınırlı olmalı.
- **Etki:** her kiracı (mobil Analiz ekranı).
- ⚠️ Tek başına **YETMEZ** — 12-15 sn hâlâ 14 sn'lik istemci sınırının sınırında.

### S2 · `report_fuel_volume_stats`ı araç eksenine çevir — **ORTA RİSK, EN BÜYÜK KAZANÇ**

`docs/HAK61-SAGLIK.md` § 8.2 ve `docs/TELEMETRI-KOLON-DARALTMA.md`'de zaten
duruyordu; bu ölçüm onu **7 kat daha acil** yapıyor. Yüzde hattı 052'de araç
eksenine çevrildi, litre hattı çevrilmedi.

- **Kazanç** `[VARSAYIM]`: rapor başına ~5 sn → ~1-2 sn. **7 rapor × 3-4 sn =
  21-28 sn** kazanç. co2Panosu 36,7 → **~10-15 sn**.
- **Risk:** ORTA — migration gerektiriyor (yeni RPC). Ama desen kanıtlanmış,
  ikizi (`report_fuel_stats_vehicle`) canlıda çalışıyor.
- **Etki:** her kiracı; ayrıca `/admin/raporlar/yakit`, `/admin/ayarlar`,
  haftalık aksiyon cron'u ve CSV dışa aktarma **hepsi** hızlanır.

### S3 · CO2 panosunu mobil Analiz ucundan AYIR — **DÜŞÜK RİSK, EN HIZLI**

Mobil Analiz ekranı açılışta CO2 panosunu **beklemek zorunda değil**; ayrı bir
uca alınıp sekmeye tıklanınca yüklenebilir.

- **Kazanç** `[DOĞRULANDI] tabanlı`: mobil uç 41,8 → **~5,1 sn** (1.301 → 186
  çağrı). Ekran veriye ULAŞIR.
- **Risk:** DÜŞÜK — kod taşıma, hesap değişmiyor. Mobil istemcide de değişiklik
  gerekir (iki çağrı), yani iki repo koordinasyonu.
- **Etki:** yalnız mobil.

### S4 · Aylık seriyi `vehicle_month_metrics`ten oku — **YAPISAL ÇÖZÜM**

Migration 090 `vehicle_month_metrics` tablosunu ve `build_daily_vehicle_metrics`
RPC'sini kurmuş; ikisi de canlıda **0 satır**, kimse yazmıyor. Aylık CO2 serisi
tam olarak bunun için var.

- **Kazanç** `[VARSAYIM]`: 6 rapor → **1 sorgu**. co2Panosu ~36,7 → **~5 sn**.
- **Risk:** ORTA — gece bir işin bu tabloyu doldurması gerekir (yeni cron).
  Tazelik bedeli: aylık seri bir gün eski olur (aylık seri için önemsiz).
- **Etki:** her kiracı. `docs/HAK61-SAGLIK.md` § 8.3'teki öneriyle **aynı
  altyapıyı** kullanır — ikisi tek işte çözülür.

### S5 · Admin'de A/B/C bloklarını paralelleştir — **DÜŞÜK RİSK, KÜÇÜK KAZANÇ**

BLOK B (arşiv) ne A'ya ne C'ye bakıyor; üçü `Promise.all` olabilir.

- **Kazanç** `[VARSAYIM]`: 6,33 → **~2,5-3 sn** (en uzun blok kadar).
- **Risk:** DÜŞÜK — saf sıralama değişikliği, hesap aynı. Ama eşzamanlı ifade
  sayısı 6'dan 18'e çıkar; `mapBounded` tavanı buna göre düşürülmeli.
- **Etki:** yalnız admin.

### S6 · Araç başına span sorgularını tek RPC'ye indir — **ORTA RİSK**

116 çağrının kaynağı `getVehicleDistanceSpan`. `shift_odometer_spans` deseninde
(migration 052) bir `LATERAL` RPC ile 58 → 1 olur.

- **Kazanç** `[VARSAYIM]`: admin 161 → **~47 çağrı**, 6,33 → ~4 sn. Vercel'den
  kazanç daha küçük (RTT payı zaten düşük).
- **Risk:** ORTA — migration; ayrıca `spanByVehicle` skor kapısını besliyor,
  yanlış hesap skorları sessizce kaydırır.
- **Etki:** yalnız admin.

### Önerim

**S3 → S2 → S4.** S3 mobil ekranı bugün açar (kod taşıma, migration yok).
S2 yedi yerden birden kazandırır ve zaten bekleyen bir iş. S4 ikisini kalıcı
kılar ve 090'ın boş duran altyapısını kullanır. S1 yalnız S2/S4 gecikirse
geçici yama olarak anlamlı; S5/S6 admin için, aciliyeti düşük.

---

## 6 · ÖLÇEMEDİKLERİM

- galzura-demo'da hiçbir ölçüm — service key yok `ÖLÇÜLMEDİ`
- Admin'in 15 sn'sindeki ~9 sn'lik fark `ÖLÇÜLMEDİ` (§ 4.1)
- `requireAdmin()` süresi — ölçmedim
- `audit()` süresi — **yazma**, çağırmadım
- Vercel soğuk başlatma süresi — CLI yok, MCP 403
- Mobil istemcinin fetch timeout değeri — RN uygulaması bu depoda değil
- Soğuk/sıcak DB önbelleği farkı bu ekran için — § 3'ün 4. sorgusu cevaplar
