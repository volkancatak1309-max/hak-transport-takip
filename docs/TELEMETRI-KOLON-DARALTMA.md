# device_telemetry kolon daraltma — 28.08.2026

> Dal: `perf/telemetri-kolon-daraltma` (main'e dokunulmadı, push/deploy yok).
> Değişiklik: **tek satır** — `lib/telemetry.ts:264`.
> Doğrulama: `npx tsc --noEmit` 0 · `npm run build` 0 · muhafızlar taban.
> DB'ye tek yazma yapılmadı; ölçümlerin hepsi `HEAD` + `count=exact` (salt okuma).

---

## 🔴 ÖNCE BAŞLIK: DARALTMA YAPILDI AMA 1.116 ms'İN SEBEBİ BU DEĞİLDİ

Şüpheli doğru bulundu — `select("*")` gerçekten tek bir yerde vardı ve
pg_stat_statements'taki sorgu tam olarak orasıydı. Ama **daraltmanın ölçülebilir
bir hız kazancı yok.** Sıra-adil ölçüm bunu çürüttü (§ 4).

Değişiklik yine de yapıldı: davranış birebir aynı, risk sıfır, kod tabanının
kendi kuralına uyuyor. Ama "en pahalı sorgu düzeldi" diye rapor edilemez —
**edilmiyor.** 1.116 ms'in gerçek sebebi § 5'te.

---

## 1 · BULUNAN ÇAĞRILAR

Taranan: `lib/` · `app/` · `components/` · `hooks/` (34 `device_telemetry`
sorgusu) + `scripts/` (üretim değil, yine de bakıldı).

### 1.1 `select("*")` — TAM OLARAK BİR TANE

| # | Yer | Fonksiyon | Zincir |
|---|---|---|---|
| 1 | **`lib/telemetry.ts:225`** (değişiklikten önce) | `geriOkumaMuhafizi` | `.select("*", { count: "exact", head: true }).in("vehicle_id", …).gte("recorded_at", …).lte("recorded_at", …)` |

pg_stat_statements'ta bildirilen imza ile birebir aynı:
`SELECT "public"."device_telemetry".* … WHERE vehicle_id = ANY($1) AND recorded_at >= …`

### 1.2 Argümansız `select()` — HİÇ YOK

`select()` çağrısı `device_telemetry` üzerinde hiçbir yerde argümansız
kullanılmıyor.

### 1.3 Aynı SQL'i üretebilecek ikinci bir yol var mı? — YOK

Üç ihtimal ayrı ayrı elendi:

| İhtimal | Sonuç |
|---|---|
| **PostgREST gömme** (`select("*, device_telemetry(*)")`) — gömme `fk = ANY($1)` üretir, imzaya tıpatıp uyar | `device_telemetry(` deseni **hiçbir select stringinde yok** ✓ |
| **Dinamik/değişkenli select** (`select(KOLONLAR)`) | `device_telemetry` üzerinde hiç yok; sabitli select'ler yalnız başka tablolarda ✓ |
| **`.in("vehicle_id", …)` kullanan ikinci sorgu** | Sadece `lib/bakim-db.ts:199` — ama o `select("vehicle_id, odometer_km, recorded_at")`, yani `pgrst_source`'u `.*` DEĞİL ✓ |

→ Bildirilen sorgunun kaynağı **tek ve kesin**: `geriOkumaMuhafizi`.

### 1.4 Kalan 33 sorgunun select listeleri (hepsi zaten dar)

```
8×  select("recorded_at")
4×  select("odometer_km")
6×  select("id", { count: "exact", head: true })      ← sayım deseni
3×  select("odometer_km, recorded_at")
2×  select("id") / select("id, vehicle_id")           ← upsert dönüşü
1×  select("vehicle_id, odometer_km, recorded_at")
1×  select("recorded_at, ignition_on, speed_kmh, odometer_km")
1×  select("recorded_at", { count: "exact" })
1×  select("latitude, longitude, speed_kmh, recorded_at")
1×  select("latitude, longitude, ignition_on, recorded_at")
2×  select("vehicle_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at")
1×  select( 19 kolon )  ← latestVehicleTelemetry
```

---

## 2 · TÜKETİLEN KOLONLAR

`geriOkumaMuhafizi`'nin dönen veriden **tükettiği kolon sayısı: SIFIR.**

```ts
const { count, error } = await supabaseAdmin
  .from("device_telemetry")
  .select("*", { count: "exact", head: true })   // head:true → SATIR DÖNMÜYOR
  …
if (error) return;
if ((count ?? 0) < rows.length) { console.error(…) }
```

Fonksiyonun tamamı okundu (`lib/telemetry.ts:219-260`): dönen nesneden yalnız
`count` ve `error` kullanılıyor. `data` diye bir değişken bile yok — `head: true`
zaten satır döndürmüyor. Yani hiçbir kolon tüketilmiyor ve tüketilme ihtimali
olan bir yol da yok.

**Neden `id` seçildi:** kod tabanındaki diğer altı sayım sorgusu
(`km-quality.ts:93`, `km-quality.ts:103`, `reports.ts:1133`, `saklama-db.ts:504`,
`demo-retention/route.ts:95`, `:99`) zaten `select("id", { count: "exact",
head: true })` kullanıyor. Burası tek istisnaydı; artık değil.

### 🔴 Davranış aynı kalıyor mu? — ÖLÇÜLDÜ, EVET

Tehlike şuydu: PostgREST `count=exact` acaba **satır** mı sayıyor, yoksa
**seçilen kolonun dolu olduğu satırları** mı? İkincisi olsaydı daraltma sessiz
bir davranış değişikliği olurdu.

Test: aynı pencerede üç farklı select ile sayım — biri kasten **%65'i NULL** olan
bir kolon (`fuel_volume_l`, ölçüldü: 591.468 / 1.705.040 dolu).

| pencere | eşleşen | `select=*` | `select=id` | `select=fuel_volume_l` |
|---|---:|---:|---:|---:|
| 30 sn | 26 | 26 | 26 | 26 |
| 2 dk | 166 | 166 | 166 | 166 |
| 1 saat | 5.495 | 5.495 | 5.495 | 5.495 |
| 4 saat | 19.469 | 19.469 | 19.469 | 19.469 |
| 1 gün | 43.017 | 43.017 | 43.017 | 43.017 |
| 7 gün | 234.338 | 234.338 | 234.338 | 234.338 |
| 46 gün | 1.708.882 | 1.708.882 | 1.708.882 | 1.708.882 |

**Yedi pencerede de aynı sayı, NULL'lu kolonda bile.** → `count=exact` SATIR
sayıyor. Daraltma davranışı değiştirmiyor. `[DOĞRULANDI]`

---

## 3 · YAPILAN DEĞİŞİKLİK

`lib/telemetry.ts` — kod farkı **tek satır** (gerisi gerekçe yorumu):

```diff
-      .select("*", { count: "exact", head: true })
+      .select("id", { count: "exact", head: true })
```

Filtre, sıralama, limit, `head`, `count` modu: **hiçbiri değişmedi.** Sorgunun
kendisi yeniden yazılmadı.

---

## 4 · ÖLÇÜM

### 4.1 Kolon sayısı ve bayt

| | önce | sonra |
|---|---|---|
| select listesindeki kolon | **23** (`*` = tablonun tamamı) | **1** (`id`) |
| ağ üzerinden dönen satır | 0 (`head: true`) | 0 (`head: true`) |
| **ağ yükü** | **0 bayt** | **0 bayt** |
| satır başına tahmini bayt | — | — |

> ⚠️ "Satır başına bayt" bu sorgu için **anlamsız**: `head: true` olduğu için
> zaten hiç satır dönmüyordu. Daraltmanın kazanabileceği tek yer **sunucu
> tarafı** — ve orada da kazanç ölçülemedi (§ 4.2).
>
> Referans olsun diye: `device_telemetry` satırı JSON'da **~550-560 bayt**
> (23 kolon, canlıdan üç örnek ölçüldü), tek `id` kolonu ~50 bayt. Yani
> satır DÖNSEYDİ kazanç ~%91 olurdu. Dönmüyor.

### 4.2 🔴 Sunucu tarafı — SIRA-ADİL ÖLÇÜM: FARK YOK

**İlk ölçümüm yanlıştı ve düzeltildi.** Adayları sırayla koşturunca şu çıkmıştı:

```
46 gün · select=*  3.453 ms  →  select=id  368 ms     = 9,4× (SAHTE)
```

Bu **sıra artefaktıydı**: `select=*` önce koştu ve soğuk önbelleği o ödedi;
hemen ardından koşan `select=id` bedavaya sıcak sayfaları buldu. Doğru yöntem
adayları her turda döndürmek. 9 tur, döndürmeli, HAK61 canlı, 1,71 M satır:

| pencere | eşleşen | `select=*` medyan | `select=id` medyan | `select=vehicle_id` medyan |
|---|---:|---:|---:|---:|
| 31 sn (normal tur) | 24 | **145 ms** | 146 ms | 153 ms |
| 3 saat (telafi turu) | 15.995 | **144 ms** | 153 ms | 152 ms |
| 46 gün (en kötü hâl) | 1.709.176 | **400 ms** | 404 ms | 394 ms |

**Kazanç: 0,95×–1,02×. Yani yok.** `[DOĞRULANDI]`

Sebebi anlaşılır: PostgREST'in ürettiği `pgrst_source` CTE'si tek kez
kullanıldığı için PostgreSQL onu satır içi açıyor, ve sayım-dışı çıktı
kolonlarını planlayıcı zaten buduyor (`remove_unused_subquery_outputs`).
`SELECT tbl.*` ile `SELECT tbl.id` aynı plana çıkıyor.

**Ölçemediğim tek şey** `[BİLMİYORUM]`: eşzamanlı yük altındaki davranış. Canlı
müşteride eşzamanlılık testi yapmadım. Tam satır referansı (`tbl.*`)
planlayıcının budayamayacağı tek şekil olduğu için, daraltma o bilinmeyen payı
kapatıyor — değişikliği tutmanın gerekçesi bu, ölçülmüş bir hız kazancı değil.

### 4.3 Muhafız penceresi gerçekte ne kadar geniş? — `[DOĞRULANDI]`

Pencere `anlar[0]`→`anlar[son]`, yani o turda yazılan satırların zaman açıklığı.
`ingested_at` kümelerinden ölçüldü:

| örnek | tur | pencere p50 | p90 | maks |
|---|---:|---:|---:|---:|
| 27.08 08:00Z (normal sabah) | 25 | **31 sn** | 74 sn | 171 sn |
| 27.08 13:00Z (normal öğlen) | 29 | **31 sn** | 117 sn | 276 sn |
| 27.08 02–05Z (gece→sabah) | 123 | **25 sn** | 69 sn | 141 sn |
| **28.08 08:00Z (kesinti telafisi)** | 1 | **2,9 saat** | — | 2,9 saat |

Normal turda pencere 31 saniye ve sorgu ~24 satır sayıyor — yani bu sorgu
**normalde zaten ucuz**. Genişlediği tek durum telafi turu.

---

## 5 · O HÂLDE 1.116 ms NEREDEN GELİYORDU?

`[DOĞRULANDI]` + `[VARSAYIM]` karışık, ayrımı yazılı:

**Çağrı sayısı tutuyor** `[DOĞRULANDI]`: 25.366 çağrı ÷ 2.880 sync turu/gün ≈
**8,8 gün**. `geriOkumaMuhafizi` tur başına tam bir kez koşuyor. Yani sayaç
~20.08 → 28.08 arasını kapsıyor.

**O aralığın tamamı Micro'daydı** (1 GB bellek, 1,36 GB veritabanı). Aynı
sorgu bugün Small'da, normal pencerede **~145 ms** ölçülüyor — ve bunun
**~85 ms'i benim ağ gidiş-dönüşüm** (Windows'tan Supabase'e; gözlenen en ucuz
çağrı 86 ms). Yani gerçek DB zamanı **~60 ms**.

```
Micro ortalaması   1.116 ms
Small'da ölçülen      ~60 ms  (gerçek DB zamanı)
                   ─────────
                      ~18×
```

`[VARSAYIM]` — bu 18×'in tamamının bellek yetersizliğinden geldiğini iddia
edemem (pg_stat_statements'ın kendi `shared_blks_read` sütunu okunabilirse
kesinleşir), ama yön nettir ve `docs/HAK61-SAGLIK.md`'deki soğuk/sıcak
ölçümüyle aynı yöne bakıyor: çalışma kümesi RAM'e sığmıyordu.

**Sonuç: bu sorgu "pahalı bir sorgu" değildi; aç bir makinede koşan sık bir
sorguydu.** 25.366 çağrı × zaten ucuz bir iş, kötü koşullarda toplamda
28.309 saniye eder.

---

## 6 · DOKUNULMAYANLAR ve GEREKÇELERİ

### 6.1 Sorgunun şekli — kullanıcı kuralı gereği

`geriOkumaMuhafizi` her sync turunda (günde 2.880) `count=exact` koşuyor ve
sonucu yalnız `rows.length` ile karşılaştırıyor. Pencere telafi turunda saatlere
çıkabiliyor. Burada yapısal bir iyileştirme alanı var (örneğin sayımı yalnız
şüpheli turlarda koşmak), **ama görev "sorgunun kendisini yeniden yazma, sadece
kolon listesini daralt" diyordu.** Rapor edildi, dokunulmadı.

### 6.2 `listVehicleTrack` — 7 kolon, DOKUNULMADI

`lib/telemetry.ts:1107` · `vehicle_id, latitude, longitude, speed_kmh, heading,
ignition_on, recorded_at` · sayfalı, en yüksek satır hacimli okuma.

**Neden dokunulmadı:** 10'dan fazla tüketicisi var — `metrics-distance`,
`metrics-engine-hours`, `metrics-geofence`, `metrics-idle`, `metrics-trips`,
`route-history`, `mevzuat-db`, `auto-shift`, `depot`, `vehicle-day`, iki mobil
uç. Kolonların hepsinin tüketildiğine dair kod içinde **zaten yazılı iki denetim
notu** var (`route-history.ts:17` ve `app/api/mobile/vehicles/[id]/rota/route.ts:21`).
Kuralın gereği: emin olamadığım kolonu listede bırakıyorum.

### 6.3 `latestVehicleTelemetry` — 19 kolon, DOKUNULMADI

`lib/telemetry.ts:880`. 19 kolonun tamamı araç detay kartında gösteriliyor
(fuel, rpm, coolant, voltaj, gsm, uydu, irtifa, dtc…) ve fonksiyonun kendi
yorumu seyrek CAN alanlarının **bilerek** çekildiğini söylüyor: pencere birden
çok satır okuyup her alanı en son raporlayan satırdan tamamlıyor. Kolon atmak
kartta "—" üretirdi — **davranış değişikliği olurdu.**

### 6.4 `vehicle-day-db.ts:87` — `select("recorded_at", { count: "exact" })`

`head` yok, yani satır DÖNÜYOR — ve dönen satır kullanılıyor
(`ilkRes.data[0].recorded_at` → `ilk`). Hem `count` hem tek kolon gerekli,
`limit(1)` var. **Zaten minimum.**

### 6.5 `bakim-db.ts:199` — 3 kolon

`vehicle_id, odometer_km, recorded_at` — üçü de döngüde okunuyor
(`odo.set(vid, { km, an })`). Zaten minimum.

### 6.6 `scripts/` altındaki ölçüm betikleri

Üretimde koşmuyorlar ve hiçbirinde `device_telemetry` üzerinde `select("*")`
yok (tarandı). Dokunulmadı.

---

## 7 · DOĞRULAMA

| Adım | Sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run build` | **0 hata** |
| `lint:owner-scope` · `lint:tenant-defaults` · `lint:i18n` · `lint:crud` · `lint:takip` · `lint:install-sql` | **hepsi geçti** |
| `lint:test-filters` | **taban değişmedi** — ölçüldü |

Taban ölçümü tahminle değil, `git stash` ile yapıldı:

```
git stash push lib/telemetry.ts  →  node scripts/check-test-filters.mjs  →  çıkış 1
git stash pop                    →  node scripts/check-test-filters.mjs  →  çıkış 1
diff önce.txt sonra.txt          →  ÇIKTI BİREBİR AYNI
```

Tek bulgu `lib/auto-shift.ts:825` — `CLAUDE.md`'de zaten kayıtlı olan mevcut
durum, bu turla ilgisi yok.

**Canlıda kanıt:** bu turun bütün ölçümleri HAK61 canlı veritabanında yapıldı
(`HEAD` + `count=exact`, salt okuma). Hiçbir satır yazılmadı, silinmedi,
değiştirilmedi; hiçbir DDL çalıştırılmadı; migration yazılmadı.

---

## 8 · SIRADAKİ

Dalda bekliyor. `push` ve `deploy` yapılmadı.

Bu değişiklik tek başına HAK61'i hızlandırmaz — **ölçüldü, hızlandırmıyor.**
Gerçek kaldıraçlar `docs/HAK61-SAGLIK.md` § 8'de duruyor ve sırası değişmedi:

1. flespi sync 30 sn → 60 sn (sabit yükü yarılar, satır sayısını etkilemez)
2. `report_fuel_volume_stats`'ı araç eksenine çevir (arıza önleme — ikizi
   46 günlük pencerede zaten `57014` alıyor)
3. Yakıt raporunu `vehicle_month_metrics`'ten oku
4. 11.10.2026'dan önce saklama süresi kararı
