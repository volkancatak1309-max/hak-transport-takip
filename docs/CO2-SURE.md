# CO₂ ekranı — süre ölçümü ve karar

> 31.08.2026 · 🔴 **SALT OKUMA ÖLÇÜM TURU.** HAK61 ve Sendigo canlı
> veritabanlarına tek satır yazılmadı: ölçüm scriptlerinde `globalThis.fetch`
> sarmalandı, `GET`/`HEAD` ve `POST /rest/v1/rpc/…` dışındaki her istek
> **hata fırlatarak** reddedildi (sayaç: 0 engellenen istek = hiç denenmedi).
> Kodda tek harf değişmedi, deploy yapılmadı.
> İlgili: [`AYLIK-METRIK.md`](AYLIK-METRIK.md) · [`VERCEL-BOLGE.md`](VERCEL-BOLGE.md)

---

## 0 · KISA CEVAP

| soru | cevap | nasıl |
|---|---|---|
| Demo neden HAK61'in 2 katı? | **"Demo'da veri az" varsayımı yanlış kurulmuş.** Süre araç/sorgu sayısıyla değil, pencereye düşen **telemetri satırıyla** ölçekleniyor. En güçlü aday: demo'nun son 6 ayında **dolu ay sayısı fazla**. Bölge farkı en fazla ~2,5 sn açıklar. | § 1 |
| Cron kurulunca kaç saniye? | **34,61 → 18,11 sn** (HAK61 yerel, ölçüldü). Vercel karşılığı ≈ **8 sn** `[oran varsayımı]` | § 2 |
| Açık ayın tek başına maliyeti? | **9,30 sn** (HAK61) · **7,62 sn** (Sendigo) — cron sonrası taban budur | § 3 |
| Cron sonrası hâlâ 8+ sn mi? | **Evet, ~18 sn yerel / ~8 sn Vercel.** Kalan süre **iki AYRI pencerenin iki AYRI raporu**; biri diğerinden türetilemez. | § 4 |

🔴 **31.08 akşamı DÜZELTME:** bu belgenin ilk sürümü "açık ay iki kez
hesaplanıyor, biri silinebilir" diyordu. **Yanlıştı** — ölçümü gerçek uç
penceresiyle değil, kendi seçtiğim takvim-ayı penceresiyle almıştım. Gerçek
uç `range=ay` için **kayan 30 gün** veriyor; iki pencere farklı ve
**108,20 litre** fark üretiyor. Ayrıntı ve yeni ölçüm: § 4.

---

## 1 · DEMO NEDEN YAVAŞ

### 1.1 Ölçülen: süre sorgu sayısına değil, SATIR sayısına bağlı

`buildFuelReport` tek pencerede, HAK61 canlı:

| pencere | süre | sorgu | ölçülen/araç | pencereye düşen `device_telemetry` satırı |
|---|---:|---:|---:|---:|
| son 24 saat | 2,85 sn | 191 | 17/29 | 32.845 |
| son 7 gün | 3,56 sn | 193 | 17/29 | 242.503 |
| UTC ay başı → şimdi | 9,04 sn | 199 | 22/29 | 1.104.213 |

**Sorgu sayısı neredeyse sabit (191 → 199), süre 3,2× artıyor.** Yani fan-out
tabanı değil, taranan veri belirliyor.

⚠️ Bu üç pencere **elle kuruldu**, `computeAnalyticsRange` ile değil (§ 4.1'in
konusu olan hata). Ucun gerçek pencereleriyle alınan ölçüm § 4.2'de: `gun`
2,90 sn · `hafta` 3,65 sn · `ay` 8,78 sn — **aynı mertebe**, yani buradaki
"süre satır sayısıyla ölçekleniyor" sonucu etkilenmiyor.

### 1.2 Karşı-ölçüm: az araç ≠ hızlı

Aynı kod, aynı istemci (bu makine), iki kiracı:

| kiracı | araç | `co2Panosu` sorgu | süre | **ms / sorgu** |
|---|---:|---:|---:|---:|
| HAK61 (Dublin) | 29 | 1.319 | 34,61 sn | **26,2** |
| Sendigo (Frankfurt) | 4 | 212 | 19,94 sn | **94,1** |

Sendigo **6,2× az sorguyla yalnız 1,7× hızlı**. Araç sayısı düştükçe fan-out
paralelliği kayboluyor ve RTT baskın hâle geliyor. "Demo'da araç/şoför az,
o hâlde hızlı olmalı" çıkarımı bu yüzden yürümüyor.

### 1.3 Üç hipotez, ölçüm ışığında

**a) Bölge farkı — açıklıyor ama küçük.** `VERCEL-BOLGE.md` § 3 modeli:
`t = 198 ms + derinlik × RTT`. HAK61 CO₂ ucu Vercel'de 15,30 sn →
derinlik ≈ (15.300 − 198) / 92 ≈ **164**. Fonksiyon iad1'de, HAK61 Supabase'i
Dublin'de, demo'nunki Frankfurt'ta. Frankfurt iad1'e ~15 ms daha uzaksa:
164 × 15 ms ≈ **2,5 sn**. Ölçülen fark ~16,6 sn. **Bölge tek başına yetmiyor.**
⚠️ `RTT(iad1→fra1)` **ÖLÇÜLMEDİ** — iad1'de kod koşturamıyorum.

Bu makineden ölçülen RTT'ler (12 örnek, `vehicles?select=id&limit=1`):

| hedef | min | medyan |
|---|---:|---:|
| HAK61 Supabase (eu-west-1, Dublin) | 86 ms | 95 ms |
| Sendigo Supabase (eu-central-1, Frankfurt) | 60 ms | 135 ms |

Bu sayılar **iad1'den değil Türkiye'den** ölçüldü; iki bölgenin iad1'e
uzaklığı hakkında hiçbir şey söylemez. Buraya yalnız "bölge farkı ölçülebilir
bir şey ama bu turda izole edilemedi" demek için kondu.

**b) Compute boyutu — kanıt yok.** Repoda `vercel.json` da `vercel.ts` de yok,
`preferredRegion` hiçbir yerde geçmiyor; üç kiracı da aynı framework
varsayılanlarıyla koşuyor. Fluid Compute'ta boyut farkı yaratacak bir ayar
repoda **YOK**. Vercel proje ayarlarından bakılabilir — ben ölçemedim.

**c) Dolu ay sayısı — EN GÜÇLÜ ADAY.** `aylikSeri` son 6 ayı sırayla tam
`buildFuelReport` ile hesaplıyor. HAK61'de ölçülen ay maliyetleri:

| ay | süre | sorgu | durum |
|---|---:|---:|---|
| 2026-03 | 2,21 sn | 178 | BOŞ |
| 2026-04 | 2,16 sn | 178 | BOŞ |
| 2026-05 | 2,09 sn | 178 | BOŞ |
| 2026-06 | 2,11 sn | 178 | BOŞ |
| 2026-07 | 5,43 sn | 201 | dolu (24/29) |
| 2026-08 | 8,84 sn | 199 | AÇIK AY (22/29) |
| **toplam** | **22,84 sn** | **1.112** | |

**Dolu ay boş ayın 2,6–4,2 katı.** HAK61 telemetrisi 13.07.2026'da başlıyor,
yani altı ayın **dördü tamamen boş** ve ucuz. galzura-demo daha uzun geçmişli
gerçek telemetri taşıyorsa o dört ay da dolu olur:

```
HAK61 bugün      : 4 boş (8,57) + 1 dolu (5,43) + açık (8,84) = 22,84 sn
6 ayın hepsi dolu: 5 × ~6,5                     + açık (8,84) ≈ 41 sn
```

Bu, demo'nun 31,9 sn'sini HAK61'in 15,3 sn'sinden ayıran mertebedir.

### 1.4 🔬 Bunu tek sorguyla doğrulamanın yolu (Volkan)

galzura-demo service key'im yok, bu yüzden **doğrudan ölçemedim.** Ayrımı
kesinleştiren tek sorgu — salt okuma, demo'nun SQL editöründe:

```sql
select date_trunc('month', recorded_at)::date as ay,
       count(*)                                as satir,
       count(distinct vehicle_id)              as arac
from public.device_telemetry
where recorded_at >= date_trunc('month', now()) - interval '5 months'
group by 1 order by 1;
```

- **6 satır dönerse** (her ay dolu) → sebep (c), cron kazancı **büyük** olacak
- **1–2 satır dönerse** (HAK61 gibi) → sebep (c) DEĞİL; o zaman (a)/(b)
  ölçülmeli: demo ucunun `x-vercel-id` başlığı ile bölgesi ve
  `/api/mobile/score-config` (1 sorgu) + `/api/mobile/fleets` (6 sorgu)
  eğiminden RTT'si — `VERCEL-BOLGE.md` § 3.1'deki yöntem.

---

## 2 · CRON KURULUNCA NE OLUR — ÖLÇÜLDÜ, TAHMİN DEĞİL

### 2.1 Yöntem

Tablo bugün boş, cron henüz koşmadı. Bu yüzden senaryo **tahmin edilmedi,
gerçekten koşturuldu**:

1. `ayOzetiYaz` beş kapanmış ay için **gerçekten** çalıştırıldı (canlı okuma);
   `upsert` isteği HTTP katmanında yakalandı, **gönderilmedi**, üretilen
   **145 satır** belleğe alındı.
2. Sonra `co2Panosu` koşturuldu; yalnız `vehicle_month_metrics` **SELECT**'i
   o 145 satırı döndüren bir şimle karşılandı. Diğer her sorgu canlı.

Yani ölçülen şey "cron koşmuş bir sistemin" gerçek kod yolu.

### 2.2 Sonuç

| | HAK61 | Sendigo |
|---|---:|---:|
| bugün (tablo boş) | **34,61 sn** · 1.319 sorgu | **19,94 sn** · 212 sorgu |
| cron sonrası (tablo dolu) | **18,11 sn** · 406 sorgu | **15,68 sn** · 72 sorgu |
| kazanç | **1,91×** (−16,5 sn) | **1,27×** (−4,3 sn) |
| `kaynak` dağılımı | tablo=5 · canlı=1 | tablo=5 · canlı=1 |

**Doğruluk kontrolü:** tablo yolundan okunan 2026-07 değeri **3.675,1 kg /
13.698 km** — aynı ayın canlı hesabıyla **birebir aynı**. Tablo yolu yanlış
sayı üretmiyor.

**Kazanç neden Sendigo'da küçük:** oradaki beş kapanmış ayın **hepsi boş**;
cron boş ayın 0,6 sn'sini 0,03 sn'ye indiriyor, dolu ayın 5,4 sn'sini değil.
**Cron kazancı dolu ay sayısıyla orantılıdır** — demo'da kazanç HAK61'den
büyük olmalı (§ 1.3c doğruysa).

### 2.3 Cron turunun kendi maliyeti

| kiracı | 5 kapanmış ay yazımı | satır |
|---|---:|---:|
| HAK61 | 18,63 sn | 145 |
| Sendigo | 3,86 sn | 20 |

Gece 03:30'da koşar, kullanıcı beklemez. `maxDuration = 300` ile rahat sığıyor.

### 2.4 Vercel karşılığı `[VARSAYIM]`

Bu ölçümler **bu makineden**; kullanıcı Vercel'den görüyor. HAK61 CO₂ ucu
Vercel'de 15,30 sn ölçülmüştü ([`YAKIT-ARAC-EKSENI.md`](YAKIT-ARAC-EKSENI.md)
§ 10.1), aynı kodun buradaki karşılığı 34,61 sn → **oran 0,442**.

| | yerel (ölçüldü) | Vercel `[oran varsayımı]` |
|---|---:|---:|
| bugün | 34,61 sn | 15,30 sn *(ölçüldü)* |
| cron sonrası | 18,11 sn | **≈ 8,0 sn** |

⚠️ İlk sürümde burada bir "+ çift hesap da kalkarsa 10,57 sn" satırı vardı;
**geri çekildi** (§ 4). Cron sonrası ölçüm gerçek uç penceresiyle
(`computeAnalyticsRange("ay")` = kayan 30 gün) tekrarlandı: **18,09 sn ·
406 sorgu** — takvim-ayı penceresiyle alınan 18,11 sn ile aynı, yani § 2'nin
sonucu bu hatadan etkilenmiyor.

⚠️ Oranın sabit olduğu **varsayım**: Vercel'in fan-out paralelliği bu
makineninkinden farklı olabilir. Gerçek sayı ancak deploy sonrası ölçülür.

---

## 3 · AÇIK AYIN MALİYETİ = CRON SONRASI TABAN

Açık ay **hiçbir zaman** tablodan okunmaz — her gün değişir, gece yazılan
satır sabaha bayat olur (`lib/co2-db.ts`, bilinçli karar). Tek başına:

| kiracı | açık ay (tam ay penceresi) | sorgu |
|---|---:|---:|
| HAK61 | **9,30 sn** | 199 |
| Sendigo | **7,62 sn** | 32 |

Bunu kanıtlayan ölçüm: `aylikSeri`'nin **altı ayı da** tablodan gelmiş gibi
şimlendi → süre **18,25 sn** çıktı, yani cron sonrası 18,11 sn'den
**düşmedi**. Çünkü kod açık ay için tablo satırını hiç okumuyor, doğrudan
`buildFuelReport`'a gidiyor. **Taban budur ve cron onu indirmez.**

---

## 4 · 🔴 Ö1 KAPANDI — "çift hesap" diye bir şey yok

### 4.1 İlk iddia ve nasıl çürüdü

Bu belgenin ilk sürümü şunu söylüyordu: `co2Panosu` açık ayı iki kez
hesaplıyor, litre farkı `0,0000`, biri silinebilir → 18,11 sn'den 10,57 sn'ye.

**Ölçüm hatalıydı.** `co2Panosu(ayBas, simdi)` diye çağırmıştım; `ayBas` benim
elle kurduğum **UTC takvim ayı başıydı**. Gerçek uç öyle çağırmıyor:

```
app/api/mobile/analytics/co2/route.ts:71
  co2Panosu(c.range.start, c.range.end)      ← aralikCoz → computeAnalyticsRange
```

`computeAnalyticsRange` (`lib/analytics.ts`) **hiçbir anahtarda takvim ayı
vermiyor** — 27.07.2026 Volkan kararıyla `hafta`/`ay` kayan pencereye çevrildi:

| anahtar | pencere |
|---|---|
| `gun` | bugün başı → bugün sonu (Viyana) |
| `hafta` | kayan **7** gün |
| `ay` | kayan **30** gün |
| `ozel` | `from`/`to` — Viyana gün sınırları |
| `tumzaman` | `FLEET_EPOCH` → bugün sonu |

`aylikSeri`'nin açık ayı ise **UTC takvim ayı**: `Date.UTC(y, m, 1)` →
`Date.UTC(y, m+1, 1)`. Bu ikisi yapısal olarak farklı.

**Ders:** UI-path proof, ucun çalıştırdığı yolu *birebir* tekrarlamak
demek — pencereyi kendim kurduğum an ölçtüğüm şey artık o uç değildi.

### 4.2 Ölçüm: pencereler örtüşmüyor, sonuçlar farklı

HAK61 canlı, 31.08.2026 11:52 UTC, salt okuma:

```
AÇIK AY (aylikSeri)   2026-08-01T00:00:00Z → 2026-09-01T00:00:00Z
range=gun             2026-08-30T22:00:00Z → 2026-08-31T21:59:59Z
range=hafta           2026-08-24T22:00:00Z → 2026-08-31T21:59:59Z
range=ay              2026-08-01T22:00:00Z → 2026-08-31T21:59:59Z   ← 22:00, 00:00 değil
range=tumzaman        2026-06-01T00:00:00Z → 2026-08-31T21:59:59Z
range=ozel(01→31)     2026-07-31T22:00:00Z → 2026-08-31T21:59:59Z
web (varsayılan)      2026-08-01T11:52:16Z → 2026-08-31T11:52:16Z
```

**Hiçbiri açık ayla aynı değil** — en yakını `range=ay`, o da Viyana saat
dilimi yüzünden 2 saat kaymış. Sonuçlar:

| pencere | süre | sorgu | litre | km | kapsama | açık ayla aynı mı |
|---|---:|---:|---:|---:|---:|---|
| **AÇIK AY** | 8,85 sn | 199 | **3.895,27** | 20.620 | 22/29 | — |
| `gun` | 2,90 sn | 191 | 1.010,32 | 779 | 17/29 | **HAYIR** (−2.884,95) |
| `hafta` | 3,65 sn | 193 | 1.991,98 | 4.442 | 16/29 | **HAYIR** (−1.903,29) |
| `ay` | 8,78 sn | 199 | 3.787,07 | 19.579 | 22/29 | **HAYIR** (−108,20) |
| `tumzaman` | 12,88 sn | 201 | 5.408,35 | 30.865 | 24/29 | **HAYIR** (+1.513,08) |
| `ozel(01→31)` | 8,98 sn | 199 | 3.895,27 | 20.620 | 22/29 | değer aynı — **ama pencere değil** |
| web varsayılan | 9,48 sn | 199 | 3.799,27 | 19.705 | 22/29 | **HAYIR** (−96,00) |

`ozel(01→31)` satırı tuzak: litre tesadüfen tutuyor (kayan 2 saatte veri
yok), **pencere sınırları eşit değil**. Sonuç eşitliğini önceden bilmek
mümkün olmadığı için bunu koşul yapmak, sessiz yanlış sayı üretmenin yolu
olurdu.

### 4.3 Neden türetme de mümkün değil

"Seçilen pencere açık ayı kapsıyorsa açık ayı ondan çıkar" da yürümez:
`buildFuelReport`'un `consumedLiters` değeri **pencere-bağımlı** —
`Math.max(0, refillL + (first − last))`, yani pencerenin İLK ve SON yakıt
okumasına dayanıyor (`lib/reports.ts`). Alt pencerenin toplamı üst
pencereninkinden aritmetikle çıkarılamaz; `tumzaman` satırı bunu gösteriyor
(5.408 ≠ 3.895 + kalan).

**Sonuç: Ö1 uygulanamaz.** Kod yazılmadı — koşul hiçbir çağırıcıda
sağlanmadığı için yazılacak şey ölü kod olurdu.

### 4.4 Denenen alternatif: iki raporu paralelleştirmek — 1,10×, yetersiz

İki rapor farklı ama **sıralı** koşuyor. `Promise.all` ile ölçüldü (HAK61,
ısınma turundan sonra):

```
SIRALI   17,05 sn
PARALEL  15,48 sn      → 1,10×
  seçilen pencere  sıralı 3787,07 22/29 | paralel 3787,07 22/29  → AYNI
  açık ay          sıralı 3895,27 22/29 | paralel 3895,27 22/29  → AYNI
```

Sonuç ve kapsama korunuyor ama kazanç **%10**. Sebebi ölçülmüş bir olgu: her
rapor zaten 29 araçlık fan-out yapıyor, PostgREST doygun — eşzamanlılığı
artırmak pay getirmiyor (aynı tavan `mapBounded` ölçümünde de görülmüştü).
**Uygulanmadı**; 1,10× için müşteriye giden bir hesabı yeniden dizmeye değmez.

### 4.5 Geriye kalan tek kaldıraç: Ö2

Cron sonrası 18,1 sn'nin dağılımı (gerçek uç penceresiyle, 406 sorgu):

```
(3) seçilen pencere — range=ay    8,78 sn   199 sorgu   ← ekranın istediği sayı
(6) aylikSeri açık ayı            8,85 sn   199 sorgu   ← trend grafiğinin son noktası
şoför/müşteri/ayar/tablo          ~1,6 sn     8 sorgu
```

İkisi de gerekli, ikisi de pahalı, biri diğerini kapsamıyor. Ama **ekranın
ilk göstereceği sayı yalnız (3)'e bağlı.** Yani süreyi kısaltmak yerine
**bekleyişi bölmek** kalıyor — Ö2. Ö1 ve paralelleştirme kapandığı için
Ö2 artık *ilk* seçenek, alternatif değil.

---

## 6 · Ö2 UYGULANDI — `?bolum=` ile kısmi sonuç (31.08.2026)

> Dal `perf/co2-kismi-sonuc`. **Push/deploy YOK.** HAK61 salt okuma.

### 6.1 Karar: `?bolum=` parametresi — neden diğer ikisi değil

| seçenek | neden seçilmedi / seçildi |
|---|---|
| İki ayrı uç | Yetki (`requireMobileAdmin`) ve aralık dili (`aralikCoz`) **ikinci kez** kurulurdu. `_rapor/aralik.ts` başlığındaki gerekçe aynen geçerli: "son 30 gün" iki yüzeyde iki pencereye ayrılırsa yönetici Analiz'deki sayıyı raporda bulamaz. |
| Akış (streaming) | RN istemcisinde kısmi JSON ayrıştırma + ayrı hata yolu gerekir; yarıda kesilen bir gövdenin hangi parçasının geçerli olduğu istemcinin sorumluluğuna geçer. Kazanç aynı, kırılma yüzeyi büyük. |
| **`?bolum=`** ✅ | Tek uç, tek yetki, tek aralık dili. **Parametre yoksa bugünkü tam gövde döner** → eski istemci hiç değişmeden çalışır. İki çağrı istemci tarafında paralel atılabilir. |

### 6.2 Sözleşme — eski istemci kırılmıyor

```
(parametre yok)  → { ok, bolum:"tam",   donem, ozet, pano{…, aylik} }   ← BUGÜNKÜ GÖVDE
?bolum=ozet      → { ok, bolum:"ozet",  donem, ozet, pano{…} }          ← aylik alanı YOK
?bolum=aylik     → { ok, bolum:"aylik", donem, aylik, katsayiSurum, tabloYok }
?bolum=<başka>   → 400 invalid_bolum { alan:"bolum", gecerli:["ozet","aylik"] }
```

🔴 `bolum=ozet` yanıtında `pano.aylik` alanı **hiç yoktur** — boş dizi
gönderilseydi istemci onu "trend boş" diye çizebilirdi. Aynı sebeple
`bolum=aylik` yanıtında `ozet` yoktur: boş bir özet "0 kg" olarak
çizilebilirdi. Ne döndüğü gövdedeki `bolum` alanında yazar.

Kod tarafında `lib/co2-db.ts` üç giriş noktası veriyor: `co2Panosu` (bugünkü,
değişmedi), `co2PanosuOzet`, `co2PanosuAylik` — üçü de tek `panoHesapla`ya
düşüyor. Web ekranının server action'ı (`app/actions/co2.ts`) `co2Panosu`
çağırmayı sürdürüyor, **dokunulmadı**.

### 6.3 Ölçüm — HAK61 canlı, her range

| range | TAM | **`bolum=ozet`** | `bolum=aylik` | ikisi paralel |
|---|---:|---:|---:|---:|
| `gun` | 27,18 sn · 1311q | **3,37 sn · 198q** | 23,79 sn · 1115q | 24,31 sn |
| `hafta` | 27,91 sn · 1313q | **4,47 sn · 200q** | 23,54 sn · 1115q | 24,36 sn |
| `ay` | 32,67 sn · 1319q | **9,37 sn · 206q** | 23,57 sn · 1115q | 24,40 sn |
| `tumzaman` | 35,63 sn · 1321q | **13,60 sn · 208q** | 22,75 sn · 1115q | 26,11 sn |
| `ozel(01→31)` | 32,08 sn · 1319q | **9,73 sn · 206q** | 23,21 sn · 1115q | 23,65 sn |

**Ekrandaki ilk sayı 27–36 sn yerine 3,4–13,6 sn'de hazır.**

⚠️ `bolum=aylik` bugün ~23 sn çünkü **cron henüz kurulmadı** — altı ay canlı
hesaplanıyor. Cron kurulunca bu ayak ~9 sn'ye iner (§ 2), yani trend grafiği
de ~9 sn'de dolar. İki iyileştirme birbirini besliyor.

### 6.4 Sonuç eşitliği — kanıt

**Kapanmış pencerede (30.08 00:00–23:59 UTC) TAM ve `ozet` BİREBİR AYNI:**

```
TAM : kg 9,24 · litre 3,5 · km 64 · kapsama 4/29 · 25 plaka
OZET: kg 9,24 · litre 3,5 · km 64 · kapsama 4/29 · 25 plaka   → ✅ aynı
aylık seri: altı ayın altısı da birebir aynı (TAM vs bolum=aylik)
```

**Canlı pencerede küçük farklar çıkıyor — kodun değil, verinin.** Aynı
fonksiyon (`co2Panosu`), aynı pencere, üç kez arka arkaya:

```
telemetri satırı: 33.151 → 33.155 → 33.161 → 33.170   (+19 satır / 80 sn)
1. TAM: kg 2667,7728 · litre 1010,52 · km 776
2. TAM: kg 2667,7728 · litre 1010,52 · km 776   = 1. ile aynı
3. TAM: kg 2667,7728 · litre 1010,52 · km 777   ← 2.'den FARKLI
```

flespi akarken bugünü içeren hiçbir pencere iki ölçüm arasında sabit
kalmıyor. Bu yüzden eşitlik **kapanmış pencerede** sınandı — CSV Tur 2'de
kullanılan aynı teknik. Kapsama sayısı (`olculen/toplamArac`) ve
`olculemeyenPlakalar` listesi de karşılaştırmaya dahil edildi.

### 6.5 📱 MOBİL İSTEMCİDE NE GEREKİYOR (CC'ye)

**Bugünkü davranış hiç değişmedi** — istemci hiçbir şey yapmazsa uç aynı
gövdeyi döndürmeye devam eder. Aşağısı hızlanmayı almak için:

1. **Tek çağrı yerine iki çağrı:**
   ```
   GET /api/mobile/analytics/co2?range=<...>&bolum=ozet    → ~3–14 sn
   GET /api/mobile/analytics/co2?range=<...>&bolum=aylik   → ~23 sn (cron sonrası ~9)
   ```
   🔴 `Promise.all` **KULLANMA** — o ikisini de bekletir ve kazancı yok eder.
   İkisini aynı anda başlat, ama **ayrı ayrı** ele al: özet gelir gelmez
   ekrana bas, aylık seriyi geldiğinde ekle.

2. **Aralık parametreleri aynen korunur** (`range`, `from`, `to`). İki çağrı
   **aynı** aralığı taşımalı, yoksa özet ile trendin dönemi ayrışır.

3. **`bolum` alanını oku, alanın varlığına güvenme.** `bolum:"ozet"` gelen
   yanıtta `pano.aylik` yoktur; bunu "trend boş" diye çizme, "henüz gelmedi"
   olarak göster.

4. **`aylik[].kaynak` üç değer alır** ve üçü ayrı gösterilmeli:
   `tablo` (hesaplanmış) · `canli` (o an hesaplandı) · `hesaplanmadi`
   (🔴 `kg:null` burada "0" değil "bilinmiyor").

5. **Zaman aşımı:** özet ayağı için 30 sn yeter; aylık ayağı için **90 sn**
   korunmalı (cron kurulana kadar ~23 sn, `tumzaman` daha uzun sürebilir).

6. **Hata yalıtımı:** aylık ayağı başarısız olursa özet ekranda KALMALI.
   İki çağrı bağımsız; birinin hatası diğerini düşürmemeli.

---

## 5 · ÖLÇEMEDİKLERİM

- **galzura-demo'da hiçbir şey** — service key yok `ÖLÇÜLEMEDİ`. § 1.4'teki
  sorgu ve `x-vercel-id` kontrolü Volkan'da.
- **`RTT(iad1→fra1)` ve `RTT(iad1→eu-west-1)`** — iad1'de kod koşturamıyorum.
  92 ms rakamı `VERCEL-BOLGE.md`'den devralındı, bu turda yeniden ölçülmedi.
- **Vercel compute boyutu** — repoda ayar yok; proje ayarlarından bakılmalı.
- **Vercel'deki gerçek cron-sonrası süre** — § 2.4 oran varsayımı. Cron
  kurulduktan sonra ölçülmeli.
- **Cron'un gerçek yazma turu** — HAK61 salt okuma; upsert hiç gönderilmedi.
- **Ö2'nin gerçek kazancı** — ölçülmedi; uç bölünmeden önce ölçülemez.
- **`ozel` dışındaki pencerelerin açık ayla örtüştüğü bir tarih var mı** —
  aranmadı; `range=ay` Viyana/UTC kayması yüzünden hiçbir gün örtüşmez.
