# VIN yazma isteği — boşa giden UPDATE kapatıldı

> 28.08.2026 · Dal **`perf/vin-bos-istek`** · main'e dokunulmadı · push/deploy yok.
> Kaynak analiz: [`docs/SYNC-ISTEK-HARITASI.md`](SYNC-ISTEK-HARITASI.md) § 3.
> DB'ye tek satır yazılmadı; bu turun bütün ölçümleri `SELECT`.

---

## 1 · DEĞİŞEN SATIRLAR

Tek dosya: `app/api/flespi/sync/route.ts`. **Üç satır kod** (gerisi gerekçe
yorumu). Yeni sorgu açılmadı — `vin` mevcut select'e kolon olarak katıldı.

### 1.1 `VehRow` tipine kolon — `route.ts:62`

```diff
 type VehRow = {
   id: string;
   plate: string;
   flespi_device_id: number;
   assigned_worker_id: string | null;
+  vin: string | null;
 };
```

### 1.2 Giriş sorgusuna kolon — `route.ts:72`

```diff
   const { data, error } = await supabaseAdmin
     .from("vehicles")
-    .select("id, plate, flespi_device_id, assigned_worker_id")
+    .select("id, plate, flespi_device_id, assigned_worker_id, vin")
     .not("flespi_device_id", "is", null);
```

⚠️ **Sorgu sayısı DEĞİŞMEDİ.** Aynı tek sorgu, bir kolon daha. Filtre,
sıralama, `test-visible:` notu — hepsi aynı.

### 1.3 İstemci kapısı — `route.ts:239`

```diff
   const vin = points.find((p) => p.vin)?.vin ?? null;
-  if (vin) {
+  if (vin && v.vin === null) {
     try {
       await maybeBackfillVin(v.id, vin);
```

### 1.4 🔴 DOKUNULMAYAN: sunucu kapısı

`lib/telemetry.ts:1485` **hiç değişmedi**:

```ts
export async function maybeBackfillVin(vehicleId: string, vin: string) {
  if (!VIN_BACKFILL_ENABLED) return;
  await supabaseAdmin.from("vehicles")
    .update({ vin }).eq("id", vehicleId).is("vin", null);   // ← YERİNDE
}
```

Kaldırılamaz: ikinci çağıran `/api/flespi/ingest/route.ts:187` **yalnız** bu
kapıya güveniyor ve orada bellekte bir `vehicles` satırı yok. Fonksiyonun kendi
yorumu da bunu şart koşuyor ("kapı fonksiyonun İÇİNDE, çağıranlarda değil").

**Sonuç: iki kapı.** İstemci kapısı isteği hiç göndermemek için, sunucu kapısı
gönderilirse yazmamak için.

---

## 2 · ÜÇ DURUMUN KANITI

`scripts/verify-vin-kapisi.mjs` — salt okuma; sync'in giriş sorgusunun
**birebir aynısını** atar, karar satırını canlı araç satırları üzerinde
koşturur, önce/sonra karşılaştırır.

### HAK61 (canlı, 28.08.2026 10:34 UTC)

```
cihazlı araç 29 · vin DOLU 29 · vin NULL 0

durum                                        | önce | sonra | beklenen        | sonuç
---------------------------------------------+------+-------+-----------------+------
a) DB'de vin NULL · cihaz vin gönderiyor     |  GİT |   GİT | YAZILMALI       | ✓  (sentetik satır)
b) DB'de vin DOLU · cihaz vin gönderiyor     |  GİT |   yok | İSTEK GİTMEMELİ | ✓
c) DB'de vin NULL · cihaz vin GÖNDERMİYOR    |  yok |   yok | İSTEK GİTMEMELİ | ✓  (sentetik satır)
```

### Sendigo (canlı, aynı an)

```
cihazlı araç 4 · vin DOLU 4 · vin NULL 0
… üç durum da aynı sonuç ✓
```

### Kodda karşılıkları

| durum | koşul | değer | sonuç |
|---|---|---|---|
| **a)** DB null, cihaz gönderiyor | `vin && v.vin === null` | `"WVW…" && null === null` | `true` → `maybeBackfillVin` çağrılır, sunucu kapısı da eşleşir → **YAZILIR** ✅ |
| **b)** DB dolu, cihaz gönderiyor | `vin && v.vin === null` | `"WVW…" && "WVW…" === null` | `false` → **istek hiç gitmez** ✅ |
| **c)** DB null, cihaz göndermiyor | `vin && v.vin === null` | `null && …` | `false` (ilk terimde kısa devre) → **istek gitmez** ✅ |

> **(a) neden "sentetik satır":** bugün hem HAK61'de hem Sendigo'da `vin` NULL
> olan tek bir cihazlı araç yok (29/29 ve 4/4 dolu). Betik o durumu gerçek bir
> satır bulamayınca `{ vin: null }` sentetik satırıyla değerlendiriyor ve
> çıktıda bunu açıkça yazıyor. **(b) ve (c) gerçek canlı satırlarla ölçüldü.**
> Yeni bir araç eklendiğinde (a) gerçek satırla da doğrulanabilir.

### `.is("vin", null)` sunucu kapısı gerçekten tutuyor mu?

Ayrı bir test yazmadım — **canlı veri zaten kanıt**: `pg_stat_statements`
370.013 `UPDATE vehicles SET vin` çağrısı sayıyor ve 29 aracın 29'unda VIN
hâlâ **kendi değeri**. 370 bin UPDATE, sıfır değişen satır → kapı her seferinde
tuttu. Bunu doğrulamak için canlıya yeni bir UPDATE atmadım.

---

## 3 · BELLEKTEKİ DEĞERİN TAZELİĞİ — değişiklik güvenli

Soru: tur girişinde okunan `v.vin`, tur içinde (≤30 sn) başkası tarafından
değiştirilebilir mi?

### 3.1 `vehicles.vin`'i yazan TEK yol var — `[DOĞRULANDI]`

Depoda `vehicles` tablosuna `vin` yazan tek ifade `lib/telemetry.ts:1492`.
Arandı ve **yönetici formu bu kolona dokunmuyor**:

| yer | `vin` var mı |
|---|---|
| `app/actions/vehicles.ts:330-341` (güncelleme yükü) | ❌ — açık kolon listesi, `vin` yok |
| `app/actions/vehicles.ts:251-264` (ekleme yükü) | ❌ — açık kolon listesi, `vin` yok |
| `lib/validation.ts` araç şeması | ❌ — `vin` alanı hiç yok |
| `lib/fleets-db.ts:525` | ❌ — yalnız `fleet` |
| `lib/telemetry.ts:1492` `maybeBackfillVin` | ✅ **tek yazar** |

### 3.2 Yön tek: `null → dolu`

`maybeBackfillVin` `.is("vin", null)` ile yazar. Yani bir VIN **yalnız boşken
dolabilir**; hiçbir kod yolu onu tekrar `null` yapmıyor.

Bunun sonucu, iki bayatlama senaryosunun da zararsız olması:

| bayatlama | olabilir mi | sonuç |
|---|---|---|
| bellek `null`, DB bu arada **doldu** (`/api/flespi/ingest` yarışı) | ✅ olabilir | İstek gider, **sunucu kapısı 0 satır eşleştirir**. Bugünkü davranışın aynısı — zarar yok, yalnız o turda bir boşa istek. |
| bellek **dolu**, DB bu arada `null` oldu | ❌ **imkânsız** | Hiçbir yol `vin`i `null`a çevirmiyor. |

### 3.3 Bayatlama penceresi zaten tek tur

`v.vin` **her turun başında yeniden okunuyor** (giriş sorgusu her tur koşuyor).
Yani biri SQL Editor'dan elle bir VIN'i silse bile, en geç bir sonraki turda
(≤30 sn) yeni değer okunur ve backfill çalışır.

**⇒ Değişiklik yapılabilir.** Durdurup bildirmeyi gerektiren bir durum yok.

---

## 4 · ÖLÇÜM

### Formül

```
V      = cihazlı araç sayısı (HAK61: 29)
Vv     = bu turda cihazı VIN bildiren araç kümesi
Vnull  = vehicles.vin IS NULL olan araç kümesi

ÖNCE : UPDATE/tur = |Vv|
SONRA: UPDATE/tur = |Vv ∩ Vnull|
```

### Sayılar

| | değer | kaynak |
|---|---:|---|
| sayaç penceresi | **136.096 tur** | `vehicles WHERE flespi_device_id NOT NULL` = tur başına 1 |
| gözlenen UPDATE | **370.013** | `pg_stat_statements` |
| **ÖNCE — ortalama** | **2,72 UPDATE/tur** | 370.013 ÷ 136.096 |
| ÖNCE — en kötü hâl | 29 UPDATE/tur | her araç VIN bildirseydi |
| `\|Vnull\|` HAK61 | **0** (29/29 dolu) | canlıda ölçüldü |
| **SONRA — ortalama** | **0 UPDATE/tur** | `\|Vv ∩ ∅\| = 0` |
| SONRA — en kötü hâl | **0 UPDATE/tur** | betik çıktısı: `sonra: 0` |

**Günlük:** 2,72 × 2.880 tur = **~7.834 UPDATE/gün → 0.** Azalma **%100**.

### Kararlı hâl ve yeni araç

Sıfır kalıcı değil, **doğru**: yeni bir araç eklendiğinde `vin` NULL başlar,
cihazı ilk VIN'i bildirdiği turda **tam bir** UPDATE gider, satır dolar, bir
sonraki turun giriş sorgusu dolu değeri okur ve sayaç yeniden 0'a düşer.
Yani araç başına **ömür boyu 1 istek** — fonksiyonun adındaki "backfill"in
gerçek anlamı.

### ⚠️ Önceki raporda bir düzeltme

`SYNC-ISTEK-HARITASI.md` § 3'te "cihaz VIN'i **her** mesaj partisinde
gönderiyor" yazmıştım. Ölçüm bunu yumuşatıyor: 2,72 ÷ 29 = **(araç, tur)
çiftlerinin %9,4'ünde** VIN geliyor, hepsinde değil. Boşa giden istek sayısı
bu yüzden 29/tur değil ~2,7/tur. Sonuç değişmiyor (hepsi boşaydı), oran
değişiyor.

---

## 5 · RİSK

### 5.1 🟡 YENİ ARIZA YOLU: giriş sorgusu artık `vin`i ADIYLA istiyor

Bu turun tek gerçek riski. Giriş sorgusu, hata hâlinde **bilerek `throw`
ediyor** (`route.ts:68-73`) → tur 500 döner → **o turda telemetri akmaz**.
`vin` kolonu olmayan bir kiracıda select `42703` verir ve bu yol tetiklenir.

Depoda `vin`i **adıyla** select eden başka üretim yolu yoktu (arandı); mobil
uç `v.vin`i `select("*")` üzerinden okuyor ve orada eksik kolon sessizce
`undefined` olur. Yani bu, yeni bir sınıf.

**Ölçüldü — iki kiracıda risk yok:**

| kiracı | OpenAPI şemasında `vin` | sync'in select'i |
|---|---|---|
| HAK61 | **VAR** | **HTTP 200** ✅ |
| Sendigo | **VAR** | **HTTP 200** ✅ |
| galzura-demo | `ÖLÇÜLEMEDİ` — service key yok | `ÖLÇÜLEMEDİ` |

galzura-demo için dolaylı gerekçe `[VARSAYIM]`: kolon migration **021**'de
geliyor, o kiracının tabanı 043+045+046+047+064 (021 ≪ 043) ve
`db/install/galzura-demo-full.sql` kolonu içeriyor. Ayrıca orada
`VIN_BACKFILL_ENABLED=false`, yani yazma yolu zaten kapalı — ama **giriş
sorgusu bayraktan bağımsız koşuyor**, o yüzden kolonun varlığı yine şart.

**Deploy öncesi kapı:** o kiracının env'iyle
`node scripts/verify-vin-kapisi.mjs <env>` çalıştırılmalı. Betik tam olarak bu
select'i atıyor ve başarısızsa **çıkış kodu 1** veriyor.

**Geri dönüş:** `vin`i select listesinden ve koşuldan çıkarmak — iki satır.

### 5.2 🟢 Veri kaybı riski YOK

- Telemetri yazma yoluna dokunulmadı.
- VIN backfill zaten kendi `try/catch`inde (`route.ts:241-248`); hata GPS
  akışını düşürmüyor, yalnız loglanıyor.
- En kötü işlevsel hâl: bir aracın VIN'i yazılmaz. Bir sonraki turda yazılır.
- `vehicles` satırı hiçbir koşulda **silinmiyor ya da bozulmuyor** — kaldırılan
  şey yalnız 0 satır eşleştiren bir istek.

### 5.3 🟢 `/api/flespi/ingest` etkilenmedi

O çağıranın kodu değişmedi ve dayandığı sunucu kapısı yerinde. Değişiklik
yalnız sync turunun içindeki çağrı noktasında.

### 5.4 Nasıl fark ederiz

1. **Beklenen:** `pg_stat_statements` sıfırlandıktan sonra
   `UPDATE vehicles SET vin` satırı **kaybolmalı** (ya da yeni araç eklendiği
   günlerde tek haneli kalmalı).
2. **Regresyon işareti:** yeni eklenen bir aracın VIN'i bir turdan sonra hâlâ
   NULL ise istemci kapısı yanlış tarafa kapanmış demektir.
   Kontrol: `select plate, vin from vehicles where flespi_device_id is not null and vin is null;`
3. Tur logu zaten döküm basıyor — `[flespi/sync] SORGU toplam=… kaynak={…}`
   içindeki `vehicles` kalemi düşmeli.

---

## 6 · DOĞRULAMA

| adım | sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run build` | **0 hata** |
| `lint:owner-scope` · `lint:tenant-defaults` · `lint:i18n` · `lint:crud` · `lint:takip` · `lint:install-sql` · `lint:arac-uclari` · `lint:ariza-bildir` · `lint:aksiyon-erteleme` · `lint:filo-yonetimi` · `lint:kontrast` | **11/11 GEÇTİ** |
| `lint:test-filters` | **taban değişmedi** |
| üç durum kanıtı (HAK61 + Sendigo) | **✓ 3/3, iki kiracıda da** |

Taban ölçümü tahminle değil `git stash` ile:

```
node scripts/check-test-filters.mjs            → çıkış 1   (değişiklikli)
git stash push app/api/flespi/sync/route.ts
node scripts/check-test-filters.mjs            → çıkış 1   (değişiklik yok)
git stash pop
diff once.txt sonra.txt                        → ÇIKTI BİREBİR AYNI
```

Tek bulgu `lib/auto-shift.ts:825` — `CLAUDE.md`'de kayıtlı mevcut durum,
bu turla ilgisi yok.

---

## 7 · KAPSAM DIŞI BIRAKILANLAR

Görev "bu tek iş" dediği için sync turunun başka hiçbir yerine dokunulmadı.
`SYNC-ISTEK-HARITASI.md` § 4'te duran ve **yapılmayan** kalemler:

- `depot.ts:313` iz okuması (6,6/tur) — § 4.2, riski kazancından büyük
- `saveDtc` 2.+ snapshot canlı okuması — § 4.3, **toplulaştırılmamalı**
- `saveVehicleEvents` cooldown döngüsü — § 4.4, migration gerektirir, kazancı yok
- `reconcileDtc` sayımı — § 4.5, bellekten türetilebilir ama bayatlama riski var

Dalda bekliyor. `push` ve `deploy` yapılmadı.
