# HAK61 veritabanı sağlık ölçümü — 28.08.2026

> 🔴 **Bu tur SALT OKUMADIR.** Tek satır yazılmadı, silinmedi, hiçbir DDL
> çalıştırılmadı. Yapılan her şey `SELECT` / `HEAD count` ve `stable` RPC
> çağrısıdır. Önerilerin hiçbiri uygulanmadı — karar Volkan'ın.
>
> Ölçüm aracı: `scripts/measure-hak61-saglik.mjs` (UI-yol kanıtı) +
> PostgREST üzerinden doğrudan sayım. Ölçüm anı **28.08.2026 09:00–09:20 UTC**,
> yani sunucu **Micro → Small** yükseltmesinden SONRA.

## Etiketler

`[DOĞRULANDI]` = bu turda canlıda ölçüldü, kaynağı yazılı ·
`[VARSAYIM]` = hesapla türetildi, ölçülmedi · `[BİLMİYORUM]` = ölçülemedi.

---

## 0 · ÖNCE ŞUNU BİLİN: ÖLÇÜM KANALI DAR

`pg_stat_statements`, `pg_stat_user_indexes`, `pg_stat_user_tables`,
`pg_stat_activity`, `pg_total_relation_size` — **HİÇBİRİNE ERİŞEMİYORUM.**
`[DOĞRULANDI]`

Sebep, bu projenin mimarisi:

| Kanal | Durum | Kaynak |
|---|---|---|
| Doğrudan postgres bağlantısı | **YOK** — `package.json`'da `pg` / `postgres` sürücüsü yok, yalnız `@supabase/supabase-js` | `package.json:67` |
| `DATABASE_URL` benzeri sır | **YOK** — `.env.local` yalnız 5 anahtar taşıyor (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_PASSWORD`, `FLESPI_SYNC_SECRET`, `FLESPI_TOKEN`) | `.env.local` |
| `psql` / `supabase` CLI | **KURULU DEĞİL** (`command not found`) | kabuk |
| Supabase Management API jetonu | **YOK** (`SUPABASE_ACCESS_TOKEN` ne ortamda ne diskte) | ortam taraması |
| Genel "SQL çalıştır" RPC'si | **YOK** — canlı şemadaki 18 RPC'nin hiçbiri keyfi SQL almıyor | PostgREST OpenAPI |

Yani `pg_catalog` bu turda **ulaşılamazdı**. Aşağıda "ÖLÇÜLEMEDİ" yazan her
satır bu yüzden öyle. **§ 9'da Volkan'ın SQL Editor'a yapıştıracağı hazır
sorgular var** — o beş sorgu bu boşlukların hepsini 30 saniyede kapatır.

Boşluğu kapatmak için ölçüm yöntemi değiştirildi: `pg_stat_statements` yerine
**sayfaların gerçekten çalıştırdığı kod yolu koşturulup zamanlandı** (projenin
`CLAUDE.md`'sindeki "UI-path proof" kuralı). Bu, uygulamanın kendi sorguları
için `pg_stat_statements`'tan **daha keskin** bir cevap verir; kaçırdığı şey
PostgREST/Supavisor'un kendi iç trafiğidir.

---

## 1 · TABLO BOYUTLARI

### 1.1 Satır sayıları — `[DOĞRULANDI]` (`count=exact`, 28.08 09:02 UTC)

| Tablo | Kesin satır | Pay |
|---|---:|---:|
| **device_telemetry** | **1.705.040** | **%99,37** |
| vehicle_events | 6.009 | %0,35 |
| vehicle_dtc | 1.612 | %0,09 |
| idle_episodes | 1.258 | %0,07 |
| shift_packages | 756 | %0,04 |
| time_entries | 629 | %0,04 |
| mevzuat_uyarilari | 153 | %0,01 |
| driver_locations | 81 | — |
| login_attempts | 61 | — |
| sofor_skor_donem | 55 | — |
| workers | 34 · vehicles 30 · vehicle_telemetry_lifetime 29 | — |
| **kalan 57 tablo** | **toplam 313** | — |
| **device_telemetry DIŞI TOPLAM** | **10.862** | **%0,63** |

**Cümlenin tamamı bu:** bu veritabanında 68 tablo var ve **biri hariç hepsi
birlikte 11 bin satır**. Geri kalan her şey `device_telemetry`.

> Yan bulgu `[DOĞRULANDI]`: 68 tablonun **29'u tamamen boş**, 10'u tek satırlık
> kiracı ayarı. `zone_visits` 0, `teslimatlar` 0, `bakim_planlari` 0,
> `worker_documents` 0. Yani son iki ayda kurulan modüllerin çoğu HAK61'de
> henüz kullanılmıyor. Bunlar yük üretmiyor.

### 1.2 Bayt cinsinden boyut — `[BİLMİYORUM]` + `[VARSAYIM]` hesabı

`pg_total_relation_size` okunamadı. Ama satır genişliği **şemadan tam olarak
hesaplanabilir** ve kısmi indekslerin kardinalitesi ölçüldü, o yüzden
tahmin değil, **yöntemi yazılı bir hesap** verebiliyorum.

**Satır genişliği** — `device_telemetry`'nin 23 kolonu (014 + 017 + 021 + 039),
64-bit hizalamayla:

```
sabit kolonlar (id..dtc_number)          176 bayt   (3 hizalama dolgusu dahil)
fuel_volume_l numeric (satırların %34,7'si) ~3,5 bayt (ortalama)
tuple başlığı + null bitmap                 32 bayt
sayfa içi satır işaretçisi                   4 bayt
                                        ──────────
                                        ≈ 220 bayt/satır
```

`[DOĞRULANDI]` girdi: kolon listesi ve tipleri (`014/017/021/039`), ve kısmi
indeks kardinaliteleri — `fuel_volume_l` dolu %34,7 · `fuel_level_pct` dolu
%63,9 · `odometer_km` dolu %84,4 · `engine_rpm` dolu %83,2 · `ignition_on=true` %88,7.

| Nesne | migration | kapsanan satır | Tahmini boyut |
|---|---|---:|---:|
| heap (tablo verisi) | 014 | 1.705.040 | **375 MB** |
| PK `id` (uuid) | 014 | 1.705.040 | 53 MB |
| `idx_..._vehicle_recorded` (UNIQUE) | 014 | 1.705.040 | 69 MB |
| `idx_..._device_recorded` | 014 | 1.705.040 | 53 MB |
| `idx_..._fuel_volume` (kısmi) | 039 | 591.468 | 24 MB |
| `idx_..._fuel_pct_time` (kapsayan, kısmi) | 049 | 1.090.229 | 63 MB |
| `idx_..._fuel_volume_time` (kapsayan, kısmi) | 049 | 591.468 | 34 MB |
| `idx_..._vehicle_odo` (kapsayan, kısmi) | 053 | 1.439.258 | 71 MB |
| `idx_..._vehicle_fuel_pct` (kapsayan, kısmi) | 053 | 1.090.229 | 63 MB |
| `idx_..._recorded_brin` | 090 | 1.705.040 | ~0,1 MB |
| **İNDEKS TOPLAMI** | | | **430 MB** |
| **device_telemetry TOPLAM** | | | **≈ 805 MB** |

> 🔴 **İNDEKSLER TABLODAN BÜYÜK.** 375 MB veri, 430 MB indeks. Bu tabloda
> **9 indeks** var (8 + BRIN) ve her `insert` dokuzunu birden güncelliyor.
> `[VARSAYIM]` — hangi indekslerin canlıda GERÇEKTEN kurulu olduğu
> doğrulanamadı (§ 3.1). 053 uygulanmadıysa toplam ≈ **672 MB**.

**Çapraz kontrol:** Volkan'ın okuduğu disk 1,36 GB. Hesap: 805 MB
(device_telemetry) + ~15 MB (kalan 67 tablo) + ~300–400 MB (Supabase'in kendi
`auth`/`storage`/`realtime` şemaları, `pg_catalog`, WAL) ≈ **1,12–1,22 GB**.
Ölçülenle %10–17 arasında tutuyor — hesap makul, ama **kesin sayı § 9'daki
1. sorgudan alınmalı.**

---

## 2 · BÜYÜME HIZI — `[DOĞRULANDI]`

`recorded_at` ekseninde gün gün sayıldı (UTC gün sınırı):

```
08-17  45.026   08-22  36.110   08-27  42.034
08-18  44.285   08-23     520 ← Pazar
08-19  41.057   08-24  33.217
08-20  41.305   08-25  41.038
08-21  39.755   08-26  40.502
```

| Ölçü | Değer |
|---|---:|
| 20 tam günün ortalaması | **34.147 satır/gün** |
| son 7 tam gün | **33.311 satır/gün** |
| iş günü tepe | 41–48 bin |
| Pazar | 520 – 2.886 (araçlar durur) |
| en eski kayıt | **13.07.2026 15:44 UTC** |
| veri yaşı | **46 gün** |
| ömür boyu ortalama | 1.705.040 / 46 = 37.066/gün |

**Bayt cinsinden büyüme** `[VARSAYIM]`, § 1.2'nin 472 bayt/satır (heap+indeks)
katsayısıyla:

| | satır | boyut |
|---|---:|---:|
| gün | 34.147 | **16,1 MB** |
| ay | ~1,02 M | **490 MB** |
| yıl | ~12,5 M | **5,9 GB** |

Diğer tablolar büyümede **görünmüyor** `[DOĞRULANDI]`: `vehicle_events`
95/gün, `idle_episodes` 25/gün, `zone_visits` 0/gün. `driver_locations` 81
satırda **donmuş** (son yazma 21.07.2026 — telefon GPS'i kaldırıldı, tablo
duruyor).

---

## 3 · İNDEKS SAĞLIĞI

### 3.1 Kullanılmayan indeks var mı? — `[BİLMİYORUM]` + bir güçlü aday

`pg_stat_user_indexes.idx_scan` okunamadı. **Ama kod tarafından bir aday
kesinleşti:**

> 🔴 **`idx_device_telemetry_device_recorded` (flespi_device_id, recorded_at desc)
> — tüketicisi YOK.** `[DOĞRULANDI]` (grep: `lib/`, `app/`, `db/migrations/`)
>
> `flespi_device_id` `device_telemetry`'ye yalnız **YAZILIYOR**
> (`lib/telemetry.ts:111`). Onunla süzen tek bir okuma yok — kodda geçen tüm
> `flespi_device_id` filtreleri **`vehicles` tablosunda** (`sync/route.ts:67`,
> `auto-shift.ts:476`, `telemetry.ts:1024`). RPC gövdelerinde de yok.
>
> Tahmini maliyeti: **53 MB disk + her insert'te bir indeks güncellemesi**
> (günde 34.147 kez). Düşürmeden önce § 9'daki 3. sorguyla `idx_scan=0`
> teyit edilmeli — el ile atılan bir SQL sorgusu onu kullanıyor olabilir.

İkinci aday `[VARSAYIM]`: `driver_locations` **81 satırda donmuş** ve 090 ona
bir BRIN indeksi kurdu. Zararsız (boyutu ~0), ama 81 satırlık bir tabloya
indeks kurulması, 090'ın iki tabloyu simetrik ele almasının yan etkisi.

### 3.2 Eksik indeks belirtisi var mı? — `[DOĞRULANDI]`, hayır

`seq_scan` sayacı okunamadı, ama **zamanlama farkıyla** ölçüldü. Bir sorgu
indeks kullanıyorsa süresi EŞLEŞEN SATIR sayısıyla, seq scan yapıyorsa TABLO
boyutuyla ölçeklenir:

| sonda | eşleşen | süre |
|---|---:|---:|
| `recorded_at < 14.07` | 203 | **126 ms** ← ağ gidiş-dönüşü kadar |
| `recorded_at < 20.07` | 172.131 | 213 ms |
| `recorded_at < 01.08` | 695.127 | 238 ms |
| `satellites = 12` (indekssiz — taban) | 132.367 | **330 ms** |
| `gsm_signal = 5` (indekssiz, 0 eşleşme) | 0 | **478 ms** |

203 satırlık eşleşme 126 ms, 0 satırlık indekssiz eşleşme 478 ms.
→ **`recorded_at` üzerindeki indeks (090'ın BRIN'i) KURULU ve KULLANILIYOR.**

Aynı yöntemle: `vehicle_id + recorded_at` (26.537 satır, 150 ms) ve
`flespi_device_id + recorded_at` (26.537 satır, 141 ms) de indeksten gidiyor.

**Eksik indeks belirtisi bulunmadı.** Bu tablonun sorunu indeks eksikliği
değil, **indeks fazlalığı** (§ 1.2).

### 3.3 Dün eklenen BRIN indeksleri kullanılıyor mu?

**`idx_device_telemetry_recorded_brin` — EVET** `[DOĞRULANDI]`, § 3.2'deki
zamanlama farkı. `idx_driver_locations_recorded_brin` — tablo 81 satır,
ölçüm anlamsız `[BİLMİYORUM]`.

> ⚠️ `db/install/hak61-full.sql` bu iki indeksi **İÇERMİYOR** (0 eşleşme) —
> kurulum SQL'i 078 hizasında üretildi, 090 ondan sonra geldi. Yeni bir kiracı
> bugün kurulursa BRIN indeksleri **oluşmaz**. `lint:install-sql` muhafızının
> bakması gereken bir boşluk.

---

## 4 · ŞİŞKİNLİK (bloat) ve AUTOVACUUM

`n_dead_tup` / `n_live_tup` / `last_autovacuum` **ÖLÇÜLEMEDİ** `[BİLMİYORUM]`.

Ama bir dolaylı sinyal **ölçüldü** ve iyi haber veriyor `[DOĞRULANDI]`:

```
device_telemetry  planlayıcı tahmini (pg_class.reltuples) : 1.704.789
device_telemetry  kesin sayım        (count=exact)        : 1.704.974
fark                                                      :       185  (%0,011)
```

`reltuples` ancak `ANALYZE` (ya da autovacuum'un analyze yarısı) çalıştığında
tazelenir. 1,7 milyon satırda **%0,011 sapma**, autoanalyze'ın bu tabloda
düzenli koştuğunu söyler. Tamamen durmuş bir autovacuum bu sayıyı saatler
içinde on binlerce satır geride bırakırdı.

> ⚠️ Şişkinlik için **açık bir şüphe var ama ÖLÇÜLEMEDİ** `[VARSAYIM]`:
> flespi sync `on conflict do nothing` ile yazıyor (`014` yorumu: "re-polling
> an overlapping window is idempotent"). PostgreSQL'de `ON CONFLICT DO NOTHING`
> spekülatif insert yapar — çakışan satır için **ölü tuple bırakır**. Sync
> 30 saniyede bir örtüşen pencereyi yeniden çekiyorsa, günde yazılan
> 34.147 satırın yanında görünmeyen bir ölü satır akışı olabilir.
> § 9'daki 2. sorgu bunu tek bakışta cevaplar.

---

## 5 · BAĞLANTI DURUMU

`pg_stat_activity` **ÖLÇÜLEMEDİ** `[BİLMİYORUM]` — açık bağlantı sayısı, idle,
idle in transaction, uzun koşan sorgu: hiçbiri okunamadı.

Ama mimari kesin `[DOĞRULANDI]`:

- Uygulama **hiç postgres bağlantısı açmıyor.** `package.json`'da `pg`,
  `postgres`, `pg-promise` yok; tek istemci `@supabase/supabase-js@2.106.1`.
- Her sorgu **PostgREST'e HTTPS isteği** olarak gidiyor
  (`lib/supabase.ts` → `createClient`), postgres bağlantı havuzunu **PostgREST
  ile Supavisor yönetiyor**, uygulama değil.
- Yani "bağlantı havuzu mu doğrudan bağlantı mı" sorusunun cevabı: **ikisi de
  değil** — uygulama katmanında bağlantı diye bir kavram yok. Havuz tükenmesi
  Vercel lambda sayısıyla değil, PostgREST'in kendi `db-pool` ayarıyla
  sınırlıdır ve o Supabase tarafında.

Bunun pratik sonucu: **kesintinin sebebi "çok fazla bağlantı" OLAMAZ**,
uygulama tarafında böyle bir kaldıraç yok.

---

## 6 · CRON YÜKÜ — hangisi ağır?

### 6.1 flespi senkronu gerçekte kaç saniyede bir koşuyor? — `[DOĞRULANDI]`

Belgede "30–60 sn" yazıyor. **Ölçüldü: 30 saniye.**

Yöntem: 27.08 08:00–08:12 UTC penceresindeki `ingested_at` damgaları çekilip
kümelendi (10 sn'den yakın yazmalar aynı tur sayıldı).

```
12 dakikada 25 ayrı tur · turlar arası: min 29 sn · p50 30 sn · max 31 sn
```

→ **günde 2.880 tur.**

### 6.2 Bir sync turunun okuma tabanı — `[DOĞRULANDI]`

Yazma hariç, her turda koşulan sabit sorgular tek tek zamanlandı:

| adım | süre |
|---|---:|
| `vehicles` select | 87 ms |
| `last_recorded_at_batch` RPC | 93 ms |
| `idle_episode_cursors_batch` RPC | 90 ms |
| `geofences` (müşteri bölgeleri) | 86 ms |
| `zone_visits` (açık ziyaret) | 91 ms |
| `vehicle_dtc` (aktif DTC) | 119 ms |
| `autoshift_telemetry_batch` RPC | 156 ms |
| `first_ignition_batch` RPC | 91 ms |
| `time_entries` (açık vardiya) | 89 ms |
| **9 gidiş-dönüş** | **902 ms** |

⚠️ Bu sürelerin **~85 ms'i ağ gidiş-dönüşüdür** (ölçüm Windows'tan yapıldı;
gözlenen en ucuz çağrı 86 ms). Gerçek veritabanı zamanı **~137 ms/tur**.
Vercel'den koşarken ağ payı çok daha küçüktür.

### 6.3 Yük dağılımı — `[DOĞRULANDI]` + `[VARSAYIM]`

| # | İş | Sıklık | Tur/gün | Tur başına DB gidiş-dönüşü | Gün/gidiş-dönüş |
|---|---|---|---:|---:|---:|
| 1 | **flespi sync** | **30 sn** | **2.880** | ≥9 (okuma tabanı) + yazmalar | **≥25.920** |
| 7 | Mevzuat tarama | 15 dk | 96 | ~10 `[VARSAYIM]` | ~960 |
| 2 | Yakıt fiyatı | 06:00 | 1 | birkaç | ~5 |
| 3 | Belge uyarısı | 06:00 | 1 | ~10 | ~10 |
| 5 | Bakım uyarısı | 06:15 | 1 | ~10 | ~10 |
| 6 | Haftalık aksiyon | Pzt 06:30 | 0,14 | ~30 | ~4 |
| 8 | Dönem skoru | haftada 1 | 0,14 | ~50 | ~7 |
| 9 | **Saklama** | 03:00 | 1 | 5 + 1 tam tablo taraması | ~6 |

> 🔑 **Zamanlanmış DB trafiğinin ~%96'sı flespi sync'ten geliyor**
> `[VARSAYIM]` (payda kısmen tahminî, pay `[DOĞRULANDI]`). Mevzuat taraması
> 15 dakikada bir koşmasına rağmen sync'in **1/30'u kadar** — "15 dakikada bir
> ağır olmasın" endişesi ölçümle **çürüdü**.

**Ama dikkat:** sync'in okuma tabanı ucuz (137 ms gerçek DB zamanı). Asıl
maliyet **yazma tarafında**: günde 34.147 satır insert ediliyor ve her satır
**9 indeksi birden** güncelliyor (§ 1.2). Yazma maliyeti bu turda
**ÖLÇÜLEMEDİ** `[BİLMİYORUM]` — ölçmek yazmak demekti.

### 6.4 🔴 Sync sıklığını düşürmek satır sayısını AZALTMAZ

Kritik ayrım, öneri yazmadan önce test edildi `[DOĞRULANDI]`:

```
34.147 satır/gün ÷ 29 araç = 1.178 satır/araç/gün
aktif ~10 saat üzerinden      ≈ 2 satır/dakika/araç
30 sn'lik turda               ≈ 1 satır/tur/araç
```

Satırları **cihaz üretiyor**, sync yalnız birikeni çekiyor. 60 saniyede bir
koşulsaydı **aynı satırlar**, iki katı büyüklükte partiler hâlinde gelirdi.
Yani sıklığı yarıya indirmek **veri hacmini değil, sabit gidiş-dönüş
maliyetini** yarıya indirir. Bu, önerinin riskini de düşürüyor (§ 8.1).

---

## 7 · 🔴 DÜN GECE NE OLDU — KESİNTİNİN ZAMAN ÇİZELGESİ

### 7.1 Kesinti penceresi — `[DOĞRULANDI]`

Kesintiyi **`ingested_at`** (satırın yazıldığı an) ortaya çıkardı.
`recorded_at` (cihazın damgası) **hiç boşluk göstermiyor** — çünkü flespi
veriyi tamponladı ve sonra geri yazdı.

`ingested_at` histogramı, 15 dakikalık adım (UTC · Viyana = UTC+2):

```
03:00Z   217  ██
03:30Z   496  ████
04:00Z    38                ← ÇÖKÜŞ BAŞLIYOR (06:00 Viyana)
04:30Z   515  ████          ← kesintili nefes alma
05:00Z    12
05:30Z   256  ██
06:00Z    66  █
06:45Z     1                ← TAM DURUŞ (08:45 Viyana)
07:00Z     2
07:15Z     0
07:30Z     1
07:45Z     1
08:00Z     0
08:15Z 13.888  ██████████████████████████████████████████████████  ← DÖNÜŞ (10:15 Viyana)
08:30Z  1.546
08:45Z  1.215
09:00Z    535
```

Saatlik karşılaştırma, iki kontrol günüyle:

| | 04Z | 05Z | 06Z | 07Z | 08Z |
|---|---:|---:|---:|---:|---:|
| 26.08 (kontrol) | 879 | 1.977 | 2.623 | 5.158 | 4.860 |
| 27.08 (kontrol) | 1.080 | 2.399 | 3.333 | 4.960 | 5.859 |
| **28.08 (kesinti)** | **791** | **425** | **243** | **4** | **16.649** |

**Kesinti: 04:00Z – 08:15Z (06:00 – 10:15 Viyana), tam duruş 06:45Z – 08:15Z.**

### 7.2 Veri kaybı oldu mu? — `[DOĞRULANDI]` HAYIR

08:00–09:00Z'de yazılan satırların `recorded_at` yaşına göre dağılımı:

| verinin gerçek yaşı | satır |
|---|---:|
| 04:00Z öncesi (4+ saat eski) | 219 |
| 04:00–05:00Z | 405 |
| 05:00–06:00Z | 1.919 |
| 06:00–07:00Z | 3.273 |
| 07:00–08:00Z | 5.639 |
| 08:00–09:00Z (taze) | 5.194 |
| **telafi edilen birikmiş** | **11.455** |

flespi tamponu tuttu, sync döndüğünde hepsini yazdı. **Telemetri kaybı yok.**

İş etkisi de sınırlı görünüyor `[DOĞRULANDI]`: bugün 12 vardiya başladı,
dün de 12. Kesinti penceresinde bugün 3, dün 3.

### 7.3 Saklama cron'u (gece 03:00) buna sebep oldu mu? — `[DOĞRULANDI]` HAYIR

**Koştuğu KANITLANDI.** `vehicle_telemetry_lifetime` tablosundaki 29 satırın
tamamında `guncellendi_at = 2026-08-28T01:01:04.065043Z` = **03:01:04 Viyana**.
En eski `guncellendi_at` de aynı damga → bu **ilk koşumdu** ve tamamlandı.

Zaman çizelgesi:

```
01:01:04Z  saklama cron KOŞTU ve BİTTİ (29 satır yazıldı)
01:00-02:00Z    23 yazma  ← gece seviyesi, NORMAL
02:00-03:00Z   398 yazma  ← dün 586. NORMAL
03:00-04:00Z 1.247 yazma  ← dün 1.140. NORMAL
04:00Z       ÇÖKÜŞ BAŞLIYOR ← cron bittikten 3 SAAT SONRA
```

**Cron bittikten sonraki üç saat kontrol gününden farksız geçti.** Bir sorgu
bir sistemi öldürecekse bunu üç saat sonra yapmaz.

Ek olarak, cron'un **sayma yarısı bugün ucuz** `[DOĞRULANDI]`:

```
saklama_eski_satirlar(kesim = 90 gün önce)  →  140 ms / 164 ms
```

Sebep: `tenant_saklama.uyari_gun = 90`, en eski veri **46 günlük**. Yani
`recorded_at < (şimdi − 90 gün)` **hiçbir device_telemetry satırıyla
eşleşmiyor** ve BRIN indeksi tüm blokları anında atlıyor.

> ⚠️ **Cron tamamen aklanmadı.** İkinci yarısı olan
> `refresh_telemetry_lifetime()` **`volatile`dir, yani YAZAR** — salt okuma
> kuralı gereği çağrılmadı, **maliyeti ÖLÇÜLEMEDİ** `[BİLMİYORUM]`.
> Şekli belli: `device_telemetry`'nin **tamamı üzerinde WHERE'siz
> `group by vehicle_id`** (090:600). Yani gecede bir kez 1,7 milyon satırın
> hepsi okunuyor. Ölçülen komşu değerler: tam `count(*)` 428–914 ms,
> soğuk önbellekte kısmi tarama 5.545 ms.

### 7.4 Peki sebep neydi?

`[DOĞRULANDI]` olan: Volkan spend cap'i kapatınca site açıldı; infrastructure
sayfası CPU %89 · Bellek %89 · Disk IO %76 gösteriyordu; sunucu Micro'ydu
(1 GB bellek).

`[VARSAYIM]` — ölçüm kanalım bunu doğrulayamaz, ama çöküş EĞRİSİ buna uyuyor:
791 → 425 → 243 → 4 şeklinde **dört saate yayılan kademeli boğulma**, tek bir
ağır sorgunun ürettiği ani duvara değil, **tükenmiş bir kotaya/kredi
havuzuna** benzer. Micro sınıfı burst-CPU kredisiyle çalışır; kredi bitince
makine taban hıza iner ve tam olarak böyle bir rampa görünür.

Asıl yapısal sebep ölçülebiliyor: **1 GB bellekli bir makinede 1,36 GB'lık bir
veritabanı vardı.** Çalışma kümesi RAM'e sığmıyordu, o yüzden her sorgu diske
gidiyordu (Disk IO %76) ve CPU I/O beklemesinde yanıyordu.

Bunun kanıtı bu turda **doğrudan ölçüldü** `[DOĞRULANDI]` — soğuk/sıcak farkı:

```
recorded_at < 20.07  (172.131 satır)   1. çağrı 5.545 ms → 2. çağrı 213 ms   = 26×
odometer_km not null (1.439.678 satır) 1. çağrı 2.954 ms → 2. çağrı 309 ms   = 9,6×
```

Ve **yükseltmeden sonra o fark kayboldu**: aynı turun ilerleyen dakikalarında,
temmuz–ağustos arasındaki altı ayrı günlük pencereye ilk kez dokunulduğunda
oran **1,0–1,3×** çıktı. Yani **Small'un 2 GB'ı ile device_telemetry artık
önbelleğe sığıyor.** Yükseltme semptomu gerçekten çözdü.

---

## 8 · ŞİMDİ NE YAPILABİLİR

Hiçbiri uygulanmadı. Etki tahminleri `[VARSAYIM]`, dayandıkları ölçümler
`[DOĞRULANDI]`.

### 8.1 flespi sync: 30 sn → 60 sn · etki ORTA · risk **DÜŞÜK**

Zamanlanmış DB trafiğinin ~%96'sı buradan geliyor (§ 6.3) ve **satır sayısını
etkilemiyor** (§ 6.4 — bu ölçüldü). Günlük gidiş-dönüş ≥25.920 → ≥12.960.

Bedeli: canlı haritanın tazeliği 30 sn → 60 sn. Yakıt de-glitch penceresi
SATIR temellidir (30 satır), tur sıklığına bağlı değil — dokunulmaz.
Vardiya otomatik başlatma zaten telemetri boşluğuna dayanıklı.
**Tek satır Vercel/cron-job.org ayarı, kod değişmez, geri alınması anında.**

### 8.2 🔴 `report_fuel_volume_stats`'ı araç eksenine çevir · etki YÜKSEK · risk ORTA

Bu turun en sert bulgusu. `[DOĞRULANDI]`:

```
report_fuel_volume_stats(28 gün)  →  5.086 ms / 4.582 ms      ← HER RAPOR AÇILIŞINDA
report_fuel_stats(7 gün)          →  1.518 ms
report_fuel_stats(14 gün)         →  2.891 ms
report_fuel_stats(28 gün)         →  6.940 ms   (8 sn tavanın %87'si)
report_fuel_stats(46 gün)         →  🔴 57014 STATEMENT TIMEOUT
```

Yüzde hattı 052'de araç eksenine çevrilmişti ve **düzgün çalışıyor**:
30× `report_fuel_stats_vehicle` + `mapBounded(6)` → duvar saati 4.525 ms, en
kötü ifade **2.182 ms** (tavana **3,7× pay**), 0 hata.

**Litre hattı o dönüşümü almadı.** `lib/reports.ts:1086` onu **kapsamsız tek
gövde** olarak, **her yakıt raporu render'ında koşulsuz** çağırıyor. Ne
araç yalıtımı var, ne zaman aşımı tekrarı. Yüzde ikizinin (`report_fuel_stats`)
46 günde çoktan timeout aldığı ölçüldüğüne göre, litre hattı da aynı yolda.

Yapılacak: 052'nin yaptığının aynısı — `report_fuel_volume_stats_vehicle`
RPC'si + `mapBounded(6)`. Risk ORTA çünkü migration gerektiriyor; ama desen
kanıtlanmış ve ikizi zaten canlıda çalışıyor.

### 8.3 Yakıt raporunu önbelleğe al · etki YÜKSEK · risk DÜŞÜK–ORTA

UI-yol kanıtı `[DOĞRULANDI]` (`scripts/measure-hak61-saglik.mjs`):

| sayfa | süre |
|---|---:|
| `/admin/raporlar/yakit` · **hafta** (varsayılan) | **4,03 sn** |
| `/admin/raporlar/yakit` · **ay** | **11,54 sn** |
| `/admin/raporlar/yakit` · **tüm zaman** (89 gün) | **14,60 sn** |
| `/admin` · `getDashboardData` | 1,37–1,67 sn |
| `/admin` · saklama şeridi `uyarilar()` | 726–732 ms |

Kullanıcının tetikleyebildiği en ağır iş **açık ara yakıt raporu**.
(Repo'nun kendi notu `ConsumptionRow.tsx:13`: "canlıda 40-60 saniye" —
yükseltme + sıcak önbellek bunu 11,5 sn'ye indirdi, ama hâlâ ağır.)

**Malzeme zaten hazır:** migration 090 `vehicle_month_metrics` tablosunu ve
`build_daily_vehicle_metrics` RPC'sini kurmuş — ikisi de canlıda **0 satır**,
kimse yazmıyor. Aylık özeti gecede bir yazıp raporu oradan okumak sayfayı
milisaniyelere indirir. Bedeli tazelik (gün içi rakam bir gün eski olur).

### 8.4 `idx_device_telemetry_device_recorded`'i düşür · etki DÜŞÜK–ORTA · risk DÜŞÜK

§ 3.1. Kodda tüketicisi yok. ~53 MB disk + günde 34.147 indeks güncellemesi.
**Önce § 9'un 3. sorgusuyla `idx_scan=0` teyit et.** Geri alınabilir.

### 8.5 Arşivleme — bugün kaldıraç DEĞİL

`tenant_saklama.uyari_gun = 90`, veri **46 günlük**. Yani bugün 90 günü aşan
tek bir `device_telemetry` satırı yok; silinecek bir şey yok.
İlk gerçek karar anı **11.10.2026** (13.07 tarihli en eski kaydın 90 günü
dolduğunda). Ham konum saklama süresi ayrıca hukuki bir konu (§ 132 BAO) ve
`saklama_esikleri` tablosu **bilerek boş** — sayı uydurulmayacak.

### 8.6 ⚠️ 11.10.2026 için kayıtlı bir mayın

`uyarilar()` **`/admin` panosunun her açılışında** koşuyor
(`components/admin/SaklamaUyariSeridi.tsx:27`), yalnız gece cron'unda değil
`[DOĞRULANDI]`. Bugün ucuz (726 ms), çünkü device_telemetry tarafı 0 satır
eşleştiriyor.

11.10.2026'dan itibaren eşleşmeye başlayacak. Sıcak önbellekte maliyeti
küçük kalıyor (172 bin satır → 213 ms, 695 bin satır → 238 ms `[DOĞRULANDI]`),
**ama soğukta 5.545 ms.** Yani bu mayın ancak RAM yetmediğinde patlar — ki bu
da her şeyi tek bir soruya bağlıyor: bellek.

---

## 9 · 🔴 VOLKAN'IN ÇALIŞTIRMASI GEREKEN 5 SORGU

Bu turda ölçülemeyen her şeyi kapatırlar. **Hepsi salt okumadır.**
Supabase → SQL Editor → yapıştır → çalıştır.

```sql
-- 1 · GERÇEK BOYUTLAR (§ 1.2'deki tahminin yerine geçer)
select
  relname                                             as tablo,
  pg_size_pretty(pg_total_relation_size(c.oid))       as toplam,
  pg_size_pretty(pg_table_size(c.oid))                as veri,
  pg_size_pretty(pg_indexes_size(c.oid))              as indeks,
  n_live_tup                                          as canli_satir
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 15;

-- 2 · ŞİŞKİNLİK + AUTOVACUUM (§ 4'ün ON CONFLICT şüphesini kapatır)
select
  relname                                             as tablo,
  n_live_tup, n_dead_tup,
  round(100.0 * n_dead_tup / nullif(n_live_tup, 0), 2) as olu_yuzde,
  last_autovacuum, last_autoanalyze, autovacuum_count
from pg_stat_user_tables
order by n_dead_tup desc
limit 15;

-- 3 · KULLANILMAYAN İNDEKSLER (§ 3.1 / § 8.4'ün kapısı)
select
  relname                                             as tablo,
  indexrelname                                        as indeks,
  idx_scan                                            as tarama_sayisi,
  pg_size_pretty(pg_relation_size(indexrelid))        as boyut
from pg_stat_user_indexes
where schemaname = 'public'
order by idx_scan asc, pg_relation_size(indexrelid) desc
limit 30;

-- 4 · EN PAHALI SORGULAR — önce eklentinin açık olup olmadığına bakar
--     (kapalıysa 0 satır döner; AÇMAK İÇİN: Dashboard → Database →
--      Extensions → pg_stat_statements → Enable. Sunucu yeniden başlamaz,
--      ama sayaç sıfırdan birikmeye başlar, yani 1-2 gün beklemek gerekir.)
select
  round(total_exec_time)::bigint                      as toplam_ms,
  calls                                               as cagri,
  round(mean_exec_time)::bigint                       as ortalama_ms,
  shared_blks_read                                    as diskten_blok,
  shared_blks_hit                                     as onbellekten_blok,
  left(query, 140)                                    as sorgu
from pg_stat_statements
order by total_exec_time desc
limit 20;

-- 5 · BAĞLANTILAR + UZUN KOŞAN SORGU (§ 5)
select state, count(*) from pg_stat_activity group by state;
select pid, now() - query_start as sure, state, left(query, 120)
from pg_stat_activity
where state <> 'idle' and query_start < now() - interval '5 seconds'
order by query_start;
```

> 4 numaralı sorgu 0 satır dönerse `pg_stat_statements` **kapalıdır**.
> Açma yolu yorumda yazılı. **Ben açmadım ve açmayacağım** — eklenti açmak
> bu turun salt-okuma sınırının dışında.

---

## 10 · NE KADAR DAYANIR

### Disk `[VARSAYIM]` — hesap § 1.2 + § 2'ye dayanıyor

```
Volkan'ın okuduğu:  1,36 GB / 2,00 GB   (%70 dolu)
boş:                  640 MB
büyüme:              16,1 MB/gün
                    ──────────────
                    ≈ 40 GÜN  →  ~7 EKİM 2026'da disk dolar
```

053 canlıda uygulanmamışsa büyüme 13,5 MB/gün ve süre ~47 gün.

⚠️ Bu, Volkan'ın ekrandan okuduğu 2 GB rakamını doğru kabul eder. Supabase
paketlerde diski genelde otomatik büyütür (%90'ı geçince), yani muhtemelen
"disk dolar" yerine "disk büyür ve fatura artar" olur. **Kesin cevap
§ 9'un 1. sorgusundadır.**

### Bellek `[VARSAYIM]` — asıl sınırlayıcı bu

Small = 2 GB RAM. Postgres'in `shared_buffers`'ı ~512 MB, geri kalanı işletim
sistemi sayfa önbelleği; pratikte kullanılabilir önbellek **~1,2–1,5 GB**.
Veritabanı bugün 1,36 GB. **Şu an sığıyor** ve bu ölçüldü: soğuk/sıcak farkı
26×'ten 1,0–1,3×'e düştü (§ 7.4).

490 MB/ay büyümeyle bu pencere **1–1,5 ay** sürer. Yani **ekim ortası
civarında aynı semptom geri gelir**, çünkü aynı fizik geri gelir: çalışma
kümesi RAM'i aşar, her sorgu diske gider, Disk IO tavana vurur.

**Kısa cevap: Small ~40 gün alır, ~1 ay sonra rahat değil, ~1,5 ay sonra
tekrar sıkışır.**

---

## 11 · KALICI ÇÖZÜM — hangisi?

Dört seçenek var ve **üçü tek başına yeterli değil.**

| Seçenek | Kazanç | Neden tek başına yetmez |
|---|---|---|
| **Daha büyük makine** | Anında, risksiz | 490 MB/ay = 5,9 GB/yıl. Her büyütme aynı süreyi tekrar satın alır; koşu bandı |
| **İndeks temizliği** | 53 MB + yazma maliyeti (§ 8.4) | Bir kerelik; büyüme hızına dokunmaz |
| **Sorgu düzeltmesi** (§ 8.2, § 8.3) | Kullanıcı tarafındaki en ağır yükü kaldırır, timeout riskini kapatır | CPU'yu rahatlatır, DİSKİ rahatlatmaz |
| **Arşivleme** | Tek gerçek yapısal kaldıraç | Bugün silinecek veri yok (§ 8.5); ayrıca hukuki karar |

**Önerim, sırayla:**

1. **Şimdi (bu hafta, düşük risk):** § 8.1 sync 60 sn'ye + § 8.4 ölü indeks
   (önce § 9'un 3. sorgusu). Sabit yükü ~yarıya indirir, disk kazandırır.
2. **Şimdi (bir sprint):** § 8.2 litre hattını araç eksenine çevir. Bu bir
   **performans işi değil, arıza önleme işidir**: ikizi 46 günlük pencerede
   çoktan `57014` alıyor ve litre hattının aynı duvara koşacağı ölçüldü.
3. **Sonra:** § 8.3 yakıt raporunu `vehicle_month_metrics`'ten oku. Altyapısı
   090'da zaten kurulu ve boş duruyor. Kullanıcının tetikleyebildiği en ağır
   iş ortadan kalkar.
4. **11.10.2026'dan önce karar:** ham konum saklama süresi. Bu bir mühendislik
   kararı değil, **veri sorumlusunun (müşterinin) kararı** ve § 132 BAO'ya
   bakıyor. 90 günlük bir politika bugünkü hızda tabloyu ~3,1 milyon satır /
   ~1,5 GB'de sabitler — yani büyüme durur. Politika olmadan sabitlenmez.
5. **Makine:** 1–3 yapılırsa Small ekim sonuna kadar rahat gider. 4 kararı
   verilmezse, ocak civarında Medium kaçınılmaz olur.

> **Tek cümlelik özet:** HAK61'in sorunu yavaş bir sorgu değil, **sınırı
> olmayan bir tablo**. `device_telemetry` bütün satırların %99,4'ü, bütün
> büyümenin ~%100'ü ve indeksleri kendisinden büyük. Makineyi büyütmek zaman
> satın alır; süreyi ancak bir saklama politikası durdurur.

---

## 12 · Bu turda ÖLÇÜLEMEYENLERİN listesi

Tahmin edilmedi, uydurulmadı:

- `pg_stat_statements` — en pahalı 20 sorgu, çağrı sayısı, okunan blok `[BİLMİYORUM]`
- Tabloların bayt cinsinden gerçek boyutu `[BİLMİYORUM]` (§ 1.2 hesabı var)
- İndeks başına `idx_scan` — hangisi hiç kullanılmıyor `[BİLMİYORUM]`
- `seq_scan` / `seq_tup_read` sayaçları `[BİLMİYORUM]`
- `n_dead_tup` / `last_autovacuum` `[BİLMİYORUM]` (dolaylı sinyal § 4'te)
- Açık bağlantı sayısı, idle in transaction, uzun koşan sorgu `[BİLMİYORUM]`
- `refresh_telemetry_lifetime()` maliyeti `[BİLMİYORUM]` — `volatile`, yazar
- flespi sync'in YAZMA maliyeti `[BİLMİYORUM]` — ölçmek yazmak demekti
- Kesintinin Supabase tarafındaki kesin sebebi `[BİLMİYORUM]` — CPU kredisi
  hipotezi `[VARSAYIM]`, çöküş eğrisine dayanıyor
- Vercel logları `[BİLMİYORUM]` — Vercel CLI kurulu değil, MCP bu projeyi görmüyor

Hepsinin kapısı § 9'daki beş sorgu.
