# Takograf — Go kurulumu ve ölçüm

**26.08.2026 · ÖLÇÜM · kod yazılmadı, migration yazılmadı**

| İşaret | Anlamı |
|---|---|
| **[DOĞRULANDI]** | Bu makinede çalıştırıldı, çıktısı aşağıda |
| **[VARSAYIM]** | Ölçümden çıkarım — ölçümün kendisi değil |
| **[ÖLÇÜLMEDİ]** | Bu turda ölçülmedi |
| **[BİLMİYORUM]** | Cevabı yok |

---

## 1 · Go kurulumu

```
$ winget install --id GoLang.Go
Found Go Programming Language [GoLang.Go] Version 1.26.7
Downloading https://go.dev/dl/go1.26.7.windows-amd64.msi
Successfully verified installer hash
Successfully installed

$ go version
go version go1.26.7 windows/amd64
```

[DOĞRULANDI] · `GOPATH=C:\Users\90553\go` · `GOCACHE=C:\Users\90553\AppData\Local\go-build`

⚠️ Kurulum **PATH'e otomatik yansımıyor** yeni kabuklarda; `export PATH="/c/Program Files/Go/bin:$PATH"`
gerekiyor (Git Bash). PowerShell'de sorun yok.

---

## 2 · Derleme

```
$ git clone --depth 1 https://github.com/way-platform/tachograph-go
   commit 95ca680 · 2026-08-03 · MIT · 30 MB

$ cd cmd/tachograph && go build -o tachograph.exe .
   süre: 16 sn (bağımlılık indirmesi dâhil) · ikili: 23 MB
```

[DOĞRULANDI]

⚠️ **Depo dört modüllü**: kök `go.mod`, `cli/`, `cmd/tachograph/`, `tools/`.
Kökten `go build ./cmd/tachograph` **çalışmaz** (*"main module does not contain
package"*); `cmd/tachograph` dizinine girip derlemek gerekiyor.

### CLI yüzeyi

```
tachograph parse [file ...] [--flags]
  --authenticate       Authenticate signatures and certificates
  --preserve-raw-data  Store raw bytes for round-trip fidelity (default true)
  --raw                Output raw intermediate format (skip semantic parsing)
  --strict             Error on unrecognized tags (default true)
```

🔴 **Detaylı hızı atlayan bir bayrak YOK.** Faz 2'de "atlansın" kararı verildi;
kütüphanede bunu yapan bir seçenek bulunmuyor. (Ama §5'e bakın — kararın
gerekçesi değişiyor.)

---

## 3 · Tam `.ddd` üretimi — **BAŞARILI**

### Sorun

Test kayıtları tam dosya değil, **çerçevesi soyulmuş bloklar**. Çıkarma aracı
yalnız `record.GetValue()` yazıyor [DOĞRULANDI,
`internal/vu/cmd/extract-testdata-records/main.go:115`].

Ham birleştirme **başarısız**: `unknown or unsupported file type`.
Tespit kodu [DOĞRULANDI, `unmarshal.go:56-67`]:

```go
case data[0] == 0x76:                                  // araç ünitesi
case binary.BigEndian.Uint16(data[0:2]) == 0x0002:     // sürücü kartı
```

### Çözüm — çerçeveyi geri koymak

**Araç ünitesi**: her bloğun önüne `0x76 <TREP>` (2 bayt).
TREP haritası `transfer_type.proto` içindeki `(trep_value)` seçeneğinden
[DOĞRULANDI]:

| Tür | TREP | | Tür | TREP |
|---|---|---|---|---|
| OVERVIEW_GEN1 | `0x01` | | OVERVIEW_GEN2_V1 | `0x21` |
| ACTIVITIES_GEN1 | `0x02` | | ACTIVITIES_GEN2_V1 | `0x22` |
| EVENTS_AND_FAULTS_GEN1 | `0x03` | | EVENTS_AND_FAULTS_GEN2_V1 | `0x23` |
| DETAILED_SPEED_GEN1 | `0x04` | | **DETAILED_SPEED_GEN2** | `0x24` |
| TECHNICAL_DATA_GEN1 | `0x05` | | TECHNICAL_DATA_GEN2_V1 | `0x25` |
| | | | **OVERVIEW_GEN2_V2** | `0x31` |
| | | | **ACTIVITIES_GEN2_V2** | `0x32` |
| | | | **EVENTS_AND_FAULTS_GEN2_V2** | `0x33` |
| | | | **TECHNICAL_DATA_GEN2_V2** | `0x35` |

⚠️ Gen2 v2'de `0x34` **yok** — detaylı hız Gen2 v2'de de `0x24` (GEN2) olarak
kalıyor.

**Sürücü kartı**: TLV — `FID(2) + ek(1) + uzunluk(2, BE) + değer`
[DOĞRULANDI, `internal/card/rawcardfile.go:70-75`].
Ek bayt [DOĞRULANDI, `driver_card_file.go:1142-1171`]:
Gen1 DATA `0x00` · Gen1 SIGNATURE `0x01` · Gen2 DATA `0x02` · Gen2 SIGNATURE `0x03`.
FID'ler `elementary_file_type.proto` içindeki `(file_id)` seçeneğinden.

### Sonuç — 6 dosyanın 6'sı da ayrıştı

| Üretilen dosya | Bayt | Blok | Ayrıştırma |
|---|---|---|---|
| `vu-003-gen2v2.ddd` | 155.187 | 100 | ✅ JSON 3,73 MB |
| `vu-004-full.ddd` | 98.590 | 7 | ✅ JSON 2,15 MB |
| `vu-004-nospeed.ddd` | 6.418 | 6 | ✅ JSON 131 KB |
| `vu-000-gen1.ddd` | 100.533 | 10 | ✅ JSON 2,41 MB |
| `card-003-dual.ddd` | 35.820 | 18 TLV | ✅ JSON 632 KB |
| `card-000-gen1.ddd` | 10.699 | 8 TLV | ✅ JSON 205 KB |

[DOĞRULANDI]

> 🔑 **Uçtan uca test artık mümkün.** Faz 1 ve Faz 2'nin en büyük açık kalemi
> kapandı. Betikler: `scratchpad/tacho/hex2ddd.py` (VU) ve `hex2card.py` (kart).

---

## 4 · Ölçümler

**Yöntem:** kütüphanenin kendi API'si (`Unmarshal → [Authenticate] → Parse`)
ayrı bir ölçüm koşumundan çağrıldı; **JSON serileştirme ve stdout dışarıda**.
Her dosya **5 tur**, `runtime.GC()` ile temiz başlangıç, bellek
`TotalAlloc` farkı. Kaynak: `scratchpad/tacho/olcum/main.go`. [DOĞRULANDI]

### a–d) Ayrıştırma süresi ve bellek

| Dosya | Bayt | En kısa | En uzun | **Ortalama** | Tepe bellek |
|---|---|---|---|---|---|
| **vu-003-gen2v2** (en büyük VU) | 155.187 | 5,1 ms | 6,0 ms | **5,5 ms** | **1,9 MB** |
| vu-004-full | 98.590 | 0,5 ms | 0,6 ms | **0,5 ms** | 0,7 MB |
| **vu-004-nospeed** (detaylı hız yok) | 6.418 | 0,5 ms | 0,6 ms | **0,5 ms** | 0,1 MB |
| vu-000-gen1 | 100.533 | 0,5 ms | 1,1 ms | **0,6 ms** | 0,7 MB |
| **card-003-dual** (en büyük kart) | 35.820 | 2,3 ms | 2,8 ms | **2,6 ms** | 0,8 MB |
| card-000-gen1 | 10.699 | 1,0 ms | 1,1 ms | **1,1 ms** | 0,3 MB |

**Tepe bellek 1,9 MB** — en büyük dosyada. [DOĞRULANDI]

### c) 🔴 Detaylı hız atlanınca süre DEĞİŞMİYOR — Faz 2 varsayımım yanlıştı

| | dosya boyutu | **süre** | JSON çıktısı |
|---|---|---|---|
| `vu-004-full` | 98.590 B | **0,5 ms** | 2,15 MB |
| `vu-004-nospeed` | 6.418 B | **0,5 ms** | 131 KB |
| **fark** | **−%93,5** | **≈ 0** | **−%94 (16 kat)** |

**Faz 2'de şöyle demiştim:** *"ayrıştırma maliyeti detaylı hız bloğundan
gelir"*. **Ölçüm bunu çürüttü.**

Sebep: detaylı hız **düz bir bayt dizisidir**. JSON'da
`$.vehicleUnit.gen2V2.detailedSpeed[0].speedBlocks` = **1.440 blok**, her biri
`beginDate` + `speedsKmh` (dakika başına 60 değer) [DOĞRULANDI]. 92 KB'ı
taramak ≈ 184 MB/s — modern bir CPU için ücretsiz.

**Gerçek maliyet sürücüsü BLOK SAYISI:**

| Dosya | Blok | Süre | Blok başına |
|---|---|---|---|
| vu-003 | 100 | 5,5 ms | **55 µs** |
| vu-004 | 7 | 0,5 ms | **71 µs** |
| vu-000 | 10 | 0,6 ms | **60 µs** |

Tutarlı **≈55–70 µs/blok**. Bir ACTIVITIES bloğu ≈ bir gün. 365 günlük tam bir
VU indirmesi ≈ 371 blok → **≈22 ms** [VARSAYIM — bu boyutta dosya elimizde yok].

> **Detaylı hızı atlama kararı GEÇERLİ kalıyor ama gerekçesi değişti:**
> CPU tasarrufu değil, **yük tasarrufu** — JSON 2,15 MB → 131 KB, 16 kat.
> Servis ile Next.js arasındaki hat ve bellek bundan kazanır.

### e) `Authenticate()` — anonim veride **HATA veriyor, "doğrulanamadı" DEMİYOR**

Çıktı **aynen** [DOĞRULANDI]:

**Araç ünitesi** (`vu-004-full.ddd`, `vu-003-gen2v2.ddd`):
```
Error authenticating ddd/vu-004-full.ddd: failed to extract Gen2 certificates:
expected exactly 1 MSCA certificate, got 0
```
(her kayıt için tekrarlanıyor)

**Sürücü kartı** (`card-003-dual.ddd`, `card-000-gen1.ddd`):
```
Error authenticating ddd/card-003-dual.ddd: Gen1 authentication failed:
failed to extract Gen1 certificates: card certificate not found in Gen1 card file
Gen2 authentication failed: failed to extract Gen2 certificates: card ...
```

#### 🔴 Bu ürün için üç sonuç

1. **`Authenticate` bir DURUM döndürmüyor, `error` fırlatıyor.** Faz 2'deki
   `muhur_durumu` üç değeri (`dogrulandi` / `dogrulanamadi` / `denenmedi`)
   kütüphaneden hazır gelmiyor — **servisin hatayı yakalayıp çevirmesi
   gerekiyor**. Tasarım doğru, ama uygulama yükü sandığımdan fazla.

2. **`Authenticate` ile `Parse` AYRI çağrılmalı.** CLI'da `--authenticate`
   verildiğinde kimlik hatası **tüm işlemi düşürüyor**. Ayrı çağırınca
   ayrıştırma sağlam çalışıyor [DOĞRULANDI]:
   ```
   vu-004-full.ddd     ✅ ayrıştı   (authenticate olmadan)
   card-003-dual.ddd   ✅ ayrıştı   (authenticate olmadan)
   ```
   > Servis sırası: **önce `Parse`, sonra ayrıca `Authenticate`** ve ikincinin
   > hatası **yutulur, damgaya çevrilir**. Ters sıra, mührü bozuk bir dosyanın
   > ayrıştırılamamasına yol açardı — Volkan'ın 2. kararının ("kabul edilir ama
   > damgalanır") tam tersi.

3. **Hata sebebi sertifika yokluğu, imza uyuşmazlığı değil.** Anonimleştirme
   sertifika bloklarını çıkarmış; imza doğrulaması **hiç denenmemiş**. Yani
   *"imza tutuyor mu"* sorusu bu veriyle **hâlâ cevapsız** — gerçek bir dosya
   gerekiyor. [ÖLÇÜLMEDİ]

### Ek ölçüm: kaç satır üretiyor

| Dosya | Faaliyet değişimi | Gün | Olay | Arıza |
|---|---|---|---|---|
| VU 003 (Gen2v2) | **3.430** | 96 | 28 | 0 |
| Kart 003 (çift nesil) | — | — | 204 | 96 |

[DOĞRULANDI] · 365 günlük tam VU ≈ **13.000 faaliyet satırı** [VARSAYIM]

### Ek ölçüm: CLI duvar saati (kıyas için)

| Dosya | CLI toplam |
|---|---|
| vu-004-full | 92 ms |
| vu-004-nospeed | 70 ms |
| vu-003-gen2v2 | 97 ms |

⚠️ Bu sayılar **ayrıştırma değil**: süreç başlatma + JSON serileştirme +
stdout. Ayrıştırmanın kendisi 0,5–5,5 ms. Farkı bilerek yazıyorum — CLI'ı
ölçüp "ayrıştırma 92 ms sürüyor" demek yanlış olurdu.

---

## 5 · SÜRE KARARI: **SENKRON**

### Tek net öneri

> **Ayrıştırma senkron yapılsın.** Kullanıcı "Yükle"ye bastığında dosya
> ayrıştırılır ve sonucu aynı istekte döner.

### Gerekçe — ölçüm

| Ölçüm | Değer |
|---|---|
| En büyük gerçek dosya (155 KB, 100 blok) | **5,5 ms** |
| En büyük sürücü kartı | **2,6 ms** |
| 365 günlük tam VU tahmini (371 blok × 60 µs) | **≈22 ms** [VARSAYIM] |
| Tepe bellek | **1,9 MB** |

**22 ms'lik bir işi asenkron kuyruğa koymak, çözdüğünden fazla sorun üretir:**
durum kolonu, yoklama, tepsi arayüzü, yeniden deneme, "işleniyor" ekranı — hepsi
22 ms için.

### ⚠️ Ama tek koşulla: asıl maliyet ayrıştırma DEĞİL

Bir VU dosyası **3.430 faaliyet satırı** üretiyor (365 günlükte ≈13.000).
**Veritabanına yazma süresi [ÖLÇÜLMEDİ]** — ürün kodu yazmadan ölçülemez.

Bu yüzden öneri şu biçimde:

1. **Ayrıştırma senkron** — ölçüldü, 22 ms'yi geçmiyor.
2. **Satır yazımı da aynı istekte**, ama **parçalı** (`upsert` blokları).
3. **Faz 3'ün ilk ölçümü satır yazımı olsun.** 13.000 satırlık `upsert`
   PostgREST üzerinden 5 saniyeyi aşarsa karar asenkrona döner.
4. 🔑 **Faz 2'nin `ayristirma_durumu` kolonu ŞEMADA KALSIN.** Bugün hep
   `'tamam'` yazılır; ölçüm ters çıkarsa asenkrona geçmek bir **migration
   değil, bir kod değişikliği** olur.

**Değişmeyen:** ayrıştırma başarısız olsa da dosya saklanır (Volkan'ın 7.
kararı). Senkron olması bunu değiştirmez — hata mesajı hemen görünür, dosya
yine durur.

---

## 6 · Faz 2 tasarımına düzeltmeler

| Faz 2'de yazdığım | Ölçüm |
|---|---|
| *"Ayrıştırma maliyeti detaylı hız bloğundan gelir"* | 🔴 **YANLIŞ** — süre 0,5 ms, atlansa da 0,5 ms. Maliyet **blok sayısında**. |
| *"Ayrıştırma süresini bilmediğim için asenkron"* | 🔴 **Artık biliyorum: 5,5 ms.** Karar **senkron**a döndü. |
| *"Detaylı hız atlansın"* (Volkan onayladı) | ✅ Karar geçerli, **gerekçe değişti**: CPU değil, JSON yükü (16 kat). |
| `muhur_durumu` üç değerli | ✅ Doğru — ama kütüphane bu durumu **vermiyor**, `error` fırlatıyor; servis çevirecek. |
| *"İmza anonim veride tutmaz"* [VARSAYIM] | ⚠️ **Kısmen** — imza denenmiyor bile; **sertifika bulunamıyor**. Asıl soru hâlâ cevapsız. |

---

## 7 · Açık kalanlar

| Konu | Durum |
|---|---|
| Gerçek (anonim olmayan) dosyada imza doğrulaması | **[ÖLÇÜLMEDİ]** — sertifikalı dosya gerekiyor |
| 13.000 satırlık DB yazımı süresi | **[ÖLÇÜLMEDİ]** — ürün kodu gerekir, Faz 3'ün ilk işi |
| 365 günlük gerçek VU dosyası | elimizde yok — en büyüğü 96 gün |
| Detaylı hızı atlayan kütüphane seçeneği | **YOK** — servis parse sonrası alanı düşürecek [VARSAYIM] |
| `Unparse`/`Marshal` ile tur-dönüşü doğruluğu | **[ÖLÇÜLMEDİ]** — üretim yolu Python'la kuruldu, kütüphanenin kendi `Unparse`'ı denenmedi |
| ERCA sertifika zincirinin nereden alınacağı | `tools/cmd/fetch-certs` var, **denenmedi** |
| Linux/AB sunucusunda aynı süreler | bu ölçüm **Windows dizüstü**; sunucuda farklı olabilir |
